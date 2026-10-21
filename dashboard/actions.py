"""Whitelisted actions: each one validates its params and builds an argv for a
trader skill script. Nothing here can approve or place an order."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from typing import Any, Callable

_BUNDLED = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "skills")
SKILLS = (os.environ.get("TRADER_SKILLS")
          or (_BUNDLED if os.path.isdir(os.path.join(_BUNDLED, "trader-budget")) else None)
          or os.path.join(os.path.expanduser("~"), ".claude", "skills"))

TICKER = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
QUERY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .,&'\-]{0,79}$")
NAME = re.compile(r"^[A-Za-z][A-Za-z' \-]{0,39}$")
ALERT_ID = re.compile(r"^[a-z0-9][a-z0-9\-]{0,59}$")
DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")


class ValidationError(ValueError):
    pass


# ---- validators -------------------------------------------------------------

def ticker(value: Any) -> str:
    t = str(value or "").strip().upper()
    if not TICKER.match(t):
        raise ValidationError("not a ticker: %r" % value)
    return t


def tickers(value: Any, required: bool = False) -> list[str]:
    if value in (None, "", []):
        if required:
            raise ValidationError("at least one ticker is required")
        return []
    if isinstance(value, str):
        value = re.split(r"[\s,]+", value.strip())
    if not isinstance(value, list) or len(value) > 50:
        raise ValidationError("tickers must be a list of up to 50")
    return [ticker(v) for v in value if str(v).strip()]


def number(value: Any, lo: float, hi: float, label: str) -> float:
    if isinstance(value, bool):
        raise ValidationError("%s must be a number" % label)
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise ValidationError("%s must be a number" % label) from None
    if not lo <= n <= hi:
        raise ValidationError("%s must be between %g and %g" % (label, lo, hi))
    return n


def fmt(n: float) -> str:
    return str(int(n)) if float(n).is_integer() else repr(n)


def flag(params: dict, key: str) -> bool:
    v = params.get(key, False)
    if not isinstance(v, bool):
        raise ValidationError("%s must be true or false" % key)
    return v


def pattern(value: Any, rx: re.Pattern, label: str) -> str:
    s = str(value or "").strip()
    if not rx.match(s):
        raise ValidationError("invalid %s: %r" % (label, value))
    return s


def cik(value: Any) -> str:
    return pattern(value, re.compile(r"^[0-9]{1,10}$"), "CIK")


def opt_num(params: dict, key: str, opt: str, lo: float, hi: float) -> list[str]:
    if params.get(key) in (None, ""):
        return []
    return [opt, fmt(number(params[key], lo, hi, key))]


# ---- actions ------------------------------------------------------------------
# Each builder returns (skill folder/script, argv).

def _quote(p):
    t = tickers(p.get("tickers"))
    return "trader-alerts/alerts.py", ["quote", *(t or ["--holdings"]), "--write", "--json"]


def _copycat_find(p):
    return "trader-copycat/edgar13f.py", ["find", pattern(p.get("query"), QUERY, "search"), "--json"]


def _copycat_diff(p):
    return "trader-copycat/edgar13f.py", ["diff", cik(p.get("cik")), "--json", "--combine"]


def _copycat_copy(p):
    args = ["copy", cik(p.get("cik")), "--json", "--combine"]
    args += ["--top", fmt(int(number(p.get("top", 10), 1, 100, "top")))]
    args += opt_num(p, "min_pct", "--min-pct", 0, 100)
    ex = tickers(p.get("exclude"))
    if ex:
        args += ["--exclude", *ex]
    if flag(p, "dry_run"):
        args.append("--dry-run")
    return "trader-copycat/edgar13f.py", args


def _budget(p):
    args = ["--write", "--json"] + opt_num(p, "budget", "--budget", 1, 1e9)
    if flag(p, "whole_shares"):
        args.append("--whole-shares")
    return "trader-budget/size.py", args


def _news(p):
    args = ["--json", "--hours", fmt(int(number(p.get("hours", 48), 1, 720, "hours")))]
    t = tickers(p.get("tickers"))
    if t:
        args += ["--tickers", *t]
    if flag(p, "all"):
        args.append("--all")
    if not flag(p, "mark_seen"):
        args.append("--dry-run")
    return "trader-news/news.py", args


def _member(p, args):
    if p.get("member"):
        args += ["--member", pattern(p["member"], NAME, "member name")]
    if p.get("year"):
        args += ["--year", fmt(int(number(p["year"], 2012, 2100, "year")))]
    return args


def _pelosi_new(p):
    args = _member(p, ["new", "--json", "--read"])
    if not flag(p, "mark_seen"):
        args.append("--dry-run")
    return "trader-pelosi/ptr.py", args


def _pelosi_index(p):
    args = _member(p, ["index", "--json"])
    return "trader-pelosi/ptr.py", args + ["--limit", fmt(int(number(p.get("limit", 25), 1, 500, "limit")))]


def _pelosi_fetch(p):
    doc = pattern(p.get("doc_id"), re.compile(r"^[0-9]{4,12}$"), "document id")
    return "trader-pelosi/ptr.py", _member({"year": p.get("year")}, ["fetch", doc, "--json"])


def _analyst(p):
    args = [*tickers(p.get("tickers"), required=True), "--json", "--metrics", "trader/metrics.json"]
    args += ["--quarters", fmt(int(number(p.get("quarters", 4), 1, 20, "quarters")))]
    if not flag(p, "filings"):
        args.append("--no-filings")
    return "trader-analyst/facts.py", args


def _alerts_add(p):
    kind = p.get("kind")
    if kind == "opening_bell":
        return "trader-alerts/alerts.py", ["add", "--opening-bell"]
    opts = {"above": "--above", "below": "--below", "stop": "--stop", "pct_move": "--pct"}
    if kind not in opts:
        raise ValidationError("alert kind must be one of above, below, stop, pct_move, opening_bell")
    hi = 100 if kind == "pct_move" else 1e7
    args = ["add", "--symbol", ticker(p.get("symbol")), opts[kind], fmt(number(p.get("value"), 0.01, hi, "value"))]
    if p.get("note"):
        args += ["--note", pattern(p["note"], QUERY, "note")]
    if flag(p, "rearm"):
        args.append("--rearm")
    return "trader-alerts/alerts.py", args


def _rebalance(p):
    args = ["--json"] + opt_num(p, "band", "--band", 0, 100)
    if flag(p, "sell_untracked"):
        args.append("--sell-untracked")
    if flag(p, "write"):
        args.append("--write")
    return "trader-rebalance/rebalance.py", args


def _tax_harvest(p):
    args = ["harvest", "--json"] + opt_num(p, "min_loss", "--min-loss", 0, 1e9)
    args += opt_num(p, "min_pct", "--min-pct", 0, 100)
    if flag(p, "write"):
        args.append("--write")
    return "trader-tax/lots.py", args


def _tax_sell(p):
    method = p.get("method", "fifo")
    if method not in ("fifo", "hifo"):
        raise ValidationError("method must be fifo or hifo")
    args = ["sell", ticker(p.get("ticker")), fmt(number(p.get("shares"), 0.0001, 1e9, "shares")),
            "--json", "--method", method] + opt_num(p, "price", "--price", 0.0001, 1e7)
    if flag(p, "record"):
        args.append("--record")
    return "trader-tax/lots.py", args


def _record_fill(p):
    side = p.get("side")
    if side not in ("buy", "sell"):
        raise ValidationError("side must be buy or sell")
    args = ["fill", "--symbol", ticker(p.get("symbol")), "--side", side,
            "--qty", fmt(number(p.get("qty"), 0.0001, 1e9, "qty")),
            "--price", fmt(number(p.get("price"), 0.0001, 1e7, "price"))]
    if p.get("date"):
        args += ["--date", pattern(p["date"], DATE, "date")]
    return "trader-broker/ticket.py", args


ACTIONS: dict[str, Callable[[dict], tuple[str, list[str]]]] = {
    "clock": lambda p: ("trader-alerts/alerts.py", ["clock", "--json"]),
    "quote": _quote,
    "copycat_find": _copycat_find,
    "copycat_diff": _copycat_diff,
    "copycat_copy": _copycat_copy,
    "budget": _budget,
    "risk": lambda p: ("trader-risk/check.py", ["--json"]),
    "tickets": lambda p: ("trader-broker/ticket.py", ["show", "--json"]),
    "news": _news,
    "pelosi_new": _pelosi_new,
    "pelosi_index": _pelosi_index,
    "pelosi_fetch": _pelosi_fetch,
    "analyst": _analyst,
    "screen": lambda p: ("trader-screener/screen.py", ["trader/metrics.json", "--rules", "trader/rules.json",
                                                       "--prices", "trader/prices.json", "--json"]),
    "alerts_list": lambda p: ("trader-alerts/alerts.py", ["list"]),
    "alerts_add": _alerts_add,
    "alerts_check": lambda p: ("trader-alerts/alerts.py", ["check", "--json"]),
    "alerts_reset": lambda p: ("trader-alerts/alerts.py", ["reset", pattern(p.get("id"), ALERT_ID, "alert id")]),
    "rebalance": _rebalance,
    "tax_report": lambda p: ("trader-tax/lots.py", ["report", "--json"]),
    "tax_harvest": _tax_harvest,
    "tax_sell": _tax_sell,
    "tax_wash": lambda p: ("trader-tax/lots.py", ["wash", ticker(p.get("ticker")), "--json"]),
    "record_fill": _record_fill,
}

# Network-heavy actions get longer before they time out.
SLOW = {"copycat_diff", "copycat_copy", "pelosi_new", "pelosi_index", "pelosi_fetch", "analyst", "news"}


def build(name: str, params: dict) -> tuple[str, list[str]]:
    if name not in ACTIONS:
        raise ValidationError("unknown action: %r" % name)
    if not isinstance(params, dict):
        raise ValidationError("params must be an object")
    rel, args = ACTIONS[name](params)
    return os.path.join(SKILLS, *rel.split("/")), args


def run(name: str, params: dict, home: str) -> dict:
    """Run one action in the trader home folder and return its output."""
    script, args = build(name, params)
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    try:
        proc = subprocess.run([sys.executable, "-I", script, *args], cwd=home, env=env,
                              capture_output=True, text=True, encoding="utf-8", errors="replace",
                              timeout=300 if name in SLOW else 60)
    except subprocess.TimeoutExpired:
        return {"ok": False, "data": None, "text": "", "error": "%s took too long and was stopped" % name}
    out = proc.stdout.strip()
    data = None
    if "--json" in args and out:
        try:
            data = json.loads(out)
        except json.JSONDecodeError:
            data = None
    # Several scripts exit 1 as a signal ("nothing rang", "market closed",
    # "an order was blocked"); a parsed JSON report is still a good result.
    ok = proc.returncode == 0 or data is not None
    error = "" if ok else (proc.stderr.strip() or out or "exit code %d" % proc.returncode)
    return {"ok": ok, "data": data, "text": "" if data is not None else out,
            "error": error, "warnings": proc.stderr.strip() if ok else ""}
