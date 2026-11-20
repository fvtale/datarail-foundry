#!/usr/bin/env node
/* Refresh site/data/snapshot.json from public, keyless sources.
 *
 *     node tools/refresh.mjs
 *
 * The page never calls these APIs itself: rate limits and CORS would break it
 * for visitors, and there are no keys to keep out of a browser this way.
 *
 * Sources:
 *   whattomine.com/coins.json      GPU coins: block time, reward, network hashrate,
 *                                  price in BTC (now and 24h ago)
 *   p2pool.observer/api/pool_info  Monero mainchain: difficulty, reward, block time
 *   api.coingecko.com simple/price BTC/USD and any coin with a `coingecko` id
 *
 * A coin whose source fails keeps its previous numbers with stale: true, so one
 * bad fetch dims a row instead of blanking the page. If nothing at all can be
 * fetched, the old file is left alone and the script exits 1.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DATA = resolve(import.meta.dirname, "..", "site", "data");
const UA = { "user-agent": "datarail-foundry/0.1 (+https://datarail.org/foundry)" };

async function getJSON(url) {
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function attempt(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.warn(`! ${label}: ${error.message}`);
    return null;
  }
}

const { coins } = JSON.parse(await readFile(resolve(DATA, "coins.json"), "utf8"));
const previous = await attempt("previous snapshot", async () =>
  JSON.parse(await readFile(resolve(DATA, "snapshot.json"), "utf8")));
const prevByTag = Object.fromEntries((previous?.coins ?? []).map((c) => [c.tag, c]));

const geckoIds = ["bitcoin", ...coins.filter((c) => c.coingecko).map((c) => c.coingecko)];
const [wtm, p2pool, gecko] = await Promise.all([
  attempt("whattomine", () => getJSON("https://whattomine.com/coins.json")),
  attempt("p2pool.observer", () => getJSON("https://p2pool.observer/api/pool_info")),
  attempt("coingecko", () => getJSON(
    `https://api.coingecko.com/api/v3/simple/price?ids=${geckoIds.join(",")}` +
    "&vs_currencies=usd&include_24hr_change=true")),
]);

const btcUsd = gecko?.bitcoin?.usd ?? previous?.btc_usd ?? null;
const btcChange = (gecko?.bitcoin?.usd_24h_change ?? 0) / 100;

function fromWhatToMine(coin) {
  const w = wtm?.coins?.[coin.key];
  if (!w || !btcUsd) return null;
  // WhatToMine prices in BTC; the 24h change in USD compounds both moves.
  const btcMove = w.exchange_rate24 ? w.exchange_rate / w.exchange_rate24 - 1 : 0;
  return {
    block_time: Number(w.block_time),
    block_reward: Number(w.block_reward),
    nethash: Number(w.nethash),
    price_usd: w.exchange_rate * btcUsd,
    change_24h: (1 + btcMove) * (1 + btcChange) - 1,
  };
}

function fromP2Pool(coin) {
  const m = p2pool?.mainchain;
  const g = gecko?.[coin.coingecko];
  if (!m || !g) return null;
  return {
    block_time: m.block_time,
    block_reward: m.reward / 1e12, // atomic units
    nethash: m.difficulty / m.block_time,
    price_usd: g.usd,
    change_24h: (g.usd_24h_change ?? 0) / 100,
  };
}

let fresh = 0;
const out = coins.map((coin) => {
  const live = coin.source === "whattomine" ? fromWhatToMine(coin) : fromP2Pool(coin);
  const base = { tag: coin.tag, name: coin.name, algorithm: coin.algorithm, device: coin.device };
  if (live && Object.values(live).every(Number.isFinite)) {
    fresh += 1;
    return { ...base, ...live, stale: false };
  }
  const old = prevByTag[coin.tag];
  console.warn(`! ${coin.tag}: no live data, ${old ? "keeping previous numbers" : "dropped"}`);
  return old ? { ...old, ...base, stale: true } : null;
}).filter(Boolean);

if (fresh === 0) {
  console.error("Nothing could be fetched; snapshot.json left as it was.");
  process.exit(1);
}

const snapshot = {
  generated_at: new Date().toISOString(),
  btc_usd: btcUsd,
  sources: ["whattomine.com", "p2pool.observer", "coingecko.com"],
  coins: out,
};
await writeFile(resolve(DATA, "snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");
console.log(`snapshot.json: ${fresh}/${coins.length} coins fresh, BTC $${btcUsd}`);
