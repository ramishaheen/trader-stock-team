"""Unit tests: editable files are validated before anything is written."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import store  # noqa: E402
from actions import ValidationError  # noqa: E402

GOOD_CONFIG = {
    "budget": 5000, "cash_buffer_pct": 10, "max_position_pct": 25,
    "max_order_usd": 2000, "min_order_usd": 5, "max_orders_per_day": 10,
    "fractional": True, "broker": "alpaca", "paper": True, "blocked": ["TSLA"],
    "allow_options": False, "allow_margin": False, "allow_short": False,
    "sec_user_agent": "Jane Doe jane@example.com",
}


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = self.tmp.name
        os.makedirs(os.path.join(self.home, "trader"))

    def tearDown(self):
        self.tmp.cleanup()

    def test_read_missing_file_is_none(self):
        self.assertIsNone(store.read(self.home, "portfolio"))

    def test_config_round_trip(self):
        store.write(self.home, "config", GOOD_CONFIG)
        self.assertEqual(store.read(self.home, "config")["budget"], 5000)

    def test_config_rejects_bad_values(self):
        for key, bad in [("budget", -1), ("cash_buffer_pct", 150), ("paper", "true"),
                         ("blocked", ["NOT A TICKER!"]), ("broker", "robinhood"),
                         ("sec_user_agent", "no email here")]:
            cfg = dict(GOOD_CONFIG, **{key: bad})
            with self.assertRaises(ValidationError, msg=key):
                store.write(self.home, "config", cfg)

    def test_config_rejects_unknown_keys(self):
        with self.assertRaises(ValidationError):
            store.write(self.home, "config", dict(GOOD_CONFIG, evil=1))

    def test_targets_weights_validated(self):
        store.write(self.home, "targets", {"weights": [{"ticker": "AAPL", "weight": 60},
                                                       {"ticker": "KO", "weight": 40}]})
        with self.assertRaises(ValidationError):
            store.write(self.home, "targets", {"weights": [{"ticker": "AAPL", "weight": -3}]})

    def test_targets_keeps_copycat_metadata(self):
        store.write(self.home, "targets", {"source": "13F", "weights": [
            {"ticker": "AAPL", "weight": 100, "name": "Apple", "cusips": ["037833100"]}]})
        self.assertEqual(store.read(self.home, "targets")["source"], "13F")

    def test_portfolio_lots_validated(self):
        good = {"cash": 100, "positions": [{"ticker": "KO", "shares": 10, "lots": [
            {"id": "KO-1", "date": "2025-03-03", "shares": 10, "cost": 1050}]}]}
        store.write(self.home, "portfolio", good)
        bad = json.loads(json.dumps(good))
        bad["positions"][0]["lots"][0]["date"] = "yesterday"
        with self.assertRaises(ValidationError):
            store.write(self.home, "portfolio", bad)

    def test_alert_rules_validated(self):
        store.write(self.home, "alerts", {"rules": [
            {"id": "opening-bell", "type": "opening_bell"},
            {"id": "aapl-above-350", "symbol": "AAPL", "type": "above", "price": 350}]})
        with self.assertRaises(ValidationError):
            store.write(self.home, "alerts", {"rules": [{"id": "x", "type": "nuke"}]})

    def test_screener_rules_validated(self):
        store.write(self.home, "rules", {"name": "mine", "rules": [
            {"metric": "pe", "op": "<=", "value": 30}]})
        with self.assertRaises(ValidationError):
            store.write(self.home, "rules", {"rules": [{"metric": "pe", "op": "~", "value": 1}]})

    def test_malformed_shapes_are_400_not_500(self):
        for key, doc in [("portfolio", {"positions": [{"ticker": "KO", "lots": None}]}),
                         ("alerts", {"rules": ["not-a-dict"]}),
                         ("targets", {"weights": [5]})]:
            with self.assertRaises(ValidationError, msg=key):
                store.write(self.home, key, doc)

    def test_nan_is_never_written(self):
        with self.assertRaises(ValidationError):
            store.write(self.home, "rules", {"rules": [{"metric": "pe", "op": "<", "value": float("nan")}]})
        self.assertIsNone(store.read(self.home, "rules"))

    def test_read_only_files_cannot_be_written(self):
        for key in ("orders", "prices", "metrics", "nope"):
            with self.assertRaises(ValidationError):
                store.write(self.home, key, {})


if __name__ == "__main__":
    unittest.main()
