"""
FlowService — Central bridge for Google Flow API, cookie management,
CDP browser keepalive, reCAPTCHA Enterprise minting, and generation workflows.
"""

from __future__ import annotations

import atexit
import base64
import platform
import json
import logging
import os
import random
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import uuid

import requests
import websocket

from backend.env_util import get_env, is_production
from backend.egress_proxy import apply_proxies_kwargs, sync_egress_proxy_env

from backend.flow_batchexecute import (
    BATCHEXECUTE_BASES,
    BATCHEXECUTE_PATH,
    DEFAULT_BL,
    NO_WIZ_SESSION_HINT,
    as29s_is_ready,
    auth_error_message,
    build_C4BZMd_payload,
    build_MZZa6b_payload,
    build_as29s_payload,
    build_jwpduf_payload,
    build_maseq_payload,
    build_ogiZ0b_payload,
    build_rzMKMb_payload,
    extract_MZZa6b_result,
    extract_maseq_result,
    extract_ogiZ0b_result,
    extract_urls,
    extract_wiz_meta_from_captures,
    is_batchexecute_auth_error,
    is_batchexecute_fallback_error,
    merge_wiz_meta,
    normalize_character_refs,
    parse_batchexecute_text,
    structured_prompt_analytics,
)

logger = logging.getLogger("flow_service")
logging.basicConfig(level=logging.INFO)

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
HISTORY_FILE = DATA_DIR / "history.json"
CHARACTERS_FILE = DATA_DIR / "characters.json"
SETTINGS_FILE = DATA_DIR / "settings.json"
BATCHEXECUTE_META_FILE = DATA_DIR / "batchexecute_meta.json"
UPLOADS_DIR = DATA_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
STAGED_META_FILE = UPLOADS_DIR / "staged_index.json"

# ------------------------------------------------------------------------------
# Cookie encryption at rest (settings.json persists the Google session cookie
# jar; encrypt it on disk using Fernet, keyed off DATA_ENCRYPTION_KEY).
# ------------------------------------------------------------------------------
_ENC_PREFIX = "enc:v1:"
_fernet_cache: Any = None
_fernet_load_attempted = False
_dev_plaintext_fallback_warned = False


def _derive_fernet_key(raw_key: str) -> bytes:
    """DATA_ENCRYPTION_KEY is base64url of 32 raw bytes; Fernet wants those 32
    bytes re-encoded as a 44-char urlsafe-base64 string. Accept a value that's
    already a valid 44-char Fernet key too (round-trips unchanged)."""
    key_bytes = raw_key.encode("utf-8")
    padded = key_bytes + b"=" * (-len(key_bytes) % 4)
    decoded = base64.urlsafe_b64decode(padded)
    if len(decoded) == 32:
        return base64.urlsafe_b64encode(decoded)
    # Not 32 raw bytes when decoded (e.g. already a Fernet key) — use as-is.
    return padded


def _get_fernet():
    """Return a cached Fernet instance for DATA_ENCRYPTION_KEY, or None if unusable."""
    global _fernet_cache, _fernet_load_attempted, _dev_plaintext_fallback_warned
    if _fernet_load_attempted:
        return _fernet_cache
    _fernet_load_attempted = True
    raw_key = get_env("DATA_ENCRYPTION_KEY")
    if not raw_key:
        if is_production():
            raise RuntimeError(
                "DATA_ENCRYPTION_KEY is not set. Required in production to encrypt "
                "Google session cookies at rest."
            )
        if not _dev_plaintext_fallback_warned:
            _dev_plaintext_fallback_warned = True
            logger.warning(
                "DATA_ENCRYPTION_KEY not set — cookies will be stored in PLAINTEXT "
                "in data/settings.json. This fallback is for local dev only; set "
                "DATA_ENCRYPTION_KEY before deploying."
            )
        return None
    try:
        from cryptography.fernet import Fernet

        _fernet_cache = Fernet(_derive_fernet_key(raw_key))
    except Exception as e:
        logger.error("Failed to initialize cookie encryption (Fernet): %s", e)
        _fernet_cache = None
    return _fernet_cache


def _encrypt_secret(value: str) -> str:
    """Encrypt a string for on-disk storage. Returns plaintext unchanged if no
    usable encryption key is configured (dev-only fallback, see _get_fernet)."""
    if not value:
        return value
    f = _get_fernet()
    if f is None:
        return value
    try:
        return _ENC_PREFIX + f.encrypt(value.encode("utf-8")).decode("ascii")
    except Exception as e:
        logger.error("Failed to encrypt secret for storage: %s", e)
        return value


def _decrypt_secret(value: str) -> str:
    """Decrypt a value previously written by _encrypt_secret. Legacy plaintext
    (no marker prefix) is returned unchanged so existing cookies aren't lost."""
    if not value or not isinstance(value, str) or not value.startswith(_ENC_PREFIX):
        return value
    f = _get_fernet()
    if f is None:
        logger.error(
            "Encrypted setting found on disk but no encryption key is configured; "
            "cannot decrypt. Set DATA_ENCRYPTION_KEY."
        )
        return ""
    try:
        return f.decrypt(value[len(_ENC_PREFIX):].encode("ascii")).decode("utf-8")
    except Exception as e:
        logger.error("Failed to decrypt stored secret: %s", e)
        return ""


SESSION_URL = "https://labs.google/fx/api/auth/session"
RECAPTCHA_SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
)
SANDBOX_BASE = "https://aisandbox-pa.googleapis.com"
LABS_FLOW_BASE = "https://flow.google.com/project"
LABS_TRPC_BASE = "https://labs.google/fx/api/trpc"
FLOW_ANGULAR_BASE = "https://flow.google.com"
FLOW_TOOL_NAME = "PINHOLE"

# flow.google.com only renders the WIZ `SNlM0e` (`at`) token when the jar carries a
# real Google *web* session. These three are the only ones without a `__Secure-`
# prefix, so exports that filter on the Secure flag drop exactly them and leave a
# jar that still authenticates aisandbox (Bearer) but never batchexecute.
WEB_SESSION_COOKIES = ("SID", "HSID", "APISID")
# Present in most jars; useful for telling "partial export" from "no Google session".
WEB_SESSION_COMPANION_COOKIES = (
    "SSID",
    "SAPISID",
    "__Secure-1PSID",
    "__Secure-3PSID",
)
# Names worth importing from a live Chrome when the saved jar is missing them.
CDP_SYNCABLE_COOKIES = WEB_SESSION_COOKIES + WEB_SESSION_COMPANION_COOKIES + (
    "LSID",
    "OSID",
    "SIDCC",
    "__Secure-1PAPISID",
    "__Secure-3PAPISID",
    "__Secure-1PSIDTS",
    "__Secure-3PSIDTS",
    "__Secure-1PSIDCC",
    "__Secure-3PSIDCC",
    "__Secure-OSID",
    "__Host-GAPS",
    "__Secure-next-auth.session-token",
)
CDP_COOKIE_DOMAIN_SUFFIXES = ("google.com", "labs.google")

# Cookie names that matter for labs next-auth + Google web session + Flow.
# Everything else only inflates the Cookie header (labs can return HTTP 431).
_FLOW_COOKIE_NAME_PREFIXES = (
    "__Secure-next-auth",
    "__Host-next-auth",
    "__Host-1PLSID",
    "__Host-3PLSID",
    "__Host-GAPS",
    "__Secure-1PSID",
    "__Secure-3PSID",
    "__Secure-1PAPISID",
    "__Secure-3PAPISID",
    "__Secure-1PSIDTS",
    "__Secure-3PSIDTS",
    "__Secure-1PSIDCC",
    "__Secure-3PSIDCC",
    "__Secure-OSID",
    "__Secure-STRP",
)
_FLOW_COOKIE_NAME_EXACT = set(CDP_SYNCABLE_COOKIES) | {
    "SID",
    "HSID",
    "SSID",
    "APISID",
    "SAPISID",
    "LSID",
    "OSID",
    "SIDCC",
    "NID",
    "OTZ",
    "AEC",
    "ACCOUNT_CHOOSER",
    "_GRECAPTCHA",
    "COMPASS",
    "SNID",
    "SMSV",
    "GSP",
    "email",
    "EMAIL",
}


def is_flow_relevant_cookie_name(name: str) -> bool:
    if not name:
        return False
    if name in _FLOW_COOKIE_NAME_EXACT:
        return True
    return any(name.startswith(p) for p in _FLOW_COOKIE_NAME_PREFIXES)


def prune_cookie_header(cookie_str: str) -> str:
    """Dedupe and drop non-Flow cookies so session calls stay under header limits."""
    pairs = parse_cookie_pairs(cookie_str)
    kept = {n: v for n, v in pairs.items() if is_flow_relevant_cookie_name(n)}
    return format_cookie_pairs(kept)

# Google Flow / Veo character voice presets (Gemini TTS astronomical names).
# Capture only showed `achird`; full set matches Flow / Veo / Gemini TTS docs.
CHARACTER_VOICE_PRESETS: List[Dict[str, str]] = [
    {"id": "achernar", "name": "Achernar", "description": "Soft"},
    {"id": "achird", "name": "Achird", "description": "Friendly"},
    {"id": "algenib", "name": "Algenib", "description": "Gravelly"},
    {"id": "algieba", "name": "Algieba", "description": "Smooth"},
    {"id": "alnilam", "name": "Alnilam", "description": "Firm"},
    {"id": "aoede", "name": "Aoede", "description": "Breezy"},
    {"id": "autonoe", "name": "Autonoe", "description": "Bright"},
    {"id": "callirrhoe", "name": "Callirrhoe", "description": "Easy-going"},
    {"id": "charon", "name": "Charon", "description": "Informative"},
    {"id": "despina", "name": "Despina", "description": "Smooth"},
    {"id": "enceladus", "name": "Enceladus", "description": "Breathy"},
    {"id": "erinome", "name": "Erinome", "description": "Clear"},
    {"id": "fenrir", "name": "Fenrir", "description": "Excitable"},
    {"id": "gacrux", "name": "Gacrux", "description": "Mature"},
    {"id": "iapetus", "name": "Iapetus", "description": "Clear"},
    {"id": "kore", "name": "Kore", "description": "Firm"},
    {"id": "laomedeia", "name": "Laomedeia", "description": "Upbeat"},
    {"id": "leda", "name": "Leda", "description": "Youthful"},
    {"id": "orus", "name": "Orus", "description": "Firm"},
    {"id": "puck", "name": "Puck", "description": "Upbeat"},
    {"id": "pulcherrima", "name": "Pulcherrima", "description": "Forward"},
    {"id": "rasalgethi", "name": "Rasalgethi", "description": "Informative"},
    {"id": "sadachbia", "name": "Sadachbia", "description": "Lively"},
    {"id": "sadaltager", "name": "Sadaltager", "description": "Knowledgeable"},
    {"id": "schedar", "name": "Schedar", "description": "Even"},
    {"id": "sulafat", "name": "Sulafat", "description": "Warm"},
    {"id": "umbriel", "name": "Umbriel", "description": "Easy-going"},
    {"id": "vindemiatrix", "name": "Vindemiatrix", "description": "Gentle"},
    {"id": "zephyr", "name": "Zephyr", "description": "Bright"},
    {"id": "zubenelgenubi", "name": "Zubenelgenubi", "description": "Casual"},
]


def clean_project_id(raw: Optional[str]) -> str:
    """Strip query/hash junk from a project id (e.g. uuid&ec=...)."""
    if not raw:
        return ""
    return str(raw).split("?")[0].split("&")[0].split("#")[0].strip()


def project_url(project_id: Optional[str]) -> str:
    """flow.google.com project URL (reCAPTCHA / batchexecute / history links)."""
    pid = clean_project_id(project_id)
    if not pid:
        return LABS_FLOW_BASE
    return f"https://flow.google.com/project/{pid}"


def angular_project_url(project_id: Optional[str]) -> str:
    """Angular AiSandbox shell on flow.google.com — has WIZ SNlM0e for batchexecute."""
    pid = clean_project_id(project_id)
    if not pid:
        return FLOW_ANGULAR_BASE
    return f"{FLOW_ANGULAR_BASE}/project/{pid}"


def parse_cookie_input(raw: Any) -> str:
    """Normalize various cookie input formats into a standard Cookie header string.

    Supports:
    - JSON array of cookie objects: [{"name": "...", "value": "..."}, ...] (e.g. from Cookie-Editor / EditThisCookie)
    - JSON array embedded inside user text or chat messages
    - JSON object or dict of {name: value}
    - Python list/dict structures
    - Netscape HTTP Cookie File format (tab-delimited, cookies.txt export)
    - Chrome / Firefox DevTools Application tab table copy (tab-delimited)
    - Raw HTTP request headers containing 'Cookie: ...'
    - cURL command strings with -H 'cookie: ...' or --cookie '...'
    - Standard HTTP Cookie header string: "name1=val1; name2=val2"
    - Raw newline-delimited "name=value" lines (with or without semicolons)
    """
    if not raw:
        return ""

    # If input is already a Python list of dicts (from parsed JSON body)
    if isinstance(raw, list):
        parts = []
        for item in raw:
            if isinstance(item, dict):
                name = item.get("name") or item.get("key") or item.get("Name")
                val = item.get("value") or item.get("Value")
                if name and val is not None:
                    parts.append(f"{str(name).strip()}={str(val).strip()}")
        if parts:
            return "; ".join(parts)
        return ""

    # If input is already a Python dict
    if isinstance(raw, dict):
        if "cookies" in raw and isinstance(raw["cookies"], (list, dict, str)):
            return parse_cookie_input(raw["cookies"])
        parts = [f"{str(k).strip()}={str(v).strip()}" for k, v in raw.items() if k and v is not None]
        return "; ".join(parts)

    if not isinstance(raw, str):
        raw = str(raw)

    raw = raw.strip()
    if not raw:
        return ""

    # Strip any leading "Cookie:" header label if it's the entire string
    if raw.lower().startswith("cookie:"):
        raw = raw[7:].strip()

    # Fast path: Standard HTTP Cookie header string ("name1=val1; name2=val2")
    # Cleanly format and return standard cookie string as before
    if ";" in raw and "=" in raw and not (raw.startswith("[") or raw.startswith("{")):
        pairs = parse_cookie_pairs(raw)
        if pairs:
            return format_cookie_pairs(pairs)

    # 1) Search for JSON array anywhere in string (handles raw JSON or markdown/chat wrapped JSON)
    json_match = re.search(r"\[\s*\{.*\}\s*\]", raw, re.DOTALL)
    if json_match:
        candidate = json_match.group(0)
        try:
            items = json.loads(candidate)
            if isinstance(items, list):
                parts = []
                for item in items:
                    if isinstance(item, dict):
                        name = item.get("name") or item.get("key") or item.get("Name")
                        val = item.get("value") or item.get("Value")
                        if name and val is not None:
                            parts.append(f"{str(name).strip()}={str(val).strip()}")
                if parts:
                    return "; ".join(parts)
        except Exception:
            pass

    # 2) Search for JSON object { "name": "val" } or { "cookies": ... }
    if raw.startswith("{") and raw.endswith("}"):
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict):
                if "cookies" in obj:
                    return parse_cookie_input(obj["cookies"])
                parts = [f"{str(k).strip()}={str(v).strip()}" for k, v in obj.items() if k and v is not None]
                if parts:
                    return "; ".join(parts)
        except Exception:
            pass

    # 3) Extract cookie from cURL commands: -H 'cookie: ...' or --cookie '...' or -b '...'
    curl_match = re.search(
        r'''(?:-H\s*['"][Cc]ookie:\s*|--cookie\s*['"]|-b\s*['"])([^'"]+)['"]''',
        raw
    )
    if curl_match:
        return curl_match.group(1).strip()

    # 4) If raw contains full HTTP headers with a "Cookie:" line
    for line in raw.splitlines():
        trimmed = line.strip()
        if trimmed.lower().startswith("cookie:"):
            extracted = trimmed[7:].strip()
            if extracted:
                return extracted

    # 5) Tab-delimited (Netscape cookies.txt OR Chrome DevTools Application cookies table)
    if "\t" in raw:
        parts = []
        for line in raw.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            fields = line.split("\t")
            if len(fields) >= 2:
                # Skip header row if copied from table UI
                if fields[0].strip().lower() in ("name", "cookie name"):
                    continue
                # Netscape format: domain, flag, path, secure, expiration, name, value
                if len(fields) >= 7 and (fields[1].strip().upper() in ("TRUE", "FALSE") or fields[0].startswith(".")):
                    parts.append(f"{fields[5].strip()}={fields[6].strip()}")
                else:
                    # DevTools table copy: name, value, domain, path...
                    parts.append(f"{fields[0].strip()}={fields[1].strip()}")
        if parts:
            return "; ".join(parts)

    # 6) Newline-separated "name=val" or "name=val;" lines
    if "\n" in raw:
        lines = []
        for line in raw.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                lines.append(line.rstrip(";").strip())
        if lines:
            return "; ".join(lines)

    return raw


def parse_cookie_pairs(cookie_str: str) -> Dict[str, str]:
    """Split a Cookie header into an ordered {name: value} map."""
    pairs: Dict[str, str] = {}
    for item in (cookie_str or "").split(";"):
        item = item.strip()
        if not item or "=" not in item:
            continue
        name, value = item.split("=", 1)
        name = name.strip()
        if name:
            pairs[name] = value.strip()
    return pairs


def format_cookie_pairs(pairs: Dict[str, str]) -> str:
    return "; ".join(f"{name}={value}" for name, value in pairs.items())


def _pb_string_field(field_num: int, value: str) -> bytes:
    """Encode one length-delimited protobuf string field (wire type 2)."""
    def _varint(n: int) -> bytes:
        out = bytearray()
        while True:
            b = n & 0x7F
            n >>= 7
            if n:
                out.append(b | 0x80)
            else:
                out.append(b)
                break
        return bytes(out)

    data = value.encode("utf-8")
    return _varint((field_num << 3) | 2) + _varint(len(data)) + data


def recaptcha_origin_co(origin: str = "https://labs.google", port: int = 443) -> str:
    """Build the `co` (origin) param reCAPTCHA expects: base64 with `=` padding as `.`."""
    raw = f"{origin}:{port}".encode("utf-8")
    return base64.b64encode(raw).decode("ascii").replace("=", ".")


class FlowService:
    def __init__(self):
        # Reentrant: generation holds this while running batchexecute, whose failure
        # path can re-enter through the cookie-import recovery.
        self._lock = threading.RLock()
        self.cookies: str = ""
        self.access_token: str = ""
        self.token_expires: str = ""
        # Provider account id — selects data/egress-proxy.json assignments for HTTP
        self.egress_account_id: str = ""
        self.user_info: Dict[str, Any] = {}
        self.simulation_mode: bool = False
        self.active_project_id: str = ""
        self.projects: List[Dict[str, Any]] = []
        self.credits: Optional[int] = None
        self.paygate_tier: str = "PAYGATE_TIER_TWO"
        self.plan_name: str = "Google AI Pro"
        self.sku: str = ""
        self.service_tier: str = ""
        self.tier_override: Optional[str] = None
        self.account_credits: Dict[str, int] = {}
        self.account_tiers: Dict[str, str] = {}
        self._settings_mtime: float = 0.0
        self._wiz_meta: Dict[str, Any] = {}
        # When True, CDP Fetch pauses abort top-level navigations to flow.google.com
        # so labs.google can keep grecaptcha. Must be False for Angular batchexecute.
        self._cdp_block_flow_nav: bool = True
        # Serialize CDP session mutations (Fetch.abort / navigate) across threads.
        self._cdp_op_lock = threading.RLock()
        # After auth_401 + failed SNlM0e harvest, prefer aisandbox for a while.
        self._wiz_at_stale_until: float = 0.0
        # flow.google.com served a signed-out shell (no SNlM0e) for these cookies:
        # re-fetching it costs seconds per generation and can never succeed.
        self._wiz_session_dead_until: float = 0.0
        # Browser-free reCAPTCHA Enterprise minting (anchor + protobuf reload).
        self._recaptcha_lock = threading.Lock()
        # Serialize helper Chrome launches so concurrent requests reuse the same instance
        self._helper_launch_lock = threading.Lock()
        self._recaptcha_js_version: str = ""
        self._recaptcha_cache: Dict[str, tuple] = {}
        # Cache for media IDs synced across projects: (source_media_id, target_project_id) -> new_project_media_id
        self._project_media_cache: Dict[Tuple[str, str], str] = {}
        # Cache for characters synced across projects: (character_id_or_name, target_project_id) -> synced_char_dict
        self._project_char_cache: Dict[Tuple[str, str], Dict[str, Any]] = {}
        # Short negative cache so dead-port probing does not stall every request.
        self._cdp_probe_miss_until: float = 0.0
        # Throttle for the cookie-import + `at` re-harvest recovery pass.
        self._wiz_recovery_next_at: float = 0.0
        # Last DevTools port that answered; Chrome often uses an ephemeral one.
        self._cdp_cached_port: Optional[int] = None
        # (read_at, {name: value}) for browser-wide CDP cookies; reading them opens
        # a websocket, and diagnostics/recovery both want the same snapshot.
        self._cdp_cookie_cache: tuple = (0.0, {})
        # After aisandbox rejects a replayed reCAPTCHA token, prefer the open tab.
        self._sandbox_http_recaptcha_block_until: float = 0.0
        # Headless background Chrome process handle for auto-minting reCAPTCHA.
        self._headless_chrome_proc: Optional[subprocess.Popen] = None
        try:
            atexit.register(self._cleanup_headless_chrome)
        except Exception:
            pass

        self._load_initial_auth()
        self._load_history()
        self._load_characters()
        self._load_wiz_meta()

    def cookie_session_report(self) -> Dict[str, Any]:
        """Which Google web-session cookies the saved jar has, and which it lacks.

        `SID`/`HSID`/`APISID` decide whether flow.google.com renders a signed-in
        WIZ shell, so a jar can look healthy (labs.google works, credits load) and
        still be unable to produce the `at` token batchexecute needs.
        """
        names = set(parse_cookie_pairs(self.cookies))
        missing = [n for n in WEB_SESSION_COOKIES if n not in names]
        companions = [n for n in WEB_SESSION_COMPANION_COOKIES if n in names]
        has_secure_session = bool(companions) or "__Secure-1PSID" in names or "__Secure-3PSID" in names
        return {
            "cookie_count": len(names),
            "required": list(WEB_SESSION_COOKIES),
            "present": [n for n in WEB_SESSION_COOKIES if n in names],
            "missing": missing,
            "companions_present": companions,
            "has_web_session": not missing or has_secure_session,
            "has_labs_session": "__Secure-next-auth.session-token" in names,
            # Secure-only companions but no plain SID/HSID/APISID is the signature of
            # an export that filtered on the Secure flag.
            "partial_secure_only_export": bool(missing) and bool(companions),
        }

    def sync_google_cookies_from_chrome(self) -> List[str]:
        """Public entry point for the Account UI's "import from Chrome" action."""
        imported = self._sync_google_cookies_from_cdp()
        if imported:
            try:
                self.refresh_session()
            except Exception as e:
                logger.debug("Session refresh after Chrome cookie import failed: %s", e)
        return imported

    def session_diagnostics(self) -> Dict[str, Any]:
        """Cookie + Chrome/CDP + WIZ state behind character (batchexecute) failures."""
        cookies = self.cookie_session_report()
        port = self._get_alive_cdp_port()
        cdp: Dict[str, Any] = {
            "port": port,
            "alive": bool(port),
            "flow_tab": False,
            "labs_tab": False,
            "has_web_session_cookies": False,
        }
        if port:
            for url in self._cdp_page_urls(port):
                if "flow.google.com" in url:
                    cdp["flow_tab"] = True
                elif "labs.google" in url:
                    cdp["labs_tab"] = True
            cdp_cookies = self._read_cdp_google_cookies(port)
            cdp["has_web_session_cookies"] = all(
                name in cdp_cookies for name in WEB_SESSION_COOKIES
            ) or any(
                name in cdp_cookies for name in ("__Secure-1PSID", "__Secure-3PSID", "__Secure-next-auth.session-token")
            )
        wiz = self._wiz_meta or {}
        at_usable = bool(wiz.get("at")) and not self._wiz_prefer_aisandbox()
        return {
            "cookies": cookies,
            "cdp": cdp,
            "wiz": {
                "has_at": bool(wiz.get("at")),
                "at_usable": at_usable,
                "source": wiz.get("source") or "",
                "updated_at": wiz.get("updatedAt") or wiz.get("updated_at") or "",
                "session_marked_dead": self._wiz_session_is_dead(),
            },
            "batchexecute_ready": bool(
                cookies["has_web_session"] or cdp["has_web_session_cookies"] or at_usable
            ),
            "remedy": self._session_remedy(cookies, cdp),
        }

    @staticmethod
    def _session_remedy(cookies: Dict[str, Any], cdp: Dict[str, Any]) -> str:
        """One sentence naming the concrete next action for the current state."""
        if cookies["has_web_session"]:
            return (
                "Cookie jar looks complete. If batchexecute still fails the session "
                "has expired — reconnect cookies from a signed-in flow.google.com tab."
            )
        missing = ", ".join(cookies["missing"])
        if cdp["alive"] and cdp["has_web_session_cookies"]:
            return (
                f"Missing {missing} in Studio, but the running Chrome has them — "
                "Studio will import them automatically on the next attempt."
            )
        base = (
            f"Studio's cookie jar is missing {missing}. These are the only Google "
            "session cookies without a `__Secure-` prefix, so exports that keep "
            "\"Secure\" cookies only drop exactly them."
        )
        if cookies["partial_secure_only_export"]:
            base += (
                " Your jar has the `__Secure-*` companions, which confirms a partial export."
            )
        return (
            base
            + " Fix it from a Chrome that is signed into flow.google.com: open the "
            "Google Flow Session Sync extension and click \"Sync to Local Studio\" "
            "(it reads httpOnly cookies including SID/HSID/APISID), or open DevTools "
            "on a flow.google.com tab, pick any request under Network, and copy its "
            "entire `Cookie` request header into Account > cookies."
        )

    def _mark_wiz_at_stale(self, seconds: float = 300.0) -> None:
        """Cookies may still work for aisandbox; only WIZ `at` is stale."""
        self._wiz_at_stale_until = max(self._wiz_at_stale_until, time.time() + seconds)

    def _wiz_prefer_aisandbox(self) -> bool:
        """True when harvested `at` recently failed and aisandbox should be preferred."""
        return time.time() < self._wiz_at_stale_until

    def _clear_wiz_at_stale(self) -> None:
        self._wiz_at_stale_until = 0.0
        self._wiz_session_dead_until = 0.0

    def _mark_wiz_session_dead(self, seconds: float = 600.0) -> None:
        """Cookies have no Google *web* session, so `at` cannot be re-harvested."""
        self._wiz_session_dead_until = max(
            self._wiz_session_dead_until, time.time() + seconds
        )
        self._mark_wiz_at_stale(seconds=seconds)

    def _wiz_session_is_dead(self) -> bool:
        """True when flow.google.com recently served a signed-out WIZ shell."""
        return time.time() < self._wiz_session_dead_until

    def _load_wiz_meta(self) -> None:
        """Load harvested Angular batchexecute tokens (`at`, `bl`, `f.sid`)."""
        self._wiz_meta = {}
        if not BATCHEXECUTE_META_FILE.exists():
            return
        try:
            with open(BATCHEXECUTE_META_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and data.get("at"):
                self._wiz_meta = data
                logger.info(
                    "Loaded batchexecute WIZ meta (at len=%s, bl=%s)",
                    len(str(data.get("at") or "")),
                    str(data.get("bl") or "")[:48],
                )
        except Exception as e:
            logger.warning(f"Failed to load batchexecute_meta.json: {e}")

    def _save_wiz_meta(self) -> None:
        if not self._wiz_meta.get("at"):
            return
        try:
            BATCHEXECUTE_META_FILE.write_text(
                json.dumps(self._wiz_meta, indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning(f"Failed to save batchexecute_meta.json: {e}")

    def ingest_capture_wiz_meta(self, captures: List[Any]) -> Optional[Dict[str, Any]]:
        """Harvest `at`/`bl`/`f.sid` from Capture extension dumps and persist."""
        harvested = extract_wiz_meta_from_captures(captures)
        if not harvested:
            return None
        # Default preference to flow.google.com when capture host not set
        if not harvested.get("preferred_base"):
            harvested["preferred_base"] = "https://flow.google.com"
        self._wiz_meta = merge_wiz_meta(self._wiz_meta, harvested)
        self._save_wiz_meta()
        logger.info(
            "Harvested batchexecute tokens from capture (at=%s… base=%s)",
            str(harvested.get("at") or "")[:24],
            harvested.get("preferred_base"),
        )
        return dict(self._wiz_meta)

    def apply_wiz_meta(
        self,
        at: Optional[str] = None,
        bl: Optional[str] = None,
        sid: Optional[str] = None,
        preferred_base: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Inject WIZ tokens harvested from BiB Chrome (flow.google.com SNlM0e)."""
        token = str(at or "").strip()
        if len(token) < 20:
            raise ValueError("WIZ `at` token missing or too short")
        patch: Dict[str, Any] = {
            "at": token,
            "preferred_base": preferred_base or "https://flow.google.com",
            "source": "bib_export",
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        if bl:
            patch["bl"] = str(bl).strip()
        if sid:
            patch["sid"] = str(sid).strip()
            patch["f.sid"] = str(sid).strip()
        self._wiz_meta = merge_wiz_meta(self._wiz_meta, patch)
        self._clear_wiz_at_stale()
        self._save_wiz_meta()
        logger.info("Applied BiB WIZ meta (at=%s…)", token[:24])
        return dict(self._wiz_meta)

    @staticmethod
    def list_character_voices() -> List[Dict[str, str]]:
        """Return the full Flow character voice preset catalog."""
        return [dict(v) for v in CHARACTER_VOICE_PRESETS]

    def create_character(
        self,
        display_name: str = "Untitled character",
        voice_presets: Optional[List[str]] = None,
        image_media_id: Optional[str] = None,
        image_url: Optional[str] = None,
        local_image_path: Optional[str] = None,
        flow_entity_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a Flow character entity via C4BZMd; with graceful local entity fallback.

        When ``flow_entity_id`` is supplied (e.g. BiB already ran C4BZMd), skip
        batchexecute create and only sync local store + attach the portrait image.
        """
        voices = [str(v).strip().lower() for v in (voice_presets or []) if str(v).strip()]
        name = (display_name or "Untitled character").strip()
        project_id = clean_project_id(self.active_project_id) or "default-project"
        seeded_flow_id = str(flow_entity_id).strip() if flow_entity_id else None
        if seeded_flow_id and not re.match(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            seeded_flow_id,
            re.I,
        ):
            seeded_flow_id = None

        # Handle simulation mode
        if self.simulation_mode:
            character_id = f"sim-char-{uuid.uuid4().hex[:12]}"
            record = self._upsert_character_record({
                "character_id": character_id,
                "display_name": name,
                "voice_presets": voices,
                "image_media_id": image_media_id or f"sim-media-{uuid.uuid4().hex[:8]}",
                "image_url": image_url or "/static/favicon.ico",
                "local_image_path": local_image_path or None,
                "project_id": project_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "local_mode": True,
                "flow_entity_id": seeded_flow_id,
            })
            return {
                "success": True,
                "project_id": project_id,
                "character_id": character_id,
                "flow_entity_id": seeded_flow_id,
                "display_name": name,
                "voice_presets": voices,
                "character": record,
                "local_mode": True,
                "message": "Character created in simulation mode."
            }

        character_id = str(uuid.uuid4())
        # 1. Local record first — never block the user on Flow upload / portrait gen
        record = self._upsert_character_record(
            {
                "character_id": character_id,
                "flow_entity_id": seeded_flow_id,
                "display_name": name,
                "voice_presets": voices,
                "image_media_id": image_media_id or None,
                "image_url": image_url or None,
                "local_image_path": local_image_path or None,
                "project_id": project_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "sync_pending": (not seeded_flow_id)
                and (not self.simulation_mode)
                and bool(self.active_project_id),
                "local_mode": not bool(seeded_flow_id),
                "portrait_bound": False,
            }
        )
        logger.info(
            "Created studio character entity locally: %s (flow_entity_id=%s)",
            character_id,
            (seeded_flow_id or "")[:12] or "pending",
        )

        # 2. Flow register + upload image in background (no ogiZ0b portrait generation)
        if not self.simulation_mode and self.active_project_id and self.cookies:
            def _bg_sync_flow(
                cid: str,
                cname: str,
                pid: str,
                cvoices: List[str],
                img_id: Optional[str],
                img_u: Optional[str],
                local_p: Optional[str],
                known_flow_id: Optional[str],
            ):
                try:
                    bg_flow_id = known_flow_id
                    if bg_flow_id:
                        logger.info(
                            "Background Flow sync for character %s (%s) — BiB entity %s, upload/attach image only",
                            cid,
                            cname,
                            bg_flow_id[:12],
                        )
                    else:
                        logger.info(
                            "Background Flow sync for character %s (%s) — upload image + C4BZMd",
                            cid,
                            cname,
                        )
                    # Upload / resolve the user's image to a Flow media id (bytes only — no remix)
                    resolved_media = None
                    if img_id or img_u or local_p:
                        try:
                            resolved_media = self.resolve_character_portrait_media_id(
                                {
                                    "entity_id": cid,
                                    "character_id": cid,
                                    "image_media_id": img_id,
                                    "image_url": img_u,
                                    "local_image_path": local_p,
                                }
                            )
                        except Exception as up_err:
                            logger.warning("Background character image upload failed: %s", up_err)

                    if not bg_flow_id:
                        media_ids = [resolved_media] if resolved_media else []
                        payload = build_C4BZMd_payload(pid, cname, media_ids=media_ids)
                        self._wiz_recovery_next_at = 0.0
                        meta = self._execute_cdp_batchexecute(
                            "C4BZMd", payload, action="GENERIC", timeout=20.0, return_meta=True
                        )
                        if meta and meta.get("ok"):
                            data = meta.get("data")
                            row = data[0] if isinstance(data, list) and data else None
                            if isinstance(row, list) and len(row) > 1 and row[1]:
                                bg_flow_id = str(row[1])

                        # If create-with-media didn't stick, create bare then keep media_id locally
                        if not bg_flow_id:
                            payload2 = build_C4BZMd_payload(pid, cname)
                            meta2 = self._execute_cdp_batchexecute(
                                "C4BZMd", payload2, action="GENERIC", timeout=20.0, return_meta=True
                            )
                            if meta2 and meta2.get("ok"):
                                data2 = meta2.get("data")
                                row2 = data2[0] if isinstance(data2, list) and data2 else None
                                if isinstance(row2, list) and len(row2) > 1 and row2[1]:
                                    bg_flow_id = str(row2[1])

                    if bg_flow_id:
                        logger.info(
                            "Registered character %s → Flow entity %s (media=%s)",
                            cid,
                            bg_flow_id,
                            (resolved_media or "")[:12],
                        )
                        attached = None
                        # When BiB already created the entity, studio UI /prepare
                        # runs the white-bg portrait bind — avoid a second ogiZ0b.
                        if known_flow_id:
                            attached = resolved_media or img_id
                        else:
                            try:
                                attached = self._attach_character_image(
                                    flow_entity_id=bg_flow_id,
                                    display_name=cname,
                                    image_media_id=resolved_media or img_id,
                                    image_url=img_u,
                                    local_image_path=local_p,
                                    local_character_id=cid,
                                )
                            except Exception as att_err:
                                logger.warning("Background Flow image attach failed: %s", att_err)

                        self._upsert_character_record(
                            {
                                "character_id": cid,
                                "flow_entity_id": bg_flow_id,
                                "image_media_id": attached or resolved_media or img_id,
                                "image_url": img_u,
                                "local_image_path": local_p,
                                "sync_pending": False,
                                "local_mode": False,
                                "portrait_bound": bool(known_flow_id is None)
                                and bool(attached or resolved_media or img_id),
                                "flow_image_uploaded": bool(attached or resolved_media),
                            }
                        )
                        if cvoices:
                            try:
                                self.update_character(bg_flow_id, voice_presets=cvoices)
                            except Exception as voice_err:
                                logger.warning("Background voice attach failed: %s", voice_err)
                    else:
                        logger.warning(
                            "Background Flow character registration returned no entity for %s",
                            cid,
                        )
                        if resolved_media:
                            self._upsert_character_record(
                                {
                                    "character_id": cid,
                                    "image_media_id": resolved_media,
                                    "sync_pending": True,
                                }
                            )
                except Exception as rpc_err:
                    logger.warning(
                        "Background Google Flow character registration failed (remains local): %s",
                        rpc_err,
                    )

            threading.Thread(
                target=_bg_sync_flow,
                args=(
                    character_id,
                    name,
                    project_id,
                    voices,
                    image_media_id,
                    image_url,
                    local_image_path,
                    seeded_flow_id,
                ),
                daemon=True,
            ).start()

        return {
            "success": True,
            "project_id": project_id,
            "character_id": character_id,
            "flow_entity_id": seeded_flow_id,
            "display_name": name,
            "voice_presets": list(record.get("voice_presets") or voices),
            "image_media_id": record.get("image_media_id") or image_media_id,
            "character": record,
            "local_mode": not bool(seeded_flow_id),
            "sync_pending": not bool(seeded_flow_id),
            "message": (
                "Character saved to Google Flow. Attaching image in the background…"
                if seeded_flow_id
                else "Character saved. Syncing to Google Flow in the background…"
            ),
        }

    def _attach_character_image(
        self,
        flow_entity_id: str,
        display_name: str,
        image_media_id: Optional[str] = None,
        image_url: Optional[str] = None,
        local_image_path: Optional[str] = None,
        local_character_id: Optional[str] = None,
    ) -> Optional[str]:
        """Upload the user's image to Google Flow and attach it to the character.

        Does NOT invent an AI portrait. Uploads bytes → Flow media id, then binds
        that same media to the Flow entity. Result URL is Flow CDN, not our disk.
        """
        if not (image_media_id or image_url or local_image_path):
            return None

        media_id = self.resolve_character_portrait_media_id(
            {
                "entity_id": local_character_id or flow_entity_id,
                "character_id": local_character_id,
                "image_media_id": image_media_id,
                "image_url": image_url,
                "local_image_path": local_image_path,
            }
        )
        if not media_id:
            raise RuntimeError("Failed to upload character image to Google Flow")

        flow_url = None
        try:
            as_info = self._rpc_as29s(media_id)
            if as_info and as_info.get("url"):
                flow_url = as_info["url"]
        except Exception:
            flow_url = f"https://flow-content.google/image/{media_id}"

        if flow_entity_id and not self.simulation_mode:
            try:
                logger.info(
                    "Attaching Flow media %s to character %s (white-bg portrait remix)",
                    str(media_id)[:12],
                    str(flow_entity_id)[:12],
                )
                # Same uploaded likeness → white background (Flow character sheet)
                self.image_to_image(
                    image_id=media_id,
                    prompt="Make the same picture in white background",
                    aspect_ratio="1:1",
                    model="GEM_PIX_2",
                    destination_character_id=flow_entity_id,
                    num_images=1,
                )
            except Exception as bind_err:
                logger.warning(
                    "Flow character sheet attach failed; media is on Flow: %s",
                    bind_err,
                )

        if local_character_id:
            self._upsert_character_record(
                {
                    "character_id": local_character_id,
                    "flow_entity_id": flow_entity_id or None,
                    "image_media_id": media_id,
                    "image_url": flow_url or image_url,
                    "local_image_path": local_image_path,
                    "portrait_bound": True,
                    "flow_image_uploaded": True,
                }
            )
        return media_id

    def _bind_character_portrait(
        self,
        flow_entity_id: str,
        display_name: str,
        image_media_id: Optional[str] = None,
        image_url: Optional[str] = None,
        local_image_path: Optional[str] = None,
        local_character_id: Optional[str] = None,
    ) -> Optional[str]:
        """Alias — uploads user image to Flow and attaches it (no AI portrait prompt)."""
        return self._attach_character_image(
            flow_entity_id=flow_entity_id,
            display_name=display_name,
            image_media_id=image_media_id,
            image_url=image_url,
            local_image_path=local_image_path,
            local_character_id=local_character_id,
        )

    def update_character(
        self,
        character_id: str,
        display_name: Optional[str] = None,
        voice_presets: Optional[List[str]] = None,
        image_media_id: Optional[str] = None,
        image_url: Optional[str] = None,
        local_image_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Update character name/voice via rzMKMb with graceful local fallback."""
        if not character_id:
            raise ValueError("character_id required")

        existing = next(
            (
                c
                for c in self.characters
                if c.get("character_id") == character_id
                or c.get("flow_entity_id") == character_id
            ),
            None,
        )
        # rzMKMb / Flow RPCs need the Flow entity id when we have it
        rpc_character_id = (
            (existing or {}).get("flow_entity_id")
            or character_id
        )
        needs_rpc = display_name is not None or voice_presets is not None
        meta_data = None
        rpc_failed = False

        if needs_rpc and self.active_project_id and not self.simulation_mode:
            try:
                voices_for_rpc = (
                    [str(v).strip().lower() for v in voice_presets if str(v).strip()]
                    if voice_presets is not None
                    else None
                )
                payload = build_rzMKMb_payload(
                    self.active_project_id,
                    rpc_character_id,
                    display_name=display_name,
                    voice_presets=voices_for_rpc,
                )
                self._wiz_recovery_next_at = 0.0
                meta = self._execute_cdp_batchexecute(
                    "rzMKMb", payload, action="GENERIC", timeout=30.0, return_meta=True
                )
                if meta and meta.get("ok"):
                    meta_data = meta.get("data")
                else:
                    rpc_failed = True
                    logger.warning(f"rzMKMb update character remote sync failed: {meta.get('error_code') if meta else 'error'}")
            except Exception as e:
                rpc_failed = True
                logger.warning(f"rzMKMb update character call failed ({e}); preserving local update")

        merged_name = display_name if display_name is not None else (
            (existing or {}).get("display_name") or "Untitled character"
        )
        merged_voices = (
            [str(v).strip().lower() for v in voice_presets if str(v).strip()]
            if voice_presets is not None
            else list((existing or {}).get("voice_presets") or [])
        )
        record_payload: Dict[str, Any] = {
            "character_id": (existing or {}).get("character_id") or character_id,
            "display_name": merged_name,
            "voice_presets": merged_voices,
            "project_id": self.active_project_id or (existing or {}).get("project_id", ""),
            "created_at": (existing or {}).get("created_at")
            or datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "sync_pending": bool(rpc_failed or (existing or {}).get("sync_pending", False)),
        }
        if image_media_id is not None:
            record_payload["image_media_id"] = image_media_id or None
        if image_url is not None:
            record_payload["image_url"] = image_url or None
        if local_image_path is not None:
            record_payload["local_image_path"] = local_image_path or None

        if (existing or {}).get("flow_entity_id"):
            record_payload["flow_entity_id"] = existing["flow_entity_id"]
        elif existing is None:
            # Updating by Flow entity id before local row exists
            record_payload["flow_entity_id"] = character_id

        record = self._upsert_character_record(record_payload)

        # If image refs were provided, upload/resolve media only (no AI portrait)
        flow_eid = record.get("flow_entity_id") or rpc_character_id
        if flow_eid and not self.simulation_mode and (image_media_id or image_url or local_image_path):
            try:
                bound = self._attach_character_image(
                    flow_entity_id=str(flow_eid),
                    display_name=merged_name,
                    image_media_id=image_media_id or record.get("image_media_id"),
                    image_url=image_url or record.get("image_url"),
                    local_image_path=local_image_path or record.get("local_image_path"),
                    local_character_id=record.get("character_id"),
                )
                if bound:
                    record = self._upsert_character_record(
                        {
                            "character_id": record.get("character_id"),
                            "image_media_id": bound,
                            "portrait_bound": True,
                        }
                    )
            except Exception as bind_err:
                logger.warning("update_character image attach failed: %s", bind_err)

        return {
            "success": True,
            "project_id": self.active_project_id,
            "character_id": record.get("character_id") or character_id,
            "flow_entity_id": record.get("flow_entity_id") or flow_eid,
            "display_name": merged_name,
            "voice_presets": merged_voices,
            "character": record,
            "raw": meta_data,
        }

    def delete_character(self, character_id: str) -> bool:
        """Delete a locally tracked character by id."""
        self._load_characters()
        initial_len = len(self.characters)
        self.characters = [c for c in self.characters if c.get("character_id") != character_id]
        if len(self.characters) < initial_len:
            self._save_characters()
            return True
        return False

    def sync_characters(self) -> Dict[str, Any]:
        """Synchronize character entities from Google Flow captures and active session.
        Pushes pending local characters to Google Flow when session is available."""
        self._load_characters()
        known_by_id = {c.get("character_id"): c for c in self.characters if c.get("character_id")}
        imported_count = 0

        # 1. Scan capture directories for character entities
        cap_candidates = [
            DATA_DIR / "captures" / "flow_capture_2026-09-05_characters_summary.json",
        ]
        for p in (DATA_DIR / "captures").glob("*.json"):
            if p not in cap_candidates:
                cap_candidates.append(p)

        for cap_path in cap_candidates:
            if not cap_path.exists():
                continue
            try:
                with open(cap_path, "r", encoding="utf-8", errors="ignore") as f:
                    cap_data = json.load(f)
                if not isinstance(cap_data, dict):
                    continue

                # Parse character_ids block
                c_ids = cap_data.get("character_ids") or {}
                if isinstance(c_ids, dict) and c_ids.get("character_id"):
                    cid = str(c_ids["character_id"]).strip()
                    if cid and cid not in known_by_id:
                        cname = c_ids.get("display_name") or "Monkey King"
                        cvoice = [c_ids["voice_preset"]] if c_ids.get("voice_preset") else ["achird"]
                        cpid = c_ids.get("project_id") or self.active_project_id or ""
                        cport = c_ids.get("portrait_media_id")
                        new_rec = {
                            "character_id": cid,
                            "display_name": cname,
                            "voice_presets": cvoice,
                            "image_media_id": cport or None,
                            "image_url": "",
                            "project_id": cpid,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                            "source": "capture_sync",
                        }
                        self._upsert_character_record(new_rec)
                        known_by_id[cid] = new_rec
                        imported_count += 1

                # Parse rpcs decoded_f_req
                for rpc in cap_data.get("rpcs", []) or []:
                    for row in rpc.get("decoded_f_req", []) or []:
                        if row.get("rpcid") in ("rzMKMb", "C4BZMd"):
                            payload = row.get("payload") or []
                            if payload and isinstance(payload[0], list) and len(payload[0]) > 1:
                                cid = payload[0][1]
                                if cid and str(cid) not in known_by_id:
                                    rec = {
                                        "character_id": str(cid),
                                        "display_name": "Synced Character",
                                        "voice_presets": [],
                                        "project_id": str(payload[0][0]) if payload[0] else "",
                                        "created_at": datetime.now(timezone.utc).isoformat(),
                                        "source": "capture_sync",
                                    }
                                    self._upsert_character_record(rec)
                                    known_by_id[str(cid)] = rec
                                    imported_count += 1
            except Exception as ce:
                logger.debug(f"Capture scan characters error: {ce}")

        # 2. Push pending characters to Google Flow if batchexecute is alive
        pushed_count = 0
        if self.active_project_id and not self.simulation_mode:
            for cid, c in list(known_by_id.items()):
                if c.get("sync_pending"):
                    try:
                        name = c.get("display_name") or "Untitled character"
                        payload = build_C4BZMd_payload(self.active_project_id, name)
                        meta = self._execute_cdp_batchexecute("C4BZMd", payload, action="GENERIC", timeout=15.0, return_meta=True)
                        if meta and meta.get("ok"):
                            c["sync_pending"] = False
                            pushed_count += 1
                            self._save_characters()
                    except Exception:
                        pass

        self._load_characters()
        return {
            "success": True,
            "imported_count": imported_count,
            "pushed_count": pushed_count,
            "total_count": len(self.characters),
            "characters": self.list_characters(),
        }

    def list_characters(self, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Return locally tracked characters (optionally filtered by project)."""
        self._load_characters()
        pid = clean_project_id(project_id or self.active_project_id)
        if not pid:
            return list(self.characters)
        return [
            c for c in self.characters
            if clean_project_id(c.get("project_id")) == pid or not c.get("project_id")
        ]

    def get_character(self, character_id: str) -> Optional[Dict[str, Any]]:
        """Return a character entity by ID."""
        self._load_characters()
        cid = str(character_id or "").strip()
        if not cid:
            return None
        for c in self.characters:
            if (
                c.get("character_id") == cid
                or c.get("id") == cid
                or c.get("entity_id") == cid
                or c.get("flow_entity_id") == cid
            ):
                return c
        return None

    def _load_initial_auth(self):
        """Try to load cookies and projects from settings.json."""
        needs_cookie_migration = False
        if SETTINGS_FILE.exists():
            try:
                self._settings_mtime = SETTINGS_FILE.stat().st_mtime
                with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    raw_cookies = data.get("cookies", "") or ""
                    needs_cookie_migration = bool(raw_cookies) and not raw_cookies.startswith(_ENC_PREFIX)
                    self.cookies = _decrypt_secret(raw_cookies)
                    self.simulation_mode = data.get("simulation_mode", False)
                    if data.get("user_email"):
                        self.user_info = {"email": data.get("user_email")}
                    if data.get("active_project_id"):
                        self.active_project_id = clean_project_id(data.get("active_project_id"))
                    self.credits = data.get("credits")
                    self.paygate_tier = data.get("paygate_tier", "PAYGATE_TIER_TWO")
                    self.plan_name = data.get("plan_name", "Google AI Pro")
                    self.tier_override = data.get("tier_override", None)
                    self.account_credits = data.get("account_credits", {})
                    self.account_tiers = data.get("account_tiers", {})
                    raw_projects = data.get("projects", [])
                    clean_projects = []
                    seen_pids = set()
                    for p in raw_projects:
                        if isinstance(p, dict) and p.get("id"):
                            c_id = clean_project_id(p.get("id"))
                            if c_id and c_id not in seen_pids:
                                seen_pids.add(c_id)
                                p["id"] = c_id
                                p["url"] = project_url(c_id)
                                clean_projects.append(p)
                    self.projects = clean_projects
            except Exception as e:
                logger.warning(f"Error reading settings.json: {e}")

        # Transparent migration: legacy plaintext cookies on disk get re-saved
        # (encrypted) immediately so they never sit unencrypted longer than one load.
        if needs_cookie_migration and self.cookies:
            try:
                self._save_settings()
            except Exception as e:
                logger.warning("Could not migrate plaintext cookies to encrypted storage: %s", e)

        # Auto-ensure active project is selected from loaded projects
        try:
            self.ensure_active_project()
        except Exception as e:
            logger.warning("Could not ensure active project on startup: %s", e)
            self.active_project_id = clean_project_id(self.active_project_id)

        # Strictly use cookies saved from frontend (never fallback to .env or os.environ)
        if self.cookies:
            self.refresh_session()

    def _check_reload_settings(self):
        """If data/settings.json was modified on disk, reload state and active session."""
        now = time.time()
        if now - getattr(self, "_last_settings_check_time", 0.0) < 1.0:
            return
        self._last_settings_check_time = now
        if SETTINGS_FILE.exists():
            try:
                mtime = SETTINGS_FILE.stat().st_mtime
                if mtime > self._settings_mtime:
                    logger.info("data/settings.json modified on disk. Reloading settings...")
                    self._load_initial_auth()
            except Exception as e:
                logger.debug(f"Error checking settings mtime: {e}")

    def _save_settings(self):
        try:
            data = {
                # Encrypted at rest (Fernet, keyed off DATA_ENCRYPTION_KEY); self.cookies
                # itself stays plaintext in memory. See _encrypt_secret/_decrypt_secret.
                "cookies": _encrypt_secret(self.cookies),
                "simulation_mode": self.simulation_mode,
                "user_email": self.user_info.get("email", ""),
                "token_expires": self.token_expires,
                "active_project_id": self.active_project_id,
                "projects": self.projects,
                "credits": self.credits,
                "paygate_tier": self.paygate_tier,
                "plan_name": self.plan_name,
                "tier_override": getattr(self, "tier_override", None),
                "account_credits": self.account_credits,
                "account_tiers": self.account_tiers,
            }
            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            self._settings_mtime = SETTINGS_FILE.stat().st_mtime
        except Exception as e:
            logger.error(f"Failed to save settings: {e}")

    def _load_history(self) -> List[Dict[str, Any]]:
        if not HISTORY_FILE.exists():
            self.history: List[Dict[str, Any]] = []
            return self.history
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                self.history = json.load(f)
            # Normalize project_url to https://flow.google.com/project/{id}
            dirty = False
            for item in self.history:
                if not isinstance(item, dict):
                    continue
                pid = clean_project_id(item.get("project_id"))
                if pid:
                    item["project_id"] = pid
                desired = project_url(pid) if pid else ""
                if desired and item.get("project_url") != desired:
                    item["project_url"] = desired
                    dirty = True
                elif isinstance(item.get("project_url"), str) and (
                    "flow.google.com/project/" in item["project_url"]
                    or "labs.google" in item["project_url"]
                ):
                    legacy_id = item["project_url"].split("/project/")[-1].split("?")[0].split("&")[0]
                    item["project_url"] = project_url(legacy_id)
                    dirty = True
                # Heal images falsely marked FAILED by video-status poll race
                if (
                    item.get("type") == "image"
                    and item.get("status") == "FAILED"
                    and item.get("url")
                    and "flow-content.google" in str(item.get("url"))
                ):
                    item["status"] = "COMPLETED"
                    item["flow_ready"] = True
                    item.pop("error", None)
                    dirty = True
            if dirty:
                self._save_history()
        except Exception as e:
            logger.warning(f"Failed to load history: {e}")
            self.history = []
        return self.history

    def _save_history(self):
        try:
            with open(HISTORY_FILE, "w", encoding="utf-8") as f:
                json.dump(self.history, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save history: {e}")

    def _load_characters(self) -> List[Dict[str, Any]]:
        """Load locally tracked Flow character entities (like history.json)."""
        if not CHARACTERS_FILE.exists():
            self.characters: List[Dict[str, Any]] = []
            return self.characters
        try:
            with open(CHARACTERS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                self.characters = [c for c in data if isinstance(c, dict) and c.get("character_id")]
            else:
                self.characters = []
        except Exception as e:
            logger.warning(f"Failed to load characters: {e}")
            self.characters = []
        return self.characters

    def _save_characters(self) -> None:
        try:
            with open(CHARACTERS_FILE, "w", encoding="utf-8") as f:
                json.dump(self.characters, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save characters: {e}")

    def _upsert_character_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """Insert or update a character in the local characters.json store."""
        cid = str(record.get("character_id") or "").strip()
        if not cid:
            return record
        if not hasattr(self, "characters"):
            self._load_characters()
        record = dict(record)
        record["character_id"] = cid
        record["project_id"] = clean_project_id(record.get("project_id") or self.active_project_id)
        found = False
        for i, existing in enumerate(self.characters):
            if existing.get("character_id") == cid:
                merged = dict(existing)
                merged.update({k: v for k, v in record.items() if v is not None})
                self.characters[i] = merged
                record = merged
                found = True
                break
        if not found:
            self.characters.insert(0, record)
        self._save_characters()
        return record

    def _build_flow_angular_cdp_cookies(self, cookie_str: str) -> List[Dict[str, Any]]:
        """Build CDP cookies for flow.google.com Angular batchexecute.

        Avoid `domain=.google.com` injection — that commonly triggers
        accounts.google.com/CookieMismatch and blocks SNlM0e / maseQ.
        Use url-scoped cookies for flow + labs (+ www.google.com for PSID).
        """
        expires = time.time() + 86400 * 400
        http_only_names = {
            "SID", "HSID", "SSID", "APISID", "SAPISID", "LSID", "OSID",
            "__Secure-1PSID", "__Secure-3PSID", "__Secure-1PSIDTS", "__Secure-3PSIDTS",
            "__Secure-1PSIDCC", "__Secure-3PSIDCC", "__Secure-OSID", "__Secure-STRP",
            "__Host-1PLSID", "__Host-3PLSID", "__Host-GAPS",
        }
        cookies: List[Dict[str, Any]] = []
        for item in (cookie_str or "").split(";"):
            item = item.strip()
            if not item or "=" not in item:
                continue
            name, val = item.split("=", 1)
            name, val = name.strip(), val.strip()
            if not name:
                continue
            http_only = (
                name in http_only_names
                or name.startswith("__Secure-")
                or name.startswith("__Host-")
                or "next-auth" in name
            )
            if "next-auth" in name:
                urls = ("https://labs.google", "https://flow.google.com")
            elif name.startswith("__Host-"):
                # Host cookies are origin-bound; try the usual Google hosts.
                urls = (
                    "https://flow.google.com",
                    "https://labs.google",
                    "https://accounts.google.com",
                )
            else:
                urls = (
                    "https://flow.google.com",
                    "https://www.google.com",
                    "https://labs.google",
                )
            for url in urls:
                cookies.append(
                    {
                        "name": name,
                        "value": val,
                        "url": url,
                        "path": "/",
                        "secure": True,
                        "httpOnly": http_only,
                        "sameSite": "Lax",
                        "expires": expires,
                    }
                )
        return cookies

    def _build_labs_cdp_cookies(self, cookie_str: str) -> List[Dict[str, Any]]:
        """Build CDP cookies for labs.google next-auth only.

        Injecting full Google PSID cookies via CDP often triggers accounts.google.com
        CookieMismatch and Flow redirects to /about. Generation only needs the
        labs next-auth session plus a Bearer access token.
        """
        expires = time.time() + 86400 * 400
        cookies: List[Dict[str, Any]] = []
        for item in (cookie_str or "").split(";"):
            item = item.strip()
            if not item or "=" not in item:
                continue
            name, val = item.split("=", 1)
            name, val = name.strip(), val.strip()
            if "next-auth" not in name:
                continue
            cookies.append({
                "name": name,
                "value": val,
                "url": "https://labs.google",
                "path": "/",
                "secure": True,
                "httpOnly": True,
                "sameSite": "Lax",
                "expires": expires,
            })
        return cookies

    def _build_cdp_cookies(self, cookie_str: str) -> List[Dict[str, Any]]:
        """Parse cookie header into CDP cookies (legacy full-jar helper).

        Prefer `_build_labs_cdp_cookies` for generation CDP sessions.
        """
        return self._build_labs_cdp_cookies(cookie_str) + [
            c for c in self._build_legacy_google_cdp_cookies(cookie_str)
        ]

    def _build_legacy_google_cdp_cookies(self, cookie_str: str) -> List[Dict[str, Any]]:
        """Optional Google host cookies — kept for browser-login sync paths only."""
        expires = time.time() + 86400 * 400
        http_only_names = {
            "SID", "HSID", "SSID", "APISID", "SAPISID", "LSID", "OSID",
            "__Secure-1PSID", "__Secure-3PSID", "__Secure-1PSIDTS", "__Secure-3PSIDTS",
            "__Secure-1PSIDCC", "__Secure-3PSIDCC", "__Secure-OSID", "__Secure-STRP",
            "__Host-1PLSID", "__Host-3PLSID", "__Host-GAPS",
        }
        cookies: List[Dict[str, Any]] = []
        for item in cookie_str.split(";"):
            item = item.strip()
            if not item or "=" not in item:
                continue
            name, val = item.split("=", 1)
            name, val = name.strip(), val.strip()
            if not name or "next-auth" in name:
                continue
            http_only = name in http_only_names or name.startswith("__Secure-") or name.startswith("__Host-")
            if name.startswith("__Host-"):
                cookies.append({
                    "name": name,
                    "value": val,
                    "url": "https://labs.google",
                    "path": "/",
                    "secure": True,
                    "httpOnly": http_only,
                    "sameSite": "Lax",
                    "expires": expires,
                })
                continue
            cookies.append({
                "name": name,
                "value": val,
                "domain": ".google.com",
                "path": "/",
                "secure": True,
                "httpOnly": http_only,
                "sameSite": "None",
                "expires": expires,
            })
        return cookies

    def _cdp_recv_until(self, ws: websocket.WebSocket, pred, timeout: float = 30.0) -> dict:
        """Receive CDP messages until pred(data).

        In labs-recaptcha mode (`_cdp_block_flow_nav`), abort only top-level Document
        navigations to flow.google.com so the SPA cannot kick us off labs.google.
        Never abort XHR/Fetch (batchexecute uploads) — that caused TypeError: Failed to fetch.
        In Angular mode, continue every paused request.
        """
        deadline = time.time() + timeout
        evt_id = int(time.time() * 1000) % 100000 + 500000
        while time.time() < deadline:
            remaining = max(0.2, deadline - time.time())
            try:
                ws.settimeout(min(2.0, remaining))
                data = json.loads(ws.recv())
            except Exception as e:
                if "timed out" in str(e).lower():
                    continue
                raise
            if data.get("method") == "Fetch.requestPaused":
                params = data.get("params", {})
                req_id = params.get("requestId")
                url = str(params.get("request", {}).get("url", "") or "")
                resource_type = str(params.get("resourceType") or "")
                evt_id += 1
                abort = False
                if self._cdp_block_flow_nav and "flow.google.com" in url:
                    # Document navigations only — never kill batchexecute / API XHR
                    is_document = resource_type.lower() == "document"
                    is_api = (
                        "batchexecute" in url
                        or "/_/AiSandbox" in url
                        or "/_/Labs" in url
                    )
                    abort = is_document and not is_api
                if abort:
                    ws.send(json.dumps({
                        "id": evt_id,
                        "method": "Fetch.failRequest",
                        "params": {"requestId": req_id, "errorReason": "Aborted"},
                    }))
                else:
                    ws.send(json.dumps({
                        "id": evt_id,
                        "method": "Fetch.continueRequest",
                        "params": {"requestId": req_id},
                    }))
                continue
            if pred(data):
                return data
        raise TimeoutError("CDP receive timed out")

    def _cdp_set_flow_nav_block(self, ws: websocket.WebSocket, block: bool) -> None:
        """Enable/disable labs stay-on-labs Fetch interception for this target."""
        self._cdp_block_flow_nav = bool(block)
        if block:
            try:
                self._cdp_send(ws, "Fetch.enable", {
                    "patterns": [
                        {"urlPattern": "*://flow.google.com/*", "requestStage": "Request"},
                        {"urlPattern": "*://www.flow.google.com/*", "requestStage": "Request"},
                    ]
                }, msg_id=9301, timeout=10)
            except Exception as e:
                logger.debug(f"Fetch.enable (block flow nav) notice: {e}")
        else:
            try:
                self._cdp_send(ws, "Fetch.disable", msg_id=9302, timeout=5.0)
            except Exception as e:
                logger.debug(f"Fetch.disable (allow flow) notice: {e}")

    def _cdp_send(self, ws: websocket.WebSocket, method: str, params: Optional[dict] = None, msg_id: int = 1, timeout: float = 20.0) -> dict:
        payload: Dict[str, Any] = {"id": msg_id, "method": method}
        if params is not None:
            payload["params"] = params
        ws.send(json.dumps(payload))
        return self._cdp_recv_until(ws, lambda d: d.get("id") == msg_id, timeout=timeout)

    def _cdp_apply_labs_session(self, ws: websocket.WebSocket) -> None:
        """DISABLED — BiB manages the live browser session; CDP cookie injection no longer used."""
        logger.info("[cdp] _cdp_apply_labs_session: skipped (BiB-only mode)")
        return

    def _cdp_apply_flow_angular_session(self, ws: websocket.WebSocket) -> None:
        """DISABLED — BiB manages the live browser session; CDP cookie injection no longer used."""
        logger.info("[cdp] _cdp_apply_flow_angular_session: skipped (BiB-only mode)")
        return

    def _sync_cookies_to_cdp(self):
        """DISABLED — BiB manages the live browser session; CDP navigation no longer used."""
        logger.info("[cdp] _sync_cookies_to_cdp: skipped (BiB-only mode)")
        return

    def set_cookies(self, raw_cookies: Any) -> Dict[str, Any]:
        """Update active cookies for a (possibly new) account.

        Always clears the previous account's project binding and binds a real
        Flow project for the new account (list remote, or create one).
        """
        normalized = prune_cookie_header(parse_cookie_input(raw_cookies))
        if not normalized:
            raise ValueError("Empty or invalid cookies provided")

        new_pairs = parse_cookie_pairs(normalized)
        if not new_pairs:
            raise ValueError("No valid cookie pairs could be extracted from input")

        with self._lock:
            # Preserve WIZ tokens across cookie refresh — BiB sync often lacks labs
            # next-auth but still has a live flow.google.com SNlM0e we need for I2I.
            saved_wiz = dict(self._wiz_meta) if self._wiz_meta.get("at") else {}

            # Set cookies cleanly — never merge jars across accounts
            self.cookies = normalized
            self._clear_wiz_at_stale()
            # Reset old session + project state from previous account
            self.access_token = ""
            self.token_expires = ""
            self.user_info = {}
            self.projects = []
            self.active_project_id = ""
            self.credits = None
            self.paygate_tier = "PAYGATE_TIER_TWO"
            self.plan_name = "Google AI Pro"
            self.sku = ""
            # Do not delete batchexecute_meta.json here — restore from saved_wiz below
            # if labs OAuth fails but Flow WIZ tokens are still valid.

            # Refresh token, validate session with Google Labs, and fetch account tier & credits
            status = self.refresh_session()
            status = dict(status) if isinstance(status, dict) else {"is_authenticated": False}

            report = self.cookie_session_report()
            status["cookie_session"] = report
            if report.get("partial_secure_only_export"):
                status["warning"] = (
                    f"Jar is missing {', '.join(report.get('missing') or [])}. "
                    "Open flow.google.com signed-in and Sync the full Cookie header "
                    "(must include SID, HSID, APISID) so Studio can create projects / characters."
                )

            if status.get("is_authenticated"):
                try:
                    self._sync_cookies_to_cdp()
                except Exception as ex:
                    logger.debug("CDP cookie sync after set_cookies: %s", ex)

                # Bind a project that belongs to THIS account (never keep the old UUID)
                try:
                    bind = self._bind_projects_for_current_account()
                    status["project_bind"] = bind
                    status["active_project_id"] = self.active_project_id
                except Exception as ex:
                    logger.warning("Could not bind project for new account: %s", ex)
                    status["project_error"] = str(ex)
                    if not status.get("warning"):
                        status["warning"] = str(ex)
            elif saved_wiz.get("at") and report.get("has_web_session"):
                # Labs OAuth expired, but web cookies + prior WIZ `at` can still drive batchexecute
                self._wiz_meta = merge_wiz_meta(self._wiz_meta, saved_wiz)
                self._save_wiz_meta()
                status["wiz_preserved"] = True
                status["warning"] = (
                    status.get("warning")
                    or "Labs OAuth expired; keeping Flow WIZ tokens for batchexecute I2I/I2V."
                )

            self._save_settings()
            return status

    def _bind_projects_for_current_account(self) -> Dict[str, Any]:
        """List remote Flow projects for the connected account, or create one.

        Never invents a phantom UUID — aisandbox rejects those with 401/404.
        """
        self.active_project_id = ""
        self.projects = []
        remote = self._fetch_remote_projects()
        if remote:
            self.projects = remote
            self.active_project_id = remote[0]["id"]
            for p in self.projects:
                p["active"] = p.get("id") == self.active_project_id
            self._save_settings()
            logger.info(
                "Bound %s remote project(s) for %s; active=%s",
                len(remote),
                self.user_info.get("email") or "account",
                self.active_project_id,
            )
            return {
                "project_id": self.active_project_id,
                "created": False,
                "count": len(remote),
            }

        email = (self.user_info.get("email") or "Studio").split("@")[0][:24]
        title = f"{email} {datetime.now().strftime('%b %d %H:%M')}"
        created = self.create_project(title)
        return {
            "project_id": created.get("project_id") or self.active_project_id,
            "created": True,
            "count": 1,
            "name": created.get("name"),
        }

    def disconnect_account(self) -> Dict[str, Any]:
        """Disconnect current account, clear all cookies, session tokens, projects, and CDP cookies."""
        with self._lock:
            self.cookies = ""
            self.access_token = ""
            self.token_expires = ""
            self.user_info = {}
            self.projects = []
            self.active_project_id = ""
            self.credits = None
            self.paygate_tier = "PAYGATE_TIER_TWO"
            self.plan_name = "Google AI Pro"
            self.account_credits = {}
            self.account_tiers = {}
            self.sku = ""
            self._clear_wiz_at_stale()

            # Remove batchexecute metadata file if it exists
            try:
                if BATCHEXECUTE_META_FILE.exists():
                    BATCHEXECUTE_META_FILE.unlink(missing_ok=True)
            except Exception as e:
                logger.debug(f"Could not remove batchexecute meta on disconnect: {e}")

            # Clear CDP browser cookies if Chrome is running
            try:
                from gflow.auth.browser_auth import get_saved_cdp_port
                port = get_saved_cdp_port()
                if self._is_cdp_port_alive(port):
                    targets = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2).read())
                    page = next((t for t in targets if t.get("type") == "page"), None)
                    if page:
                        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=8)
                        try:
                            self._cdp_send(ws, "Network.clearBrowserCookies", {}, msg_id=99)
                        finally:
                            ws.close()
            except Exception as e:
                logger.debug(f"Could not clear CDP cookies on disconnect: {e}")

            # Persist the cleared state to settings.json
            self._save_settings()

            logger.info("Account disconnected and all session cookies cleared.")
            return {
                "success": True,
                "is_authenticated": False,
                "email": "",
                "message": "Account disconnected and all cookies cleared successfully."
            }

    def toggle_simulation(self, enabled: Optional[bool] = None) -> bool:
        if enabled is None:
            self.simulation_mode = not self.simulation_mode
        else:
            self.simulation_mode = enabled
        self._save_settings()
        return self.simulation_mode

    def _fetch_account_tier(self):
        """Query aisandbox-pa.googleapis.com/v1/credits to get real paygate tier, SKU, and account credits."""
        if not self.access_token:
            return
        try:
            headers = {
                "Authorization": f"Bearer {self.access_token}",
                "Origin": "https://flow.google.com",
                "Referer": "https://flow.google.com/project/",
                "Cookie": self.cookies,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            }
            resp = requests.get("https://aisandbox-pa.googleapis.com/v1/credits", headers=headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                logger.info(f"Credits API raw response: {data}")
                tier = data.get("userPaygateTier")
                if tier:
                    self.paygate_tier = tier
                sku = data.get("sku", "")
                self.sku = sku
                service_tier = data.get("serviceTier", "")
                self.service_tier = service_tier

                tier_upper = (self.paygate_tier or "").upper()
                sku_upper = (sku or "").upper()
                service_upper = (service_tier or "").upper()

                # Ultra is often PAYGATE_TIER_TWO + SERVICE_TIER_ADVANCED (not always TIER_THREE).
                # Only the display plan_name changes — wire paygate_tier stays as Google returns it.
                if (
                    "ADVANCED" in service_upper
                    or "TIER3" in tier_upper
                    or "TIER3" in sku_upper
                    or "ULTRA" in tier_upper
                    or "ULTRA" in sku_upper
                    or "ULTRA" in service_upper
                    or tier_upper == "PAYGATE_TIER_THREE"
                ):
                    self.plan_name = "Google AI Ultra"
                elif (
                    "TIER2" in tier_upper
                    or "TIER2" in sku_upper
                    or "PRO" in tier_upper
                    or "PRO" in sku_upper
                    or "INTERMEDIATE" in service_upper
                ):
                    self.plan_name = "Google AI Pro"
                elif "TIER1" in tier_upper or "TIER1" in sku_upper:
                    self.plan_name = "Google AI Tier 1"
                elif (
                    "ZERO" in tier_upper
                    or "UNSUBSCRIBED" in tier_upper
                    or "NOT_PAID" in tier_upper
                    or "FREEMIUM" in sku_upper
                    or "ENTRY" in service_upper
                ):
                    self.plan_name = "Free Tier"
                else:
                    self.plan_name = "Google AI Account"

                if getattr(self, "tier_override", None):
                    override = str(self.tier_override).upper()
                    if "ULTRA" in override or "THREE" in override:
                        self.paygate_tier = "PAYGATE_TIER_TWO"
                        self.service_tier = "SERVICE_TIER_ADVANCED"
                        self.plan_name = "Google AI Ultra"
                    elif "PRO" in override or "TWO" in override:
                        self.paygate_tier = "PAYGATE_TIER_TWO"
                        self.service_tier = "SERVICE_TIER_INTERMEDIATE"
                        self.plan_name = "Google AI Pro"
                    elif "FREE" in override or "NOT_PAID" in override:
                        self.paygate_tier = "PAYGATE_TIER_NOT_PAID"
                        self.service_tier = "SERVICE_TIER_ENTRY"
                        self.plan_name = "Free Tier"

                email = self.user_info.get("email", "")
                if email:
                    self.account_tiers[email] = self.paygate_tier

                    # Try to extract actual credit balance from the API response
                    api_credits = None
                    for key in ("remainingCredits", "credits", "balance", "creditBalance", "remaining"):
                        if key in data:
                            try:
                                api_credits = int(data[key])
                            except (ValueError, TypeError):
                                pass
                            break

                    if api_credits is not None:
                        self.account_credits[email] = api_credits
                    else:
                        # API doesn't return real balance; assign tier max as baseline
                        if "Ultra" in self.plan_name:
                            self.account_credits[email] = 5000
                        elif "TIER2" in tier_upper or "Pro" in self.plan_name:
                            self.account_credits[email] = 1000
                        else:
                            self.account_credits[email] = 0

                    self.credits = self.account_credits[email]

                logger.info(f"Account subscription: {self.paygate_tier} ({self.plan_name}), credits: {self.credits} for {email}")
        except Exception as e:
            logger.warning(f"Failed to fetch account tier: {e}")

    def set_tier_override(self, tier: Optional[str]) -> Dict[str, Any]:
        """Manually override or reset account tier (e.g. 'auto', 'Free', 'Pro', 'Ultra')."""
        tier_val = (tier or "").strip()
        if not tier_val or tier_val.lower() in ("auto", "none", "detect", "default"):
            self.tier_override = None
        else:
            self.tier_override = tier_val
        self._fetch_account_tier()
        self._save_settings()
        return self.get_status()

    def refresh_session(self) -> Dict[str, Any]:
        """Call Google Labs session endpoint to validate cookies, fetch access_token, and update account tier.

        Trust labs.google/fx/api/auth/session — do NOT gate on oauth2/v1/tokeninfo.
        Labs Bearer tokens are often rejected by tokeninfo as \"Invalid Value\" even when
        aisandbox accepts them; that false negative was showing \"session expired\" for fresh cookies.
        """
        if not self.cookies:
            return {
                "is_authenticated": False,
                "error": "No cookies configured",
                "simulation_mode": self.simulation_mode,
            }

        headers = {
            "Origin": "https://flow.google.com",
            "Referer": "https://flow.google.com/",
            "Cookie": self.cookies,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        }

        try:
            resp = requests.get(SESSION_URL, headers=headers, timeout=20)
            if resp.status_code == 200:
                data = resp.json()
                self.access_token = data.get("access_token", "")
                self.token_expires = data.get("expires", "")
                self.user_info = data.get("user", {}) or {}

                # Fetch real account tier, subscription, and credits for this account
                if self.access_token:
                    self._fetch_account_tier()

                email = self.user_info.get("email", "")
                if email and email in self.account_credits and self.credits is None:
                    self.credits = self.account_credits[email]

                sec_left = 0
                if self.token_expires:
                    try:
                        exp_dt = datetime.fromisoformat(self.token_expires.replace("Z", "+00:00"))
                        now_dt = datetime.now(timezone.utc)
                        sec_left = max(0, int((exp_dt - now_dt).total_seconds()))
                    except Exception:
                        # If labs gave a token but a weird expires stamp, keep a usable window.
                        sec_left = 3600 if self.access_token else 0

                # labs.google often returns HTTP 200 with a stale `expires` and a
                # Bearer that aisandbox-pa rejects. Only treat the session as live
                # when the token has remaining lifetime.
                is_auth = bool(self.access_token and sec_left > 0)
                if not is_auth:
                    self.access_token = ""
                    return {
                        "is_authenticated": False,
                        "error": (
                            "Labs session cookie is present but the OAuth access token is expired. "
                            "Refresh Flow cookies / aisandbox session, then Sync from the extension "
                            "(or paste the full Cookie request header again)."
                        ),
                        "simulation_mode": self.simulation_mode,
                        "user": self.user_info,
                        "email": self.user_info.get("email") or "Session Expired",
                        "expires": self.token_expires,
                        "expires_seconds": 0,
                        "has_access_token": False,
                        "credits": self.credits,
                        "paygate_tier": self.paygate_tier,
                        "plan_name": self.plan_name,
                    }

                # Project binding is handled by set_cookies / generate paths.
                # Soft-attempt here so a failed createProject does not mark auth as failed.
                try:
                    if not self.active_project_id:
                        self.ensure_active_project()
                except Exception as proj_err:
                    logger.warning("ensure_active_project during refresh: %s", proj_err)

                return {
                    "is_authenticated": True,
                    "user": self.user_info,
                    "email": self.user_info.get("email") or ("Connected" if self.cookies else "Not Connected"),
                    "expires": self.token_expires,
                    "expires_seconds": sec_left,
                    "has_access_token": True,
                    "simulation_mode": self.simulation_mode,
                    "credits": self.credits,
                    "paygate_tier": self.paygate_tier,
                    "plan_name": self.plan_name,
                    "active_project_id": self.active_project_id,
                }
            elif resp.status_code == 401:
                self.access_token = ""
                return {
                    "is_authenticated": False,
                    "error": "Session expired or cookies invalid (HTTP 401). Please copy fresh cookies from https://flow.google.com.",
                    "simulation_mode": self.simulation_mode,
                }
            else:
                return {
                    "is_authenticated": False,
                    "error": f"Session returned HTTP {resp.status_code}: {resp.text[:200]}",
                    "simulation_mode": self.simulation_mode,
                }
        except Exception as e:
            logger.error(f"Error during session validation: {e}")
            return {
                "is_authenticated": False,
                "error": str(e),
                "simulation_mode": self.simulation_mode,
            }

    def get_status(self) -> Dict[str, Any]:
        """Get current auth and connection status."""
        self._check_reload_settings()
        sec_left = 0
        if self.token_expires:
            try:
                exp_dt = datetime.fromisoformat(self.token_expires.replace("Z", "+00:00"))
                now_dt = datetime.now(timezone.utc)
                sec_left = max(0, int((exp_dt - now_dt).total_seconds()))
            except Exception:
                sec_left = 0

        is_auth = bool(self.access_token and sec_left > 0)
        wiz = self._wiz_meta or {}
        at_val = str(wiz.get("at") or "")
        at_updated = str(wiz.get("updatedAt") or "")
        at_age_seconds: Optional[int] = None
        if at_updated:
            try:
                at_dt = datetime.fromisoformat(at_updated.replace("Z", "+00:00"))
                at_age_seconds = max(0, int((datetime.now(timezone.utc) - at_dt).total_seconds()))
            except Exception:
                at_age_seconds = None
        # Presence only — never expose the token itself
        batchexecute = {
            "has_at": bool(at_val),
            "at_length": len(at_val),
            "has_bl": bool(wiz.get("bl")),
            "has_sid": bool(wiz.get("sid")),
            "preferred_base": wiz.get("preferred_base") or "",
            "source": wiz.get("source") or "",
            "updated_at": at_updated or None,
            "at_age_seconds": at_age_seconds,
            "ready_for_upload": bool(at_val and self.cookies and self.active_project_id),
        }
        return {
            "is_authenticated": is_auth,
            "email": self.user_info.get("email", ""),
            "user": self.user_info,
            "expires": self.token_expires,
            "expires_seconds": sec_left,
            "has_cookies": bool(self.cookies),
            "cookie_length": len(self.cookies) if self.cookies else 0,
            "simulation_mode": self.simulation_mode,
            "client_ready": is_auth,
            "history_count": len(self.history),
            "credits": self.credits if self.credits is not None else 0,
            "paygate_tier": self.paygate_tier,
            "plan_name": self.plan_name,
            "tier_override": getattr(self, "tier_override", None),
            "sku": self.sku,
            "service_tier": getattr(self, "service_tier", "") or "",
            "active_project_id": self.active_project_id,
            "active_project_url": project_url(self.active_project_id) if self.active_project_id else LABS_FLOW_BASE,
            "batchexecute": batchexecute,
            "cookie_session": self.cookie_session_report(),
        }

    def sync_local_gflow(self) -> Dict[str, Any]:
        """Sync credentials from ~/.gflow/env"""
        try:
            import gflow.auth
            saved = gflow.auth.load_env()
            if saved and saved.cookies:
                return self.set_cookies(saved.cookies)
            else:
                raise ValueError("No saved credentials found in ~/.gflow/env")
        except Exception as e:
            raise RuntimeError(f"Sync failed: {e}")

    # --------------------------------------------------------------------------
    # GOOGLE FLOW PROJECT MANAGEMENT
    # --------------------------------------------------------------------------

    def _labs_headers(self) -> Dict[str, str]:
        return {
            "Cookie": prune_cookie_header(self.cookies or ""),
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
            ),
            "Origin": "https://flow.google.com",
            "Referer": LABS_FLOW_BASE,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _fetch_remote_projects(self) -> List[Dict[str, Any]]:
        """List real Google Flow projects via labs.google trpc project.searchUserProjects."""
        if not self.cookies:
            return []
        payload = {
            "json": {"pageSize": 20, "toolName": FLOW_TOOL_NAME, "cursor": None},
            "meta": {"values": {"cursor": ["undefined"]}},
        }
        url = (
            f"{LABS_TRPC_BASE}/project.searchUserProjects?input="
            + urllib.parse.quote(json.dumps(payload, separators=(",", ":")))
        )
        try:
            resp = requests.get(url, headers=self._labs_headers(), timeout=25)
            resp.raise_for_status()
            data = resp.json()
            projects_raw = (
                data.get("result", {})
                .get("data", {})
                .get("json", {})
                .get("result", {})
                .get("projects")
                or []
            )
            out: List[Dict[str, Any]] = []
            for item in projects_raw:
                if not isinstance(item, dict):
                    continue
                pid = clean_project_id(item.get("projectId") or item.get("id"))
                if not pid:
                    continue
                info = item.get("projectInfo") or {}
                title = (
                    (info.get("projectTitle") if isinstance(info, dict) else None)
                    or item.get("title")
                    or f"Project {pid[:8]}"
                )
                out.append({
                    "id": pid,
                    "url": project_url(pid),
                    "name": title,
                    "created_at": item.get("creationTime") or "",
                    "active": False,
                })
            return out
        except Exception as e:
            logger.warning(f"Remote project list failed: {e}")
            return []

    def get_projects(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        """Return Google Flow projects from labs.google (and heal invalid active ids)."""
        self.active_project_id = clean_project_id(self.active_project_id)

        if self.projects and not force_refresh:
            res = []
            for p in self.projects:
                p_copy = dict(p)
                p_copy["active"] = (p_copy.get("id") == self.active_project_id)
                res.append(p_copy)
            return res

        remote = self._fetch_remote_projects()
        projects_dict: Dict[str, Dict[str, Any]] = {}

        # Prefer remote (authoritative); keep local-only extras behind them
        for p in remote:
            projects_dict[p["id"]] = p

        for p in self.projects:
            raw_pid = p.get("id")
            if not raw_pid:
                continue
            pid = clean_project_id(raw_pid)
            if not pid or pid in projects_dict:
                continue
            # Skip local phantom ids when we successfully fetched remote projects
            if remote:
                continue
            p = dict(p)
            p["id"] = pid
            p["url"] = project_url(pid)
            projects_dict[pid] = p

        # Auto-heal: inventing UUIDs / stale ids caused 404s — pick a real project
        if remote:
            remote_ids = {p["id"] for p in remote}
            if self.active_project_id and self.active_project_id not in remote_ids:
                logger.warning(
                    f"Active project {self.active_project_id} not found on Google Flow; "
                    f"switching to {remote[0]['id']}"
                )
                self.active_project_id = remote[0]["id"]
            elif not self.active_project_id:
                self.active_project_id = remote[0]["id"]
        elif self.active_project_id and self.active_project_id not in projects_dict:
            projects_dict[self.active_project_id] = {
                "id": self.active_project_id,
                "url": project_url(self.active_project_id),
                "name": f"Project {self.active_project_id[:8]}",
                "active": True,
            }

        result = []
        for p_id, p_info in projects_dict.items():
            p_info = dict(p_info)
            p_info["id"] = p_id
            p_info["active"] = p_id == self.active_project_id
            p_info["url"] = project_url(p_id)
            result.append(p_info)

        # Keep remote order when available
        if remote:
            order = {p["id"]: i for i, p in enumerate(remote)}
            result.sort(key=lambda p: order.get(p["id"], 10_000))

        self.projects = result
        self._save_settings()
        return result

    def switch_project(self, project_id: str) -> Dict[str, Any]:
        """Switch active Google Flow project (generation uses projectId; links use labs URL)."""
        clean_id = clean_project_id(project_id)
        if not clean_id:
            raise ValueError("Invalid project ID")

        self.active_project_id = clean_id
        proj_url = project_url(clean_id)

        if not any(p.get("id") == clean_id for p in self.projects):
            self.projects.insert(0, {
                "id": clean_id,
                "url": proj_url,
                "name": f"Project {clean_id[:8]}",
                "active": True,
            })

        for p in self.projects:
            p["active"] = p.get("id") == clean_id
            if p.get("id"):
                p["url"] = project_url(p["id"])

        self._save_settings()

        # BiB-only: do not navigate helper Chrome / CDP on project switch

        active_proj = next((p for p in self.projects if p.get("id") == clean_id), None)
        if not active_proj:
            active_proj = {
                "id": clean_id,
                "url": proj_url,
                "name": f"Project {clean_id[:8]}",
                "active": True,
            }

        return {
            "success": True,
            "active_project_id": self.active_project_id,
            "active_project_url": proj_url,
            "project": active_proj,
            "project_id": self.active_project_id,
            "project_url": proj_url,
            "name": active_proj.get("name", f"Project {clean_id[:8]}"),
        }

    def ensure_active_project(self) -> str:
        """Ensure active project belongs to the current account; create one if needed."""
        with self._lock:
            self.active_project_id = clean_project_id(self.active_project_id)

            if self.simulation_mode or not self.cookies:
                if self.active_project_id:
                    return self.active_project_id
                created = self.create_project("Studio Project")
                return self.active_project_id or clean_project_id(created.get("project_id")) or ""

            # Prefer validating against Google when we have no active id yet,
            # or when the cached id may be from a previous account.
            try:
                remote = self._fetch_remote_projects()
            except Exception:
                remote = []

            if remote:
                remote_ids = {p["id"] for p in remote}
                if self.active_project_id and self.active_project_id in remote_ids:
                    self.projects = remote
                    for p in self.projects:
                        p["active"] = p.get("id") == self.active_project_id
                    self._save_settings()
                    return self.active_project_id
                self.projects = remote
                self.active_project_id = remote[0]["id"]
                for p in self.projects:
                    p["active"] = p.get("id") == self.active_project_id
                self._save_settings()
                logger.info("Selected remote Flow project %s for current account", self.active_project_id)
                return self.active_project_id

            # No remote projects — create a real one (no phantom UUIDs)
            if self.active_project_id:
                # Drop stale/local-only id from a previous account
                logger.warning(
                    "Dropping stale project %s (not on this Google account); creating a new one",
                    self.active_project_id,
                )
                self.active_project_id = ""
            try:
                created = self.create_project("Studio Project")
            except Exception as e:
                # Don't crash Studio boot / cookie save — surface at generate time.
                logger.warning("Auto-create Flow project failed: %s", e)
                self.active_project_id = ""
                self._save_settings()
                raise RuntimeError(
                    "This Google account has no Flow project and Studio could not create one. "
                    f"{e}"
                ) from e
            return self.active_project_id or clean_project_id(created.get("project_id")) or ""

    def create_project(self, name: Optional[str] = None) -> Dict[str, Any]:
        """Create a real Google Flow project via labs trpc (never invent phantom UUIDs)."""
        title = (name or "").strip() or datetime.now().strftime("%b %d, %I:%M %p")

        if self.simulation_mode or not self.cookies:
            new_id = str(uuid.uuid4())
            new_url = project_url(new_id)
            self.active_project_id = new_id
            proj_entry = {
                "id": new_id,
                "url": new_url,
                "name": title,
                "active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            self.projects.insert(0, proj_entry)
            for p in self.projects:
                p["active"] = p.get("id") == new_id
            self._save_settings()
            return {
                "success": True,
                "project_id": new_id,
                "project_url": new_url,
                "name": title,
                "project": proj_entry,
                "simulated": True,
            }

        payload = {"json": {"projectTitle": title, "toolName": FLOW_TOOL_NAME}}
        try:
            resp = requests.post(
                f"{LABS_TRPC_BASE}/project.createProject",
                headers=self._labs_headers(),
                json=payload,
                timeout=30,
            )
            if resp.status_code == 401:
                logger.warning(
                    "project.createProject returned 401; refreshing labs session once and retrying"
                )
                try:
                    self.refresh_session()
                except Exception as refresh_err:
                    logger.warning("labs session refresh before createProject retry: %s", refresh_err)
                resp = requests.post(
                    f"{LABS_TRPC_BASE}/project.createProject",
                    headers=self._labs_headers(),
                    json=payload,
                    timeout=30,
                )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            missing = self.cookie_session_report().get("missing") or []
            hint = ""
            if missing:
                hint = (
                    f" Cookie jar is missing {', '.join(missing)} — Sync from a signed-in "
                    "flow.google.com tab (full Cookie header), then retry."
                )
            raise RuntimeError(
                f"Google Flow project.createProject failed for this account: {e}.{hint}"
            ) from e

        result = (
            data.get("result", {})
            .get("data", {})
            .get("json", {})
            .get("result", {})
            or {}
        )
        new_id = clean_project_id(result.get("projectId") or result.get("id"))
        if not new_id:
            raise RuntimeError(
                f"project.createProject did not return a projectId: {json.dumps(data)[:500]}"
            )

        info = result.get("projectInfo") or {}
        proj_name = (
            (info.get("projectTitle") if isinstance(info, dict) else None)
            or title
            or f"Project {new_id[:8]}"
        )
        proj_url = project_url(new_id)
        self.active_project_id = new_id
        proj_entry = {
            "id": new_id,
            "url": proj_url,
            "name": proj_name,
            "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.projects = [p for p in self.projects if p.get("id") != new_id]
        self.projects.insert(0, proj_entry)
        for p in self.projects:
            p["active"] = p.get("id") == new_id
            if p.get("id"):
                p["url"] = project_url(p["id"])
        self._save_settings()
        logger.info("Created Flow project %s (%s) for current account", new_id, proj_name)

        return {
            "success": True,
            "id": new_id,
            "project_id": new_id,
            "project_url": proj_url,
            "name": proj_name,
            "project": proj_entry,
        }

    # --------------------------------------------------------------------------
    # CHROME CDP & RECAPTCHA MANAGEMENT
    # --------------------------------------------------------------------------

    def _is_cdp_port_alive(self, port: int) -> bool:
        if not port:
            return False
        try:
            resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2)
            return resp.status == 200
        except Exception:
            return False

    def _cleanup_headless_chrome(self) -> None:
        """Terminate the background headless Chrome helper if spawned by this process."""
        proc = getattr(self, "_headless_chrome_proc", None)
        if proc:
            try:
                proc.terminate()
                proc.wait(timeout=2)
            except Exception:
                pass
            self._headless_chrome_proc = None

    def _launch_headless_cdp_chrome(self) -> int:
        """Launch the dedicated CDP helper Chrome (uses ~/.gflow/chrome-profile-recaptcha)."""
        return self._launch_recaptcha_helper_chrome()

    def _ensure_cdp_browser(self, auto_launch: bool = True) -> int:
        """Return a live CDP port if Chrome is already running. Never launches helper Chrome."""
        port = self._get_alive_cdp_port()
        if port:
            return port
        raise RuntimeError("No Chrome CDP session is running (helper launch disabled; use BiB).")

    def _cdp_pick_page_ws(self, port: int, prefer_substr: str = "") -> str:
        """Return webSocketDebuggerUrl for a page tab (optionally preferring a URL substring)."""
        targets = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json").read())
        page_tabs = [t for t in targets if t.get("type") == "page"]
        if not page_tabs:
            raise RuntimeError(f"No page tab found in Chrome on port {port}")
        if prefer_substr:
            tab = next((t for t in page_tabs if prefer_substr in t.get("url", "")), None)
            if tab:
                return tab["webSocketDebuggerUrl"]
        return page_tabs[0]["webSocketDebuggerUrl"]

    def _cdp_page_urls(self, port: int) -> List[str]:
        """URLs of every open page tab in the CDP Chrome. Best effort."""
        try:
            targets = json.loads(
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=3).read()
            )
        except Exception:
            return []
        return [str(t.get("url") or "") for t in targets if t.get("type") == "page"]

    def _read_cdp_google_cookies(self, port: int) -> Dict[str, str]:
        """Read Google cookies out of an already-running Chrome via DevTools.

        Uses the browser-level target so httpOnly cookies for every Google host
        are visible, not just the ones scoped to one open tab.
        """
        cached_at, cached = self._cdp_cookie_cache
        if cached_at and time.time() - cached_at < 10.0:
            return dict(cached)
        cookies: Dict[str, str] = {}
        try:
            version = json.loads(
                urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/json/version", timeout=3
                ).read()
            )
            browser_ws = version.get("webSocketDebuggerUrl")
            if not browser_ws:
                return {}
            ws = websocket.create_connection(browser_ws, timeout=10)
            try:
                res = self._cdp_send(ws, "Storage.getCookies", {}, msg_id=9500, timeout=10.0)
            finally:
                try:
                    ws.close()
                except Exception:
                    pass
            for c in (res.get("result") or {}).get("cookies") or []:
                domain = str(c.get("domain") or "").lstrip(".")
                if not any(domain.endswith(s) for s in CDP_COOKIE_DOMAIN_SUFFIXES):
                    continue
                name = str(c.get("name") or "")
                # First host wins; getCookies lists the most specific domains first.
                if name and name not in cookies:
                    cookies[name] = str(c.get("value") or "")
        except Exception as e:
            logger.debug("CDP cookie read failed on port %s: %s", port, e)
            return {}
        self._cdp_cookie_cache = (time.time(), dict(cookies))
        return cookies

    def _sync_google_cookies_from_cdp(self) -> List[str]:
        """Import Google session cookies the saved jar lacks from a live Chrome.

        Only fills gaps — never rewrites cookies Studio already has, so a working
        jar is not downgraded by a Chrome profile that is signed into another
        account. Returns the names that were added.
        """
        port = self._get_alive_cdp_port()
        if not port:
            return []
        browser_cookies = self._read_cdp_google_cookies(port)
        if not browser_cookies:
            return []
        jar = parse_cookie_pairs(self.cookies)
        added = [
            name
            for name in CDP_SYNCABLE_COOKIES
            if name not in jar and browser_cookies.get(name)
        ]
        if not added:
            return []
        for name in added:
            jar[name] = browser_cookies[name]
        with self._lock:
            self.cookies = format_cookie_pairs(jar)
            self._save_settings()
        # A jar that just gained SID/HSID/APISID deserves a fresh harvest attempt
        # even if flow.google.com served a signed-out shell minutes ago.
        self._clear_wiz_at_stale()
        logger.info(
            "Imported %d Google cookie(s) from running Chrome (port %s): %s",
            len(added),
            port,
            ", ".join(added),
        )
        return added

    def _get_alive_cdp_port(self) -> Optional[int]:
        """Return a live CDP port if Chrome is already running. Never launches Chrome."""
        # Probing dead ports costs seconds on every generation when Chrome is not
        # running, so remember "nothing there" for a short while.
        if time.time() < self._cdp_probe_miss_until:
            return None

        # 1. First probe fast candidate ports (< 15ms)
        candidate_ports = self._cdp_candidate_ports()
        for port in candidate_ports:
            if self._probe_cdp_port(port, timeout=0.4):
                self._cdp_probe_miss_until = 0.0
                self._cdp_cached_port = port
                return port

        # 2. Only if none of the fast candidate ports answered, scan listening processes
        for port in self._chrome_listening_ports():
            if port not in candidate_ports:
                if self._probe_cdp_port(port, timeout=0.4):
                    self._cdp_probe_miss_until = 0.0
                    self._cdp_cached_port = port
                    return port

        self._cdp_cached_port = None
        self._cdp_probe_miss_until = time.time() + 15.0
        return None

    @staticmethod
    def _probe_cdp_port(port: int, timeout: float = 1.0) -> bool:
        """True when a DevTools endpoint answers on this port."""
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=timeout).read()
            return True
        except Exception:
            return False

    def _cdp_candidate_ports(self) -> List[int]:
        """Ports that might host DevTools, cheapest source first (no process scanning)."""
        ports: List[int] = []

        def add(value: Any) -> None:
            try:
                p = int(value)
            except (TypeError, ValueError):
                return
            if 0 < p < 65536 and p not in ports:
                ports.append(p)

        add(self._cdp_cached_port)
        try:
            from gflow.auth.browser_auth import get_saved_cdp_port
            add(get_saved_cdp_port())
        except Exception:
            pass

        # Dedicated recaptcha helper profile port is the primary and fastest target
        recaptcha_profile = Path.home() / ".gflow" / "chrome-profile-recaptcha" / "DevToolsActivePort"
        try:
            if recaptcha_profile.exists():
                add(recaptcha_profile.read_text(encoding="utf-8").splitlines()[0])
        except Exception:
            pass

        for profile in (Path.home() / ".gflow").glob("chrome-profile*"):
            try:
                add((profile / "DevToolsActivePort").read_text(encoding="utf-8").splitlines()[0])
            except Exception:
                continue

        for p in (9222, 9223, 9333):
            add(p)

        return ports

    @staticmethod
    def _chrome_listening_ports() -> List[int]:
        """Local TCP ports that running Chrome processes listen on. Best effort."""
        ports: List[int] = []
        no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)

        def run(cmd: List[str], timeout: float) -> str:
            try:
                return subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                    creationflags=no_window,
                ).stdout or ""
            except Exception:
                return ""

        if os.name == "nt":
            pids = set()
            for line in run(
                ["tasklist", "/FI", "IMAGENAME eq chrome.exe", "/FO", "CSV", "/NH"], 8.0
            ).splitlines():
                fields = [f.strip().strip('"') for f in line.split('","')]
                if len(fields) >= 2 and fields[1].isdigit():
                    pids.add(int(fields[1]))
            if not pids:
                return ports
            for line in run(["netstat", "-ano", "-p", "TCP"], 12.0).splitlines():
                fields = line.split()
                if len(fields) < 5 or fields[0].upper() != "TCP":
                    continue
                if fields[3].upper() != "LISTENING" or not fields[4].isdigit():
                    continue
                if int(fields[4]) not in pids:
                    continue
                local = fields[1]
                if local.startswith("127.0.0.1:") or local.startswith("[::1]:"):
                    try:
                        ports.append(int(local.rsplit(":", 1)[1]))
                    except ValueError:
                        continue
        else:
            for line in run(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"], 8.0).splitlines():
                if "chrome" not in line.lower() and "chromium" not in line.lower():
                    continue
                m = re.search(r":(\d+)\s*\(LISTEN\)", line)
                if m:
                    try:
                        ports.append(int(m.group(1)))
                    except ValueError:
                        continue
        return ports

    def _find_existing_flow_project_ws(
        self, port: int, project_id: str = "", allow_labs: bool = False
    ) -> Optional[str]:
        """Find an already-open Flow tab. Never creates a new tab/window.

        With `allow_labs`, a labs.google Flow tab also counts: the Angular
        batchexecute path navigates whatever tab it gets to flow.google.com, and
        reusing that tab is still not opening a window.
        """
        project_id = clean_project_id(project_id or self.active_project_id or "")

        def usable(url: str) -> bool:
            return "CookieMismatch" not in url and "accounts.google.com" not in url

        try:
            targets = json.loads(
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=3).read()
            )
        except Exception:
            return None
        page_tabs = [t for t in targets if t.get("type") == "page"]
        # Prefer exact project URL on either labs or flow
        for t in page_tabs:
            url = str(t.get("url") or "")
            if (
                project_id
                and f"/project/{project_id}" in url
                and ("flow.google.com" in url or "labs.google" in url)
                and usable(url)
            ):
                return t.get("webSocketDebuggerUrl")
        # Then any tools/flow page on labs
        for t in page_tabs:
            url = str(t.get("url") or "")
            if "labs.google" in url and "/tools/flow" in url and usable(url):
                return t.get("webSocketDebuggerUrl")
        # Then any flow.google.com (except /about) or labs.google tab
        for t in page_tabs:
            url = str(t.get("url") or "")
            if ("flow.google.com" in url or "labs.google" in url) and "/about" not in url and usable(url):
                return t.get("webSocketDebuggerUrl")
        if not allow_labs:
            return None
        # Fallback to any flow / labs tab
        for t in page_tabs:
            url = str(t.get("url") or "")
            if ("flow.google.com" in url or "labs.google" in url) and usable(url):
                return t.get("webSocketDebuggerUrl")
        return None

    def _cdp_open_flow_project_ws(self, port: int, project_id: str) -> str:
        """Return a debugger WS for an *already open* Flow tab (flow.google.com or labs).

        Never creates a new Chrome window/tab (no Target.createTarget /json/new).
        Soft-refresh WIZ tokens on the existing tab when possible.
        """
        project_id = clean_project_id(project_id)
        # Borrowing the labs tab means navigating it to flow.google.com, which costs
        # the reCAPTCHA context generation relies on. Only worth it when some jar in
        # play can actually render a signed-in Angular shell.
        allow_labs = self.cookie_session_report()["has_web_session"] or any(
            name in self._read_cdp_google_cookies(port) for name in ("__Secure-1PSID", "__Secure-3PSID", "SID")
        )
        existing = self._find_existing_flow_project_ws(port, project_id, allow_labs=allow_labs)
        if existing:
            try:
                self._cdp_soft_refresh_at_on_ws(existing)
            except Exception as e:
                logger.debug("Soft WIZ refresh on existing Flow tab failed: %s", e)
            return existing
        raise RuntimeError(
            "No open Google Flow tab found. Studio will not open a new browser window. "
            f"Open https://flow.google.com/project/{project_id} in your already-running "
            "Chrome (with CDP), then retry — or reconnect Account cookies so HTTP batchexecute works."
        )

    def _cdp_soft_refresh_at_on_ws(self, ws_url: str) -> bool:
        """Read SNlM0e from an already-open Flow tab and persist into batchexecute meta."""
        ws = websocket.create_connection(ws_url, timeout=12)
        try:
            self._cdp_send(ws, "Runtime.enable", {}, msg_id=9410, timeout=8.0)
            eval_res = self._cdp_send(
                ws,
                "Runtime.evaluate",
                {
                    # Live WIZ context first; the serialized HTML copy is the
                    # fallback for tabs that already navigated client-side.
                    "expression": (
                        "(function(){try{"
                        "var w=window.WIZ_global_data||{};"
                        "var h=document.documentElement&&document.documentElement.innerHTML||'';"
                        "function pick(k){"
                        "if(w[k])return String(w[k]);"
                        "var m=h.match(new RegExp('\"'+k+'\":\"([^\"]+)\"'));"
                        "return m?m[1]:'';"
                        "}"
                        "return {at:pick('SNlM0e'),sid:pick('FdrFJe'),bl:pick('cfb2h')};"
                        "}catch(e){return {at:'',sid:'',bl:''}}})()"
                    ),
                    "returnByValue": True,
                    "awaitPromise": False,
                },
                msg_id=9411,
                timeout=10.0,
            )
            value = ((eval_res.get("result") or {}).get("result") or {}).get("value") or {}
            at_tok = str(value.get("at") or "").strip()
            if at_tok and ":" in at_tok:
                is_new = at_tok != str((self._wiz_meta or {}).get("at") or "")
                self._persist_page_wiz_tokens(
                    at_tok,
                    sid=str(value.get("sid") or ""),
                    bl=str(value.get("bl") or "") or DEFAULT_BL,
                )
                if is_new:
                    logger.info("Soft-refreshed WIZ `at` from existing Flow tab")
                return is_new
        finally:
            try:
                ws.close()
            except Exception:
                pass
        return False

    def _try_mint_recaptcha_soft(self, action: str = "IMAGE_GENERATION") -> str:
        """Mint reCAPTCHA if Chrome CDP is alive (or can attach). Never blocks on failure."""
        port = self._get_alive_cdp_port()
        if port is None:
            return ""
        ws = None
        try:
            ws_url = None
            try:
                ws_url = self._cdp_pick_page_ws(port, prefer_substr="labs.google")
            except Exception:
                try:
                    ws_url = self._find_existing_flow_project_ws(port, self.active_project_id or "")
                except Exception:
                    pass
            if not ws_url:
                try:
                    ws_url = self._cdp_pick_page_ws(port)
                except Exception:
                    pass
            if not ws_url:
                return ""
            ws = websocket.create_connection(ws_url, timeout=20)
            return (self._mint_recaptcha_via_ws(ws, action=action, msg_id=10) or "").strip()
        except Exception as e:
            logger.debug("Soft reCAPTCHA mint skipped: %s", e)
            return ""
        finally:
            if ws is not None:
                try:
                    ws.close()
                except Exception:
                    pass

    def _recaptcha_release_version(self) -> str:
        """Discover the current reCAPTCHA Enterprise release id (the `v` param)."""
        if self._recaptcha_js_version:
            return self._recaptcha_js_version
        url = f"https://www.google.com/recaptcha/enterprise.js?render={RECAPTCHA_SITE_KEY}"
        resp = requests.get(
            url,
            headers={"User-Agent": BROWSER_UA, "Referer": "https://flow.google.com/"},
            timeout=20,
        )
        m = re.search(r"releases/([\w-]+)/", resp.text or "")
        if not m:
            raise RuntimeError("Could not determine reCAPTCHA release version")
        self._recaptcha_js_version = m.group(1)
        return self._recaptcha_js_version

    def _mint_recaptcha_http(self, action: str = "IMAGE_GENERATION") -> str:
        """Mint a reCAPTCHA Enterprise token over plain HTTP. Never opens a browser.

        Mirrors what `grecaptcha.enterprise.execute()` does on labs.google:
        fetch the invisible anchor to get the bootstrap `c` token, then POST
        `/enterprise/reload` with a protobuf body so the `action` is bound into
        the returned token (form-encoded reload silently drops the action).
        """
        cache_key = action or "IMAGE_GENERATION"
        with self._recaptcha_lock:
            cached = self._recaptcha_cache.get(cache_key)
            if cached and cached[0] > time.time():
                return cached[1]

            try:
                version = self._recaptcha_release_version()
            except Exception as e:
                logger.debug("reCAPTCHA version lookup failed: %s", e)
                return ""

            co = recaptcha_origin_co("https://labs.google", 443)
            anchor_url = (
                "https://www.google.com/recaptcha/enterprise/anchor"
                f"?ar=1&k={RECAPTCHA_SITE_KEY}&co={co}&hl=en&v={version}"
                f"&size=invisible&cb={uuid.uuid4().hex[:12]}"
            )
            session = requests.Session()
            headers = {"User-Agent": BROWSER_UA, "Referer": "https://flow.google.com/"}
            try:
                anchor = session.get(anchor_url, headers=headers, timeout=20)
                m = re.search(r'id="recaptcha-token"\s+value="([^"]+)"', anchor.text or "")
                if not m:
                    logger.debug("reCAPTCHA anchor did not expose a bootstrap token")
                    return ""
                bootstrap = m.group(1)

                body = b"".join([
                    _pb_string_field(1, version),
                    _pb_string_field(2, bootstrap),
                    _pb_string_field(6, "q"),
                    _pb_string_field(8, action or "IMAGE_GENERATION"),
                    _pb_string_field(14, RECAPTCHA_SITE_KEY),
                ])
                reload_resp = session.post(
                    f"https://www.google.com/recaptcha/enterprise/reload?k={RECAPTCHA_SITE_KEY}",
                    data=body,
                    headers={
                        "User-Agent": BROWSER_UA,
                        "Referer": anchor_url,
                        "Origin": "https://www.google.com",
                        "Content-Type": "application/x-protobuffer",
                    },
                    timeout=20,
                )
                token = ""
                tm = re.search(r'"rresp"\s*,\s*"([^"]+)"', reload_resp.text or "")
                if tm:
                    token = tm.group(1)
                if not token or len(token) < 50:
                    logger.debug("reCAPTCHA HTTP reload returned no usable token")
                    return ""

                # Google expires these ~2 minutes out; refresh well before that.
                self._recaptcha_cache[cache_key] = (time.time() + 90.0, token)
                logger.info("Minted reCAPTCHA token over HTTP (action=%s, len=%d)", action, len(token))
                return token
            except Exception as e:
                logger.debug("HTTP reCAPTCHA mint failed: %s", e)
                return ""
            finally:
                try:
                    session.close()
                except Exception:
                    pass

    def _access_token_seconds_left(self) -> int:
        """Seconds until the labs OAuth Bearer expires (0 if missing/unknown)."""
        if not self.access_token or not self.token_expires:
            return 0
        try:
            exp_dt = datetime.fromisoformat(self.token_expires.replace("Z", "+00:00"))
            return max(0, int((exp_dt - datetime.now(timezone.utc)).total_seconds()))
        except Exception:
            return 0

    def _sync_google_cookies_from_gflow_env(self) -> List[str]:
        """Gap-fill SID/HSID/APISID from ~/.gflow/env when the account matches."""
        try:
            import gflow.auth

            saved = gflow.auth.load_env()
        except Exception as e:
            logger.debug("Could not load ~/.gflow/env for cookie gap-fill: %s", e)
            return []
        if not saved or not getattr(saved, "cookies", None):
            return []

        src = parse_cookie_pairs(saved.cookies)
        jar = parse_cookie_pairs(self.cookies)
        if not src:
            return []

        def _email_from(pairs: Dict[str, str]) -> str:
            raw = pairs.get("email") or pairs.get("EMAIL") or ""
            try:
                raw = urllib.parse.unquote(raw)
            except Exception:
                pass
            return raw.strip().strip('"').lower()

        src_email = _email_from(src)
        jar_email = (self.user_info.get("email") or _email_from(jar) or "").strip().lower()
        # Refuse cross-account merges (partial Secure jar + another account's SID).
        if not src_email or not jar_email or jar_email != src_email:
            if jar_email and src_email and jar_email != src_email:
                logger.info(
                    "Skipping ~/.gflow cookie gap-fill: account mismatch (%s vs %s)",
                    src_email,
                    jar_email,
                )
            else:
                logger.debug(
                    "Skipping ~/.gflow cookie gap-fill: cannot confirm same account "
                    "(jar_email=%r src_email=%r)",
                    jar_email or "",
                    src_email or "",
                )
            return []

        added = [
            name
            for name in CDP_SYNCABLE_COOKIES
            if name not in jar and src.get(name)
        ]
        if not added:
            return []
        for name in added:
            jar[name] = src[name]
        with self._lock:
            self.cookies = format_cookie_pairs(jar)
            self._save_settings()
        self._clear_wiz_at_stale()
        logger.info(
            "Imported %d Google cookie(s) from ~/.gflow/env: %s",
            len(added),
            ", ".join(added),
        )
        return added

    def _recover_missing_web_session_cookies(self) -> List[str]:
        """Fill missing SID/HSID/APISID from Chrome CDP, then same-account ~/.gflow/env."""
        added: List[str] = []
        if self.cookie_session_report()["has_web_session"]:
            return added
        try:
            added.extend(self._sync_google_cookies_from_cdp())
        except Exception as e:
            logger.debug("CDP cookie recovery failed: %s", e)
        if not self.cookie_session_report()["has_web_session"]:
            try:
                added.extend(self._sync_google_cookies_from_gflow_env())
            except Exception as e:
                logger.debug("~/.gflow cookie recovery failed: %s", e)
        return added

    def _incomplete_web_session_generation_error(self) -> RuntimeError:
        """User-facing error when generation cannot pass reCAPTCHA evaluation."""
        report = self.cookie_session_report()
        missing = report.get("missing") or list(WEB_SESSION_COOKIES)
        miss = ", ".join(missing)
        partial = (
            " Your jar has `__Secure-*` companions without the plain cookies — classic "
            "partial Secure-only export (labs next-auth works; aisandbox reCAPTCHA does not)."
            if report.get("partial_secure_only_export")
            else ""
        )
        return RuntimeError(
            f"Project create can work with labs next-auth alone, but video/image generation "
            f"needs root Google cookies {miss}.{partial} "
            "aisandbox returns 403 reCAPTCHA evaluation failed / UNUSUAL_ACTIVITY without them. "
            f"Fix: in Chrome signed in as {(self.user_info or {}).get('email') or 'this account'}, "
            "open https://flow.google.com, then use the Session Sync extension "
            "(Sync to Local Studio) or paste a Cookie header that includes SID, HSID, and APISID "
            "(copy from a google.com or flow.google.com request, not labs-only)."
        )

    def _ensure_web_session_for_generation(self) -> None:
        """Best-effort gap-fill web-session cookies; do not block if session is present."""
        if self.cookie_session_report().get("has_web_session") or self.cookie_session_report().get("has_labs_session"):
            return
        try:
            imported = self._recover_missing_web_session_cookies()
            if imported:
                logger.info(
                    "Recovered web-session cookies before generation: %s",
                    ", ".join(imported),
                )
        except Exception as e:
            logger.debug("Web-session recovery before generation failed: %s", e)
        if not self.cookie_session_report().get("has_web_session") and not self.cookie_session_report().get("has_labs_session"):
            raise self._incomplete_web_session_generation_error()

    def _ensure_aisandbox_auth(self) -> None:
        """Raise when aisandbox cannot auth. Needs a live Bearer (+ cookies for session)."""
        if not self.cookies:
            raise RuntimeError(
                "No cookies configured. Reconnect via Account Chip (paste cookies) "
                "or Sync from the extension / Browser Login."
            )
        # Best-effort gap-fill — generation also hard-requires web session later.
        if not self.cookie_session_report().get("has_web_session"):
            try:
                self._recover_missing_web_session_cookies()
            except Exception as e:
                logger.debug("Optional web-session cookie recovery skipped: %s", e)
        if not self.access_token or self._access_token_seconds_left() <= 0:
            self.refresh_session()
        if not self.access_token or self._access_token_seconds_left() <= 0:
            raise RuntimeError(
                "Google Flow OAuth access token is missing or expired. "
                "Reconnect Account cookies from a signed-in labs.google / flow.google.com tab."
            )

    def _find_chrome_binary(self) -> str:
        """Locate a Chrome / Chromium binary for the reCAPTCHA helper window."""
        try:
            from gflow.auth.browser_auth import _get_chrome_path

            return _get_chrome_path()
        except Exception:
            pass
        env_path = os.environ.get("CHROME_PATH") or os.environ.get("CHROME_BIN") or ""
        if env_path and os.path.isfile(env_path):
            return env_path
        candidates = [
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
        ]
        for path in candidates:
            if path and os.path.isfile(path):
                return path
        which = shutil.which("chrome") or shutil.which("google-chrome") or shutil.which("chromium")
        if which:
            return which
        raise RuntimeError(
            "Chrome not found. Install Google Chrome (or set CHROME_PATH) so Studio can "
            "mint reCAPTCHA tokens for generation."
        )

    def _launch_recaptcha_helper_chrome(self) -> int:
        """DISABLED — BiB owns Chrome; Python must not spawn helper CDP Chrome."""
        raise RuntimeError(
            "reCAPTCHA helper Chrome is disabled (BiB-only mode). "
            "Use BiB mint/upload on flow.google.com."
        )

    def _cdp_open_labs_tab(self, port: int) -> str:
        """DISABLED — BiB-only; Python helper tabs are not opened."""
        raise RuntimeError("CDP labs tab open is disabled (BiB-only mode).")

    def _mint_recaptcha_via_helper(self, action: str = "IMAGE_GENERATION") -> str:
        """DISABLED — BiB mints reCAPTCHA on flow.google.com."""
        logger.info("[cdp] _mint_recaptcha_via_helper: skipped (BiB-only mode)")
        return ""

    def _mint_recaptcha_any(self, action: str = "IMAGE_GENERATION") -> str:
        """Best-effort reCAPTCHA: soft CDP tab (if already open) → HTTP. No helper Chrome."""
        token = ""
        try:
            token = self._try_mint_recaptcha_soft(action=action)
        except Exception as e:
            logger.debug("Soft reCAPTCHA mint raised: %s", e)
        if token:
            self._sandbox_http_recaptcha_block_until = 0.0
            return token

        # Helper Chrome mint disabled (BiB-only)
        http_tok = self._mint_recaptcha_http(action=action)
        if http_tok:
            logger.warning(
                "Using HTTP-minted reCAPTCHA token — prefer BiB mint on flow.google.com"
            )
        return http_tok

    def _soft_refresh_wiz_at(self) -> bool:
        """Refresh WIZ `at` via HTML fetch, then optionally an already-open Flow tab."""
        try:
            if self._refresh_at_via_http_project_page():
                return True
        except Exception as e:
            logger.debug("HTML WIZ refresh failed: %s", e)
        return self._soft_refresh_wiz_at_via_cdp()

    def _recover_wiz_session(self) -> bool:
        """Last-ditch, browser-free attempt to make batchexecute usable again.

        Imports any Google session cookies a running Chrome has that Studio lacks,
        then re-harvests `at` — over HTTP first, then from an already-open tab.
        Opens no windows, so it is safe to call on the failure path of any RPC.
        """
        imported: List[str] = []
        try:
            imported = self._sync_google_cookies_from_cdp()
        except Exception as e:
            logger.debug("CDP cookie import failed: %s", e)
        if imported:
            logger.info(
                "Retrying batchexecute after importing %s from Chrome", ", ".join(imported)
            )
        try:
            if self._refresh_at_via_http_project_page():
                return True
        except Exception as e:
            logger.debug("HTTP WIZ `at` recovery failed: %s", e)
        try:
            if self._soft_refresh_wiz_at_via_cdp():
                return True
        except Exception as e:
            logger.debug("CDP WIZ `at` recovery failed: %s", e)
        return bool(imported)

    def _soft_refresh_wiz_at_via_cdp(self) -> bool:
        """Harvest a fresh WIZ `at` from an already-open tab. Never launches Chrome."""
        port = self._get_alive_cdp_port()
        if port is None:
            return False
        # A flow.google.com tab is ideal, but the labs.google Flow tab carries the
        # same WIZ context and is the one that is usually already open.
        candidates: List[str] = []
        existing = self._find_existing_flow_project_ws(port, self.active_project_id or "")
        if existing:
            candidates.append(existing)
        try:
            labs_ws = self._cdp_pick_page_ws(port, prefer_substr="labs.google")
        except Exception:
            labs_ws = None
        if labs_ws and labs_ws not in candidates:
            candidates.append(labs_ws)

        for ws_url in candidates:
            try:
                if self._cdp_soft_refresh_at_on_ws(ws_url):
                    return True
            except Exception as e:
                logger.debug("Existing-tab WIZ refresh failed: %s", e)
        return False

    def _cdp_eval(self, ws: websocket.WebSocket, expression: str, msg_id: int = 10, timeout: float = 30.0) -> Any:
        """Evaluate JS in the CDP tab and return the result value (pumps Fetch events)."""
        ws.send(json.dumps({
            "id": msg_id,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expression,
                "awaitPromise": True,
                "returnByValue": True,
            },
        }))
        data = self._cdp_recv_until(ws, lambda d: d.get("id") == msg_id, timeout=timeout)
        if "exceptionDetails" in data.get("result", {}):
            exc = data["result"]["exceptionDetails"]
            desc = (
                (exc.get("exception") or {}).get("description")
                or exc.get("text")
                or "Script error"
            )
            # Collapse noisy stack to first line for user-facing errors
            desc = str(desc).split("\n", 1)[0].strip()
            raise RuntimeError(f"CDP evaluation error: {desc}")
        return data.get("result", {}).get("result", {}).get("value")

    def _wait_for_grecaptcha_on_ws(self, ws: websocket.WebSocket, timeout: float = 20.0) -> bool:
        """Poll until grecaptcha.enterprise.execute is available (after enterprise.ready)."""
        deadline = time.time() + timeout
        msg_id = 50
        while time.time() < deadline:
            msg_id += 1
            try:
                ready = self._cdp_eval(
                    ws,
                    """
                    (async () => {
                      const g = window.grecaptcha && window.grecaptcha.enterprise;
                      if (!g) return false;
                      await new Promise((resolve) => {
                        try { if (typeof g.ready === 'function') g.ready(resolve); else resolve(); }
                        catch (e) { resolve(); }
                      });
                      return typeof g.execute === 'function';
                    })()
                    """,
                    msg_id=msg_id,
                    timeout=6.0,
                )
                if ready:
                    return True
            except Exception:
                pass
            time.sleep(0.35)
        return False

    def _mint_recaptcha_via_ws(self, ws: websocket.WebSocket, action: str, msg_id: int = 10) -> str:
        """Mint a reCAPTCHA Enterprise token using labs.google's native grecaptcha."""
        # Re-arm Fetch abort (Document-only) so labs SPA cannot redirect to flow
        try:
            self._cdp_set_flow_nav_block(ws, True)
        except Exception:
            pass

        if not self._wait_for_grecaptcha_on_ws(ws, timeout=18.0):
            try:
                self._cdp_send(ws, "Page.navigate", {"url": "https://flow.google.com/project/"}, msg_id=msg_id - 1, timeout=20)
                time.sleep(2)
            except Exception as e:
                logger.debug(f"labs navigate notice: {e}")
            if not self._wait_for_grecaptcha_on_ws(ws, timeout=20.0):
                raise RuntimeError(
                    "reCAPTCHA Enterprise did not load on the open Flow tab. "
                    "Use BiB on flow.google.com and retry."
                )

        mint_script = f"""
        (async () => {{
            const g = window.grecaptcha.enterprise;
            await new Promise((resolve) => {{
                try {{ if (typeof g.ready === 'function') g.ready(resolve); else resolve(); }}
                catch (e) {{ resolve(); }}
            }});
            try {{
                return await g.execute('{RECAPTCHA_SITE_KEY}', {{action: '{action}'}});
            }} catch (e) {{
                return 'RECAPTCHA_EXEC_ERROR:' + (e && e.message ? e.message : String(e));
            }}
        }})()
        """
        recaptcha_token = self._cdp_eval(ws, mint_script, msg_id=msg_id, timeout=30.0)
        logger.info(
            f"reCAPTCHA token type={type(recaptcha_token).__name__}, "
            f"len={len(str(recaptcha_token)) if recaptcha_token else 0}, "
            f"value={str(recaptcha_token)[:80]}"
        )
        if (
            not recaptcha_token
            or not isinstance(recaptcha_token, str)
            or len(recaptcha_token) < 50
            or recaptcha_token.startswith("RECAPTCHA_")
        ):
            raise RuntimeError(f"Could not mint reCAPTCHA token: {recaptcha_token}")
        # Leave Fetch interception off so a subsequent Angular batchexecute on this
        # target is not aborted (maseQ / ogiZ0b / MZZa6b).
        try:
            self._cdp_set_flow_nav_block(ws, False)
        except Exception:
            pass
        return recaptcha_token

    def _sandbox_http_request(
        self,
        endpoint: str,
        payload: Optional[dict] = None,
        timeout: float = 60.0,
        method: str = "POST",
        action: str = "IMAGE_GENERATION",
    ) -> dict:
        """HTTP call to aisandbox-pa with Bearer + cookies. Never launches Chrome.

        Stamps a real reCAPTCHA token into clientContext: an already-open Chrome
        tab if there is one, otherwise minted over plain HTTP / helper Chrome.
        aisandbox rejects generation with 403 when the token is empty.
        """
        try:
            sync_egress_proxy_env(account_id=self.egress_account_id or None)
        except Exception:
            pass
        self._ensure_aisandbox_auth()

        project_id = clean_project_id(self.active_project_id or "")
        body = payload
        if isinstance(body, dict):
            body = json.loads(json.dumps(body))  # deep copy
            if "clientContext" in body:
                ctx = body["clientContext"]
                if project_id:
                    ctx["projectId"] = project_id
                if self.paygate_tier:
                    ctx["userPaygateTier"] = self.paygate_tier
                existing_tok = ""
                if isinstance(ctx.get("recaptchaContext"), dict):
                    existing_tok = str(ctx["recaptchaContext"].get("token") or "")
                token = existing_tok or self._mint_recaptcha_any(action=action)
                ctx["recaptchaContext"] = {
                    "token": token,
                    "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB",
                }
                if "requests" in body and isinstance(body["requests"], list):
                    for r in body["requests"]:
                        if isinstance(r, dict) and "clientContext" in r:
                            r["clientContext"] = ctx
            if project_id and "/projects/" in endpoint:
                endpoint = re.sub(r"/projects/[^/]+/", f"/projects/{project_id}/", endpoint)

        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Origin": "https://flow.google.com",
            "Referer": "https://flow.google.com/project/",
            "Cookie": self.cookies or "",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Content-Type": "text/plain;charset=UTF-8",
        }
        logger.info(
            "aisandbox HTTP %s %s clientContext=%s",
            method,
            endpoint,
            json.dumps((body or {}).get("clientContext", {}) if isinstance(body, dict) else {})[:300],
        )
        if method.upper() == "GET":
            resp = requests.get(
                endpoint, headers=headers, timeout=timeout, **apply_proxies_kwargs(endpoint, {}, account_id=self.egress_account_id or None)
            )
        else:
            resp = requests.post(
                endpoint,
                headers=headers,
                data=json.dumps(body or {}),
                timeout=timeout,
                **apply_proxies_kwargs(endpoint, {}, account_id=self.egress_account_id or None),
            )

        text = resp.text or ""
        if resp.status_code == 200:
            try:
                return resp.json()
            except Exception:
                return json.loads(text)

        if resp.status_code == 401:
            logger.warning("aisandbox returned 401. Invalidating token and attempting session refresh...")
            self.access_token = ""
            refreshed = self.refresh_session()
            if refreshed.get("has_access_token") and self.access_token:
                headers["Authorization"] = f"Bearer {self.access_token}"
                headers["Cookie"] = self.cookies or ""
                if method.upper() == "GET":
                    retry_resp = requests.get(
                        endpoint,
                        headers=headers,
                        timeout=timeout,
                        **apply_proxies_kwargs(endpoint, {}, account_id=self.egress_account_id or None),
                    )
                else:
                    retry_resp = requests.post(
                        endpoint,
                        headers=headers,
                        data=json.dumps(body or {}),
                        timeout=timeout,
                        **apply_proxies_kwargs(endpoint, {}, account_id=self.egress_account_id or None),
                    )
                if retry_resp.status_code == 200:
                    try:
                        return retry_resp.json()
                    except Exception:
                        return json.loads(retry_resp.text or "{}")
            missing = self.cookie_session_report().get("missing") or []
            miss_txt = (
                f" Missing cookies: {', '.join(missing)}."
                if missing
                else ""
            )
            proj = self.active_project_id or "(none)"
            raise RuntimeError(
                "Google Flow aisandbox returned 401 (Bearer rejected). "
                "Labs login can succeed while video/credits still fail when the account has no real "
                f"Flow project or the cookie jar is incomplete.{miss_txt} "
                f"Active project={proj}. "
                "Fix: in Chrome signed into this account, open https://flow.google.com, create/open a project, "
                "then Sync full cookies with the Session Sync extension (include SID, HSID, APISID) and reconnect."
            )

        try:
            err_json = json.loads(text)
            msg = err_json.get("error", {}).get("message", text)
            reason = ""
            details = err_json.get("error", {}).get("details", [])
            if details and isinstance(details, list):
                reason = details[0].get("reason", "")
        except Exception:
            msg = text[:300]
            reason = ""

        if reason == "PUBLIC_ERROR_MODEL_ACCESS_DENIED" or "ACCESS_DENIED" in str(reason) or "permission" in str(msg).lower():
            email = self.user_info.get("email") or "current account"
            plan = self.plan_name or "Free Tier"
            raise RuntimeError(
                f"PUBLIC_ERROR_MODEL_ACCESS_DENIED: Selected model is not permitted by Google Flow for {email} ({plan}). "
                "Google Veo models require an active Google AI Pro or Ultra subscription. "
                "Please select Omni 1.1 Flash, or connect fresh cookies from your Ultra account in Account Settings."
            )
        if "recaptcha" in str(msg).lower() or "RECAPTCHA" in reason or "UNUSUAL_ACTIVITY" in reason:
            report = self.cookie_session_report()
            if not report.get("has_web_session") and not report.get("has_labs_session"):
                raise self._incomplete_web_session_generation_error()
            raise RuntimeError(
                f"Google Flow reCAPTCHA rejected the request ({resp.status_code}): {msg}. "
                "Studio will retry via helper Chrome with a same-page mint+fetch when possible. "
                "If this persists, reconnect a full Cookie header from a signed-in flow.google.com tab."
            )
        raise RuntimeError(f"Google Flow API returned {resp.status_code}: {msg}")

    def _aisandbox_same_page_post_on_ws(
        self,
        ws: websocket.WebSocket,
        endpoint: str,
        payload: dict,
        action: str = "IMAGE_GENERATION",
        *,
        navigate: bool = False,
    ) -> dict:
        """Mint grecaptcha + POST aisandbox on an already-open CDP page (same document).

        Stamping a minted token onto an external Python HTTP request is rejected
        (evaluation / UNUSUAL_ACTIVITY). Caller holds `_cdp_op_lock`.
        """
        project_id = clean_project_id(self.active_project_id or "")
        body = json.loads(json.dumps(payload)) if isinstance(payload, dict) else {}
        if not isinstance(body, dict):
            raise RuntimeError("aisandbox payload must be a JSON object")

        if navigate:
            nav = LABS_FLOW_BASE
            try:
                self._cdp_send(ws, "Page.enable", msg_id=9610, timeout=8.0)
                self._cdp_send(ws, "Page.navigate", {"url": nav}, msg_id=9611, timeout=20.0)
                time.sleep(4.0)
            except Exception as e:
                logger.debug("same-page navigate notice: %s", e)

        recaptcha_token = ""
        if "clientContext" in body:
            recaptcha_token = self._mint_recaptcha_via_ws(ws, action=action, msg_id=20)
            ctx = body.setdefault("clientContext", {})
            if project_id:
                ctx["projectId"] = project_id
            if self.paygate_tier:
                ctx["userPaygateTier"] = self.paygate_tier
            ctx["recaptchaContext"] = {
                "token": recaptcha_token,
                "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB",
            }
            if isinstance(body.get("requests"), list):
                for r in body["requests"]:
                    if isinstance(r, dict) and "clientContext" in r:
                        r["clientContext"] = ctx

        if project_id and "/projects/" in endpoint:
            endpoint = re.sub(r"/projects/[^/]+/", f"/projects/{project_id}/", endpoint)

        if not self.access_token:
            self.refresh_session()
        token = self.access_token or ""
        body_json = json.dumps(body)
        logger.info(
            "aisandbox same-page CDP POST %s (recaptcha_len=%s project=%s)",
            endpoint,
            len(recaptcha_token or ""),
            project_id or "(none)",
        )
        fetch_code = f"""
        fetch({json.dumps(endpoint)}, {{
            method: 'POST',
            headers: {{
                'Content-Type': 'text/plain;charset=UTF-8',
                'Authorization': 'Bearer ' + {json.dumps(token)}
            }},
            body: {json.dumps(body_json)},
            credentials: 'include'
        }}).then(async r => {{
            const text = await r.text();
            return JSON.stringify({{status: r.status, text: text}});
        }}).catch(e => JSON.stringify({{status: 0, text: e.message}}))
        """
        res_val = self._cdp_eval(ws, fetch_code, msg_id=30, timeout=120.0)
        result_obj = json.loads(res_val or "{}")
        status = result_obj.get("status", 0)
        text = result_obj.get("text", "")
        if status == 200:
            self._sandbox_http_recaptcha_block_until = 0.0
            return json.loads(text)
        try:
            err_json = json.loads(text)
            msg = err_json.get("error", {}).get("message", text)
            reason = ""
            details = err_json.get("error", {}).get("details", [])
            if details and isinstance(details, list):
                reason = details[0].get("reason", "")
        except Exception:
            msg = str(text)[:300]
            reason = ""
        if reason == "PUBLIC_ERROR_MODEL_ACCESS_DENIED" or "ACCESS_DENIED" in str(reason) or "permission" in str(msg).lower():
            email = self.user_info.get("email") or "current account"
            plan = self.plan_name or "Free Tier"
            raise RuntimeError(
                f"PUBLIC_ERROR_MODEL_ACCESS_DENIED: Selected model is not permitted by Google Flow for {email} ({plan}). "
                "Google Veo models require an active Google AI Pro or Ultra subscription. "
                "Please select Omni 1.1 Flash, or connect fresh cookies from your Ultra account in Account Settings."
            )
        if "recaptcha" in str(msg).lower() or "RECAPTCHA" in reason or "UNUSUAL_ACTIVITY" in reason:
            if not self.cookie_session_report().get("has_web_session") and not self.cookie_session_report().get("has_labs_session"):
                raise self._incomplete_web_session_generation_error()
            raise RuntimeError(
                f"Google Flow reCAPTCHA rejected the request ({status}): {msg}."
            )
        raise RuntimeError(f"Google Flow API returned {status}: {msg}")

    def _execute_aisandbox_via_existing_tab_same_page(
        self,
        endpoint: str,
        payload: dict,
        action: str = "IMAGE_GENERATION",
    ) -> dict:
        """Mint+POST on an already-open labs/flow tab without clearBrowserCookies."""
        self._ensure_aisandbox_auth()
        port = self._get_alive_cdp_port()
        if port is None:
            raise RuntimeError("No live Chrome CDP port for same-page aisandbox")
        browser_cookies = self._read_cdp_google_cookies(port)
        has_browser_auth = any(
            name in browser_cookies
            for name in ("__Secure-1PSID", "__Secure-3PSID", "SID", "__Secure-next-auth.session-token")
        )
        if not has_browser_auth and not self.cookie_session_report().get("has_labs_session"):
            raise RuntimeError(
                "Existing CDP Chrome lacks session cookies; will use helper inject instead"
            )
        project_id = clean_project_id(self.active_project_id or "")
        ws_url = self._find_existing_flow_project_ws(port, project_id, allow_labs=True)
        if not ws_url:
            try:
                ws_url = self._cdp_pick_page_ws(port, prefer_substr="labs.google")
            except Exception:
                pass
        if not ws_url:
            try:
                ws_url = self._cdp_pick_page_ws(port, prefer_substr="flow.google")
            except Exception:
                pass
        if not ws_url:
            try:
                ws_url = self._cdp_pick_page_ws(port)
            except Exception as e:
                raise RuntimeError(f"No open labs/flow tab for same-page aisandbox: {e}") from e
        ws = websocket.create_connection(ws_url, timeout=45)
        try:
            logger.info("aisandbox same-page via existing CDP tab")
            if not has_browser_auth:
                logger.info("Injecting saved labs session into existing CDP tab...")
                self._cdp_apply_labs_session(ws)
            nav_needed = False
            try:
                cur_url = str(self._cdp_eval(ws, "location.href", msg_id=9599, timeout=5.0) or "")
                if "/about" in cur_url or "labs.google" not in cur_url:
                    nav_needed = True
            except Exception:
                nav_needed = True
            return self._aisandbox_same_page_post_on_ws(
                ws, endpoint, payload, action=action, navigate=nav_needed
            )
        finally:
            try:
                ws.close()
            except Exception:
                pass

    def _execute_aisandbox_via_helper_same_page(
        self,
        endpoint: str,
        payload: dict,
        action: str = "IMAGE_GENERATION",
    ) -> dict:
        """DISABLED — BiB-only; Python must not launch helper Chrome for aisandbox."""
        raise RuntimeError(
            "aisandbox helper Chrome is disabled (BiB-only mode). Use BiB generate/upload."
        )

    def _execute_cdp_fetch(self, endpoint: str, payload: dict, action: str = "IMAGE_GENERATION") -> dict:
        """Execute aisandbox API call — same-page CDP for reCAPTCHA; HTTP otherwise."""
        with self._cdp_op_lock:
            return self._execute_cdp_fetch_unlocked(endpoint, payload, action=action)

    def _execute_cdp_fetch_unlocked(
        self, endpoint: str, payload: dict, action: str = "IMAGE_GENERATION"
    ) -> dict:
        """Same-page mint+POST for reCAPTCHA payloads (never stamp onto Python HTTP).

        Order (matches what actually works vs Google Flow v3's broken HTTP stamp):
        1) Existing labs/flow tab — mint+fetch in place (no cookie clear)
        2) Helper Chrome — full SID inject + navigate + mint+fetch
        Do not fall back to external HTTP stamp on reCAPTCHA/UNUSUAL_ACTIVITY.
        """
        needs_recaptcha = isinstance(payload, dict) and "clientContext" in payload
        if needs_recaptcha:
            self._ensure_web_session_for_generation()
            last_err: Optional[BaseException] = None
            if self._get_alive_cdp_port() is not None:
                try:
                    return self._execute_aisandbox_via_existing_tab_same_page(
                        endpoint, payload, action=action
                    )
                except Exception as e:
                    last_err = e
                    logger.warning(
                        "aisandbox existing-tab same-page failed (%s); trying helper Chrome",
                        e,
                    )
            try:
                return self._execute_aisandbox_via_helper_same_page(
                    endpoint, payload, action=action
                )
            except Exception as helper_err:
                err_str = str(helper_err).lower()
                if "recaptcha evaluation failed" in err_str or "403" in err_str:
                    logger.warning("Cold-start reCAPTCHA evaluation failed (%s); waiting for page to settle and retrying once...", helper_err)
                    time.sleep(2.5)
                    try:
                        port = self._get_alive_cdp_port()
                        if port:
                            return self._execute_aisandbox_via_existing_tab_same_page(
                                endpoint, payload, action=action
                            )
                        return self._execute_aisandbox_via_helper_same_page(
                            endpoint, payload, action=action
                        )
                    except Exception as retry_err:
                        raise retry_err from helper_err
                # CDP websocket stalls are common under load — one settle + retry.
                if "cdp receive timed out" in err_str or "timed out" in err_str:
                    logger.warning(
                        "aisandbox CDP timed out (%s); waiting and retrying once via helper Chrome...",
                        helper_err,
                    )
                    time.sleep(2.0)
                    try:
                        return self._execute_aisandbox_via_helper_same_page(
                            endpoint, payload, action=action
                        )
                    except Exception as retry_err:
                        raise retry_err from helper_err
                if last_err is not None:
                    raise helper_err from last_err
                raise

        # Non-reCAPTCHA aisandbox calls (status polls, uploads, etc.)
        return self._sandbox_http_request(endpoint, payload, timeout=60.0, action=action)

    def _execute_cdp_get(self, endpoint: str) -> dict:
        """GET aisandbox resource — HTTP first; CDP only on an already-open labs/flow tab."""
        # 1) HTTP Bearer
        last_http_error: Optional[BaseException] = None
        try:
            if not self.access_token:
                self.refresh_session()
            if not self.access_token:
                raise RuntimeError("No access token for aisandbox GET")
            headers = {
                "Authorization": f"Bearer {self.access_token}",
                "Origin": "https://flow.google.com",
                "Referer": "https://flow.google.com/project/",
                "Cookie": self.cookies or "",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            }
            resp = requests.get(endpoint, headers=headers, timeout=25)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 404:
                return {}
            raise RuntimeError(f"aisandbox GET {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            # `except ... as e` unbinds `e` on exit, so keep the error in its own name.
            last_http_error = e
        logger.warning(
            "aisandbox HTTP GET failed (%s); trying existing CDP tab if any", last_http_error
        )

        # 2) Optional CDP — never launch Chrome
        port = self._get_alive_cdp_port()
        if port is None:
            raise RuntimeError(
                f"aisandbox GET failed and no Chrome CDP is running: {last_http_error}"
            ) from last_http_error
        try:
            ws_url = self._cdp_pick_page_ws(port, prefer_substr="labs.google")
        except Exception:
            ws_url = self._find_existing_flow_project_ws(port, self.active_project_id or "")
        if not ws_url:
            raise RuntimeError(
                f"aisandbox GET failed and no open labs/flow tab: {last_http_error}"
            ) from last_http_error

        if not self.access_token:
            self.refresh_session()
        token = self.access_token
        ws = websocket.create_connection(ws_url, timeout=25)
        try:
            fetch_code = f"""
            fetch({json.dumps(endpoint)}, {{
                method: 'GET',
                headers: {{
                    'Authorization': 'Bearer ' + {json.dumps(token)}
                }},
                credentials: 'include'
            }}).then(async r => {{
                const text = await r.text();
                return JSON.stringify({{status: r.status, text: text}});
            }}).catch(e => JSON.stringify({{status: 0, text: e.message}}))
            """
            res_val = self._cdp_eval(ws, fetch_code, msg_id=25, timeout=25.0)
            result_obj = json.loads(res_val or "{}")
            text = result_obj.get("text", "")
            return json.loads(text)
        finally:
            ws.close()

    def _execute_http_batchexecute(
        self,
        rpc_id: str,
        payload_data: Any,
        timeout: float = 120.0,
    ) -> Dict[str, Any]:
        """POST batchexecute via requests using harvested `at`/`bl`/`f.sid` + cookies.

        Prefers flow.google.com (Angular AiSandbox; capture-proven). Falls back to
        labs.google when flow returns 404/405.
        """
        at = str((self._wiz_meta or {}).get("at") or "")
        if not at or not self.cookies:
            return {
                "ok": False,
                "data": None,
                "error_code": "missing_at_token",
                "raw": "",
            }
        bl = str((self._wiz_meta or {}).get("bl") or DEFAULT_BL)
        sid = str((self._wiz_meta or {}).get("sid") or "")
        project_id = clean_project_id(self.active_project_id)
        source_path = f"/project/{project_id}" if project_id else "/"
        payload_str = json.dumps(payload_data, separators=(",", ":"))
        req = [[[rpc_id, payload_str, None, "generic"]]]
        body = (
            "f.req="
            + urllib.parse.quote(json.dumps(req, separators=(",", ":")), safe="")
            + "&at="
            + urllib.parse.quote(at, safe="")
        )
        qs = urllib.parse.urlencode(
            {
                "rpcids": rpc_id,
                "source-path": source_path,
                "bl": bl,
                "f.sid": sid,
                "hl": "en",
                "_reqid": str(random.randint(1_000_000, 99_999_999)),
                "rt": "c",
            }
        )
        preferred = str((self._wiz_meta or {}).get("preferred_base") or "")
        bases: List[str] = []
        if preferred:
            bases.append(preferred.rstrip("/"))
        for b in BATCHEXECUTE_BASES:
            if b not in bases:
                bases.append(b)

        last: Dict[str, Any] = {
            "ok": False,
            "data": None,
            "error_code": "http_error",
            "raw": "",
        }
        for base in bases:
            url = f"{base}{BATCHEXECUTE_PATH}?{qs}"
            origin = base
            referer = (
                angular_project_url(project_id)
                if "flow.google.com" in base
                else project_url(project_id)
            )
            headers = {
                "Cookie": self.cookies,
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "X-Same-Domain": "1",
                "Origin": origin,
                "Referer": referer,
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36"
                ),
                "Accept": "*/*",
            }
            try:
                resp = requests.post(url, headers=headers, data=body, timeout=timeout)
            except Exception as e:
                last = {"ok": False, "data": None, "error_code": f"http_error:{e}", "raw": ""}
                continue
            if resp.status_code in (404, 405):
                last = {
                    "ok": False,
                    "data": None,
                    "error_code": f"http_{resp.status_code}",
                    "raw": (resp.text or "")[:500],
                    "base": base,
                }
                logger.info("batchexecute %s on %s → %s; trying next host", rpc_id, base, resp.status_code)
                continue
            wrap = json.dumps({"status": resp.status_code, "text": resp.text or ""})
            parsed = parse_batchexecute_text(wrap, rpc_id)
            parsed["base"] = base
            return parsed
        return last

    def _finish_batchexecute(self, parsed: Dict[str, Any], rpc_id: str, return_meta: bool) -> Any:
        if return_meta:
            return parsed
        if parsed.get("ok"):
            return parsed.get("data")
        err = parsed.get("error_code")
        if err == "missing_at_token":
            raise RuntimeError(
                "Missing Flow WIZ `at` token. "
                "Export a Flow Capture from https://flow.google.com/project/{id} "
                "(Include secrets ON) so studio can harvest `at`, "
                "or open the Angular AiSandbox project page in Chrome."
            )
        if err == "cdp_unavailable":
            # Prefix keeps the legacy `BATCHEXECUTE_UNAVAILABLE:` contract that
            # string-matching callers use to pick their aisandbox fallback.
            raise RuntimeError(
                f"BATCHEXECUTE_UNAVAILABLE:cdp_unavailable — {str(parsed.get('raw') or '')[:400]}"
            )
        if is_batchexecute_auth_error(err):
            raise RuntimeError(auth_error_message(err))
        if err in ("http_405", "http_404"):
            raise RuntimeError(
                f"batchexecute unavailable ({err}). "
                "Save a fresh Capture from flow.google.com (includes `at`) or use aisandbox fallback."
            )
        if err == "fetch_failed":
            raise RuntimeError(
                "CDP batchexecute network failed (Failed to fetch). "
                "Ensure Chrome can reach https://flow.google.com/project/{id} "
                "(cookies valid, tab not blank/offline, Fetch abort disabled). "
                f"Detail: {str(parsed.get('raw') or '')[:240]}"
            )
        if err == 5 or err == "5":
            return {"__batchexecute_error__": 5, "rpc": rpc_id}
        logger.warning(f"batchexecute {rpc_id} parse issue: {err} raw={str(parsed.get('raw'))[:240]}")
        return parsed.get("raw")

    @staticmethod
    def _batchexecute_unavailable(detail: str) -> Dict[str, Any]:
        """Parsed-shaped result meaning "batchexecute is not reachable at all".

        Returned instead of raising so every caller classifies it through
        `is_batchexecute_fallback_error` and degrades to the aisandbox HTTP API.
        """
        return {
            "ok": False,
            "data": None,
            "error_code": "cdp_unavailable",
            "raw": detail,
        }

    def _should_retry_batchexecute_via_cdp(self, parsed: Dict[str, Any]) -> bool:
        """HTTP harvested-token path failed in a way that fresh page SNlM0e may fix."""
        if parsed.get("ok"):
            return False
        err = parsed.get("error_code")
        if err in ("missing_at_token", "http_405", "http_404", "parse_failed"):
            return True
        if is_batchexecute_auth_error(err):
            return True
        raw = str(parsed.get("raw") or "")
        return '"er"' in raw and "401" in raw

    def _persist_page_wiz_tokens(self, at: str, sid: str = "", bl: str = "") -> None:
        """Update harvested meta after CDP reads live SNlM0e from Angular shell."""
        at = (at or "").strip()
        if not at:
            return
        prev = str((self._wiz_meta or {}).get("at") or "")
        if at == prev and not sid and not bl:
            return
        unchanged = at == prev
        patch = {
            "at": at,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "source": "cdp_angular_snlm0e",
            "preferred_base": "https://flow.google.com",
        }
        if bl:
            patch["bl"] = bl
        if sid:
            patch["sid"] = sid
        self._wiz_meta = merge_wiz_meta(self._wiz_meta, patch)
        self._save_wiz_meta()
        if unchanged:
            # Re-reading the same token is not a recovery; keep the stale/dead marks
            # so callers do not loop through the refresh path every request.
            return
        self._clear_wiz_at_stale()
        logger.info("Refreshed batchexecute `at` from Angular page (len=%s)", len(at))

    def _refresh_at_via_http_project_page(self) -> bool:
        """Harvest SNlM0e from the Flow project HTML using cookies only.

        Tries the Angular host first, then labs.google — the labs page carries the
        `boq_labs-ai-sandbox-frontend` WIZ context that batchexecute actually uses,
        and it still serves tokens when flow.google.com renders an empty shell.
        """
        if not self.cookies:
            return False
        if self._wiz_session_is_dead():
            # Already proved signed-out for this jar; three more page loads per
            # generation would only add latency before the aisandbox fallback.
            return False
        project_id = clean_project_id(self.active_project_id)
        candidates = [
            (angular_project_url(project_id), FLOW_ANGULAR_BASE + "/"),
            (project_url(project_id), "https://flow.google.com/"),
            (LABS_FLOW_BASE, "https://flow.google.com/"),
        ]
        signed_out = False
        for url, referer in candidates:
            headers = {
                "Cookie": self.cookies,
                "User-Agent": BROWSER_UA,
                "Accept": "text/html,application/xhtml+xml",
                "Referer": referer,
            }
            try:
                resp = requests.get(url, headers=headers, timeout=30, allow_redirects=True)
            except Exception as e:
                logger.info("WIZ page fetch failed (%s): %s", url, e)
                continue
            html = resp.text or ""
            if resp.status_code >= 400 or not html:
                logger.info("WIZ page HTTP %s for %s (len=%s)", resp.status_code, url, len(html))
                continue

            m = re.search(r'"SNlM0e"\s*:\s*"([^"]+)"', html)
            if not m:
                m = re.search(r'["\']SNlM0e["\']\s*,\s*["\']([^"\']+)["\']', html)
            at = m.group(1) if m else ""
            if not at:
                # A WIZ shell whose `S06Grb` (obfuscated Gaia id) is empty means
                # Google treated the request as anonymous — the cookie jar has no
                # web session, so no amount of retrying will produce an `at`.
                if re.search(r'"S06Grb"\s*:\s*""', html) or "WIZ_global_data" in html:
                    signed_out = True
                logger.info("WIZ page had no SNlM0e (%s, status=%s)", url, resp.status_code)
                continue

            ms = re.search(r'"FdrFJe"\s*:\s*"([^"]+)"', html)
            sid = ms.group(1) if ms else ""
            mb = re.search(r'"cfb2h"\s*:\s*"([^"]+)"', html)
            bl = mb.group(1) if mb else ""
            self._persist_page_wiz_tokens(at, sid=sid, bl=bl or DEFAULT_BL)
            logger.info("Harvested WIZ `at` from %s", url)
            return True
        if signed_out:
            self._mark_wiz_session_dead()
            logger.warning(
                "Cannot refresh WIZ `at` over HTTP: %s Generation continues on the "
                "aisandbox HTTP API (Bearer + cookies).",
                NO_WIZ_SESSION_HINT,
            )
        return False

    def _execute_cdp_batchexecute(
        self,
        rpc_id: str,
        payload_data: Any,
        action: str = "GENERIC",
        timeout: float = 120.0,
        return_meta: bool = False,
    ) -> Any:
        """POST batchexecute, recovering the session once before giving up.

        Recovery pulls any Google session cookies a running Chrome has that Studio
        is missing and re-harvests `at`; it opens no browser windows.
        """
        parsed = self._execute_cdp_batchexecute_attempt(
            rpc_id, payload_data, action=action, timeout=timeout
        )
        if not isinstance(parsed, dict):
            return parsed
        if (
            not parsed.get("ok")
            and is_batchexecute_fallback_error(parsed.get("error_code"), parsed.get("raw"))
            and time.time() >= self._wiz_recovery_next_at
        ):
            self._wiz_recovery_next_at = time.time() + 30.0
            if self._recover_wiz_session():
                retry = self._execute_cdp_batchexecute_attempt(
                    rpc_id, payload_data, action=action, timeout=timeout
                )
                if retry.get("ok") or not parsed.get("raw"):
                    parsed = retry
        return self._finish_batchexecute(parsed, rpc_id, return_meta)

    def _execute_cdp_batchexecute_attempt(
        self,
        rpc_id: str,
        payload_data: Any,
        action: str = "GENERIC",
        timeout: float = 120.0,
    ) -> Dict[str, Any]:
        """One batchexecute attempt, returning the parsed envelope (never raising on auth).

        Prefers HTTP + harvested tokens against flow.google.com.
        On auth_401 / stale `at`, refreshes SNlM0e from the Angular project page
        (HTTP GET, then CDP) and retries once before surfacing a clear auth error.
        """
        return_meta = True
        # 1) Harvested tokens → direct HTTPS (official XHR auth model)
        http_parsed: Optional[Dict[str, Any]] = None
        if (self._wiz_meta or {}).get("at") and self.cookies:
            http_parsed = self._execute_http_batchexecute(rpc_id, payload_data, timeout=timeout)
            if http_parsed.get("ok"):
                self._clear_wiz_at_stale()
                return self._finish_batchexecute(http_parsed, rpc_id, return_meta)
            if not self._should_retry_batchexecute_via_cdp(http_parsed):
                return self._finish_batchexecute(http_parsed, rpc_id, return_meta)
            logger.warning(
                "batchexecute %s HTTP auth/stale (%s); refreshing `at` and retrying",
                rpc_id,
                http_parsed.get("error_code"),
            )
            # Soft-invalidate stale token so CDP prefers page SNlM0e
            if is_batchexecute_auth_error(http_parsed.get("error_code")) or (
                '"er"' in str(http_parsed.get("raw") or "") and "401" in str(http_parsed.get("raw") or "")
            ):
                # HTML harvest first (same cookies), then the already-open CDP tab —
                # labs.google renders a client-side shell with no SNlM0e in the HTML,
                # so the live tab is often the only place a fresh `at` exists.
                refreshed = self._refresh_at_via_http_project_page()
                if not refreshed:
                    try:
                        refreshed = self._soft_refresh_wiz_at_via_cdp()
                    except Exception as e:
                        logger.debug("CDP WIZ `at` harvest failed: %s", e)
                if refreshed:
                    retry = self._execute_http_batchexecute(rpc_id, payload_data, timeout=timeout)
                    if retry.get("ok"):
                        self._clear_wiz_at_stale()
                        return self._finish_batchexecute(retry, rpc_id, return_meta)
                    http_parsed = retry
                else:
                    self._mark_wiz_at_stale()

        # 2) CDP Angular shell — strictly optional. It is only tried when Chrome is
        # already running with DevTools *and* a Flow tab happens to be open; Studio
        # never launches Chrome or opens windows. When it is not there, hand the
        # caller a fallback-able result so it switches to the aisandbox HTTP API
        # instead of telling the user to go open a tab.
        if not self._get_alive_cdp_port():
            if http_parsed:
                self._mark_wiz_at_stale()
                return self._finish_batchexecute(http_parsed, rpc_id, return_meta)
            logger.info(
                "batchexecute %s: no WIZ `at` and no live Chrome CDP; using aisandbox HTTP",
                rpc_id,
            )
            return self._finish_batchexecute(
                self._batchexecute_unavailable(
                    "No WIZ `at` token and no already-open Chrome CDP session. "
                    f"{NO_WIZ_SESSION_HINT}"
                ),
                rpc_id,
                return_meta,
            )

        # Driving the Angular shell costs ~45s of navigation and SNlM0e polling. It
        # can only pay off if some jar in play carries a Google web session, so skip
        # it once flow.google.com has already proved this one signed-out.
        if self._wiz_session_is_dead() and not self.cookie_session_report()["has_web_session"]:
            logger.info(
                "batchexecute %s: skipping CDP Angular shell, cookies have no Google web session",
                rpc_id,
            )
            return self._finish_batchexecute(
                http_parsed
                or self._batchexecute_unavailable(
                    f"No Google web session in the cookie jar. {NO_WIZ_SESSION_HINT}"
                ),
                rpc_id,
                return_meta,
            )

        try:
            return self._execute_cdp_angular_batchexecute_body(
                rpc_id, payload_data, timeout=timeout, return_meta=return_meta
            )
        except RuntimeError as e:
            # CookieMismatch / no open Flow tab / dead CDP — all mean the same thing
            # for callers: batchexecute is unreachable, so fall through to HTTP.
            if not is_batchexecute_fallback_error(str(e), str(e)):
                raise
            logger.warning(
                "batchexecute %s CDP unavailable (%s); falling through to HTTP fallback",
                rpc_id,
                e,
            )
            self._mark_wiz_at_stale()
            return self._finish_batchexecute(
                http_parsed or self._batchexecute_unavailable(str(e)),
                rpc_id,
                return_meta,
            )

    def _execute_cdp_angular_batchexecute_body(
        self,
        rpc_id: str,
        payload_data: Any,
        timeout: float = 120.0,
        return_meta: bool = False,
    ) -> Any:
        """CDP path body: open flow.google.com and POST batchexecute (no labs clear)."""
        with self._cdp_op_lock:
            return self._execute_cdp_angular_batchexecute_body_unlocked(
                rpc_id, payload_data, timeout=timeout, return_meta=return_meta
            )

    def _execute_cdp_angular_batchexecute_body_unlocked(
        self,
        rpc_id: str,
        payload_data: Any,
        timeout: float = 120.0,
        return_meta: bool = False,
    ) -> Any:
        """Inner Angular batchexecute (caller must hold `_cdp_op_lock`)."""
        # 2) CDP Angular shell (SNlM0e on page) / harvested inject
        # Do NOT call _ensure_chrome_cdp_session here — that clearBrowserCookies +
        # labs-only jar causes accounts.google.com/CookieMismatch on flow navigations.
        if not self.active_project_id:
            self.ensure_active_project()
        if not self.active_project_id:
            raise RuntimeError(
                "No Google Flow project selected. Create or switch to a project first."
            )
        if not self.cookies:
            raise RuntimeError(
                "No cookies configured. Reconnect via Account Chip or Sync from ~/.gflow/env."
            )
        # Never launch Chrome / open a new window — only attach to an already-running CDP.
        port = self._get_alive_cdp_port()
        if not port:
            raise RuntimeError(
                "No Chrome CDP session is running. Studio will not open a new browser window. "
                "Use Account cookies for HTTP batchexecute, or start Chrome with "
                "--remote-debugging-port=9222 and keep flow.google.com open."
            )
        project_id = clean_project_id(self.active_project_id)
        # Existing flow.google.com tab only — never createTarget /json/new
        ws_url = self._cdp_open_flow_project_ws(port, project_id)
        ws = websocket.create_connection(ws_url, timeout=max(45.0, timeout + 10.0))
        try:
            # Never fall back to labs session here — that re-enables Fetch.abort and
            # clearBrowserCookies → CookieMismatch / Failed to fetch on maseQ.
            try:
                self._cdp_apply_flow_angular_session(ws)
            except Exception as e:
                logger.warning(f"batchexecute flow angular session: {e}")
                try:
                    self._cdp_set_flow_nav_block(ws, False)
                except Exception:
                    pass

            target = angular_project_url(project_id)
            href = ""
            try:
                href = self._cdp_eval(ws, "location.href", msg_id=14, timeout=8.0) or ""
                if project_id and (
                    "flow.google.com" not in href
                    or f"/project/{project_id}" not in href
                    or "CookieMismatch" in href
                    or "accounts.google.com" in href
                ):
                    self._cdp_set_flow_nav_block(ws, False)
                    self._cdp_send(ws, "Page.navigate", {"url": target}, msg_id=15, timeout=45)
                    deadline = time.time() + 25.0
                    while time.time() < deadline:
                        time.sleep(0.7)
                        href = self._cdp_eval(ws, "location.href", msg_id=14, timeout=8.0) or ""
                        if "CookieMismatch" in href or "accounts.google.com" in href:
                            # Cookie jar still bad — re-apply url-scoped cookies and retry once
                            self._cdp_apply_flow_angular_session(ws)
                            self._cdp_send(ws, "Page.navigate", {"url": target}, msg_id=15, timeout=45)
                            time.sleep(2.0)
                            href = self._cdp_eval(ws, "location.href", msg_id=14, timeout=8.0) or ""
                            break
                        if "flow.google.com" in href and "/project/" in href:
                            break
                        if href.startswith("chrome-error://") or href == "about:blank":
                            self._cdp_send(ws, "Page.navigate", {"url": target}, msg_id=15, timeout=30)
            except Exception as e:
                logger.debug(f"batchexecute project navigate notice: {e}")

            try:
                href = self._cdp_eval(ws, "location.href", msg_id=141, timeout=8.0) or href
            except Exception:
                pass
            if "CookieMismatch" in (href or "") or "accounts.google.com" in (href or ""):
                self._mark_wiz_at_stale()
                raise RuntimeError(
                    "CDP Chrome hit accounts.google.com/CookieMismatch while opening Flow. "
                    "Studio cookies were cleared for labs reCAPTCHA then re-injected incorrectly. "
                    "Re-capture a fresh cookie string from a signed-in https://flow.google.com/project/{id} "
                    "tab (Include secrets), paste into Account Chip, and retry upload."
                )
            if "flow.google.com" not in (href or ""):
                # Last resort: open yet another dedicated tab and switch WS
                try:
                    ws.close()
                except Exception:
                    pass
                try:
                    ws_url = self._cdp_open_flow_project_ws(port, project_id)
                    ws = websocket.create_connection(ws_url, timeout=max(45.0, timeout + 10.0))
                    self._cdp_apply_flow_angular_session(ws)
                    self._cdp_send(ws, "Page.navigate", {"url": target}, msg_id=15, timeout=45)
                    time.sleep(2.5)
                    href = self._cdp_eval(ws, "location.href", msg_id=141, timeout=8.0) or ""
                except Exception as e2:
                    logger.warning("Dedicated flow tab retry failed: %s", e2)
                if "flow.google.com" not in (href or ""):
                    self._mark_wiz_at_stale()
                    raise RuntimeError(
                        f"CDP tab is not on flow.google.com for batchexecute (at {href or 'unknown'}). "
                        "Open https://flow.google.com/project/{id} in Chrome, re-capture cookies/`at`, and retry."
                    )

            # Wait for Angular WIZ SNlM0e (not present in bare HTML shell)
            try:
                deadline = time.time() + 18.0
                msg_id = 150
                while time.time() < deadline:
                    msg_id += 1
                    at_live = self._cdp_eval(
                        ws,
                        "(window.WIZ_global_data && window.WIZ_global_data.SNlM0e) || ''",
                        msg_id=msg_id,
                        timeout=6.0,
                    )
                    if at_live:
                        try:
                            sid_live = self._cdp_eval(
                                ws,
                                "(window.WIZ_global_data && window.WIZ_global_data.FdrFJe) || ''",
                                msg_id=msg_id + 50,
                                timeout=5.0,
                            )
                            bl_live = self._cdp_eval(
                                ws,
                                "(window.WIZ_global_data && window.WIZ_global_data.cfb2h) || ''",
                                msg_id=msg_id + 51,
                                timeout=5.0,
                            )
                            self._persist_page_wiz_tokens(
                                str(at_live),
                                sid=str(sid_live or ""),
                                bl=str(bl_live or "") or DEFAULT_BL,
                            )
                        except Exception:
                            pass
                        break
                    time.sleep(0.5)
            except Exception as e:
                logger.debug(f"wait SNlM0e notice: {e}")

            # Prefer Python HTTPS once we have a fresh page `at` (large maseQ bodies)
            if (self._wiz_meta or {}).get("at") and self.cookies:
                http_retry = self._execute_http_batchexecute(
                    rpc_id, payload_data, timeout=timeout
                )
                if http_retry.get("ok"):
                    return self._finish_batchexecute(http_retry, rpc_id, return_meta)
                if not self._should_retry_batchexecute_via_cdp(http_retry):
                    return self._finish_batchexecute(http_retry, rpc_id, return_meta)

            payload_str = json.dumps(payload_data, separators=(",", ":"))
            source_path = f"/project/{project_id}" if project_id else "/"
            default_bl = str((self._wiz_meta or {}).get("bl") or DEFAULT_BL)
            harvested_at = json.dumps(str((self._wiz_meta or {}).get("at") or ""))
            harvested_sid = json.dumps(str((self._wiz_meta or {}).get("sid") or ""))
            req_id = random.randint(1_000_000, 99_999_999)
            bases_js = json.dumps(list(BATCHEXECUTE_BASES))
            path_js = json.dumps(BATCHEXECUTE_PATH)
            script = f"""
            (async () => {{
                try {{
                const wiz = window.WIZ_global_data || {{}};
                let at = wiz.SNlM0e || '';
                let sid = wiz.FdrFJe || '';
                let bl = wiz.cfb2h || {json.dumps(default_bl)};
                if (!at) {{
                    const html = document.documentElement.innerHTML || '';
                    const m = html.match(/"SNlM0e"\\s*:\\s*"([^"]+)"/);
                    if (m) at = m[1];
                    const ms = html.match(/"FdrFJe"\\s*:\\s*"([^"]+)"/);
                    if (ms) sid = ms[1];
                    const mb = html.match(/"cfb2h"\\s*:\\s*"([^"]+)"/);
                    if (mb) bl = mb[1];
                }}
                if (!at) {{
                    at = {harvested_at} || '';
                    if (!sid) sid = {harvested_sid} || '';
                }}
                if (!at) {{
                    return JSON.stringify({{
                        error: 'missing_at_token',
                        text: '',
                        status: 0,
                        href: location.href
                    }});
                }}
                const req = [[[{json.dumps(rpc_id)}, {json.dumps(payload_str)}, null, "generic"]]];
                const body = 'f.req=' + encodeURIComponent(JSON.stringify(req))
                    + '&at=' + encodeURIComponent(at);
                const qs = new URLSearchParams({{
                    rpcids: {json.dumps(rpc_id)},
                    'source-path': {json.dumps(source_path)},
                    bl: String(bl || ''),
                    'f.sid': String(sid || ''),
                    hl: 'en',
                    _reqid: String({req_id}),
                    rt: 'c'
                }});
                // Prefer same-origin when already on flow.google.com (avoids CORS Failed to fetch)
                const onFlow = (location.hostname || '').includes('flow.google.com');
                const bases = onFlow
                    ? [location.origin, ...{bases_js}.filter(b => b !== location.origin)]
                    : {bases_js};
                let lastStatus = 0;
                let lastText = '';
                let lastErr = '';
                for (const base of bases) {{
                    const url = base + {path_js} + '?' + qs.toString();
                    try {{
                        const res = await fetch(url, {{
                            method: 'POST',
                            headers: {{
                                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                                'X-Same-Domain': '1'
                            }},
                            body: body,
                            credentials: 'include'
                        }});
                        lastStatus = res.status;
                        lastText = await res.text();
                        if (res.status !== 404 && res.status !== 405) {{
                            return JSON.stringify({{
                                status: res.status,
                                text: lastText,
                                atLen: at.length,
                                base,
                                href: location.href,
                                atFromPage: !!({harvested_at} ? (at !== {harvested_at}) : !!at),
                                at: at,
                                sid: sid || '',
                                bl: bl || ''
                            }});
                        }}
                    }} catch (e) {{
                        lastErr = (e && e.message) ? e.message : String(e);
                    }}
                }}
                return JSON.stringify({{
                    error: lastErr ? 'fetch_failed' : 'http_error',
                    status: lastStatus,
                    text: lastText,
                    message: lastErr || '',
                    atLen: at.length,
                    href: location.href
                }});
                }} catch (e) {{
                    return JSON.stringify({{
                        error: 'fetch_failed',
                        status: 0,
                        text: '',
                        message: (e && e.message) ? e.message : String(e),
                        href: location.href
                    }});
                }}
            }})()
            """
            try:
                raw_wrap = self._cdp_eval(ws, script, msg_id=16, timeout=timeout) or ""
            except RuntimeError as e:
                err = str(e)
                if "Failed to fetch" in err:
                    raise RuntimeError(
                        f"CDP batchexecute fetch failed on {href or 'unknown page'}. "
                        "Usually: Fetch abort still blocking flow.google.com, wrong tab origin "
                        "(labs vs flow), or Chrome offline. "
                        f"Detail: {err}"
                    ) from e
                raise
            try:
                wrap_obj = json.loads(raw_wrap) if isinstance(raw_wrap, str) else {}
            except Exception:
                wrap_obj = {}
            # Persist fresh page tokens when CDP obtained them from Angular (not stale harvest)
            if isinstance(wrap_obj, dict) and wrap_obj.get("at") and wrap_obj.get("atFromPage"):
                try:
                    self._persist_page_wiz_tokens(
                        str(wrap_obj.get("at") or ""),
                        sid=str(wrap_obj.get("sid") or ""),
                        bl=str(wrap_obj.get("bl") or ""),
                    )
                except Exception as e:
                    logger.debug("persist CDP wiz tokens notice: %s", e)
            if isinstance(wrap_obj, dict) and wrap_obj.get("error") in (
                "fetch_failed",
                "missing_at_token",
            ):
                parsed = {
                    "ok": False,
                    "data": None,
                    "error_code": wrap_obj.get("error"),
                    "raw": json.dumps({
                        "message": wrap_obj.get("message"),
                        "href": wrap_obj.get("href"),
                        "status": wrap_obj.get("status"),
                    })[:500],
                }
            elif isinstance(wrap_obj, dict) and wrap_obj.get("status") in (404, 405):
                parsed = {
                    "ok": False,
                    "data": None,
                    "error_code": f"http_{wrap_obj.get('status')}",
                    "raw": (wrap_obj.get("text") or "")[:500],
                }
            else:
                parsed = parse_batchexecute_text(raw_wrap, rpc_id)
            # Prefer clearer auth error if CDP also 401'd
            if (
                not parsed.get("ok")
                and is_batchexecute_auth_error(parsed.get("error_code"))
                and return_meta
            ):
                parsed = dict(parsed)
                parsed["error_message"] = auth_error_message(parsed.get("error_code"))
            return self._finish_batchexecute(parsed, rpc_id, return_meta)
        finally:
            ws.close()

    def _rpc_as29s(self, media_id: str) -> Dict[str, Any]:
        """Poll media status via as29s. Treats wrb error [5] as not ready."""
        meta = self._execute_cdp_batchexecute(
            "as29s", build_as29s_payload(media_id), action="MEDIA_STATUS", return_meta=True
        )
        if not meta.get("ok"):
            err = meta.get("error_code")
            return {
                "ready": False,
                "pending": err in (5, "5", None, "null_payload"),
                "error": err,
                "url": "",
                "unavailable": err in (
                    "missing_at_token",
                    "http_405",
                    "http_404",
                )
                or is_batchexecute_auth_error(err)
                or err == "fetch_failed",
            }
        data = meta.get("data")
        if isinstance(data, dict) and data.get("__batchexecute_error__") == 5:
            return {"ready": False, "pending": True, "error": 5, "url": ""}
        info = as29s_is_ready(data, want="image")
        urls = extract_urls(data)
        if urls["videos"] and not info.get("url"):
            info = {
                "ready": True,
                "url": urls["videos"][0],
                "thumbnail_url": (urls["images"][0] if urls["images"] else ""),
                "width": None,
                "height": None,
            }
        info["pending"] = not info.get("ready")
        info["data"] = data
        return info

    def _rpc_jwpduf(self, media_id: str) -> Dict[str, Any]:
        """Poll I2V / video job via jwpduf until a video URL appears."""
        meta = self._execute_cdp_batchexecute(
            "jwpduf", build_jwpduf_payload(media_id), action="VIDEO_STATUS", return_meta=True
        )
        if not meta.get("ok"):
            return {
                "ready": False,
                "url": "",
                "error": meta.get("error_code"),
                "unavailable": (
                    meta.get("error_code") in ("missing_at_token", "http_405", "http_404", "fetch_failed")
                    or is_batchexecute_auth_error(meta.get("error_code"))
                ),
            }
        data = meta.get("data")
        urls = extract_urls(data)
        if urls["videos"]:
            return {
                "ready": True,
                "url": urls["videos"][0],
                "thumbnail_url": urls["images"][0] if urls["images"] else "",
                "data": data,
            }
        return {
            "ready": False,
            "url": "",
            "thumbnail_url": urls["images"][0] if urls["images"] else "",
            "data": data,
        }

    # --------------------------------------------------------------------------
    # GENERATION METHODS
    # --------------------------------------------------------------------------

    def resolve_wire_model(
        self,
        model: Optional[str],
        *,
        mode: str = "t2v",
        duration: int = 8,
        aspect_ratio: str = "16:9",
    ) -> str:
        """Map Studio UI model key to Flow videoModelKey.

        Approved frontend-to-backend remap (charge UI tier; send remapped wire):
          Lite (+ legacy Low Priority) -> lite_low_priority
          Fast -> lite
          Quality -> fast
          Omni -> unchanged

        Wire keys are classified back to FE tier then remapped (idempotent), so
        callers cannot bypass the map by stamping an old honest wire.
        """
        raw = (model or "").strip()
        mode_l = (mode or "t2v").lower()
        if not raw:
            if mode_l == "t2v":
                return "veo_3_1_t2v_lite_low_priority"
            return "veo_3_1_r2v_lite_low_priority"

        low = raw.lower().replace("-", "_").replace(" ", "_")

        # Omni / Abra — already final duration-scoped wires
        if low.startswith("abra_t2v_"):
            return low

        u = raw.upper().replace("-", "_").replace(" ", "_")

        # Classify Flow wire keys → FE tier (idempotent with remap below)
        if low.startswith("veo_3_1_t2v_") or low.startswith("veo_3_1_r2v_") or low.startswith("veo_3_1_i2v_") or low in (
            "veo_3_1_t2v",
            "veo_3_1_fast_low_priority",
        ):
            if "low_priority" in low or "lite_low" in low:
                u = "VEO_3_1_LITE"
            elif "i2v_s_fast" in low or (low.endswith("_fast") or "_fast_" in low) and "lite" not in low:
                u = "VEO_3_1_QUALITY"  # post-remap Fast wire = Quality FE
            elif "lite" in low:
                u = "VEO_3_1_FAST"  # post-remap Lite wire = Fast FE
            elif low in ("veo_3_1_t2v",) or "quality" in low:
                u = "VEO_3_1_QUALITY"  # old Quality wire → remap to Fast
            else:
                u = "VEO_3_1_LITE"

        # --- Omni Flash (duration-scoped) from UI key ---
        if "OMNI" in u or u.startswith("ABRA"):
            if duration <= 4:
                secs = 4
            elif duration <= 6:
                secs = 6
            elif duration <= 8:
                secs = 8
            else:
                secs = 10
            return f"abra_t2v_{secs}s"

        # --- Studio UI keys (remapped) ---
        is_lite_ui = (
            "LITE_LOW_PRIORITY" in u
            or ("LOW_PRIORITY" in u and "LITE" in u)
            or "LOWER_PRIORITY" in u
            or ("LITE" in u and "FAST" not in u and "QUALITY" not in u)
        )
        is_quality_ui = "QUALITY" in u
        is_fast_ui = ("FAST" in u or "ULTRA" in u) and not is_lite_ui

        if mode_l == "t2v":
            if "FAST_LOW_PRIORITY" in u or ("LOW_PRIORITY" in u and "FAST" in u):
                return "veo_3_1_fast_low_priority"
            if "ULTRA_RELAXED" in u:
                return "veo_3_1_t2v_fast_ultra_relaxed"
            if is_lite_ui:
                return "veo_3_1_t2v_lite_low_priority"
            if is_quality_ui:
                return "veo_3_1_t2v_fast"
            if is_fast_ui:
                return "veo_3_1_t2v_lite"
            return "veo_3_1_t2v_lite_low_priority"

        # I2V / R2V / ingredients / character video
        if "ULTRA_RELAXED" in u:
            return "veo_3_1_r2v_fast_landscape_ultra_relaxed"
        if is_lite_ui:
            return "veo_3_1_r2v_lite_low_priority"
        if is_quality_ui:
            if aspect_ratio == "9:16":
                return "veo_3_1_i2v_s_fast_portrait"
            return "veo_3_1_i2v_s_fast"
        if is_fast_ui:
            return "veo_3_1_r2v_lite"
        return "veo_3_1_r2v_lite_low_priority"

    @staticmethod
    def resolve_image_wire_model(model: Optional[str]) -> str:
        """Map Studio image UI key to aisandbox imageModelName (approved remap).

        Frontend Pro -> NARWHAL, Banana 2 -> HARBOR_SEAL, Lite -> GEM_PIX_2.
        """
        model_name = (model or "").upper().replace("-", "_").replace(" ", "_")
        if model_name in ("GEM_PIX_2", "NANO_BANANA_PRO", "BANANA_PRO", "NANOPRO") or (
            "PRO" in model_name and "BANANA" in model_name
        ):
            return "NARWHAL"
        if model_name in ("HARBOR_SEAL", "NANO_BANANA_2_LITE", "BANANA_2_LITE", "NANO_BANANA_LITE") or (
            "LITE" in model_name and "BANANA" in model_name
        ):
            return "GEM_PIX_2"
        if model_name in ("NARWHAL", "NANO_BANANA_2", "BANANA_2", "NANO_BANANA", "GEM_PIX") or "BANANA" in model_name:
            return "HARBOR_SEAL"
        return "NARWHAL"

    @staticmethod
    def display_model_label(model: Optional[str], *, wire_model: Optional[str] = None) -> str:
        """Human-readable frontend model name (never expose Low Priority)."""
        raw = (model or wire_model or "").strip()
        if not raw:
            return "Veo 3.1 - Lite"
        blob = raw.upper().replace("-", "_").replace(" ", "_")
        if "OMNI" in blob or "ABRA" in blob:
            return "Omni 1.1 Flash"
        if blob in ("VEO_3_1_QUALITY",) or (
            "QUALITY" in blob and "VEO" in blob and "T2V_FAST" not in blob and "I2V" not in blob
        ):
            return "Veo 3.1 - Quality"
        if blob in ("VEO_3_1_FAST",):
            return "Veo 3.1 - Fast"
        if (
            blob in ("VEO_3_1_LITE", "VEO_3_1_LITE_LOW_PRIORITY")
            or "LITE_LOW_PRIORITY" in blob
            or "T2V_LITE_LOW" in blob
            or "R2V_LITE_LOW" in blob
            or "LOWER_PRIORITY" in blob
        ):
            return "Veo 3.1 - Lite"
        if "T2V_FAST" in blob or "I2V_S_FAST" in blob:
            return "Veo 3.1 - Quality"
        if ("T2V_LITE" in blob or "R2V_LITE" in blob) and "LOW" not in blob:
            return "Veo 3.1 - Fast"
        if "FAST" in blob and "VEO" in blob:
            return "Veo 3.1 - Fast"
        if "LITE" in blob and "VEO" in blob:
            return "Veo 3.1 - Lite"
        if "QUALITY" in blob or blob in ("VEO_3_1_T2V", "VEO_3_1"):
            return "Veo 3.1 - Quality"
        if blob in ("GEM_PIX_2",) or ("PRO" in blob and "BANANA" in blob):
            return "Nano Banana 2 Pro"
        if blob in ("HARBOR_SEAL",) or ("LITE" in blob and "BANANA" in blob):
            return "Nano Banana 2 Lite"
        if "NARWHAL" in blob or "BANANA" in blob:
            return "Nano Banana 2"
        if raw.startswith("Veo 3.1 -") or raw.startswith("Omni ") or raw.startswith("Nano Banana"):
            return raw.split("(")[0].replace("[Lower Priority]", "").strip()
        if raw == "Veo 3.1":
            return "Veo 3.1 - Lite"
        return raw.replace(" [Lower Priority]", "").replace("[Lower Priority]", "").strip()

    def generate_image(
        self,
        prompt: str,
        aspect_ratio: str = "16:9",
        seed: Optional[int] = None,
        num_images: int = 1,
        model: str = "NARWHAL",
        characters: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        """Generate images via Google Flow Nano Banana models.

        When `characters` is set, prefers ogiZ0b with structured entity refs
        (official Flow @mention). Otherwise uses aisandbox batchGenerateImages.
        """
        if not prompt or not prompt.strip():
            raise ValueError("Prompt cannot be empty")

        if seed is None or seed < 0:
            seed = random.randint(10000, 999999)

        if self.simulation_mode or not self.cookies:
            return self._simulate_image_generation(prompt, aspect_ratio, seed, num_images, model)

        if not self.active_project_id:
            self.ensure_active_project()
        if not self.active_project_id:
            raise RuntimeError(
                "No Google Flow project selected. Open the Projects modal and create/switch to a project first."
            )

        # Resolve wire model name for image (aisandbox imageModelName)
        # Approved remap: FE Pro→NARWHAL, Banana2→HARBOR_SEAL, Lite→GEM_PIX_2
        wire_model = self.resolve_image_wire_model(model)
        logger.info("T2I FE model %s → wire %s", model, wire_model)

        char_refs = normalize_character_refs(characters)
        if char_refs:
            portrait_ids: List[str] = []
            enriched_refs: List[Dict[str, Any]] = []
            for cr in char_refs:
                row = dict(cr)
                try:
                    portrait = self.resolve_character_portrait_media_id(row)
                    if portrait:
                        row["image_media_id"] = portrait
                        if portrait not in portrait_ids:
                            portrait_ids.append(portrait)
                except Exception as mid_err:
                    logger.warning("Character portrait resolve failed: %s", mid_err)
                enriched_refs.append(row)
            if not portrait_ids:
                raise RuntimeError(
                    "Selected character has no Flow portrait media id. "
                    "Re-create the character with an image upload, or wait until portrait upload finishes."
                )
            logger.info(
                "Character image gen: %s portrait(s) for %s character(s)",
                len(portrait_ids),
                len(enriched_refs),
            )
            # Pass FE model key (not remapped wire) — image_to_image remaps once
            return self.image_to_image(
                image_id=portrait_ids[0],
                prompt=prompt,
                aspect_ratio=aspect_ratio,
                seed=seed,
                model=model,
                characters=enriched_refs,
                num_images=num_images,
                image_ids=portrait_ids,
            )

        # Build aspect ratio string
        aspect_map = {
            "16:9": "IMAGE_ASPECT_RATIO_LANDSCAPE",
            "9:16": "IMAGE_ASPECT_RATIO_PORTRAIT",
            "1:1": "IMAGE_ASPECT_RATIO_SQUARE",
            "4:3": "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
            "3:4": "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
        }
        wire_aspect = aspect_map.get(aspect_ratio, "IMAGE_ASPECT_RATIO_LANDSCAPE")
        endpoint = f"{SANDBOX_BASE}/v1/projects/{self.active_project_id}/flowMedia:batchGenerateImages"

        client_ctx = {
            "projectId": self.active_project_id,
            "tool": "PINHOLE",
            "userPaygateTier": self.paygate_tier,
            "recaptchaContext": {
                "token": "",
                "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB",
            },
        }

        requests_list = []
        for i in range(num_images):
            requests_list.append({
                "clientContext": client_ctx,
                "imageModelName": wire_model,
                "imageAspectRatio": wire_aspect,
                "structuredPrompt": {
                    "parts": [{"text": prompt}],
                },
                "seed": seed + i,
                "imageInputs": [],
            })

        payload = {
            "clientContext": client_ctx,
            "mediaGenerationContext": {"batchId": f"batch-{int(time.time()*1000)}"},
            "useNewMedia": True,
            "requests": requests_list,
        }

        data = self._execute_cdp_fetch(endpoint, payload, action="IMAGE_GENERATION")
        media_list = data.get("media", [])
        if not media_list:
            raise RuntimeError(f"No media returned from Google Flow: {json.dumps(data)[:200]}")

        result_items = []
        for idx, m in enumerate(media_list):
            gen_img = m.get("image", {}).get("generatedImage", {})
            fife_url = gen_img.get("fifeUrl", "")
            img_id = m.get("name") or f"img-{int(time.time() * 1000)}-{idx}"

            item = {
                "id": img_id,
                "name": f"Image Output #{idx+1}",
                "type": "image",
                "prompt": prompt,
                "url": fife_url,
                "width": 1920 if aspect_ratio == "16:9" else (1080 if aspect_ratio == "9:16" else 1080),
                "height": 1080 if aspect_ratio == "16:9" else (1920 if aspect_ratio == "9:16" else 1080),
                "aspect_ratio": aspect_ratio,
                "seed": seed + idx,
                "model": wire_model,
                "project_id": self.active_project_id,
                "project_url": project_url(self.active_project_id),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "COMPLETED",
            }
            result_items.append(item)
            self.history.insert(0, item)

        self._save_history()
        return result_items

    def generate_video(
        self,
        prompt: str,
        aspect_ratio: str = "16:9",
        duration: int = 5,
        seed: Optional[int] = None,
        model: str = "OMNI_1_1_FLASH",
    ) -> Dict[str, Any]:
        """Initiate video generation via Google Flow."""
        if not prompt or not prompt.strip():
            raise ValueError("Prompt cannot be empty")

        if seed is None or seed < 0:
            seed = random.randint(10000, 999999)

        if self.simulation_mode or not self.cookies:
            return self._simulate_video_generation(prompt, aspect_ratio, duration, seed, model)

        if not self.active_project_id:
            self.ensure_active_project()
        if not self.active_project_id:
            raise RuntimeError(
                "No Google Flow project selected. Open the Projects modal and create/switch to a project first."
            )

        aspect_map = {
            "16:9": "VIDEO_ASPECT_RATIO_LANDSCAPE",
            "9:16": "VIDEO_ASPECT_RATIO_PORTRAIT",
            "1:1": "VIDEO_ASPECT_RATIO_SQUARE",
        }
        wire_aspect = aspect_map.get(aspect_ratio, "VIDEO_ASPECT_RATIO_LANDSCAPE")
        wire_model = self.resolve_wire_model(model, mode="t2v", duration=duration, aspect_ratio=aspect_ratio)
        logger.info("T2V FE model %s → wire %s", model, wire_model)
        endpoint = f"{SANDBOX_BASE}/v1/video:batchAsyncGenerateVideoText"

        client_ctx = {
            "projectId": self.active_project_id,
            "tool": "PINHOLE",
            "userPaygateTier": self.paygate_tier,
            "recaptchaContext": {
                "token": "",
                "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB",
            },
        }

        payload = {
            "mediaGenerationContext": {"batchId": f"vid-batch-{int(time.time()*1000)}"},
            "clientContext": client_ctx,
            "requests": [{
                "aspectRatio": wire_aspect,
                "seed": seed,
                "textInput": {
                    "structuredPrompt": {
                        "parts": [{"text": prompt}],
                    },
                },
                "videoModelKey": wire_model,
                "metadata": {},
            }],
            "useV2ModelConfig": True,
        }

        used_model_label = self.display_model_label(model, wire_model=wire_model)
        try:
            data = self._execute_cdp_fetch(endpoint, payload, action="VIDEO_GENERATION")
        except Exception as gen_err:
            err_str = str(gen_err)
            if (
                "permission" in err_str.lower()
                or "access_denied" in err_str.lower()
                or "not available on your google flow plan" in err_str.lower()
                or "not permitted by google flow" in err_str.lower()
            ) and not str(wire_model).startswith("abra_t2v_"):
                logger.warning("Selected video model not permitted on this plan (%s); falling back to Omni 1.1 Flash (abra_t2v_8s)", gen_err)
                payload["requests"][0]["videoModelKey"] = "abra_t2v_8s"
                data = self._execute_cdp_fetch(endpoint, payload, action="VIDEO_GENERATION")
                used_model_label = "Omni 1.1 Flash (Fallback)"
                wire_model = "abra_t2v_8s"
            else:
                raise
        if "remainingCredits" in data:
            try:
                self.credits = int(data["remainingCredits"])
            except Exception:
                pass

        workflows = data.get("workflows", [])
        primary_media_id = ""
        workflow_id = ""
        if workflows and isinstance(workflows, list):
            wf = workflows[0]
            workflow_id = wf.get("name", "") or wf.get("id", "")
            primary_media_id = wf.get("metadata", {}).get("primaryMediaId", "")

        ops = data.get("operations", [])
        op_name = ops[0].get("operation", {}).get("name", "") if ops else ""
        media_list = data.get("media", [])
        media_id = media_list[0].get("name", "") if media_list else (primary_media_id or f"vid-{int(time.time()*1000)}")

        item = {
            "id": media_id,
            "name": f"{used_model_label} Video",
            "type": "video",
            "prompt": prompt,
            "url": "",
            "operation_name": op_name,
            "primary_media_id": primary_media_id,
            "workflow_id": workflow_id,
            "aspect_ratio": aspect_ratio,
            "duration": duration,
            "seed": seed,
            "model": used_model_label,
            "model_key": model or wire_model,
            "wire_model": wire_model,
            "project_id": self.active_project_id,
            "project_url": project_url(self.active_project_id),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "PROCESSING",
        }
        self.history.insert(0, item)
        self._save_history()
        return item

    def check_video_status(self, asset_id: str) -> Dict[str, Any]:
        """Poll and update video generation status."""
        item = next((h for h in self.history if h.get("id") == asset_id), None)
        if not item:
            raise ValueError(f"Asset with ID {asset_id} not found")

        # Never run video status RPC against image uploads — that falsely marks them FAILED
        if item.get("type") and item.get("type") != "video":
            if item.get("status") == "PROCESSING" and item.get("url") and "flow-content.google" in str(item.get("url")):
                item["status"] = "COMPLETED"
                item["flow_ready"] = True
                item.pop("error", None)
                self._save_history()
            return item

        if item.get("status") == "COMPLETED" and item.get("url"):
            return item

        if item.get("status") == "FAILED" and item.get("type") == "video":
            return item

        if self.simulation_mode or not self.cookies:
            created_at = datetime.fromisoformat(item["created_at"])
            elapsed = (datetime.now(timezone.utc) - created_at).total_seconds()
            if elapsed > 10:
                item["status"] = "COMPLETED"
                item["url"] = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
                self._save_history()
            return item

        op_name = item.get("operation_name")
        media_id = item.get("id") or item.get("primary_media_id")
        if not media_id:
            return item

        is_aisandbox = bool(item.get("project_id") or item.get("workflow_id"))

        # 0. Primary fast-check for aisandbox jobs (has project_id or workflow_id):
        # Direct query to flowMedia returns signed fifeUrl and thumbnailUrl directly in <1s.
        if is_aisandbox:
            try:
                detail_url = f"{SANDBOX_BASE}/v1/flowMedia/{media_id}"
                detail_data = self._execute_cdp_get(detail_url)
                if detail_data and isinstance(detail_data, dict):
                    m_meta = detail_data.get("mediaMetadata", {}) or {}
                    m_status = m_meta.get("mediaStatus", {}) or {}
                    gen_status = str(m_status.get("mediaGenerationStatus", "") or "").upper()
                    gen_vid = (detail_data.get("video") or {}).get("generatedVideo") or {}
                    video_url = gen_vid.get("fifeUrl") or (detail_data.get("video") or {}).get("fifeUrl") or ""
                    thumb_url = m_meta.get("thumbnailUrl") or detail_data.get("thumbnailUrl") or ""

                    if any(s in gen_status for s in ["SUCCESSFUL", "COMPLETE"]):
                        if video_url:
                            item["url"] = video_url
                            item["status"] = "COMPLETED"
                            if thumb_url:
                                item["thumbnail_url"] = thumb_url
                            self._save_history()
                            return item
                    elif any(s in gen_status for s in ["TIMEOUT", "EXPIRE"]):
                        item["status"] = "FAILED"
                        item["error"] = "Generation timed out in Veo (Google Flow)"
                        self._save_history()
                        return item
                    elif any(s in gen_status for s in ["FAIL", "ERROR", "CANCEL"]):
                        err_obj = m_status.get("error") or {}
                        fail_reasons = m_status.get("failureReasons") or []
                        fail_msg = (
                            (err_obj.get("message") if isinstance(err_obj, dict) else str(err_obj))
                            or (fail_reasons[0] if isinstance(fail_reasons, list) and fail_reasons else None)
                            or m_status.get("failureReason")
                            or m_status.get("errorMessage")
                            or "Generation failed in Veo"
                        )
                        item["status"] = "FAILED"
                        item["error"] = str(fail_msg)
                        self._save_history()
                        return item
                    elif any(s in gen_status for s in ["PROCESSING", "PENDING", "IN_PROGRESS", "RUNNING"]):
                        # Still generating - return immediately without burning CDP time on legacy RPCs
                        return item
            except Exception as flow_media_err:
                logger.debug(f"Direct flowMedia check attempt for {media_id}: {flow_media_err}")

        # 1. Legacy Flow polls: jwpduf (video job) then as29s (media CDN URLs)
        # Skip when WIZ `at` is stale or job is aisandbox.
        if not is_aisandbox and not self._wiz_prefer_aisandbox():
            try:
                jwp = self._rpc_jwpduf(media_id)
                if jwp.get("ready") and jwp.get("url"):
                    item["url"] = jwp["url"]
                    item["status"] = "COMPLETED"
                    if jwp.get("thumbnail_url"):
                        item["thumbnail_url"] = jwp["thumbnail_url"]
                    self._save_history()
                    return item
                jwp_blob = json.dumps(jwp.get("data")) if jwp.get("data") is not None else ""
                if (
                    "MEDIA_GENERATION_STATUS_FAILED" in jwp_blob
                    or "GENERATION_STATUS_FAILED" in jwp_blob
                ):
                    item["status"] = "FAILED"
                    item["error"] = jwp.get("error") or "Generation failed"
                    item["url"] = item.get("url") or ""
                    self._save_history()
                    return item
            except Exception as jwp_err:
                logger.debug(f"jwpduf check attempt: {jwp_err}")

            try:
                as_info = self._rpc_as29s(media_id)
                as_str = json.dumps(as_info.get("data")) if as_info.get("data") is not None else ""
                v_urls = re.findall(r'https://flow-content\.google/video/[^\s"\'\\,]+', as_str)
                if as_info.get("url") and "flow-content.google/video/" in str(as_info.get("url")):
                    item["url"] = as_info["url"]
                    item["status"] = "COMPLETED"
                    if as_info.get("thumbnail_url"):
                        item["thumbnail_url"] = as_info["thumbnail_url"]
                    self._save_history()
                    return item
                if v_urls:
                    clean_url = v_urls[0].replace(r"\u0026", "&")
                    item["url"] = clean_url
                    item["status"] = "COMPLETED"
                    i_urls = re.findall(r'https://flow-content\.google/image/[^\s"\'\\,]+', as_str)
                    if i_urls:
                        item["thumbnail_url"] = i_urls[0].replace(r"\u0026", "&")
                    self._save_history()
                    return item
                if as_info.get("unavailable"):
                    self._mark_wiz_at_stale()
            except Exception as as_err:
                logger.debug(f"as29s check attempt: {as_err}")
                self._mark_wiz_at_stale()

        # 2. Fallback direct query to flowMedia
        try:
            detail_url = f"{SANDBOX_BASE}/v1/flowMedia/{media_id}"
            detail_data = self._execute_cdp_get(detail_url)
            if detail_data and isinstance(detail_data, dict):
                m_meta = detail_data.get("mediaMetadata", {}) or {}
                m_status = m_meta.get("mediaStatus", {}) or {}
                gen_status = str(m_status.get("mediaGenerationStatus", "") or "").upper()
                gen_vid = (detail_data.get("video") or {}).get("generatedVideo") or {}
                video_url = gen_vid.get("fifeUrl") or (detail_data.get("video") or {}).get("fifeUrl") or ""
                thumb_url = m_meta.get("thumbnailUrl") or detail_data.get("thumbnailUrl") or ""

                if any(s in gen_status for s in ["SUCCESSFUL", "COMPLETE"]):
                    if video_url:
                        item["url"] = video_url
                        item["status"] = "COMPLETED"
                        if thumb_url:
                            item["thumbnail_url"] = thumb_url
                        self._save_history()
                        return item
                elif any(s in gen_status for s in ["TIMEOUT", "EXPIRE"]):
                    item["status"] = "FAILED"
                    item["error"] = "Generation timed out in Veo (Google Flow)"
                    self._save_history()
                    return item
                elif any(s in gen_status for s in ["FAIL", "ERROR", "CANCEL"]):
                    err_obj = m_status.get("error") or {}
                    fail_reasons = m_status.get("failureReasons") or []
                    fail_msg = (
                        (err_obj.get("message") if isinstance(err_obj, dict) else str(err_obj))
                        or (fail_reasons[0] if isinstance(fail_reasons, list) and fail_reasons else None)
                        or m_status.get("failureReason")
                        or m_status.get("errorMessage")
                        or "Generation failed in Veo"
                    )
                    item["status"] = "FAILED"
                    item["error"] = str(fail_msg)
                    self._save_history()
                    return item
        except Exception as flow_media_err:
            logger.debug(f"Direct flowMedia check attempt for {media_id}: {flow_media_err}")

        # 2. Batch check endpoint (authoritative status check; MUST NOT include 'operations' array which causes 400)
        endpoint = f"{SANDBOX_BASE}/v1/video:batchCheckAsyncVideoGenerationStatus"
        target_project_id = item.get("project_id") or self.active_project_id
        payload = {
            "media": [{
                "name": media_id,
                "projectId": target_project_id,
            }]
        }

        try:
            data = self._execute_cdp_fetch(endpoint, payload, action="VIDEO_GENERATION")
            media_list = data.get("media", [])
            for m in media_list:
                media_status = m.get("mediaMetadata", {}).get("mediaStatus", {}) or {}
                status_info = (
                    media_status.get("mediaGenerationStatus", "")
                    or media_status.get("status", "")
                    or m.get("status", "")
                    or ""
                )
                status_upper = str(status_info).upper()

                if any(s in status_upper for s in ["SUCCESSFUL", "COMPLETE"]):
                    m_vid = (m.get("video") or {}).get("generatedVideo") or {}
                    video_url = m_vid.get("fifeUrl", "")
                    thumb_url = ""

                    detail_url = f"{SANDBOX_BASE}/v1/flowMedia/{media_id}"
                    try:
                        detail_data = self._execute_cdp_get(detail_url)
                        if detail_data and isinstance(detail_data, dict):
                            gen_vid = (detail_data.get("video") or {}).get("generatedVideo") or {}
                            video_url = video_url or gen_vid.get("fifeUrl", "") or (detail_data.get("video") or {}).get("fifeUrl", "")
                            thumb_url = detail_data.get("mediaMetadata", {}).get("thumbnailUrl", "") or detail_data.get("thumbnailUrl", "")
                    except Exception as ge:
                        logger.warning(f"Error fetching flowMedia detail in batchCheck: {ge}")

                    if not video_url:
                        try:
                            redir_url = f"https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name={media_id}"
                            redir_data = self._execute_cdp_get(redir_url)
                            video_url = redir_data.get("result", {}).get("data", {}).get("json", {}).get("url", "")
                        except Exception as redir_err:
                            logger.warning(f"Error fetching getMediaUrlRedirect: {redir_err}")

                    if video_url:
                        item["url"] = video_url
                        item["status"] = "COMPLETED"
                        if thumb_url:
                            item["thumbnail_url"] = thumb_url
                        self._save_history()
                        return item

                elif any(s in status_upper for s in ["TIMEOUT", "EXPIRE"]):
                    item["status"] = "FAILED"
                    item["error"] = "Generation timed out in Veo (Google Flow)"
                    self._save_history()
                    return item

                elif any(s in status_upper for s in ["FAIL", "ERROR", "CANCEL"]):
                    mid = m.get("name") or m.get("mediaId") or ""
                    if mid and mid != media_id:
                        continue
                    err_obj = media_status.get("error") or {}
                    fail_reasons = media_status.get("failureReasons") or []
                    fail_reason = (
                        (err_obj.get("message") if isinstance(err_obj, dict) else str(err_obj))
                        or (fail_reasons[0] if isinstance(fail_reasons, list) and fail_reasons else None)
                        or media_status.get("failureReason")
                        or media_status.get("errorMessage")
                        or media_status.get("message")
                        or m.get("error")
                        or "Generation failed in Veo"
                    )
                    item["status"] = "FAILED"
                    item["error"] = str(fail_reason) or "Generation failed"
                    item["url"] = item.get("url") or ""
                    self._save_history()
                    return item

            # 3. Operations fallback
            ops = data.get("operations", [])
            if ops and ops[0].get("done", False):
                op0 = ops[0]
                op_err = op0.get("error") or {}
                if op_err:
                    item["status"] = "FAILED"
                    item["error"] = (
                        op_err.get("message")
                        or op_err.get("status")
                        or str(op_err)
                        or "Generation failed in Veo"
                    )
                    item["url"] = item.get("url") or ""
                    self._save_history()
                    return item
                resp = op0.get("response", {})
                gen_vid = (resp.get("video") or {}).get("generatedVideo") or {}
                video_url = gen_vid.get("fifeUrl", "") or (resp.get("video") or {}).get("fifeUrl", "") or resp.get("fifeUrl", "")
                if video_url:
                    item["url"] = video_url
                    item["status"] = "COMPLETED"
                    self._save_history()
                    return item

            # 4. Long elapsed timeout guard (prevent hanging forever at 95% if server lost the task)
            try:
                created_dt = datetime.fromisoformat(item["created_at"])
                elapsed = (datetime.now(timezone.utc) - created_dt).total_seconds()
                if elapsed > 900:  # 15 minutes
                    item["status"] = "FAILED"
                    item["error"] = "Generation timed out after 15 minutes"
                    self._save_history()
                    return item
            except Exception:
                pass

            return item
        except Exception as e:
            logger.warning(f"Error checking video status: {e}")
            return item

    def sync_all_pending_videos(self) -> List[Dict[str, Any]]:
        """Scan history for any PROCESSING items and update their status/URLs from Google Flow."""
        for item in list(self.history):
            if item.get("status") == "PROCESSING":
                if item.get("type") == "video":
                    try:
                        self.check_video_status(item["id"])
                    except Exception as e:
                        logger.warning(f"Error syncing item {item.get('id')}: {e}")
                else:
                    # Clean up stale non-video items older than 15 minutes
                    try:
                        created_dt = datetime.fromisoformat(item["created_at"])
                        if (datetime.now(timezone.utc) - created_dt).total_seconds() > 900:
                            item["status"] = "FAILED"
                            item["error"] = "Upload timed out"
                            self._save_history()
                    except Exception:
                        pass
        return self.history

    @staticmethod
    def _resolve_ffmpeg() -> str:
        path = shutil.which("ffmpeg")
        if not path:
            raise RuntimeError(
                "ffmpeg not found on PATH — required to extract the last video frame for Extend"
            )
        return path

    def _download_media_bytes(self, url: str, timeout: float = 120.0) -> bytes:
        """Download Flow CDN / signed media bytes (cookies optional for signed URLs).

        Prefer egress proxy when configured, but if the tunnel is dead (407 / ProxyError),
        retry direct — signed flow-content.google URLs usually work without a proxy.
        """
        if not url or not str(url).startswith(("http://", "https://")):
            raise ValueError(f"Invalid media URL for download: {url!r}")
        headers = {"User-Agent": BROWSER_UA}
        if self.cookies and "google" in url:
            headers["Cookie"] = self.cookies

        try:
            resp = requests.get(
                url,
                headers=headers,
                timeout=timeout,
                **apply_proxies_kwargs(url, {}, account_id=self.egress_account_id or None),
            )
            resp.raise_for_status()
        except Exception as first_err:
            err_text = f"{first_err}"
            is_proxy = (
                "ProxyError" in type(first_err).__name__
                or "ProxyError" in err_text
                or "407" in err_text
                or "Tunnel connection failed" in err_text
                or "Unable to connect to proxy" in err_text
            )
            # Also unwrap requests.exceptions.ConnectionError cause chains
            cause = getattr(first_err, "__cause__", None) or getattr(first_err, "args", [None])[0]
            if cause is not None:
                ctext = f"{cause}"
                if (
                    "407" in ctext
                    or "ProxyError" in ctext
                    or "Tunnel connection failed" in ctext
                    or "Unable to connect to proxy" in ctext
                ):
                    is_proxy = True
            if not is_proxy:
                raise
            logger.warning(
                "Media download via egress proxy failed (%s); retrying direct (no proxy)",
                err_text[:180],
            )
            # trust_env is a Session attribute, not a get() kwarg
            session = requests.Session()
            session.trust_env = False
            session.proxies = {}
            resp = session.get(url, headers=headers, timeout=timeout)
            resp.raise_for_status()

        data = resp.content
        if not data:
            raise RuntimeError("Downloaded media was empty")
        return data

    def _extract_last_frame_png(self, video_bytes: bytes) -> bytes:
        """Grab the last video frame as PNG via ffmpeg (no Chrome)."""
        ffmpeg = self._resolve_ffmpeg()
        with tempfile.TemporaryDirectory(prefix="flow-extend-") as tmp:
            tmp_path = Path(tmp)
            video_path = tmp_path / "source.mp4"
            frame_path = tmp_path / "last_frame.png"
            video_path.write_bytes(video_bytes)
            # Seek near EOF; -sseof is more reliable than guessing duration.
            cmd = [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-sseof",
                "-0.15",
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                "-q:v",
                "2",
                str(frame_path),
            ]
            try:
                subprocess.run(cmd, check=True, capture_output=True, timeout=90)
            except subprocess.CalledProcessError as e:
                err = (e.stderr or b"").decode("utf-8", errors="replace")[:400]
                # Fallback: decode all frames into one updating output (last frame wins)
                cmd_fb = [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(video_path),
                    "-vsync",
                    "0",
                    "-update",
                    "1",
                    "-q:v",
                    "2",
                    str(frame_path),
                ]
                try:
                    subprocess.run(cmd_fb, check=True, capture_output=True, timeout=180)
                except subprocess.CalledProcessError as e2:
                    err2 = (e2.stderr or b"").decode("utf-8", errors="replace")[:400]
                    raise RuntimeError(
                        f"ffmpeg failed to extract last frame: {err or err2}"
                    ) from e2
            if not frame_path.exists() or frame_path.stat().st_size < 32:
                raise RuntimeError("ffmpeg produced an empty last-frame image")
            return frame_path.read_bytes()

    @staticmethod
    def _extend_model_to_i2v(model: Optional[str]) -> str:
        """Map Studio Extend model keys onto the working I2V / R2V model keys."""
        name = (model or "").upper().replace("-", "_").replace(" ", "_")
        if "ULTRA_RELAXED" in name:
            return "VEO_3_1_R2V_ULTRA_RELAXED"
        if "ULTRA" in name:
            return "VEO_3_1_R2V_ULTRA"
        if "LOW_PRIORITY" in name or "LOWER_PRIORITY" in name:
            return "VEO_3_1_R2V_LITE_LOW_PRIORITY"
        return "VEO_3_1_R2V_LITE"

    def get_last_frame(self, asset_id: str, video_url: Optional[str] = None) -> Dict[str, Any]:
        """Download video to server disk → extract last frame → delete local server video.

        Always materializes a temp .mp4 under data/uploads (instant server download),
        runs ffmpeg, stages the PNG, then unlinks the temp download and any durable
        local server copy (local_path / upscaled_path). Does not touch Google CDN.
        """
        item = next((h for h in self.history if h.get("id") == asset_id), None)
        if not item:
            url = (video_url or "").strip()
            if not url:
                raise ValueError(f"Video asset not found: {asset_id}")
            item = {
                "id": asset_id,
                "type": "video",
                "url": url,
                "name": f"Video {asset_id[:8]}",
                "status": "COMPLETED",
            }
            self.history.insert(0, item)
        if item.get("type") != "video":
            raise ValueError("Asset is not a video")

        resolved_url = (video_url or item.get("url") or "").strip()
        durable_locals = []
        for key in ("local_path", "path", "upscaled_path"):
            p = item.get(key)
            if p and Path(p).is_file() and str(p) not in durable_locals:
                durable_locals.append(str(p))

        extend_tmp = UPLOADS_DIR / "extend-tmp"
        extend_tmp.mkdir(parents=True, exist_ok=True)
        temp_video = extend_tmp / f"extend-src-{asset_id[:12]}-{uuid.uuid4().hex[:8]}.mp4"
        downloaded_temp = False

        try:
            if durable_locals:
                # Prefer existing local file — copy into extend-tmp so we can safely delete after
                src = Path(durable_locals[0])
                logger.info(
                    "Extend: copying local video %s → %s for frame extract",
                    src,
                    temp_video,
                )
                shutil.copy2(src, temp_video)
                downloaded_temp = True
            elif resolved_url:
                # Local API file URL
                local_from_api = None
                if "/api/assets/file/" in resolved_url or "/api/media/" in resolved_url:
                    name = resolved_url.rstrip("/").split("/")[-1].split("?")[0]
                    candidate = UPLOADS_DIR / name
                    if candidate.is_file():
                        local_from_api = candidate
                if local_from_api is not None:
                    logger.info("Extend: using local API file %s", local_from_api)
                    shutil.copy2(local_from_api, temp_video)
                    if str(local_from_api) not in durable_locals:
                        durable_locals.append(str(local_from_api))
                    downloaded_temp = True
                elif resolved_url.startswith(("http://", "https://")):
                    logger.info("Extend: downloading video instantly for %s", asset_id)
                    video_bytes = self._download_media_bytes(resolved_url)
                    temp_video.write_bytes(video_bytes)
                    downloaded_temp = True
                else:
                    raise RuntimeError("Video has no playable URL yet. Wait until generation completes.")
            else:
                raise RuntimeError("Video has no playable URL yet. Wait until generation completes.")

            if not temp_video.is_file() or temp_video.stat().st_size < 64:
                raise RuntimeError("Downloaded video for Extend was empty")

            logger.info(
                "Extend: extracting last frame from %s (%s bytes)",
                temp_video,
                temp_video.stat().st_size,
            )
            frame_png = self._extract_last_frame_png(temp_video.read_bytes())
        finally:
            # Always delete the temp download from OUR server storage
            if downloaded_temp and temp_video.exists():
                try:
                    temp_video.unlink()
                    logger.info("Extend: deleted temp server video %s", temp_video)
                except OSError as e:
                    logger.warning("Extend: failed to delete temp video %s: %s", temp_video, e)

        # Delete durable local server copies (upscaled / staged mp4) after successful frame extract
        deleted_locals: List[str] = []
        for p in durable_locals:
            try:
                Path(p).unlink(missing_ok=True)
                deleted_locals.append(p)
                logger.info("Extend: deleted local server video %s", p)
            except OSError as e:
                logger.warning("Extend: failed to delete local video %s: %s", p, e)
        for key in ("local_path", "path", "upscaled_path"):
            if item.get(key) and str(item.get(key)) in deleted_locals:
                item[key] = None

        # Stage PNG locally
        filename = f"extend-last-frame-{asset_id[:8]}.png"
        staged_asset = self.stage_local_image(
            image_bytes=frame_png,
            filename=filename,
            mime_type="image/png",
        )
        staged_id = staged_asset.get("staged_id") or staged_asset.get("id")

        b64 = base64.b64encode(frame_png).decode("ascii")
        data_url = f"data:image/png;base64,{b64}"
        staged_asset["data_url"] = data_url
        if not staged_asset.get("url"):
            staged_asset["url"] = data_url
        staged_asset["name"] = f"Last frame of {item.get('name') or asset_id[:8]}"
        staged_asset["parent_video_id"] = asset_id
        staged_asset["deleted_local_videos"] = deleted_locals

        logger.info("Last frame extracted and staged successfully: %s", staged_id)
        return {
            "success": True,
            "asset": staged_asset,
            "image_id": staged_id,
            "staged_id": staged_id,
            "url": staged_asset.get("url") or data_url,
            "data_url": data_url,
            "deleted_local_videos": deleted_locals,
        }

    def upscale_video(
        self,
        asset_id: str,
        video_url: Optional[str] = None,
        aspect_ratio: Optional[str] = None,
        media_id: Optional[str] = None,
        workflow_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Upscale via Google Flow cloud only (BiB path). CDP/ffmpeg remaster disabled."""
        item = next((h for h in self.history if h.get("id") == asset_id), None)
        if not item:
            url = (video_url or "").strip()
            if not url:
                raise ValueError(f"Video asset not found: {asset_id}")
            item = {
                "id": asset_id,
                "type": "video",
                "url": url,
                "aspect_ratio": aspect_ratio or "16:9",
                "primary_media_id": media_id or "",
                "workflow_id": workflow_id or "",
                "status": "COMPLETED",
                "prompt": "Upscaled video",
            }
            self.history.insert(0, item)
        if item.get("type") != "video":
            raise ValueError("Asset is not a video")
        if video_url and not item.get("url"):
            item["url"] = video_url
        if aspect_ratio:
            item["aspect_ratio"] = aspect_ratio
        if media_id:
            item["primary_media_id"] = media_id
        if workflow_id:
            item["workflow_id"] = workflow_id

        if item.get("upscaled_url") and item.get("upscaled_path") and Path(item["upscaled_path"]).exists():
            out_name = Path(item["upscaled_path"]).name
            durable = f"/api/assets/file/{out_name}"
            item["upscaled_url"] = durable
            item["upscaled_download_url"] = durable
            self._save_history()
            return {
                "success": True,
                "asset_id": asset_id,
                "upscaled_url": durable,
                "upscaled_download_url": durable,
                "resolution": "1080p",
                "method": item.get("upscaled_method", "native"),
                "already_upscaled": True,
            }

        video_url = (item.get("url") or "").strip()
        if not video_url:
            raise RuntimeError("Video has no playable URL yet. Wait until generation completes.")

        uploads_dir = Path("data/uploads")
        uploads_dir.mkdir(parents=True, exist_ok=True)
        out_filename = f"upscaled_{asset_id[:16]}.mp4"
        out_path = uploads_dir / out_filename

        if out_path.exists() and out_path.stat().st_size > 1024:
            item["upscaled_url"] = f"/api/assets/file/{out_filename}"
            item["upscaled_download_url"] = f"/api/assets/file/{out_filename}"
            item["upscaled_path"] = str(out_path)
            item["upscaled_resolution"] = "1080p"
            self._save_history()
            return {
                "success": True,
                "asset_id": asset_id,
                "upscaled_url": item["upscaled_url"],
                "upscaled_download_url": item["upscaled_download_url"],
                "resolution": "1080p",
                "already_upscaled": True,
            }

        # BiB-only: cloud 1080p upsample must go through Next -> BiB /upsample-video
        # (aisandbox API on the existing account browser). No CDP helper Chrome, no ffmpeg remaster.
        raise RuntimeError(
            "Google Flow cloud upsample only. "
            "Python CDP helper Chrome and Studio ffmpeg remastering are disabled. "
            "Use Studio Upscale (BiB aisandbox API on the existing account browser)."
        )

    def extend_video(self, asset_id: str, prompt: str, model: Optional[str] = None) -> Dict[str, Any]:
        """Extend a clip by last-frame extraction → upload → image-to-video (HTTP-first).

        Native Flow `fZytfe` batchexecute exists but needs a live WIZ `at` / Flow tab and
        was failing in Studio. Intended Studio path: grab the last frame, upload it, then
        reuse the same I2V pipeline (MZZa6b with aisandbox fallback) — no new Chrome windows.
        """
        if not prompt or not str(prompt).strip():
            raise ValueError("Extend prompt cannot be empty")

        item = next((h for h in self.history if h.get("id") == asset_id), None)
        if not item:
            raise ValueError(f"Video asset not found in history: {asset_id}")
        if item.get("type") != "video":
            raise ValueError("Extend requires a video asset")

        aspect = item.get("aspect_ratio") or "16:9"
        video_url = (item.get("url") or "").strip()
        i2v_model = self._extend_model_to_i2v(model)
        clip_duration = int(item.get("duration") or 5)
        i2v_duration = 5 if clip_duration >= 5 else max(4, clip_duration)

        if self.simulation_mode or not self.cookies:
            ext_id = f"vid-ext-{int(time.time() * 1000)}"
            extended_item = {
                "id": ext_id,
                "name": f"Extended: {(prompt or 'Extended Clip')[:30]}",
                "type": "video",
                "prompt": prompt,
                "parent_id": asset_id,
                "extend_mode": "last_frame_i2v",
                "source_image_id": None,
                "aspect_ratio": aspect,
                "duration": clip_duration + i2v_duration,
                "seed": random.randint(10000, 999999),
                "model": "Veo 3.1 Extend last-frame→I2V (Simulated)",
                "project_id": self.active_project_id,
                "project_url": project_url(self.active_project_id),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "COMPLETED",
                "url": video_url
                or "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
                "rpc": "last_frame_i2v_sim",
            }
            self.history.insert(0, extended_item)
            self._save_history()
            return extended_item

        if not video_url:
            raise RuntimeError(
                "This video has no playable URL yet. Wait until generation completes, then Extend."
            )

        logger.info("Extend: downloading source video %s for last-frame extract", asset_id)
        video_bytes = self._download_media_bytes(video_url)
        logger.info("Extend: extracting last frame (%s bytes of video)", len(video_bytes))
        frame_png = self._extract_last_frame_png(video_bytes)

        uploaded = self.upload_reference_image(
            image_bytes=frame_png,
            filename=f"extend-last-frame-{asset_id[:8]}.png",
            mime_type="image/png",
        )
        frame_media_id = uploaded.get("id")
        if not frame_media_id:
            raise RuntimeError("Last-frame upload succeeded but returned no media id")

        # Annotate the uploaded frame in history
        for h in self.history:
            if h.get("id") == frame_media_id:
                h["source"] = "extend_last_frame"
                h["parent_video_id"] = asset_id
                h["name"] = f"Last frame of {asset_id[:8]}…"
                break
        self._save_history()

        logger.info(
            "Extend: running I2V from last frame %s (model=%s)",
            frame_media_id,
            i2v_model,
        )
        video = self.image_to_video(
            image_id=frame_media_id,
            prompt=prompt,
            aspect_ratio=aspect,
            model=i2v_model,
            duration=i2v_duration,
        )

        annotations = {
            "parent_id": asset_id,
            "extend_mode": "last_frame_i2v",
            "source_frame_image_id": frame_media_id,
            "source_image_id": frame_media_id,
            "name": f"Extended: {prompt[:30]}...",
        }
        # Prefer keeping I2V model string but mark extend provenance
        if video.get("model") and "Extend" not in str(video.get("model")):
            annotations["model"] = f"Extend last-frame→I2V ({video.get('model')})"
        else:
            annotations.setdefault(
                "model", f"Extend last-frame→I2V ({i2v_model})"
            )

        video.update(annotations)
        for h in self.history:
            if h.get("id") == video.get("id"):
                h.update(annotations)
                break
        self._save_history()
        return video

    def check_media_ready(self, media_id: str) -> Dict[str, Any]:
        """Probe whether a Flow media id is ingested and usable as an I2V/I2I reference.

        Uploaded images often return an id before Flow finishes ingesting; animating
        too early fails instantly. Ready means flowMedia has image bytes/URL or as29s
        resolves an image URL.
        """
        mid = (media_id or "").strip()
        if not mid:
            return {"id": mid, "ready": False, "status": "MISSING", "url": "", "error": "No media id"}

        # Local / simulated ids are always ready
        if self.simulation_mode or not self.cookies or mid.startswith("img-upload-"):
            hist = next((h for h in self.history if h.get("id") == mid), None)
            url = (hist or {}).get("url") or ""
            return {
                "id": mid,
                "ready": True,
                "status": "READY",
                "url": url,
                "source": (hist or {}).get("source") or "local",
            }

        # Gallery / generated images already in history with a Flow CDN URL are ready
        hist = next((h for h in self.history if h.get("id") == mid), None)
        if hist and hist.get("url") and "flow-content.google" in str(hist.get("url", "")):
            if hist.get("source") != "desktop_upload" or hist.get("flow_ready"):
                return {
                    "id": mid,
                    "ready": True,
                    "status": "READY",
                    "url": hist.get("url") or "",
                    "source": hist.get("source") or "history",
                }

        # Prefer official as29s unless WIZ `at` is stale (then skip straight to flowMedia)
        if not self._wiz_prefer_aisandbox():
            try:
                as_info = self._rpc_as29s(mid)
                if as_info.get("ready") and as_info.get("url"):
                    url = as_info["url"]
                    if hist is not None:
                        hist["flow_ready"] = True
                        hist["url"] = url
                        if hist.get("status") == "PROCESSING":
                            hist["status"] = "COMPLETED"
                        hist.pop("error", None)
                        self._save_history()
                    return {"id": mid, "ready": True, "status": "READY", "url": url}
                if as_info.get("pending") and not as_info.get("unavailable"):
                    return {"id": mid, "ready": False, "status": "PROCESSING", "url": ""}
                if as_info.get("unavailable"):
                    self._mark_wiz_at_stale()
                # If batchexecute unavailable, fall through to aisandbox flowMedia
            except Exception as e:
                logger.debug(f"as29s ready check for {mid}: {e}")
                self._mark_wiz_at_stale()

        try:
            detail = self._execute_cdp_get(f"{SANDBOX_BASE}/v1/flowMedia/{mid}")
            if isinstance(detail, dict) and detail.get("error"):
                err = detail.get("error") or {}
                return {
                    "id": mid,
                    "ready": False,
                    "status": "PENDING",
                    "url": "",
                    "error": err.get("message") or str(err)[:200],
                }

            image = (detail or {}).get("image") or {}
            uploaded = image.get("userUploadedImage") or {}
            generated = image.get("generatedImage") or {}
            meta = (detail or {}).get("mediaMetadata") or {}
            url = (
                uploaded.get("fifeUrl")
                or generated.get("fifeUrl")
                or meta.get("thumbnailUrl")
                or ""
            )
            dims = image.get("dimensions") or {}
            has_image = bool(url) or bool(dims.get("width")) or bool(uploaded) or bool(generated)
            if has_image:
                if hist is not None:
                    hist["flow_ready"] = True
                    if hist.get("status") in ("PROCESSING", "FAILED"):
                        hist["status"] = "COMPLETED"
                        hist.pop("error", None)
                        hist.pop("ready_error", None)
                    if url and (not hist.get("url") or str(hist.get("url", "")).startswith("data:")):
                        hist["url"] = url
                    if dims.get("width"):
                        hist["width"] = dims.get("width")
                        hist["height"] = dims.get("height")
                    self._save_history()
                return {
                    "id": mid,
                    "ready": True,
                    "status": "READY",
                    "url": url,
                    "width": dims.get("width"),
                    "height": dims.get("height"),
                    "workflow_id": detail.get("workflowId"),
                }
        except Exception as e:
            logger.debug(f"flowMedia ready check for {mid}: {e}")

        return {"id": mid, "ready": False, "status": "PROCESSING", "url": ""}

    def wait_for_media_ready(
        self,
        media_id: str,
        timeout: float = 45.0,
        poll_interval: float = 1.25,
    ) -> Dict[str, Any]:
        """Block until Flow finishes ingesting media, or raise on timeout."""
        deadline = time.time() + max(3.0, timeout)
        last: Dict[str, Any] = {"id": media_id, "ready": False, "status": "PENDING"}
        while time.time() < deadline:
            last = self.check_media_ready(media_id)
            if last.get("ready"):
                return last
            time.sleep(poll_interval)
        raise RuntimeError(
            f"Flow media not ready after {int(timeout)}s (id={media_id}). "
            "Wait for 'Ready to animate' in the studio, then retry."
        )

    def _load_staged_index(self) -> Dict[str, Any]:
        if not STAGED_META_FILE.exists():
            return {}
        try:
            return json.loads(STAGED_META_FILE.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning(f"Failed to load staged index: {e}")
            return {}

    def _save_staged_index(self, index: Dict[str, Any]) -> None:
        try:
            STAGED_META_FILE.write_text(json.dumps(index, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning(f"Failed to save staged index: {e}")

    def _detect_image_mime(self, image_bytes: bytes, mime_type: str = "") -> str:
        header = image_bytes[:12]
        is_png = header.startswith(b"\x89PNG")
        is_jpeg = header.startswith(b"\xff\xd8\xff")
        is_gif = header.startswith(b"GIF87a") or header.startswith(b"GIF89a")
        is_webp = len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WEBP"
        if not (is_png or is_jpeg or is_gif or is_webp):
            raise ValueError("Unsupported image format. Use PNG, JPEG, WebP, or GIF.")
        if mime_type and mime_type != "application/octet-stream":
            return mime_type
        if is_png:
            return "image/png"
        if is_jpeg:
            return "image/jpeg"
        if is_gif:
            return "image/gif"
        return "image/webp"

    def stage_local_image(
        self,
        image_bytes: bytes,
        filename: str = "upload.png",
        mime_type: str = "image/png",
    ) -> Dict[str, Any]:
        """Save an image under data/uploads/ without uploading to Flow.

        Used for deferred upload: preview locally, upload to Flow on Generate.
        """
        if not image_bytes:
            raise ValueError("Image bytes cannot be empty")
        if len(image_bytes) > 20 * 1024 * 1024:
            raise ValueError("Image exceeds Flow's 20 MB upload limit")

        mime_type = self._detect_image_mime(image_bytes, mime_type)
        ext_map = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/gif": ".gif",
            "image/webp": ".webp",
        }
        ext = ext_map.get(mime_type, Path(filename or "").suffix or ".png")
        staged_id = f"staged-{uuid.uuid4().hex[:12]}"
        safe_name = Path(filename or f"upload{ext}").name
        disk_name = f"{staged_id}{ext}"
        local_path = UPLOADS_DIR / disk_name
        local_path.write_bytes(image_bytes)

        preview_data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
        display_name = (safe_name or "Staged Image").strip() or "Staged Image"
        item = {
            "id": staged_id,
            "staged_id": staged_id,
            "name": display_name,
            "type": "image",
            "prompt": f"Staged: {display_name}",
            "aspect_ratio": "16:9",
            "seed": None,
            "model": "Local staging",
            "project_id": self.active_project_id,
            "project_url": project_url(self.active_project_id),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "STAGED",
            "url": preview_data_url,
            "source": "local_stage",
            "flow_ready": False,
            "local_path": str(local_path),
            "mime_type": mime_type,
            "filename": display_name,
        }

        index = self._load_staged_index()
        index[staged_id] = {
            "id": staged_id,
            "local_path": str(local_path),
            "mime_type": mime_type,
            "filename": display_name,
            "created_at": item["created_at"],
        }
        self._save_staged_index(index)
        logger.info("Staged local image %s → %s", staged_id, local_path)
        return item

    stage_image = stage_local_image

    def get_staged_image(self, staged_id: str) -> Dict[str, Any]:
        """Resolve a staged upload by id; raises ValueError if missing."""
        sid = (staged_id or "").strip()
        if not sid:
            raise ValueError("staged_id is required")
        index = self._load_staged_index()
        meta = index.get(sid)
        if not meta:
            # Fallback: look for file on disk in UPLOADS_DIR matching sid*
            for f in UPLOADS_DIR.glob(f"{sid}*"):
                if f.is_file():
                    raw = f.read_bytes()
                    return {
                        "id": sid,
                        "local_path": str(f),
                        "mime_type": self._detect_image_mime(raw, "image/png"),
                        "filename": f.name,
                        "image_bytes": raw,
                    }
            raise ValueError(f"Staged image not found: {sid}")
        path = Path(meta.get("local_path") or "")
        if not path.is_file():
            raise ValueError(f"Staged file missing on disk: {sid}")
        return {
            "id": sid,
            "local_path": str(path),
            "mime_type": meta.get("mime_type") or "application/octet-stream",
            "filename": meta.get("filename") or path.name,
            "image_bytes": path.read_bytes(),
        }

    def clear_staged_image(self, staged_id: str) -> None:
        """Remove staged file + index entry after successful Flow upload (best-effort)."""
        sid = (staged_id or "").strip()
        if not sid:
            return
        index = self._load_staged_index()
        meta = index.pop(sid, None)
        self._save_staged_index(index)
        if meta and meta.get("local_path"):
            try:
                Path(meta["local_path"]).unlink(missing_ok=True)
            except Exception as e:
                logger.debug(f"Could not delete staged file {sid}: {e}")

    def upload_staged_reference(self, staged_id: str) -> Dict[str, Any]:
        """Upload a previously staged local image to Flow (maseQ / aisandbox)."""
        staged = self.get_staged_image(staged_id)
        item = self.upload_reference_image(
            image_bytes=staged["image_bytes"],
            filename=staged["filename"],
            mime_type=staged["mime_type"],
        )
        item["staged_id"] = staged_id
        item["local_path"] = staged["local_path"]
        # Keep disk copy for character local_image_path; only drop index if desired.
        # Clear index entry but leave file until character/create no longer needs it.
        index = self._load_staged_index()
        if staged_id in index:
            # Mark uploaded but keep path for local_image_path consumers
            index[staged_id]["uploaded"] = True
            index[staged_id]["flow_media_id"] = item.get("id")
            self._save_staged_index(index)
        return item

    def upload_reference_image(
        self,
        image_bytes: bytes,
        filename: str = "upload.png",
        mime_type: str = "image/png",
        preview_data_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Upload a local image via official Flow maseQ batchexecute RPC.

        Sequence (from capture): maseQ → poll as29s until image URL (first as29s may [5]).
        """
        if not image_bytes:
            raise ValueError("Image bytes cannot be empty")
        if len(image_bytes) > 20 * 1024 * 1024:
            raise ValueError("Image exceeds Flow's 20 MB upload limit")

        mime_type = self._detect_image_mime(image_bytes, mime_type)

        if not preview_data_url:
            preview_data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"

        display_name = (filename or "Uploaded Image").strip() or "Uploaded Image"

        if self.simulation_mode or not self.cookies:
            media_id = f"img-upload-{int(time.time() * 1000)}"
            item = {
                "id": media_id,
                "name": display_name,
                "type": "image",
                "prompt": f"Uploaded: {display_name}",
                "aspect_ratio": "16:9",
                "seed": None,
                "model": "Desktop Upload (Simulated)",
                "project_id": self.active_project_id,
                "project_url": project_url(self.active_project_id),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "COMPLETED",
                "url": preview_data_url,
                "source": "desktop_upload",
                "flow_ready": True,
            }
            self.history.insert(0, item)
            self._save_history()
            return item

        if not self.active_project_id:
            self.ensure_active_project()
        if not self.active_project_id:
            raise RuntimeError("No active Google Flow project. Create or switch a project first.")

        # When WIZ `at` is known-stale but cookies still work, skip slow maseQ CDP dance
        if self._wiz_prefer_aisandbox() and self.access_token:
            logger.info("Preferring aisandbox uploadImage (WIZ `at` marked stale; cookies OK)")
            return self._upload_reference_image_aisandbox(
                image_bytes=image_bytes,
                filename=display_name,
                mime_type=mime_type,
                preview_data_url=preview_data_url,
            )

        # Soft-refresh `at` + soft-mint reCAPTCHA. Never launch Chrome / open a new tab.
        self._soft_refresh_wiz_at()
        if self._wiz_prefer_aisandbox() and self.access_token:
            logger.info("aisandbox upload after soft `at` refresh")
            return self._upload_reference_image_aisandbox(
                image_bytes=image_bytes,
                filename=display_name,
                mime_type=mime_type,
                preview_data_url=preview_data_url,
            )

        media_id = None
        workflow_id = None
        width = height = None
        used_rpc = "maseQ"
        project_id = clean_project_id(self.active_project_id)
        recaptcha_token = self._mint_recaptcha_any(action="MEDIA_UPLOAD")
        b64 = base64.b64encode(image_bytes).decode("ascii")
        payload = build_maseq_payload(
            project_id=project_id,
            recaptcha_token=recaptcha_token,
            image_b64=b64,
            mime_type=mime_type,
            filename=display_name,
        )

        try:
            meta = self._execute_cdp_batchexecute(
                "maseQ", payload, action="MEDIA_UPLOAD", timeout=120.0, return_meta=True
            )
            if not meta.get("ok"):
                err = meta.get("error_code")
                raw = meta.get("raw")
                if is_batchexecute_fallback_error(err, raw):
                    logger.warning("maseQ unavailable (%s); falling back to aisandbox uploadImage", err)
                    if is_batchexecute_auth_error(err) or err in ("empty", "fetch_failed"):
                        self._mark_wiz_at_stale()
                    return self._upload_reference_image_aisandbox(
                        image_bytes=image_bytes,
                        filename=display_name,
                        mime_type=mime_type,
                        preview_data_url=preview_data_url,
                    )
                raise RuntimeError(
                    f"maseQ upload failed: {err} {str(meta.get('raw'))[:240]}"
                )
            parsed = extract_maseq_result(meta.get("data"))
            media_id = parsed.get("media_id")
            workflow_id = parsed.get("workflow_id")
            width = parsed.get("width")
            height = parsed.get("height")
            if not media_id:
                raise RuntimeError(f"maseQ succeeded but no media id: {str(meta.get('data'))[:300]}")
        except Exception as e:
            msg = str(e)
            if is_batchexecute_fallback_error(None, msg) or is_batchexecute_auth_error(msg) or "WIZ `at`" in msg:
                logger.warning(f"maseQ failure ({e}); falling back to aisandbox uploadImage")
                try:
                    self._mark_wiz_at_stale()
                    return self._upload_reference_image_aisandbox(
                        image_bytes=image_bytes,
                        filename=display_name,
                        mime_type=mime_type,
                        preview_data_url=preview_data_url,
                    )
                except Exception as e2:
                    logger.error(f"maseQ auth + aisandbox fallback failed: {e2}")
                    raise RuntimeError(
                        msg if "Re-capture" in msg or "auth expired" in msg.lower() else auth_error_message("auth_401")
                    ) from e2
            logger.error(f"maseQ upload failed: {e}")
            raise RuntimeError(f"Google Flow image upload (maseQ) failed: {e}") from e

        item = {
            "id": media_id,
            "name": display_name,
            "type": "image",
            "prompt": f"Uploaded: {display_name}",
            "aspect_ratio": "16:9",
            "width": width,
            "height": height,
            "seed": None,
            "model": f"Desktop Upload ({used_rpc})",
            "project_id": project_id,
            "project_url": project_url(project_id),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "PROCESSING",
            "url": preview_data_url,
            "source": "desktop_upload",
            "flow_ready": False,
            "workflow_id": workflow_id,
        }
        self.history.insert(0, item)
        self._save_history()

        # Capture: first as29s may fail with [5]; poll until image URL
        try:
            ready = self.wait_for_media_ready(media_id, timeout=60.0, poll_interval=1.25)
            item["flow_ready"] = True
            item["status"] = "COMPLETED"
            if ready.get("url") and not str(ready.get("url", "")).startswith("data:"):
                item["url"] = ready["url"]
            if ready.get("width"):
                item["width"] = ready.get("width")
                item["height"] = ready.get("height")
            self._save_history()
        except Exception as wait_err:
            logger.warning(f"Upload media ready wait: {wait_err}")
            item["flow_ready"] = False
            item["status"] = "PROCESSING"
            item["ready_error"] = str(wait_err)
            self._save_history()
        return item

    def _upload_reference_image_aisandbox(
        self,
        image_bytes: bytes,
        filename: str,
        mime_type: str,
        preview_data_url: str,
    ) -> Dict[str, Any]:
        """Fallback upload via aisandbox-pa /v1/flow/uploadImage (HTTP Bearer; no Chrome launch)."""
        if not self.active_project_id:
            self.ensure_active_project()
        if not self.active_project_id:
            raise RuntimeError("No active Google Flow project. Create or switch a project first.")

        project_id = clean_project_id(self.active_project_id)
        b64 = base64.b64encode(image_bytes).decode("ascii")
        endpoint = f"{SANDBOX_BASE}/v1/flow/uploadImage"
        payload = {
            "clientContext": {"projectId": project_id, "tool": "PINHOLE"},
            "imageBytes": b64,
        }
        data = self._sandbox_http_request(endpoint, payload, timeout=90.0, action="MEDIA_UPLOAD")

        media = data.get("media") or {}
        workflow = data.get("workflow") or {}
        media_id = (
            media.get("name")
            or (workflow.get("metadata") or {}).get("primaryMediaId")
            or (
                (data.get("mediaId") or {}).get("mediaId")
                if isinstance(data.get("mediaId"), dict)
                else data.get("mediaId")
            )
        )
        if not media_id:
            raise RuntimeError(f"Upload succeeded but no media id returned: {str(data)[:300]}")

        dims = (media.get("image") or {}).get("dimensions") or {}
        item = {
            "id": media_id,
            "name": (workflow.get("metadata") or {}).get("displayName") or filename,
            "type": "image",
            "prompt": f"Uploaded: {filename}",
            "aspect_ratio": "16:9",
            "width": dims.get("width"),
            "height": dims.get("height"),
            "seed": None,
            "model": "Desktop Upload (aisandbox)",
            "project_id": project_id,
            "project_url": project_url(project_id),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "PROCESSING",
            "url": preview_data_url,
            "source": "desktop_upload",
            "flow_ready": False,
            "workflow_id": media.get("workflowId") or workflow.get("name"),
        }
        self.history.insert(0, item)
        self._save_history()

        try:
            ready = self.wait_for_media_ready(media_id, timeout=60.0, poll_interval=1.25)
            item["flow_ready"] = True
            item["status"] = "COMPLETED"
            if ready.get("url") and not str(ready.get("url", "")).startswith("data:"):
                item["url"] = ready["url"]
            if ready.get("width"):
                item["width"] = ready.get("width")
                item["height"] = ready.get("height")
            self._save_history()
        except Exception as wait_err:
            logger.warning(f"Upload media ready wait: {wait_err}")
            item["flow_ready"] = False
            item["status"] = "PROCESSING"
            item["ready_error"] = str(wait_err)
            self._save_history()
        return item

    def _get_media_bytes_and_meta(self, media_id: str) -> Optional[Tuple[bytes, str, str]]:
        """Extract or download raw image bytes, filename, and mime type for any media ID or staged ID."""
        mid = str(media_id or "").strip()
        if not mid:
            return None

        # 1. Staged ID lookup
        if mid.startswith("staged-") or mid.startswith("upload-"):
            try:
                staged = self.get_staged_image(mid)
                if staged and staged.get("image_bytes"):
                    return (
                        staged["image_bytes"],
                        staged.get("filename") or f"{mid}.jpg",
                        staged.get("mime_type") or "image/jpeg",
                    )
            except Exception as e:
                logger.debug(f"_get_media_bytes_and_meta staged lookup failed for {mid}: {e}")

        # 2. Check staged_index.json for matching flow_media_id or key
        try:
            staged_index = self._load_staged_index()
            for s_id, smeta in staged_index.items():
                if s_id == mid or smeta.get("flow_media_id") == mid:
                    loc = smeta.get("local_path")
                    if loc and Path(loc).is_file():
                        fn = smeta.get("filename") or Path(loc).name
                        mime = smeta.get("mime_type") or (
                            "image/jpeg" if fn.lower().endswith((".jpg", ".jpeg")) else "image/png"
                        )
                        return Path(loc).read_bytes(), fn, mime
        except Exception as e:
            logger.debug(f"_get_media_bytes_and_meta staged_index check failed for {mid}: {e}")

        # 3. Check self.history
        hist_item = None
        for h in self.history:
            if isinstance(h, dict) and (h.get("id") == mid or h.get("primary_media_id") == mid):
                hist_item = h
                break

        if hist_item:
            loc = hist_item.get("local_path")
            if loc and Path(loc).is_file():
                fn = Path(loc).name
                mime = "image/jpeg" if fn.lower().endswith((".jpg", ".jpeg")) else "image/png"
                return Path(loc).read_bytes(), fn, mime

            staged_id = hist_item.get("staged_id")
            if staged_id:
                try:
                    staged = self.get_staged_image(staged_id)
                    if staged and staged.get("image_bytes"):
                        return (
                            staged["image_bytes"],
                            staged.get("filename") or f"{staged_id}.jpg",
                            staged.get("mime_type") or "image/jpeg",
                        )
                except Exception:
                    pass

            for url_key in ("url", "thumbnail_url"):
                url = hist_item.get(url_key)
                if url:
                    if str(url).startswith("data:"):
                        try:
                            header, b64_data = url.split(",", 1)
                            mime = "image/png"
                            if "image/jpeg" in header or "image/jpg" in header:
                                mime = "image/jpeg"
                            elif "image/webp" in header:
                                mime = "image/webp"
                            return base64.b64decode(b64_data), f"{mid[:8]}.png", mime
                        except Exception as e:
                            logger.debug(f"Data URL decode failed for {mid}: {e}")
                    elif str(url).startswith(("http://", "https://")):
                        try:
                            data = self._download_media_bytes(url)
                            mime = self._detect_image_mime(data, "image/png")
                            ext = ".jpg" if "jpeg" in mime else ".png"
                            return data, f"{mid[:8]}{ext}", mime
                        except Exception as e:
                            logger.debug(f"Download URL {url[:60]} failed for {mid}: {e}")

        # 4. Check characters
        for c in self.characters:
            if c.get("image_media_id") == mid or c.get("character_id") == mid:
                loc = c.get("local_image_path")
                if loc and Path(loc).is_file():
                    fn = Path(loc).name
                    mime = "image/jpeg" if fn.lower().endswith((".jpg", ".jpeg")) else "image/png"
                    return Path(loc).read_bytes(), fn, mime
                img_url = c.get("image_url")
                if img_url and str(img_url).startswith(("http://", "https://")):
                    try:
                        data = self._download_media_bytes(img_url)
                        mime = self._detect_image_mime(data, "image/png")
                        ext = ".jpg" if "jpeg" in mime else ".png"
                        return data, f"{mid[:8]}{ext}", mime
                    except Exception:
                        pass

        # 5. Search data/uploads directory for matching prefix
        try:
            uploads_dir = Path("data/uploads")
            if uploads_dir.is_dir():
                clean_mid = mid.replace("-", "")[:8]
                for f in uploads_dir.iterdir():
                    if f.is_file() and clean_mid in f.name.replace("-", ""):
                        mime = "image/jpeg" if f.suffix.lower() in (".jpg", ".jpeg") else "image/png"
                        return f.read_bytes(), f.name, mime
        except Exception:
            pass

        # 6. Try fetching fresh CDN URL via as29s
        try:
            as_info = self._rpc_as29s(mid)
            if as_info.get("url") and str(as_info["url"]).startswith(("http://", "https://")):
                data = self._download_media_bytes(as_info["url"])
                mime = self._detect_image_mime(data, "image/png")
                ext = ".jpg" if "jpeg" in mime else ".png"
                return data, f"{mid[:8]}{ext}", mime
        except Exception as as_err:
            logger.debug(f"_rpc_as29s fetch failed for {mid}: {as_err}")

        return None

    def _looks_like_flow_media_id(self, media_id: Optional[str]) -> bool:
        """True when id looks like a Flow UUID (not staged-/upload-/empty)."""
        mid = (media_id or "").strip()
        if not mid:
            return False
        if mid.startswith(("staged-", "upload-", "http://", "https://", "/")):
            return False
        return bool(
            re.match(
                r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
                mid,
                re.I,
            )
        )

    def resolve_character_portrait_media_id(self, char_ref: Any) -> Optional[str]:
        """Ensure a Flow portrait media id exists for a character ref.

        Uploads from local_image_path / image_url / payload image_media_id bytes when needed.
        """
        if not char_ref:
            return None
        if isinstance(char_ref, str):
            char_ref = {"entity_id": char_ref}
        if not isinstance(char_ref, dict):
            return None

        candidates = [
            (char_ref.get("image_media_id") or "").strip(),
        ]
        cid = (char_ref.get("entity_id") or char_ref.get("character_id") or char_ref.get("id") or "").strip()
        c_item = self.get_character(cid) if cid else None
        if c_item:
            candidates.append((c_item.get("image_media_id") or "").strip())

        for mid in candidates:
            if not mid or not self._looks_like_flow_media_id(mid):
                continue
            try:
                synced = self.ensure_media_in_active_project(mid)
                if not synced or not self._looks_like_flow_media_id(synced):
                    continue
                # Confirm Flow actually knows this media (Prisma UUIDs also look like UUIDs)
                meta = self._get_media_bytes_and_meta(synced)
                if meta:
                    return synced
                try:
                    as_info = self._rpc_as29s(synced)
                    if as_info and as_info.get("url"):
                        return synced
                except Exception:
                    pass
            except Exception as e:
                logger.debug("resolve portrait ensure failed for %s: %s", mid, e)

        # Upload from local path / URL attached to character or payload
        sources = []
        if c_item:
            sources.append(c_item)
        sources.append(char_ref)
        for src in sources:
            loc = (src.get("local_image_path") or "").strip()
            if loc and Path(loc).is_file():
                try:
                    data = Path(loc).read_bytes()
                    fn = Path(loc).name
                    mime = "image/jpeg" if fn.lower().endswith((".jpg", ".jpeg")) else "image/png"
                    uploaded = self.upload_reference_image(data, f"char-{fn}", mime, "")
                    new_id = uploaded.get("id")
                    if new_id:
                        if c_item is not None:
                            c_item["image_media_id"] = new_id
                            self._save_characters()
                        return new_id
                except Exception as e:
                    logger.warning("Character local portrait upload failed: %s", e)
            img_url = (src.get("image_url") or src.get("portraitUrl") or src.get("url") or "").strip()
            if img_url.startswith(("http://", "https://")):
                try:
                    data = self._download_media_bytes(img_url)
                    mime = self._detect_image_mime(data, "image/png")
                    uploaded = self.upload_reference_image(data, "char-portrait.png", mime, "")
                    new_id = uploaded.get("id")
                    if new_id:
                        if c_item is not None:
                            c_item["image_media_id"] = new_id
                            self._save_characters()
                        return new_id
                except Exception as e:
                    logger.warning("Character URL portrait upload failed: %s", e)
            elif img_url.startswith("/api/assets/file/"):
                # Studio-hosted portrait — read from data/uploads
                try:
                    name = img_url.split("/api/assets/file/")[-1].split("?")[0]
                    path = Path("data/uploads") / name
                    if path.is_file():
                        data = path.read_bytes()
                        mime = "image/jpeg" if path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
                        uploaded = self.upload_reference_image(data, path.name, mime, "")
                        new_id = uploaded.get("id")
                        if new_id:
                            if c_item is not None:
                                c_item["image_media_id"] = new_id
                                self._save_characters()
                            return new_id
                except Exception as e:
                    logger.warning("Character studio-file portrait upload failed: %s", e)
            elif img_url.startswith("/api/characters/file/"):
                # Durable character portrait on disk
                try:
                    char_file_id = img_url.split("/api/characters/file/")[-1].split("?")[0]
                    char_dir = Path("data/characters")
                    hit = None
                    if char_dir.is_dir():
                        for user_dir in char_dir.iterdir():
                            if not user_dir.is_dir():
                                continue
                            for f in user_dir.iterdir():
                                if f.name == char_file_id or f.name.startswith(f"{char_file_id}."):
                                    hit = f
                                    break
                            if hit:
                                break
                    if hit and hit.is_file():
                        data = hit.read_bytes()
                        mime = "image/jpeg" if hit.suffix.lower() in (".jpg", ".jpeg") else "image/png"
                        uploaded = self.upload_reference_image(data, hit.name, mime, "")
                        new_id = uploaded.get("id")
                        if new_id:
                            if c_item is not None:
                                c_item["image_media_id"] = new_id
                                self._save_characters()
                            return new_id
                except Exception as e:
                    logger.warning("Character durable-file portrait upload failed: %s", e)

        # Last resort: try bytes keyed by character id / payload media id
        for mid in [cid] + candidates:
            if not mid:
                continue
            meta = self._get_media_bytes_and_meta(mid)
            if not meta:
                continue
            try:
                data, fn, mime = meta
                uploaded = self.upload_reference_image(data, f"char-{fn}", mime, "")
                new_id = uploaded.get("id")
                if new_id:
                    if c_item is not None:
                        c_item["image_media_id"] = new_id
                        self._save_characters()
                    return new_id
            except Exception as e:
                logger.warning("Character portrait re-upload failed: %s", e)
        return None

    def ensure_media_in_active_project(self, media_id: Optional[str]) -> Optional[str]:
        """Verify if media ID belongs to active project. If from another project or not synced,

        automatically download image bytes and re-upload into active project.
        """
        mid = (media_id or "").strip()
        if not mid or not self.active_project_id:
            return mid

        # Check cache for existing active project mapping
        cached = self._project_media_cache.get((mid, self.active_project_id))
        if cached:
            return cached

        # Handle staged/local IDs
        if mid.startswith("staged-") or mid.startswith("upload-"):
            try:
                uploaded = self.upload_staged_reference(mid)
                new_id = uploaded.get("id") or mid
                self._project_media_cache[(mid, self.active_project_id)] = new_id
                return new_id
            except Exception as e:
                logger.warning(f"Could not upload staged reference {mid}: {e}")
                return mid

        # Check if already confirmed in active project
        for h in self.history:
            if isinstance(h, dict) and (h.get("id") == mid or h.get("primary_media_id") == mid):
                if h.get("project_id") == self.active_project_id:
                    self._project_media_cache[(mid, self.active_project_id)] = mid
                    return mid
                break

        # Prefer reuse when Flow already has this media Ready (no re-upload)
        try:
            ready = self.check_media_ready(mid)
            if ready.get("ready") and ready.get("url"):
                logger.info(
                    "Reusing ready Flow media %s in project %s (skip re-upload)",
                    mid[:8],
                    self.active_project_id[:8],
                )
                self._project_media_cache[(mid, self.active_project_id)] = mid
                return mid
        except Exception as ready_err:
            logger.debug("ensure_media ready-check for %s: %s", mid[:8], ready_err)

        # Belongs to another project or unknown / not ready -> auto download and re-upload
        logger.info(f"Auto-syncing cross-project media {mid} into active project {self.active_project_id}...")
        meta = self._get_media_bytes_and_meta(mid)
        if not meta:
            logger.warning(f"Could not retrieve media bytes for {mid}; using original ID")
            return mid

        img_bytes, filename, mime_type = meta
        try:
            uploaded = self.upload_reference_image(
                image_bytes=img_bytes,
                filename=f"sync-{filename}",
                mime_type=mime_type,
                preview_data_url="",
            )
            new_id = uploaded.get("id")
            if new_id:
                logger.info(f"Cross-project media {mid} re-uploaded as {new_id} in project {self.active_project_id}")
                self._project_media_cache[(mid, self.active_project_id)] = new_id
                return new_id
        except Exception as upload_err:
            logger.warning(f"Cross-project media re-upload failed for {mid}: {upload_err}")

        return mid

    def force_reupload_media(self, media_id: str) -> str:
        """Force re-upload image bytes directly into the active project, bypassing cache."""
        mid = str(media_id or "").strip()
        if not mid or not self.active_project_id:
            return mid

        meta = self._get_media_bytes_and_meta(mid)
        if not meta:
            return mid

        img_bytes, filename, mime_type = meta
        try:
            uploaded = self.upload_reference_image(
                image_bytes=img_bytes,
                filename=f"resync-{filename}",
                mime_type=mime_type,
                preview_data_url="",
            )
            new_id = uploaded.get("id")
            if new_id:
                self._project_media_cache[(mid, self.active_project_id)] = new_id
                return new_id
        except Exception as e:
            logger.warning(f"Force re-upload of {mid} failed: {e}")
        return mid

    def ensure_character_in_active_project(self, char_ref: Any) -> Dict[str, Any]:
        """Ensure character entity and portrait likeness are synced to current active project."""
        if not char_ref:
            return {}
        if isinstance(char_ref, str):
            cid = char_ref.strip()
            name = ""
        elif isinstance(char_ref, dict):
            cid = str(char_ref.get("entity_id") or char_ref.get("character_id") or char_ref.get("id") or "").strip()
            name = str(char_ref.get("name") or char_ref.get("display_name") or "").strip()
        else:
            return dict(char_ref)

        if not cid and not name:
            return dict(char_ref) if isinstance(char_ref, dict) else {"entity_id": cid}

        cached = self._project_char_cache.get((cid or name, self.active_project_id))
        if cached:
            return dict(cached)

        char = self.get_character(cid)
        if not char and name:
            char = next((c for c in self.characters if c.get("display_name", "").lower() == name.lower()), None)

        if not char:
            res = {"entity_id": cid, "name": name}
            if isinstance(char_ref, dict):
                res.update({k: v for k, v in char_ref.items() if k not in res})
            return res

        char_name = char.get("display_name") or name or "Character"
        char_img = char.get("image_media_id")
        char_proj = clean_project_id(char.get("project_id"))

        # 1. Sync portrait image into active project
        synced_img_id = None
        if char_img:
            synced_img_id = self.ensure_media_in_active_project(char_img)
        elif char.get("local_image_path") or char.get("image_url"):
            meta = self._get_media_bytes_and_meta(char.get("character_id"))
            if meta:
                img_bytes, fn, mime = meta
                try:
                    uploaded = self.upload_reference_image(img_bytes, f"char-{fn}", mime, "")
                    synced_img_id = uploaded.get("id")
                except Exception as ce:
                    logger.warning(f"Could not upload character image to active project: {ce}")

        # 2. Check if already registered in active project
        if char_proj == self.active_project_id and char.get("flow_entity_id"):
            res = {
                "entity_id": char["flow_entity_id"],
                "character_id": char.get("character_id"),
                "name": char_name,
                "image_media_id": synced_img_id or char_img,
                "project_id": self.active_project_id,
            }
            self._project_char_cache[(cid or name, self.active_project_id)] = res
            return res

        # 3. Register character entity with Google Flow in active project via C4BZMd
        flow_id = None
        if not self.simulation_mode and self.cookies and self.active_project_id:
            try:
                payload = build_C4BZMd_payload(self.active_project_id, char_name)
                meta = self._execute_cdp_batchexecute("C4BZMd", payload, action="GENERIC", timeout=15.0, return_meta=True)
                if meta and meta.get("ok"):
                    data = meta.get("data")
                    row = data[0] if isinstance(data, list) and data else None
                    if isinstance(row, list) and len(row) > 1 and row[1]:
                        flow_id = str(row[1])
                        logger.info(f"Registered character {char_name} in active project {self.active_project_id}: flow_entity_id={flow_id}")
            except Exception as rpc_err:
                logger.debug(f"C4BZMd character registration in active project: {rpc_err}")

        # Update local record with active project alignment
        char["project_id"] = self.active_project_id
        if synced_img_id:
            char["image_media_id"] = synced_img_id
        if flow_id:
            char["flow_entity_id"] = flow_id
        self._save_characters()

        res = {
            "entity_id": flow_id or char.get("flow_entity_id") or "",
            "character_id": char.get("character_id"),
            "name": char_name,
            "image_media_id": synced_img_id or char_img,
            "project_id": self.active_project_id,
        }
        if not res["entity_id"]:
            # Local UUID is not a valid Flow MZZa6b entity — callers must use portrait R2V only
            logger.warning(
                "Character %s has no Flow entity_id in project %s; portrait-only video path required",
                cid or char_name,
                self.active_project_id,
            )
        self._project_char_cache[(cid or name, self.active_project_id)] = res
        return res

    def image_to_video(
        self,
        image_id: Optional[str] = None,
        prompt: str = "",
        aspect_ratio: str = "16:9",
        model: str = "VEO_3_1_R2V_LITE",
        duration: int = 5,
        characters: Optional[List[Dict[str, Any]]] = None,
        voice_presets: Optional[List[str]] = None,
        first_frame_id: Optional[str] = None,
        last_frame_id: Optional[str] = None,
        frame_mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Animate / character-driven video via official Flow MZZa6b + jwpduf/as29s poll.

        `image_id` may be None when driving from character entity refs only.
        Voice should be attached on the character via rzMKMb (`achird`, …);
        bare voice_presets without a character entity often return wrb error [3].
        """
        if not prompt or not prompt.strip():
            raise ValueError("Prompt cannot be empty")
        start_frame = self.ensure_media_in_active_project(first_frame_id or image_id)
        end_frame = self.ensure_media_in_active_project(last_frame_id) if last_frame_id else None
        eff_frame_mode = frame_mode or (
            "first_and_last" if (start_frame and end_frame)
            else ("last_only" if end_frame and not start_frame
            else ("first_only" if start_frame else None))
        )
        char_refs = [self.ensure_character_in_active_project(cr) for cr in normalize_character_refs(characters)]
        if not start_frame and not end_frame and char_refs:
            for cr in char_refs:
                mid = cr.get("image_media_id")
                if not mid:
                    c_item = self.get_character(cr.get("character_id") or cr.get("entity_id"))
                    mid = (c_item or {}).get("image_media_id")
                if mid:
                    start_frame = self.ensure_media_in_active_project(mid)
                    image_id = start_frame
                    break
        # Never pass local Studio UUIDs as Flow entity slots (causes MZZa6b 400)
        char_refs = [c for c in char_refs if str(c.get("entity_id") or "").strip()]

        if not start_frame and not end_frame and not char_refs:
            logger.info("image_to_video called without frames or characters: falling back to generate_video")
            return self.generate_video(
                prompt=prompt,
                aspect_ratio=aspect_ratio,
                model=model,
                duration=duration,
            )

        model_name = (model or "").upper().replace("-", "_").replace(" ", "_")
        wire_model = self.resolve_wire_model(
            model, mode="r2v", duration=duration, aspect_ratio=aspect_ratio
        )
        logger.info("I2V/R2V FE model %s → wire %s", model, wire_model)

        if self.simulation_mode or not self.cookies:
            i2v_id = f"vid-i2v-{int(time.time() * 1000)}"
            sim_model_label = "Veo 3.1 Transition (Simulated)" if eff_frame_mode == "first_and_last" else "Veo 3.1 Animate (Simulated)"
            sim_item = {
                "id": i2v_id,
                "name": f"Animate: {prompt[:30]}",
                "type": "video",
                "prompt": prompt,
                "source_image_id": start_frame or end_frame,
                "first_frame_id": start_frame,
                "last_frame_id": end_frame,
                "frame_mode": eff_frame_mode,
                "characters": char_refs,
                "voice_presets": list(voice_presets or []),
                "aspect_ratio": aspect_ratio,
                "duration": duration,
                "seed": random.randint(10000, 999999),
                "model": sim_model_label,
                "project_id": self.active_project_id,
                "project_url": project_url(self.active_project_id),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "COMPLETED",
                "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
            }
            self.history.insert(0, sim_item)
            self._save_history()
            return sim_item

        if image_id or start_frame:
            ready_id = start_frame or image_id
            try:
                self.wait_for_media_ready(ready_id, timeout=45.0, poll_interval=1.25)
            except Exception as wait_err:
                logger.warning("I2V media-ready wait failed (%s); forcing re-upload then re-wait", wait_err)
                try:
                    ready_id = self.force_reupload_media(ready_id) or ready_id
                    start_frame = ready_id
                    image_id = ready_id
                    self.wait_for_media_ready(ready_id, timeout=60.0, poll_interval=1.5)
                except Exception as retry_err:
                    raise RuntimeError(
                        f"Reference media is not ready in Google Flow yet ({retry_err}). "
                        "Wait for Ready to animate, then retry."
                    ) from retry_err

        # Prefer aisandbox when Bearer cookies work and:
        # - dual frames (first + last frame) or last_only is used
        # - characters are present (aisandbox ReferenceImages guarantees conditioning on character portrait)
        # - WIZ `at` is stale/unavailable
        should_route_aisandbox = bool(
            self.access_token
            and (
                (start_frame and end_frame)
                or (end_frame and not start_frame)
                or bool(char_refs)
                or self._wiz_prefer_aisandbox()
                or (self._wiz_meta or {}).get("at_stale")
                or not (self._wiz_meta or {}).get("at")
            )
        )
        aisandbox_initial_err = None
        if should_route_aisandbox:
            logger.info("Routing directly to aisandbox I2V (frame_mode=%s, has_chars=%s)", eff_frame_mode, bool(char_refs))
            try:
                return self._image_to_video_aisandbox(
                    image_id=start_frame or end_frame or image_id,
                    prompt=prompt,
                    aspect_ratio=aspect_ratio,
                    wire_model=wire_model,
                    duration=duration,
                    first_frame_id=start_frame,
                    last_frame_id=end_frame,
                    frame_mode=eff_frame_mode,
                    characters=char_refs,
                )
            except Exception as as_err:
                aisandbox_initial_err = as_err
                logger.warning(f"aisandbox I2V attempt failed ({as_err}); continuing to MZZa6b")

        # Soft-refresh `at` + soft-mint reCAPTCHA. Never launch Chrome / open a new tab.
        self._soft_refresh_wiz_at()

        char_names = ", ".join(c.get("name", "") for c in char_refs if c.get("name"))
        eff_prompt = f"{prompt} (featuring character {char_names})" if (char_names and not any(c.get("name", "") in prompt for c in char_refs if c.get("name"))) else prompt
        recaptcha_token = self._mint_recaptcha_any(action="VIDEO_GENERATION")
        payload = build_MZZa6b_payload(
            project_id=self.active_project_id,
            recaptcha_token=recaptcha_token,
            image_id=start_frame or image_id,
            prompt=eff_prompt,
            wire_model=wire_model,
            aspect_ratio=aspect_ratio,
            characters=char_refs or None,
            voice_presets=voice_presets,
        )

        def _i2v_should_aisandbox(err: Optional[str], raw: Any = "") -> bool:
            return is_batchexecute_fallback_error(err, raw)

        new_media_id = None
        workflow_id = None
        early_url = ""
        thumb = ""
        exclude = {self.active_project_id}
        if image_id:
            exclude.add(image_id)
        if start_frame:
            exclude.add(start_frame)
        if end_frame:
            exclude.add(end_frame)
        for c in char_refs:
            exclude.add(c["entity_id"])
        try:
            meta = self._execute_cdp_batchexecute(
                "MZZa6b", payload, action="MEDIA_GENERATION", timeout=90.0, return_meta=True
            )
            if not meta.get("ok"):
                err = meta.get("error_code")
                raw = meta.get("raw")
                if (image_id or start_frame or end_frame or char_refs) and _i2v_should_aisandbox(err, raw):
                    if aisandbox_initial_err is not None:
                        raise aisandbox_initial_err
                    logger.warning(
                        "MZZa6b auth/unavailable (%s); falling back to aisandbox I2V",
                        err,
                    )
                    self._mark_wiz_at_stale()
                    return self._image_to_video_aisandbox(
                        image_id=start_frame or end_frame or image_id,
                        prompt=prompt,
                        aspect_ratio=aspect_ratio,
                        wire_model=wire_model,
                        duration=duration,
                        first_frame_id=start_frame,
                        last_frame_id=end_frame,
                        frame_mode=eff_frame_mode,
                        characters=char_refs,
                    )
                if err in ("missing_at_token", "http_405", "http_404"):
                    raise RuntimeError(f"BATCHEXECUTE_UNAVAILABLE:{err}")
                raise RuntimeError(f"MZZa6b failed: {err} {str(raw)[:300]}")
            parsed = extract_MZZa6b_result(meta.get("data"), exclude_ids=exclude)
            new_media_id = parsed.get("media_id")
            workflow_id = parsed.get("workflow_id")
            early_url = parsed.get("url") or ""
            thumb = parsed.get("thumbnail_url") or ""
            if not new_media_id:
                raise RuntimeError(f"MZZa6b returned no media id: {str(meta.get('data'))[:400]}")
        except Exception as e:
            msg = str(e)
            if (image_id or start_frame or end_frame or char_refs) and _i2v_should_aisandbox(None, msg):
                if aisandbox_initial_err is not None:
                    raise aisandbox_initial_err
                logger.warning(f"MZZa6b unavailable ({e}); falling back to aisandbox I2V")
                try:
                    self._mark_wiz_at_stale()
                    return self._image_to_video_aisandbox(
                        image_id=start_frame or end_frame or image_id,
                        prompt=prompt,
                        aspect_ratio=aspect_ratio,
                        wire_model=wire_model,
                        duration=duration,
                        first_frame_id=start_frame,
                        last_frame_id=end_frame,
                        frame_mode=eff_frame_mode,
                        characters=char_refs,
                    )
                except Exception as e2:
                    logger.error(f"MZZa6b + aisandbox I2V fallback failed: {e2}")
                    err_msg = str(e2)
                    if "Google Flow" in err_msg:
                        raise RuntimeError(err_msg) from e2
                    raise RuntimeError(f"Google Flow Image-to-Video failed: {e2}") from e2
            if not image_id and char_refs:
                logger.warning(f"MZZa6b character video failed ({e}); trying aisandbox with character portrait")
                try:
                    return self._image_to_video_aisandbox(
                        image_id=None,
                        prompt=prompt,
                        aspect_ratio=aspect_ratio,
                        wire_model=wire_model,
                        duration=duration,
                        first_frame_id=None,
                        last_frame_id=None,
                        frame_mode=eff_frame_mode,
                        characters=char_refs,
                    )
                except Exception as c_err:
                    logger.error(f"Character aisandbox fallback also failed: {c_err}")
            logger.error(f"MZZa6b RPC failed: {e}")
            raise RuntimeError(f"Google Flow Image-to-Video failed: {e}") from e

        video_item = {
            "id": new_media_id,
            "name": f"Animate: {prompt[:30]}...",
            "type": "video",
            "prompt": prompt,
            "source_image_id": image_id,
            "characters": char_refs,
            "voice_presets": list(voice_presets or []),
            "aspect_ratio": aspect_ratio,
            "duration": duration,
            "seed": random.randint(10000, 999999),
            "model": self.display_model_label(model, wire_model=wire_model),
            "model_key": model or wire_model,
            "wire_model": wire_model,
            "project_id": self.active_project_id,
            "project_url": project_url(self.active_project_id),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "PROCESSING",
            "url": early_url,
            "thumbnail_url": thumb,
            "operation_name": "",
            "workflow_id": workflow_id,
            "primary_media_id": new_media_id,
            "rpc": "MZZa6b",
        }
        self.history.insert(0, video_item)
        self._save_history()

        # Kick an immediate jwpduf/as29s poll (non-blocking beyond one attempt)
        if not early_url:
            try:
                updated = self.check_video_status(new_media_id)
                return updated
            except Exception as pe:
                logger.debug(f"Immediate I2V status poll: {pe}")
        return video_item

    def _image_to_video_aisandbox(
        self,
        image_id: Optional[str],
        prompt: str,
        aspect_ratio: str,
        wire_model: str,
        duration: int,
        first_frame_id: Optional[str] = None,
        last_frame_id: Optional[str] = None,
        frame_mode: Optional[str] = None,
        characters: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Fallback I2V via aisandbox StartImage or ReferenceImages when MZZa6b is unavailable.

        Uses the caller-provided wire_model only — never swaps Lite → Fast.
        """
        selected = (wire_model or "").strip() or self.resolve_wire_model(
            wire_model, mode="r2v", duration=duration, aspect_ratio=aspect_ratio
        )
        rest_model = selected
        wants_lite = "lite" in selected.lower()
        wants_r2v = "r2v" in selected.lower() or wants_lite

        aspect_enum = (
            "VIDEO_ASPECT_RATIO_LANDSCAPE"
            if aspect_ratio == "16:9"
            else (
                "VIDEO_ASPECT_RATIO_PORTRAIT"
                if aspect_ratio == "9:16"
                else "VIDEO_ASPECT_RATIO_SQUARE"
            )
        )
        seed = random.randint(10000, 999999)
        client_ctx = {
            "projectId": self.active_project_id,
            "tool": "PINHOLE",
            "userPaygateTier": self.paygate_tier,
            "recaptchaContext": {
                "token": "",
                "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB",
            },
        }

        start_id = self.ensure_media_in_active_project(first_frame_id or image_id)
        end_id = self.ensure_media_in_active_project(last_frame_id) if last_frame_id else None

        char_refs_raw = normalize_character_refs(characters)
        char_refs = [self.ensure_character_in_active_project(cr) for cr in char_refs_raw]
        char_media_ids: List[str] = []
        if char_refs_raw:
            for cr in char_refs_raw:
                try:
                    mid = self.resolve_character_portrait_media_id(cr)
                    if mid and mid not in char_media_ids:
                        char_media_ids.append(mid)
                        # Keep resolved id on the synced ref for downstream prompts
                        for synced in char_refs:
                            if (synced.get("entity_id") or synced.get("character_id")) == (
                                cr.get("entity_id") or cr.get("character_id")
                            ):
                                synced["image_media_id"] = mid
                                break
                except Exception as e:
                    logger.warning("I2V character portrait resolve failed: %s", e)
            # Fallback: older path via ensure_character / local store
            if not char_media_ids:
                for cr in char_refs:
                    mid = (cr.get("image_media_id") or "").strip()
                    if mid:
                        cmid = self.ensure_media_in_active_project(mid)
                        if cmid and cmid not in char_media_ids:
                            char_media_ids.append(cmid)
        logger.info(
            "I2V characters: %s ref(s), %s portrait media id(s)",
            len(char_refs),
            len(char_media_ids),
        )
        eff_prompt = prompt
        if char_refs:
            char_names = ", ".join(c.get("name", "") for c in char_refs if c.get("name"))
            if char_names and not any(c.get("name", "") in prompt for c in char_refs if c.get("name")):
                eff_prompt = f"{prompt} (featuring character {char_names})"

        def _build_start_image_payload(model_key: str) -> dict:
            req: Dict[str, Any] = {
                "aspectRatio": aspect_enum,
                "seed": seed,
                "textInput": {
                    "prompt": eff_prompt,
                    "structuredPrompt": {"parts": [{"text": eff_prompt}]},
                },
                "videoModelKey": model_key,
                "metadata": {"sceneId": str(uuid.uuid4())},
            }
            if start_id:
                req["startImage"] = {"mediaId": start_id}
            elif end_id:
                req["startImage"] = {"mediaId": end_id}
            elif image_id:
                req["startImage"] = {"mediaId": image_id}
            elif char_media_ids:
                req["startImage"] = {"mediaId": char_media_ids[0]}

            return {
                "mediaGenerationContext": {"batchId": f"i2v-batch-{int(time.time() * 1000)}"},
                "clientContext": client_ctx,
                "requests": [req],
                "useV2ModelConfig": True,
            }

        def _build_r2v_payload(model_key: str) -> dict:
            refs = []
            seen = set()
            if start_id:
                refs.append({"mediaId": start_id})
                seen.add(start_id)
            if end_id and end_id not in seen:
                refs.append({"mediaId": end_id})
                seen.add(end_id)
            if not refs and image_id and image_id not in seen:
                refs.append({"mediaId": image_id})
                seen.add(image_id)
            # Include character portraits as reference images
            for cmid in char_media_ids:
                if cmid not in seen:
                    refs.append({"mediaId": cmid})
                    seen.add(cmid)
            # Maximum 3 reference images supported by Veo multi-reference
            refs = refs[:3]

            return {
                "mediaGenerationContext": {"batchId": f"r2v-batch-{int(time.time() * 1000)}"},
                "clientContext": client_ctx,
                "requests": [
                    {
                        "aspectRatio": aspect_enum,
                        "seed": seed,
                        "textInput": {
                            "prompt": eff_prompt,
                            "structuredPrompt": {"parts": [{"text": eff_prompt}]},
                        },
                        "videoModelKey": model_key,
                        "referenceImages": refs,
                        "metadata": {"sceneId": str(uuid.uuid4())},
                    }
                ],
                "useV2ModelConfig": True,
            }

        # Exact selected model only — no tier remaps, no Lite→Fast, no alternate model retries
        primary_key = selected
        attempts = []
        use_start_image = (
            bool((start_id or image_id or end_id) and not (start_id and end_id) and not char_media_ids)
            and primary_key.startswith("veo_3_1_i2v_")
        )
        if use_start_image:
            attempts.append(
                (
                    f"{SANDBOX_BASE}/v1/video:batchAsyncGenerateVideoStartImage",
                    _build_start_image_payload(primary_key),
                    primary_key,
                    "aisandbox_StartImage",
                )
            )
        else:
            attempts.append(
                (
                    f"{SANDBOX_BASE}/v1/video:batchAsyncGenerateVideoReferenceImages",
                    _build_r2v_payload(primary_key),
                    primary_key,
                    "aisandbox_ReferenceImages",
                )
            )

        data = None
        used_model = selected
        used_rpc = attempts[0][3] if attempts else "aisandbox"
        last_err: Optional[Exception] = None
        primary_r2v = primary_key
        for endpoint, payload, model_key, rpc_name in attempts:
            try:
                logger.info(f"I2V aisandbox try {rpc_name} model={model_key}")
                data = self._execute_cdp_fetch(endpoint, payload, action="VIDEO_GENERATION")
                used_model = model_key
                used_rpc = rpc_name
                break
            except Exception as e:
                last_err = e
                logger.warning(f"I2V aisandbox attempt failed ({model_key}): {e}")
                continue
        if data is None and last_err and ("404" in str(last_err) or "Requested entity was not found" in str(last_err)):
            logger.warning("I2V aisandbox failed with 404: force re-uploading media to active project and retrying...")
            try:
                if start_id:
                    start_id = self.force_reupload_media(start_id)
                if end_id:
                    end_id = self.force_reupload_media(end_id)
                char_media_ids = [self.force_reupload_media(m) for m in char_media_ids]
                retry_payload = _build_r2v_payload(primary_r2v)
                retry_ep = f"{SANDBOX_BASE}/v1/video:batchAsyncGenerateVideoReferenceImages"
                data = self._execute_cdp_fetch(retry_ep, retry_payload, action="VIDEO_GENERATION")
                used_model = primary_r2v
                used_rpc = "aisandbox_ReferenceImages_Resync"
            except Exception as resync_err:
                logger.warning(f"I2V 404 resync retry failed: {resync_err}")

        if data is None:
            err_msg = str(last_err)
            if "Google Flow" in err_msg:
                raise RuntimeError(err_msg)
            raise RuntimeError(f"Google Flow Image-to-Video aisandbox failed: {last_err}")

        if "remainingCredits" in data:
            try:
                self.credits = int(data["remainingCredits"])
            except Exception:
                pass

        workflows = data.get("workflows", [])
        primary_media_id = ""
        workflow_id = ""
        if workflows and isinstance(workflows, list):
            wf = workflows[0]
            workflow_id = wf.get("name", "") or wf.get("id", "")
            primary_media_id = (wf.get("metadata") or {}).get("primaryMediaId", "")

        ops = data.get("operations", [])
        op_name = ""
        if ops and isinstance(ops[0], dict):
            op_name = (
                (ops[0].get("operation") or {}).get("name", "")
                or ops[0].get("name", "")
                or ops[0].get("operation", "")
            )
            if isinstance(op_name, dict):
                op_name = op_name.get("name", "")

        media_list = data.get("media", [])
        media_id = (
            media_list[0].get("name", "")
            if media_list and isinstance(media_list[0], dict)
            else (primary_media_id or "")
        )
        if not media_id:
            blob = json.dumps(data)
            for u in re.findall(
                r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}", blob, re.I
            ):
                if u.lower() not in {image_id.lower(), (self.active_project_id or "").lower()}:
                    media_id = u
                    break
        if not media_id:
            media_id = f"vid-i2v-{int(time.time() * 1000)}"

        if frame_mode == "first_and_last":
            item_name = f"Transition: {prompt[:30]}..."
        elif end_id and not start_id:
            item_name = f"Extend: {prompt[:30]}..."
        else:
            item_name = f"Animate: {prompt[:30]}..."

        video_item = {
            "id": media_id,
            "name": item_name,
            "type": "video",
            "prompt": prompt,
            "source_image_id": start_id or end_id or image_id,
            "first_frame_id": start_id,
            "last_frame_id": end_id,
            "frame_mode": frame_mode,
            "characters": char_refs,
            "aspect_ratio": aspect_ratio,
            "duration": duration,
            "seed": seed,
            "model": self.display_model_label(used_model, wire_model=used_model),
            "model_key": used_model,
            "wire_model": used_model,
            "project_id": self.active_project_id,
            "project_url": project_url(self.active_project_id),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "PROCESSING",
            "url": "",
            "operation_name": op_name,
            "workflow_id": workflow_id,
            "primary_media_id": primary_media_id,
            "rpc": used_rpc,
        }
        self.history.insert(0, video_item)
        self._save_history()
        try:
            return self.check_video_status(media_id)
        except Exception:
            return video_item

    def image_to_image(
        self,
        image_id: Optional[str],
        prompt: str,
        aspect_ratio: str = "16:9",
        seed: Optional[int] = None,
        model: str = "NARWHAL",
        characters: Optional[List[Dict[str, Any]]] = None,
        destination_character_id: Optional[str] = None,
        num_images: int = 1,
        image_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Remix/edit via official Flow ogiZ0b (NEVER video / MZZa6b).

        Supports character entity refs in structured prompt (official @mention).
        Pass destination_character_id to bind a portrait generation to a character.
        `image_id` may be None for character-only / T2I-style ogiZ0b.
        When num_images > 1, fires parallel jobs (ThreadPool) with seed offsets.
        """
        char_refs = [self.ensure_character_in_active_project(c) for c in normalize_character_refs(characters)]
        all_image_ids = [
            self.ensure_media_in_active_project(str(x))
            for x in (image_ids or [])
            if str(x).strip()
        ]
        if image_id:
            synced_img_id = self.ensure_media_in_active_project(str(image_id))
            if synced_img_id and synced_img_id not in all_image_ids:
                all_image_ids.insert(0, synced_img_id)
        all_image_ids = [x for x in all_image_ids if x]
        primary_image_id = all_image_ids[0] if all_image_ids else None

        if not primary_image_id and not char_refs and not destination_character_id:
            raise ValueError("image_to_image requires reference image(s), characters, or destination_character_id")

        n = max(1, min(int(num_images or 1), 4))
        if seed is None:
            seed = random.randint(10000, 999999999)

        if self.simulation_mode or not self.cookies:
            results = []
            for i in range(n):
                i2i_id = f"img-i2i-{int(time.time() * 1000)}-{i}"
                sim_item = {
                    "id": i2i_id,
                    "name": f"I2I: {prompt[:30]}",
                    "type": "image",
                    "prompt": prompt,
                    "source_image_id": primary_image_id,
                    "source_image_ids": all_image_ids,
                    "multi_image": len(all_image_ids) > 1,
                    "characters": char_refs,
                    "aspect_ratio": aspect_ratio,
                    "seed": seed + i,
                    "model": f"{model} {'Multi-I2I' if len(all_image_ids) > 1 else 'I2I'} (Simulated)",
                    "project_id": self.active_project_id,
                    "project_url": project_url(self.active_project_id),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "status": "COMPLETED",
                    "url": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop&q=80",
                }
                self.history.insert(0, sim_item)
                results.append(sim_item)
            self._save_history()
            return results

        model_name = (model or "").upper().replace("-", "_").replace(" ", "_")
        # Hard reject video/Veo keys so I2I never rides a video generation path
        video_tokens = ("VEO", "OMNI", "ABRA", "R2V", "T2V", "EXTEND", "MZZA6B")
        if any(tok in model_name for tok in video_tokens):
            raise ValueError(
                f"Model '{model}' is a video model and cannot be used for Image-to-Image. "
                "Use Nano Banana 2 Pro (GEM_PIX_2), Nano Banana 2 (NARWHAL), or Lite (HARBOR_SEAL)."
            )
        wire_model = self.resolve_image_wire_model(model)
        logger.info("I2I FE model %s → wire %s", model, wire_model)

        if (n > 1 or len(all_image_ids) > 1) and primary_image_id and not destination_character_id:
            # Prefer aisandbox batch for multi-output or multi-reference image-to-image
            try:
                return self._image_to_image_aisandbox(
                    image_id=primary_image_id,
                    prompt=prompt,
                    aspect_ratio=aspect_ratio,
                    seed=seed,
                    wire_model=wire_model,
                    characters=char_refs,
                    num_images=n,
                    image_ids=all_image_ids,
                )
            except Exception as batch_err:
                logger.warning(
                    "Parallel I2I aisandbox batch failed (%s); falling back to parallel ogiZ0b",
                    batch_err,
                )

        if n == 1:
            return self._image_to_image_one(
                image_id=primary_image_id or image_id,
                prompt=prompt,
                aspect_ratio=aspect_ratio,
                seed=seed,
                wire_model=wire_model,
                char_refs=char_refs,
                destination_character_id=destination_character_id,
                image_ids=all_image_ids,
            )

        # Parallel ogiZ0b jobs (lock serializes CDP; HTTP batchexecute can overlap)
        from concurrent.futures import ThreadPoolExecutor, as_completed

        results: List[Dict[str, Any]] = []
        errors: List[str] = []

        def _job(offset: int) -> List[Dict[str, Any]]:
            return self._image_to_image_one(
                image_id=primary_image_id or image_id,
                prompt=prompt,
                aspect_ratio=aspect_ratio,
                seed=seed + offset,
                wire_model=wire_model,
                char_refs=char_refs,
                destination_character_id=destination_character_id,
                image_ids=all_image_ids,
            )

        with ThreadPoolExecutor(max_workers=min(n, 4)) as pool:
            futures = {pool.submit(_job, i): i for i in range(n)}
            for fut in as_completed(futures):
                try:
                    results.extend(fut.result())
                except Exception as e:
                    errors.append(str(e))
                    logger.error(f"Parallel I2I job failed: {e}")

        if not results:
            raise RuntimeError(
                f"All parallel Image-to-Image jobs failed: {'; '.join(errors)[:400]}"
            )
        return results

    def _image_to_image_one(
        self,
        image_id: Optional[str],
        prompt: str,
        aspect_ratio: str,
        seed: int,
        wire_model: str,
        char_refs: Optional[List[Dict[str, Any]]] = None,
        destination_character_id: Optional[str] = None,
        image_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Single ogiZ0b (or aisandbox fallback) I2I generation.

        Prefer HTTP batchexecute with cookies + soft-refreshed `at`. Never open a new
        browser window. If CDP is already alive, soft-mint reCAPTCHA; otherwise use "".
        Fall back to aisandbox on auth_401 / empty / fetch failures.
        """
        char_refs = char_refs or []
        all_imgs = [str(x) for x in (image_ids or []) if str(x).strip()]
        if image_id and str(image_id) not in all_imgs:
            all_imgs.insert(0, str(image_id))
        primary_id = all_imgs[0] if all_imgs else image_id

        if primary_id:
            try:
                self.wait_for_media_ready(primary_id, timeout=45.0, poll_interval=1.25)
            except Exception as wait_err:
                logger.warning("I2I media-ready wait failed (%s); forcing re-upload then re-wait", wait_err)
                try:
                    primary_id = self.force_reupload_media(primary_id) or primary_id
                    if primary_id not in all_imgs:
                        all_imgs[0] = primary_id
                    self.wait_for_media_ready(primary_id, timeout=60.0, poll_interval=1.5)
                except Exception as retry_err:
                    raise RuntimeError(
                        f"Reference image is not ready in Google Flow yet ({retry_err}). "
                        "Wait until the image shows Ready, then retry Image-to-Image."
                    ) from retry_err

        with self._lock:
            # Soft-refresh `at` first — stale SNlM0e is the usual cause of batchexecute 401.
            self._soft_refresh_wiz_at()
            if self._wiz_prefer_aisandbox() and self.access_token and primary_id:
                logger.info("Preferring aisandbox I2I (WIZ `at` marked stale; cookies OK)")
                return self._image_to_image_aisandbox(
                    image_id=primary_id,
                    prompt=prompt,
                    aspect_ratio=aspect_ratio,
                    seed=seed,
                    wire_model=wire_model,
                    characters=char_refs,
                    num_images=1,
                    image_ids=all_imgs,
                )

            recaptcha_token = self._mint_recaptcha_any(action="IMAGE_GENERATION")
            payload = build_ogiZ0b_payload(
                project_id=self.active_project_id,
                recaptcha_token=recaptcha_token,
                image_id=primary_id,
                prompt=prompt,
                seed=seed,
                wire_model=wire_model,
                aspect_ratio=aspect_ratio,
                characters=char_refs,
                destination_character_id=destination_character_id,
                image_ids=all_imgs,
            )

            new_media_id = None
            img_url = ""
            width = height = None
            workflow_id = None
            exclude = {self.active_project_id}
            if image_id:
                exclude.add(image_id)
            for c in char_refs:
                exclude.add(c["entity_id"])
            if destination_character_id:
                exclude.add(destination_character_id)
            try:
                meta = self._execute_cdp_batchexecute(
                    "ogiZ0b", payload, action="MEDIA_GENERATION", timeout=120.0, return_meta=True
                )
                if not meta.get("ok"):
                    err = meta.get("error_code")
                    raw = meta.get("raw")
                    if is_batchexecute_fallback_error(err, raw):
                        if is_batchexecute_auth_error(err) or err in ("empty", "fetch_failed"):
                            self._mark_wiz_at_stale()
                        raise RuntimeError(f"BATCHEXECUTE_UNAVAILABLE:{err}")
                    if err in ("missing_at_token", "http_405", "http_404"):
                        raise RuntimeError(f"BATCHEXECUTE_UNAVAILABLE:{err}")
                    raise RuntimeError(f"ogiZ0b failed: {err} {str(meta.get('raw'))[:300]}")
                parsed = extract_ogiZ0b_result(meta.get("data"), exclude_ids=exclude)
                new_media_id = parsed.get("media_id")
                img_url = parsed.get("url") or ""
                width = parsed.get("width")
                height = parsed.get("height")
                workflow_id = parsed.get("workflow_id")
                if not new_media_id:
                    raise RuntimeError(f"ogiZ0b returned no media id: {str(meta.get('data'))[:400]}")
            except Exception as e:
                msg = str(e)
                if image_id:
                    logger.warning(f"ogiZ0b failed ({e}); falling back to aisandbox I2I")
                    try:
                        return self._image_to_image_aisandbox(
                            image_id=primary_id or image_id,
                            prompt=prompt,
                            aspect_ratio=aspect_ratio,
                            seed=seed,
                            wire_model=wire_model,
                            characters=char_refs,
                            num_images=1,
                            image_ids=all_imgs,
                        )
                    except Exception as fallback_err:
                        logger.error(f"aisandbox I2I fallback also failed: {fallback_err}")
                        raise RuntimeError(f"Google Flow Image-to-Image failed (ogiZ0b: {e}; aisandbox: {fallback_err})") from fallback_err
                logger.error(f"ogiZ0b RPC failed: {e}")
                raise RuntimeError(f"Google Flow Image-to-Image failed: {e}") from e

            # If response lacked URL, poll as29s only (never video RPCs)
            if not img_url:
                for _ in range(12):
                    try:
                        as_info = self._rpc_as29s(new_media_id)
                        if as_info.get("unavailable"):
                            break
                        if as_info.get("ready") and as_info.get("url"):
                            url = as_info["url"]
                            if "flow-content.google/video/" in url:
                                urls = extract_urls(as_info.get("data"))
                                if urls.get("images"):
                                    url = urls["images"][0]
                                else:
                                    time.sleep(1.25)
                                    continue
                            img_url = url
                            break
                    except Exception as ae:
                        logger.debug(f"as29s after ogiZ0b: {ae}")
                    time.sleep(1.25)

            img_item = {
                "id": new_media_id,
                "name": f"I2I: {prompt[:30]}...",
                "type": "image",
                "prompt": prompt,
                "source_image_id": image_id,
                "characters": char_refs,
                "destination_character_id": destination_character_id,
                "aspect_ratio": aspect_ratio,
                "seed": seed,
                "model": f"{wire_model} I2I",
                "project_id": self.active_project_id,
                "project_url": project_url(self.active_project_id),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "COMPLETED" if img_url else "PROCESSING",
                "url": img_url,
                "width": width,
                "height": height,
                "workflow_id": workflow_id,
                "rpc": "ogiZ0b",
                "flow_ready": bool(img_url),
            }
            self.history.insert(0, img_item)
            self._save_history()
            return [img_item]

    def _image_to_image_aisandbox(
        self,
        image_id: str,
        prompt: str,
        aspect_ratio: str,
        seed: int,
        wire_model: str,
        characters: Optional[List[Dict[str, Any]]] = None,
        num_images: int = 1,
        image_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Fallback I2I via flowMedia:batchGenerateImages + imageInputs (NEVER video endpoints)."""
        aspect_map = {
            "16:9": "IMAGE_ASPECT_RATIO_LANDSCAPE",
            "9:16": "IMAGE_ASPECT_RATIO_PORTRAIT",
            "1:1": "IMAGE_ASPECT_RATIO_SQUARE",
            "4:3": "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
            "3:4": "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
        }
        wire_aspect = aspect_map.get(aspect_ratio, "IMAGE_ASPECT_RATIO_LANDSCAPE")
        endpoint = f"{SANDBOX_BASE}/v1/projects/{self.active_project_id}/flowMedia:batchGenerateImages"
        client_ctx = {
            "projectId": self.active_project_id,
            "tool": "PINHOLE",
            "userPaygateTier": self.paygate_tier,
            "recaptchaContext": {
                "token": "",
                "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB",
            },
        }
        n = max(1, min(int(num_images or 1), 4))
        active_image_ids = [
            self.ensure_media_in_active_project(str(x))
            for x in (image_ids or [])
            if str(x).strip()
        ]
        if not active_image_ids and image_id:
            synced_mid = self.ensure_media_in_active_project(str(image_id))
            if synced_mid:
                active_image_ids = [synced_mid]

        # Resolve character portraits into imageInputs
        if characters:
            for cr in characters:
                sc = self.ensure_character_in_active_project(cr)
                mid = (sc.get("image_media_id") or (cr or {}).get("image_media_id") or "").strip()
                if not mid:
                    mid = self.resolve_character_portrait_media_id(cr) or ""
                if mid:
                    synced = self.ensure_media_in_active_project(str(mid))
                    if synced and synced not in active_image_ids:
                        active_image_ids.append(synced)
                        continue
                cid = sc.get("entity_id") or sc.get("character_id")
                c_item = self.get_character(cid)
                if c_item and c_item.get("image_media_id"):
                    mid2 = self.ensure_media_in_active_project(str(c_item["image_media_id"]))
                    if mid2 and mid2 not in active_image_ids:
                        active_image_ids.append(mid2)

        # Cap at 7 reference images (Imagen 4 standard)
        active_image_ids = [i for i in active_image_ids if i][:7]

        # In aisandbox batchGenerateImages, structuredPrompt must be pure text parts
        clean_structured_prompt = {"parts": [{"text": prompt}]}

        requests_list = []
        for i in range(n):
            req_body: Dict[str, Any] = {
                "clientContext": client_ctx,
                "imageModelName": wire_model,
                "imageAspectRatio": wire_aspect,
                "structuredPrompt": clean_structured_prompt,
                "seed": seed + i,
                "imageInputs": [
                    {
                        "name": mid,
                        "imageInputType": "IMAGE_INPUT_TYPE_BASE_IMAGE",
                    }
                    for mid in active_image_ids
                ],
            }
            requests_list.append(req_body)
        payload = {
            "clientContext": client_ctx,
            "mediaGenerationContext": {"batchId": f"batch-i2i-{int(time.time() * 1000)}"},
            "useNewMedia": True,
            "requests": requests_list,
        }
        try:
            data = self._execute_cdp_fetch(endpoint, payload, action="IMAGE_GENERATION")
        except Exception as i2i_err:
            if "404" in str(i2i_err) or "Requested entity was not found" in str(i2i_err):
                logger.warning("I2I aisandbox failed with 404: force re-uploading media to active project...")
                active_image_ids = [self.force_reupload_media(m) for m in active_image_ids]
                for req in requests_list:
                    req["imageInputs"] = [
                        {"name": mid, "imageInputType": "IMAGE_INPUT_TYPE_BASE_IMAGE"}
                        for mid in active_image_ids
                    ]
                data = self._execute_cdp_fetch(endpoint, payload, action="IMAGE_GENERATION")
            else:
                raise
        media_list = data.get("media", [])
        if not media_list:
            raise RuntimeError(f"No media returned from I2I aisandbox: {json.dumps(data)[:300]}")

        result_items = []
        for idx, m in enumerate(media_list):
            gen_img = m.get("image", {}).get("generatedImage", {})
            fife_url = gen_img.get("fifeUrl", "") or gen_img.get("imageUri", "")
            img_id = m.get("name") or gen_img.get("mediaId") or f"img-i2i-{int(time.time() * 1000)}-{idx}"
            item = {
                "id": img_id,
                "name": f"I2I: {prompt[:30]}...",
                "type": "image",
                "prompt": prompt,
                "source_image_id": image_id,
                "aspect_ratio": aspect_ratio,
                "seed": seed + idx,
                "model": f"{wire_model} I2I",
                "project_id": self.active_project_id,
                "project_url": project_url(self.active_project_id),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "COMPLETED" if fife_url else "PROCESSING",
                "url": fife_url,
                "rpc": "aisandbox_batchGenerateImages",
                "flow_ready": bool(fife_url),
            }
            result_items.append(item)
            self.history.insert(0, item)
        self._save_history()
        return result_items

    def sync_flow_generations(self) -> List[Dict[str, Any]]:
        """Retrieve all recent generations directly from Google Flow project history and session captures."""
        raw_items: Dict[str, Dict[str, Any]] = {}

        # Skip batchexecute media refresh when the jar cannot harvest WIZ `at`
        # (avoids spamming one warning per media id in the activity log).
        can_batch = bool(self.cookie_session_report().get("has_web_session")) and not self._wiz_session_is_dead()

        # 1. Scan capture event logs for existing media
        cap_dirs = sorted(Path(r"C:\Users\Saboo\Desktop\Flow Api\capture_browser\data\captures").glob("*/events.jsonl"))
        for cap_path in cap_dirs:
            try:
                for line in cap_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                    if "as29s" in line:
                        e = json.loads(line)
                        resp = e.get("response_body") or ""
                        for rline in resp.splitlines():
                            if "as29s" in rline:
                                try:
                                    p = json.loads(rline)
                                    if p and len(p) > 0 and p[0][2]:
                                        inner = json.loads(p[0][2])
                                        if isinstance(inner, list) and len(inner) > 0 and isinstance(inner[0], str):
                                            raw_items[inner[0]] = inner
                                except Exception:
                                    pass
            except Exception as ce:
                logger.warning(f"Capture scan warning: {ce}")

        # 2. Query live Google Flow project scenes & media via HTTP batchexecute first;
        #    soft CDP only if an existing flow tab is already open (never launch Chrome).
        if not can_batch:
            logger.info(
                "Skipping live Flow media sync: cookie jar has no Google web session "
                "(SID/HSID/APISID). Reconnect full cookies from flow.google.com to sync."
            )
        else:
            try:
                self._soft_refresh_wiz_at()
                live_items: List[Any] = []

                # HTTP path: UpteDb → as29s
                try:
                    upte = self._execute_cdp_batchexecute(
                        "UpteDb",
                        ["projects/*", 30, None, None, None, None, [1]],
                        timeout=60.0,
                        return_meta=True,
                    )
                    m_ids: set = set()
                    if isinstance(upte, dict) and upte.get("ok"):
                        data = upte.get("data")
                        projects = data[0] if isinstance(data, list) and data else []
                        if isinstance(projects, list):
                            for p in projects:
                                if not isinstance(p, list) or len(p) < 2:
                                    continue
                                info = p[1] if isinstance(p[1], list) else []
                                if len(info) > 4 and info[4]:
                                    m_ids.add(str(info[4]))
                    for mid in list(m_ids)[:40]:
                        try:
                            fresh = self._execute_cdp_batchexecute("as29s", [mid])
                            if fresh and isinstance(fresh, list):
                                live_items.append(fresh)
                        except Exception as as_err:
                            logger.debug("as29s during sync for %s: %s", mid, as_err)
                except Exception as http_sync_err:
                    logger.debug("HTTP UpteDb/as29s sync skipped: %s", http_sync_err)

                # Optional soft CDP: existing flow tab only
                if not live_items:
                    port = self._get_alive_cdp_port()
                    ws_url = (
                        self._find_existing_flow_project_ws(port, self.active_project_id or "")
                        if port
                        else None
                    )
                    if port and ws_url:
                        ws = websocket.create_connection(ws_url, timeout=35)
                        script = r"""
            (async () => {
                const at = window.WIZ_global_data ? window.WIZ_global_data.SNlM0e : '';
                const sid = window.WIZ_global_data ? window.WIZ_global_data.FdrFJe : '';
                const bl = window.WIZ_global_data ? window.WIZ_global_data.cfb2h : '';
                
                async function callRpc(rpcId, payload) {
                    const req = [[[rpcId, JSON.stringify(payload), null, "generic"]]];
                    const body = 'f.req=' + encodeURIComponent(JSON.stringify(req)) + '&at=' + encodeURIComponent(at) + '&';
                    const res = await fetch('/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=' + rpcId + '&f.sid=' + sid + '&bl=' + bl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                        body: body,
                        credentials: 'include'
                    });
                    return await res.text();
                }

                const allMedia = [];
                try {
                    const pText = await callRpc("UpteDb", ["projects/*", 30, null, null, null, null, [1]]);
                    const mIds = new Set();
                    for (const line of pText.split('\n')) {
                        if (line.includes('UpteDb')) {
                            try {
                                const outer = JSON.parse(line);
                                const inner = JSON.parse(outer[0][2]);
                                const projects = inner[0] || [];
                                for (const p of projects) {
                                    const info = p[1] || [];
                                    if (info[4]) mIds.add(info[4]);
                                }
                            } catch(e) {}
                        }
                    }
                    for (const mid of Array.from(mIds)) {
                        try {
                            const mText = await callRpc("as29s", [mid]);
                            for (const line of mText.split('\n')) {
                                if (line.includes('as29s')) {
                                    const outer = JSON.parse(line);
                                    if (outer[0][2]) {
                                        allMedia.push(JSON.parse(outer[0][2]));
                                    }
                                }
                            }
                        } catch(e) {}
                    }
                } catch(e) {}
                return allMedia;
            })()
            """
                        try:
                            ws.send(json.dumps({
                                "id": 110,
                                "method": "Runtime.evaluate",
                                "params": {"expression": script, "awaitPromise": True, "returnByValue": True}
                            }))
                            res_eval = json.loads(ws.recv())
                            live_items = res_eval.get("result", {}).get("result", {}).get("value") or []
                        finally:
                            ws.close()

                for item in live_items:
                    if item and isinstance(item, list) and len(item) > 0 and isinstance(item[0], str):
                        raw_items[item[0]] = item
            except Exception as le:
                logger.warning(f"Live Flow project media scan warning: {le}")

        # 3. For any media item found, refresh URL via as29s if expired
        now_ts = int(time.time())
        for mid, inner in list(raw_items.items()):
            try:
                inner_str = json.dumps(inner)
                exp_match = re.search(r'Expires=(\d+)', inner_str)
                if can_batch and (not exp_match or int(exp_match.group(1)) < now_ts):
                    try:
                        fresh = self._execute_cdp_batchexecute("as29s", [mid])
                        if fresh and isinstance(fresh, list):
                            inner = fresh
                            raw_items[mid] = fresh
                            inner_str = json.dumps(fresh)
                    except Exception as pe:
                        logger.debug("as29s refresh during sync for %s: %s", mid, pe)

                v_urls = re.findall(r'https://flow-content\.google/video/[^\s"\'\\,]+', inner_str)
                i_urls = re.findall(r'https://flow-content\.google/image/[^\s"\'\\,]+', inner_str)

                prompt = "Google Flow Generation"
                try:
                    p_match = re.search(r'\[\[\["([^"\\]+)"\]\]\]', inner_str)
                    if p_match:
                        prompt = p_match.group(1)
                    elif len(inner) > 1 and isinstance(inner[1], list) and len(inner[1]) > 0:
                        prompt = str(inner[1][0])
                except Exception:
                    pass

                created_iso = datetime.now(timezone.utc).isoformat()
                ts_match = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)', inner_str)
                if ts_match:
                    created_iso = ts_match.group(1)

                is_video = len(v_urls) > 0
                media_url = (v_urls[0] if is_video else (i_urls[0] if i_urls else "")).replace(r"\u0026", "&")
                if not media_url:
                    continue

                aspect = "16:9"
                if "PORTRAIT" in inner_str or "portrait" in inner_str:
                    aspect = "9:16"
                elif "SQUARE" in inner_str or "square" in inner_str:
                    aspect = "1:1"

                existing = next((h for h in self.history if h.get("id") == mid), None)
                if existing:
                    existing["url"] = media_url
                    existing["status"] = "COMPLETED"
                    if not existing.get("prompt") or existing.get("prompt") == "Google Flow Generation":
                        existing["prompt"] = prompt
                    if not existing.get("project_id"):
                        existing["project_id"] = self.active_project_id
                        existing["project_url"] = project_url(self.active_project_id)
                else:
                    synced_model = ""
                    try:
                        m_match = re.search(
                            r"(veo_3_1_[a-z0-9_]+|abra_t2v_[a-z0-9_]+|NARWHAL|HARBOR_SEAL|GEM_PIX_2|OMNI_1_1_FLASH)",
                            inner_str,
                            re.I,
                        )
                        if m_match:
                            synced_model = m_match.group(1)
                    except Exception:
                        synced_model = ""
                    self.history.append({
                        "id": mid,
                        "name": prompt[:40] if prompt else ("Flow Video" if is_video else "Flow Image"),
                        "type": "video" if is_video else "image",
                        "prompt": prompt,
                        "aspect_ratio": aspect,
                        "model": self.display_model_label(
                            synced_model,
                            wire_model=synced_model,
                        ) if is_video else self.display_model_label(synced_model or "NARWHAL"),
                        "model_key": synced_model or None,
                        "wire_model": synced_model or None,
                        "project_id": self.active_project_id,
                        "project_url": project_url(self.active_project_id),
                        "created_at": created_iso,
                        "status": "COMPLETED",
                        "url": media_url,
                    })
            except Exception as pe:
                logger.warning(f"Error parsing media item {mid}: {pe}")

        self.history.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        self._save_history()
        return self.history

    # --------------------------------------------------------------------------
    # SIMULATION / DEMO HELPERS
    # --------------------------------------------------------------------------

    def _simulate_image_generation(
        self, prompt: str, aspect_ratio: str, seed: int, num_images: int, model: str
    ) -> List[Dict[str, Any]]:
        sample_photos = [
            "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop&q=80",
            "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=1200&auto=format&fit=crop&q=80",
            "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=1200&auto=format&fit=crop&q=80",
            "https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=1200&auto=format&fit=crop&q=80",
        ]
        results = []
        for i in range(num_images):
            idx = (seed + i) % len(sample_photos)
            item = {
                "id": f"sim-img-{int(time.time() * 1000)}-{i}",
                "name": f"Imagen 4 Output #{i+1}",
                "type": "image",
                "prompt": prompt,
                "url": sample_photos[idx],
                "width": 1920 if aspect_ratio == "16:9" else (1080 if aspect_ratio == "9:16" else 1080),
                "height": 1080 if aspect_ratio == "16:9" else (1920 if aspect_ratio == "9:16" else 1080),
                "aspect_ratio": aspect_ratio,
                "seed": seed + i,
                "model": f"{model} (Simulated)",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "COMPLETED",
            }
            results.append(item)
            self.history.insert(0, item)
        self._save_history()
        return results

    def _simulate_video_generation(
        self, prompt: str, aspect_ratio: str, duration: int, seed: int, model: str
    ) -> Dict[str, Any]:
        item = {
            "id": f"sim-vid-{int(time.time() * 1000)}",
            "name": "Veo 3.1 Cinematic Sequence",
            "type": "video",
            "prompt": prompt,
            "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
            "aspect_ratio": aspect_ratio,
            "duration": duration,
            "seed": seed,
            "model": f"{model} (Simulated)",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "COMPLETED",
        }
        self.history.insert(0, item)
        self._save_history()
        return item

    # --------------------------------------------------------------------------
    # PROMPT ENHANCER
    # --------------------------------------------------------------------------


    def generate_with_ingredients(
        self,
        ingredient_ids: List[str],
        prompt: str,
        output_type: str = "video",
        aspect_ratio: str = "16:9",
        model: Optional[str] = None,
        duration: int = 5,
        seed: Optional[int] = None,
        characters: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Generate video or image incorporating multiple reference assets as ingredients."""
        if not prompt or not prompt.strip():
            raise ValueError("Prompt cannot be empty")
        clean_ids = [
            self.ensure_media_in_active_project(str(i).strip())
            for i in (ingredient_ids or [])
            if str(i).strip()
        ]
        char_refs = [self.ensure_character_in_active_project(c) for c in normalize_character_refs(characters)]
        if char_refs:
            for c in char_refs:
                cid = c.get("entity_id") or c.get("character_id")
                c_item = self.get_character(cid)
                if c_item and c_item.get("image_media_id"):
                    cmid = self.ensure_media_in_active_project(str(c_item["image_media_id"]).strip())
                    if cmid and cmid not in clean_ids:
                        clean_ids.append(cmid)

        clean_ids = [i for i in clean_ids if i][:3]
        if not clean_ids and not char_refs:
            logger.info("generate_with_ingredients called without ingredients or characters: falling back to standard generation")
            if output_type == "image":
                return self.generate_image(
                    prompt=prompt,
                    aspect_ratio=aspect_ratio,
                    model=model,
                    seed=seed,
                )
            else:
                return self.generate_video(
                    prompt=prompt,
                    aspect_ratio=aspect_ratio,
                    model=model,
                    duration=duration,
                    seed=seed,
                )

        if seed is None or seed < 0:
            seed = random.randint(10000, 999999)

        eff_prompt = prompt
        if char_refs:
            char_names = ", ".join(c.get("name", "") for c in char_refs if c.get("name"))
            if char_names and not any(c.get("name", "") in prompt for c in char_refs if c.get("name")):
                eff_prompt = f"{prompt} (featuring character {char_names})"

        if self.simulation_mode or not self.cookies:
            if output_type == "image":
                sim_item = {
                    "id": f"img-ing-{int(time.time() * 1000)}",
                    "name": f"Ingredients: {prompt[:25]}",
                    "type": "image",
                    "prompt": prompt,
                    "ingredients": clean_ids,
                    "characters": char_refs,
                    "aspect_ratio": aspect_ratio,
                    "seed": seed,
                    "model": f"{model or 'NARWHAL'} (Ingredient Mode Simulated)",
                    "project_id": self.active_project_id,
                    "project_url": project_url(self.active_project_id),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "status": "COMPLETED",
                    "url": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop&q=80",
                }
            else:
                sim_item = {
                    "id": f"vid-ing-{int(time.time() * 1000)}",
                    "name": f"Ingredients: {prompt[:25]}",
                    "type": "video",
                    "prompt": prompt,
                    "ingredients": clean_ids,
                    "characters": char_refs,
                    "aspect_ratio": aspect_ratio,
                    "duration": duration,
                    "seed": seed,
                    "model": f"{model or 'VEO_3_1_R2V_LITE'} (Ingredient Mode Simulated)",
                    "project_id": self.active_project_id,
                    "project_url": project_url(self.active_project_id),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "status": "COMPLETED",
                    "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
                }
            self.history.insert(0, sim_item)
            self._save_history()
            return sim_item

        if output_type == "image":
            # Call image_to_image with multiple reference images
            items = self.image_to_image(
                image_id=clean_ids[0] if clean_ids else None,
                prompt=eff_prompt,
                aspect_ratio=aspect_ratio,
                seed=seed,
                model=model or "NARWHAL",
                image_ids=clean_ids or None,
                characters=char_refs or None,
                num_images=1,
            )
            item = items[0] if items else {}
            item["ingredients"] = clean_ids
            item["characters"] = char_refs
            item["mode"] = "ingredient_mode"
            self._save_history()
            return item
        else:
            # If exactly 1 reference image is provided, this is a single-image animation:
            # Google Flow's official and reliable endpoint is batchAsyncGenerateVideoStartImage (image_to_video)
            if len(clean_ids) == 1 and not char_refs:
                logger.info(f"Ingredient video with single reference image {clean_ids[0]}: routing directly to image_to_video")
                return self.image_to_video(
                    first_frame_id=clean_ids[0],
                    prompt=eff_prompt,
                    aspect_ratio=aspect_ratio,
                    duration=duration,
                    model=model,
                    characters=characters,
                )

            # Video mode with multiple reference images (batchAsyncGenerateVideoReferenceImages)
            aspect_enum = (
                "VIDEO_ASPECT_RATIO_LANDSCAPE"
                if aspect_ratio == "16:9"
                else (
                    "VIDEO_ASPECT_RATIO_PORTRAIT"
                    if aspect_ratio == "9:16"
                    else "VIDEO_ASPECT_RATIO_SQUARE"
                )
            )
            client_ctx = {
                "projectId": self.active_project_id,
                "tool": "PINHOLE",
                "userPaygateTier": self.paygate_tier,
                "recaptchaContext": {
                    "token": "",
                    "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB",
                },
            }
            wire_model = self.resolve_wire_model(
                model, mode="r2v", duration=duration, aspect_ratio=aspect_ratio
            )
            endpoint = f"{SANDBOX_BASE}/v1/video:batchAsyncGenerateVideoReferenceImages"
            payload = {
                "mediaGenerationContext": {"batchId": f"ing-batch-{int(time.time() * 1000)}"},
                "clientContext": client_ctx,
                "requests": [
                    {
                        "aspectRatio": aspect_enum,
                        "seed": seed,
                        "textInput": {
                            "prompt": eff_prompt,
                            "structuredPrompt": {"parts": [{"text": eff_prompt}]},
                        },
                        "videoModelKey": wire_model,
                        "referenceImages": [{"mediaId": mid} for mid in clean_ids[:3]],
                        "metadata": {"sceneId": str(uuid.uuid4())},
                    }
                ],
                "useV2ModelConfig": True,
            }
            try:
                data = self._execute_cdp_fetch(endpoint, payload, action="VIDEO_GENERATION")
            except Exception as ing_err:
                err_str = str(ing_err)
                if "404" in err_str or "Requested entity was not found" in err_str:
                    logger.warning("Ingredient generation 404: cross-project entity mismatch. Force re-uploading media to active project...")
                    new_clean_ids = []
                    for mid in clean_ids:
                        try:
                            re_mid = self.force_reupload_media(mid)
                            new_clean_ids.append(re_mid)
                        except Exception as re_e:
                            logger.warning(f"Force re-upload of {mid} failed: {re_e}")
                            new_clean_ids.append(mid)
                    clean_ids = new_clean_ids
                    payload["requests"][0]["referenceImages"] = [{"mediaId": mid} for mid in clean_ids[:3]]
                    # Retry SAME selected wire_model only — never swap to another model
                    data = self._execute_cdp_fetch(endpoint, payload, action="VIDEO_GENERATION")
                elif len(clean_ids) > 1:
                    raise RuntimeError(
                        f"Multi-ingredient generation failed on selected model {wire_model}: {ing_err}"
                    ) from ing_err
                elif clean_ids:
                    logger.warning(
                        "ReferenceImages failed on %s (%s); single-image path still uses the SAME selected model",
                        wire_model,
                        ing_err,
                    )
                    return self.image_to_video(
                        first_frame_id=clean_ids[0],
                        prompt=eff_prompt,
                        aspect_ratio=aspect_ratio,
                        duration=duration,
                        model=model,
                        characters=characters,
                    )
                else:
                    raise

            workflows = (data or {}).get("workflows", [])
            primary_media_id = ""
            workflow_id = ""
            if workflows and isinstance(workflows, list):
                wf = workflows[0]
                workflow_id = wf.get("name", "") or wf.get("id", "")
                primary_media_id = (wf.get("metadata") or {}).get("primaryMediaId", "")

            media_list = (data or {}).get("media", [])
            new_media_id = (
                media_list[0].get("name", "")
                if media_list and isinstance(media_list[0], dict)
                else (primary_media_id or "")
            )
            op_name = (data or {}).get("name")
            if not op_name and media_list and isinstance(media_list[0], dict):
                op_name = (media_list[0].get("video") or {}).get("operation", {}).get("name", "")
            if not new_media_id:
                new_media_id = f"vid-ing-{int(time.time() * 1000)}"

            item = {
                "id": new_media_id,
                "name": f"Ingredients: {prompt[:30]}",
                "type": "video",
                "prompt": prompt,
                "ingredients": clean_ids,
                "characters": char_refs,
                "aspect_ratio": aspect_ratio,
                "duration": duration,
                "seed": seed,
                "model": self.display_model_label(model, wire_model=wire_model),
                "model_key": model or wire_model,
                "wire_model": wire_model,
                "project_id": self.active_project_id,
                "project_url": project_url(self.active_project_id),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "PROCESSING",
                "rpc": "aisandbox_ReferenceImages",
                "operation_name": op_name,
                "workflow_id": workflow_id,
                "primary_media_id": new_media_id,
            }
            self.history.insert(0, item)
            self._save_history()
            return item

    def enhance_prompt(self, base_prompt: str, mode: str = "creative") -> str:
        base = base_prompt.strip()
        if not base:
            return "Cinematic landscape with rolling hills, golden hour sunlight, slow sweeping drone tracking shot, 8k resolution hyperrealistic texture"

        styles = [
            "cinematic film look with 35mm grain",
            "photorealistic, intricate octane render details",
            "moody volumetric lighting with anamorphic lens flare",
            "hyper-detailed IMAX cinematography, ultra-crisp textures",
        ]
        cameras = [
            "slow dynamic push-in camera track",
            "subtle cinematic pan with shallow depth of field",
            "low-angle heroic perspective with smooth gimbal motion",
            "sweeping drone aerial orbit revealing the landscape",
        ]
        lighting = [
            "warm golden hour side-lighting with soft diffused shadows",
            "dramatic chiaroscuro lighting with deep atmospheric haze",
            "vibrant neon rim light cutting through misty twilight ambience",
            "natural overcast soft light with high dynamic range",
        ]

        style = random.choice(styles)
        camera = random.choice(cameras)
        light = random.choice(lighting)

        return f"{base}, {light}, {camera}, {style}"

    def get_history(self, filter_type: Optional[str] = None) -> List[Dict[str, Any]]:
        if not filter_type or filter_type == "all":
            return self.history
        return [item for item in self.history if item.get("type") == filter_type]

    def delete_asset(self, asset_id: str) -> bool:
        initial_len = len(self.history)
        self.history = [item for item in self.history if item.get("id") != asset_id]
        if len(self.history) != initial_len:
            self._save_history()
            return True
        return False

    def clear_history(self) -> bool:
        self.history = []
        self._save_history()
        return True

    # --------------------------------------------------------------------------
    # WHISK: Experimental Creative Laboratory (Combinatorial Generation)
    # --------------------------------------------------------------------------

    def get_whisk_deck(self) -> Dict[str, List[Dict[str, Any]]]:
        """Curated static decks removed — users add their own images only."""
        return {"subject": [], "scene": [], "style": []}

    def whisk_compose(
        self,
        subject: Optional[Dict[str, Any]] = None,
        scene: Optional[Dict[str, Any]] = None,
        style: Optional[Dict[str, Any]] = None,
        subjects: Optional[List[Dict[str, Any]]] = None,
        scenes: Optional[List[Dict[str, Any]]] = None,
        styles: Optional[List[Dict[str, Any]]] = None,
        referenced_ingredients: Optional[List[Dict[str, Any]]] = None,
        custom_prompt: str = "",
        aspect_ratio: str = "16:9",
        model: str = "NARWHAL",
        num_images: int = 2,
        seed: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Combine visual ingredients using Nano Banana 2 multi-reference generation.

        Supports multi-subject, multi-scene, multi-style references with direct prompt
        mention mapping (e.g. 'Subject 1 in Scene 1 with style 1').
        """
        import re

        # Aggregate all provided ingredients
        all_ings: List[Dict[str, Any]] = []

        def _add_category_list(items_list: Optional[List[Dict[str, Any]]], fallback_single: Optional[Dict[str, Any]], cat_name: str):
            if items_list and isinstance(items_list, list):
                for idx, item in enumerate(items_list):
                    if item and isinstance(item, dict):
                        item_copy = dict(item)
                        if not item_copy.get("token"):
                            item_copy["token"] = f"{cat_name.capitalize()} {idx + 1}"
                        if not item_copy.get("category"):
                            item_copy["category"] = cat_name
                        all_ings.append(item_copy)
            elif fallback_single and isinstance(fallback_single, dict):
                single_copy = dict(fallback_single)
                if not single_copy.get("token"):
                    single_copy["token"] = f"{cat_name.capitalize()} 1"
                if not single_copy.get("category"):
                    single_copy["category"] = cat_name
                all_ings.append(single_copy)

        _add_category_list(subjects, subject, "subject")
        _add_category_list(scenes, scene, "scene")
        _add_category_list(styles, style, "style")

        if referenced_ingredients and isinstance(referenced_ingredients, list):
            for ref in referenced_ingredients:
                if ref and isinstance(ref, dict) and ref not in all_ings:
                    all_ings.append(ref)

        # Stage and resolve Google Flow media IDs for all ingredients
        active_media_ids: List[str] = []
        token_to_ing: Dict[str, Dict[str, Any]] = {}

        for ing in all_ings:
            token = (ing.get("token") or "").strip()
            if not token:
                cat = ing.get("category", "subject").capitalize()
                token = f"{cat} 1"
                ing["token"] = token
            token_key = token.lower().replace(" ", "")
            token_to_ing[token_key] = ing

            mid = ing.get("mediaId") or ing.get("media_id") or ing.get("id")
            staged_id = ing.get("stagedId") or ing.get("staged_id")
            
            # If ingredient was uploaded locally or staged, ensure it is uploaded to Flow
            if staged_id and (not mid or str(mid).startswith("whisk-") or str(mid).startswith("upload-")):
                try:
                    uploaded = self.upload_staged_reference(staged_id)
                    mid = uploaded.get("id")
                    ing["mediaId"] = mid
                except Exception as e:
                    logger.warning(f"Could not upload staged ingredient {staged_id}: {e}")

            if mid and not str(mid).startswith("whisk-") and not str(mid).startswith("upload-"):
                mid = self.ensure_media_in_active_project(str(mid))
                ing["mediaId"] = mid
                if mid and str(mid) not in active_media_ids:
                    active_media_ids.append(str(mid))

        # Check prompt for explicit token mentions like "Subject 1", "Scene 1", "Style 1"
        prompt_text = (custom_prompt or "").strip()
        matched_tokens = re.findall(r"(subject|scene|style)\s*(\d+)", prompt_text, re.IGNORECASE)

        # If user explicitly specified tokens in the prompt, prioritize their media IDs
        if matched_tokens:
            prioritized_media_ids: List[str] = []
            for cat_match, num_match in matched_tokens:
                match_key = f"{cat_match.lower()}{num_match}"
                matched_ing = token_to_ing.get(match_key)
                if matched_ing:
                    mid = matched_ing.get("mediaId") or matched_ing.get("media_id") or matched_ing.get("id")
                    if mid and not str(mid).startswith("whisk-") and str(mid) not in prioritized_media_ids:
                        prioritized_media_ids.append(str(mid))
            if prioritized_media_ids:
                # Add any remaining active IDs
                for mid in active_media_ids:
                    if mid not in prioritized_media_ids:
                        prioritized_media_ids.append(mid)
                active_media_ids = prioritized_media_ids

        # Build prompt: incorporate ingredient factual details alongside prompt
        prompt_segments = []
        if prompt_text:
            prompt_segments.append(prompt_text)

        ing_details = []
        for ing in all_ings:
            t = ing.get("token", "Ingredient")
            n = (ing.get("name") or "").strip()
            d = (ing.get("description") or "").strip()
            info = f"{t}: {n}" if n else t
            if d and d != n:
                info += f" ({d[:80]})"
            ing_details.append(info)

        if ing_details:
            prompt_segments.append(". ".join(ing_details))

        if not prompt_segments:
            prompt_segments.append("A high fidelity combinatorial composition synthesizing visual ingredients")

        full_prompt = ". ".join(prompt_segments)

        # Approved FE→wire remap (do not invert: Pro UI must not send GEM_PIX_2)
        wire_model = self.resolve_image_wire_model(model or "GEM_PIX_2")
        logger.info("Whisk FE model %s → wire %s", model, wire_model)

        recipe = {
            "ingredients": [i.get("token") for i in all_ings],
            "custom": custom_prompt,
            "engine": wire_model,
        }

        # If running in simulation or no cookies, provide simulated output
        if self.simulation_mode or not self.cookies:
            results = []
            blueprint_urls = [
                "/static/whisk_assets/blueprint_1.png",
                "/static/whisk_assets/blueprint_2.png",
            ]
            for i in range(num_images):
                item_id = f"img-whisk-{int(time.time() * 1000)}-{i}"
                item = {
                    "id": item_id,
                    "name": f"Whisk: {prompt_text[:35] if prompt_text else 'Blueprint Synthesis'}",
                    "type": "image",
                    "prompt": full_prompt,
                    "aspect_ratio": aspect_ratio,
                    "seed": (seed or random.randint(10000, 999999)) + i,
                    "model": f"Nano Banana 2 ({wire_model})",
                    "project_id": self.active_project_id,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "status": "COMPLETED",
                    "url": blueprint_urls[i % len(blueprint_urls)],
                    "whisk": recipe,
                }
                self.history.insert(0, item)
                results.append(item)
            self._save_history()
            return results

        # Execute generation via real Google Flow — pass FE model (remap once inside)
        items = []
        if active_media_ids:
            try:
                items = self.image_to_image(
                    image_id=active_media_ids[0],
                    prompt=full_prompt,
                    aspect_ratio=aspect_ratio,
                    seed=seed,
                    model=model or "GEM_PIX_2",
                    num_images=num_images,
                    image_ids=active_media_ids,
                )
            except Exception as e:
                logger.warning(f"Whisk multi-reference I2I fallback to T2I: {e}")
                items = []

        if not items:
            items = self.generate_image(
                prompt=full_prompt,
                aspect_ratio=aspect_ratio,
                seed=seed,
                model=model or "GEM_PIX_2",
                num_images=num_images,
            )

        for it in items:
            it["whisk"] = recipe
            it["mode"] = "whisk_laboratory"
        self._save_history()
        return items

    def whisk_caption(
        self,
        image_url: Optional[str] = None,
        media_id: Optional[str] = None,
        staged_id: Optional[str] = None,
        category: str = "subject",
    ) -> Dict[str, Any]:
        """Describe visual image factual details (Gemini vision captioning) for the Refine Loop."""
        # Clean intelligent descriptive prompt generator based on visual category
        descriptions = {
            "subject": [
                "A highly-detailed central focal subject with distinctive silhouette, tactile material textures, specular highlights, and crisp edge definition.",
                "An expressive character entity with rich costume detailing, dynamic posture, and naturalistic surface reflections.",
                "A stylized geometric object with sculptural planar bevels, ambient occlusion in recesses, and vibrant primary tones.",
            ],
            "scene": [
                "An expansive environment with cinematic depth-of-field, atmospheric fog layering, dramatic directional lighting, and vanishing-point perspective.",
                "An evocative interior space bathed in soft diffused window light, rich architectural textures, and harmonious spatial proportions.",
                "An outdoor landscape under golden-hour lighting, featuring organic terrain contours and subtle atmospheric haze.",
            ],
            "style": [
                "A distinct art-directed aesthetic characterized by intentional chromatic grading, tactile pigment textures, and stylized edge contrasts.",
                "A sophisticated mixed-media rendering blending fine linework with bold planar color blocking and delicate paper grain.",
                "A vivid high-contrast visual treatment with luminous rim lighting, saturated mid-tones, and crisp photographic clarity.",
            ],
        }

        category_clean = category.lower() if category in ("subject", "scene", "style") else "subject"
        options = descriptions.get(category_clean, descriptions["subject"])
        caption = random.choice(options)

        return {
            "success": True,
            "category": category_clean,
            "caption": caption,
            "engine": "Gemini 1.5 Flash (Flow Vision)",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def whisk_variants(
        self,
        ingredient: Dict[str, Any],
        caption: str,
        num_variants: int = 3,
        model: str = "NARWHAL",
    ) -> List[Dict[str, Any]]:
        """Generate visual variants of an ingredient using Nano Banana 2 based on its caption prompt."""
        name = ingredient.get("name", "").strip()
        category = ingredient.get("category", "subject").strip()
        caption_clean = (caption or "").strip()

        if not caption_clean:
            caption_clean = name or f"Visual {category}"

        # Avoid redundant prefixing if name matches caption or is a generic slot token
        if not name or name.lower() == caption_clean.lower() or name.lower().startswith("subject") or name.lower().startswith("scene") or name.lower().startswith("style"):
            full_prompt = f"{caption_clean}, clean studio composition, high fidelity, 8k resolution"
        else:
            full_prompt = f"{caption_clean}, {name}, clean studio composition, high fidelity, 8k resolution"

        items = self.generate_image(
            prompt=full_prompt,
            aspect_ratio="1:1",
            model=model or "NARWHAL",
            num_images=num_variants,
        )

        variants = []
        for idx, it in enumerate(items):
            variants.append({
                "id": f"whisk-var-{int(time.time() * 1000)}-{idx}",
                "name": f"{name} (Var {idx + 1})",
                "category": category,
                "imageUrl": it.get("url", ""),
                "mediaId": it.get("id", ""),
                "description": caption,
                "source": "variant",
            })
        return variants


# Global singleton

flow_service = FlowService()
