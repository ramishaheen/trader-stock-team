// Load: a local single-user tool, so "production" is a few tabs at once.
// Ramp to 10 users, hold 5 minutes. Reads dominate; actions spawn real scripts.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:8765";
const H = { headers: { "Content-Type": "application/json", "X-Trader-Dashboard": "1" } };

export const options = {
  stages: [{ duration: "30s", target: 10 }, { duration: "5m", target: 10 }, { duration: "15s", target: 0 }],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:read}": ["p(95)<500"],
    "http_req_duration{kind:action}": ["p(95)<3000"],
  },
};

export default function () {
  check(http.get(`${BASE}/api/state`, { tags: { kind: "read" } }), { "state 200": (r) => r.status === 200 });
  check(http.get(`${BASE}/app.js`, { tags: { kind: "read" } }), { "js 200": (r) => r.status === 200 });
  if (Math.random() < 0.3) {
    const action = Math.random() < 0.5 ? "screen" : "tickets";
    check(http.post(`${BASE}/api/run/${action}`, "{}", Object.assign({ tags: { kind: "action" } }, H)),
      { "action 200": (r) => r.status === 200 });
  }
  sleep(1);
}
