"""
Official Google Flow batchexecute helpers (flow.google.com AiSandbox Angular).

Decoded from Google Flow Capture (2026-09-05): cookie session + `at` token,
no Bearer Authorization. Generation RPCs:

  maseQ  — upload image (base64) → media UUID
  as29s  — media ready / status (may return wrb error [5] when not ready)
  ogiZ0b — image gen / remix (GEM_PIX_2, …); supports character entity refs
  MZZa6b — video gen / animate (veo_3_1_r2v_*); supports characters + voice
  C4BZMd — create character entity
  rzMKMb — update character (display name / audio_references voice presets)
  jwpduf — poll video generation job until video URL appears

Preferred batchexecute host is flow.google.com (labs.google often 405).
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
from urllib.parse import parse_qs, unquote


UUID_RE = re.compile(
    r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}",
    re.I,
)
FLOW_IMAGE_URL_RE = re.compile(r"https://flow-content\.google/image/[^\s\"'\\,]+")
FLOW_VIDEO_URL_RE = re.compile(r"https://flow-content\.google/video/[^\s\"'\\,]+")
DEFAULT_BL = "boq_labs-ai-sandbox-frontend_20260903.13_p1"

# Capture-proven primary; labs kept as fallback (often HTTP 405 without Angular shell).
BATCHEXECUTE_BASES = (
    "https://flow.google.com",
    "https://labs.google",
)
BATCHEXECUTE_PATH = "/_/AiSandboxAngularFrontend/data/batchexecute"

CharacterRefLike = Union[Dict[str, Any], Sequence[Any]]


def normalize_character_refs(
    characters: Optional[Sequence[CharacterRefLike]],
) -> List[Dict[str, Any]]:
    """Normalize [{entity_id, name, image_media_id, ...}] or [id, name] pairs.

    Preserves portrait fields so multi-character likeness can be sent to Google.
    """
    out: List[Dict[str, Any]] = []
    for c in characters or []:
        if isinstance(c, dict):
            eid = str(c.get("entity_id") or c.get("id") or c.get("character_id") or "").strip()
            name = str(c.get("name") or c.get("display_name") or "").strip()
            if not eid:
                continue
            row: Dict[str, Any] = {"entity_id": eid, "name": name or "Character"}
            for key in ("character_id", "image_media_id", "image_url", "local_image_path", "portraitUrl"):
                val = c.get(key)
                if val:
                    row[key] = val
            out.append(row)
            if len(out) >= 4:  # Google Veo allows up to 4 characters in a single prompt
                break
        elif isinstance(c, (list, tuple)) and c:
            eid = str(c[0] or "").strip()
            name = str(c[1] if len(c) > 1 else "").strip()
            if eid:
                out.append({"entity_id": eid, "name": name or "Character"})
                if len(out) >= 4:
                    break
    return out


def build_structured_prompt_parts(
    prompt: str,
    characters: Optional[Sequence[CharacterRefLike]] = None,
) -> list:
    """Build ogiZ0b / MZZa6b structured prompt inner parts.

    Character + text (official @mention injection):
      [[[null, [null, null, [entityId, name]]], [" remaining text"]]]

    Plain text:
      [[[prompt]]]
    """
    refs = normalize_character_refs(characters)
    text = prompt if prompt is not None else ""
    if not refs:
        return [[[text]]]

    # Official UI puts the character name in the reference object; remaining
    # prompt text is a separate part (often with a leading space).
    parts: list = []
    for ref in refs:
        parts.append([None, [None, None, [ref["entity_id"], ref["name"] or "Character"]]])
    # Strip leading @Name mentions for every selected character
    remainder = text
    for ref in refs:
        name = ref.get("name") or ""
        if not name:
            continue
        stripped = remainder.lstrip()
        for prefix in (f"@{name}", name):
            if stripped.startswith(prefix):
                stripped = stripped[len(prefix) :].lstrip()
                remainder = stripped
                break
    if remainder is None:
        remainder = ""
    if remainder and not remainder.startswith((" ", "\n", "\t")):
        remainder = " " + remainder if remainder else remainder
    parts.append([remainder])
    return [parts]


def structured_prompt_analytics(
    prompt: str,
    characters: Optional[Sequence[CharacterRefLike]] = None,
) -> Dict[str, Any]:
    """Analytics / aisandbox-shaped structuredPrompt + referenceEntityIds."""
    refs = normalize_character_refs(characters)
    parts: List[Dict[str, Any]] = []
    for ref in refs:
        parts.append({"reference": {"entityId": ref["entity_id"]}})
    text = prompt or ""
    for ref in refs:
        name = ref.get("name") or ""
        if not name:
            continue
        stripped = text.lstrip()
        for prefix in (f"@{name}", name):
            if stripped.startswith(prefix):
                stripped = stripped[len(prefix) :].lstrip()
                text = stripped
                break
    if refs and text and not text.startswith((" ", "\n", "\t")):
        text = " " + text
    if text or not refs:
        parts.append({"text": text})
    out: Dict[str, Any] = {"structuredPrompt": {"parts": parts}}
    if refs:
        out["referenceEntityIds"] = [r["entity_id"] for r in refs]
    return out


def build_C4BZMd_payload(
    project_id: str,
    display_name: str = "Untitled character",
    media_ids: Optional[Sequence[str]] = None,
) -> list:
    """Create character entity — capture C4BZMd.

    Optional media_ids attach an already-uploaded Flow image (use-my-own-image)
    without running a portrait generation.
    """
    media_slot: list = [str(m) for m in (media_ids or []) if str(m).strip()]
    return [[project_id, None, None, [1, display_name or "Untitled character", media_slot]]]


def build_rzMKMb_payload(
    project_id: str,
    character_id: str,
    *,
    display_name: Optional[str] = None,
    voice_presets: Optional[Sequence[str]] = None,
) -> list:
    """Update character — capture rzMKMb (name and/or audio_references)."""
    paths: List[List[str]] = []
    info: list = [1]
    if display_name is not None:
        info.append(display_name)
        paths.append(["entity_info.display_name"])
    if voice_presets is not None:
        # Pad display_name slot with null when only updating voice
        if display_name is None:
            info.append(None)
        audio = [[None, str(v)] for v in voice_presets if v]
        info.append([None, audio])
        paths.append(["entity_info.character_info.audio_references"])
    if not paths:
        raise ValueError("rzMKMb requires display_name and/or voice_presets")
    return [[project_id, character_id, None, info], paths]


def extract_wiz_meta_from_captures(captures: List[Any]) -> Optional[Dict[str, str]]:
    """Pull live WIZ `at` / `bl` / `f.sid` from Capture-extension batchexecute rows.

    Official Flow posts form body `…&at=AIQ-…` and query `bl` + `f.sid`. Harvesting
    these lets the studio call batchexecute over plain HTTPS with cookies when the
    CDP Next.js tab has no Angular `SNlM0e`.
    """
    best: Optional[Dict[str, str]] = None
    best_ts = -1
    for cap in captures or []:
        if not isinstance(cap, dict):
            continue
        path = str(cap.get("path") or cap.get("url") or "")
        if "batchexecute" not in path and "AiSandboxAngularFrontend" not in path:
            continue
        body = str(cap.get("requestBody") or "")
        # Query params may be relative path or absolute URL
        q = path.split("?", 1)[1] if "?" in path else ""
        qs = parse_qs(q, keep_blank_values=False)
        bl = (qs.get("bl") or [None])[0] or ""
        sid = (qs.get("f.sid") or qs.get("f_sid") or [None])[0] or ""
        at = (qs.get("at") or [None])[0] or ""
        if not at and "at=" in body:
            m = re.search(r"(?:^|&)at=([^&]+)", body)
            if m:
                at = unquote(m.group(1))
        if not at:
            continue
        at = unquote(at)
        if "%" in at:
            at = unquote(at)
        ts = int(cap.get("ts") or 0)
        host = str(cap.get("host") or "")
        if not host and path.startswith("http"):
            try:
                from urllib.parse import urlparse

                host = urlparse(path).netloc
            except Exception:
                host = ""
        row = {
            "at": at,
            "bl": bl or DEFAULT_BL,
            "sid": str(sid or ""),
            "preferred_base": (
                "https://flow.google.com"
                if "flow.google.com" in host
                else ("https://labs.google" if "labs.google" in host else "")
            ),
            "source": "capture_harvest",
        }
        if ts >= best_ts:
            best_ts = ts
            best = row
    if not best:
        return None
    best["updatedAt"] = datetime.now(timezone.utc).isoformat()
    return best


def merge_wiz_meta(existing: Optional[Dict[str, Any]], harvested: Optional[Dict[str, str]]) -> Dict[str, Any]:
    """Prefer freshly harvested tokens; keep prior fields if harvest incomplete."""
    out: Dict[str, Any] = dict(existing or {})
    if harvested:
        for k in ("at", "bl", "sid", "updatedAt", "preferred_base", "source"):
            if harvested.get(k):
                out[k] = harvested[k]
    return out


def new_client_uuids() -> Tuple[str, str]:
    return str(uuid.uuid4()).upper(), str(uuid.uuid4()).upper()


def client_context(project_id: str, recaptcha_token: str) -> list:
    """Shared client context block used by maseQ / ogiZ0b / MZZa6b."""
    return [
        None,
        22,
        None,
        None,
        None,
        project_id,
        None,
        None,
        None,
        None,
        [recaptcha_token, 1],
    ]


def build_maseq_payload(
    project_id: str,
    recaptcha_token: str,
    image_b64: str,
    mime_type: str,
    filename: str,
) -> list:
    """Upload image — matches capture maseQ f.req payload."""
    u1, u2 = new_client_uuids()
    return [
        client_context(project_id, recaptcha_token),
        image_b64,
        mime_type or "image/jpeg",
        1,
        None,
        None,
        None,
        None,
        filename or "upload.jpg",
        None,
        u1,
        u2,
    ]


def build_as29s_payload(media_id: str) -> list:
    return [media_id]


def build_ogiZ0b_payload(
    project_id: str,
    recaptcha_token: str,
    image_id: Optional[str],
    prompt: str,
    seed: int,
    wire_model: str,
    aspect_ratio: str = "16:9",
    characters: Optional[Sequence[CharacterRefLike]] = None,
    destination_character_id: Optional[str] = None,
    image_ids: Optional[Sequence[str]] = None,
) -> list:
    """Image gen / remix — capture shape for ogiZ0b.

    - I2I remix: pass image_id, plain prompt (or image_ids for multi-reference)
    - Character @mention T2I: pass characters=[{entity_id,name}], image_id=None
    - Character portrait: plain prompt + destination_character_id (binds image to entity)
    """
    # Capture: 16:9 → 3, 9:16 → 2, square → 1
    aspect_enum = 3 if aspect_ratio == "16:9" else (2 if aspect_ratio == "9:16" else 1)
    u1, u2 = new_client_uuids()
    u3 = str(uuid.uuid4()).upper()
    ctx = client_context(project_id, recaptcha_token)
    refs = normalize_character_refs(characters)
    
    all_imgs = [str(x) for x in (image_ids or []) if str(x).strip()]
    if image_id and str(image_id) not in all_imgs:
        all_imgs.insert(0, str(image_id))

    image_slot: Any = None
    if all_imgs:
        image_slot = [[mid, None, None, None, 1] for mid in all_imgs]
    prompt_parts = build_structured_prompt_parts(prompt, refs)
    ref_ids_slot: Any = [[r["entity_id"] for r in refs]] if refs else None
    req_block = [
        None,
        None,
        image_slot,
        seed,
        aspect_enum,
        wire_model,
        None,
        ctx,
        prompt_parts,
        None,
        ref_ids_slot,
        None,
        u1,
        u2,
    ]
    # Portrait bind: [batchUuid, null, [characterId, [0]]]
    if destination_character_id:
        tail: list = [u3, None, [destination_character_id, [0]]]
    else:
        tail = [u3]
    return [None, [req_block], 1, ctx, tail]


def build_MZZa6b_payload(
    project_id: str,
    recaptcha_token: str,
    image_id: Optional[str],
    prompt: str,
    wire_model: str,
    aspect_ratio: str = "16:9",
    characters: Optional[Sequence[CharacterRefLike]] = None,
    voice_presets: Optional[Sequence[str]] = None,
) -> list:
    """Video gen / animate — capture shape for MZZa6b.

    Variants from characters capture:
    - image only: prompt text + [[null, imageId]]
    - character, no start image: structured character parts + null image + [[entityId]]
    - character + image: structured parts + image + [[entityId]]
    - voice list alone (index 7): often wrb error [3] — prefer voice on character via rzMKMb
    """
    # Capture: 16:9 → 2
    aspect_enum = 2 if aspect_ratio == "16:9" else (1 if aspect_ratio == "9:16" else 3)
    u1, u2 = new_client_uuids()
    u3 = str(uuid.uuid4()).upper()
    refs = normalize_character_refs(characters)
    voices = [str(v) for v in (voice_presets or []) if v]
    prompt_parts = build_structured_prompt_parts(prompt, refs)
    image_slot: Any = [[None, image_id]] if image_id else None
    req_block: list = [
        [None, None, prompt_parts],
        image_slot,
        wire_model,
        aspect_enum,
        None,
        [None, None, None, None, u1, u2],
    ]
    if refs:
        # pad to entity-id slot (index 9): null, null, null, [[entityId]]
        req_block.extend([None, None, None, [[r["entity_id"] for r in refs]]])
    elif voices:
        # voice-only attempt (capture failed with wrb [3] without character entity)
        req_block.extend([None, [voices]])
    # Capture tail is [batchUuid, 1] — NOT 2
    return [[req_block], client_context(project_id, recaptcha_token), [u3, 1]]


def build_jwpduf_payload(media_id: str) -> list:
    """Video job status poll — capture shape for jwpduf."""
    return [None, None, [[media_id]]]


AUTH_REFRESH_HINT = (
    "Flow batchexecute auth expired (WIZ `at` token / cookies). "
    "Re-capture from https://flow.google.com/project/{id} "
    "(Angular AiSandbox, not labs.google Next.js): start Capture with "
    "Include secrets ON, perform any Flow action (or reload), then "
    "Save to Studio so `at` refreshes in batchexecute_meta.json. "
    "Also reconnect Account cookies if the Google session is stale."
)

# flow.google.com only embeds `SNlM0e` when the cookie jar carries a real Google
# *web* session (SID / HSID / APISID). Jars exported without them get a signed-out
# WIZ shell ("S06Grb":""), so `at` can never be refreshed over plain HTTP.
NO_WIZ_SESSION_HINT = (
    "flow.google.com served a signed-out page for these cookies, so the WIZ `at` "
    "token cannot be refreshed over HTTP. Reconnect Account cookies from a "
    "signed-in flow.google.com tab (copy the whole Cookie header — it must include "
    "SID, HSID and APISID, not only the __Secure-* ones), or save a fresh Capture "
    "with Include secrets ON."
)


def is_batchexecute_auth_error(error_code: Any) -> bool:
    """True for wrb `er` envelopes / HTTP-RPC 401-style auth failures."""
    if error_code is None:
        return False
    s = str(error_code).strip().lower()
    if s in ("auth_error", "auth_401", "http_401", "unauthorized"):
        return True
    if s.startswith("auth_") and any(ch.isdigit() for ch in s):
        # auth_401, auth_403, …
        return True
    if "auth_401" in s or "auth expired" in s:
        return True
    return False


def is_batchexecute_fallback_error(error_code: Any, raw: Any = "") -> bool:
    """True when callers should skip batchexecute and use aisandbox instead.

    Covers stale `at` (auth_401), empty CDP/HTTP bodies, fetch failures, and
    host unavailability — cookies may still be fine for Bearer aisandbox.
    """
    if is_batchexecute_auth_error(error_code):
        return True
    if error_code in (
        "empty",
        "parse_failed",
        "null_payload",
        "missing_at_token",
        "http_405",
        "http_404",
        "fetch_failed",
        "http_error",
        # No Chrome CDP / no already-open Flow tab, and no usable WIZ session:
        # batchexecute simply is not reachable, so callers must use aisandbox.
        "cdp_unavailable",
        "wiz_session_dead",
    ):
        return True
    blob = f"{error_code} {raw}".lower()
    return (
        "failed to fetch" in blob
        or "cookiemismatch" in blob
        or "not on flow.google.com" in blob
        or "missing_at" in blob
        or "batchexecute_unavailable" in blob
        or "cdp_unavailable" in blob
        or "wiz_session_dead" in blob
        # Legacy phrasing of the "open a Flow tab yourself" failure.
        or "no open google flow tab" in blob
        or "will not open a new browser" in blob
        or ('"er"' in blob and "401" in blob)
    )


def auth_error_message(error_code: Any = None) -> str:
    code = str(error_code) if error_code is not None else "auth_401"
    return f"{code}: {AUTH_REFRESH_HINT}"


_LENGTH_PREFIX_RE = re.compile(r"^\d+\s+")
_JSON_ARRAY_RE = re.compile(r"\[(?:[^\[\]]|\[(?:[^\[\]]|\[[^\[\]]*\])*\])*\]")


def _iter_batchexecute_json_lines(text: str) -> List[str]:
    """Yield JSON array lines from length-prefixed batchexecute bodies.

    Google sometimes emits:
      106\\n[[...]]
    and sometimes glues the length onto the same line:
      106 [[...]]
    """
    lines: List[str] = []
    for raw_line in (text or "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith(")]}'"):
            continue
        # Strip optional chunk length prefix ("106" or "106 ")
        if _LENGTH_PREFIX_RE.match(line) and "[" in line:
            line = _LENGTH_PREFIX_RE.sub("", line, count=1).strip()
        if line.startswith("["):
            lines.append(line)
    # Fallback: pull top-level arrays if line splitting missed them
    if not lines and "[" in (text or ""):
        for m in _JSON_ARRAY_RE.finditer(text or ""):
            chunk = m.group(0)
            if '"er"' in chunk or "wrb.fr" in chunk:
                lines.append(chunk)
    return lines


def parse_batchexecute_text(raw_text: str, rpc_id: str) -> Dict[str, Any]:
    """Parse labs batchexecute response text into structured result.

    Returns keys: ok, data, error_code, raw
    Error [5] on as29s means media not ready yet.
    Auth failure envelope: ["er", null, null, null, null, 401, ...] → auth_401
    """
    if not raw_text:
        return {"ok": False, "data": None, "error_code": "empty", "raw": ""}

    # Unwrap CDP wrapper if present
    text = raw_text
    try:
        maybe = json.loads(raw_text)
        if isinstance(maybe, dict) and "text" in maybe:
            if maybe.get("error"):
                return {
                    "ok": False,
                    "data": None,
                    "error_code": maybe.get("error"),
                    "raw": raw_text,
                }
            text = maybe.get("text") or ""
    except Exception:
        pass

    last_error = None
    for line in _iter_batchexecute_json_lines(text):
        if rpc_id not in line and "wrb.fr" not in line and '"er"' not in line:
            continue
        try:
            outer = json.loads(line)
        except Exception:
            continue
        if not outer or not isinstance(outer, list):
            continue
        row = outer[0]
        if not isinstance(row, list) or len(row) < 2:
            continue

        # Auth failure: ["er", null, null, null, null, 401, ...]
        if row[0] == "er":
            code = row[5] if len(row) > 5 else "auth_error"
            last_error = f"auth_{code}" if not isinstance(code, str) else code
            continue

        # wrb.fr format: ["wrb.fr", rpcid, payload_or_null, ..., error?, "generic"]
        if row[0] == "wrb.fr":
            if len(row) > 1 and row[1] != rpc_id and rpc_id not in line:
                continue
            # Error slot often at index 5: [5]
            if row[2] is None:
                err = None
                if len(row) > 5 and isinstance(row[5], list) and row[5]:
                    err = row[5][0] if len(row[5]) == 1 else row[5]
                last_error = err if err is not None else "null_payload"
                continue
            try:
                data = json.loads(row[2]) if isinstance(row[2], str) else row[2]
                return {"ok": True, "data": data, "error_code": None, "raw": text}
            except Exception as e:
                last_error = str(e)
                continue

        # Legacy: [[rpc?, ..., payload]]
        try:
            if len(row) > 2 and row[2]:
                data = json.loads(row[2]) if isinstance(row[2], str) else row[2]
                return {"ok": True, "data": data, "error_code": None, "raw": text}
        except Exception:
            pass

    if last_error is None and '"er"' in text:
        m401 = re.search(
            r'\[\s*"er"\s*,\s*null\s*,\s*null\s*,\s*null\s*,\s*null\s*,\s*(\d+)',
            text,
        )
        if m401:
            last_error = f"auth_{m401.group(1)}"
        elif re.search(r'\[\s*"er"\s*,', text):
            last_error = "auth_error"

    return {
        "ok": False,
        "data": None,
        "error_code": last_error if last_error is not None else "parse_failed",
        "raw": text[:2000],
    }


def clean_flow_url(url: str) -> str:
    return (url or "").replace(r"\u0026", "&").replace("\\u003d", "=").replace("\\u0026", "&")


def extract_urls(obj: Any) -> Dict[str, List[str]]:
    blob = json.dumps(obj) if not isinstance(obj, str) else obj
    images = [clean_flow_url(u) for u in FLOW_IMAGE_URL_RE.findall(blob)]
    videos = [clean_flow_url(u) for u in FLOW_VIDEO_URL_RE.findall(blob)]
    # de-dupe preserve order
    def uniq(xs: List[str]) -> List[str]:
        seen = set()
        out = []
        for x in xs:
            if x not in seen:
                seen.add(x)
                out.append(x)
        return out

    return {"images": uniq(images), "videos": uniq(videos)}


def extract_maseq_result(data: Any) -> Dict[str, Any]:
    """maseQ → media_id, workflow_id, dimensions."""
    out: Dict[str, Any] = {"media_id": None, "workflow_id": None, "width": None, "height": None}
    if not isinstance(data, list) or not data:
        return out
    block = data[0] if isinstance(data[0], list) else None
    if not block:
        return out
    out["media_id"] = block[0] if isinstance(block[0], str) else None
    out["workflow_id"] = block[2] if len(block) > 2 and isinstance(block[2], str) else None
    try:
        dims = block[6][2]
        if isinstance(dims, list) and len(dims) >= 2:
            out["width"], out["height"] = dims[0], dims[1]
    except Exception:
        pass
    if not out["workflow_id"] and len(data) > 1 and isinstance(data[1], list):
        try:
            out["workflow_id"] = data[1][0]
        except Exception:
            pass
    return out


def extract_ogiZ0b_result(data: Any, exclude_ids: Optional[set] = None) -> Dict[str, Any]:
    """ogiZ0b → media_id + image URL (often present immediately)."""
    exclude_ids = exclude_ids or set()
    out: Dict[str, Any] = {"media_id": None, "url": "", "workflow_id": None, "width": None, "height": None}
    urls = extract_urls(data)
    if urls["images"]:
        out["url"] = urls["images"][0]

    if isinstance(data, list) and data and isinstance(data[0], list) and data[0]:
        block = data[0][0]
        if isinstance(block, list) and block:
            mid = block[0]
            if isinstance(mid, str) and mid not in exclude_ids:
                out["media_id"] = mid
            if len(block) > 2 and isinstance(block[2], str):
                out["workflow_id"] = block[2]
            try:
                nested = block[6][0]
                if isinstance(nested, list):
                    if not out["url"] and len(nested) > 13 and isinstance(nested[13], str):
                        out["url"] = clean_flow_url(nested[13])
                    if len(block[6]) > 2 and isinstance(block[6][2], list):
                        dims = block[6][2]
                        out["width"], out["height"] = dims[0], dims[1]
            except Exception:
                pass

    if not out["media_id"]:
        for u in UUID_RE.findall(json.dumps(data)):
            if u.lower() not in {x.lower() for x in exclude_ids}:
                out["media_id"] = u
                break
    return out


def extract_MZZa6b_result(data: Any, exclude_ids: Optional[set] = None) -> Dict[str, Any]:
    """MZZa6b → generation media_id (NOT workflow id) + optional early URLs."""
    exclude_ids = {x.lower() for x in (exclude_ids or set())}
    out: Dict[str, Any] = {"media_id": None, "workflow_id": None, "url": "", "thumbnail_url": ""}
    urls = extract_urls(data)
    if urls["videos"]:
        out["url"] = urls["videos"][0]
    if urls["images"]:
        out["thumbnail_url"] = urls["images"][0]

    # Capture response shape:
    # [null, null, [[workflow, ..., [prompt, ts, null, null, media_id, ...], project]], [[media_id, project, workflow, ...]]]
    try:
        if isinstance(data, list) and len(data) > 3 and isinstance(data[3], list) and data[3]:
            media_block = data[3][0]
            if isinstance(media_block, list) and isinstance(media_block[0], str):
                cand = media_block[0]
                if cand.lower() not in exclude_ids:
                    out["media_id"] = cand
                if len(media_block) > 2 and isinstance(media_block[2], str):
                    out["workflow_id"] = media_block[2]
    except Exception:
        pass

    try:
        if not out["workflow_id"] and isinstance(data, list) and len(data) > 2:
            wf_block = data[2][0]
            if isinstance(wf_block, list) and isinstance(wf_block[0], str):
                out["workflow_id"] = wf_block[0]
                if not out["media_id"] and isinstance(wf_block[3], list) and len(wf_block[3]) > 4:
                    mid = wf_block[3][4]
                    if isinstance(mid, str) and mid.lower() not in exclude_ids:
                        out["media_id"] = mid
    except Exception:
        pass

    if not out["media_id"]:
        # Prefer UUIDs that appear as media-like (second occurrence after workflow)
        found = []
        for u in UUID_RE.findall(json.dumps(data)):
            if u.lower() not in exclude_ids:
                found.append(u)
        # In capture order: workflow, media, project(excluded), source(excluded)
        if len(found) >= 2:
            out["workflow_id"] = out["workflow_id"] or found[0]
            out["media_id"] = found[1]
        elif found:
            out["media_id"] = found[0]
    return out


def as29s_is_ready(data: Any, want: str = "image") -> Dict[str, Any]:
    """Interpret as29s payload: ready when image/video CDN URL (or dims) present."""
    urls = extract_urls(data)
    result = {
        "ready": False,
        "url": "",
        "thumbnail_url": "",
        "width": None,
        "height": None,
    }
    if want == "video":
        if urls["videos"]:
            result["ready"] = True
            result["url"] = urls["videos"][0]
            if urls["images"]:
                result["thumbnail_url"] = urls["images"][0]
        return result

    if urls["images"]:
        result["ready"] = True
        result["url"] = urls["images"][0]
        return result

    # Sometimes dims exist before URL — treat as ready for upload ingest
    try:
        if isinstance(data, list) and len(data) > 6 and isinstance(data[6], list):
            # uploaded image shape may nest dims at [6][2]
            pass
    except Exception:
        pass
    return result
