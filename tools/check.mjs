#!/usr/bin/env node
/* Check the data files the page reads, so a bad edit fails CI instead of
 * shipping a blank simulator.
 *
 *     node tools/check.mjs
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DATA = resolve(import.meta.dirname, "..", "site", "data");
const problems = [];
const fail = (msg) => problems.push(msg);
const load = async (name) => JSON.parse(await readFile(resolve(DATA, name), "utf8"));
const positive = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

const coins = (await load("coins.json")).coins;
const snapshot = await load("snapshot.json");
const hardware = await load("hardware.json");
const rental = await load("rental.json");
const pool = await load("pool.json");

const tags = new Set();
for (const c of coins) {
  if (tags.has(c.tag)) fail(`coins.json: duplicate tag ${c.tag}`);
  tags.add(c.tag);
  if (!["gpu", "cpu"].includes(c.device)) fail(`coins.json ${c.tag}: device must be gpu or cpu`);
  if (c.source === "whattomine" && !c.key) fail(`coins.json ${c.tag}: whattomine coins need a key`);
  if (c.source === "p2pool" && !c.coingecko) fail(`coins.json ${c.tag}: p2pool coins need a coingecko id`);
  if (!["whattomine", "p2pool"].includes(c.source)) fail(`coins.json ${c.tag}: unknown source ${c.source}`);
}

if (Number.isNaN(Date.parse(snapshot.generated_at))) fail("snapshot.json: generated_at is not a date");
if (!positive(snapshot.btc_usd)) fail("snapshot.json: btc_usd missing");
if (!snapshot.coins?.length) fail("snapshot.json: no coins");
for (const c of snapshot.coins ?? []) {
  for (const k of ["block_time", "block_reward", "nethash", "price_usd"]) {
    if (!positive(c[k])) fail(`snapshot.json ${c.tag}: ${k} must be a positive number`);
  }
  if (!Number.isFinite(c.change_24h)) fail(`snapshot.json ${c.tag}: change_24h missing`);
}

const algos = new Set(coins.map((c) => c.algorithm));
if (!hardware.profiles?.length) fail("hardware.json: no profiles");
if (!hardware.profiles?.some((p) => p.kind === "gpu")) fail("hardware.json: mine-vs-rent needs at least one gpu profile");
for (const p of hardware.profiles ?? []) {
  for (const [algo, s] of Object.entries(p.algorithms ?? {})) {
    if (!algos.has(algo)) fail(`hardware.json ${p.id}: ${algo} is not an algorithm in coins.json`);
    if (!positive(s.hashrate) || !positive(s.watts)) fail(`hardware.json ${p.id} ${algo}: hashrate and watts must be positive`);
  }
}

const r = rental.rate_usd_per_hour ?? {};
if (!(positive(r.low) && r.low <= r.typical && r.typical <= r.high)) fail("rental.json: rates must satisfy 0 < low <= typical <= high");
if (!(rental.utilization > 0 && rental.utilization <= 1)) fail("rental.json: utilization must be in (0, 1]");
if (!(rental.platform_fee >= 0 && rental.platform_fee < 1)) fail("rental.json: platform_fee must be in [0, 1)");

const [fmin, fmax] = pool.fee_range ?? [];
if (!(pool.fee >= fmin && pool.fee <= fmax)) fail("pool.json: fee must sit inside fee_range");

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`ok: ${coins.length} coins, ${hardware.profiles.length} hardware profiles, snapshot ${snapshot.generated_at}`);
