"""
RedditPulse — Credibility Engine
Honest confidence levels based on evidence volume + source diversity.
No fake hope. No inflated signals. Just math.

Rules:
  < 20 posts       → INSUFFICIENT (hidden from results entirely)
  20-49, 1 source  → LOW
  50-199            → MODERATE  
  200+, 2+ sources → HIGH
  500+, 3+ sources → STRONG

Source diversity ALWAYS beats raw volume:
  200 Reddit-only   = MODERATE (not HIGH)
  100 Reddit + 60 HN + 40 PH = HIGH
"""

from dataclasses import dataclass
from typing import Dict, List, Optional


# ═══════════════════════════════════════════════════════
# CONFIDENCE TIERS
# ═══════════════════════════════════════════════════════

TIERS = {
    "INSUFFICIENT": {
        "min_posts": 0,
        "max_posts": 19,
        "min_sources": 1,
        "icon": "🚫",
        "label": "Not enough data",
        "description": "Insufficient data to make any claim. Try broader keywords or wait for more scraping.",
        "show_opportunity": False,
    },
    "LOW": {
        "min_posts": 20,
        "max_posts": 49,
        "min_sources": 1,
        "icon": "⚠️",
        "label": "Limited signal",
        "description": "Small sample — treat as early indicator only. Do not build on this alone.",
        "show_opportunity": True,
    },
    "MODERATE": {
        "min_posts": 50,
        "max_posts": 199,
        "min_sources": 1,
        "icon": "📊",
        "label": "Moderate confidence",
        "description": "Decent signal emerging. Verify with customer interviews before committing.",
        "show_opportunity": True,
    },
    "HIGH": {
        "min_posts": 200,
        "max_posts": 499,
        "min_sources": 2,
        "icon": "✅",
        "label": "Strong signal",
        "description": "Cross-platform validation. Credible opportunity worth serious exploration.",
        "show_opportunity": True,
    },
    "STRONG": {
        "min_posts": 500,
        "max_posts": 999999,
        "min_sources": 3,
        "icon": "🔥",
        "label": "Very strong signal",
        "description": "High-confidence opportunity backed by multi-platform data. Build it.",
        "show_opportunity": True,
    },
}


@dataclass
class CredibilityReport:
    """Full credibility assessment for a scan."""
    tier: str                          # INSUFFICIENT, LOW, MODERATE, HIGH, STRONG
    icon: str                          # emoji
    label: str                         # human-readable
    description: str                   # explanation
    show_opportunity: bool             # whether to show in results
    total_posts: int
    source_count: int
    sources: Dict[str, int]            # {"reddit": 450, "hackernews": 120, ...}
    source_diversity_score: float      # 0-1 (higher = more diverse)
    data_freshness_days: float         # avg age of posts in days
    cross_platform_topics: int         # topics found on 2+ platforms
    warning: Optional[str] = None      # optional warning message

    def to_dict(self) -> dict:
        return {
            "tier": self.tier,
            "icon": self.icon,
            "label": self.label,
            "description": self.description,
            "show_opportunity": self.show_opportunity,
            "total_posts": self.total_posts,
            "source_count": self.source_count,
            "sources": self.sources,
            "source_diversity_score": round(self.source_diversity_score, 3),
            "data_freshness_days": round(self.data_freshness_days, 1),
            "cross_platform_topics": self.cross_platform_topics,
            "warning": self.warning,
            "human_summary": self._human_summary(),
        }

    def _human_summary(self) -> str:
        source_list = ", ".join(
            f"{name} ({count})" for name, count in sorted(
                self.sources.items(), key=lambda x: x[1], reverse=True
            )
        )
        freshness = (
            "last 7 days" if self.data_freshness_days <= 7
            else f"last {int(self.data_freshness_days)} days"
        )
        return (
            f"Based on {self.total_posts} posts from {self.source_count} "
            f"platform{'s' if self.source_count > 1 else ''} "
            f"({source_list}) over the {freshness}."
        )


# ═══════════════════════════════════════════════════════
# CORE ASSESSMENT
# ═══════════════════════════════════════════════════════

def _source_diversity(sources: Dict[str, int]) -> float:
    """
    Shannon entropy normalized to 0-1.
    1 source = 0.0, equal split across 4 = 1.0
    """
    import math
    total = sum(sources.values())
    if total == 0 or len(sources) <= 1:
        return 0.0
    
    entropy = 0.0
    for count in sources.values():
        if count > 0:
            p = count / total
            entropy -= p * math.log2(p)
    
    max_entropy = math.log2(len(sources))
    return entropy / max_entropy if max_entropy > 0 else 0.0


def _count_cross_platform_topics(posts: list) -> int:
    """
    Count topics (matched_phrases) appearing on 2+ platforms.
    """
    from collections import defaultdict
    topic_sources = defaultdict(set)
    
    for post in posts:
        source = post.get("source", "reddit")
        # Normalize source from subreddit field
        if source == "reddit" and post.get("subreddit", "").startswith("HackerNews"):
            source = "hackernews"
        
        for phrase in post.get("matched_phrases", []):
            topic_sources[phrase.lower()].add(source)
    
    return sum(1 for sources in topic_sources.values() if len(sources) >= 2)


def _avg_freshness_days(posts: list) -> float:
    """Average age of posts in days."""
    import time
    now = time.time()
    ages = []
    
    for post in posts:
        created = post.get("created_utc", 0)
        if isinstance(created, str):
            try:
                from datetime import datetime
                dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                created = dt.timestamp()
            except (ValueError, TypeError):
                created = 0
        
        if created > 0:
            ages.append((now - created) / 86400)
    
    return sum(ages) / len(ages) if ages else 30.0


def _determine_tier(total_posts: int, source_count: int) -> str:
    """
    Determine confidence tier.
    
    KEY RULE: Source diversity beats raw volume.
    200 Reddit-only = MODERATE (needs 2+ sources for HIGH)
    500 from 2 sources = HIGH (needs 3+ for STRONG)
    """
    if total_posts < 20:
        return "INSUFFICIENT"
    
    if total_posts >= 500 and source_count >= 3:
        return "STRONG"
    
    if total_posts >= 200 and source_count >= 2:
        return "HIGH"
    
    if total_posts >= 50:
        return "MODERATE"
    
    return "LOW"


def assess_credibility(posts: list) -> CredibilityReport:
    """
    Full credibility assessment for a batch of posts.
    
    Args:
        posts: list of post dicts with 'source' and/or 'subreddit' fields
    
    Returns:
        CredibilityReport with tier, metadata, and human-readable summary
    """
    # Count posts per source
    sources: Dict[str, int] = {}
    for post in posts:
        source = post.get("source", "reddit")
        # Normalize HN posts that use subreddit field
        if source == "reddit" and post.get("subreddit", "").startswith("HackerNews"):
            source = "hackernews"
        sources[source] = sources.get(source, 0) + 1
    
    total_posts = sum(sources.values())
    source_count = len(sources)
    
    # Determine tier
    tier_name = _determine_tier(total_posts, source_count)
    tier = TIERS[tier_name]
    
    # Compute metrics
    diversity = _source_diversity(sources)
    freshness = _avg_freshness_days(posts)
    cross_platform = _count_cross_platform_topics(posts)
    
    # Warning for single-source high volume
    warning = None
    if total_posts >= 200 and source_count == 1:
        warning = (
            f"High volume ({total_posts} posts) but single source only. "
            f"Cross-platform validation would increase confidence significantly."
        )
    
    return CredibilityReport(
        tier=tier_name,
        icon=tier["icon"],
        label=tier["label"],
        description=tier["description"],
        show_opportunity=tier["show_opportunity"],
        total_posts=total_posts,
        source_count=source_count,
        sources=sources,
        source_diversity_score=diversity,
        data_freshness_days=freshness,
        cross_platform_topics=cross_platform,
        warning=warning,
    )


# ═══════════════════════════════════════════════════════
# CROSS-PLATFORM SIGNAL MULTIPLIER
# ═══════════════════════════════════════════════════════

PLATFORM_MULTIPLIERS = {
    1: 1.0,    # Single source — no bonus
    2: 1.5,    # Two platforms agree — 50% boost
    3: 2.2,    # Three platforms — 120% boost
    4: 3.0,    # Four platforms — 200% boost (very rare, very real)
}


def cross_platform_multiplier(source_count: int) -> float:
    """Get the score multiplier based on how many platforms confirm the signal."""
    return PLATFORM_MULTIPLIERS.get(min(source_count, 4), 3.0)


def get_topic_multiplier(topic: str, posts: list) -> float:
    """
    Get the cross-platform multiplier for a specific topic.
    Counts how many unique platforms have posts matching this topic.
    """
    platforms = set()
    topic_lower = topic.lower()
    
    for post in posts:
        source = post.get("source", "reddit")
        if source == "reddit" and post.get("subreddit", "").startswith("HackerNews"):
            source = "hackernews"
        
        text = post.get("full_text", "").lower()
        if topic_lower in text:
            platforms.add(source)
    
    return cross_platform_multiplier(len(platforms))


# ═══════════════════════════════════════════════════════
# DEDUPLICATION
# ═══════════════════════════════════════════════════════

def deduplicate_cross_platform(posts: list, threshold: float = 0.85) -> list:
    """
    Remove duplicate posts across platforms using title similarity.
    Keeps the version with the highest score.
    """
    from difflib import SequenceMatcher
    
    unique = []
    seen_titles = []
    
    # Sort by score descending — keep highest-scoring version
    sorted_posts = sorted(posts, key=lambda p: p.get("score", 0), reverse=True)
    
    for post in sorted_posts:
        title = post.get("title", "").strip().lower()
        if not title or len(title) < 10:
            unique.append(post)
            continue
        
        is_dup = False
        for seen in seen_titles:
            ratio = SequenceMatcher(None, title, seen).ratio()
            if ratio > threshold:
                is_dup = True
                break
        
        if not is_dup:
            unique.append(post)
            seen_titles.append(title)
    
    return unique


# ═══════════════════════════════════════════════════════
# SYNTHESIS PROMPT MODIFIER
# ═══════════════════════════════════════════════════════

def credibility_prompt_modifier(report: CredibilityReport) -> str:
    """
    Returns extra instructions for the AI synthesis prompt
    based on credibility level. Makes the AI more cautious
    when data is weak.
    """
    modifiers = {
        "INSUFFICIENT": (
            "CRITICAL: You have fewer than 20 posts. DO NOT claim any opportunity exists. "
            "State clearly that there is insufficient data. Recommend broader keywords."
        ),
        "LOW": (
            "WARNING: You have limited data (20-49 posts from a single source). "
            "Frame ALL findings as 'early indicators only'. Use phrases like "
            "'too early to tell', 'preliminary signal', 'needs more data'. "
            "Do NOT use words like 'opportunity', 'strong', or 'confirmed'."
        ),
        "MODERATE": (
            "You have a moderate dataset. Findings are directional but not confirmed. "
            "Recommend further validation through customer interviews. "
            "Acknowledge the sample size is decent but not definitive."
        ),
        "HIGH": (
            "You have strong cross-platform data. You can make confident claims "
            "but still flag any areas where the data is thin. Reference the "
            "specific platforms that confirm the signal."
        ),
        "STRONG": (
            "You have very strong multi-platform data. Make confident recommendations. "
            "This is a validated market signal. Still mention any caveats."
        ),
    }
    
    base = modifiers.get(report.tier, "")
    return f"{base}\n\nData context: {report._human_summary()}"


# ═══════════════════════════════════════════════════════
# STANDALONE TEST
# ═══════════════════════════════════════════════════════

if __name__ == "__main__":
    import time
    
    # Test with fake data
    fake_posts = []
    now = time.time()
    
    # 150 Reddit posts
    for i in range(150):
        fake_posts.append({
            "id": f"reddit_{i}",
            "title": f"Test post {i}",
            "source": "reddit",
            "subreddit": "startups",
            "created_utc": now - (86400 * (i % 30)),
            "matched_phrases": ["is there a tool"] if i % 3 == 0 else [],
            "full_text": f"I need a better tool for invoicing {i}",
            "score": 10 + i,
        })
    
    # 80 HN posts
    for i in range(80):
        fake_posts.append({
            "id": f"hn_{i}",
            "title": f"Ask HN: Invoice tool {i}",
            "source": "hackernews",
            "subreddit": "HackerNews/ask_hn",
            "created_utc": now - (86400 * (i % 20)),
            "matched_phrases": ["is there a tool"] if i % 2 == 0 else [],
            "full_text": f"Looking for invoice automation {i}",
            "score": 5 + i,
        })
    
    report = assess_credibility(fake_posts)
    print(f"\n{'='*50}")
    print(f"  Credibility Assessment")
    print(f"{'='*50}")
    print(f"  {report.icon} {report.label} ({report.tier})")
    print(f"  {report.description}")
    print(f"  {report._human_summary()}")
    print(f"  Diversity: {report.source_diversity_score:.2f}")
    print(f"  Cross-platform topics: {report.cross_platform_topics}")
    if report.warning:
        print(f"  ⚠ {report.warning}")
    
    # Test insufficient
    small = fake_posts[:10]
    small_report = assess_credibility(small)
    print(f"\n  Small test (10 posts): {small_report.icon} {small_report.tier}")
    print(f"  Show opportunity: {small_report.show_opportunity}")
    
    # Test single-source high volume
    reddit_only = [p for p in fake_posts if p["source"] == "reddit"]
    single_report = assess_credibility(reddit_only)
    print(f"\n  Reddit-only (150 posts): {single_report.icon} {single_report.tier}")
    if single_report.warning:
        print(f"  ⚠ {single_report.warning}")
    
    # Test multiplier
    mult = cross_platform_multiplier(3)
    print(f"\n  3-platform multiplier: {mult}x")
    
    # Test dedup
    dupes = [
        {"id": "1", "title": "How to automate invoicing for freelancers", "score": 50, "source": "reddit"},
        {"id": "2", "title": "How to automate invoicing for freelancers?", "score": 30, "source": "hackernews"},
        {"id": "3", "title": "Best CRM for small teams", "score": 20, "source": "reddit"},
    ]
    deduped = deduplicate_cross_platform(dupes)
    print(f"\n  Dedup: {len(dupes)} → {len(deduped)} (removed {len(dupes)-len(deduped)} dupes)")
