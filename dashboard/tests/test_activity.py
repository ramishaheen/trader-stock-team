"""Unit tests: agent activity tracking, summaries and persistence."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import activity  # noqa: E402
from actions import ACTIONS  # noqa: E402


class ActivityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "state", "activity.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_every_action_belongs_to_an_agent_with_a_label(self):
        for name in ACTIONS:
            self.assertIn(name, activity.AGENT_OF, name)
            self.assertIn(name, activity.LABEL, name)

    def test_running_then_finished_and_persisted(self):
        log = activity.Activity(self.path)
        tid = log.start("budget")
        snap = log.snapshot()
        self.assertEqual([t["agent"] for t in snap["running"]], ["budget"])
        log.finish(tid, {"ok": True, "data": {"result": {"positions": [{"dollars": 1250}, {"dollars": 600}]}}})
        snap = log.snapshot()
        self.assertEqual(snap["running"], [])
        self.assertEqual(snap["recent"][0]["summary"], "2 orders, $1,850")
        self.assertTrue(snap["recent"][0]["ok"])
        reloaded = activity.Activity(self.path)
        self.assertEqual(reloaded.snapshot()["recent"][0]["action"], "budget")

    def test_quiet_actions_are_not_logged(self):
        log = activity.Activity(self.path)
        self.assertIsNone(log.start("clock"))
        log.finish(None, {"ok": True})
        self.assertEqual(log.snapshot()["recent"], [])

    def test_history_is_capped(self):
        log = activity.Activity(self.path)
        for _ in range(activity.KEEP + 15):
            log.finish(log.start("risk"), {"ok": True, "data": {"results": []}})
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(len(json.load(f)["recent"]), activity.KEEP)

    def test_corrupt_history_file_starts_empty(self):
        os.makedirs(os.path.dirname(self.path))
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{nope")
        self.assertEqual(activity.Activity(self.path).snapshot()["recent"], [])


class SummaryTests(unittest.TestCase):
    def test_risk(self):
        r = {"ok": True, "data": {"results": [{"verdict": "PASS"}, {"verdict": "BLOCK"}, {"verdict": "PASS"}]}}
        self.assertEqual(activity.summarize("risk", r), "2 passed, 1 blocked")

    def test_screen(self):
        r = {"ok": True, "data": {"passed": [1, 2], "failed": [3]}}
        self.assertEqual(activity.summarize("screen", r), "2 passed, 1 failed")

    def test_error_wins(self):
        r = {"ok": False, "error": "rebalance.py: no portfolio\nmore"}
        self.assertEqual(activity.summarize("rebalance", r), "rebalance.py: no portfolio")

    def test_unexpected_shape_falls_back_to_text(self):
        self.assertEqual(activity.summarize("news", {"ok": True, "data": [], "text": ""}), "done")
        self.assertEqual(activity.summarize("record_fill", {"ok": True, "text": "Added lot\nx"}), "Added lot")


if __name__ == "__main__":
    unittest.main()
