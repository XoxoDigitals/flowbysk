"""Studio activity / error log ring buffer + dual-write to Prisma via Next."""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.error
import urllib.request
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.env_util import get_env

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOGS_FILE = DATA_DIR / "logs.json"
LOG_MAX = 400

_lock = threading.Lock()
_entries: List[Dict[str, Any]] = []
_loaded = False

_saas_user_id: ContextVar[Optional[str]] = ContextVar("saas_user_id", default=None)
_saas_user_email: ContextVar[Optional[str]] = ContextVar("saas_user_email", default=None)
_run_id: ContextVar[Optional[str]] = ContextVar("studio_run_id", default=None)

NEXT_INGEST_URL = os.environ.get(
    "STUDIO_LOG_INGEST_URL", "http://127.0.0.1:3000/api/internal/studio-logs"
)


def _load_dotenv_secret() -> Optional[str]:
    """Prefer INTERNAL_API_SECRET from env/.env, else JWT_SECRET. None if neither is set."""
    return get_env("INTERNAL_API_SECRET", "JWT_SECRET")


INTERNAL_SECRET = _load_dotenv_secret()
_missing_secret_warned = False


def _warn_missing_secret_once() -> None:
    global _missing_secret_warned
    if _missing_secret_warned:
        return
    _missing_secret_warned = True
    logging.getLogger("studio_logs").warning(
        "INTERNAL_API_SECRET / JWT_SECRET not configured — remote studio-log "
        "shipping to Next is disabled (in-memory logs still work)."
    )


def set_request_identity(
    user_id: Optional[str] = None,
    user_email: Optional[str] = None,
    run_id: Optional[str] = None,
) -> None:
    """Bind SaaS identity + run for the current request (from Next → worker headers)."""
    _saas_user_id.set((user_id or "").strip() or None)
    _saas_user_email.set((user_email or "").strip().lower() or None)
    _run_id.set((run_id or "").strip() or None)


def clear_request_identity() -> None:
    _saas_user_id.set(None)
    _saas_user_email.set(None)
    _run_id.set(None)


def _flow_email() -> Optional[str]:
    try:
        from backend.flow_service import flow_service

        info = getattr(flow_service, "user_info", None) or {}
        email = (info.get("email") or "").strip().lower()
        return email or None
    except Exception:
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_loaded() -> None:
    global _loaded, _entries
    if _loaded:
        return
    with _lock:
        if _loaded:
            return
        if LOGS_FILE.exists():
            try:
                data = json.loads(LOGS_FILE.read_text(encoding="utf-8"))
                if isinstance(data, list):
                    _entries = [e for e in data if isinstance(e, dict)][-LOG_MAX:]
            except Exception:
                _entries = []
        _loaded = True


def _persist() -> None:
    try:
        LOGS_FILE.write_text(json.dumps(_entries[-LOG_MAX:], indent=2), encoding="utf-8")
    except Exception:
        pass


def _mirror_to_prisma(entry: Dict[str, Any]) -> None:
    """Best-effort POST to Next ingest so Admin Studio Logs can read Prisma rows."""
    if not INTERNAL_SECRET:
        _warn_missing_secret_once()
        return

    def _post() -> None:
        try:
            extras = {
                k: v
                for k, v in entry.items()
                if k
                not in (
                    "id",
                    "ts",
                    "level",
                    "message",
                    "source",
                    "runId",
                    "run_id",
                    "userId",
                    "user_id",
                    "userEmail",
                    "user_email",
                    "flowEmail",
                    "flow_email",
                )
            }
            payload = {
                "level": entry.get("level"),
                "message": entry.get("message"),
                "source": entry.get("source"),
                "runId": entry.get("runId") or entry.get("run_id"),
                "userId": entry.get("userId") or entry.get("user_id"),
                "userEmail": entry.get("userEmail") or entry.get("user_email"),
                "flowEmail": entry.get("flowEmail") or entry.get("flow_email"),
                "details": extras if extras else None,
            }
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                NEXT_INGEST_URL,
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "X-Internal-Secret": INTERNAL_SECRET,
                    "Host": "127.0.0.1:3000",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                resp.read()
        except Exception as exc:
            logging.getLogger("studio_logs").debug(
                "Prisma studio-log mirror failed: %s", exc
            )

    try:
        threading.Thread(target=_post, daemon=True).start()
    except Exception:
        pass


def backfill_recent_to_prisma(limit: int = 80) -> int:
    """Push recent ring-buffer entries into Prisma (idempotent-ish best effort)."""
    items = list_logs(limit=limit)
    for entry in items:
        _mirror_to_prisma(entry)
    return len(items)


def append_log(
    level: str,
    message: str,
    source: str = "studio",
    **extra: Any,
) -> Dict[str, Any]:
    """Append a timestamped log entry (info | warning | error) and mirror to Prisma."""
    _ensure_loaded()
    lvl = (level or "info").lower().strip()
    if lvl not in ("info", "warning", "error", "debug"):
        lvl = "info"

    user_id = extra.pop("userId", None) or extra.pop("user_id", None) or _saas_user_id.get()
    user_email = (
        extra.pop("userEmail", None)
        or extra.pop("user_email", None)
        or _saas_user_email.get()
    )
    flow_email = extra.pop("flowEmail", None) or extra.pop("flow_email", None) or _flow_email()
    run_id = extra.pop("runId", None) or extra.pop("run_id", None) or _run_id.get()

    entry: Dict[str, Any] = {
        "id": uuid.uuid4().hex[:10],
        "ts": _now_iso(),
        "level": lvl,
        "message": str(message)[:2000],
        "source": str(source or "studio")[:64],
    }
    if run_id:
        entry["runId"] = str(run_id)[:80]
    if user_id:
        entry["userId"] = str(user_id)
    if user_email:
        entry["userEmail"] = str(user_email).lower()
    if flow_email:
        entry["flowEmail"] = str(flow_email).lower()

    for k, v in extra.items():
        if v is None or k in entry:
            continue
        try:
            json.dumps(v)
            entry[k] = v
        except Exception:
            entry[k] = str(v)[:500]
    with _lock:
        _entries.append(entry)
        if len(_entries) > LOG_MAX:
            del _entries[: len(_entries) - LOG_MAX]
        _persist()
    _mirror_to_prisma(entry)
    return entry


def list_logs(
    limit: int = 100,
    level: Optional[str] = None,
) -> List[Dict[str, Any]]:
    _ensure_loaded()
    with _lock:
        items = list(_entries)
    if level:
        lvl = level.lower().strip()
        items = [e for e in items if e.get("level") == lvl]
    lim = max(1, min(int(limit or 100), LOG_MAX))
    return items[-lim:]


def clear_logs() -> int:
    _ensure_loaded()
    with _lock:
        n = len(_entries)
        _entries.clear()
        _persist()
    return n


class StudioLogHandler(logging.Handler):
    """Mirror WARNING+ from backend loggers into the studio ring buffer."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            if record.levelno < logging.WARNING:
                return
            level = "error" if record.levelno >= logging.ERROR else "warning"
            msg = self.format(record) if self.formatter else record.getMessage()
            append_log(level, msg, source=record.name or "backend")
        except Exception:
            pass


def install_logging_bridge() -> None:
    """Attach handler once so flow_service / flow_api warnings appear in UI logs."""
    root = logging.getLogger()
    for h in root.handlers:
        if isinstance(h, StudioLogHandler):
            return
    handler = StudioLogHandler()
    handler.setLevel(logging.WARNING)
    handler.setFormatter(logging.Formatter("%(message)s"))
    for name in ("flow_service", "flow_api", "uvicorn.error"):
        logging.getLogger(name).addHandler(handler)
