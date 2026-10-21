"""Local web dashboard for the trader skills. Standard library only.

    python server.py [--port 8765] [--home ..]

Binds to 127.0.0.1. It runs the real skill scripts and edits the trader/
files; it never approves or places an order.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import actions
import store

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = {"/": ("index.html", "text/html; charset=utf-8"),
          "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/ui.js": ("ui.js", "text/javascript; charset=utf-8"),
          "/views-plan.js": ("views-plan.js", "text/javascript; charset=utf-8"),
          "/views-watch.js": ("views-watch.js", "text/javascript; charset=utf-8"),
          "/views-books.js": ("views-books.js", "text/javascript; charset=utf-8"),
          "/styles.css": ("styles.css", "text/css; charset=utf-8")}
MAX_BODY = 256 * 1024
CSRF_HEADER = "X-Trader-Dashboard"
READ_ONLY = {"clock", "tickets", "tax_report", "tax_wash", "alerts_list", "screen", "copycat_find"}

log = logging.getLogger("trader-dashboard")
write_lock = threading.Lock()
slow_locks = {name: threading.Lock() for name in actions.SLOW}


def read_state(home: str) -> dict:
    """Every trader file; one unreadable file does not blank the dashboard."""
    state, errors = {}, {}
    for key in store.FILES:
        try:
            state[key] = store.read(home, key)
        except (OSError, ValueError) as exc:
            state[key] = None
            errors[key] = str(exc)
    if errors:
        log.warning("unreadable trader files: %s", errors)
    return dict(state, _errors=errors)


def _reject_constant(name: str):
    raise ValueError("NaN and Infinity are not allowed: %s" % name)


class Handler(BaseHTTPRequestHandler):
    home = "."
    allowed_hosts: set[str] = set()
    server_version = "TraderDashboard/1.0"

    def log_message(self, fmt: str, *args) -> None:
        log.info("%s %s", self.address_string(), fmt % args)

    # ---- responses ---------------------------------------------------------
    def _send(self, status: int, body: bytes, ctype: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; style-src 'self' https://fonts.googleapis.com; "
                         "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; "
                         "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, data=None, error: str | None = None) -> None:
        payload = {"success": error is None, "data": data, "error": error}
        self._send(status, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")

    # ---- guards ------------------------------------------------------------
    def _host_ok(self) -> bool:
        # Blocks DNS-rebinding: only our own host:port may talk to the API.
        return self.headers.get("Host", "") in self.allowed_hosts

    def _write_ok(self) -> bool:
        if self.headers.get(CSRF_HEADER) != "1":
            return False
        origin = self.headers.get("Origin")
        return origin is None or urlparse(origin).netloc in self.allowed_hosts

    def _read_raw(self) -> bytes | None:
        """Read the whole body up front, so a rejected request is still answered
        cleanly (an unread body makes Windows reset the connection)."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if length < 0 or length > MAX_BODY:
            return None
        return self.rfile.read(length) if length else b"{}"

    def _body(self):
        raw = self._raw
        if raw is None:
            self.close_connection = True
            raise actions.ValidationError("request body missing or too large (max 256 KB)")
        try:
            return json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            raise actions.ValidationError("body must be JSON") from None

    # ---- routes ------------------------------------------------------------
    def do_GET(self) -> None:
        if not self._host_ok():
            return self._json(HTTPStatus.FORBIDDEN, error="host not allowed")
        path = urlparse(self.path).path
        if path in STATIC:
            name, ctype = STATIC[path]
            with open(os.path.join(HERE, "static", name), "rb") as f:
                return self._send(HTTPStatus.OK, f.read(), ctype)
        if path == "/api/health":
            return self._json(HTTPStatus.OK, {"status": "ok"})
        if path == "/api/state":
            return self._guard(lambda: read_state(self.home))
        if path.startswith("/api/files/"):
            return self._guard(lambda: store.read(self.home, path[len("/api/files/"):]))
        self._json(HTTPStatus.NOT_FOUND, error="not found")

    do_HEAD = do_GET

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if not path.startswith("/api/run/"):
            self._read_raw()
            return self._json(HTTPStatus.NOT_FOUND, error="not found")
        name = path[len("/api/run/"):]

        def go():
            params = self._body()
            actions.build(name, params)  # validate before taking the lock
            if name in READ_ONLY:
                return actions.run(name, params, self.home)
            # Slow network actions get their own lock so a long SEC or news
            # fetch does not block saving settings or sizing orders.
            with slow_locks[name] if name in actions.SLOW else write_lock:
                return actions.run(name, params, self.home)
        self._mutating(go)

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        if not path.startswith("/api/files/"):
            self._read_raw()
            return self._json(HTTPStatus.NOT_FOUND, error="not found")
        key = path[len("/api/files/"):]

        def go():
            doc = self._body()
            with write_lock:
                return store.write(self.home, key, doc)
        self._mutating(go)

    def _mutating(self, fn) -> None:
        self._raw = self._read_raw()
        if not self._host_ok() or not self._write_ok():
            return self._json(HTTPStatus.FORBIDDEN, error="request blocked: missing dashboard header or wrong origin")
        self._guard(fn)

    def _guard(self, fn) -> None:
        try:
            self._json(HTTPStatus.OK, fn())
        except actions.ValidationError as exc:
            self._json(HTTPStatus.BAD_REQUEST, error=str(exc))
        except json.JSONDecodeError as exc:
            log.warning("bad JSON in a trader file: %s", exc)
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, error="a trader file holds invalid JSON: %s" % exc)
        except Exception:  # noqa: BLE001 - last line of defence, details stay in the log
            log.exception("request failed: %s %s", self.command, self.path)
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, error="internal error, see the server log")


def make_server(home: str, port: int) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (Handler,), {})
    handler.home = os.path.abspath(home)
    os.makedirs(os.path.join(handler.home, "trader"), exist_ok=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    real = httpd.server_address[1]
    handler.allowed_hosts = {"127.0.0.1:%d" % real, "localhost:%d" % real}
    return httpd


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=int(os.environ.get("TRADER_PORT", 8765)))
    ap.add_argument("--home", default=os.environ.get("TRADER_HOME", os.path.dirname(HERE)),
                    help="folder that holds trader/ (default: the parent of this folder)")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not os.path.isdir(actions.SKILLS):
        raise SystemExit("trader skills not found at %s (set TRADER_SKILLS)" % actions.SKILLS)
    httpd = make_server(a.home, a.port)
    log.info("Trader dashboard on http://127.0.0.1:%d  (home %s)", httpd.server_address[1], a.home)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
