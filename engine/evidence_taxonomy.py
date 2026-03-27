"""
Shared evidence taxonomy for RedditPulse.

This keeps Market and Validation aligned on what a source is,
whose voice it represents, and whether it should count as
problem proof or only business/supporting evidence.
"""

from __future__ import annotations

import re
from collections import Counter


SOURCE_RELIABILITY = {
    "reddit": "stable",
    "reddit_comment": "stable",
    "hackernews": "stable",
    "producthunt": "moderate",
    "indiehackers": "moderate",
    "stackoverflow": "stable",
    "githubissues": "stable",
    "github_discussion": "moderate",
    "g2_review": "moderate",
    "job_posting": "stable",
    "vendor_blog": "moderate",
    "marketplace_review": "moderate",
    "trustradius_review": "fragile",
    "capterra_review": "fragile",
    "getapp_review": "fragile",
    "feedback_board": "moderate",
    "trend_tool": "fragile",
}

PAIN_HINTS = [
    "hate", "frustrated", "struggling", "issue", "problem", "broken",
    "slow", "expensive", "annoying", "manual", "tedious", "waste",
    "hours", "tired of", "sick of", "need help", "looking for",
    "alternative", "can't", "cannot", "won't", "late", "overdue",
    "unpaid", "chasing", "follow up", "follow-up", "receipt", "receipts",
]

WTP_HINTS = [
    "i'd pay", "i would pay", "take my money", "budget", "$", "per month",
    "per seat", "pricing", "price", "worth paying", "pay for",
]

WORKAROUND_HINTS = [
    "workaround", "spreadsheet", "copy paste", "copy-paste", "manual process",
    "hacky", "hack", "glue together", "stitched together", "excel",
]

FEATURE_REQUEST_HINTS = [
    "feature request", "wish there was", "would love", "can you add",
    "missing feature", "need a tool", "need software", "looking for a tool",
    "recommendation", "recommendations",
]

BUYER_VOICE_SOURCES = {
    "reddit", "reddit_comment", "g2_review", "trustradius_review",
    "capterra_review", "getapp_review", "marketplace_review", "feedback_board",
}

BUSINESS_SUPPORT_SOURCES = {
    "job_posting", "vendor_blog", "trend_tool",
}

DEV_SOURCES = {"stackoverflow", "githubissues", "github_discussion"}


def canonical_source_name(raw_source: str | None) -> str:
    source = str(raw_source or "").strip().lower()
    if source.startswith("reddit_comment"):
        return "reddit_comment"
    if source.startswith("reddit") or source.startswith("pullpush") or source.startswith("pushshift"):
        return "reddit"
    if source.startswith("hackernews") or source == "hn":
        return "hackernews"
    if source.startswith("producthunt"):
        return "producthunt"
    if source.startswith("indiehackers"):
        return "indiehackers"
    if source.startswith("stack"):
        return "stackoverflow"
    if source.startswith("github_discussion"):
        return "github_discussion"
    if source.startswith("github"):
        return "githubissues"
    if source.startswith("g2"):
        return "g2_review"
    if source.startswith("job") or source.startswith("adzuna") or source.endswith("_job"):
        return "job_posting"
    if source.startswith("vendor"):
        return "vendor_blog"
    if "trustradius" in source:
        return "trustradius_review"
    if "capterra" in source:
        return "capterra_review"
    if "getapp" in source:
        return "getapp_review"
    if "marketplace" in source or "appstore" in source or "app_store" in source:
        return "marketplace_review"
    if "canny" in source or "uservoice" in source:
        return "feedback_board"
    if "similarweb" in source or "exploding" in source or "trend" in source:
        return "trend_tool"
    return source or "unknown"


def infer_source_class(source_name: str, subreddit: str = "") -> str:
    source = canonical_source_name(source_name)
    subreddit_l = str(subreddit or "").lower()
    if source in {"reddit", "reddit_comment", "hackernews", "producthunt", "indiehackers"}:
        if source == "reddit" and any(token in subreddit_l for token in ("github", "programming", "webdev", "devops")):
            return "dev-community"
        return "community"
    if source in {"g2_review", "trustradius_review", "capterra_review", "getapp_review"}:
        return "review"
    if source == "marketplace_review":
        return "marketplace"
    if source == "job_posting":
        return "jobs"
    if source == "vendor_blog":
        return "vendor"
    if source == "feedback_board":
        return "forum"
    if source == "trend_tool":
        return "trend"
    if source in DEV_SOURCES:
        return "dev-community"
    return "community"


def infer_voice_type(source_name: str, source_class: str, subreddit: str = "") -> str:
    source = canonical_source_name(source_name)
    subreddit_l = str(subreddit or "").lower()
    if source in {"reddit", "reddit_comment"}:
        if any(token in subreddit_l for token in ("programming", "webdev", "devops", "machinelearning", "openai")):
            return "developer"
        return "buyer"
    if source in {"g2_review", "trustradius_review", "capterra_review", "getapp_review", "marketplace_review", "feedback_board"}:
        return "buyer"
    if source == "job_posting":
        return "operator"
    if source == "vendor_blog":
        return "vendor"
    if source in {"producthunt", "indiehackers", "hackernews"}:
        return "founder"
    if source in DEV_SOURCES:
        return "developer"
    if source_class == "trend":
        return "aggregator"
    return "buyer"


def infer_signal_kind(item: dict, source_name: str) -> str:
    source = canonical_source_name(source_name)
    text = " ".join(
        str(item.get(key) or "")
        for key in ("title", "post_title", "selftext", "body", "full_text", "what_it_proves")
    ).lower()
    if source == "job_posting":
        return "job_requirement"
    if source in {"g2_review", "trustradius_review", "capterra_review", "getapp_review", "marketplace_review"}:
        return "review_complaint"
    if source in {"producthunt", "indiehackers"}:
        return "launch_discussion"
    if any(hint in text for hint in WTP_HINTS):
        return "willingness_to_pay"
    if any(hint in text for hint in FEATURE_REQUEST_HINTS):
        return "feature_request"
    if any(hint in text for hint in WORKAROUND_HINTS):
        return "workaround"
    if any(hint in text for hint in PAIN_HINTS):
        return "complaint"
    return "complaint"


def infer_reliability_tier(source_name: str) -> str:
    return SOURCE_RELIABILITY.get(canonical_source_name(source_name), "moderate")


def infer_directness_tier(item: dict, source_name: str, source_class: str, voice_type: str, forced_subreddits=None) -> str:
    source = canonical_source_name(source_name)
    text = " ".join(
        str(item.get(key) or "")
        for key in ("title", "post_title", "selftext", "body", "full_text", "what_it_proves")
    ).lower()
    subreddit = str(item.get("subreddit") or "").strip().lower().replace("r/", "").replace("/r/", "")
    forced = {
        str(sub).strip().lower().replace("r/", "").replace("/r/", "")
        for sub in (forced_subreddits or [])
        if str(sub).strip()
    }

    if source in BUSINESS_SUPPORT_SOURCES or source_class in {"vendor", "trend"}:
        return "supporting"

    pain_hits = sum(1 for hint in PAIN_HINTS if hint in text)
    wtp_hits = sum(1 for hint in WTP_HINTS if hint in text)
    workaround_hits = sum(1 for hint in WORKAROUND_HINTS if hint in text)
    direct_signal = pain_hits + wtp_hits + workaround_hits

    if source in {"g2_review", "trustradius_review", "capterra_review", "getapp_review", "marketplace_review"}:
        return "direct" if direct_signal > 0 else "adjacent"

    if source in {"reddit", "reddit_comment"}:
        if subreddit and subreddit in forced and direct_signal > 0:
            return "direct"
        if direct_signal >= 2:
            return "direct"
        return "adjacent" if direct_signal >= 1 else "supporting"

    if voice_type == "developer":
        return "direct" if direct_signal >= 1 else "adjacent"

    if voice_type in {"founder", "operator"}:
        return "adjacent" if direct_signal >= 1 else "supporting"

    return "adjacent" if direct_signal >= 1 else "supporting"


def infer_evidence_layer(source_class: str, directness_tier: str, voice_type: str) -> str:
    if directness_tier == "supporting":
        return "business"
    if voice_type == "buyer":
        return "problem"
    if source_class in {"review", "forum"}:
        return "problem"
    if source_class in {"jobs", "vendor", "trend", "marketplace"}:
        return "business"
    return "problem" if directness_tier == "direct" else "supporting"


def build_evidence_taxonomy(
    item: dict | None,
    *,
    icp_category: str = "",
    forced_subreddits=None,
    override_directness: str | None = None,
) -> dict:
    raw = dict(item or {})
    source_name = canonical_source_name(raw.get("source"))
    source_class = infer_source_class(source_name, raw.get("subreddit", ""))
    voice_type = infer_voice_type(source_name, source_class, raw.get("subreddit", ""))
    signal_kind = infer_signal_kind(raw, source_name)
    directness_tier = override_directness or infer_directness_tier(
        raw,
        source_name,
        source_class,
        voice_type,
        forced_subreddits=forced_subreddits,
    )
    evidence_layer = infer_evidence_layer(source_class, directness_tier, voice_type)
    reliability_tier = infer_reliability_tier(source_name)

    return {
        "source_class": source_class,
        "source_name": source_name,
        "voice_type": voice_type,
        "signal_kind": signal_kind,
        "evidence_layer": evidence_layer,
        "directness_tier": directness_tier,
        "icp_scope": [icp_category] if icp_category else [],
        "reliability_tier": reliability_tier,
    }


def apply_evidence_taxonomy(
    item: dict | None,
    *,
    icp_category: str = "",
    forced_subreddits=None,
    override_directness: str | None = None,
) -> dict:
    merged = dict(item or {})
    taxonomy = build_evidence_taxonomy(
        merged,
        icp_category=icp_category,
        forced_subreddits=forced_subreddits,
        override_directness=override_directness,
    )
    merged.update(taxonomy)
    merged["evidence_meta"] = taxonomy
    return merged


def summarize_taxonomy(items: list[dict] | None) -> dict:
    source_class_counts = Counter()
    layer_counts = Counter()
    directness_counts = Counter()
    source_name_counts = Counter()

    for item in items or []:
        meta = dict(item.get("evidence_meta") or {})
        source_class = str(item.get("source_class") or meta.get("source_class") or "")
        layer = str(item.get("evidence_layer") or meta.get("evidence_layer") or "")
        directness = str(item.get("directness_tier") or meta.get("directness_tier") or "")
        source_name = str(item.get("source_name") or meta.get("source_name") or item.get("source") or "")
        if source_class:
            source_class_counts[source_class] += 1
        if layer:
            layer_counts[layer] += 1
        if directness:
            directness_counts[directness] += 1
        if source_name:
            source_name_counts[source_name] += 1

    return {
        "source_classes": dict(source_class_counts),
        "evidence_layers": dict(layer_counts),
        "directness_tiers": dict(directness_counts),
        "source_names": dict(source_name_counts),
    }

