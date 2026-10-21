"""Unit tests: every action validates its input and builds a safe argv."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from actions import ACTIONS, ValidationError, build  # noqa: E402


class BuildTests(unittest.TestCase):
    def test_quote_with_tickers_writes_prices(self):
        script, args = build("quote", {"tickers": ["aapl", "KO"]})
        self.assertTrue(script.endswith(os.path.join("trader-alerts", "alerts.py")))
        self.assertEqual(args, ["quote", "AAPL", "KO", "--write", "--json"])

    def test_quote_without_tickers_uses_holdings(self):
        _, args = build("quote", {})
        self.assertEqual(args, ["quote", "--holdings", "--write", "--json"])

    def test_copycat_copy(self):
        _, args = build("copycat_copy", {"cik": "1067983", "top": 5, "exclude": ["bac"]})
        self.assertEqual(args, ["copy", "1067983", "--json", "--combine", "--top", "5",
                                "--exclude", "BAC"])

    def test_budget_override_and_whole_shares(self):
        _, args = build("budget", {"budget": 2500, "whole_shares": True})
        self.assertEqual(args, ["--write", "--json", "--budget", "2500", "--whole-shares"])

    def test_news_is_dry_run_unless_marking_seen(self):
        _, args = build("news", {"hours": 24})
        self.assertIn("--dry-run", args)
        _, args = build("news", {"hours": 24, "mark_seen": True})
        self.assertNotIn("--dry-run", args)

    def test_harvest_only_writes_when_asked(self):
        _, args = build("tax_harvest", {})
        self.assertNotIn("--write", args)
        _, args = build("tax_harvest", {"write": True})
        self.assertIn("--write", args)

    def test_alert_add_needs_exactly_one_kind(self):
        _, args = build("alerts_add", {"kind": "above", "symbol": "aapl", "value": 350})
        self.assertEqual(args, ["add", "--symbol", "AAPL", "--above", "350"])
        _, args = build("alerts_add", {"kind": "opening_bell"})
        self.assertEqual(args, ["add", "--opening-bell"])
        with self.assertRaises(ValidationError):
            build("alerts_add", {"kind": "teleport", "symbol": "AAPL", "value": 1})

    def test_no_action_can_place_or_approve_orders(self):
        for name in ACTIONS:
            for params in ({}, {"tickers": ["AAPL"]}):
                try:
                    _, args = build(name, params)
                except ValidationError:
                    continue
                self.assertNotIn("approve", args)
                self.assertNotIn("result", args)


class ValidationTests(unittest.TestCase):
    def test_unknown_action(self):
        with self.assertRaises(ValidationError):
            build("rm_rf", {})

    def test_bad_ticker_rejected(self):
        for bad in ["AAPL;rm", "../x", "A" * 20, "--write"]:
            with self.assertRaises(ValidationError, msg=bad):
                build("quote", {"tickers": [bad]})

    def test_bad_cik_rejected(self):
        with self.assertRaises(ValidationError):
            build("copycat_diff", {"cik": "12ab"})

    def test_number_range_enforced(self):
        with self.assertRaises(ValidationError):
            build("budget", {"budget": -5})
        with self.assertRaises(ValidationError):
            build("copycat_copy", {"cik": "1067983", "top": 5000})

    def test_query_rejects_option_injection(self):
        with self.assertRaises(ValidationError):
            build("copycat_find", {"query": "--sec"})

    def test_bool_must_be_bool(self):
        with self.assertRaises(ValidationError):
            build("budget", {"whole_shares": "yes"})


if __name__ == "__main__":
    unittest.main()
