# Decisions

What has been decided about Foundry, what hasn't, and why. Newest at the bottom.

## Decided (2026-11-20)

1. **Two ways to earn.** Mine GPU/CPU-friendly coins, switching automatically to whichever pays best, and rent out
   GPU time (inference, renders) priced like a mining yield. Mining is one job type among others.
2. **Hardware is an admin privilege.** Hearth (mini PC + RTX 5070 eGPU) and Forge are run by admins. Users bring
   their own rigs to form pools or mine solo. A public pool may come later, for more pooled hashrate and liquidity.
3. **Fee.** PPLNS, with the fee cut below the customary 1–2% (default 0.75%, set in `site/data/pool.json`).
4. **Milestone 1 is a site and simulator.** Profitability calculator, mine-vs-rent comparison per GPU-hour, mock pool
   dashboard. No wallet, no pool, no money moves.
5. **Market data comes from a scheduled job**, not the browser: `tools/refresh.mjs` writes `site/data/snapshot.json`
   from keyless public sources. No API keys anywhere.
6. **Public repo**, page at datarail.org/foundry.

## Open

- **Payout custody.** Custodial PPLNS (the pool collects rewards and pays members later) is the preferred design, but
  holding members' rewards can make the operator a money transmitter (FinCEN registration, AML program, sanctions
  screening), and New York's BitLicense covers holding or transmitting crypto for NY residents. Non-custodial options:
  paying members straight from the block reward where the coin allows it (P2Pool-style), frequent low-minimum payouts,
  or a ledger-only period. **Needs a lawyer's read before anything real is paid out.**
- **Privacy coins.** Monero is in the simulator. Auto-switching a real pool into it raises exchange and compliance
  friction; decide before mainnet.
- **Reaching Hearth.** Starlink uses CGNAT, so outside miners can't connect to a stratum port on Hearth directly. A
  relay is needed: the VPS, Cloudflare Tunnel or Tailscale Funnel (the same open question Hearth has).
- **Forge jobs.** Forge (`~/llm-forge`) is an Ollama chat server with no job interface yet. The rental side needs one.
- **Real hashrates.** `site/data/hardware.json` holds estimates. Benchmark the 5070 and Hearth's CPU and set
  `measured: true`.
