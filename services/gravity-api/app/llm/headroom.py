"""
Headroom compression — shrink verbose LLM contexts before generation.

Runs the Headroom SmartCrusher IN-PROCESS (the `headroom-ai` library) to crush
redundant tool-result / JSON-array context (RAG chunks, tool outputs) while
preserving the user prompt. Provider-agnostic: compresses the message list
before it reaches any SDK (DeepSeek / Gemini / Anthropic).

NOTE: the headroom *proxy* (headroom-proxy.fly.dev) compression is an
unimplemented no-op at v0.27.0 (per-type compressors round-trip byte-equal).
The library `compress()` is the implemented path, so we call it directly here.

SmartCrusher only crushes tool/JSON-array content above min_tokens_to_crush
(~200) and caps items (max_items_after_crush). Plain concatenated RAG text in a
user/system message is NOT compressed (left byte-equal) — to benefit there the
caller must pass retrieved chunks as a `role: tool` JSON array.

Gated by HEADROOM_ENABLED=true. Fails open: any error returns the original
messages unchanged, so a compression bug never breaks generation.

Env:
  HEADROOM_ENABLED      "true" to turn on (default off)
  HEADROOM_MIN_TOKENS   skip compression below this size (default 1500)
"""
from __future__ import annotations

import asyncio
import os
from typing import TYPE_CHECKING

import structlog

if TYPE_CHECKING:
    from app.llm.base import LLMMessage

logger = structlog.get_logger()


def _enabled() -> bool:
    return os.getenv("HEADROOM_ENABLED", "").lower() == "true"


def _rough_token_count(messages: list["LLMMessage"]) -> int:
    # ~4 chars/token heuristic; only used to decide whether to bother calling.
    chars = sum(len(m.content or "") for m in messages)
    return chars // 4


def _compress_sync(payload: list[dict], model: str) -> dict | None:
    """Blocking in-process compress; returns the raw result dict or None."""
    from headroom import compress  # local import: optional dep, keep cold path cheap

    result = compress(payload, model=model)
    return {
        "messages": result.messages,
        "tokens_before": getattr(result, "tokens_before", None),
        "tokens_after": getattr(result, "tokens_after", None),
        "transforms": list(getattr(result, "transforms_applied", []) or []),
    }


async def compress_messages(
    messages: list["LLMMessage"],
    model: str,
) -> list["LLMMessage"]:
    """
    Compress a message list via the in-process Headroom SmartCrusher. Returns
    compressed messages, or the originals unchanged on any failure / when
    disabled / when small.
    """
    if not _enabled() or not messages:
        return messages

    min_tokens = int(os.getenv("HEADROOM_MIN_TOKENS", "1500"))
    if _rough_token_count(messages) < min_tokens:
        return messages

    from app.llm.base import LLMMessage  # local import to avoid cycle

    payload = [{"role": m.role, "content": m.content} for m in messages]
    try:
        # SmartCrusher is a CPU-bound Rust call — run off the event loop.
        data = await asyncio.to_thread(_compress_sync, payload, model)
    except Exception as e:
        logger.warning("headroom_compress_failed", error=str(e))
        return messages

    if not data:
        return messages

    out = data.get("messages")
    if not isinstance(out, list) or not out or len(out) != len(messages):
        # Defensive: never let compression change the message count.
        return messages

    before = data.get("tokens_before")
    after = data.get("tokens_after")
    if isinstance(before, int) and isinstance(after, int) and after < before:
        logger.info(
            "headroom_compressed",
            tokens_before=before,
            tokens_after=after,
            saved=before - after,
            transforms=data.get("transforms"),
            model=model,
        )

    return [
        LLMMessage(role=m.get("role", "user"), content=m.get("content", "") or "")
        for m in out
    ]
