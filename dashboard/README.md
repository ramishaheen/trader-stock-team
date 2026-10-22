# Trader Desk

A local web dashboard for the 11 trader skills. It runs the real skill scripts
in `~/.claude/skills/trader-*` and reads and edits the files in `trader/`.
It never approves or places an order.

## Run

```bash
python dashboard/server.py
```

Then open http://127.0.0.1:8765. Python 3.9+ is required. There is nothing to
install: the server uses only the standard library.

Options: `--port 8765`, `--home <folder that holds trader/>` (default: the
folder above `dashboard/`). Environment: `TRADER_PORT`, `TRADER_HOME`,
`TRADER_SKILLS` (default: the repo's `skills/` folder, else `~/.claude/skills`).

## Pages

| Page | Controls |
| --- | --- |
| Team | every skill as a role-dressed agent on a live graph: who is working, what they hand to whom (animated), a persisted activity feed, and one-click tasks per agent |
| Overview | targets, prices, proposed orders with risk verdicts; one-click prices → sizing → risk |
| Copycat | find a 13F filer, see what changed last quarter, copy the top N, edit weights by hand |
| Orders | size to budget, run the risk check, read the order tickets |
| News | headlines and 8-K filings for your holdings and targets |
| Congress | new House trade disclosures, browse and read any filing |
| Research | SEC earnings metrics, screener rules editor and results |
| Alerts | add, delete, re-arm and check price alerts; NYSE clock |
| Holdings | lots and cash, record a broker fill, rebalance |
| Tax | unrealized gains, loss harvesting, sale preview, wash-sale check |
| Settings | every limit in `trader/config.json` |

## Safety

- Binds to 127.0.0.1 only. Requests with a foreign `Host` or `Origin`, or
  without the `X-Trader-Dashboard` header, are refused.
- Actions are a fixed whitelist (`actions.py`); every parameter is validated
  and passed as an argument list, never through a shell. `ticket.py approve`
  and `result` cannot be reached.
- File edits are validated (`store.py`) and written atomically.
- Loosening a guardrail in Settings (paper off, options, margin, shorts,
  clearing blocked tickers) asks for confirmation first.

## Tests

```bash
cd dashboard && python -m unittest discover -s tests
k6 run tests/k6/smoke.js   # with the server running
k6 run tests/k6/load.js
```
