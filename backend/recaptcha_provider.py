"""
Smart reCAPTCHA Enterprise Provider for Google Flow (flow.google.com / labs.google).
Connects to Chrome CDP, targets active Flow project tabs, and executes grecaptcha.enterprise.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import urllib.request
import websocket

logger = logging.getLogger("flow_recaptcha")

RECAPTCHA_SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV"


class SmartRecaptchaProvider:
    """Provides genuine reCAPTCHA Enterprise tokens via Chrome CDP by targeting
    an active Flow project page on flow.google.com or labs.google.
    """

    def __init__(self, cookies: str = "", debug: bool = True):
        self.cookies = cookies
        self.debug = debug
        self._lock = threading.Lock()
        self._port: int | None = None
        self._ws_url: str | None = None
        self._ws: websocket.WebSocket | None = None
        self._msg_id: int = 0

    def get_token(self, action: str = "IMAGE_GENERATION") -> str:
        with self._lock:
            return self._get_token_internal(action)

    def _get_token_internal(self, action: str) -> str:
        from gflow.auth.browser_auth import get_saved_cdp_port

        self._port = get_saved_cdp_port()
        if not self._port:
            raise RuntimeError(
                "No Chrome CDP port found. Please make sure Chrome is running or run 'gflow auth'."
            )

        ws_url = self._resolve_or_navigate_project_tab(self._port)
        if not ws_url:
            raise RuntimeError("Could not find or open a Google Flow project tab in Chrome.")

        # Connect websocket
        self._ensure_ws(ws_url)

        # Ensure grecaptcha is ready
        self._wait_for_grecaptcha(timeout=15)

        # Execute
        token = self._eval(
            f"grecaptcha.enterprise.execute('{RECAPTCHA_SITE_KEY}', {{action: '{action}'}})"
        )

        if not token or not isinstance(token, str) or len(token) < 100:
            raise RuntimeError(f"reCAPTCHA returned invalid token: {token}")

        logger.info(f"Generated fresh reCAPTCHA token ({len(token)} chars) for action: {action}")
        return token

    def _ensure_ws(self, ws_url: str):
        if self._ws and self._ws.connected and self._ws_url == ws_url:
            return
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass
        self._ws = websocket.create_connection(ws_url, timeout=10)
        self._ws_url = ws_url

    def _eval(self, expression: str):
        self._msg_id += 1
        msg = {
            "id": self._msg_id,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expression,
                "awaitPromise": True,
                "returnByValue": True,
            },
        }
        self._ws.send(json.dumps(msg))

        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                raw = self._ws.recv()
                data = json.loads(raw)
                if data.get("id") == self._msg_id:
                    res = data.get("result", {})
                    if "exceptionDetails" in res:
                        desc = res["exceptionDetails"].get("text", "Script error")
                        raise RuntimeError(f"CDP Evaluation error: {desc}")
                    return res.get("result", {}).get("value")
            except Exception as e:
                if "timed out" in str(e).lower():
                    continue
                raise
        raise TimeoutError("CDP evaluation timed out")

    def _wait_for_grecaptcha(self, timeout: int = 15):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                ready = self._eval(
                    "typeof grecaptcha !== 'undefined' && "
                    "typeof grecaptcha.enterprise !== 'undefined' && "
                    "typeof grecaptcha.enterprise.execute === 'function'"
                )
                if ready:
                    return
            except Exception:
                pass
            time.sleep(0.5)
        raise TimeoutError("Timed out waiting for grecaptcha.enterprise on Flow project page")

    def _resolve_or_navigate_project_tab(self, port: int) -> str | None:
        """Find a tab that is inside a project, or find any flow.google.com tab and navigate into a project."""
        url = f"http://127.0.0.1:{port}/json"
        resp = urllib.request.urlopen(url, timeout=5)
        targets = json.loads(resp.read().decode())

        page_tabs = [t for t in targets if t.get("type") == "page"]
        if not page_tabs:
            return None

        # 1. Look for a tab already on a project page
        for t in page_tabs:
            page_url = t.get("url", "")
            if "flow.google.com/project/" in page_url or "labs.google/fx/tools/flow/project/" in page_url:
                return t.get("webSocketDebuggerUrl")

        # 2. Look for any flow.google.com tab and find a project link
        flow_tab = next((t for t in page_tabs if "flow.google.com" in t.get("url", "")), page_tabs[0])
        ws_url = flow_tab.get("webSocketDebuggerUrl")
        temp_ws = websocket.create_connection(ws_url, timeout=5)

        try:
            # Query DOM for any project link
            self._msg_id += 1
            temp_ws.send(json.dumps({
                "id": self._msg_id,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": "Array.from(document.querySelectorAll('a')).map(a => a.href).find(h => h.includes('/project/'))",
                    "returnByValue": True,
                },
            }))
            res = json.loads(temp_ws.recv())
            project_href = res.get("result", {}).get("result", {}).get("value")

            if not project_href:
                # Cannot invent a project UUID — caller must navigate to a real project tab
                logger.warning("No project link found on Flow landing page; cannot navigate for reCAPTCHA")
                return None

            logger.info(f"Navigating Chrome tab to project: {project_href}")
            self._msg_id += 1
            temp_ws.send(json.dumps({
                "id": self._msg_id,
                "method": "Page.navigate",
                "params": {"url": project_href},
            }))
            temp_ws.recv()
            time.sleep(3)
            return ws_url
        finally:
            temp_ws.close()

    def close(self):
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass
            self._ws = None
