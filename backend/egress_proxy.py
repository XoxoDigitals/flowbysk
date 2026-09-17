"""Resolve optional HTTP(S) egress proxy for Google outbound calls.

Per-provider-account assignments live in data/egress-proxy.json → assignments
(same file BiB uses). When account_id is known, API traffic uses that proxy so
Chrome (BiB) and Python share the same exit IP.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse

logger = logging.getLogger("egress_proxy")

_ROOT = Path(__file__).resolve().parent.parent
_MIRROR = _ROOT / "data" / "egress-proxy.json"
# Cache key "" = global/first; otherwise provider account id
_cache: Dict[str, Any] = {"by_account": {}, "global": None, "at": 0.0}


def _normalize(url: Optional[str]) -> Optional[str]:
    text = (url or "").strip()
    if not text:
        return None
    # host:port:user:pass
    if "://" not in text and "@" not in text:
        parts = text.split(":")
        if len(parts) >= 4:
            password = parts[-1]
            username = parts[-2]
            port = parts[-3]
            host = ":".join(parts[:-3])
            if host and port.isdigit() and username:
                from urllib.parse import quote

                text = f"http://{quote(username, safe='')}:{quote(password, safe='')}@{host}:{port}"
    if "://" not in text:
        text = f"http://{text}"
    try:
        parsed = urlparse(text)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return None
        return text
    except Exception:
        return None


def _load_mirror_raw() -> Dict[str, Any]:
    try:
        if not _MIRROR.is_file():
            return {}
        data = json.loads(_MIRROR.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _enabled_proxies(data: Dict[str, Any]) -> list:
    out = []
    proxies = data.get("proxies")
    if isinstance(proxies, list):
        for item in proxies:
            if not isinstance(item, dict):
                continue
            if item.get("enabled") is False:
                continue
            url = _normalize(str(item.get("url") or ""))
            if not url:
                continue
            pid = str(item.get("id") or "") or f"p{len(out)}"
            out.append({"id": pid, "url": url})
    if not out:
        url = _normalize(str(data.get("url") or "") or None)
        if url:
            out.append({"id": "legacy", "url": url})
    return out


def _active_from_mirror(data: Any) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    enabled = _enabled_proxies(data)
    return enabled[0]["url"] if enabled else None


def _url_for_account(data: Dict[str, Any], account_id: Optional[str]) -> Optional[str]:
    enabled = _enabled_proxies(data)
    if not enabled:
        return None
    if not account_id:
        return enabled[0]["url"]
    assignments = data.get("assignments") if isinstance(data.get("assignments"), dict) else {}
    pid = assignments.get(account_id)
    if isinstance(pid, str) and pid:
        for p in enabled:
            if p["id"] == pid:
                return p["url"]
    # No sticky assignment for this account — do not steal another account's proxy.
    return None


def resolve_egress_proxy_url(
    force: bool = False, account_id: Optional[str] = None
) -> Optional[str]:
    """Env EGRESS_PROXY_URL, then per-account assignment, then first enabled. Cached 30s."""
    now = time.time()
    key = str(account_id or "")
    by_acc: Dict[str, Any] = _cache.get("by_account") or {}
    if not force and now - float(_cache.get("at") or 0) < 30:
        if key:
            if key in by_acc:
                return by_acc.get(key)
        elif _cache.get("global") is not None or "global" in _cache:
            return _cache.get("global")

    url = _normalize(os.environ.get("EGRESS_PROXY_URL"))
    if not url:
        data = _load_mirror_raw()
        url = _url_for_account(data, account_id)

    if key:
        by_acc[key] = url
        _cache["by_account"] = by_acc
    else:
        _cache["global"] = url
    _cache["at"] = now
    return url


def requests_proxies(account_id: Optional[str] = None) -> Optional[Dict[str, str]]:
    url = resolve_egress_proxy_url(account_id=account_id)
    if not url:
        return None
    return {"http": url, "https": url}


def is_loopback_url(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
        return host in ("127.0.0.1", "localhost", "::1")
    except Exception:
        return False


def apply_proxies_kwargs(
    url: str, kwargs: Dict[str, Any], account_id: Optional[str] = None
) -> Dict[str, Any]:
    """Merge proxies into requests kwargs unless targeting loopback or already set."""
    if "proxies" in kwargs or is_loopback_url(url):
        return kwargs
    proxies = requests_proxies(account_id=account_id)
    if proxies:
        kwargs = dict(kwargs)
        kwargs["proxies"] = proxies
    return kwargs


def sync_egress_proxy_env(account_id: Optional[str] = None) -> Optional[str]:
    """
    Sync process env so requests trust_env picks up the proxy.
    Prefer per-request apply_proxies_kwargs(account_id=...) for multi-account.
    Keeps localhost out of proxy via NO_PROXY.
    """
    url = resolve_egress_proxy_url(force=True, account_id=account_id)
    no_proxy = os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or ""
    extras = ["127.0.0.1", "localhost", "::1"]
    parts = [p.strip() for p in no_proxy.split(",") if p.strip()]
    for e in extras:
        if e not in parts:
            parts.append(e)
    os.environ["NO_PROXY"] = ",".join(parts)
    os.environ["no_proxy"] = os.environ["NO_PROXY"]

    if url:
        os.environ["HTTP_PROXY"] = url
        os.environ["HTTPS_PROXY"] = url
        os.environ["http_proxy"] = url
        os.environ["https_proxy"] = url
        logger.info(
            "Egress proxy enabled for outbound Google HTTP%s",
            f" (account {account_id[:8]}…)" if account_id else "",
        )
    else:
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            os.environ.pop(key, None)
    return url
