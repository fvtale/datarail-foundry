# AGENTS.md

Rules for any coding agent working in this repo. Claude Code reads it through `CLAUDE.md`; edit it here.

## What this is

Foundry, datarail.org/foundry: a mining and GPU-rental yield simulator, and later a mining pool and compute
marketplace on DataRail's own hardware (Hearth, Forge). [README.md](README.md) has the model and commands;
[docs/DECISIONS.md](docs/DECISIONS.md) has what's decided and what's open.

## Checks

```
node tools/check.mjs
for f in tools/*.mjs site/js/*.js; do node --check "$f"; done
node tools/serve.mjs 5304
```

No dependencies, on purpose. Port 5304 is Foundry's; other datarail projects use other ports.

## Conventions

- Assumptions live in `site/data/*.json`, not in code. `tools/check.mjs` validates them; extend it when a file grows.
- `site/data/snapshot.json` is written by `tools/refresh.mjs`. Don't hand-edit it.
- House look: the datarail.org Library palette and the shared circuit rails from `/assets/`. Numbers are mono and
  tabular, and a gain or loss always carries a sign as well as a colour.
- One repo per datarail project. Don't fold Hearth, Forge or the site into this one.

## Rules that protect money and people

- **No real money without the user.** Nothing in this repo may hold keys, sign transactions, run a stratum endpoint
  on a public address, or pay anyone until the user says so in a message. Payout custody is an open legal question.
- **No secrets.** Never commit `.env` or a wallet key. The refresh sources are keyless; keep it that way or keep keys
  in CI secrets.
- **Honest numbers.** Never round a loss into a profit, hide power cost, or present simulated pool data as real. Mock
  sections stay labelled as mock.
- **Commit only when the user asks.** Run `git status` first and don't touch changes you didn't make.
