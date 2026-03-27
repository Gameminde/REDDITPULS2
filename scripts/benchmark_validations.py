import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
ENGINE_DIR = REPO_ROOT / "engine"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from engine.env_loader import load_local_env

load_local_env(REPO_ROOT)

from engine.hn_scraper import run_hn_scrape
from engine.ph_scraper import run_ph_scrape
from engine.ih_scraper import run_ih_scrape
from engine.keyword_scraper import run_keyword_scan
from engine.pullpush_scraper import scrape_historical_multi
from engine.stackoverflow_scraper import scrape_stackoverflow
from engine.github_issues_scraper import scrape_github_issues
from validate_idea import (
    ICP_SUBREDDITS,
    HN_AVAILABLE,
    IH_AVAILABLE,
    PH_AVAILABLE,
    SO_AVAILABLE,
    GH_ISSUES_AVAILABLE,
    _augment_subreddits_with_occupation_map,
    _compute_weighted_score,
    _fetch_adzuna_job_posts,
    _fetch_g2_review_posts,
    _fetch_reddit_comment_posts,
    _fetch_vendor_blog_posts,
    _normalize_posts_with_taxonomy,
    _pullpush_settings,
    _route_forced_subreddits,
    apply_primary_filter,
    classify_icp,
)
from evidence_taxonomy import summarize_taxonomy


SCENARIOS = [
    {
        "idea": "invoice chasing for freelancers",
        "audience": "Freelancers and solo service businesses",
        "keywords": ["invoice", "payment reminder", "late payment", "freelance invoicing"],
        "ai_subreddits": ["freelance", "smallbusiness", "Accounting", "bookkeeping"],
        "known_competitors": ["FreshBooks", "Wave", "QuickBooks"],
    },
    {
        "idea": "Notion template marketplace for HR teams",
        "audience": "HR generalists and people operations teams at small companies",
        "keywords": ["notion templates", "hr onboarding", "people ops workflows", "hr templates"],
        "ai_subreddits": ["humanresources", "AskHR", "recruiting", "Notion"],
        "known_competitors": ["BambooHR", "Gusto", "Notion"],
    },
    {
        "idea": "expense report automation for construction companies",
        "audience": "Construction project managers and back-office finance teams",
        "keywords": ["expense report", "construction expenses", "receipt tracking", "jobsite spend"],
        "ai_subreddits": ["ConstructionManagers", "ConstructionTech", "construction", "projectmanagement"],
        "known_competitors": ["Expensify", "Concur", "Ramp", "Procore"],
    },
    {
        "idea": "AI code review tool for developers",
        "audience": "Software engineers and engineering teams",
        "keywords": ["code review", "pull request", "developer tool", "github workflow"],
        "ai_subreddits": ["programming", "webdev", "cscareerquestions", "softwareengineering"],
        "known_competitors": ["GitHub", "CodeRabbit", "Snyk", "Codecov"],
    },
]


ICP_SIGNAL_HINTS = {
    "B2B_HR": {"hr", "human", "resources", "recruiting", "onboarding", "people", "talent", "employee"},
    "B2B_FINANCE": {"finance", "accounting", "bookkeeping", "invoice", "payment", "billing", "tax", "expense"},
    "B2B_CONSTRUCTION": {"construction", "contractor", "builder", "project", "jobsite", "building", "civil", "expense"},
    "B2B_LEGAL": {"legal", "law", "lawyer", "attorney", "paralegal", "compliance", "contract"},
    "B2B_RESTAURANT": {"restaurant", "kitchen", "food", "service", "cafe", "hospitality", "dining"},
    "B2B_REALESTATE": {"real", "estate", "property", "broker", "agent", "landlord", "leasing"},
    "B2B_MARKETING": {"marketing", "growth", "campaign", "content", "seo", "social", "media"},
    "B2B_SALES": {"sales", "pipeline", "revenue", "prospect", "lead", "account", "crm"},
    "B2B_OPS": {"operations", "ops", "workflow", "process", "automation", "backoffice"},
    "DEV_TOOL": {"developer", "software", "engineer", "code", "review", "pull", "request", "github", "programming"},
    "ECOMMERCE": {"shopify", "store", "merchant", "ecommerce", "cart", "checkout", "product"},
    "CONSUMER": {"consumer", "personal", "habit", "student", "lifestyle", "daily"},
    "B2B_GENERAL": {"business", "smallbusiness", "startup", "saas"},
}


def _tokenize_text(value):
    return {
        token
        for token in re.split(r"[^a-z0-9]+", str(value or "").lower())
        if len(token) >= 4
    }


def _tokenize_subreddit(value):
    parts = re.findall(r"[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+", str(value or ""))
    return {
        token.lower()
        for token in parts
        if len(token) >= 3
    } | _tokenize_text(value)


def _source_name(row):
    return str(row.get("source_name") or row.get("source") or "unknown").strip().lower()


def _compact_meta(meta):
    if not meta:
        return ""
    preferred = [
        "reason",
        "error",
        "error_type",
        "http_status",
        "method",
        "status",
        "note",
        "query",
        "producthunt_error",
        "api_error",
    ]
    items = []
    for key in preferred:
        value = meta.get(key)
        if value in (None, "", [], {}):
            continue
        items.append(f"{key}={value}")
    if not items:
        compact = json.dumps(meta, ensure_ascii=True)
        return compact[:140]
    return "; ".join(items[:4])[:200]


def _subreddit_matches_context(subreddit, icp, context_terms):
    normalized = str(subreddit or "").strip().lower()
    if not normalized:
        return False
    if normalized in {sub.lower() for sub in ICP_SUBREDDITS.get(icp, [])}:
        return True
    subreddit_terms = _tokenize_subreddit(subreddit)
    if subreddit_terms & context_terms:
        return True
    if subreddit_terms & ICP_SIGNAL_HINTS.get(icp, set()):
        return True
    return False


def _is_buyer_native_candidate(row, icp):
    source_name = _source_name(row)
    source_class = str(row.get("source_class") or "").lower()
    evidence_layer = str(row.get("evidence_layer") or "").lower()
    if evidence_layer != "problem":
        return False
    if icp == "DEV_TOOL":
        return source_name in {"reddit", "stackoverflow", "githubissues"} or source_class == "dev-community"
    return source_name == "reddit" and source_class == "community"


def _is_business_candidate(row):
    source_name = _source_name(row)
    if source_name == "unknown":
        return False
    return str(row.get("evidence_layer") or "").lower() == "business"


def _sample_titles(rows, limit=5):
    samples = []
    for row in rows[:limit]:
        title = str(row.get("title") or row.get("post_title") or "").strip()
        if not title:
            title = str(row.get("full_text") or row.get("body") or "").strip()[:120]
        samples.append({
            "title": title[:160],
            "source": str(row.get("source") or row.get("source_name") or row.get("subreddit") or "").strip(),
            "score": row.get("weighted_score", row.get("score")),
            "directness_tier": row.get("directness_tier", ""),
            "evidence_layer": row.get("evidence_layer", ""),
        })
    return samples


def _run_probe(name, fn):
    started = time.time()
    try:
        payload = fn()
        rows = []
        status = "ok"
        meta = {}
        if isinstance(payload, dict):
            rows = list(payload.get("posts") or payload.get("results") or [])
            meta = {k: v for k, v in payload.items() if k not in {"posts", "results"}}
            if meta.get("status") not in (None, "ok"):
                status = str(meta.get("status"))
        elif isinstance(payload, list):
            rows = payload
        else:
            status = "unexpected"
            meta = {"payload_type": type(payload).__name__}
        elapsed = round(time.time() - started, 2)
        if status == "ok" and len(rows) == 0:
            status = "empty"
        return {
            "name": name,
            "status": status,
            "count": len(rows),
            "elapsed_seconds": elapsed,
            "rows": rows,
            "meta": meta,
        }
    except Exception as exc:
        return {
            "name": name,
            "status": "error",
            "count": 0,
            "elapsed_seconds": round(time.time() - started, 2),
            "rows": [],
            "meta": {
                "error_type": type(exc).__name__,
                "error": str(exc)[:240],
            },
        }


def _dedupe_posts(posts):
    seen_keys = set()
    unique = []
    for post in posts:
        source_key = str(post.get("source") or post.get("source_name") or post.get("subreddit") or "unknown").lower().strip()
        external_id = str(post.get("external_id") or "").strip()
        canonical_url = str(post.get("permalink") or post.get("url") or post.get("post_url") or "").strip().lower()
        title_key = str(post.get("title") or "").lower().strip()[:200]
        if external_id:
            dedupe_key = ("external_id", source_key, external_id)
        elif canonical_url:
            dedupe_key = ("url", source_key, canonical_url[:500])
        elif title_key:
            dedupe_key = ("title", source_key, title_key)
        else:
            dedupe_key = None
        if dedupe_key and dedupe_key in seen_keys:
            continue
        if dedupe_key:
            seen_keys.add(dedupe_key)
        unique.append(post)
    return unique


def _count_sources(rows):
    counts = Counter()
    for row in rows:
        counts[str(row.get("source_name") or row.get("source") or "unknown")] += 1
    return dict(counts)


def _filter_decomposition(scenario, routed_subreddits):
    keywords = list(scenario["keywords"])
    return {
        "keywords": keywords,
        "colloquial_keywords": keywords[:5],
        "subreddits": list(routed_subreddits),
        "competitors": list(scenario.get("known_competitors") or []),
        "audience": scenario.get("audience") or "",
        "pain_hypothesis": scenario.get("idea") or "",
    }


def _top_candidates(rows, *, layer=None, directness=None, limit=5):
    filtered = []
    for row in rows:
        if layer and row.get("evidence_layer") != layer:
            continue
        if directness and row.get("directness_tier") != directness:
            continue
        filtered.append(row)
    filtered.sort(key=lambda item: item.get("weighted_score", item.get("score", 0)), reverse=True)
    return _sample_titles(filtered, limit=limit)


def _trusted_candidates(rows, *, icp, directness=None, limit=5):
    filtered = []
    for row in rows:
        if directness and row.get("directness_tier") != directness:
            continue
        if not _is_buyer_native_candidate(row, icp):
            continue
        filtered.append(row)
    filtered.sort(key=lambda item: item.get("weighted_score", item.get("score", 0)), reverse=True)
    return _sample_titles(filtered, limit=limit)


def _business_candidates(rows, *, limit=5):
    filtered = [row for row in rows if _is_business_candidate(row)]
    filtered.sort(key=lambda item: item.get("weighted_score", item.get("score", 0)), reverse=True)
    return _sample_titles(filtered, limit=limit)


def _source_health_summary(source_health):
    blockers = []
    problem_sources_ok = 0
    business_sources_ok = 0
    details = []
    for source in source_health:
        name = source["name"]
        status = source["status"]
        count = source["count"]
        detail = _compact_meta(source.get("meta") or {})
        details.append({
            "name": name,
            "status": status,
            "count": count,
            "elapsed_seconds": source["elapsed_seconds"],
            "detail": detail,
        })
        if name in {"reddit_posts", "reddit_historical_posts", "reddit_comments"} and status == "ok" and count > 0:
            problem_sources_ok += 1
        if name in {"adzuna_jobs", "vendor_blogs", "producthunt", "hackernews", "indiehackers", "g2_reviews"} and status == "ok" and count > 0:
            business_sources_ok += 1
        if status in {"error", "failed"} or (status == "empty" and name in {"reddit_comments", "reddit_historical_posts", "g2_reviews", "adzuna_jobs"}):
            blockers.append(f"{name}: {status}" + (f" ({detail})" if detail else ""))
    if problem_sources_ok >= 2 and business_sources_ok >= 2:
        overall = "healthy"
    elif problem_sources_ok >= 1:
        overall = "mixed"
    else:
        overall = "weak"
    return {
        "overall": overall,
        "problem_sources_ok": problem_sources_ok,
        "business_sources_ok": business_sources_ok,
        "blockers": blockers,
        "details": details,
    }


def _routing_summary(base_forced, final_forced, occupation_match, idea, audience, keywords, icp):
    base_set = {sub.lower() for sub in base_forced}
    occupation_added = [sub for sub in final_forced if sub.lower() not in base_set]
    context_terms = _tokenize_text(" ".join([idea, audience] + list(keywords))) | ICP_SIGNAL_HINTS.get(icp, set())
    suspicious = [
        sub for sub in occupation_added
        if not _subreddit_matches_context(sub, icp, context_terms)
    ]
    if suspicious:
        health = "polluted"
    elif occupation_added:
        health = "augmented"
    else:
        health = "clean"
    return {
        "base_forced": base_forced,
        "occupation_added": occupation_added,
        "occupation_match": occupation_match,
        "suspicious": suspicious,
        "health": health,
    }


def _provenance_summary(raw_source_counts, filtered_source_counts, raw_count, filtered_count):
    raw_unknown = int(raw_source_counts.get("unknown", 0))
    filtered_unknown = int(filtered_source_counts.get("unknown", 0))
    return {
        "raw_unknown": raw_unknown,
        "filtered_unknown": filtered_unknown,
        "raw_unknown_ratio": (raw_unknown / raw_count) if raw_count else 0.0,
        "filtered_unknown_ratio": (filtered_unknown / filtered_count) if filtered_count else 0.0,
    }


def _readiness_assessment(result):
    trusted_direct = len(result["trusted_direct_problem"])
    trusted_adjacent = len(result["trusted_adjacent_problem"])
    filtered_problem = int(result["filtered_taxonomy"].get("evidence_layers", {}).get("problem", 0))
    business_count = int(result["filtered_taxonomy"].get("evidence_layers", {}).get("business", 0))
    transport = result["source_transport"]["overall"]
    routing = result["routing_summary"]["health"]
    provenance = result["provenance"]["filtered_unknown_ratio"]

    if trusted_direct >= 5:
        problem_signal = "strong"
    elif trusted_direct >= 2:
        problem_signal = "moderate"
    elif filtered_problem > 0 or trusted_adjacent > 0:
        problem_signal = "weak"
    else:
        problem_signal = "none"

    if business_count >= 12:
        business_signal = "strong"
    elif business_count >= 5:
        business_signal = "moderate"
    elif business_count > 0:
        business_signal = "weak"
    else:
        business_signal = "none"

    blockers = []
    if problem_signal in {"none", "weak"}:
        blockers.append("insufficient buyer-native direct problem evidence")
    if transport != "healthy":
        blockers.append(f"source transport is {transport}")
    if routing == "polluted":
        blockers.append("subreddit routing is polluted by weak occupation-map additions")
    if provenance >= 0.25:
        blockers.append("too much filtered evidence has unknown provenance")

    if problem_signal == "strong" and transport == "healthy" and routing != "polluted" and provenance < 0.2:
        status = "READY FOR FULL VALIDATION"
    elif problem_signal in {"moderate", "strong"} and transport != "weak":
        status = "LIMITED - REVIEW BEFORE FULL VALIDATION"
    else:
        status = "NOT READY FOR FULL VALIDATION"

    return {
        "status": status,
        "problem_signal": problem_signal,
        "business_signal": business_signal,
        "blockers": blockers,
    }


def _scenario_markdown(result):
    readiness = result["readiness"]
    transport = result["source_transport"]
    routing = result["routing_summary"]
    provenance = result["provenance"]
    lines = [
        f"## {result['idea']}",
        "",
        f"- Benchmark verdict: `{readiness['status']}`",
        f"- Problem signal: `{readiness['problem_signal']}`",
        f"- Business signal: `{readiness['business_signal']}`",
        f"- Source transport: `{transport['overall']}`",
        f"- Routing health: `{routing['health']}`",
        f"- ICP: `{result['icp']}`",
        f"- Audience: `{result['audience']}`",
        f"- Keywords: `{', '.join(result['keywords'])}`",
        f"- Base routed subreddits: `{', '.join(routing['base_forced'])}`",
        f"- Final routed subreddits: `{', '.join(result['forced_subreddits'])}`",
    ]
    if routing["occupation_added"]:
        lines.append(f"- Occupation-added subreddits: `{', '.join(routing['occupation_added'])}`")
    if routing["suspicious"]:
        lines.append(f"- Suspicious routed subreddits: `{', '.join(routing['suspicious'])}`")
    occupation = result.get("occupation_match") or {}
    if occupation.get("occupations"):
        occupation_summary = "; ".join(
            f"{match.get('occupation')} -> {', '.join(match.get('subreddits') or [])}"
            for match in occupation.get("occupations")[:3]
        )
        lines.append(
            f"- Occupation map matches: `{occupation_summary}`"
        )
    lines.extend([
        f"- Raw posts: `{result['raw_count']}`",
        f"- Filtered posts: `{result['filtered_count']}`",
        f"- Filter pass rate: `{result['pass_rate']:.1%}`",
        f"- Provenance loss: raw `{provenance['raw_unknown']}` ({provenance['raw_unknown_ratio']:.0%}), filtered `{provenance['filtered_unknown']}` ({provenance['filtered_unknown_ratio']:.0%})",
        "",
        "### Main Blockers",
        "",
    ])
    if readiness["blockers"]:
        for blocker in readiness["blockers"]:
            lines.append(f"- {blocker}")
    else:
        lines.append("- None")
    lines.extend(["", "### Source Health", ""])
    for source in transport["details"]:
        suffix = f" - {source['detail']}" if source["detail"] else ""
        lines.append(
            f"- `{source['name']}`: `{source['status']}` "
            f"({source['count']} rows, {source['elapsed_seconds']}s){suffix}"
        )
    lines.extend([
        "",
        "### Evidence Quality",
        "",
        f"- Raw by source: `{json.dumps(result['raw_source_counts'], ensure_ascii=True)}`",
        f"- Filtered by source: `{json.dumps(result['filtered_source_counts'], ensure_ascii=True)}`",
        f"- Raw taxonomy: `{json.dumps(result['raw_taxonomy'], ensure_ascii=True)}`",
        f"- Filtered taxonomy: `{json.dumps(result['filtered_taxonomy'], ensure_ascii=True)}`",
        "",
        "### Filter Diagnostics",
        "",
        f"- By reason: `{json.dumps(result['filter_diagnostics'].get('by_reason', {}), ensure_ascii=True)}`",
    ])
    if not result["filter_diagnostics"].get("by_reason"):
        lines.append("- Note: rejection reasons are not being surfaced yet by the primary filter, so this part of the benchmark is still incomplete.")
    lines.append(f"- Rejected sample: `{json.dumps(result['filter_diagnostics'].get('rejected_titles_sample', []), ensure_ascii=True)}`")
    lines.extend([
        "",
        "### Best Buyer-Native Direct Problem Evidence",
        "",
    ])
    direct = result["trusted_direct_problem"]
    if direct:
        for sample in direct:
            lines.append(
                f"- `{sample['source']}` | `score={sample['score']}` | "
                f"`{sample['directness_tier']}/{sample['evidence_layer']}` | {sample['title']}"
            )
    else:
        lines.append("- None")
    lines.extend(["", "### Best Buyer-Native Adjacent Problem Evidence", ""])
    adjacent = result["trusted_adjacent_problem"]
    if adjacent:
        for sample in adjacent:
            lines.append(
                f"- `{sample['source']}` | `score={sample['score']}` | "
                f"`{sample['directness_tier']}/{sample['evidence_layer']}` | {sample['title']}"
            )
    else:
        lines.append("- None")
    lines.extend(["", "### Best Business/Supporting Evidence", ""])
    supporting = result["trusted_business_supporting"]
    if supporting:
        for sample in supporting:
            lines.append(
                f"- `{sample['source']}` | `score={sample['score']}` | "
                f"`{sample['directness_tier']}/{sample['evidence_layer']}` | {sample['title']}"
            )
    else:
        lines.append("- None")
    if result["provenance_lost_candidates"]:
        lines.extend(["", "### Hidden Risk: High-Scoring Items With Lost Provenance", ""])
        for sample in result["provenance_lost_candidates"]:
            lines.append(
                f"- `unknown` | `score={sample['score']}` | "
                f"`{sample['directness_tier']}/{sample['evidence_layer']}` | {sample['title']}"
            )
    lines.append("")
    return "\n".join(lines)


def build_report(results):
    generated = datetime.now(timezone.utc).isoformat()
    lines = [
        "# Validation Benchmark Report",
        "",
        "- Mode: `pre-LLM benchmark`",
        "- Purpose: validate source health, taxonomy, and primary filter quality without spending model tokens",
        f"- Generated: `{generated}`",
        "",
        "## Executive Readout",
        "",
    ]
    ready = sum(1 for result in results if result["readiness"]["status"] == "READY FOR FULL VALIDATION")
    limited = sum(1 for result in results if result["readiness"]["status"] == "LIMITED - REVIEW BEFORE FULL VALIDATION")
    blocked = len(results) - ready - limited
    lines.extend([
        f"- Ready now: `{ready}`",
        f"- Limited / review needed: `{limited}`",
        f"- Not ready: `{blocked}`",
        "",
        "## Summary",
        "",
    ])
    for result in results:
        direct_problem = len(result["trusted_direct_problem"])
        problem_layer = result["filtered_taxonomy"].get("evidence_layers", {}).get("problem", 0)
        lines.append(
            f"- `{result['idea']}`: `{result['readiness']['status']}` | "
            f"problem `{result['readiness']['problem_signal']}` | business `{result['readiness']['business_signal']}` | "
            f"trusted direct `{direct_problem}` | problem-layer `{problem_layer}` | pass-rate `{result['pass_rate']:.1%}`"
        )
    lines.append("")
    for result in results:
        lines.append(_scenario_markdown(result))
    return "\n".join(lines)


def run_scenario(scenario):
    idea = scenario["idea"]
    audience = scenario["audience"]
    keywords = list(scenario["keywords"])
    icp = classify_icp(idea, audience, keywords)
    base_forced = _route_forced_subreddits(icp, scenario.get("ai_subreddits") or [])
    forced, occupation_match = _augment_subreddits_with_occupation_map(idea, audience, base_forced)
    pullpush = _pullpush_settings(icp, "quick")

    source_health = []

    reddit_result = _run_probe(
        "reddit_posts",
        lambda: run_keyword_scan(
            keywords,
            duration="10min",
            forced_subreddits=forced,
            min_keyword_matches=1,
            idea_text=idea,
            icp_category=icp,
            return_metadata=True,
        ),
    )
    source_health.append({k: reddit_result[k] for k in ("name", "status", "count", "elapsed_seconds", "meta")})
    reddit_posts = reddit_result["rows"]
    selected_subreddits = list(
        dict.fromkeys(
            list((reddit_result.get("meta") or {}).get("selected_subreddits") or [])
            + list(forced)
        )
    )

    historical_probe = _run_probe(
        "reddit_historical_posts",
        lambda: scrape_historical_multi(
            subreddits=selected_subreddits[:4] or forced[:4],
            keywords=keywords[:2],
            days_back=pullpush["days_back"],
            size_per_sub=20,
        ),
    )
    source_health.append({k: historical_probe[k] for k in ("name", "status", "count", "elapsed_seconds", "meta")})
    historical_posts = historical_probe["rows"]

    comments_probe = _run_probe(
        "reddit_comments",
        lambda: _fetch_reddit_comment_posts(
            selected_subreddits[:12] or forced[:8],
            keywords[:6],
            icp,
            timeout_seconds=min(45, pullpush["timeout"]),
            max_posts=60,
            days_back=pullpush["days_back"],
        ),
    )
    source_health.append({k: comments_probe[k] for k in ("name", "status", "count", "elapsed_seconds", "meta")})
    reddit_comments = comments_probe["rows"]

    hn_probe = _run_probe(
        "hackernews",
        lambda: run_hn_scrape(keywords[:2], max_pages=1) if HN_AVAILABLE else [],
    )
    source_health.append({k: hn_probe[k] for k in ("name", "status", "count", "elapsed_seconds", "meta")})
    hn_posts = hn_probe["rows"]

    ph_probe = _run_probe(
        "producthunt",
        lambda: run_ph_scrape(keywords[:2], max_pages=1, return_health=True) if PH_AVAILABLE else [],
    )
    source_health.append({k: ph_probe[k] for k in ("name", "status", "count", "elapsed_seconds", "meta")})
    ph_posts = ph_probe["rows"]

    ih_probe = _run_probe(
        "indiehackers",
        lambda: run_ih_scrape(keywords[:2], max_pages=1, return_health=True) if IH_AVAILABLE else [],
    )
    source_health.append({k: ih_probe[k] for k in ("name", "status", "count", "elapsed_seconds", "meta")})
    ih_posts = ih_probe["rows"]

    g2_probe = _run_probe(
        "g2_reviews",
        lambda: _fetch_g2_review_posts(icp, scenario.get("known_competitors") or [], timeout_seconds=30),
    )
    source_health.append({k: g2_probe[k] for k in ("name", "status", "count", "elapsed_seconds", "meta")})
    g2_posts = g2_probe["rows"]

    jobs_probe = _run_probe(
        "adzuna_jobs",
        lambda: _fetch_adzuna_job_posts(keywords[:3], icp, timeout_seconds=25, max_posts=20),
    )
    source_health.append({k: jobs_probe[k] for k in ("name", "status", "count", "elapsed_seconds", "meta")})
    job_posts = jobs_probe["rows"]

    blogs_probe = _run_probe(
        "vendor_blogs",
        lambda: _fetch_vendor_blog_posts(icp, idea, keywords[:5], max_posts=10),
    )
    source_health.append({k: blogs_probe[k] for k in ("name", "status", "count", "elapsed_seconds", "meta")})
    vendor_posts = blogs_probe["rows"]

    if icp == "DEV_TOOL" and SO_AVAILABLE:
        so_probe = _run_probe(
            "stackoverflow",
            lambda: scrape_stackoverflow(keywords[:2], max_keywords=2, time_budget=20, pages=1),
        )
    else:
        so_probe = {"name": "stackoverflow", "status": "skipped", "count": 0, "elapsed_seconds": 0.0, "meta": {"reason": "non-dev or unavailable"}, "rows": []}
    source_health.append({k: so_probe[k] for k in ("name", "status", "count", "elapsed_seconds", "meta")})
    so_posts = so_probe["rows"]

    gh_probe = _run_probe(
        "github_issues",
        lambda: scrape_github_issues(keywords[:2], max_keywords=2, time_budget=20, pages=1) if GH_ISSUES_AVAILABLE else [],
    )
    source_health.append({k: gh_probe[k] for k in ("name", "status", "count", "elapsed_seconds", "meta")})
    gh_posts = gh_probe["rows"]

    all_posts = (
        reddit_posts
        + historical_posts
        + reddit_comments
        + hn_posts
        + ph_posts
        + ih_posts
        + g2_posts
        + job_posts
        + vendor_posts
        + so_posts
        + gh_posts
    )
    normalized_posts = _normalize_posts_with_taxonomy(all_posts, icp, forced)
    for post in normalized_posts:
        post["weighted_score"] = _compute_weighted_score(post)
    unique_posts = _dedupe_posts(normalized_posts)

    filtered_posts, filter_diagnostics = apply_primary_filter(
        unique_posts,
        idea,
        decomposition=_filter_decomposition(scenario, forced),
        depth="quick",
        return_diagnostics=True,
    )

    raw_taxonomy = summarize_taxonomy(unique_posts)
    filtered_taxonomy = summarize_taxonomy(filtered_posts)

    raw_source_counts = _count_sources(unique_posts)
    filtered_source_counts = _count_sources(filtered_posts)
    source_transport = _source_health_summary(source_health)
    routing_summary = _routing_summary(base_forced, forced, occupation_match, idea, audience, keywords, icp)
    provenance = _provenance_summary(raw_source_counts, filtered_source_counts, len(unique_posts), len(filtered_posts))

    result = {
        "idea": idea,
        "audience": audience,
        "keywords": keywords,
        "icp": icp,
        "base_forced_subreddits": base_forced,
        "forced_subreddits": forced,
        "occupation_match": occupation_match,
        "source_health": source_health,
        "source_transport": source_transport,
        "routing_summary": routing_summary,
        "raw_count": len(unique_posts),
        "filtered_count": len(filtered_posts),
        "pass_rate": (len(filtered_posts) / len(unique_posts)) if unique_posts else 0.0,
        "raw_source_counts": raw_source_counts,
        "filtered_source_counts": filtered_source_counts,
        "provenance": provenance,
        "raw_taxonomy": raw_taxonomy,
        "filtered_taxonomy": filtered_taxonomy,
        "filter_diagnostics": filter_diagnostics,
        "top_direct_problem": _top_candidates(filtered_posts, layer="problem", directness="direct", limit=5),
        "top_adjacent": _top_candidates(filtered_posts, directness="adjacent", limit=5),
        "top_supporting": _top_candidates(filtered_posts, layer="business", limit=5),
        "trusted_direct_problem": _trusted_candidates(filtered_posts, icp=icp, directness="direct", limit=5),
        "trusted_adjacent_problem": _trusted_candidates(filtered_posts, icp=icp, directness="adjacent", limit=5),
        "trusted_business_supporting": _business_candidates(filtered_posts, limit=5),
        "provenance_lost_candidates": _sample_titles(
            sorted(
                [row for row in filtered_posts if _source_name(row) == "unknown"],
                key=lambda item: item.get("weighted_score", item.get("score", 0)),
                reverse=True,
            ),
            limit=3,
        ),
    }
    result["readiness"] = _readiness_assessment(result)
    return result


def main():
    results = []
    for scenario in SCENARIOS:
        print(f"\n=== Benchmark: {scenario['idea']} ===", flush=True)
        result = run_scenario(scenario)
        results.append(result)
        print(
            json.dumps(
                {
                    "idea": result["idea"],
                    "icp": result["icp"],
                    "raw_count": result["raw_count"],
                    "filtered_count": result["filtered_count"],
                    "filtered_taxonomy": result["filtered_taxonomy"],
                },
                indent=2,
            ),
            flush=True,
        )

    report_md = build_report(results)
    report_path = REPO_ROOT / "VALIDATION_BENCHMARK_REPORT.md"
    report_path.write_text(report_md, encoding="utf-8")
    print(f"\n[report] wrote {report_path}")


if __name__ == "__main__":
    main()
