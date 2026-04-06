from __future__ import annotations

from typing import Any, Dict


EDITOR_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "edited_title": {"type": "string"},
        "edited_summary": {"type": "string"},
        "pain_statement": {"type": "string"},
        "ideal_buyer": {"type": "string"},
        "product_angle": {"type": "string"},
        "verdict": {"type": "string"},
        "next_step": {"type": "string"},
    },
    "required": [
        "edited_title",
        "edited_summary",
        "pain_statement",
        "ideal_buyer",
        "product_angle",
        "verdict",
        "next_step",
    ],
}


CRITIC_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "visibility_decision": {
            "type": "string",
            "enum": ["public", "internal", "duplicate", "needs_more_proof"],
        },
        "duplicate_of_slug": {
            "anyOf": [
                {"type": "string"},
                {"type": "null"},
            ],
        },
        "quality_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "grounding_confidence": {"type": "integer", "minimum": 0, "maximum": 100},
        "critic_reasons": {
            "type": "array",
            "items": {"type": "string"},
        },
        "tightened_title": {
            "anyOf": [
                {"type": "string"},
                {"type": "null"},
            ],
        },
        "tightened_summary": {
            "anyOf": [
                {"type": "string"},
                {"type": "null"},
            ],
        },
    },
    "required": [
        "visibility_decision",
        "duplicate_of_slug",
        "quality_score",
        "grounding_confidence",
        "critic_reasons",
        "tightened_title",
        "tightened_summary",
    ],
}


def _clean_text(value: Any, *, max_length: int) -> str:
    return " ".join(str(value or "").strip().split())[:max_length]


def validate_editor_output(payload: Any) -> Dict[str, str]:
    if not isinstance(payload, dict):
        raise ValueError("Editor output must be an object")

    normalized = {
        "edited_title": _clean_text(payload.get("edited_title"), max_length=120),
        "edited_summary": _clean_text(payload.get("edited_summary"), max_length=320),
        "pain_statement": _clean_text(payload.get("pain_statement"), max_length=220),
        "ideal_buyer": _clean_text(payload.get("ideal_buyer"), max_length=160),
        "product_angle": _clean_text(payload.get("product_angle"), max_length=180),
        "verdict": _clean_text(payload.get("verdict"), max_length=140),
        "next_step": _clean_text(payload.get("next_step"), max_length=220),
    }

    for key, value in normalized.items():
        if not value:
            raise ValueError(f"Editor output missing {key}")

    return normalized


def validate_critic_output(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Critic output must be an object")

    visibility = _clean_text(payload.get("visibility_decision"), max_length=40).lower()
    if visibility not in {"public", "internal", "duplicate", "needs_more_proof"}:
        raise ValueError("Critic output has invalid visibility_decision")

    quality_score = int(payload.get("quality_score", 0) or 0)
    grounding_confidence = int(payload.get("grounding_confidence", 0) or 0)
    if quality_score < 0 or quality_score > 100:
        raise ValueError("Critic quality_score must be between 0 and 100")
    if grounding_confidence < 0 or grounding_confidence > 100:
        raise ValueError("Critic grounding_confidence must be between 0 and 100")

    reasons = payload.get("critic_reasons")
    if not isinstance(reasons, list) or not reasons:
        raise ValueError("Critic output requires critic_reasons")

    normalized_reasons = []
    for reason in reasons[:6]:
        clean = _clean_text(reason, max_length=200)
        if clean:
            normalized_reasons.append(clean)
    if not normalized_reasons:
        raise ValueError("Critic output critic_reasons cannot be empty")

    duplicate_of_slug = _clean_text(payload.get("duplicate_of_slug"), max_length=120) or None
    tightened_title = _clean_text(payload.get("tightened_title"), max_length=120) or None
    tightened_summary = _clean_text(payload.get("tightened_summary"), max_length=320) or None

    return {
        "visibility_decision": visibility,
        "duplicate_of_slug": duplicate_of_slug,
        "quality_score": quality_score,
        "grounding_confidence": grounding_confidence,
        "critic_reasons": normalized_reasons,
        "tightened_title": tightened_title,
        "tightened_summary": tightened_summary,
    }
