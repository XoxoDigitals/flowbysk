"""Shared helper for reading secrets/config from the environment.

In production PM2 injects the project-root `.env` into the process
environment. In dev the worker is started by `run.py` and may not have
`.env` loaded, so this helper falls back to parsing the file directly.
Always prefers `os.environ` first, then the `.env` file.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Optional

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
_dotenv_cache: Optional[Dict[str, str]] = None


def _parse_dotenv(path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    try:
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                values[key.strip()] = val.strip().strip('"').strip("'")
    except Exception:
        pass
    return values


def _dotenv() -> Dict[str, str]:
    global _dotenv_cache
    if _dotenv_cache is None:
        _dotenv_cache = _parse_dotenv(_ENV_PATH)
    return _dotenv_cache


def get_env(*keys: str) -> Optional[str]:
    """Return the first non-empty value for any of `keys`.

    Checks `os.environ` first (production/PM2), then falls back to the
    project-root `.env` file (dev, when `run.py` hasn't loaded it).
    """
    for key in keys:
        val = os.environ.get(key)
        if val and val.strip():
            return val.strip()
    dv = _dotenv()
    for key in keys:
        val = dv.get(key)
        if val and val.strip():
            return val.strip()
    return None


def is_production() -> bool:
    return (get_env("NODE_ENV") or "").strip().lower() == "production"
