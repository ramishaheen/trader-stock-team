"""The trader/ files the dashboard reads, and the ones it may edit (validated
before every write, written atomically)."""

from __future__ import annotations

import json
import os
import re
import tempfile
from typing import Any

from actions import ALERT_ID, DATE, ValidationError, number, ticker

FILES = {
    "config": "trader/config.json",
    "targets": "trader/targets.json",
    "portfolio": "trader/portfolio.json",
    "alerts": "trader/alerts.json",
    "rules": "trader/rules.json",
    "prices": "trader/prices.json",
    "orders": "trader/orders.json",
    "metrics": "trader/metrics.json",
    "risk_state": "trader/state/risk.json",
    "broker_state": "trader/state/broker.json",
    "alerts_state": "trader/state/alerts.json",
}

EMAIL = re.compile(r"\S+@\S+\.\S+")


def _path(home: str, key: str) -> str:
    if key not in FILES:
        raise ValidationError("unknown file: %r" % key)
    return os.path.join(home, *FILES[key].split("/"))


def read(home: str, key: str) -> Any:
    path = _path(home, key)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _bool(cfg: dict, key: str) -> None:
    if not isinstance(cfg.get(key), bool):
        raise ValidationError("%s must be true or false" % key)


def _config(cfg: dict) -> dict:
    allowed = {"budget", "cash_buffer_pct", "max_position_pct", "max_order_usd", "min_order_usd",
               "max_orders_per_day", "fractional", "broker", "paper", "blocked", "allow_options",
               "allow_margin", "allow_short", "sec_user_agent"}
    extra = set(cfg) - allowed
    if extra:
        raise ValidationError("unknown settings: %s" % ", ".join(sorted(extra)))
    out = {
        "budget": number(cfg.get("budget"), 1, 1e9, "budget"),
        "cash_buffer_pct": number(cfg.get("cash_buffer_pct"), 0, 100, "cash_buffer_pct"),
        "max_position_pct": number(cfg.get("max_position_pct"), 1, 100, "max_position_pct"),
        "max_order_usd": number(cfg.get("max_order_usd"), 1, 1e9, "max_order_usd"),
        "min_order_usd": number(cfg.get("min_order_usd"), 0, 1e9, "min_order_usd"),
        "max_orders_per_day": int(number(cfg.get("max_orders_per_day"), 1, 1000, "max_orders_per_day")),
    }
    for key in ("fractional", "paper", "allow_options", "allow_margin", "allow_short"):
        _bool(cfg, key)
        out[key] = cfg[key]
    if cfg.get("broker") not in ("alpaca", "ibkr"):
        raise ValidationError("broker must be alpaca or ibkr")
    if not isinstance(cfg.get("blocked", []), list):
        raise ValidationError("blocked must be a list of tickers")
    ua = str(cfg.get("sec_user_agent", "")).strip()
    if not EMAIL.search(ua) or len(ua) > 120:
        raise ValidationError("sec_user_agent must be your name and email")
    return dict(out, broker=cfg["broker"], blocked=[ticker(t) for t in cfg.get("blocked", [])],
                sec_user_agent=ua)


def _targets(doc: dict) -> dict:
    weights = doc.get("weights")
    if not isinstance(weights, list) or not 1 <= len(weights) <= 100:
        raise ValidationError("targets need 1 to 100 weights")
    rows = [dict(w, ticker=ticker(w.get("ticker")), weight=number(w.get("weight"), 0.01, 100, "weight"))
            for w in weights]
    if len({r["ticker"] for r in rows}) != len(rows):
        raise ValidationError("each ticker may appear once")
    return dict(doc, weights=rows)


def _lot(lot: dict) -> dict:
    if not DATE.match(str(lot.get("date", ""))):
        raise ValidationError("lot date must be YYYY-MM-DD")
    return dict(lot, id=str(lot.get("id") or "")[:40], date=lot["date"],
                shares=number(lot.get("shares"), 0.0001, 1e9, "lot shares"),
                cost=number(lot.get("cost"), 0, 1e12, "lot cost"))


def _portfolio(doc: dict) -> dict:
    positions = doc.get("positions", [])
    if not isinstance(positions, list):
        raise ValidationError("positions must be a list")
    out = []
    for pos in positions:
        lots = [_lot(l) for l in pos.get("lots", [])]
        shares = round(sum(l["shares"] for l in lots), 6) if lots else number(pos.get("shares"), 0, 1e9, "shares")
        out.append(dict(pos, ticker=ticker(pos.get("ticker")), shares=shares, lots=lots))
    return dict(doc, cash=number(doc.get("cash", 0), 0, 1e12, "cash"), positions=out)


def _alerts(doc: dict) -> dict:
    rules = doc.get("rules")
    if not isinstance(rules, list):
        raise ValidationError("rules must be a list")
    out = []
    for r in rules:
        kind = r.get("type")
        if not ALERT_ID.match(str(r.get("id", ""))):
            raise ValidationError("bad alert id: %r" % r.get("id"))
        if kind == "opening_bell":
            out.append(dict(r))
        elif kind in ("above", "below", "stop"):
            out.append(dict(r, symbol=ticker(r.get("symbol")), price=number(r.get("price"), 0.01, 1e7, "price")))
        elif kind == "pct_move":
            out.append(dict(r, symbol=ticker(r.get("symbol")), pct=number(r.get("pct"), 0.01, 100, "pct")))
        else:
            raise ValidationError("unknown alert type: %r" % kind)
    return dict(doc, rules=out)


def _rules(doc: dict) -> dict:
    rules = doc.get("rules")
    if not isinstance(rules, list) or not rules:
        raise ValidationError("screener needs at least one rule")
    for r in rules:
        if r.get("op") not in (">", ">=", "<", "<=", "==", "!=", "in", "not in"):
            raise ValidationError("unknown operator: %r" % r.get("op"))
        if not re.match(r"^[a-z_][a-z0-9_]{0,40}$", str(r.get("metric", ""))):
            raise ValidationError("bad metric name: %r" % r.get("metric"))
    return doc


VALIDATORS = {"config": _config, "targets": _targets, "portfolio": _portfolio,
              "alerts": _alerts, "rules": _rules}


def write(home: str, key: str, doc: Any) -> dict:
    if key not in VALIDATORS:
        raise ValidationError("%s is read-only from the dashboard" % key)
    if not isinstance(doc, dict):
        raise ValidationError("expected a JSON object")
    try:
        clean = VALIDATORS[key](doc)
        text = json.dumps(clean, indent=2, allow_nan=False)
    except (AttributeError, TypeError, ValueError) as exc:
        if isinstance(exc, ValidationError):
            raise
        raise ValidationError("malformed %s: %s" % (key, exc)) from None
    path = _path(home, key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return clean
