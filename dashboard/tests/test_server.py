"""Integration tests: real HTTP server, real skill scripts, offline fixtures."""

import http.client
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

import actions  # noqa: E402
from server import make_server  # noqa: E402

FIX = os.path.join(HERE, "tests", "fixtures")


@unittest.skipUnless(os.path.isdir(FIX) and os.path.isdir(actions.SKILLS), "fixtures or skills missing")
class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        trader = os.path.join(cls.tmp.name, "trader")
        os.makedirs(trader)
        for name in ("config", "portfolio", "prices", "targets"):
            shutil.copy(os.path.join(FIX, "trader-rebalance", name + ".json"), os.path.join(trader, name + ".json"))
        shutil.copy(os.path.join(FIX, "trader-screener", "metrics.json"), os.path.join(trader, "metrics.json"))
        shutil.copy(os.path.join(actions.SKILLS, "trader-screener", "rules.example.json"),
                    os.path.join(trader, "rules.json"))
        cls.httpd = make_server(cls.tmp.name, 0)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.tmp.cleanup()

    def call(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=120)
        h = {"Content-Type": "application/json", "X-Trader-Dashboard": "1"}
        h.update(headers or {})
        conn.request(method, path, json.dumps(body).encode() if body is not None else None, h)
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        return resp.status, json.loads(raw) if raw.startswith(b"{") else raw

    def test_index_served(self):
        status, body = self.call("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>", body)

    def test_state_returns_files(self):
        status, body = self.call("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertTrue(body["success"])
        self.assertIn("weights", body["data"]["targets"])

    def test_budget_then_risk_then_tickets(self):
        status, body = self.call("POST", "/api/run/budget", {"budget": 5000})
        self.assertEqual(status, 200, body)
        self.assertTrue(body["data"]["ok"], body)
        self.assertGreater(len(body["data"]["data"]["result"]["positions"]), 0)
        status, body = self.call("POST", "/api/run/risk", {})
        verdicts = {r["verdict"] for r in body["data"]["data"]["results"]}
        self.assertTrue(verdicts <= {"PASS", "BLOCK"})
        status, body = self.call("POST", "/api/run/tickets", {})
        self.assertIsInstance(body["data"]["data"], list)

    def test_runs_show_up_in_agent_activity(self):
        self.call("POST", "/api/run/screen", {})
        status, body = self.call("GET", "/api/activity")
        self.assertEqual(status, 200)
        latest = body["data"]["recent"][0]
        self.assertEqual((latest["agent"], latest["action"]), ("screener", "screen"))
        self.assertRegex(latest["summary"], r"^\d+ passed, \d+ failed$")
        self.assertEqual(body["data"]["running"], [])

    def test_screener_runs(self):
        status, body = self.call("POST", "/api/run/screen", {})
        self.assertTrue(body["data"]["ok"], body)
        self.assertIn("passed", body["data"]["data"])

    def test_rebalance_and_tax(self):
        _, body = self.call("POST", "/api/run/rebalance", {"band": 5})
        self.assertIn("rows", body["data"]["data"])
        _, body = self.call("POST", "/api/run/tax_report", {})
        self.assertIn("positions", body["data"]["data"])

    def test_edit_config_persists(self):
        _, body = self.call("GET", "/api/files/config")
        cfg = dict(body["data"], budget=7777, sec_user_agent="Test User test@example.com")
        cfg = {k: v for k, v in cfg.items() if k in {
            "budget", "cash_buffer_pct", "max_position_pct", "max_order_usd", "min_order_usd",
            "max_orders_per_day", "fractional", "broker", "paper", "blocked", "allow_options",
            "allow_margin", "allow_short", "sec_user_agent"}}
        for key, default in (("fractional", True), ("broker", "alpaca"), ("paper", True), ("blocked", []),
                             ("allow_options", False), ("allow_margin", False), ("allow_short", False),
                             ("min_order_usd", 5), ("max_orders_per_day", 10), ("max_order_usd", 2000)):
            cfg.setdefault(key, default)
        status, body = self.call("PUT", "/api/files/config", cfg)
        self.assertEqual(status, 200, body)
        _, body = self.call("GET", "/api/files/config")
        self.assertEqual(body["data"]["budget"], 7777)

    def test_signal_exit_code_with_json_is_not_an_error(self):
        # alerts.py clock exits 1 while the market is closed; that is a normal result.
        status, body = self.call("POST", "/api/run/clock", {})
        self.assertEqual(status, 200)
        self.assertTrue(body["data"]["ok"], body)
        self.assertEqual(body["data"]["error"], "")

    def test_nan_in_body_rejected(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        conn.request("PUT", "/api/files/rules", b'{"rules":[{"metric":"pe","op":"<","value":NaN}]}',
                     {"Content-Type": "application/json", "X-Trader-Dashboard": "1"})
        resp = conn.getresponse()
        resp.read()
        conn.close()
        self.assertEqual(resp.status, 400)

    def test_corrupt_file_does_not_blank_state(self):
        path = os.path.join(self.tmp.name, "trader", "metrics.json")
        with open(path, encoding="utf-8") as f:
            original = f.read()
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write("{half written")
            status, body = self.call("GET", "/api/state")
            self.assertEqual(status, 200)
            self.assertIsNone(body["data"]["metrics"])
            self.assertIn("metrics", body["data"]["_errors"])
            self.assertIsNotNone(body["data"]["config"])
        finally:
            with open(path, "w", encoding="utf-8") as f:
                f.write(original)

    def test_invalid_input_is_400(self):
        status, body = self.call("POST", "/api/run/quote", {"tickers": ["$$$"]})
        self.assertEqual(status, 400)
        self.assertFalse(body["success"])

    def test_writes_need_dashboard_header(self):
        status, _ = self.call("POST", "/api/run/clock", {}, {"X-Trader-Dashboard": "0"})
        self.assertEqual(status, 403)

    def test_foreign_origin_blocked(self):
        status, _ = self.call("POST", "/api/run/clock", {}, {"Origin": "http://evil.example"})
        self.assertEqual(status, 403)

    def test_foreign_host_blocked(self):
        status, _ = self.call("GET", "/api/state", headers={"Host": "evil.example"})
        self.assertEqual(status, 403)

    def test_read_only_file_cannot_be_put(self):
        status, _ = self.call("PUT", "/api/files/orders", {"orders": []})
        self.assertEqual(status, 400)

    def test_unknown_action_is_400(self):
        status, _ = self.call("POST", "/api/run/approve", {})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
