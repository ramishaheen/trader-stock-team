"""Which agent is working on what: a live "running" set plus a persisted log of
finished tasks (trader/state/activity.json), shown on the Team page."""

from __future__ import annotations

import itertools
import json
import os
import tempfile
import threading
import time
from typing import Any

# Each skill is one agent on the team.
AGENT_OF = {
    "copycat_find": "copycat", "copycat_diff": "copycat", "copycat_copy": "copycat",
    "quote": "alerts", "clock": "alerts", "alerts_list": "alerts", "alerts_add": "alerts",
    "alerts_check": "alerts", "alerts_reset": "alerts",
    "budget": "budget", "risk": "risk", "tickets": "broker", "record_fill": "broker",
    "news": "news", "pelosi_new": "pelosi", "pelosi_index": "pelosi", "pelosi_fetch": "pelosi",
    "analyst": "analyst", "screen": "screener", "rebalance": "rebalance",
    "tax_report": "tax", "tax_harvest": "tax", "tax_sell": "tax", "tax_wash": "tax",
}

LABEL = {
    "copycat_find": "Searching SEC filers", "copycat_diff": "Comparing 13F quarters",
    "copycat_copy": "Copying a 13F portfolio", "quote": "Fetching prices", "clock": "Checking the NYSE clock",
    "alerts_list": "Listing alerts", "alerts_add": "Adding an alert", "alerts_check": "Checking alerts",
    "alerts_reset": "Re-arming an alert", "budget": "Sizing orders to the budget",
    "risk": "Checking orders against limits", "tickets": "Preparing order tickets",
    "record_fill": "Recording a broker fill", "news": "Scanning headlines and 8-Ks",
    "pelosi_new": "Checking new Congress filings", "pelosi_index": "Listing Congress filings",
    "pelosi_fetch": "Reading a Congress filing", "analyst": "Reading SEC earnings",
    "screen": "Screening companies", "rebalance": "Measuring drift",
    "tax_report": "Totting up gains", "tax_harvest": "Hunting tax losses",
    "tax_sell": "Pricing a sale", "tax_wash": "Checking wash sales",
}

# Too frequent to be interesting on the Team page.
QUIET = {"clock"}
KEEP = 200


def _n(x: Any) -> int:
    return len(x) if isinstance(x, (list, dict)) else 0


def _p(n: int, word: str) -> str:
    """'1 filing', '3 filings'."""
    return "%d %s%s" % (n, word, "" if n == 1 else "s")


def summarize(action: str, result: dict) -> str:
    """One line describing what the task produced."""
    if result.get("error") and not result.get("ok"):
        return str(result["error"]).strip().splitlines()[0][:160]
    d = result.get("data")
    try:
        if action == "quote":
            return _p(_n(d["quotes"]), "price")
        if action == "copycat_find":
            return _p(_n(d), "filer") + " found"
        if action == "copycat_diff":
            return _p(_n(d["changes"]), "change") + " since last quarter"
        if action == "copycat_copy":
            return _p(_n(d["weights"]), "target weight")
        if action == "budget":
            pos = d["result"]["positions"]
            return "%s, $%s" % (_p(len(pos), "order"), format(round(sum(p["dollars"] for p in pos)), ","))
        if action == "risk":
            v = [r["verdict"] for r in d["results"]]
            return "%d passed, %d blocked" % (v.count("PASS"), len(v) - v.count("PASS"))
        if action == "tickets":
            return "%s, %d ready" % (_p(len(d), "ticket"), sum(1 for t in d if t.get("ready")))
        if action == "news":
            return _p(_n(d["items"]), "headline")
        if action == "pelosi_new":
            return _p(_n(d["new"]), "new filing")
        if action == "pelosi_index":
            return _p(_n(d), "filing")
        if action == "pelosi_fetch":
            return _p(_n((d.get("report") or d).get("rows")), "trade") + " read"
        if action == "analyst":
            return "%d %s" % (_n(d), "company" if _n(d) == 1 else "companies")
        if action == "screen":
            return "%d passed, %d failed" % (_n(d["passed"]), _n(d["failed"]))
        if action == "alerts_check":
            return "%d rang" % _n(d["rings"])
        if action == "rebalance":
            return _p(_n(d["orders"]), "trade") + " proposed"
        if action == "tax_report":
            return _p(_n(d["positions"]), "position")
        if action == "tax_harvest":
            return _p(_n(d["candidates"]), "loss candidate")
    except (KeyError, TypeError, AttributeError):
        pass
    text = (result.get("text") or "").strip()
    return text.splitlines()[0][:160] if text else "done"


class Activity:
    """Thread-safe running set + capped, persisted history."""

    def __init__(self, path: str) -> None:
        self.path = path
        self.lock = threading.Lock()
        self.running: dict[int, dict] = {}
        self.ids = itertools.count(1)
        self.recent: list[dict] = self._load()

    def _load(self) -> list[dict]:
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
            return [e for e in data.get("recent", []) if isinstance(e, dict)][-KEEP:]
        except (OSError, ValueError, AttributeError):
            return []

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self.path), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"recent": self.recent}, f, indent=1)
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def start(self, action: str) -> int | None:
        if action in QUIET:
            return None
        task = {"agent": AGENT_OF.get(action, "team"), "action": action,
                "label": LABEL.get(action, action), "started": time.time()}
        with self.lock:
            tid = next(self.ids)
            self.running[tid] = dict(task, id=tid)
        return tid

    def finish(self, tid: int | None, result: dict) -> None:
        if tid is None:
            return
        with self.lock:
            task = self.running.pop(tid, None)
            if task is None:
                return
            now = time.time()
            entry = dict(task, finished=now, ms=int((now - task["started"]) * 1000),
                         ok=bool(result.get("ok")), summary=summarize(task["action"], result))
            self.recent = (self.recent + [entry])[-KEEP:]
            self._save()

    def snapshot(self) -> dict:
        with self.lock:
            return {"now": time.time(), "running": list(self.running.values()),
                    "recent": list(reversed(self.recent[-60:]))}
