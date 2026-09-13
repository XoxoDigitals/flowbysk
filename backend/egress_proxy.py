"""Resolve optional HTTP(S) egress proxy for Google outbound calls."""

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
_cache: Dict[str, Any] = {"url": None, "at": 0.0}


def _normalize(url: Optional[str]) -> Optional[str]:
    text = (url or "").strip()
    if not text:
        return None
    if "://" not in text:
        text = f"http://{text}"
    try:
        parsed = urlparse(text)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return None
        return text
    except Exception:
        return None


def _active_from_mirror(data: Any) -> Optional[str]:
    if not isinstance(data, dict):
        return None
    proxies = data.get("proxies")
    if isinstance(proxies, list):
        for item in proxies:
            if not isinstance(item, dict):
                continue
            if item.get("enabled") is False:
                continue
            url = _normalize(str(item.get("url") or ""))
            if url:
                return url
    return _normalize(str(data.get("url") or "") or None)


def _read_mirror() -> Optional[str]:
    try:
        if not _MIRROR.is_file():
            return None
        data = json.loads(_MIRROR.read_text(encoding="utf-8"))
        return _active_from_mirror(data)
    except Exception:
        return None


def resolve_egress_proxy_url(force: bool = False) -> Optional[str]:
    """Env EGRESS_PROXY_URL, then data/egress-proxy.json. Cached 30s."""
    now = time.time()
    if not force and now - float(_cache.get("at") or 0) < 30:
        return _cache.get("url")  # type: ignore[return-value]

    url = _normalize(os.environ.get("EGRESS_PROXY_URL"))
    if not url:
        url = _read_mirror()

    _cache["url"] = url
    _cache["at"] = now
    return url


def requests_proxies() -> Optional[Dict[str, str]]:
    url = resolve_egress_proxy_url()
    if not url:
        return None
    return {"http": url, "https": url}


def is_loopback_url(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
        return host in ("127.0.0.1", "localhost", "::1")
    except Exception:
        return False


def apply_proxies_kwargs(url: str, kwargs: Dict[str, Any]) -> Dict[str, Any]:
    """Merge proxies into requests kwargs unless targeting loopback or already set."""
    if "proxies" in kwargs or is_loopback_url(url):
        return kwargs
    proxies = requests_proxies()
    if proxies:
        kwargs = dict(kwargs)
        kwargs["proxies"] = proxies
    return kwargs


def sync_egress_proxy_env() -> Optional[str]:
    """
    Sync process env so requests trust_env picks up the proxy.
    Keeps localhost out of proxy via NO_PROXY.
    """
    url = resolve_egress_proxy_url(force=True)
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
        logger.info("Egress proxy enabled for outbound Google HTTP")
    else:
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            os.environ.pop(key, None)
    return url
