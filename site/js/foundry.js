/* datarail.org/foundry: the simulator.
 *
 * Reads data/*.json and computes everything in the browser. The model is the
 * standard expected-value one:
 *
 *   coins/day = (your hashrate / network hashrate) * (86400 / block time) * block reward
 *   net/day   = revenue * (1 - pool fee) - watts * hours * $/kWh
 *
 * Nothing is sent anywhere; the only state kept is the controls, in the URL hash
 * so a set of numbers can be shared as a link.
 */

const $ = (id) => document.getElementById(id);
const DATA = "data/";
const IDLE_WATTS = 15; // a rented card waiting for a job

const state = {
  snapshot: null, coins: [], profiles: [], rental: null, pool: null,
  profileId: null, rig: {}, kwh: 0.25, fee: 0.0075, hours: 24,
  rate: 0.14, util: 0.6, cut: 0.1, poolTag: null, size: 2.4,
};

/* ---------- formatting ---------- */

const SI = [["P", 1e15], ["T", 1e12], ["G", 1e9], ["M", 1e6], ["k", 1e3], ["", 1]];
function unitFor(h) { return SI.find(([, f]) => h >= f) || SI[SI.length - 1]; }
function fmtHash(h) {
  if (!h) return "—";
  const [p, f] = unitFor(h);
  return `${(h / f).toLocaleString("en-US", { maximumFractionDigits: h / f < 10 ? 2 : 1 })} ${p}H/s`;
}
function fmtUSD(v, { sign = false } = {}) {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  // Sub-cent prices (NEOX, XNA) keep three significant figures instead of reading $0.0000.
  const s = a > 0 && a < 0.001
    ? a.toPrecision(3)
    : a.toLocaleString("en-US", (d => ({ minimumFractionDigits: d, maximumFractionDigits: d }))(a === 0 ? 2 : a < 0.01 ? 4 : a < 1 ? 3 : 2));
  const pre = v < 0 ? "−" : sign && v > 0 ? "+" : "";
  return `${pre}$${s}`;
}
function fmtPct(v, digits = 1) { return `${(v * 100).toFixed(digits)}%`; }
function fmtCoins(n) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
function fmtDuration(seconds) {
  if (!Number.isFinite(seconds)) return "never";
  const m = seconds / 60, h = m / 60, d = h / 24;
  if (d >= 365) return `${(d / 365).toFixed(1)} years`;
  if (d >= 2) return `${d.toFixed(1)} days`;
  if (h >= 2) return `${h.toFixed(1)} hours`;
  return `${Math.max(1, Math.round(m))} min`;
}
const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ---------- model ---------- */

function profile() { return state.profiles.find((p) => p.id === state.profileId); }

function yieldFor(coin, rig = state.rig) {
  const spec = rig[coin.algorithm];
  if (!spec || !spec.hashrate) return null;
  const share = state.hours / 24;
  const mined = (spec.hashrate / coin.nethash) * (86400 / coin.block_time) * coin.block_reward * share;
  const revenue = mined * coin.price_usd;
  const fee = revenue * state.fee;
  const kwhDay = (spec.watts / 1000) * state.hours;
  const power = kwhDay * state.kwh;
  const net = revenue - fee - power;
  const breakeven = kwhDay > 0 ? (revenue - fee) / kwhDay : Infinity;
  return { coin, spec, mined, revenue, fee, power, net, breakeven };
}

function ranked() {
  const rows = state.coins.map((coin) => ({ coin, y: yieldFor(coin) }));
  rows.sort((a, b) => (b.y ? b.y.net : -Infinity) - (a.y ? a.y.net : -Infinity));
  return rows;
}

/* ---------- ticker + as-of ---------- */

function renderTicker() {
  const items = state.coins.map((c) => {
    const ch = c.change_24h;
    const arrow = ch > 0 ? "▲" : ch < 0 ? "▼" : "■";
    return `<span class="ticker-item"><b>${esc(c.tag)}</b>${fmtUSD(c.price_usd)}` +
      `<span class="chg ${cls(ch)}">${arrow} ${fmtPct(Math.abs(ch))}</span></span>`;
  });
  items.push(`<span class="ticker-item"><b>BTC</b>${fmtUSD(state.snapshot.btc_usd)}</span>`);
  // Two copies so the -50% loop is seamless; the second is hidden from readers.
  $("tickerTrack").innerHTML = items.join("") + `<span aria-hidden="true" style="display:contents">${items.join("")}</span>`;
}

function renderAsOf() {
  const at = new Date(state.snapshot.generated_at);
  const hours = (Date.now() - at) / 36e5;
  const ago = hours < 1 ? "under an hour ago" : `${Math.round(hours)} h ago`;
  const stale = state.coins.filter((c) => c.stale).map((c) => c.tag);
  $("asof").innerHTML =
    `Market snapshot ${at.toISOString().slice(0, 16).replace("T", " ")} UTC · ${ago}` +
    (hours > 36 ? ` · <span class="stale">older than a day and a half</span>` : "") +
    (stale.length ? ` · <span class="stale">stale: ${esc(stale.join(", "))}</span>` : "");
  $("sources").textContent = state.snapshot.sources.join(", ");
}

/* ---------- yield section ---------- */

function loadRig() {
  const p = profile();
  state.rig = Object.fromEntries(Object.entries(p.algorithms).map(([a, s]) => [a, { ...s }]));
}

function renderRig() {
  const p = profile();
  $("rigFlag").textContent = p.measured ? "" : "estimates · not benchmarked";
  $("rigGrid").innerHTML = Object.entries(state.rig).map(([algo, s]) => {
    const [prefix, factor] = unitFor(s.hashrate);
    return `<div class="rig-row" data-algo="${esc(algo)}" data-factor="${factor}">
      <span class="algo">${esc(algo)}</span>
      <label>Hashrate (${prefix}H/s)<input type="number" min="0" step="any" data-k="hashrate" value="${+(s.hashrate / factor).toFixed(3)}"></label>
      <label>Watts<input type="number" min="0" step="1" data-k="watts" value="${s.watts}"></label>
    </div>`;
  }).join("");
}

function renderYield() {
  const rows = ranked();
  const best = rows.find((r) => r.y);
  const bestTag = best?.coin.tag;

  $("yieldBody").innerHTML = rows.map(({ coin, y }) => {
    const stale = coin.stale ? `<span class="stale">stale</span>` : "";
    const name = `<td class="coin"><b>${esc(coin.tag)}</b><span class="algo">${esc(coin.algorithm)}</span>${stale}` +
      (coin.tag === bestTag ? `<span class="tag live">Auto-switch pick</span>` : "") + `</td>`;
    if (!y) {
      return `<tr class="na">${name}<td class="num" colspan="7">needs a ${coin.device.toUpperCase()} profile</td></tr>`;
    }
    return `<tr class="${coin.tag === bestTag ? "best" : ""}">${name}
      <td class="num">${fmtCoins(y.mined)}</td>
      <td class="num">${fmtUSD(y.revenue)}</td>
      <td class="num">${fmtUSD(-y.power)}</td>
      <td class="num">${fmtUSD(-y.fee)}</td>
      <td class="num ${cls(y.net)}">${fmtUSD(y.net, { sign: true })}</td>
      <td class="num ${cls(y.net)}">${fmtUSD(y.net * 30, { sign: true })}</td>
      <td class="num">${Number.isFinite(y.breakeven) ? `$${y.breakeven.toFixed(3)}/kWh` : "—"}</td>
    </tr>`;
  }).join("");

  const y = best?.y;
  const tile = (label, v, s, c = "") =>
    `<div class="tile"><span class="label">${label}</span><span class="v ${c}">${v}</span><span class="s">${s}</span></div>`;
  $("tiles").innerHTML = y ? [
    tile("Best coin", esc(y.coin.tag), `${esc(y.coin.name)} · ${esc(y.coin.algorithm)}`),
    tile("Net per day", fmtUSD(y.net, { sign: true }), `revenue ${fmtUSD(y.revenue)}`, cls(y.net)),
    tile("Net per 30 days", fmtUSD(y.net * 30, { sign: true }), `power ${fmtUSD(y.power * 30)}`, cls(y.net)),
    tile("Break-even power", `$${y.breakeven.toFixed(3)}`, y.breakeven > state.kwh ? "per kWh · you're under it" : "per kWh · you're over it",
      y.breakeven > state.kwh ? "up" : "down"),
  ].join("") : "";
}

/* ---------- mine vs rent ---------- */

function gpuRig() {
  const p = profile();
  if (p.kind === "gpu") return { p, rig: state.rig };
  const g = state.profiles.find((x) => x.kind === "gpu");
  return { p: g, rig: Object.fromEntries(Object.entries(g.algorithms).map(([a, s]) => [a, { ...s }])) };
}

function renderVersus() {
  const { p, rig } = gpuRig();
  const mineRows = state.coins.map((c) => yieldFor(c, rig)).filter(Boolean).sort((a, b) => b.net - a.net);
  const m = mineRows[0];
  const hrs = state.hours;
  const mine = m ? {
    hr: m.net / hrs, gross: (m.revenue - m.fee) / hrs, power: m.power / hrs,
    label: `${m.coin.tag} · ${m.coin.algorithm}`,
  } : null;

  const watts = p.rental?.watts ?? 200;
  const gross = state.rate * state.util * (1 - state.cut);
  const powerHr = ((state.util * watts + (1 - state.util) * IDLE_WATTS) / 1000) * state.kwh;
  const rent = { hr: gross - powerHr, gross, power: powerHr, label: `${fmtPct(state.util, 0)} booked` };

  const series = [
    { key: "mine", name: "Mine", color: "var(--mark-mine)", d: mine },
    { key: "rent", name: "Rent", color: "var(--mark-rent)", d: rent },
  ].filter((s) => s.d);

  const vals = series.map((s) => s.d.hr);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const pad = (hi - lo || 0.01) * 0.12;
  lo = lo < 0 ? lo - pad : 0; hi = hi > 0 ? hi + pad : 0;
  if (hi === lo) hi = 0.01;
  const x = (v) => ((v - lo) / (hi - lo)) * 100;
  const zero = x(0);

  const rows = series.map((s) => {
    const v = s.d.hr, left = Math.min(x(v), zero), width = Math.abs(x(v) - zero);
    return `<div class="vs-row">
      <div class="vs-name"><i style="background:${s.color}"></i><span>${s.name}<small>${esc(s.d.label)}</small></span></div>
      <div class="vs-track" data-key="${s.key}" tabindex="0" aria-label="${s.name}: ${fmtUSD(v, { sign: true })} per hour">
        <div class="vs-zero" style="left:${zero}%"></div>
        <div class="vs-bar ${v < 0 ? "neg" : ""}" style="left:${left}%;width:${width}%;background:${s.color}"></div>
      </div>
      <div class="vs-val ${cls(v)}">${fmtUSD(v, { sign: true })}<span class="label">/hr</span></div>
    </div>`;
  }).join("");
  const ticks = [lo, 0, hi].filter((t, i, a) => a.indexOf(t) === i)
    .map((t) => `<span style="left:${x(t)}%">${fmtUSD(t)}</span>`).join("");
  $("versus").innerHTML = rows + `<div class="vs-axis" aria-hidden="true"><div></div><div>${ticks}</div><div></div></div>`;
  $("versus")._series = Object.fromEntries(series.map((s) => [s.key, s]));

  const note = p.id !== state.profileId ? ` (using ${esc(p.name)}, since the chosen hardware has no GPU)` : "";
  let verdict;
  if (!mine) verdict = "No GPU coin is configured to compare against.";
  else if (rent.hr > mine.hr) {
    const diff = rent.hr - mine.hr;
    verdict = `<b>Renting wins</b> by ${fmtUSD(diff)} an hour, about ${fmtUSD(diff * 24 * 30)} a month${note}.`;
  } else {
    const diff = mine.hr - rent.hr;
    verdict = `<b>Mining ${esc(m.coin.tag)} wins</b> by ${fmtUSD(diff)} an hour, about ${fmtUSD(diff * 24 * 30)} a month${note}.`;
  }
  if (mine && mine.hr < 0 && rent.hr < 0) verdict += " Both lose money at this power price: the card earns more switched off.";
  // Break-even booking rate for renting to match mining.
  if (mine) {
    // rent(u) = u * (rate * (1 - cut) - (W - idle) * kWh) - idle * kWh; solve rent(u) = mine.
    const need = (mine.hr + (IDLE_WATTS / 1000) * state.kwh) /
      (state.rate * (1 - state.cut) - ((watts - IDLE_WATTS) / 1000) * state.kwh);
    if (Number.isFinite(need) && need > 0 && need <= 1) verdict += ` Renting matches mining at ${fmtPct(need, 0)} booked.`;
  }
  $("verdict").innerHTML = verdict;
}

/* ---------- pool (mock) ---------- */

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function renderPool() {
  const coin = state.coins.find((c) => c.tag === state.poolTag) || state.coins[0];
  const owner = state.profiles.find((p) => p.algorithms[coin.algorithm]);
  const unit = owner?.algorithms[coin.algorithm];
  $("windowBlocks").textContent = state.pool.pplns_window_blocks;
  if (!unit) { $("poolTiles").innerHTML = ""; return; }

  const equivs = Math.round(10 ** state.size);
  $("sizeOut").textContent = `${equivs.toLocaleString("en-US")} × ${owner.name.split(" (")[0]}`;
  const poolHash = Math.max(equivs, 2) * unit.hashrate;
  const you = state.rig[coin.algorithm]?.hashrate ?? unit.hashrate;
  const hearth = unit.hashrate;
  const others = Math.max(poolHash - hearth - you, 0);

  const netShare = poolHash / coin.nethash;
  const blocksPerDay = netShare * (86400 / coin.block_time);
  const interval = blocksPerDay > 0 ? 86400 / blocksPerDay : Infinity;
  const rewardUsd = coin.block_reward * coin.price_usd;
  const grossDay = blocksPerDay * rewardUsd;
  const feeDay = grossDay * state.fee;
  const memberDay = (h) => (h / poolHash) * grossDay * (1 - state.fee);

  const tile = (label, v, s) => `<div class="tile"><span class="label">${label}</span><span class="v">${v}</span><span class="s">${s}</span></div>`;
  $("poolTiles").innerHTML = [
    tile("Pool hashrate", fmtHash(poolHash), `${fmtPct(netShare, netShare < 0.001 ? 3 : 1)} of ${esc(coin.tag)} network`),
    tile("Block every", fmtDuration(interval), `${blocksPerDay.toFixed(blocksPerDay < 1 ? 3 : 1)} expected a day`),
    tile("Paid to members", fmtUSD(grossDay - feeDay), `per day · ${esc(state.pool.scheme)}`),
    tile("Pool fee income", fmtUSD(feeDay), `per day at ${fmtPct(state.fee, 2)}`),
  ].join("");

  const rows = [
    ["You (rig above)", you, "you"],
    ["Hearth · admin", hearth, ""],
    [`Invited rigs (${Math.max(equivs - 2, 0).toLocaleString("en-US")})`, others, ""],
  ];
  $("members").querySelector("tbody").innerHTML = rows.map(([name, h, c]) =>
    `<tr class="${c}"><td>${esc(name)}</td><td class="num">${fmtHash(h)}</td><td class="num">${fmtPct(h / poolHash, 2)}</td><td class="num">${fmtUSD(memberDay(h))}</td></tr>`).join("");

  // Simulated history: exponential gaps around the expected interval, seeded
  // by the inputs so the table holds still until something changes.
  const rand = mulberry32([...coin.tag].reduce((a, ch) => a * 31 + ch.charCodeAt(0), equivs));
  const body = $("blocks").querySelector("tbody");
  if (interval > 30 * 86400) {
    body.innerHTML = `<tr><td colspan="3">At this size the pool expects a block every ${fmtDuration(interval)}. PPLNS members would wait that long between payouts.</td></tr>`;
    return;
  }
  let t = 0;
  const out = [];
  for (let i = 0; i < 6; i++) {
    const gap = -Math.log(1 - rand()) * interval;
    t += gap;
    out.push(`<tr><td>${fmtDuration(t)} ago</td><td class="num">${fmtCoins(coin.block_reward)} ${esc(coin.tag)}</td><td class="num">${fmtPct(interval / gap, 0)}</td></tr>`);
  }
  body.innerHTML = out.join("");
}

/* ---------- tooltip ---------- */

function bindTooltip() {
  const tip = $("tip");
  const show = (track, x, y) => {
    const s = $("versus")._series?.[track.dataset.key];
    if (!s) return;
    tip.innerHTML = `<b>${s.name} · per hour</b>` +
      `<div class="r"><span>Earned after fees</span><span>${fmtUSD(s.d.gross)}</span></div>` +
      `<div class="r"><span>Power</span><span>${fmtUSD(-s.d.power)}</span></div>` +
      `<div class="r"><span>Net</span><span>${fmtUSD(s.d.hr, { sign: true })}</span></div>`;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(x + 14, innerWidth - w - 8)}px`;
    tip.style.top = `${y + 14}px`;
  };
  const vs = $("versus");
  vs.addEventListener("pointermove", (e) => {
    const track = e.target.closest(".vs-track");
    if (track) show(track, e.clientX, e.clientY); else tip.hidden = true;
  });
  vs.addEventListener("pointerleave", () => { tip.hidden = true; });
  vs.addEventListener("focusin", (e) => {
    const track = e.target.closest(".vs-track");
    if (track) { const r = track.getBoundingClientRect(); show(track, r.left + r.width / 2, r.bottom); }
  });
  vs.addEventListener("focusout", () => { tip.hidden = true; });
}

/* ---------- controls + URL hash ---------- */

const KEYS = ["profileId", "kwh", "fee", "hours", "rate", "util", "cut", "poolTag", "size"];

function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  for (const k of KEYS) {
    if (!q.has(k)) continue;
    const v = q.get(k);
    state[k] = typeof state[k] === "number" ? Number(v) : v;
  }
}
function writeHash() {
  const q = new URLSearchParams(KEYS.map((k) => [k, String(state[k])]));
  history.replaceState(null, "", `#${q}`);
}

function syncOutputs() {
  $("kwhOut").textContent = `$${state.kwh.toFixed(2)}/kWh`;
  $("feeOut").textContent = fmtPct(state.fee, 2);
  $("hoursOut").textContent = `${state.hours} h`;
  $("rateOut").textContent = `$${state.rate.toFixed(2)}/hr`;
  $("utilOut").textContent = fmtPct(state.util, 0);
  $("cutOut").textContent = fmtPct(state.cut, 0);
}

function renderAll() {
  syncOutputs();
  renderYield();
  renderVersus();
  renderPool();
  writeHash();
}

function bindControls() {
  const num = (id, key) => {
    const el = $(id);
    el.value = state[key];
    el.addEventListener("input", () => { state[key] = Number(el.value); renderAll(); });
  };
  [["kwh", "kwh"], ["fee", "fee"], ["hours", "hours"], ["rate", "rate"], ["util", "util"], ["cut", "cut"], ["size", "size"]]
    .forEach(([id, key]) => num(id, key));

  const sel = $("profile");
  sel.innerHTML = state.profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  sel.value = state.profileId;
  sel.addEventListener("change", () => { state.profileId = sel.value; loadRig(); renderRig(); renderAll(); });

  const pc = $("poolCoin");
  pc.innerHTML = state.coins.map((c) => `<option value="${esc(c.tag)}">${esc(c.tag)} · ${esc(c.name)}</option>`).join("");
  pc.value = state.poolTag;
  pc.addEventListener("change", () => { state.poolTag = pc.value; renderAll(); });

  $("rigGrid").addEventListener("input", (e) => {
    const input = e.target.closest("input");
    if (!input) return;
    const row = input.closest(".rig-row");
    const spec = state.rig[row.dataset.algo];
    const v = Math.max(0, Number(input.value) || 0);
    spec[input.dataset.k] = input.dataset.k === "hashrate" ? v * Number(row.dataset.factor) : v;
    renderAll();
  });
  $("rigReset").addEventListener("click", () => { loadRig(); renderRig(); renderAll(); });
}

/* ---------- boot ---------- */

async function getJSON(name) {
  const r = await fetch(DATA + name, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

try {
  const [snapshot, hardware, rental, pool] = await Promise.all(
    ["snapshot.json", "hardware.json", "rental.json", "pool.json"].map(getJSON));
  Object.assign(state, {
    snapshot, coins: snapshot.coins, profiles: hardware.profiles, rental, pool,
    profileId: hardware.profiles[0].id, fee: pool.fee,
    rate: rental.rate_usd_per_hour.typical, util: rental.utilization, cut: rental.platform_fee,
  });
  // Default the pool to the best coin for the default rig.
  state.rig = {};
  loadRig();
  state.poolTag = ranked().find((r) => r.y)?.coin.tag ?? state.coins[0].tag;
  readHash();
  if (!profile()) state.profileId = state.profiles[0].id;
  if (!state.coins.some((c) => c.tag === state.poolTag)) state.poolTag = state.coins[0].tag;
  loadRig();
  renderTicker();
  renderAsOf();
  renderRig();
  bindControls();
  bindTooltip();
  renderAll();
} catch (error) {
  $("asof").innerHTML = `<span class="stale">Couldn't load the market data (${esc(error.message)}). Try again in a minute.</span>`;
  console.error(error);
}
