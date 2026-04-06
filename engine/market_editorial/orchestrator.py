from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

from market_editorial.client import CerebrasClientError, CerebrasRateLimitError, CerebrasStructuredClient
from market_editorial.roles import (
    CRITIC_ROLE_NAME,
    EDITOR_ROLE_NAME,
    MARKET_EDITORIAL_VERSION,
    build_critic_system_prompt,
    build_critic_user_message,
    build_editor_system_prompt,
    build_editor_user_message,
)
from market_editorial.schemas import (
    CRITIC_JSON_SCHEMA,
    EDITOR_JSON_SCHEMA,
    validate_critic_output,
    validate_editor_output,
)


INVALID_MARKET_TOPIC_EXACT_BLOCKLIST = {
    "don know",
    "few years",
    "first users",
    "hey all",
    "hey everyone",
    "hey guys",
    "https www",
    "long take",
    "lot people",
    "not sure",
    "other people",
    "quarter achieve",
    "years marketing",
    "explore page",
}

INVALID_MARKET_TOPIC_PREFIXES = (
    "anyone else ",
    "does anyone ",
    "don know",
    "help ",
    "hey ",
    "how do i ",
    "looking for ",
    "manual ",
    "not sure",
)

INVALID_MARKET_TOPIC_GENERIC_TOKENS = {
    "alternative",
    "alternatives",
    "anyone",
    "does",
    "don",
    "else",
    "everyone",
    "few",
    "first",
    "for",
    "guys",
    "help",
    "how",
    "i",
    "issue",
    "issues",
    "know",
    "long",
    "lot",
    "looking",
    "manual",
    "month",
    "months",
    "not",
    "other",
    "page",
    "people",
    "problem",
    "problems",
    "quarter",
    "recommendation",
    "recommendations",
    "sure",
    "take",
    "year",
    "years",
}


def _env_flag(name: str, default: bool = False) -> bool:
    raw = str(os.environ.get(name, "")).strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except Exception:
        return default


def _env_str(name: str, default: str = "") -> str:
    return str(os.environ.get(name, default) or "").strip()


def _env_path(name: str, default: Path) -> Path:
    raw = _env_str(name)
    return Path(raw) if raw else default


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _safe_number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _safe_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return value
    return value


def _to_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def _normalize_sources(value: Any) -> List[Dict[str, Any]]:
    parsed = _safe_json(value)
    if not isinstance(parsed, list):
        return []
    normalized = []
    for row in parsed:
        if not isinstance(row, dict):
            continue
        platform = _clean_text(row.get("platform"))
        if not platform:
            continue
        normalized.append({
            "platform": platform,
            "count": int(_safe_number(row.get("count"), 0)),
        })
    return normalized


def _normalize_top_posts(value: Any, max_posts: int) -> List[Dict[str, Any]]:
    parsed = _safe_json(value)
    if not isinstance(parsed, list):
        return []
    normalized = []
    for row in parsed[:max_posts]:
        if not isinstance(row, dict):
            continue
        title = _clean_text(row.get("title"))
        if not title:
            continue
        normalized.append({
            "title": title,
            "source": _clean_text(row.get("source")),
            "subreddit": _clean_text(row.get("subreddit")),
            "score": int(_safe_number(row.get("score"), 0)),
            "comments": int(_safe_number(row.get("comments"), 0)),
            "created_utc": row.get("created_utc"),
            "voice_type": _clean_text(row.get("voice_type")),
            "signal_kind": _clean_text(row.get("signal_kind")),
            "directness_tier": _clean_text(row.get("directness_tier")),
            "market_support_level": _clean_text(row.get("market_support_level")),
        })
    return normalized


def _tokenize(value: Any) -> List[str]:
    return [token for token in _clean_text(value).lower().replace("/", " ").replace("-", " ").split() if len(token) > 2]


def _normalize_market_topic_name(value: Any) -> str:
    normalized = _clean_text(value).lower().replace("&", " ")
    normalized = "".join(char if char.isalnum() or char.isspace() else " " for char in normalized)
    return " ".join(normalized.split()).strip()


def _is_invalid_market_topic_name(value: Any) -> bool:
    normalized = _normalize_market_topic_name(value)
    if not normalized:
        return True
    if normalized in INVALID_MARKET_TOPIC_EXACT_BLOCKLIST:
        return True
    if any(normalized.startswith(prefix) for prefix in INVALID_MARKET_TOPIC_PREFIXES):
        return True
    if "http" in normalized or "www" in normalized:
        return True

    meaningful_tokens = [
        token for token in normalized.split(" ")
        if token and token not in INVALID_MARKET_TOPIC_GENERIC_TOKENS and len(token) > 2
    ]
    return len(meaningful_tokens) < 2


def _parse_stored_editorial(value: Any) -> Dict[str, Any] | None:
    parsed = _safe_json(value)
    return parsed if isinstance(parsed, dict) else None


def _is_public_editorial(editorial: Dict[str, Any] | None) -> bool:
    if not editorial:
        return False
    return (
        _clean_text(editorial.get("status")).lower() == "success"
        and _clean_text(editorial.get("visibility_decision")).lower() == "public"
    )


def _default_budget_state_path() -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "market_editorial_budget.json"


def _budget_day_key(now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    return current.astimezone(timezone.utc).strftime("%Y-%m-%d")


def _load_budget_state(path: Path) -> Dict[str, Any]:
    try:
        if path.exists():
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                return raw
    except Exception:
        pass
    return {}


def _read_daily_tokens(path: Path, now: datetime | None = None) -> int:
    state = _load_budget_state(path)
    day_key = _budget_day_key(now)
    if _clean_text(state.get("day")) != day_key:
        return 0
    return int(_safe_number(state.get("tokens_used"), 0))


def _write_daily_tokens(path: Path, used_tokens: int, now: datetime | None = None) -> None:
    current = now or datetime.now(timezone.utc)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "day": _budget_day_key(current),
        "tokens_used": int(max(0, used_tokens)),
        "updated_at": current.isoformat(),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _build_source_mix_status(runtime_context: Dict[str, Any] | None) -> Dict[str, Any]:
    if runtime_context is None:
        return {
            "status": "unknown",
            "active_sources": [],
            "healthy_sources": [],
            "degraded_sources": [],
            "note": "",
        }

    context = runtime_context or {}
    source_counts = context.get("source_counts")
    healthy_sources = [_clean_text(item) for item in (context.get("healthy_sources") or []) if _clean_text(item)]
    degraded_sources = [_clean_text(item) for item in (context.get("degraded_sources") or []) if _clean_text(item)]

    active_sources: List[str] = []
    if isinstance(source_counts, dict):
        for source, count in source_counts.items():
            if _safe_number(count, 0) > 0:
                active_sources.append(_clean_text(source))
    active_sources = [item for item in active_sources if item]
    if not active_sources:
        active_sources = healthy_sources[:]

    status = "healthy"
    note = ""
    if not active_sources:
        status = "empty"
        note = "No active sources produced posts in this run."
    elif len(active_sources) < 2 or len(degraded_sources) >= len(active_sources):
        status = "degraded"
        note = (
            f"Active sources={','.join(active_sources) or 'none'}; "
            f"degraded={','.join(degraded_sources) or 'none'}"
        )

    return {
        "status": status,
        "active_sources": active_sources,
        "healthy_sources": healthy_sources,
        "degraded_sources": degraded_sources,
        "note": note,
    }


def _build_signal_contract(input_row: Dict[str, Any], top_posts: List[Dict[str, Any]]) -> Dict[str, Any]:
    stored = _safe_json(input_row.get("signal_contract"))
    if isinstance(stored, dict):
        return stored

    source_count = int(_safe_number(input_row.get("source_count"), 0))
    direct_count = sum(1 for post in top_posts if _clean_text(post.get("market_support_level")).lower() == "evidence_backed")
    supporting_count = sum(
        1
        for post in top_posts
        if _clean_text(post.get("market_support_level")).lower() in {"evidence_backed", "supporting_context"}
    )
    support_level = "hypothesis"
    if direct_count > 0:
        support_level = "evidence_backed"
    elif supporting_count > 0 or source_count >= 2:
        support_level = "supporting_context"

    dominant_source = ""
    for post in top_posts:
        if _clean_text(post.get("source")):
            dominant_source = _clean_text(post.get("source"))
            break

    return {
        "support_level": support_level,
        "buyer_native_direct_count": direct_count,
        "supporting_signal_count": supporting_count,
        "dominant_platform": dominant_source or None,
        "single_source": source_count < 2,
    }


def _build_possible_duplicates(
    slug: str,
    topic: str,
    all_rows: Iterable[Dict[str, Any]],
    limit: int = 5,
) -> List[Dict[str, Any]]:
    base_tokens = set(_tokenize(topic))
    scored = []
    for row in all_rows:
        other_slug = _clean_text(row.get("slug"))
        if not other_slug or other_slug == slug:
            continue
        editorial = _parse_stored_editorial(row.get("market_editorial"))
        other_title = _clean_text(
            (editorial or {}).get("edited_title")
            or row.get("public_title")
            or row.get("suggested_wedge_label")
            or row.get("topic")
        )
        tokens = set(_tokenize(other_title))
        if not tokens:
            continue
        overlap = len(base_tokens & tokens)
        if overlap <= 0:
            continue
        scored.append((
            overlap,
            float(row.get("current_score") or 0),
            {
                "slug": other_slug,
                "title": other_title,
                "summary": _clean_text((editorial or {}).get("edited_summary") or row.get("pain_summary")),
                "score": float(row.get("current_score") or 0),
            },
        ))
    scored.sort(key=lambda item: (-item[0], -item[1], item[2]["slug"]))
    return [item[2] for item in scored[:limit]]


def _build_editorial_packet(
    row: Dict[str, Any],
    *,
    max_posts: int,
    all_rows: Iterable[Dict[str, Any]],
) -> Dict[str, Any]:
    slug = _clean_text(row.get("slug"))
    topic = _clean_text(row.get("topic"))
    sources = _normalize_sources(row.get("sources"))
    top_posts = _normalize_top_posts(row.get("top_posts"), max_posts=max_posts)
    signal_contract = _build_signal_contract(row, top_posts)
    heuristic_title = _clean_text(row.get("public_title") or row.get("suggested_wedge_label") or topic)
    heuristic_summary = _clean_text(row.get("public_summary") or row.get("pain_summary"))

    return {
        "slug": slug,
        "topic": topic,
        "category": _clean_text(row.get("category")),
        "heuristic_title": heuristic_title,
        "heuristic_summary": heuristic_summary,
        "current_score": round(_safe_number(row.get("current_score"), 0.0), 1),
        "confidence_level": _clean_text(row.get("confidence_level")).upper(),
        "post_count_total": int(_safe_number(row.get("post_count_total"), 0)),
        "source_count": int(_safe_number(row.get("source_count"), 0)),
        "first_seen": _clean_text(row.get("first_seen")),
        "last_updated": _clean_text(row.get("last_updated")),
        "sources": sources,
        "signal_contract": signal_contract,
        "representative_posts": top_posts,
        "possible_duplicates": _build_possible_duplicates(slug, heuristic_title or topic, all_rows),
    }


def _build_input_hash(packet: Dict[str, Any]) -> str:
    encoded = json.dumps(packet, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _candidate_sort_key(candidate: Dict[str, Any]) -> Tuple[float, float, float, float, str]:
    packet = candidate["packet"]
    signal_contract = packet.get("signal_contract") or {}
    direct = float(signal_contract.get("buyer_native_direct_count") or 0)
    return (
        -float(packet.get("current_score") or 0),
        -direct,
        -float(packet.get("source_count") or 0),
        -float(packet.get("post_count_total") or 0),
        str(packet.get("slug") or ""),
    )


def _is_backfill_worthy(packet: Dict[str, Any], stored: Dict[str, Any] | None) -> bool:
    slug = _clean_text(packet.get("slug")).lower()
    topic = _clean_text(packet.get("topic")).lower()
    heuristic_title = _clean_text(packet.get("heuristic_title"))
    if slug.startswith("sub-") or "not-promote" in slug or topic.startswith("pain signals from"):
        return False
    if slug.startswith("dyn-") and _is_invalid_market_topic_name(heuristic_title or topic):
        return False
    if _is_invalid_market_topic_name(heuristic_title or topic):
        return False

    if stored and _clean_text(stored.get("status")).lower() == "success":
        return True

    current_score = float(packet.get("current_score") or 0)
    post_count_total = float(packet.get("post_count_total") or 0)
    source_count = float(packet.get("source_count") or 0)
    signal_contract = packet.get("signal_contract") or {}
    direct_proof = float(signal_contract.get("buyer_native_direct_count") or 0)
    supporting_signal = float(signal_contract.get("supporting_signal_count") or 0)
    if source_count < 2 and direct_proof <= 0 and supporting_signal <= 0:
        return False

    return (
        current_score >= 20
        or post_count_total >= 5
        or source_count >= 2
        or direct_proof > 0
        or supporting_signal > 0
    )


def _needs_editorial_refresh(packet: Dict[str, Any], stored: Dict[str, Any] | None, refresh_hours: int) -> bool:
    if not stored:
        return True

    if _clean_text(stored.get("status")).lower() != "success":
        return True

    input_hash = _clean_text(stored.get("input_hash"))
    if input_hash != _build_input_hash(packet):
        return True

    updated_at = _to_datetime(stored.get("updated_at") or stored.get("market_editorial_updated_at"))
    if not updated_at:
        return True
    return datetime.now(timezone.utc) - updated_at >= timedelta(hours=refresh_hours)


def _collect_candidates(
    current_rows: List[Dict[str, Any]],
    existing_rows: Iterable[Dict[str, Any]],
    *,
    top_n: int,
    max_posts: int,
    refresh_hours: int,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    all_rows = list(existing_rows or [])
    current_slugs = {_clean_text(row.get("slug")) for row in current_rows}
    current_candidates = []

    for row in current_rows:
        packet = _build_editorial_packet(row, max_posts=max_posts, all_rows=all_rows)
        stored = _parse_stored_editorial(row.get("market_editorial"))
        if _needs_editorial_refresh(packet, stored, refresh_hours) and _is_backfill_worthy(packet, stored):
            current_candidates.append({
                "kind": "current",
                "slug": packet["slug"],
                "row": row,
                "packet": packet,
            })

    refresh_existing_candidates = []
    for row in all_rows:
        slug = _clean_text(row.get("slug"))
        if not slug or slug in current_slugs:
            continue
        stored = _parse_stored_editorial(row.get("market_editorial"))
        packet = _build_editorial_packet(row, max_posts=max_posts, all_rows=all_rows)
        if not _needs_editorial_refresh(packet, stored, refresh_hours):
            continue
        if not _is_backfill_worthy(packet, stored):
            continue
        refresh_existing_candidates.append({
            "kind": "existing" if not stored else "stale",
            "slug": slug,
            "row": row,
            "packet": packet,
        })

    current_candidates.sort(key=_candidate_sort_key)
    refresh_existing_candidates.sort(key=_candidate_sort_key)

    combined = (current_candidates + refresh_existing_candidates)[:top_n]
    return combined, current_candidates, refresh_existing_candidates


def _build_editorial_payload(
    *,
    packet: Dict[str, Any],
    editor_output: Dict[str, Any] | None,
    critic_output: Dict[str, Any] | None,
    status: str,
    provider: str,
    model: str,
    error_message: str | None = None,
) -> Dict[str, Any]:
    final_title = None
    final_summary = None
    if editor_output:
        final_title = critic_output.get("tightened_title") if critic_output else None
        final_summary = critic_output.get("tightened_summary") if critic_output else None
        final_title = final_title or editor_output.get("edited_title")
        final_summary = final_summary or editor_output.get("edited_summary")

    payload = {
        "status": status,
        "version": MARKET_EDITORIAL_VERSION,
        "provider": provider,
        "model": model,
        "input_hash": _build_input_hash(packet),
        "edited_title": final_title,
        "edited_summary": final_summary,
        "pain_statement": editor_output.get("pain_statement") if editor_output else None,
        "ideal_buyer": editor_output.get("ideal_buyer") if editor_output else None,
        "product_angle": editor_output.get("product_angle") if editor_output else None,
        "verdict": editor_output.get("verdict") if editor_output else None,
        "next_step": editor_output.get("next_step") if editor_output else None,
        "visibility_decision": critic_output.get("visibility_decision") if critic_output else None,
        "duplicate_of_slug": critic_output.get("duplicate_of_slug") if critic_output else None,
        "critic_reasons": critic_output.get("critic_reasons") if critic_output else ([] if status == "success" else [error_message or "Unknown editorial failure"]),
        "quality_score": critic_output.get("quality_score") if critic_output else 0,
        "grounding_confidence": critic_output.get("grounding_confidence") if critic_output else 0,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    return payload


def run_market_editorial_pass(
    current_rows: List[Dict[str, Any]],
    existing_rows: Iterable[Dict[str, Any]],
    *,
    persist_enabled: bool,
    runtime_context: Dict[str, Any] | None = None,
    logger=print,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    telemetry = {
        "enabled": False,
        "publish_mode": "shadow",
        "considered": 0,
        "processed": 0,
        "approved_public": 0,
        "rejected": 0,
        "duplicates": 0,
        "fallback_count": 0,
        "tokens_used": 0,
        "daily_tokens_before": 0,
        "daily_tokens_after": 0,
        "daily_budget_limit": 0,
        "source_mix_status": "unknown",
        "source_mix_note": "",
        "rate_limited": False,
        "errors": [],
    }
    existing_rows_list = list(existing_rows or [])
    if not current_rows and not existing_rows_list:
        return current_rows, [], telemetry

    if not persist_enabled:
        logger("  [Editorial] Skipped: database columns not available yet")
        return current_rows, [], telemetry

    if not _env_flag("MARKET_AGENT_ENABLED", False):
        logger("  [Editorial] Disabled via MARKET_AGENT_ENABLED")
        return current_rows, [], telemetry

    api_key = _env_str("CEREBRAS_API_KEY")
    if not api_key:
        logger("  [Editorial] Skipped: CEREBRAS_API_KEY missing")
        return current_rows, [], telemetry

    model = _env_str("CEREBRAS_MODEL", "qwen-3-235b-a22b-instruct-2507")
    publish_mode = _env_str("MARKET_AGENT_PUBLISH_MODE", "shadow").lower()
    top_n = _env_int("MARKET_AGENT_TOP_N", 20)
    max_posts = _env_int("MARKET_AGENT_MAX_INPUT_POSTS", 10)
    max_tokens_per_run = _env_int("MARKET_AGENT_MAX_TOKENS_PER_RUN", 100000)
    max_daily_tokens = _env_int("MARKET_AGENT_MAX_DAILY_TOKENS", 700000)
    refresh_hours = _env_int("MARKET_AGENT_REFRESH_HOURS", 24)
    budget_state_path = _env_path("MARKET_AGENT_BUDGET_STATE_FILE", _default_budget_state_path())
    telemetry["enabled"] = True
    telemetry["publish_mode"] = "publish" if publish_mode == "publish" else "shadow"
    telemetry["daily_budget_limit"] = max_daily_tokens

    source_mix = _build_source_mix_status(runtime_context)
    telemetry["source_mix_status"] = source_mix["status"]
    telemetry["source_mix_note"] = source_mix["note"]
    if source_mix["status"] != "healthy" and source_mix["note"]:
        telemetry["errors"].append(f"source_mix_{source_mix['status']}: {source_mix['note']}")
    if source_mix["status"] == "empty":
        logger("  [Editorial] Skipped: empty source mix")
        return current_rows, [], telemetry

    daily_tokens_before = _read_daily_tokens(budget_state_path)
    telemetry["daily_tokens_before"] = daily_tokens_before
    remaining_daily_budget = max(0, max_daily_tokens - daily_tokens_before)
    effective_run_budget = min(max_tokens_per_run, remaining_daily_budget)
    if effective_run_budget < 1000:
        telemetry["errors"].append("daily_budget_exhausted")
        telemetry["daily_tokens_after"] = daily_tokens_before
        logger("  [Editorial] Skipped: daily budget exhausted")
        return current_rows, [], telemetry

    candidates, current_pool, refresh_pool = _collect_candidates(
        current_rows,
        existing_rows_list,
        top_n=top_n,
        max_posts=max_posts,
        refresh_hours=refresh_hours,
    )
    telemetry["considered"] = len(candidates)
    telemetry["current_candidates"] = len(current_pool)
    telemetry["existing_candidates"] = len(refresh_pool)
    if not candidates:
        logger("  [Editorial] No candidates needed refresh")
        telemetry["daily_tokens_after"] = daily_tokens_before
        return current_rows, [], telemetry

    client = CerebrasStructuredClient(api_key=api_key, model=model)
    updated_current = {str(row.get("slug") or ""): dict(row) for row in current_rows}
    stale_updates: List[Dict[str, Any]] = []
    consecutive_non_public = 0

    for candidate in candidates:
        if telemetry["tokens_used"] >= effective_run_budget or (effective_run_budget - telemetry["tokens_used"]) < 1000:
            telemetry["errors"].append("token_budget_exhausted")
            break
        if telemetry["processed"] >= 3 and consecutive_non_public >= 3 and telemetry["tokens_used"] >= int(effective_run_budget * 0.7):
            telemetry["errors"].append("diminishing_returns_stop")
            break

        packet = candidate["packet"]
        slug = candidate["slug"]
        logger(f"  [Editorial] Reviewing {slug} ({candidate['kind']})")

        try:
            editor_raw, editor_usage = client.create_structured_completion(
                system_prompt=build_editor_system_prompt(),
                user_prompt=build_editor_user_message(packet),
                schema_name=EDITOR_ROLE_NAME,
                schema=EDITOR_JSON_SCHEMA,
                max_tokens=900,
            )
            editor_output = validate_editor_output(editor_raw)

            critic_raw, critic_usage = client.create_structured_completion(
                system_prompt=build_critic_system_prompt(),
                user_prompt=build_critic_user_message(packet, editor_output),
                schema_name=CRITIC_ROLE_NAME,
                schema=CRITIC_JSON_SCHEMA,
                max_tokens=600,
            )
            critic_output = validate_critic_output(critic_raw)
            telemetry["tokens_used"] += int(editor_usage.get("total_tokens", 0)) + int(critic_usage.get("total_tokens", 0))

            payload = _build_editorial_payload(
                packet=packet,
                editor_output=editor_output,
                critic_output=critic_output,
                status="success",
                provider="cerebras",
                model=model,
            )
            update_row = {
                "slug": slug,
                "market_editorial": payload,
                "market_editorial_updated_at": payload["updated_at"],
            }

            if candidate["kind"] == "current":
                merged = dict(updated_current.get(slug) or candidate["row"])
                merged.update(update_row)
                updated_current[slug] = merged
            else:
                stale_updates.append(update_row)

            telemetry["processed"] += 1
            visibility = critic_output["visibility_decision"]
            if visibility == "public":
                telemetry["approved_public"] += 1
                consecutive_non_public = 0
            else:
                telemetry["rejected"] += 1
                consecutive_non_public += 1
                if visibility == "duplicate":
                    telemetry["duplicates"] += 1
        except CerebrasRateLimitError as exc:
            telemetry["rate_limited"] = True
            telemetry["errors"].append(str(exc))
            logger(f"  [Editorial] Rate limited: {exc}")
            break
        except Exception as exc:
            telemetry["processed"] += 1
            telemetry["fallback_count"] += 1
            consecutive_non_public += 1
            telemetry["errors"].append(str(exc))
            logger(f"  [Editorial] Failed on {slug}: {exc}")
            payload = _build_editorial_payload(
                packet=packet,
                editor_output=None,
                critic_output=None,
                status="failed",
                provider="cerebras",
                model=model,
                error_message=str(exc),
            )
            update_row = {
                "slug": slug,
                "market_editorial": payload,
                "market_editorial_updated_at": payload["updated_at"],
            }
            if candidate["kind"] == "current":
                merged = dict(updated_current.get(slug) or candidate["row"])
                merged.update(update_row)
                updated_current[slug] = merged
            else:
                stale_updates.append(update_row)

    if telemetry["tokens_used"] > 0:
        try:
            _write_daily_tokens(budget_state_path, daily_tokens_before + telemetry["tokens_used"])
        except Exception as exc:
            telemetry["errors"].append(f"budget_state_write_failed: {exc}")
    telemetry["daily_tokens_after"] = daily_tokens_before + telemetry["tokens_used"]

    return list(updated_current.values()), stale_updates, telemetry
