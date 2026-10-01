"""
Claude (via Google Vertex AI) integration for AI design critique.

The geometric engine in `floorplan.py` is deterministic and key-free; this
module layers a real LLM critique on top of a generated plan. It is entirely
optional: when Vertex is not configured (no ANTHROPIC_VERTEX_PROJECT_ID), every
entry point returns None so callers transparently fall back to the deterministic
tips.

Vertex does not support Anthropic server-side tools / managed agents, but the
plain Messages API used here works fully. The async client matches the FastAPI
event loop.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

# Severities the frontend already understands (see /ai/suggestions).
_VALID_SEVERITIES = {"good", "warn", "info", "error"}

_SYSTEM = (
    "You are a senior residential architect reviewing a machine-generated 2D "
    "floor plan for an Indian home. You are given the plan's summary, the rooms "
    "on each floor (with dimensions in metres), the Vastu compliance score, and "
    "any automated validation errors. Give concise, practical, professional "
    "design feedback: circulation, room proportions, natural light, privacy "
    "zoning, Vastu trade-offs, and anything that would bother a real homeowner. "
    "Be specific and reference rooms by name. Do not restate the inputs.\n\n"
    "Respond with ONLY a JSON array (no prose, no code fences). Each element is "
    '{"kind": string, "severity": one of "good"|"warn"|"info"|"error", '
    '"message": string}. Return 3-6 of the most valuable observations.'
)


@lru_cache
def _client():
    """Lazily build a singleton async Vertex client. Cached across requests."""
    from anthropic import AsyncAnthropicVertex

    return AsyncAnthropicVertex(
        project_id=settings.ANTHROPIC_VERTEX_PROJECT_ID,
        region=settings.ANTHROPIC_VERTEX_REGION,
    )


def _digest(plan: dict[str, Any], req: dict[str, Any]) -> dict[str, Any]:
    """Compact, token-light view of the plan for the model (drops geometry)."""
    floors = []
    for f in plan.get("floors", []):
        floors.append({
            "name": f["name"],
            "vastuScore": f["metrics"]["vastuScore"],
            "rooms": [
                {
                    "label": r["label"],
                    "type": r["type"],
                    "w": round(r["w"], 2),
                    "h": round(r["h"], 2),
                }
                for r in f["rooms"]
            ],
        })
    return {
        "requirements": {
            "bedrooms": req.get("bedrooms"),
            "bathrooms": req.get("bathrooms"),
            "floors": req.get("floors"),
            "facing": req.get("facing"),
            "vastu": req.get("vastu"),
            "plotWidth": req.get("plotWidth"),
            "plotDepth": req.get("plotDepth"),
        },
        "summary": plan.get("summary", {}),
        "validation": plan.get("validation", {}),
        "floors": floors,
    }


def _coerce_tips(raw: str) -> list[dict]:
    """Parse the model's JSON array defensively; never raise."""
    text = raw.strip()
    if text.startswith("```"):
        # Strip an accidental code fence.
        text = text.split("```", 2)[1].lstrip("json").strip() if "```" in text else text
    try:
        data = json.loads(text)
    except (ValueError, IndexError):
        # Last resort: surface the prose as a single info tip rather than nothing.
        return [{"kind": "ai", "severity": "info", "message": raw.strip()[:500]}] if raw.strip() else []

    if not isinstance(data, list):
        return []

    tips: list[dict] = []
    for item in data:
        if not isinstance(item, dict) or "message" not in item:
            continue
        sev = item.get("severity", "info")
        tips.append({
            "kind": str(item.get("kind", "ai")),
            "severity": sev if sev in _VALID_SEVERITIES else "info",
            "message": str(item["message"]),
        })
    return tips


async def critique_plan(plan: dict[str, Any], req: dict[str, Any]) -> list[dict] | None:
    """Return AI design tips for a generated plan, or None if unavailable.

    Never raises: any configuration or API failure logs and returns None so the
    caller can fall back to deterministic suggestions.
    """
    if not settings.ai_enabled:
        return None

    try:
        message = await _client().messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=settings.CLAUDE_MAX_TOKENS,
            system=_SYSTEM,
            messages=[{
                "role": "user",
                "content": json.dumps(_digest(plan, req), separators=(",", ":")),
            }],
        )
    except Exception:  # noqa: BLE001 - degrade gracefully on any client/API error
        logger.exception("Vertex critique failed; falling back to deterministic tips")
        return None

    text = "".join(b.text for b in message.content if getattr(b, "type", None) == "text")
    return _coerce_tips(text)
