"""
RedditPulse — Competition Analyzer (Lite)
Uses Google Search to estimate competition density without
fragile G2/Trustpilot scraping.

Method:
  - Google search "keyword" site:g2.com → product count on G2
  - Google search "keyword" site:producthunt.com → PH launches
  - Google search "keyword alternative" → how many people search for alternatives
  - Combines into a competition score + market saturation signal
"""

import re
import time
import requests
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote_plus


HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

# Competition tiers
COMPETITION_TIERS = {
    "BLUE_OCEAN": {
        "label": "Blue Ocean",
        "description": "Very few competitors — wide open market",
        "risk": "low",
        "icon": "🟢",
    },
    "EMERGING": {
        "label": "Emerging Market",
        "description": "Some competitors but room for differentiation",
        "risk": "medium-low",
        "icon": "🟡",
    },
    "COMPETITIVE": {
        "label": "Competitive",
        "description": "Many competitors — need strong differentiation",
        "risk": "medium-high",
        "icon": "🟠",
    },
    "SATURATED": {
        "label": "Saturated",
        "description": "Crowded market — hard to break in without a unique angle",
        "risk": "high",
        "icon": "🔴",
    },
}


def _google_result_count(query: str) -> int:
    """
    Estimate Google result count for a query.
    Uses the 'About X results' text from Google search.
    """
    try:
        url = f"https://www.google.com/search?q={quote_plus(query)}&hl=en"
        resp = requests.get(url, headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            return -1

        text = resp.text
        # Look for "About X results" or "X results"
        match = re.search(r'(?:About\s+)?([\d,]+)\s+results?', text)
        if match:
            count_str = match.group(1).replace(",", "")
            return int(count_str)

        # Fallback: count result divs
        result_divs = text.count('class="g"')
        return result_divs * 10  # rough estimate

    except Exception as e:
        print(f"    [COMP] Google search error: {e}")
        return -1


def _count_g2_products(keyword: str) -> int:
    """Estimate how many products exist on G2 for this keyword."""
    count = _google_result_count(f'site:g2.com/products "{keyword}"')
    return max(count, 0)


def _count_ph_launches(keyword: str) -> int:
    """Estimate how many products launched on ProductHunt for this keyword."""
    count = _google_result_count(f'site:producthunt.com/posts "{keyword}"')
    return max(count, 0)


def _count_alternatives_searches(keyword: str) -> int:
    """Check how many people search for alternatives (high = market pain)."""
    count = _google_result_count(f'"{keyword}" alternative')
    return max(count, 0)


def _classify_competition(g2_count: int, ph_count: int, alt_count: int) -> Tuple[str, dict]:
    """
    Classify competition level based on search counts.
    Returns (tier_name, details_dict).
    """
    # Normalize counts
    product_count = g2_count + ph_count

    if product_count <= 5:
        tier = "BLUE_OCEAN"
    elif product_count <= 20:
        tier = "EMERGING"
    elif product_count <= 100:
        tier = "COMPETITIVE"
    else:
        tier = "SATURATED"

    # High alternatives count = lots of people looking to switch = OPPORTUNITY
    switch_signal = "high" if alt_count > 50000 else ("medium" if alt_count > 10000 else "low")

    return tier, {
        "g2_products": g2_count,
        "ph_launches": ph_count,
        "total_products": product_count,
        "alternatives_searches": alt_count,
        "switch_demand": switch_signal,
    }


class CompetitionReport:
    """Competition analysis results for a keyword set."""

    def __init__(self, keyword: str, tier: str, details: dict):
        self.keyword = keyword
        self.tier = tier
        self.tier_data = COMPETITION_TIERS.get(tier, COMPETITION_TIERS["COMPETITIVE"])
        self.details = details

    def to_dict(self) -> dict:
        return {
            "keyword": self.keyword,
            "tier": self.tier,
            "label": self.tier_data["label"],
            "icon": self.tier_data["icon"],
            "description": self.tier_data["description"],
            "risk": self.tier_data["risk"],
            **self.details,
        }

    def __repr__(self):
        return (
            f"Competition({self.keyword}: {self.tier_data['icon']} {self.tier} "
            f"| {self.details.get('total_products', '?')} products "
            f"| switch demand: {self.details.get('switch_demand', '?')})"
        )


def analyze_competition(keywords: List[str]) -> Dict[str, CompetitionReport]:
    """
    Analyze competition for a list of keywords.
    Rate-limited to avoid Google blocking.
    """
    results = {}

    for kw in keywords:
        print(f"    [COMP] Checking competition for: '{kw}'...")

        # Run searches with delays
        g2 = _count_g2_products(kw)
        time.sleep(2)
        ph = _count_ph_launches(kw)
        time.sleep(2)
        alt = _count_alternatives_searches(kw)
        time.sleep(2)

        # Skip if all searches failed
        if g2 < 0 and ph < 0 and alt < 0:
            print(f"    [COMP] All searches failed for '{kw}' — skipping")
            continue

        g2 = max(g2, 0)
        ph = max(ph, 0)
        alt = max(alt, 0)

        tier, details = _classify_competition(g2, ph, alt)
        report = CompetitionReport(kw, tier, details)
        results[kw] = report

        print(f"    [COMP] {report}")

    return results


def competition_prompt_section(reports: Dict[str, CompetitionReport]) -> str:
    """Generate prompt section for AI synthesis."""
    if not reports:
        return ""

    lines = ["COMPETITION ANALYSIS (auto-detected):"]

    for kw, report in reports.items():
        d = report.details
        lines.append(
            f"  '{kw}': {report.tier_data['icon']} {report.tier_data['label']} "
            f"— {d.get('total_products', '?')} products found"
        )
        if d.get("switch_demand") == "high":
            lines.append(f"    HIGH switch demand — many people searching for alternatives")
        elif d.get("switch_demand") == "medium":
            lines.append(f"    Moderate switch demand — some alternative seekers")

    lines.append("")
    lines.append("IMPORTANT: Factor competition into your recommendations.")
    lines.append("Blue Ocean = build fast. Saturated = need unique angle or avoid.")
    lines.append("High switch demand + many competitors = people hate existing tools = OPPORTUNITY.")

    return "\n".join(lines)


def competition_summary(reports: Dict[str, CompetitionReport]) -> dict:
    """Summary for storing in scan results."""
    if not reports:
        return {"available": False}

    summaries = []
    for kw, report in reports.items():
        summaries.append(report.to_dict())

    # Overall tier = worst tier across keywords (most conservative)
    tier_order = ["BLUE_OCEAN", "EMERGING", "COMPETITIVE", "SATURATED"]
    tiers = [r.tier for r in reports.values()]
    worst_idx = max(tier_order.index(t) for t in tiers)

    return {
        "available": True,
        "overall_tier": tier_order[worst_idx],
        "keywords": summaries,
    }


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  Competition Analyzer Test")
    print("=" * 60)

    results = analyze_competition(["invoice software", "time tracking freelancer"])
    for kw, report in results.items():
        d = report.to_dict()
        print(f"\n  {d['icon']} {kw}: {d['label']}")
        print(f"  G2 products: {d['g2_products']}")
        print(f"  PH launches: {d['ph_launches']}")
        print(f"  Alt searches: {d['alternatives_searches']}")
        print(f"  Switch demand: {d['switch_demand']}")

    print(f"\n  Prompt section:")
    print(competition_prompt_section(results))
