from __future__ import annotations

import json
from typing import Any, Dict


EDITOR_ROLE_NAME = "market_editor"
CRITIC_ROLE_NAME = "market_critic"
MARKET_EDITORIAL_VERSION = "market_editorial_v1"


def build_editor_system_prompt() -> str:
    return (
        "You are CueIdea's market-editor. "
        "Your job is to turn noisy but real market evidence into a clean startup opportunity card. "
        "Use only the supplied evidence packet. Never invent demand, buyers, pricing, sources, or certainty. "
        "Write in plain English for founders. Avoid jargon like wedge, signal, cluster, pipeline, or board readiness. "
        "The title must feel like a product angle, not a subreddit bucket or source label. "
        "The summary must explain the pain, who feels it, and why it matters. "
        "If evidence is thin, be cautious rather than promotional. "
        "Output JSON only."
    )


def build_critic_system_prompt() -> str:
    return (
        "You are CueIdea's market-critic. "
        "You verify whether an edited opportunity card is truly grounded in the supplied evidence. "
        "Reject anything generic, over-broad, hallucinated, malformed, source-bucket-like, or too weak to be useful. "
        "Mark duplicates when the idea substantially overlaps an existing public opportunity from the shortlist. "
        "Use public for clear founder-useful opportunities with repeated pain, especially when they have cross-source proof or multiple evidence posts, even if willingness to pay is not proven yet. "
        "Use needs_more_proof for specific early opportunities that look real but still need stronger confirmation. "
        "Use internal only when the card is misleading, too generic, misclustered, or not useful enough to browse. "
        "If the editor is mostly right but wording needs tightening, return tightened_title or tightened_summary. "
        "Output JSON only."
    )


def build_editor_user_message(packet: Dict[str, Any]) -> str:
    return json.dumps({
        "task": "Rewrite this evidence packet into a public-ready opportunity card.",
        "rules": [
            "Use only the supplied evidence.",
            "Do not claim willingness to pay unless the evidence packet supports it.",
            "Do not mention internal system terms.",
            "Keep the title concrete and human-readable.",
            "Keep the summary concise and specific.",
        ],
        "packet": packet,
    }, ensure_ascii=False)


def build_critic_user_message(packet: Dict[str, Any], editor_output: Dict[str, Any]) -> str:
    return json.dumps({
        "task": "Audit this edited opportunity card for public-market quality.",
        "rules": [
            "Reject hallucinated buyer claims.",
            "Reject generic filler and source-bucket titles.",
            "Reject weak mono-source opportunities phrased as strong proof.",
            "Do not require explicit willingness to pay for public visibility if the pain is repeated and specific.",
            "Prefer needs_more_proof instead of internal when the card is specific and founder-useful but still early.",
            "Use duplicate when the card overlaps an existing public opportunity in the shortlist.",
            "Tighten the title or summary only if a small wording fix is enough.",
        ],
        "packet": packet,
        "editor_output": editor_output,
    }, ensure_ascii=False)
