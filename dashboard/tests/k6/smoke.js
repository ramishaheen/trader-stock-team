// Smoke: 1 user for 30s against the real dashboard endpoints.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:8765";
const H = { headers: { "Content-Type": "application/json", "X-Trader-Dashboard": "1" } };

export const options = {
  vus: 1,
  duration: "30s",
  thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<1500"], checks: ["rate>0.99"] },
};

export default function () {
  check(http.get(`${BASE}/`), { "index 200": (r) => r.status === 200 });
  check(http.get(`${BASE}/api/health`), { "health ok": (r) => r.json("data.status") === "ok" });
  check(http.get(`${BASE}/api/state`), { "state has config": (r) => r.json("data.config") !== null });
  check(http.post(`${BASE}/api/run/clock`, "{}", H), { "clock runs": (r) => r.status === 200 && r.json("data.ok") === true });
  check(http.post(`${BASE}/api/run/screen`, "{}", H), { "screen runs": (r) => r.status === 200 && r.json("success") === true });
  check(http.post(`${BASE}/api/run/quote`, JSON.stringify({ tickers: ["$$"] }), Object.assign({ responseCallback: http.expectedStatuses(400) }, H)), { "bad input 400": (r) => r.status === 400 });
  sleep(1);
}
