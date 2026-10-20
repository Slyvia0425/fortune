"""Only the Next server may save model-produced confirmation candidates."""

import hashlib
import hmac
import os
import time
from pathlib import Path

from fastapi import HTTPException, Request


def internal_secret():
    secret = os.environ.get("DIVINATION_INTERNAL_SECRET")
    if not secret:
        path = Path(__file__).resolve().parents[4] / ".runtime/divination-internal.key"
        try:
            secret = path.read_text().strip()
        except OSError as exc:
            raise HTTPException(503, "Confirmation bridge is not configured") from exc
    if len(secret) < 32:
        raise HTTPException(503, "Confirmation bridge key is invalid")
    return secret


async def require_dialogue_server(request: Request):
    timestamp = request.headers.get("X-Divination-Timestamp", "")
    signature = request.headers.get("X-Divination-Signature", "")
    try:
        fresh = abs(time.time() - int(timestamp)) <= 60
    except ValueError:
        fresh = False
    if not fresh or len(signature) != 64:
        raise HTTPException(403, "Only the dialogue server may save a candidate")
    identity = request.headers.get("Authorization") or request.headers.get(
        "X-Anonymous-Session", ""
    )
    path = request.url.path.rsplit("/", 1)[-1]
    body = (await request.body()).decode("utf-8")
    signed = f"{path}\n{timestamp}\n{identity}\n{body}".encode()
    expected = hmac.new(internal_secret().encode(), signed, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(403, "Invalid dialogue server signature")
