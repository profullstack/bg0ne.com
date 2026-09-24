"""
The model, behind the smallest HTTP surface that will do.

Why this is a separate process at all: every good open background-removal model is
Python and ships as ONNX, and the web app is Bun. Rather than fight a native addon
into a JS runtime, the model gets its own process in the same container and answers
on loopback. INFER_URL is what makes that a deployment decision instead of an
architectural one -- point it at a GPU box and nothing else changes.

Licensing is not incidental here. Every model named below is permissively licensed
(BiRefNet MIT, U-2-Net Apache-2.0) because this service is billed for. BRIA's RMBG
is the obvious better-known choice and is deliberately absent: its weights are
CC BY-NC and commercial use needs a paid agreement with BRIA.
"""

import io
import logging
import os
import threading
import time

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image
from rembg import new_session, remove

logging.basicConfig(level=logging.INFO, format="[infer] %(message)s")
log = logging.getLogger("infer")

# Only these. An arbitrary model name from the request would let a caller pull an
# unvetted set of weights onto the box at runtime, and would quietly reintroduce the
# non-commercial ones this service exists to avoid.
ALLOWED_MODELS = {
    "u2net": "U-2-Net, Apache-2.0. The one that survives a CPU-only container.",
    "u2netp": "U-2-Net lite, Apache-2.0. Faster, visibly rougher on hair.",
    "u2net_human_seg": "U-2-Net human segmentation, Apache-2.0.",
    "isnet-general-use": "ISNet/DIS, Apache-2.0.",
    "birefnet-general-lite": "BiRefNet lite, MIT. The paid tier: BiRefNet edges, bakeable size.",
    "birefnet-general": "BiRefNet full, MIT. Best edges, ~1GB, wants a GPU.",
    "birefnet-portrait": "BiRefNet portrait, MIT.",
}

# Deliberately NOT here, though rembg offers it: "bria-rmbg". Its weights are
# CC BY-NC 4.0 and commercial use needs a paid agreement with BRIA. This service is
# billed for, so the allowlist is what keeps a non-commercial model from being reached
# by a caller simply naming it.

MAX_BYTES = int(os.environ.get("INFER_MAX_BYTES", 25 * 1024 * 1024))
MAX_EDGE = int(os.environ.get("INFER_MAX_EDGE", 4096))

app = FastAPI(title="bg0ne infer", docs_url=None, redoc_url=None)

# One session per model, built once and reused. `new_session` loads and warms the
# weights, which is seconds of work -- doing it per request is the difference between
# a slow endpoint and an unusable one.
_sessions: dict[str, object] = {}
_sessions_lock = threading.Lock()

# ONNX Runtime sessions are not safe to drive concurrently from several threads, and
# two large images at once is also the fastest way to hit the container memory cap.
# Requests queue here instead of racing.
_infer_lock = threading.Lock()


def get_session(model: str):
    with _sessions_lock:
        if model not in _sessions:
            log.info("loading model %s", model)
            started = time.monotonic()
            _sessions[model] = new_session(model)
            log.info("loaded %s in %.1fs", model, time.monotonic() - started)
        return _sessions[model]


@app.on_event("startup")
def warm() -> None:
    """
    Load the default model before the first request rather than during it.

    Railway's healthcheck is what decides whether a deploy succeeded. A container that
    accepts connections but then spends forty seconds loading weights inside the first
    real request looks healthy and serves a timeout, which is the worst of both.
    """
    default = os.environ.get("INFER_MODEL", "u2net")
    if default in ALLOWED_MODELS:
        try:
            get_session(default)
        except Exception:  # noqa: BLE001 - a cold model must not stop the process booting
            log.exception("could not warm %s; it will load on first use", default)


@app.get("/healthz")
def healthz() -> Response:
    return Response("ok", media_type="text/plain")


@app.get("/models")
def models() -> JSONResponse:
    return JSONResponse({"models": ALLOWED_MODELS, "loaded": sorted(_sessions)})


@app.post("/cutout")
async def cutout(
    file: UploadFile = File(...),
    model: str = Form("u2net"),
    max_edge: int = Form(0),
) -> Response:
    if model not in ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail=f"unknown model {model!r}")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty upload")
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"image over {MAX_BYTES} bytes")

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:  # noqa: BLE001 - anything unreadable is the caller's problem
        raise HTTPException(status_code=400, detail=f"not a readable image: {exc}") from exc

    # EXIF orientation is applied here, not in the browser. A phone photo that is
    # rotated only by its EXIF tag comes back cut out correctly but sideways, and the
    # bug reads as "the model is broken" rather than "the metadata was dropped".
    try:
        from PIL import ImageOps

        image = ImageOps.exif_transpose(image)
    except Exception:  # noqa: BLE001
        pass

    image = image.convert("RGBA")
    source_w, source_h = image.size

    limit = max_edge if max_edge > 0 else MAX_EDGE
    limit = min(limit, MAX_EDGE)
    if max(image.size) > limit:
        ratio = limit / max(image.size)
        image = image.resize((max(1, int(image.width * ratio)), max(1, int(image.height * ratio))), Image.LANCZOS)

    started = time.monotonic()
    with _infer_lock:
        session = get_session(model)
        result = remove(image, session=session)
    duration_ms = int((time.monotonic() - started) * 1000)

    out = io.BytesIO()
    result.save(out, format="PNG", optimize=True)
    body = out.getvalue()

    log.info(
        "cutout model=%s in=%dx%d out=%dx%d %dms %dkb",
        model, source_w, source_h, result.width, result.height, duration_ms, len(body) // 1024,
    )

    return Response(
        content=body,
        media_type="image/png",
        headers={
            "x-cutout-ms": str(duration_ms),
            "x-cutout-model": model,
            "x-cutout-width": str(result.width),
            "x-cutout-height": str(result.height),
            "x-source-width": str(source_w),
            "x-source-height": str(source_h),
        },
    )
