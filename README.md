# Foundry

**datarail.org/foundry**: what a GPU or CPU actually earns mining today, net of power and pool fees, set against
renting the same hardware out by the hour.

Milestone 1 is a simulator. No wallet, no pool, no money moves. What's decided and what's open is in
[docs/DECISIONS.md](docs/DECISIONS.md).

## What the page does

- **Yield.** Ranks every coin in `site/data/coins.json` for the chosen hardware: coins mined a day, revenue, power,
  pool fee, net a day and a month, and the power price at which it stops paying. The best one is the auto-switch pick.
- **Mine or rent.** Net dollars per GPU-hour for mining the best coin vs renting the card at a rate, booking level and
  marketplace cut you set.
- **Pool (mock).** A PPLNS pool of any size for any coin: share of network, expected block interval, what members are
  paid, the pool's fee income, and simulated recent blocks with luck.

The controls are kept in the URL hash, so a scenario can be shared as a link.

## The model

```
coins/day = (hashrate / network hashrate) * (86400 / block time) * block reward * (hours / 24)
net/day   = coins/day * price * (1 - pool fee) - watts/1000 * hours * $/kWh
rent/hr   = rate * booked * (1 - cut) - (booked * watts + (1 - booked) * idle watts)/1000 * $/kWh
```

Expected values: real blocks arrive by luck.

## Data

| File | Written by | What |
|---|---|---|
| `site/data/snapshot.json` | `tools/refresh.mjs` | Network hashrate, block time and reward, USD price, 24h change |
| `site/data/coins.json` | hand | Which coins, their algorithm, and where their stats come from |
| `site/data/hardware.json` | hand | Hashrate and watts per algorithm for each profile (estimates until benchmarked) |
| `site/data/rental.json` | hand | GPU rental rates, booking level, marketplace cut |
| `site/data/pool.json` | hand | Pool fee, fee range, PPLNS window |

Sources, all keyless: [WhatToMine](https://whattomine.com/coins.json) for GPU coins,
[p2pool.observer](https://p2pool.observer/api/pool_info) for Monero's mainchain, and
[CoinGecko](https://www.coingecko.com/) for USD prices. The page never calls them itself.

## Commands

```
node tools/refresh.mjs      # pull a fresh snapshot
node tools/check.mjs        # validate every data file
node tools/serve.mjs 5304   # http://localhost:5304/foundry/
```

No dependencies. Node 20+.

## Publishing

`.github/workflows/publish.yml` refreshes the snapshot, checks it, and copies `site/` into
`fvtale/datarail-site/public/foundry` on every push to main and twice a day. It is off until the repository variable
`PUBLISH_TO_SITE` is `true` and the `DATARAIL_SITE_DEPLOY_KEY` secret holds a write deploy key for datarail-site.

Not financial advice.
