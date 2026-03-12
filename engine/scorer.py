"""
Reddit Opportunity Scanner — Scoring Engine v4 (Credibility)
Per-subreddit normalization, cross-sub + cross-platform boost,
complaint velocity tracking, explicit confidence tiers,
credibility-aware scoring, human-readable explanations.
"""

import math
import time
from datetime import datetime, timezone
from collections import defaultdict, Counter

from config import SCORING_WEIGHTS
from credibility import cross_platform_multiplier


# ═══════════════════════════════════════════════════════
# PER-SUBREDDIT ENGAGEMENT BASELINES
# ═══════════════════════════════════════════════════════
SUB_ENGAGEMENT_BASELINES = {
    "SaaS": {"median_score": 8, "median_comments": 12},
    "Entrepreneur": {"median_score": 15, "median_comments": 20},
    "smallbusiness": {"median_score": 10, "median_comments": 12},
    "webdev": {"median_score": 25, "median_comments": 30},
    "marketing": {"median_score": 20, "median_comments": 25},
    "shopify": {"median_score": 5, "median_comments": 8},
    "startups": {"median_score": 12, "median_comments": 15},
    "digitalnomad": {"median_score": 15, "median_comments": 20},
    "ecommerce": {"median_score": 8, "median_comments": 10},
    "Accounting": {"median_score": 15, "median_comments": 25},
    "realestateinvesting": {"median_score": 15, "median_comments": 20},
    "ContentCreators": {"median_score": 3, "median_comments": 3},
    "sidehustle": {"median_score": 20, "median_comments": 30},
    "dropship": {"median_score": 5, "median_comments": 8},
    "freelance": {"median_score": 15, "median_comments": 20},
}

DEFAULT_BASELINE = {"median_score": 10, "median_comments": 15}


def _normalize_engagement(score, num_comments, subreddit=""):
    """
    Normalize against the subreddit's baseline.
    50 upvotes in r/shopify (median 5) = 10x signal.
    50 upvotes in r/webdev (median 25) = 2x signal.
    """
    baseline = SUB_ENGAGEMENT_BASELINES.get(subreddit, DEFAULT_BASELINE)
    med_score = max(baseline["median_score"], 1)
    med_comments = max(baseline["median_comments"], 1)

    score_ratio = math.log(1 + score / med_score)
    comment_ratio = math.log(1 + num_comments / med_comments)
    raw = score_ratio * 0.6 + comment_ratio * 0.4
    return min(raw / 2.5, 1.0)


def _parse_timestamp(created_utc):
    """Parse created_utc from either Unix timestamp or ISO string."""
    if isinstance(created_utc, str):
        try:
            dt = datetime.fromisoformat(created_utc.replace("Z", "+00:00"))
            return dt.timestamp()
        except (ValueError, TypeError):
            return 0.0
    elif isinstance(created_utc, (int, float)):
        return float(created_utc)
    return 0.0


def _recency_bonus(created_utc):
    """Full bonus < 7 days, decays over 90 days."""
    ts = _parse_timestamp(created_utc)
    if ts == 0:
        return 0.0
    age_days = (time.time() - ts) / 86400.0
    if age_days <= 7:
        return 1.0
    elif age_days <= 90:
        return max(0.0, 1.0 - ((age_days - 7) / 83.0))
    return 0.0


def _phrase_match_strength(matched_phrases):
    if not matched_phrases:
        return 0.0
    return min(len(matched_phrases) / 5.0, 1.0)


# ═══════════════════════════════════════════════════════
# CONFIDENCE SCORE — EXPLICIT THRESHOLDS
# ═══════════════════════════════════════════════════════
def _confidence_score(post, subreddit=""):
    """
    Explicit confidence tiers based on data quality:
    1.00 — 200+ words, 50+ normalized upvotes, 10+ comments
    0.85 — 100-200 words OR 10-50 upvotes
    0.70 — <100 words AND <10 upvotes
    
    AI-flagged posts get additional penalty.
    """
    text = post.get("full_text", "")
    word_count = len(text.split())
    score = post.get("score", 0)
    comments = post.get("num_comments", 0)

    # Normalize score against subreddit baseline
    baseline = SUB_ENGAGEMENT_BASELINES.get(subreddit, DEFAULT_BASELINE)
    norm_score = score / max(baseline["median_score"], 1)

    # Tier determination
    if word_count >= 200 and norm_score >= 5 and comments >= 10:
        confidence = 1.0
    elif word_count >= 100 or norm_score >= 1.0:
        confidence = 0.85
    else:
        confidence = 0.70

    # AI-flagged penalty
    if post.get("ai_flagged", False):
        confidence *= 0.75

    return round(confidence, 3)


# ═══════════════════════════════════════════════════════
# CROSS-SUBREDDIT + CROSS-PLATFORM SIGNAL (15% weight)
# ═══════════════════════════════════════════════════════
def _normalize_source(post):
    """Get normalized source name for a post."""
    source = post.get("source", "reddit")
    if source == "reddit" and post.get("subreddit", "").startswith("HackerNews"):
        source = "hackernews"
    return source


def _compute_cross_sub_signal(posts):
    """
    Find pain topics appearing across multiple subreddits/platforms.
    If the same frustration appears in 3+ subs = universal problem.
    """
    phrase_subs = defaultdict(set)
    for post in posts:
        for phrase in post.get("matched_phrases", []):
            phrase_subs[phrase.lower()].add(post.get("subreddit", ""))
    return {phrase: len(subs) for phrase, subs in phrase_subs.items()}


def _compute_cross_platform_signal(posts):
    """
    Find pain topics appearing across multiple PLATFORMS (not just subs).
    Reddit + HN confirming the same pain = much stronger signal.
    """
    phrase_platforms = defaultdict(set)
    for post in posts:
        source = _normalize_source(post)
        for phrase in post.get("matched_phrases", []):
            phrase_platforms[phrase.lower()].add(source)
    return {phrase: len(platforms) for phrase, platforms in phrase_platforms.items()}


# ═══════════════════════════════════════════════════════
# COMPLAINT VELOCITY TRACKING
# ═══════════════════════════════════════════════════════
def _compute_cluster_velocity(posts):
    """
    Group posts by matched phrases and compute posts-per-week velocity.
    Fast-growing clusters = exploding pain points.
    Returns: {phrase: {"velocity": posts_per_week, "total": count, "trend": "rising"|"stable"|"falling"}}
    """
    now = time.time()
    clusters = defaultdict(list)

    for post in posts:
        ts = _parse_timestamp(post.get("created_utc", 0))
        for phrase in post.get("matched_phrases", []):
            clusters[phrase.lower()].append(ts)

    velocity_data = {}
    for phrase, timestamps in clusters.items():
        if len(timestamps) < 2:
            velocity_data[phrase] = {"velocity": 0, "total": len(timestamps), "trend": "new"}
            continue

        timestamps.sort()
        # Posts in last 7 days vs posts in days 8-30
        recent = sum(1 for t in timestamps if (now - t) < 7 * 86400)
        older = sum(1 for t in timestamps if 7 * 86400 <= (now - t) < 30 * 86400)

        velocity = recent  # posts in last 7 days
        if older > 0 and recent > 0:
            recent_rate = recent / 7
            older_rate = older / 23
            if recent_rate > older_rate * 1.5:
                trend = "rising"
            elif recent_rate < older_rate * 0.5:
                trend = "falling"
            else:
                trend = "stable"
        elif recent > 0:
            trend = "rising"
        else:
            trend = "falling"

        velocity_data[phrase] = {
            "velocity": velocity,
            "total": len(timestamps),
            "trend": trend,
        }

    return velocity_data


# ═══════════════════════════════════════════════════════
# MAIN SCORING
# ═══════════════════════════════════════════════════════
def score_posts(posts):
    """
    Composite scoring with:
    - Per-subreddit engagement normalization
    - Cross-subreddit boost (15% weight)
    - Complaint velocity awareness
    - Explicit confidence thresholds
    - Full score breakdown + explanations
    """
    # Rebalanced weights: cross_sub bumped to 15%
    w = {
        "engagement": 0.25,
        "frustration": 0.30,
        "phrase_match": 0.20,
        "recency": 0.10,
        "cross_sub": 0.15,
    }

    # Pre-compute signals
    cross_sub = _compute_cross_sub_signal(posts)
    cross_platform = _compute_cross_platform_signal(posts)
    velocity = _compute_cluster_velocity(posts)

    for post in posts:
        sub = post.get("subreddit", "")

        # ── Component Scores ──
        engagement = _normalize_engagement(
            post.get("score", 0), post.get("num_comments", 0), sub
        )
        frustration = post.get("frustration_score", 0)
        phrase_str = _phrase_match_strength(post.get("matched_phrases", []))
        recency = _recency_bonus(post.get("created_utc", 0))

        # Cross-sub signal
        cross_sub_score = 0
        for phrase in post.get("matched_phrases", []):
            sub_count = cross_sub.get(phrase.lower(), 1)
            cross_sub_score = max(cross_sub_score, min(sub_count / 4, 1.0))

        # ── Base Score ──
        base_score = (
            engagement * w["engagement"]
            + frustration * w["frustration"]
            + phrase_str * w["phrase_match"]
            + recency * w["recency"]
            + cross_sub_score * w["cross_sub"]
        ) * 100

        # ── Opportunity Bonus ──
        opp_bonus = 1.0 + (post.get("opportunity_score", 0) * 0.3)

        # ── Velocity Bonus ──
        vel_bonus = 1.0
        for phrase in post.get("matched_phrases", []):
            v = velocity.get(phrase.lower(), {})
            if v.get("trend") == "rising" and v.get("velocity", 0) >= 3:
                vel_bonus = max(vel_bonus, 1.15)  # 15% boost for exploding pain
                break

        # ── Cross-Platform Multiplier ──
        platform_mult = 1.0
        for phrase in post.get("matched_phrases", []):
            plat_count = cross_platform.get(phrase.lower(), 1)
            if plat_count >= 2:
                platform_mult = max(platform_mult, cross_platform_multiplier(plat_count))
                break

        # ── Confidence ──
        confidence = _confidence_score(post, sub)

        # ── Final Score ──
        final = round(base_score * opp_bonus * vel_bonus * platform_mult * confidence, 2)
        post["opportunity_final_score"] = min(final, 100)  # cap at 100
        post["cross_platform_multiplier"] = platform_mult

        # ── Score Breakdown ──
        post["score_breakdown"] = {
            "engagement": round(engagement * 100, 1),
            "frustration": round(frustration * 100, 1),
            "phrase_match": round(phrase_str * 100, 1),
            "recency": round(recency * 100, 1),
            "cross_subreddit": round(cross_sub_score * 100, 1),
            "cross_platform": round((platform_mult - 1.0) * 100, 1),
            "opportunity_bonus": round((opp_bonus - 1.0) * 100, 1),
            "velocity_bonus": round((vel_bonus - 1.0) * 100, 1),
            "confidence": round(confidence * 100, 1),
        }

        # ── Human-Readable Explanation ──
        explanations = []
        if engagement > 0.7:
            explanations.append(f"High engagement for r/{sub}")
        if frustration > 0.5:
            explanations.append(f"Strong frustration ({len(post.get('frustration_types', []))} signals)")
        if phrase_str > 0.5:
            phrases = post.get("matched_phrases", [])[:3]
            explanations.append(f"Pain phrases: {', '.join(phrases)}")
        if cross_sub_score > 0.5:
            explanations.append("Universal pain (appears in 3+ subreddits)")
        if platform_mult > 1.0:
            explanations.append(f"🌐 Cross-platform ({platform_mult}x — confirmed on multiple platforms)")
        if post.get("opportunity_score", 0) > 0.5:
            explanations.append("Strong willingness-to-pay signals")
        if vel_bonus > 1.0:
            explanations.append("🔥 Exploding pain point (rising velocity)")
        if recency > 0.9:
            explanations.append("Very recent (< 7 days)")
        if confidence < 0.75:
            explanations.append("⚠ Low confidence (limited data)")
        if post.get("ai_flagged"):
            explanations.append("⚠ Possible AI-generated content")

        post["score_explanation"] = explanations

    # Sort descending
    posts.sort(key=lambda p: p["opportunity_final_score"], reverse=True)
    return posts


# ═══════════════════════════════════════════════════════
# CLUSTERING (with velocity + industry)
# ═══════════════════════════════════════════════════════
def cluster_by_topic(posts, top_n=50):
    """
    Smart clustering with cross-sub spread, velocity, and industry tags.
    """
    velocity = _compute_cluster_velocity(posts)

    clusters = defaultdict(lambda: {
        "phrase": "",
        "posts": [],
        "total_score": 0,
        "avg_score": 0,
        "subreddits": set(),
        "industries": Counter(),
        "count": 0,
        "max_desperation": "low",
        "velocity": {},
    })

    desperation_rank = {"low": 0, "medium": 1, "high": 2, "extreme": 3}

    for post in posts[:top_n * 3]:
        phrases = post.get("matched_phrases", [])
        key = phrases[0].lower() if phrases else "_high_engagement_unmatched"

        c = clusters[key]
        c["phrase"] = key
        c["posts"].append(post)
        c["total_score"] += post.get("opportunity_final_score", 0)
        c["count"] += 1
        c["subreddits"].add(post.get("subreddit", "unknown"))
        c["industries"][post.get("industry", "General")] += 1
        c["velocity"] = velocity.get(key, {})

        post_desp = post.get("desperation_level", "low")
        if desperation_rank.get(post_desp, 0) > desperation_rank.get(c["max_desperation"], 0):
            c["max_desperation"] = post_desp

    result = []
    for key, c in clusters.items():
        c["avg_score"] = round(c["total_score"] / max(c["count"], 1), 2)
        c["subreddits"] = sorted(c["subreddits"])
        c["top_industry"] = c["industries"].most_common(1)[0][0] if c["industries"] else "General"
        c["posts"].sort(key=lambda p: p.get("opportunity_final_score", 0), reverse=True)
        c["top_posts"] = c["posts"][:5]
        c["cross_sub_score"] = len(c["subreddits"])

        # Velocity tag
        vel = c.get("velocity", {})
        c["trend"] = vel.get("trend", "unknown")
        c["posts_this_week"] = vel.get("velocity", 0)

        result.append(c)

    # Sort by: count × avg_score × cross-sub × velocity
    result.sort(key=lambda c: (
        c["count"] * c["avg_score"]
        * (1 + c["cross_sub_score"] * 0.3)
        * (1.5 if c["trend"] == "rising" else 1.0)
    ), reverse=True)

    return result
