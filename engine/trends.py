"""
RedditPulse — Google Trends Velocity Layer
Answers the critical question: "Is this pain GROWING or DYING?"

Uses pytrends (free, no auth) to check search interest over time.
A pain point with rising Google Trends = 10x more valuable than one
that peaked 2 years ago.

Integration:
  - Called during scoring to boost/penalize opportunities
  - Cached to avoid hammering Google (1 req/keyword)
  - Results stored in credibility report
"""

import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple

try:
    from pytrends.request import TrendReq
    PYTRENDS_AVAILABLE = True
except ImportError:
    PYTRENDS_AVAILABLE = False
    print("  [!] pytrends not installed: pip install pytrends")


# ═══════════════════════════════════════════════════════
# TREND CLASSIFICATION
# ═══════════════════════════════════════════════════════

TREND_TIERS = {
    "EXPLODING": {
        "icon": "🚀",
        "label": "Exploding growth",
        "description": "Search interest surging — act fast",
        "score_multiplier": 1.8,
    },
    "GROWING": {
        "icon": "📈",
        "label": "Growing steadily",
        "description": "Increasing search interest — good timing",
        "score_multiplier": 1.4,
    },
    "STABLE": {
        "icon": "➡️",
        "label": "Stable demand",
        "description": "Consistent search interest — proven need",
        "score_multiplier": 1.0,
    },
    "DECLINING": {
        "icon": "📉",
        "label": "Declining interest",
        "description": "Search interest dropping — caution",
        "score_multiplier": 0.7,
    },
    "DEAD": {
        "icon": "💀",
        "label": "Near-zero interest",
        "description": "Almost no search activity — likely dead market",
        "score_multiplier": 0.3,
    },
}


class TrendResult:
    """Result of a Google Trends analysis for a keyword."""

    def __init__(self, keyword: str, tier: str, change_pct: float,
                 current_interest: int, peak_interest: int,
                 timeline: Optional[List[dict]] = None):
        self.keyword = keyword
        self.tier = tier
        self.tier_data = TREND_TIERS.get(tier, TREND_TIERS["STABLE"])
        self.change_pct = change_pct          # % change recent vs older
        self.current_interest = current_interest  # 0-100 (Google's scale)
        self.peak_interest = peak_interest      # 0-100
        self.timeline = timeline or []
        self.multiplier = self.tier_data["score_multiplier"]

    def to_dict(self) -> dict:
        return {
            "keyword": self.keyword,
            "tier": self.tier,
            "icon": self.tier_data["icon"],
            "label": self.tier_data["label"],
            "description": self.tier_data["description"],
            "change_percent": round(self.change_pct, 1),
            "current_interest": self.current_interest,
            "peak_interest": self.peak_interest,
            "score_multiplier": self.multiplier,
            "timeline_points": len(self.timeline),
        }

    def __repr__(self):
        return (
            f"TrendResult({self.keyword}: {self.tier_data['icon']} {self.tier} "
            f"| {self.change_pct:+.1f}% | interest={self.current_interest}/100)"
        )


# ═══════════════════════════════════════════════════════
# TREND CACHE (avoid hammering Google)
# ═══════════════════════════════════════════════════════
_cache: Dict[str, Tuple[TrendResult, float]] = {}
CACHE_TTL = 3600  # 1 hour


def _get_cached(keyword: str) -> Optional[TrendResult]:
    """Get cached result if fresh enough."""
    if keyword in _cache:
        result, ts = _cache[keyword]
        if time.time() - ts < CACHE_TTL:
            return result
    return None


def _set_cache(keyword: str, result: TrendResult):
    """Cache a result."""
    _cache[keyword] = (result, time.time())


# ═══════════════════════════════════════════════════════
# CORE ANALYSIS
# ═══════════════════════════════════════════════════════

def _classify_trend(recent_avg: float, older_avg: float, current: int) -> Tuple[str, float]:
    """
    Classify trend based on recent vs older interest.
    Returns (tier_name, change_percent).
    """
    if current <= 5:
        return "DEAD", -100.0

    if older_avg == 0:
        if recent_avg > 20:
            return "EXPLODING", 999.0
        return "STABLE", 0.0

    change_pct = ((recent_avg - older_avg) / older_avg) * 100

    if change_pct > 50:
        return "EXPLODING", change_pct
    elif change_pct > 15:
        return "GROWING", change_pct
    elif change_pct > -15:
        return "STABLE", change_pct
    elif change_pct > -40:
        return "DECLINING", change_pct
    else:
        return "DEAD", change_pct


def analyze_trend(keyword: str, timeframe: str = "today 12-m") -> Optional[TrendResult]:
    """
    Analyze Google Trends for a single keyword.

    Args:
        keyword: search term to analyze
        timeframe: pytrends timeframe (default: last 12 months)

    Returns:
        TrendResult or None if analysis fails
    """
    if not PYTRENDS_AVAILABLE:
        return None

    # Check cache
    cached = _get_cached(keyword)
    if cached:
        return cached

    try:
        pytrends = TrendReq(hl="en-US", tz=360, timeout=(10, 25))
        pytrends.build_payload([keyword], cat=0, timeframe=timeframe, geo="", gprop="")

        # Get interest over time
        df = pytrends.interest_over_time()

        if df is None or df.empty or keyword not in df.columns:
            return TrendResult(
                keyword=keyword, tier="STABLE", change_pct=0.0,
                current_interest=0, peak_interest=0,
            )

        values = df[keyword].tolist()
        if len(values) < 4:
            return TrendResult(
                keyword=keyword, tier="STABLE", change_pct=0.0,
                current_interest=values[-1] if values else 0,
                peak_interest=max(values) if values else 0,
            )

        # Split into recent (last 3 months) vs older (3-12 months ago)
        split = len(values) * 3 // 12  # ~3 months
        recent = values[-split:] if split > 0 else values[-3:]
        older = values[:-split] if split > 0 else values[:-3]

        recent_avg = sum(recent) / len(recent) if recent else 0
        older_avg = sum(older) / len(older) if older else 0
        current = values[-1]
        peak = max(values)

        # Classify
        tier, change_pct = _classify_trend(recent_avg, older_avg, current)

        # Build timeline (monthly averages)
        timeline = []
        dates = df.index.tolist()
        for i, (date, val) in enumerate(zip(dates, values)):
            timeline.append({
                "date": str(date.date()) if hasattr(date, "date") else str(date),
                "interest": int(val),
            })

        result = TrendResult(
            keyword=keyword,
            tier=tier,
            change_pct=change_pct,
            current_interest=int(current),
            peak_interest=int(peak),
            timeline=timeline,
        )

        _set_cache(keyword, result)
        return result

    except Exception as e:
        print(f"    [TRENDS] Error for '{keyword}': {e}")
        return None


def analyze_keywords(keywords: List[str], timeframe: str = "today 12-m") -> Dict[str, TrendResult]:
    """
    Analyze Google Trends for multiple keywords.
    Rate-limited to avoid Google blocking.

    Args:
        keywords: list of search terms
        timeframe: pytrends timeframe

    Returns:
        dict of keyword → TrendResult
    """
    results = {}

    for kw in keywords:
        result = analyze_trend(kw, timeframe)
        if result:
            results[kw] = result
            print(f"    [TRENDS] {result}")
        else:
            print(f"    [TRENDS] {kw}: no data")

        # Rate limit: 1 request per 2 seconds to avoid 429s
        time.sleep(2)

    return results


def get_trend_multiplier(keywords: List[str], trend_results: Dict[str, TrendResult]) -> float:
    """
    Get the best trend multiplier across all keywords.
    Uses the highest-tier trend found.
    """
    best_mult = 1.0
    for kw in keywords:
        if kw in trend_results:
            best_mult = max(best_mult, trend_results[kw].multiplier)
    return best_mult


def trend_summary_for_report(trend_results: Dict[str, TrendResult]) -> dict:
    """
    Create a summary of all trend results for the report.
    """
    if not trend_results:
        return {"available": False, "message": "Google Trends data not available"}

    summaries = []
    for kw, result in trend_results.items():
        summaries.append({
            "keyword": kw,
            "tier": result.tier,
            "icon": result.tier_data["icon"],
            "label": result.tier_data["label"],
            "change_percent": round(result.change_pct, 1),
            "current_interest": result.current_interest,
            "multiplier": result.multiplier,
        })

    # Overall trend
    avg_change = sum(r.change_pct for r in trend_results.values()) / len(trend_results)
    overall = "GROWING" if avg_change > 15 else ("DECLINING" if avg_change < -15 else "STABLE")

    return {
        "available": True,
        "overall_trend": overall,
        "avg_change_percent": round(avg_change, 1),
        "keywords": summaries,
    }


# ═══════════════════════════════════════════════════════
# STANDALONE TEST
# ═══════════════════════════════════════════════════════

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  Google Trends Analysis Test")
    print("=" * 60)

    test_keywords = ["invoice software", "AI automation", "dropshipping"]

    for kw in test_keywords:
        print(f"\n  Analyzing: '{kw}'...")
        result = analyze_trend(kw)
        if result:
            print(f"  {result.tier_data['icon']} {result.tier}: {result.change_pct:+.1f}%")
            print(f"  Current interest: {result.current_interest}/100")
            print(f"  Peak interest: {result.peak_interest}/100")
            print(f"  Score multiplier: {result.multiplier}x")
        else:
            print(f"  No data available")
        time.sleep(2)

    print(f"\n  Summary:")
    results = analyze_keywords(test_keywords)
    summary = trend_summary_for_report(results)
    print(f"  Overall: {summary.get('overall_trend', '?')}")
    print(f"  Avg change: {summary.get('avg_change_percent', 0):+.1f}%")
