"""
Google Flow Web Studio — FastAPI Backend
Exposes REST endpoints for authentication, cookie management, media generation,
and serves the web studio interface.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import re
import requests
from urllib.parse import urlparse
from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field

from backend.env_util import get_env
from backend.flow_service import flow_service, project_url
from backend.egress_proxy import sync_egress_proxy_env
from backend.studio_logs import (
    append_log,
    backfill_recent_to_prisma,
    clear_logs,
    clear_request_identity,
    install_logging_bridge,
    list_logs,
    set_request_identity,
)

logger = logging.getLogger("flow_api")
logging.basicConfig(level=logging.INFO)
install_logging_bridge()

try:
    sync_egress_proxy_env()
except Exception as e:
    logger.debug("egress proxy sync at startup: %s", e)

app = FastAPI(
    title="Google Flow Web Studio API",
    description="Web tool utilizing Google Flow API via session cookies",
    version="1.0.0",
)


def _bind_studio_identity(request: Request, run_id: Optional[str] = None) -> None:
    """
    Sync FastAPI routes run in a threadpool — middleware ContextVars do not carry over.
    Re-bind SaaS user + runId from request headers/body so all append_log steps share one run.
    """
    try:
        set_request_identity(
            request.headers.get("x-gflow-user-id"),
            request.headers.get("x-gflow-user-email"),
            (run_id or "").strip() or request.headers.get("x-gflow-run-id"),
        )
    except Exception:
        pass


def _prewarm_cdp() -> None:
    try:
        flow_service._ensure_cdp_browser(auto_launch=True)
    except Exception as e:
        logger.debug("CDP helper background prewarm notice: %s", e)

import threading
threading.Thread(target=_prewarm_cdp, daemon=True).start()


def _backfill_studio_logs() -> None:
    """After Next is up, mirror recent FastAPI ring-buffer logs into Prisma."""
    import time

    time.sleep(4)
    try:
        n = backfill_recent_to_prisma(120)
        logger.info("Studio logs Prisma backfill queued for %s entries", n)
    except Exception as e:
        logger.debug("Studio logs backfill skipped: %s", e)


threading.Thread(target=_backfill_studio_logs, daemon=True).start()

# CORS — explicit allowlist required alongside allow_credentials=True ("*" + credentials
# is rejected by browsers anyway, and would leak session cookies cross-origin).
_worker_allowed_origins = [
    o.strip()
    for o in (get_env("WORKER_ALLOWED_ORIGINS") or "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_worker_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------------------
# Lightweight in-memory rate limiter for the generation endpoints (no external
# deps). Fixed window per identity: x-gflow-user-id header, else client IP.
# ------------------------------------------------------------------------------
_RATE_LIMIT_MAX = int(os.environ.get("GENERATE_RATE_LIMIT_MAX", "30"))
_RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("GENERATE_RATE_LIMIT_WINDOW_SECONDS", "60"))
_rate_limit_lock = threading.Lock()
_rate_limit_buckets: Dict[str, "tuple[int, float]"] = {}


def _rate_limit_identity(request: Request) -> str:
    uid = (request.headers.get("x-gflow-user-id") or "").strip()
    if uid:
        return f"user:{uid}"
    client_host = request.client.host if request.client else "unknown"
    return f"ip:{client_host}"


def _enforce_rate_limit(request: Request) -> None:
    """Raise HTTP 429 if this identity has exceeded the generation rate limit."""
    import time as _time

    identity = _rate_limit_identity(request)
    now = _time.time()
    with _rate_limit_lock:
        count, window_start = _rate_limit_buckets.get(identity, (0, now))
        if now - window_start >= _RATE_LIMIT_WINDOW_SECONDS:
            count, window_start = 0, now
        count += 1
        _rate_limit_buckets[identity] = (count, window_start)
    if count > _RATE_LIMIT_MAX:
        retry_after = max(1, int(_RATE_LIMIT_WINDOW_SECONDS - (now - window_start)))
        raise HTTPException(
            status_code=429,
            detail=(
                f"Rate limit exceeded ({_RATE_LIMIT_MAX} requests per "
                f"{_RATE_LIMIT_WINDOW_SECONDS}s). Please slow down."
            ),
            headers={"Retry-After": str(retry_after)},
        )


@app.middleware("http")
async def bind_saas_identity(request, call_next):
    """Capture SaaS user from Next → worker headers for StudioLog tagging."""
    try:
        set_request_identity(
            request.headers.get("x-gflow-user-id"),
            request.headers.get("x-gflow-user-email"),
            request.headers.get("x-gflow-run-id"),
        )
    except Exception:
        pass
    try:
        return await call_next(request)
    finally:
        try:
            clear_request_identity()
        except Exception:
            pass


# Legacy frontend dirs are intentionally not served from the worker (use Next :3000).


# ------------------------------------------------------------------------------
# Request / Response Schemas
# ------------------------------------------------------------------------------

class CookiesRequest(BaseModel):
    cookies: Any = Field(..., description="Raw cookie string, Netscape format, or JSON array/object")


class WizMetaRequest(BaseModel):
    at: str = Field(..., description="WIZ SNlM0e / batchexecute `at` token")
    bl: Optional[str] = Field(None, description="WIZ bl / cfb2h")
    sid: Optional[str] = Field(None, description="WIZ f.sid / FdrFJe")
    preferred_base: Optional[str] = Field("https://flow.google.com")


class TierOverrideRequest(BaseModel):
    tier: Optional[str] = Field(None, description="Account tier override ('auto', 'Free', 'Pro', 'Ultra')")


class SimulationRequest(BaseModel):
    enabled: Optional[bool] = Field(None, description="Explicitly set simulation mode or toggle if None")


class VideoLastFrameRequest(BaseModel):
    url: Optional[str] = Field(None, description="Playable video URL when asset is not in Python history")
    video_url: Optional[str] = Field(None, description="Alias for url")


class VideoUpscaleRequest(BaseModel):
    url: Optional[str] = Field(None, description="Playable video URL when asset is not in Python history")
    aspect_ratio: Optional[str] = Field(None)
    media_id: Optional[str] = Field(None)
    workflow_id: Optional[str] = Field(None)
    run_id: Optional[str] = Field(None, description="Studio log run id — keep upscale under the same generation run")


class CharacterRef(BaseModel):
    entity_id: str = Field(..., description="Flow character entity UUID")
    name: str = Field("", description="Display name used in structured prompt")
    image_media_id: Optional[str] = Field(
        None, description="Flow media id for character portrait (required for likeness)"
    )
    character_id: Optional[str] = Field(None, description="Optional Flow/Python character id")
    image_url: Optional[str] = Field(None, description="Portrait URL for on-demand Flow upload")
    local_image_path: Optional[str] = Field(None, description="Local portrait path for on-demand Flow upload")
    model_config = {"extra": "ignore"}

class ImageGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    aspect_ratio: str = Field("16:9", description="16:9, 9:16, 1:1, 4:3, 3:4")
    seed: Optional[int] = Field(None)
    num_images: int = Field(1, ge=1, le=4)
    model: str = Field("NARWHAL", description="GEM_PIX_2 (Nano Banana Pro), NARWHAL (Nano Banana 2), HARBOR_SEAL (Nano Banana 2 Lite)")
    characters: Optional[List[CharacterRef]] = Field(
        None, description="Character entity refs (@mention) for structured image prompts"
    )
    project_id: Optional[str] = Field(None, description="Target Google Flow project ID")
    cookies: Optional[str] = Field(None, description="Session cookies for provider account")
    run_id: Optional[str] = Field(None, description="Studio log run id — groups all steps for one user request")


class VideoGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    aspect_ratio: str = Field("16:9", description="16:9, 9:16, 1:1")
    duration: int = Field(8, description="4, 6, 8, or 10 seconds")
    seed: Optional[int] = Field(None)
    model: str = Field("VEO_3_1_LITE_LOW_PRIORITY", description="OMNI_1_1_FLASH, VEO_3_1_LITE, VEO_3_1_FAST, VEO_3_1_QUALITY, VEO_3_1_LITE_LOW_PRIORITY")
    characters: Optional[List[CharacterRef]] = Field(
        None, description="Character entity refs for character-driven video (MZZa6b)"
    )
    voice_presets: Optional[List[str]] = Field(
        None, description="Voice preset ids (prefer attaching via character update; bare voice often fails)"
    )
    project_id: Optional[str] = Field(None, description="Target Google Flow project ID")
    cookies: Optional[str] = Field(None, description="Session cookies for provider account")
    run_id: Optional[str] = Field(None, description="Studio log run id")


class VideoExtendRequest(BaseModel):
    asset_id: str = Field(...)
    prompt: str = Field(..., min_length=1)
    model: Optional[str] = Field("VEO_3_1_EXTEND_LITE", description="Extension model key")
    project_id: Optional[str] = Field(None, description="Target Google Flow project ID")
    cookies: Optional[str] = Field(None, description="Session cookies for provider account")
    run_id: Optional[str] = Field(None, description="Studio log run id")


class ImageToVideoRequest(BaseModel):
    image_id: Optional[str] = Field(None, description="Reference image asset ID (optional with characters)")
    staged_id: Optional[str] = Field(
        None, description="Local staged image id — uploaded to Flow before I2V when set"
    )
    first_frame_id: Optional[str] = Field(None, description="Start frame image media ID")
    first_frame_staged_id: Optional[str] = Field(None, description="Local staged start frame id")
    last_frame_id: Optional[str] = Field(None, description="End frame image media ID")
    last_frame_staged_id: Optional[str] = Field(None, description="Local staged end frame id")
    frame_mode: Optional[str] = Field(None, description="first_only | last_only | first_and_last")
    prompt: str = Field(..., min_length=1)
    aspect_ratio: str = Field("16:9", description="16:9, 9:16, 1:1")
    model: str = Field(
        "VEO_3_1_R2V_LITE",
        description="VEO_3_1_R2V_LITE, VEO_3_1_R2V_LITE_LOW_PRIORITY, VEO_3_1_LITE_LOW_PRIORITY, VEO_3_1_R2V_ULTRA",
    )
    duration: int = Field(5, description="Duration in seconds")
    characters: Optional[List[CharacterRef]] = Field(None, description="Character entity refs")
    voice_presets: Optional[List[str]] = Field(None, description="Optional voice preset ids")
    project_id: Optional[str] = Field(None, description="Target Google Flow project ID")
    cookies: Optional[str] = Field(None, description="Session cookies for provider account")
    run_id: Optional[str] = Field(None, description="Studio log run id")


class ImageToImageRequest(BaseModel):
    image_id: Optional[str] = Field(None, description="Reference image asset ID (optional with characters)")
    staged_id: Optional[str] = Field(
        None, description="Local staged image id — uploaded to Flow before I2I when set"
    )
    image_ids: Optional[List[str]] = Field(None, description="Multiple reference image IDs")
    staged_ids: Optional[List[str]] = Field(None, description="Multiple staged image IDs")
    prompt: str = Field(..., min_length=1)
    aspect_ratio: str = Field("16:9", description="16:9, 9:16, 1:1")
    seed: Optional[int] = Field(None)
    model: str = Field("NARWHAL", description="GEM_PIX_2, NARWHAL, HARBOR_SEAL")
    num_images: int = Field(1, ge=1, le=4, description="Parallel image outputs (1–4)")
    characters: Optional[List[CharacterRef]] = Field(None, description="Character entity refs (@mention)")
    destination_character_id: Optional[str] = Field(
        None, description="Bind generated portrait to this character entity"
    )
    project_id: Optional[str] = Field(None, description="Target Google Flow project ID")
    cookies: Optional[str] = Field(None, description="Session cookies for provider account")
    run_id: Optional[str] = Field(None, description="Studio log run id")


class IngredientGenerateRequest(BaseModel):
    ingredient_ids: List[str] = Field(default_factory=list, description="Media IDs of reference ingredients")
    staged_ids: Optional[List[str]] = Field(None, description="Staged image IDs for ingredients")
    characters: Optional[List[CharacterRef]] = Field(None, description="Character entity refs as ingredients")
    prompt: str = Field(..., min_length=1)
    output_type: str = Field("video", description="video | image")
    aspect_ratio: str = Field("16:9", description="16:9, 9:16, 1:1")
    model: Optional[str] = Field(None, description="Target model key")
    duration: int = Field(5, description="Duration in seconds (video mode)")
    seed: Optional[int] = Field(None)
    project_id: Optional[str] = Field(None, description="Target Google Flow project ID")
    cookies: Optional[str] = Field(None, description="Session cookies for provider account")
    run_id: Optional[str] = Field(None, description="Studio log run id")


class StudioLogRequest(BaseModel):
    level: str = Field("info", description="info | warning | error")
    message: str = Field(..., min_length=1)
    source: str = Field("ui", description="Log source label")


class CharacterCreateRequest(BaseModel):
    display_name: str = Field("Untitled character")
    voice_presets: Optional[List[str]] = Field(
        None, description="Optional voice preset ids (e.g. ['achird'])"
    )
    image_media_id: Optional[str] = Field(
        None, description="Optional Flow media id for character still / reference"
    )
    image_url: Optional[str] = Field(None, description="Optional preview URL for character image")
    local_image_path: Optional[str] = Field(
        None, description="Optional local path for an uploaded character image"
    )
    flow_entity_id: Optional[str] = Field(
        None,
        description="Optional Flow character entity id already created via BiB C4BZMd",
    )


class CharacterUpdateRequest(BaseModel):
    display_name: Optional[str] = Field(None)
    voice_presets: Optional[List[str]] = Field(None, description="e.g. ['achird']")
    image_media_id: Optional[str] = Field(None, description="Flow media id for character image")
    image_url: Optional[str] = Field(None, description="Preview URL for character image")
    local_image_path: Optional[str] = Field(None, description="Local path for uploaded image")


class PromptEnhanceRequest(BaseModel):
    prompt: str = Field(...)


class ProjectSwitchRequest(BaseModel):
    project_id: str = Field(..., description="Google Flow project UUID")


class ProjectCreateRequest(BaseModel):
    name: Optional[str] = Field(None, description="Optional name for new project")
    cookies: Optional[str] = Field(None, description="Optional cookies for account-specific project creation")


class WhiskIngredient(BaseModel):
    id: Optional[str] = None
    token: Optional[str] = None
    name: str = Field("Ingredient")
    category: str = Field("subject", description="subject | scene | style")
    index: Optional[int] = 1
    mediaId: Optional[str] = None
    media_id: Optional[str] = None
    stagedId: Optional[str] = None
    staged_id: Optional[str] = None
    imageUrl: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = "curated"


class WhiskComposeRequest(BaseModel):
    subject: Optional[WhiskIngredient] = None
    scene: Optional[WhiskIngredient] = None
    style: Optional[WhiskIngredient] = None
    subjects: Optional[List[WhiskIngredient]] = None
    scenes: Optional[List[WhiskIngredient]] = None
    styles: Optional[List[WhiskIngredient]] = None
    referenced_ingredients: Optional[List[WhiskIngredient]] = None
    custom_prompt: Optional[str] = ""
    aspect_ratio: str = Field("16:9", description="1:1, 16:9, 9:16, 4:3, 3:4")
    model: str = Field("NARWHAL", description="NARWHAL (Nano Banana 2) | GEM_PIX_2 (Nano Banana Pro)")
    num_images: int = Field(2, ge=1, le=4)
    seed: Optional[int] = None


class WhiskCaptionRequest(BaseModel):
    image_url: Optional[str] = None
    media_id: Optional[str] = None
    staged_id: Optional[str] = None
    category: str = Field("subject", description="subject | scene | style")


class WhiskVariantRequest(BaseModel):
    ingredient: WhiskIngredient
    caption: str = Field(..., min_length=1)
    num_variants: int = Field(3, ge=1, le=4)
    model: str = Field("NARWHAL")


# ------------------------------------------------------------------------------
# Favicon & Static Utility
# ------------------------------------------------------------------------------

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    # Return 204 No Content for favicon to prevent browser 404 console errors
    return Response(content=b"", media_type="image/x-icon", status_code=204)


# ------------------------------------------------------------------------------
# Authentication & Session Endpoints
# ------------------------------------------------------------------------------

@app.get("/api/auth/status")
def get_auth_status() -> Dict[str, Any]:
    """Get the current Google Flow authentication status and connected account details."""
    return flow_service.get_status()


@app.get("/api/auth/batchexecute")
def get_batchexecute_status() -> Dict[str, Any]:
    """Diagnostic: whether WIZ `at` / cookies look present for maseQ (no secrets)."""
    status = flow_service.get_status()
    be = status.get("batchexecute") or {}
    return {
        "success": True,
        "batchexecute": be,
        "has_cookies": status.get("has_cookies"),
        "active_project_id": status.get("active_project_id"),
        "hint": (
            None
            if be.get("ready_for_upload")
            else (
                "Upload needs cookies + harvested `at` + active project. "
                "Re-capture from https://flow.google.com/project/{id} with Include secrets ON, "
                "Save to Studio, and select a project."
            )
        ),
    }


@app.get("/api/auth/session-diagnostics")
def get_session_diagnostics() -> Dict[str, Any]:
    """Why batchexecute-only features (characters) fail: cookie jar + Chrome state."""
    return {"success": True, "diagnostics": flow_service.session_diagnostics()}


@app.post("/api/auth/sync-chrome-cookies")
def sync_chrome_cookies() -> Dict[str, Any]:
    """DISABLED — BiB manages the live browser session. Cookie sync via Chrome is no longer supported."""
    raise HTTPException(
        status_code=410,
        detail="sync-chrome-cookies is disabled. Use BiB (Browser-in-Browser) login from the Admin panel instead.",
    )


@app.post("/api/auth/cookies")
def update_cookies(req: CookiesRequest) -> Dict[str, Any]:
    """Submit fresh Google session cookies, validate them against Google Flow, and persist."""
    try:
        status = flow_service.set_cookies(req.cookies)
        return {"success": status.get("is_authenticated", False), "status": status}
    except Exception as e:
        logger.error(f"Failed to update cookies: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/auth/wiz-meta")
def update_wiz_meta(req: WizMetaRequest) -> Dict[str, Any]:
    """Inject Flow WIZ batchexecute tokens (from BiB Chrome SNlM0e)."""
    try:
        meta = flow_service.apply_wiz_meta(
            at=req.at,
            bl=req.bl,
            sid=req.sid,
            preferred_base=req.preferred_base,
        )
        return {"success": True, "wizMeta": {"atPrefix": str(meta.get("at") or "")[:20] + "…", "bl": meta.get("bl")}}
    except Exception as e:
        logger.error(f"Failed to apply wiz meta: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/auth/tier")
def set_account_tier(req: TierOverrideRequest) -> Dict[str, Any]:
    """Manually set or reset account tier override ('auto', 'Free', 'Pro', 'Ultra')."""
    try:
        status = flow_service.set_tier_override(req.tier)
        return {"success": True, "status": status}
    except Exception as e:
        logger.error(f"Failed to set tier override: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/auth/refresh")
def refresh_session() -> Dict[str, Any]:
    """Manually refresh OAuth2 access token using stored session cookies."""
    status = flow_service.refresh_session()
    return {"success": status.get("is_authenticated", False), "status": status}


@app.post("/api/auth/sync-local")
def sync_local_auth() -> Dict[str, Any]:
    """Sync credentials from local ~/.gflow/env file."""
    try:
        status = flow_service.sync_local_gflow()
        return {"success": True, "status": status}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/auth/simulation")
def toggle_simulation_mode(req: SimulationRequest) -> Dict[str, Any]:
    """Toggle or configure Simulation / Demo Mode."""
    new_state = flow_service.toggle_simulation(req.enabled)
    return {"simulation_mode": new_state}


@app.post("/api/auth/browser-login")
def trigger_browser_login() -> Dict[str, Any]:
    """DISABLED — BiB manages the live browser session. Browser login via CDP is no longer supported."""
    raise HTTPException(
        status_code=410,
        detail="browser-login is disabled. Use BiB (Browser-in-Browser) login from the Admin panel instead.",
    )


@app.post("/api/auth/disconnect")
def disconnect_account() -> Dict[str, Any]:
    """Disconnect active account and clear all stored cookies, tokens, and metadata."""
    try:
        res = flow_service.disconnect_account()
        return res
    except Exception as e:
        logger.error(f"Failed to disconnect account: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _format_error(e: Exception) -> str:
    msg = str(e)
    if "PUBLIC_ERROR_USER_QUOTA_REACHED" in msg or "429" in msg or "Quota exceeded" in msg:
        return "Google Flow daily generation quota reached for your Google account today. Please wait for your daily quota to reset, or enable Simulation Mode in the top header to continue testing."
    if (
        "auth_401" in msg
        or "auth expired" in msg.lower()
        or "WIZ `at`" in msg
        or "Re-capture from https://flow.google.com" in msg
        or ("parse_failed" in msg and "401" in msg)
    ):
        # Prefer the concrete failure after aisandbox was already tried
        if "after aisandbox" in msg.lower() or "aisandbox fallback" in msg.lower():
            return msg
        return (
            "Google Flow session auth expired (batchexecute 401). "
            "Studio will try aisandbox automatically when possible. "
            "If this persists: open https://flow.google.com/project/<id>, Capture with Include secrets ON, "
            "Save to Studio, and reconnect Account cookies."
        )
    if "404" in msg or "Requested entity was not found" in msg:
        if "model" in msg.lower() or "tier" in msg.lower():
            return "Selected model or project entity was not found on this account tier. Please try Veo 3.1 Lite or Fast."
        return "Referenced media asset or entity was not found in the current Google Flow project (404). Studio is automatically syncing cross-project assets."
    if (
        "recaptcha" in msg.lower()
        or "UNUSUAL_ACTIVITY" in msg
        or "Could not mint reCAPTCHA" in msg
        or "needs root session cookies" in msg
    ):
        # Prefer the concrete SID/HSID/APISID guidance already on the exception.
        return msg
    if "No Google Flow project" in msg or "No valid Google Flow access token" in msg:
        return msg
    return msg


def _resolve_image_id(image_id: Optional[str], staged_id: Optional[str]) -> Optional[str]:
    """Upload staged local image to Flow (maseQ → refresh → aisandbox) and auto-sync cross-project media."""
    sid = (staged_id or "").strip() or None
    mid = (image_id or "").strip() or None
    if mid and (mid.startswith("staged-") or mid.startswith("upload-")) and not sid:
        sid = mid
        mid = None
    if sid and (not mid or mid.startswith("staged-") or mid.startswith("upload-")):
        append_log("info", f"Uploading staged image {sid} to Flow…", source="upload")
        try:
            asset = flow_service.upload_staged_reference(sid)
            mid = asset.get("id")
            append_log(
                "info",
                f"Upload ready: {mid} (source={asset.get('model') or asset.get('source')})",
                source="upload",
            )
        except Exception as e:
            append_log("error", f"Staged upload failed: {_format_error(e)}", source="upload")
            raise
    if mid:
        if "flow-content.google" in mid or "http" in mid:
            import re
            m = re.search(r"(?:image|video)/([a-f0-9-]+)", mid, re.I)
            if m:
                mid = m.group(1)
        try:
            mid = flow_service.ensure_media_in_active_project(mid)
        except Exception as sync_err:
            logger.warning(f"Auto-sync media {mid} to active project warning: {sync_err}")
    return mid


# ------------------------------------------------------------------------------
# Generation Endpoints
# ------------------------------------------------------------------------------

@app.post("/api/generate/image")
def generate_image(req: ImageGenerateRequest, request: Request) -> Dict[str, Any]:
    """Generate images via Google Flow Imagen 4."""
    _enforce_rate_limit(request)
    _bind_studio_identity(request, getattr(req, "run_id", None))
    try:
        if getattr(req, "cookies", None) and str(req.cookies).strip():
            if str(req.cookies).strip() != (flow_service.cookies or "").strip():
                try:
                    flow_service.set_cookies(str(req.cookies).strip())
                except Exception as ce:
                    logger.warning(f"Could not switch provider cookies: {ce}")
        if getattr(req, "project_id", None) and str(req.project_id).strip():
            flow_service.active_project_id = str(req.project_id).strip()
        append_log("info", f"T2I generate ×{req.num_images}: {req.prompt[:80]}", source="generate")
        chars = [c.model_dump() for c in (req.characters or [])][:4]
        try:
            assets = flow_service.generate_image(
                prompt=req.prompt,
                aspect_ratio=req.aspect_ratio,
                seed=req.seed,
                num_images=req.num_images,
                model=req.model,
                characters=chars or None,
            )
            append_log("info", f"T2I complete: {len(assets)} asset(s)", source="generate")
            return {"success": True, "assets": assets}
        except Exception as img_err:
            # Do not silently drop character likeness — surface the real failure
            if chars:
                logger.error("Character-driven image generation failed: %s", img_err)
                raise HTTPException(
                    status_code=500,
                    detail=(
                        f"Character image generation failed: {_format_error(img_err)}. "
                        "Ensure the character has a Flow portrait (image_media_id) synced."
                    ),
                )
            raise
    except Exception as e:
        logger.error(f"Image generation endpoint failed: {e}")
        detail = _format_error(e)
        append_log("error", f"T2I failed: {detail}", source="generate")
        raise HTTPException(status_code=500, detail=detail)


@app.post("/api/generate/video")
def generate_video(req: VideoGenerateRequest, request: Request) -> Dict[str, Any]:
    """Initiate Veo 3.1 video generation."""
    _enforce_rate_limit(request)
    _bind_studio_identity(request, getattr(req, "run_id", None))
    try:
        if getattr(req, "cookies", None) and str(req.cookies).strip():
            if str(req.cookies).strip() != (flow_service.cookies or "").strip():
                try:
                    flow_service.set_cookies(str(req.cookies).strip())
                except Exception as ce:
                    logger.warning(f"Could not switch provider cookies: {ce}")
        if getattr(req, "project_id", None) and str(req.project_id).strip():
            flow_service.active_project_id = str(req.project_id).strip()
        append_log("info", f"T2V generate: {req.prompt[:80]}", source="generate")
        wire_preview = flow_service.resolve_wire_model(
            req.model, mode="t2v", duration=req.duration, aspect_ratio=req.aspect_ratio
        )
        append_log("info", f"T2V FE model {req.model} → wire {wire_preview}", source="generate")
        chars = [c.model_dump() for c in (req.characters or [])][:4]
        if chars:
            portrait_ids = []
            for c in chars:
                try:
                    pid = flow_service.resolve_character_portrait_media_id(c)
                    if pid:
                        c["image_media_id"] = pid
                        if pid not in portrait_ids:
                            portrait_ids.append(pid)
                except Exception as mid_err:
                    logger.warning("Character portrait resolve failed: %s", mid_err)
            if not portrait_ids:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Selected character has no Flow portrait media id. "
                        "Re-create the character with an image, or wait until portrait upload finishes."
                    ),
                )
            append_log(
                "info",
                f"T2V characters: {len(chars)} selected, {len(portrait_ids)} portrait(s) resolved",
                source="generate",
            )
            try:
                # Character video uses the SAME UI model mapped to R2V wire key — never force another model
                char_wire = flow_service.resolve_wire_model(
                    req.model, mode="r2v", duration=req.duration, aspect_ratio=req.aspect_ratio
                )
                # Primary start image = first portrait; all portraits go via characters + R2V refs
                asset = flow_service.image_to_video(
                    image_id=portrait_ids[0],
                    prompt=req.prompt,
                    aspect_ratio=req.aspect_ratio,
                    model=req.model,
                    duration=req.duration,
                    characters=chars,
                    voice_presets=req.voice_presets,
                )
                append_log("info", f"T2V (characters) started: {asset.get('id')} model={char_wire} portraits={len(portrait_ids)}", source="generate")
                return {"success": True, "asset": asset}
            except Exception as char_err:
                logger.warning(f"Primary character video failed ({char_err}); trying aisandbox with SAME model")
                try:
                    char_wire = flow_service.resolve_wire_model(
                        req.model, mode="r2v", duration=req.duration, aspect_ratio=req.aspect_ratio
                    )
                    asset = flow_service._image_to_video_aisandbox(
                        image_id=portrait_ids[0],
                        prompt=req.prompt,
                        aspect_ratio=req.aspect_ratio,
                        wire_model=char_wire,
                        duration=req.duration,
                        characters=chars,
                    )
                    append_log("info", f"T2V (characters direct aisandbox) started: {asset.get('id')} model={char_wire} portraits={len(portrait_ids)}", source="generate")
                    return {"success": True, "asset": asset}
                except Exception as as_err:
                    logger.error(f"Character video generation failed: {as_err}")
                    raise HTTPException(status_code=500, detail=_format_error(as_err))
        asset = flow_service.generate_video(
            prompt=req.prompt,
            aspect_ratio=req.aspect_ratio,
            duration=req.duration,
            seed=req.seed,
            model=req.model,
        )
        append_log("info", f"T2V started: {asset.get('id')}", source="generate")
        return {"success": True, "asset": asset}
    except Exception as e:
        logger.error(f"Video generation endpoint failed: {e}")
        detail = _format_error(e)
        append_log("error", f"T2V failed: {detail}", source="generate")
        raise HTTPException(status_code=500, detail=detail)


@app.get("/api/video/status/{asset_id}")
def check_video_status(asset_id: str) -> Dict[str, Any]:
    """Poll video generation operation status."""
    try:
        asset = flow_service.check_video_status(asset_id)
        return {"success": True, "asset": asset}
    except Exception as e:
        raise HTTPException(status_code=404, detail=_format_error(e))


@app.post("/api/video/extend")
def extend_video(req: VideoExtendRequest, request: Request) -> Dict[str, Any]:
    """Extend a video via last-frame extraction → upload → image-to-video (HTTP-first)."""
    _enforce_rate_limit(request)
    _bind_studio_identity(request, getattr(req, "run_id", None))
    try:
        if getattr(req, "cookies", None) and str(req.cookies).strip():
            if str(req.cookies).strip() != (flow_service.cookies or "").strip():
                try:
                    flow_service.set_cookies(str(req.cookies).strip())
                except Exception as ce:
                    logger.warning(f"Could not switch provider cookies: {ce}")
        if getattr(req, "project_id", None) and str(req.project_id).strip():
            flow_service.active_project_id = str(req.project_id).strip()
        append_log(
            "info",
            f"Extend last-frame→I2V: {req.asset_id[:12]}… {req.prompt[:60]}",
            source="generate",
        )
        asset = flow_service.extend_video(req.asset_id, req.prompt, req.model)
        append_log(
            "info",
            f"Extend started: {asset.get('id')} via {asset.get('extend_mode') or asset.get('rpc')}",
            source="generate",
        )
        return {"success": True, "asset": asset}
    except ValueError as ve:
        logger.warning(f"Video extend validation error: {ve}")
        detail = str(ve)
        append_log("warning", f"Extend validation failed: {detail}", source="generate")
        raise HTTPException(status_code=400, detail=detail)
    except RuntimeError as re:
        logger.warning(f"Video extend runtime error: {re}")
        detail = str(re)
        status_code = 400 if ("not found" in detail.lower() or "no playable url" in detail.lower() or "wait until" in detail.lower()) else 500
        append_log("error" if status_code == 500 else "warning", f"Extend failed: {detail}", source="generate")
        raise HTTPException(status_code=status_code, detail=detail)
    except Exception as e:
        logger.error(f"Video extend failed: {e}")
        detail = _format_error(e)
        append_log("error", f"Extend failed: {detail}", source="generate")
        raise HTTPException(status_code=500, detail=detail)


@app.get("/api/video/last-frame/{asset_id}")
@app.post("/api/video/last-frame/{asset_id}")
def extract_video_last_frame(
    asset_id: str,
    req: VideoLastFrameRequest = Body(default_factory=VideoLastFrameRequest),
    url: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """Extract the last frame of a video for continuation / Extend (ffmpeg only — not CDP gen)."""
    try:
        video_url = (req.url or req.video_url or url or "").strip() or None
        append_log("info", f"Extracting last frame from video {asset_id[:12]}…", source="generate")
        res = flow_service.get_last_frame(asset_id, video_url=video_url)
        append_log(
            "info",
            f"Last frame extracted for {asset_id[:12]}… -> Image ID {res.get('image_id')}",
            source="generate",
        )
        return res
    except Exception as e:
        logger.error(f"Last frame extraction failed: {e}")
        detail = _format_error(e)
        append_log("error", f"Last frame extraction failed: {detail}", source="generate")
        raise HTTPException(status_code=500, detail=detail)


@app.post("/api/video/upscale/{asset_id}")
def upscale_video_endpoint(
    asset_id: str,
    request: Request,
    req: VideoUpscaleRequest = Body(default_factory=VideoUpscaleRequest),
) -> Dict[str, Any]:
    """Cloud 1080p upsample is BiB-only — Python CDP/ffmpeg path is disabled."""
    _bind_studio_identity(request, getattr(req, "run_id", None))
    raise HTTPException(
        status_code=410,
        detail=(
            "Python video upscale is disabled. "
            "Use Studio Upscale via BiB Google Flow cloud API (native_cloud_bib)."
        ),
    )


@app.get("/api/video/download/{asset_id}")
def download_video_endpoint(asset_id: str, upscaled: bool = Query(False)) -> Response:
    """Download video in normal (720p) or upscaled (1080p) resolution."""
    try:
        item = next((h for h in flow_service.history if h.get("id") == asset_id), None)
        if not item:
            raise HTTPException(status_code=404, detail="Video asset not found")

        if upscaled:
            if not item.get("upscaled_path") or not Path(item["upscaled_path"]).exists():
                flow_service.upscale_video(asset_id)
                item = next((h for h in flow_service.history if h.get("id") == asset_id), item)

            up_path = item.get("upscaled_path")
            if up_path and Path(up_path).exists():
                name = item.get("name") or asset_id[:8]
                clean_name = re.sub(r'[^a-zA-Z0-9_\- ]+', '', str(name)).strip().replace(' ', '_') or "video"
                return FileResponse(
                    up_path,
                    media_type="video/mp4",
                    filename=f"{clean_name}-1080p.mp4",
                )

        local_path = item.get("local_path") or item.get("path")
        if local_path and Path(local_path).exists():
            name = item.get("name") or asset_id[:8]
            clean_name = re.sub(r'[^a-zA-Z0-9_\- ]+', '', str(name)).strip().replace(' ', '_') or "video"
            return FileResponse(
                local_path,
                media_type="video/mp4",
                filename=f"{clean_name}-720p.mp4",
            )

        video_url = item.get("url")
        if not video_url:
            raise HTTPException(status_code=400, detail="Video has no playable URL")

        return RedirectResponse(video_url)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Download video failed: {e}")
        raise HTTPException(status_code=500, detail=_format_error(e))


@app.get("/api/video/stream/{asset_id}")
def stream_video_endpoint(asset_id: str, upscaled: bool = Query(False)) -> Response:
    """Stream video (normal or 1080p upscaled) for video tag playback."""
    try:
        item = next((h for h in flow_service.history if h.get("id") == asset_id), None)
        if not item:
            raise HTTPException(status_code=404, detail="Video asset not found")

        if upscaled:
            up_path = item.get("upscaled_path")
            if up_path and Path(up_path).exists():
                return FileResponse(up_path, media_type="video/mp4")

        local_path = item.get("local_path") or item.get("path")
        if local_path and Path(local_path).exists():
            return FileResponse(local_path, media_type="video/mp4")

        video_url = item.get("url")
        if video_url:
            return RedirectResponse(video_url)
        raise HTTPException(status_code=400, detail="Video has no playable URL")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stream video failed: {e}")
        raise HTTPException(status_code=500, detail=_format_error(e))


@app.post("/api/generate/image-to-video")
def generate_image_to_video(req: ImageToVideoRequest, request: Request) -> Dict[str, Any]:
    """Animate an image or first/last frames into video using Veo 3.1."""
    _enforce_rate_limit(request)
    _bind_studio_identity(request, getattr(req, "run_id", None))
    try:
        if getattr(req, "cookies", None) and str(req.cookies).strip():
            if str(req.cookies).strip() != (flow_service.cookies or "").strip():
                try:
                    flow_service.set_cookies(str(req.cookies).strip())
                except Exception as ce:
                    logger.warning(f"Could not switch provider cookies: {ce}")
        if getattr(req, "project_id", None) and str(req.project_id).strip():
            flow_service.active_project_id = str(req.project_id).strip()
        append_log("info", f"I2V generate: {req.prompt[:80]}", source="generate")
        image_id = _resolve_image_id(req.image_id, req.staged_id)
        first_frame_id = _resolve_image_id(req.first_frame_id, req.first_frame_staged_id)
        last_frame_id = _resolve_image_id(req.last_frame_id, req.last_frame_staged_id)
        if req.frame_mode == "last_only":
            first_frame_id = None
            image_id = None
        elif not first_frame_id and image_id:
            first_frame_id = image_id
        chars = [flow_service.ensure_character_in_active_project(c.model_dump()) for c in (req.characters or [])][:4]
        if not image_id and not first_frame_id and not last_frame_id and chars:
            for c in chars:
                c_data = flow_service.get_character(c.get("entity_id") or c.get("character_id"))
                if c_data and c_data.get("image_media_id"):
                    image_id = flow_service.ensure_media_in_active_project(c_data["image_media_id"])
                    first_frame_id = image_id
                    break
        if not image_id and not first_frame_id and not last_frame_id and not chars:
            logger.info("No frames or characters provided for I2V, generating standard text-to-video")
            asset = flow_service.generate_video(
                prompt=req.prompt,
                aspect_ratio=req.aspect_ratio,
                model=req.model,
                duration=req.duration,
            )
            return {"success": True, "asset": asset, "uploaded_image_id": None}
        asset = flow_service.image_to_video(
            image_id=image_id,
            prompt=req.prompt,
            aspect_ratio=req.aspect_ratio,
            model=req.model,
            duration=req.duration,
            characters=chars or None,
            voice_presets=req.voice_presets,
            first_frame_id=first_frame_id,
            last_frame_id=last_frame_id,
            frame_mode=req.frame_mode,
        )
        append_log(
            "info",
            f"I2V started: {asset.get('id')} via {asset.get('rpc') or asset.get('model')}",
            source="generate",
        )
        return {"success": True, "asset": asset, "uploaded_image_id": image_id}
    except Exception as e:
        logger.error(f"Image to video failed: {e}")
        detail = _format_error(e)
        append_log("error", f"I2V failed: {detail}", source="generate")
        raise HTTPException(status_code=500, detail=detail)


@app.post("/api/generate/image-to-image")
def generate_image_to_image(req: ImageToImageRequest, request: Request) -> Dict[str, Any]:
    """Generate or edit an image with single or multiple reference inputs."""
    _enforce_rate_limit(request)
    _bind_studio_identity(request, getattr(req, "run_id", None))
    try:
        if getattr(req, "cookies", None) and str(req.cookies).strip():
            if str(req.cookies).strip() != (flow_service.cookies or "").strip():
                try:
                    flow_service.set_cookies(str(req.cookies).strip())
                except Exception as ce:
                    logger.warning(f"Could not switch provider cookies: {ce}")
        if getattr(req, "project_id", None) and str(req.project_id).strip():
            flow_service.active_project_id = str(req.project_id).strip()
        append_log("info", f"I2I generate ×{req.num_images}: {req.prompt[:80]}", source="generate")
        image_id = _resolve_image_id(req.image_id, req.staged_id)
        
        # Resolve multi-image inputs
        resolved_ids = []
        if image_id:
            resolved_ids.append(image_id)
        if req.image_ids:
            for mid in req.image_ids:
                if mid:
                    if mid.startswith("staged-") or mid.startswith("upload-"):
                        rmid = _resolve_image_id(None, mid)
                    else:
                        rmid = mid
                    if rmid and rmid not in resolved_ids:
                        resolved_ids.append(rmid)
        if req.staged_ids:
            for sid in req.staged_ids:
                mid = _resolve_image_id(None, sid)
                if mid and mid not in resolved_ids:
                    resolved_ids.append(mid)

        chars = [flow_service.ensure_character_in_active_project(c.model_dump()) for c in (req.characters or [])]
        if not resolved_ids and not image_id and chars:
            for c in chars:
                c_data = flow_service.get_character(c.get("entity_id") or c.get("character_id"))
                if c_data and c_data.get("image_media_id"):
                    image_id = flow_service.ensure_media_in_active_project(c_data["image_media_id"])
                    resolved_ids.append(image_id)
                    break

        resolved_ids = resolved_ids[:7]
        assets = flow_service.image_to_image(
            image_id=resolved_ids[0] if resolved_ids else image_id,
            prompt=req.prompt,
            aspect_ratio=req.aspect_ratio,
            seed=req.seed,
            model=req.model,
            characters=chars or None,
            destination_character_id=req.destination_character_id,
            num_images=req.num_images,
            image_ids=resolved_ids or None,
        )
        append_log("info", f"I2I complete: {len(assets)} asset(s)", source="generate")
        return {"success": True, "assets": assets, "uploaded_image_id": image_id}
    except Exception as e:
        logger.error(f"Image to image failed: {e}")
        detail = _format_error(e)
        append_log("error", f"I2I failed: {detail}", source="generate")
        raise HTTPException(status_code=500, detail=detail)


@app.get("/api/characters/voices")
def list_character_voices() -> Dict[str, Any]:
    """Return all known Flow / Veo character voice presets (single source of truth)."""
    voices = flow_service.list_character_voices()
    return {"success": True, "voices": voices, "count": len(voices)}


@app.post("/api/characters")
def create_character(req: CharacterCreateRequest) -> Dict[str, Any]:
    """Create a Flow character entity (C4BZMd); optional voice + image refs."""
    try:
        return flow_service.create_character(
            display_name=req.display_name,
            voice_presets=req.voice_presets,
            image_media_id=req.image_media_id,
            image_url=req.image_url,
            local_image_path=req.local_image_path,
            flow_entity_id=req.flow_entity_id,
        )
    except ValueError as ve:
        logger.warning(f"Create character validation failed: {ve}")
        raise HTTPException(status_code=400, detail=str(ve))
    except RuntimeError as re:
        logger.warning(f"Create character failed: {re}")
        detail = str(re)
        status_code = 401 if ("auth" in detail.lower() or "cookie" in detail.lower() or "session" in detail.lower()) else 400
        raise HTTPException(status_code=status_code, detail=detail)
    except Exception as e:
        logger.error(f"Create character failed: {e}")
        raise HTTPException(status_code=500, detail=_format_error(e))


@app.get("/api/characters")
def list_characters(project_id: Optional[str] = None) -> Dict[str, Any]:
    """List locally tracked characters for the active (or given) project."""
    try:
        chars = flow_service.list_characters(project_id=project_id)
        return {
            "success": True,
            "project_id": project_id or flow_service.active_project_id,
            "characters": chars,
        }
    except Exception as e:
        logger.error(f"List characters failed: {e}")
        raise HTTPException(status_code=500, detail=_format_error(e))


@app.patch("/api/characters/{character_id}")
def update_character(character_id: str, req: CharacterUpdateRequest) -> Dict[str, Any]:
    """Rename character, attach voice presets (rzMKMb), and/or store image refs."""
    try:
        return flow_service.update_character(
            character_id,
            display_name=req.display_name,
            voice_presets=req.voice_presets,
            image_media_id=req.image_media_id,
            image_url=req.image_url,
            local_image_path=req.local_image_path,
        )
    except Exception as e:
        logger.error(f"Update character failed: {e}")
        raise HTTPException(status_code=500, detail=_format_error(e))



@app.post("/api/characters/sync")
def sync_characters_route() -> Dict[str, Any]:
    """Synchronize characters with Google Flow and past captures."""
    try:
        res = flow_service.sync_characters()
        append_log("info", f"Character sync completed: {res.get('imported_count', 0)} imported", source="characters")
        return res
    except Exception as e:
        logger.error(f"Character sync failed: {e}")
        raise HTTPException(status_code=500, detail=_format_error(e))


@app.delete("/api/characters/{character_id}")
def delete_character_route(character_id: str) -> Dict[str, Any]:
    """Delete a character entity."""
    deleted = flow_service.delete_character(character_id)
    return {"success": deleted, "character_id": character_id}


@app.post("/api/generate/ingredients")
def generate_ingredients_route(req: IngredientGenerateRequest, request: Request) -> Dict[str, Any]:
    """Generate consistent video or image using multiple assets in Ingredient Mode."""
    _enforce_rate_limit(request)
    _bind_studio_identity(request, getattr(req, "run_id", None))
    try:
        if getattr(req, "cookies", None) and str(req.cookies).strip():
            if str(req.cookies).strip() != (flow_service.cookies or "").strip():
                try:
                    flow_service.set_cookies(str(req.cookies).strip())
                except Exception as ce:
                    logger.warning(f"Could not switch provider cookies: {ce}")
        if getattr(req, "project_id", None) and str(req.project_id).strip():
            flow_service.active_project_id = str(req.project_id).strip()
        append_log("info", f"Ingredient mode ({req.output_type}): {req.prompt[:70]}", source="generate")
        resolved_ids = []
        if req.ingredient_ids:
            for mid in req.ingredient_ids:
                if mid:
                    if mid.startswith("staged-") or mid.startswith("upload-"):
                        rmid = _resolve_image_id(None, mid)
                    else:
                        rmid = _resolve_image_id(mid, None)
                    if rmid and rmid not in resolved_ids:
                        resolved_ids.append(rmid)
        if req.staged_ids:
            for sid in req.staged_ids:
                rmid = _resolve_image_id(None, sid)
                if rmid and rmid not in resolved_ids:
                    resolved_ids.append(rmid)

        chars = [c.model_dump() for c in (req.characters or [])]
        synced_chars = []
        if chars:
            for c in chars:
                sc = flow_service.ensure_character_in_active_project(c)
                synced_chars.append(sc)
                c_data = flow_service.get_character(sc.get("entity_id") or sc.get("character_id"))
                if c_data and c_data.get("image_media_id"):
                    cmid = flow_service.ensure_media_in_active_project(c_data["image_media_id"])
                    if cmid and cmid not in resolved_ids:
                        resolved_ids.append(cmid)
        chars = synced_chars

        resolved_ids = resolved_ids[:3]
        if not resolved_ids and not chars:
            logger.info("No ingredients or characters provided, generating standard video or image")
            if req.output_type == "image":
                asset = flow_service.generate_image(
                    prompt=req.prompt,
                    aspect_ratio=req.aspect_ratio,
                    model=req.model,
                    seed=req.seed,
                )
                return {"success": True, "asset": asset, "ingredients": [], "characters": []}
            else:
                asset = flow_service.generate_video(
                    prompt=req.prompt,
                    aspect_ratio=req.aspect_ratio,
                    model=req.model,
                    duration=req.duration,
                    seed=req.seed,
                )
                return {"success": True, "asset": asset, "ingredients": [], "characters": []}

        result = flow_service.generate_with_ingredients(
            ingredient_ids=resolved_ids,
            prompt=req.prompt,
            output_type=req.output_type,
            aspect_ratio=req.aspect_ratio,
            model=req.model,
            duration=req.duration,
            seed=req.seed,
            characters=chars or None,
        )
        return {"success": True, "asset": result, "ingredients": resolved_ids, "characters": chars}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Ingredient generation failed: {e}")
        detail = _format_error(e)
        append_log("error", f"Ingredient generate failed: {detail}", source="generate")
        raise HTTPException(status_code=500, detail=detail)


# ------------------------------------------------------------------------------
# WHISK: Experimental Creative Laboratory Endpoints
# ------------------------------------------------------------------------------

@app.get("/api/whisk/deck")
def get_whisk_deck_route() -> Dict[str, Any]:
    """Return curated decks for Whisk (Subject, Scene, Style)."""
    deck = flow_service.get_whisk_deck()
    return {"success": True, "deck": deck}


@app.post("/api/whisk/compose")
def whisk_compose_route(req: WhiskComposeRequest) -> Dict[str, Any]:
    """Execute combinatorial image generation in Whisk laboratory using Nano Banana 2."""
    try:
        sub_list = [s.model_dump() for s in (req.subjects or [])]
        scene_list = [s.model_dump() for s in (req.scenes or [])]
        style_list = [s.model_dump() for s in (req.styles or [])]
        refs_list = [s.model_dump() for s in (req.referenced_ingredients or [])]

        append_log("info", f"Whisk composition prompt: {req.custom_prompt}", source="whisk")
        assets = flow_service.whisk_compose(
            subject=req.subject.model_dump() if req.subject else None,
            scene=req.scene.model_dump() if req.scene else None,
            style=req.style.model_dump() if req.style else None,
            subjects=sub_list if sub_list else None,
            scenes=scene_list if scene_list else None,
            styles=style_list if style_list else None,
            referenced_ingredients=refs_list if refs_list else None,
            custom_prompt=req.custom_prompt or "",
            aspect_ratio=req.aspect_ratio or "16:9",
            model=req.model or "NARWHAL",
            num_images=req.num_images or 2,
            seed=req.seed,
        )
        return {"success": True, "assets": assets, "count": len(assets)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Whisk compose failed: {e}")
        detail = _format_error(e)
        append_log("error", f"Whisk compose failed: {detail}", source="whisk")
        raise HTTPException(status_code=500, detail=detail)


@app.post("/api/whisk/caption")
def whisk_caption_route(req: WhiskCaptionRequest) -> Dict[str, Any]:
    """Factual image captioning via Gemini vision for Whisk Refine Loop."""
    try:
        result = flow_service.whisk_caption(
            image_url=req.image_url,
            media_id=req.media_id,
            staged_id=req.staged_id,
            category=req.category,
        )
        return result
    except Exception as e:
        logger.error(f"Whisk caption failed: {e}")
        raise HTTPException(status_code=500, detail=_format_error(e))


@app.post("/api/whisk/variants")
def whisk_variants_route(req: WhiskVariantRequest) -> Dict[str, Any]:
    """Generate ingredient variants with Nano Banana 2 based on refined description."""
    try:
        variants = flow_service.whisk_variants(
            ingredient=req.ingredient.model_dump(),
            caption=req.caption,
            num_variants=req.num_variants,
            model=req.model,
        )
        return {"success": True, "variants": variants, "count": len(variants)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Whisk variants failed: {e}")
        raise HTTPException(status_code=500, detail=_format_error(e))


@app.get("/api/models")
def get_available_models() -> Dict[str, Any]:
    """Return all supported video and image generation models including Pro, Ultra, and Relaxed."""
    return {
        "paygate_tier": flow_service.paygate_tier,
        "video_models": [
            {"key": "VEO_3_1_LITE", "name": "Veo 3.1 - Lite", "tier": "Standard", "desc": "FE Lite → wire lite_low_priority"},
            {"key": "VEO_3_1_FAST", "name": "Veo 3.1 - Fast", "tier": "Pro / Ultra", "desc": "FE Fast → wire lite"},
            {"key": "VEO_3_1_QUALITY", "name": "Veo 3.1 - Quality", "tier": "Pro / Ultra", "desc": "FE Quality → wire fast"},
            {"key": "OMNI_1_1_FLASH", "name": "Omni 1.1 Flash", "tier": "Plus / Pro / Ultra", "desc": "Audio-native video; wire key abra_t2v_{4|6|8|10}s"},
        ],
        "extend_models": [
            {"key": "VEO_3_1_LITE", "name": "Veo 3.1 - Lite", "tier": "Standard", "desc": "FE Lite → R2V lite_low_priority"},
            {"key": "VEO_3_1_FAST", "name": "Veo 3.1 - Fast", "tier": "Pro / Ultra", "desc": "FE Fast → R2V lite"},
            {"key": "VEO_3_1_QUALITY", "name": "Veo 3.1 - Quality", "tier": "Pro / Ultra", "desc": "FE Quality → I2V fast"},
        ],
        "image_to_video_models": [
            {"key": "VEO_3_1_LITE", "name": "Veo 3.1 - Lite", "tier": "Standard", "desc": "FE Lite → r2v_lite_low_priority"},
            {"key": "VEO_3_1_FAST", "name": "Veo 3.1 - Fast", "tier": "Pro / Ultra", "desc": "FE Fast → r2v_lite"},
            {"key": "VEO_3_1_QUALITY", "name": "Veo 3.1 - Quality", "tier": "Pro / Ultra", "desc": "FE Quality → i2v_s_fast"},
            {"key": "OMNI_1_1_FLASH", "name": "Omni 1.1 Flash", "tier": "Plus / Pro / Ultra", "desc": "Omni unchanged"},
        ],
        "image_models": [
            {"key": "GEM_PIX_2", "name": "Nano Banana 2 Pro", "tier": "Standard", "desc": "FE Pro → wire NARWHAL"},
            {"key": "NARWHAL", "name": "Nano Banana 2", "tier": "Standard", "desc": "FE Banana 2 → wire HARBOR_SEAL"},
            {"key": "HARBOR_SEAL", "name": "Nano Banana 2 Lite", "tier": "Standard", "desc": "FE Lite → wire GEM_PIX_2"},
        ]
    }


@app.post("/api/prompt/enhance")
def enhance_prompt(req: PromptEnhanceRequest) -> Dict[str, Any]:
    """Apply Google Flow's 5-component prompt formulation."""
    enhanced = flow_service.enhance_prompt(req.prompt)
    return {"original": req.prompt, "enhanced": enhanced}


# ------------------------------------------------------------------------------
# Google Flow Project Management
# ------------------------------------------------------------------------------

@app.get("/api/projects")
def get_projects(refresh: bool = Query(False, description="Force refresh from Google Flow remote")) -> Dict[str, Any]:
    """Get list of Google Flow projects and current active project."""
    projects = flow_service.get_projects(force_refresh=refresh)
    return {
        "active_project_id": flow_service.active_project_id,
        "active_project_url": project_url(flow_service.active_project_id),
        "projects": projects,
        "count": len(projects),
    }


@app.post("/api/projects/switch")
def switch_project(req: ProjectSwitchRequest) -> Dict[str, Any]:
    """Switch active Google Flow project."""
    try:
        res = flow_service.switch_project(req.project_id)
        return res
    except Exception as e:
        logger.error(f"Switch project failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/projects/create")
@app.post("/api/projects")
def create_project(req: ProjectCreateRequest = ProjectCreateRequest()) -> Dict[str, Any]:
    """Create a new project on Google Flow and set it active."""
    try:
        if req.cookies and str(req.cookies).strip():
            try:
                flow_service.set_cookies(str(req.cookies).strip())
            except Exception as ce:
                logger.warning(f"Could not switch cookies prior to project creation: {ce}")
        res = flow_service.create_project(req.name)
        return res
    except Exception as e:
        logger.error(f"Create project failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ------------------------------------------------------------------------------
# Asset & History Management
# ------------------------------------------------------------------------------

@app.get("/api/assets")
@app.get("/api/history")
def list_assets(type: str = Query("all", description="all, image, or video")) -> Dict[str, Any]:
    """List historical generations."""
    items = flow_service.get_history(filter_type=type)
    return {"assets": items, "history": items, "count": len(items)}


@app.post("/api/assets/stage")
async def stage_asset(file: UploadFile = File(...)) -> Dict[str, Any]:
    """Stage a desktop image locally (data/uploads/) without uploading to Flow.

    Flow upload happens later via /api/assets/upload (staged_id) on Generate.
    """
    try:
        raw = await file.read()
        asset = flow_service.stage_local_image(
            image_bytes=raw,
            filename=file.filename or "upload.png",
            mime_type=file.content_type or "application/octet-stream",
        )
        return {"success": True, "asset": asset}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Asset stage failed: {e}")
        raise HTTPException(status_code=500, detail=_format_error(e))


@app.post("/api/assets/upload")
async def upload_asset(
    file: Optional[UploadFile] = File(None),
    staged_id: Optional[str] = Form(None),
) -> Dict[str, Any]:
    """Upload a desktop image into Flow for use as I2V / I2I reference media.

    Prefer staging first (/api/assets/stage), then pass staged_id here on Generate.
    Direct multipart `file` upload is still supported for callers that need it.
    """
    try:
        sid = (staged_id or "").strip()
        if sid:
            asset = flow_service.upload_staged_reference(sid)
            return {"success": True, "asset": asset}
        if file is None:
            raise HTTPException(
                status_code=400,
                detail="Provide a file or staged_id to upload to Flow",
            )
        raw = await file.read()
        asset = flow_service.upload_reference_image(
            image_bytes=raw,
            filename=file.filename or "upload.png",
            mime_type=file.content_type or "application/octet-stream",
        )
        return {"success": True, "asset": asset}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Asset upload failed: {e}")
        raise HTTPException(status_code=500, detail=_format_error(e))


@app.get("/api/assets/{asset_id}/ready")
def check_asset_ready(asset_id: str) -> Dict[str, Any]:
    """Poll whether a Flow media id is fully ingested and ready for I2V / I2I."""
    try:
        if str(asset_id).startswith("staged-"):
            staged = flow_service.get_staged_image(asset_id)
            return {
                "success": True,
                "id": asset_id,
                "ready": False,
                "status": "STAGED",
                "local_path": staged.get("local_path"),
                "detail": "Staged locally — uploads to Flow on Generate",
            }
        result = flow_service.check_media_ready(asset_id)
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Asset ready check failed: {e}")
        raise HTTPException(status_code=500, detail=_format_error(e))


@app.get("/api/assets/sync")
@app.post("/api/assets/sync")
def sync_assets() -> Dict[str, Any]:
    """Sync and update pending videos and media from Google Flow."""
    try:
        updated = flow_service.sync_all_pending_videos()
        return {"success": True, "assets": updated, "count": len(updated)}
    except Exception as e:
        logger.error(f"Error syncing assets: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/assets/sync-recent-flow")
@app.post("/api/assets/sync-recent-flow")
def sync_recent_flow() -> Dict[str, Any]:
    """Retrieve all recent generations directly from Google Flow project and session captures."""
    try:
        updated = flow_service.sync_flow_generations()
        return {"success": True, "assets": updated, "count": len(updated)}
    except Exception as e:
        logger.error(f"Error retrieving recent Flow generations: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/assets/{asset_id}")
def delete_asset(asset_id: str) -> Dict[str, Any]:
    """Delete an asset from history."""
    deleted = flow_service.delete_asset(asset_id)
    return {"success": deleted}


@app.post("/api/assets/clear")
def clear_all_assets() -> Dict[str, Any]:
    """Clear all assets from history."""
    flow_service.clear_history()
    return {"success": True}


# Exact hostnames (or hostname suffixes for the wildcard entries) allowed to receive
# the Flow session cookie jar via the proxy. Substring matching on the raw URL let
# any attacker-controlled URL containing "google" (e.g. evil.com/google) get cookies.
_PROXY_COOKIE_HOST_ALLOWLIST = {
    "aisandbox-pa.googleapis.com",
    "flow.google.com",
    "labs.google",
    "flow-content.google",
}
_PROXY_COOKIE_HOST_SUFFIXES = (
    ".googleusercontent.com",
)


def _proxy_target_allows_cookies(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    if not host:
        return False
    if host in _PROXY_COOKIE_HOST_ALLOWLIST:
        return True
    return any(host.endswith(suffix) for suffix in _PROXY_COOKIE_HOST_SUFFIXES)


@app.get("/api/assets/proxy")
def proxy_media(url: str = Query(..., description="Target media URL to proxy")):
    """CORS-safe proxy for Google Cloud Storage media streams."""
    try:
        headers = {}
        if flow_service.cookies and _proxy_target_allows_cookies(url):
            headers["Cookie"] = flow_service.cookies

        try:
            req = requests.get(url, headers=headers, stream=True, timeout=30)
            req.raise_for_status()
        except Exception as e:
            err = f"{e}"
            if (
                "407" in err
                or "ProxyError" in err
                or "Tunnel connection failed" in err
                or "Unable to connect to proxy" in err
            ):
                # Dead egress proxy — signed CDN URLs usually work direct.
                # trust_env is a Session attribute, not a requests.get kwarg.
                _sess = requests.Session()
                _sess.trust_env = False
                _sess.proxies = {}
                req = _sess.get(url, headers=headers, stream=True, timeout=30)
                req.raise_for_status()
            else:
                raise
        return StreamingResponse(
            req.iter_content(chunk_size=64 * 1024),
            media_type=req.headers.get("Content-Type", "application/octet-stream"),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Proxy error: {e}")


# ------------------------------------------------------------------------------
# Debug — Flow Capture Extension dumps
# ------------------------------------------------------------------------------

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CAPTURES_DIR = DATA_DIR / "captures"


class CapturesPayload(BaseModel):
    """Flexible envelope from the Google Flow Capture extension (or hand-posted JSON)."""

    exportedAt: Optional[str] = None
    tool: Optional[str] = None
    version: Optional[str] = None
    includeSecrets: Optional[bool] = None
    filterMode: Optional[str] = None
    count: Optional[int] = None
    captures: list = Field(default_factory=list)

    class Config:
        extra = "allow"


@app.post("/api/debug/captures")
def save_debug_captures(payload: CapturesPayload) -> Dict[str, Any]:
    """Persist API captures from the Capture extension for local reverse-engineering."""
    try:
        CAPTURES_DIR.mkdir(parents=True, exist_ok=True)
        stamp = (payload.exportedAt or "").replace(":", "-").replace(".", "-")[:19]
        if not stamp:
            stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
        filename = f"flow-capture-{stamp}.json"
        path = CAPTURES_DIR / filename
        if path.exists():
            filename = f"flow-capture-{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%f')}.json"
            path = CAPTURES_DIR / filename

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        count = len(data.get("captures") or [])
        wiz = flow_service.ingest_capture_wiz_meta(data.get("captures") or [])
        logger.info("Saved %s Flow capture(s) to %s", count, path)
        status = flow_service.get_status().get("batchexecute") or {}
        return {
            "success": True,
            "saved": str(path),
            "path": str(path),
            "count": count,
            "wizMeta": {
                "harvested": bool(wiz),
                "atPrefix": (str(wiz.get("at") or "")[:20] + "…") if wiz else None,
                "bl": (wiz or {}).get("bl"),
                "sidPresent": bool((wiz or {}).get("sid")),
                "preferredBase": (wiz or {}).get("preferred_base"),
                "readyForUpload": bool(status.get("ready_for_upload")),
                "hint": (
                    None
                    if wiz
                    else (
                        "No batchexecute `at` found. Capture on flow.google.com/project/{id} "
                        "with Include secrets ON, then Save to Studio again."
                    )
                ),
            },
        }
    except Exception as e:
        logger.error("Failed to save captures: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/debug/captures")
def list_debug_captures() -> Dict[str, Any]:
    """List saved capture JSON files under data/captures/."""
    CAPTURES_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(CAPTURES_DIR.glob("flow-capture-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    return {
        "success": True,
        "files": [
            {"name": f.name, "path": str(f), "size": f.stat().st_size, "mtime": f.stat().st_mtime}
            for f in files[:50]
        ],
    }


@app.get("/api/logs")
def get_studio_logs(
    limit: int = Query(120, ge=1, le=400),
    level: Optional[str] = Query(None, description="Optional filter: info|warning|error"),
) -> Dict[str, Any]:
    """Return recent studio activity / error log entries (ring buffer)."""
    entries = list_logs(limit=limit, level=level)
    return {"success": True, "logs": entries, "count": len(entries)}


@app.post("/api/logs")
def post_studio_log(req: StudioLogRequest) -> Dict[str, Any]:
    """Append a client-side log entry (used by optimistic submit / UI events)."""
    entry = append_log(req.level, req.message, source=req.source or "ui")
    return {"success": True, "entry": entry}


@app.delete("/api/logs")
def delete_studio_logs() -> Dict[str, Any]:
    """Clear the studio log ring buffer."""
    n = clear_logs()
    append_log("info", "Log buffer cleared", source="ui")
    return {"success": True, "cleared": n}


# ------------------------------------------------------------------------------
# Worker root — API only. Do NOT serve the legacy Studio UI (that bypasses SaaS login).
# Real Studio lives on Next.js :3000. Keep /static mount only if needed for rare local assets;
# never serve frontend index.html from the worker.
# ------------------------------------------------------------------------------

@app.get("/")
def serve_index():
    return Response(
        content=(
            "<!DOCTYPE html><html><head><meta charset='utf-8'/>"
            "<title>Google Flow Worker</title>"
            "<style>body{font-family:system-ui,sans-serif;background:#0b0f14;color:#e2e8f0;"
            "display:grid;place-items:center;min-height:100vh;margin:0}"
            ".card{max-width:28rem;padding:1.5rem 1.75rem;border:1px solid #1f2937;"
            "border-radius:12px;background:#111827}a{color:#93c5fd}</style></head><body>"
            "<div class='card'>"
            "<h1 style='font-size:1.15rem;margin:0 0 .5rem'>Worker API only</h1>"
            "<p style='margin:0 0 .75rem;line-height:1.45;color:#94a3b8'>"
            "Port 8000 is the Python generation worker. It has no SaaS login and no Studio UI."
            "</p>"
            "<p style='margin:0;line-height:1.45'>Open Studio at "
            "<a href='http://127.0.0.1:3000/dashboard/studio'>http://127.0.0.1:3000/dashboard/studio</a>"
            " &nbsp;·&nbsp; API docs: "
            "<a href='/docs'>/docs</a></p>"
            "</div></body></html>"
        ),
        media_type="text/html",
    )
