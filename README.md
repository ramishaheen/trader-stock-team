# Trader Stock Team

A local web dashboard ("Trader Desk") on top of 11 Claude trader skills: copy a
fund's 13F, size it to your budget, risk-check every order, and watch news,
Congress trades, earnings, alerts, holdings and taxes. Research and planning
only: nothing here can approve or place an order.

## Quick start

```bash
mkdir trader && cp trader.example/config.json trader/config.json
# edit trader/config.json: set "sec_user_agent" to "Your Name you@example.com" (SEC requires it)
python dashboard/server.py
```

Open http://127.0.0.1:8765. Python 3.9+, no packages to install.

## Layout

| Path | What |
| --- | --- |
| `dashboard/` | The web dashboard: stdlib Python server, vanilla JS UI, tests, k6 load tests. See [dashboard/README.md](dashboard/README.md). |
| `skills/` | The 11 trader skills (Python tools + `SKILL.md`), copied from [Jakeschincariol/trader-skill](https://github.com/Jakeschincariol/trader-skill) under the MIT license (`skills/LICENSE`). Copy them to `~/.claude/skills/` to use them as slash commands in Claude Code. |
| `trader.example/` | Starter settings. Your real data lives in `trader/`, which git ignores. |

## Tests

```bash
cd dashboard && python -m unittest discover -s tests
```

Education and tooling, not financial advice.
