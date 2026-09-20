"""Resolve optional HTTP(S) egress proxy for Google outbound calls.

Per-provider-account assignments live in data/egress-proxy.json → assignments
(same file BiB uses). When account_id is known, API traffic uses that proxy so
Chrome (BiB) and Python share the same exit IP.

Dead residential nodes are healed by rotate_account_proxy() — sticky reassignment
to the next unique pool proxy (mirrors BiB rotateAccountProxy). Does NOT wipe
cookies or mark the account logged out.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

logger = logging.getLogger("egress_proxy")

_ROOT = Path(__file__).resolve().parent.parent
_MIRROR = _ROOT / "data" / "egress-proxy.json"
# Cache key "" = global/first; otherwise provider account id
_cache: Dict[str, Any] = {"by_account": {}, "global": None, "at": 0.0}
_assign_lock = threading.Lock()

# Transport / tunnel failures that mean the sticky proxy is dead — not logout.
_PROXY_ERR_MARKERS = (
    "ProxyError",
    "ConnectTimeout",
    "ReadTimeout",
    "ConnectionError",
    "ConnectionReset",
    "RemoteDisconnected",
    "Tunnel connection failed",
    "Unable to connect to proxy",
    "Max retries exceeded",
    "SOCKSHTTPSConnectionPool",
    "HTTPSConnectionPool",
    "NewConnectionError",
    "ProxyError(",
    "407",
    "ERR_TUNNEL",
    "ECONNREFUSED",
    "ECONNRESET",
    "timed out",
)


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


def _write_mirror_raw(data: Dict[str, Any]) -> None:
    try:
        _MIRROR.parent.mkdir(parents=True, exist_ok=True)
        tmp = _MIRROR.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(_MIRROR)
    except Exception as e:
        logger.warning("egress-proxy write mirror failed: %s", e)


def _enabled_proxies(data: Dict[str, Any]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
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


def _normalize_cycle_used(raw: Any, enabled: List[Dict[str, str]]) -> List[str]:
    enabled_ids = {p["id"] for p in enabled}
    out: List[str] = []
    if isinstance(raw, list):
        for pid in raw:
            if isinstance(pid, str) and pid in enabled_ids and pid not in out:
                out.append(pid)
    return out


def _pick_next_pool_proxy(
    enabled: List[Dict[str, str]],
    assignments: Dict[str, str],
    cycle_used_in: List[str],
    account_id: str,
    *,
    force_new: bool = False,
    start_after_id: Optional[str] = None,
) -> Tuple[Optional[Dict[str, str]], List[str]]:
    """Next proxy not held by another account and not yet used this cycle."""
    if not enabled:
        return None, []

    held_by_others = {
        pid
        for acc, pid in assignments.items()
        if acc != account_id and isinstance(pid, str)
    }
    cycle = set(_normalize_cycle_used(cycle_used_in, enabled))

    def reset_cycle() -> None:
        nonlocal cycle
        cycle = set(held_by_others)
        if force_new and start_after_id:
            cycle.add(start_after_id)

    def try_pick() -> Optional[Dict[str, str]]:
        start_idx = -1
        if start_after_id:
            for i, p in enumerate(enabled):
                if p["id"] == start_after_id:
                    start_idx = i
                    break
        for i in range(1, len(enabled) + 1):
            cand = enabled[(start_idx + i + len(enabled)) % len(enabled)]
            if force_new and cand["id"] == start_after_id:
                continue
            if cand["id"] in held_by_others:
                continue
            if cand["id"] in cycle:
                continue
            return cand
        return None

    if enabled and all(p["id"] in cycle for p in enabled):
        reset_cycle()

    pick = try_pick()
    if not pick:
        reset_cycle()
        pick = try_pick()
    if not pick:
        counts = {p["id"]: 0 for p in enabled}
        for pid in held_by_others:
            if pid in counts:
                counts[pid] = counts.get(pid, 0) + 1
        candidates = [p for p in enabled if not force_new or p["id"] != start_after_id]
        candidates.sort(key=lambda p: counts.get(p["id"], 0))
        pick = candidates[0] if candidates else None

    next_cycle = list(cycle)
    if pick and pick["id"] not in next_cycle:
        next_cycle.append(pick["id"])
    return pick, next_cycle


def clear_egress_proxy_cache() -> None:
    _cache["by_account"] = {}
    _cache["global"] = None
    _cache["at"] = 0.0


def rotate_account_proxy(account_id: Optional[str]) -> Optional[str]:
    """Force sticky reassignment to the next unique pool proxy. Keeps login cookies."""
    if not account_id:
        return None
    with _assign_lock:
        raw = _load_mirror_raw() or {"proxies": [], "assignments": {}, "cycleUsed": []}
        enabled = _enabled_proxies(raw)
        if not enabled:
            return None

        assignments = (
            dict(raw["assignments"])
            if isinstance(raw.get("assignments"), dict)
            else {}
        )
        cycle_used = _normalize_cycle_used(raw.get("cycleUsed"), enabled)
        if not cycle_used:
            for pid in assignments.values():
                if (
                    isinstance(pid, str)
                    and any(p["id"] == pid for p in enabled)
                    and pid not in cycle_used
                ):
                    cycle_used.append(pid)

        existing_id = assignments.get(account_id) if isinstance(assignments.get(account_id), str) else None
        pick, next_cycle = _pick_next_pool_proxy(
            enabled,
            assignments,
            cycle_used,
            account_id,
            force_new=True,
            start_after_id=existing_id,
        )
        if not pick:
            return None

        assignments[account_id] = pick["id"]
        proxies = raw.get("proxies") if isinstance(raw.get("proxies"), list) else enabled
        out = {
            "url": _active_from_mirror({"proxies": enabled}),
            "proxies": proxies,
            "assignments": assignments,
            "cycleUsed": next_cycle,
        }
        # Preserve unrelated keys (dataimpulse meta, etc.)
        for k, v in raw.items():
            if k not in out:
                out[k] = v
        _write_mirror_raw(out)
        clear_egress_proxy_cache()
        logger.warning(
            "egress-proxy rotated account %s… → proxy %s (was %s)",
            account_id[:8],
            pick["id"],
            existing_id or "none",
        )
        return pick["url"]


def is_proxy_transport_error(exc: Any) -> bool:
    """True when the failure looks like a dead tunnel / bad exit — not auth logout."""
    text = f"{type(exc).__name__}: {exc}" if exc is not None else ""
    return any(m.lower() in text.lower() for m in _PROXY_ERR_MARKERS)


def probe_proxy_exit_ip(account_id: Optional[str] = None, timeout: float = 8.0) -> Optional[str]:
    """Quick exit-IP probe through the assigned proxy. None = tunnel looks dead."""
    import requests

    proxies = requests_proxies(account_id=account_id)
    if not proxies:
        return None
    try:
        resp = requests.get(
            "https://api.ipify.org?format=json",
            proxies=proxies,
            timeout=timeout,
        )
        if resp.status_code == 200:
            data = resp.json()
            ip = str(data.get("ip") or "").strip()
            return ip or None
    except Exception as e:
        logger.info("egress proxy exit probe failed: %s", e)
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
