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


# ═══════════════════════════════════════════════════════
# KNOWN COMPETITORS DATABASE
# Static but structured — match triggers, inject known data,
# then augment with Google discovery on top.
# ═══════════════════════════════════════════════════════
KNOWN_COMPETITORS = {
    "code_review": {
        "triggers": ["code review", "PR review", "pull request", "code quality",
                     "code linting", "static analysis", "code analysis"],
        "competitors": [
            {"name": "Coderabbit", "price": "$19/mo", "weakness": "expensive for solo devs", "users": "10,000+"},
            {"name": "GitHub Copilot PR", "price": "$10/mo", "weakness": "GitHub-only, limited explanations", "users": "1.3M"},
            {"name": "PR-Agent (CodiumAI)", "price": "free/open source", "weakness": "complex self-hosted setup", "users": "5,000+"},
            {"name": "CodeClimate", "price": "$16/mo", "weakness": "no AI explanations", "users": "unknown"},
            {"name": "SonarQube", "price": "free tier + $150/mo", "weakness": "enterprise-focused, complex", "users": "300,000+"},
            {"name": "CodeFactor", "price": "free tier + $7/mo", "weakness": "limited AI capabilities", "users": "unknown"},
        ],
        "saturation": "HIGH",
        "wtp_floor": "$10",
        "wtp_ceiling": "$50",
    },
    "invoice_automation": {
        "triggers": ["invoice", "billing", "payment automation", "accounts receivable",
                     "invoicing", "billing software"],
        "competitors": [
            {"name": "FreshBooks", "price": "$17/mo", "weakness": "no multi-currency for small plans", "users": "30M"},
            {"name": "Wave", "price": "free", "weakness": "limited integrations", "users": "unknown"},
            {"name": "QuickBooks", "price": "$30/mo", "weakness": "expensive, complex for solo", "users": "7M"},
            {"name": "Stripe Invoicing", "price": "0.4% per invoice", "weakness": "developer-focused", "users": "unknown"},
            {"name": "Zoho Invoice", "price": "free tier + $9/mo", "weakness": "ecosystem lock-in", "users": "unknown"},
        ],
        "saturation": "HIGH",
        "wtp_floor": "$17",
        "wtp_ceiling": "$50",
    },
    "project_management": {
        "triggers": ["project management", "task management", "kanban", "sprint",
                     "agile tool", "team collaboration", "project tracking"],
        "competitors": [
            {"name": "Linear", "price": "$8/mo", "weakness": "developer-focused only", "users": "10,000+"},
            {"name": "Jira", "price": "free tier + $8/mo", "weakness": "bloated, slow, hated UX", "users": "10M+"},
            {"name": "Notion", "price": "free tier + $10/mo", "weakness": "jack of all trades, master of none", "users": "30M+"},
            {"name": "Asana", "price": "free tier + $11/mo", "weakness": "complex for small teams", "users": "100K+"},
            {"name": "Trello", "price": "free tier + $5/mo", "weakness": "limited beyond basic kanban", "users": "50M+"},
        ],
        "saturation": "SATURATED",
        "wtp_floor": "$5",
        "wtp_ceiling": "$20",
    },
    "email_marketing": {
        "triggers": ["email marketing", "newsletter", "email automation",
                     "drip campaign", "email platform"],
        "competitors": [
            {"name": "Mailchimp", "price": "free tier + $13/mo", "weakness": "expensive at scale", "users": "12M"},
            {"name": "ConvertKit", "price": "$29/mo", "weakness": "expensive for beginners", "users": "500K"},
            {"name": "Beehiiv", "price": "free tier + $49/mo", "weakness": "newsletter-only focus", "users": "unknown"},
            {"name": "Resend", "price": "free tier + $20/mo", "weakness": "developer-focused, no visual builder", "users": "unknown"},
        ],
        "saturation": "HIGH",
        "wtp_floor": "$13",
        "wtp_ceiling": "$99",
    },
    "social_media": {
        "triggers": ["social media management", "social scheduling", "content calendar",
                     "social media tool", "post scheduler"],
        "competitors": [
            {"name": "Buffer", "price": "free tier + $6/mo", "weakness": "limited analytics", "users": "140K"},
            {"name": "Hootsuite", "price": "$99/mo", "weakness": "expensive, bloated", "users": "18M"},
            {"name": "Later", "price": "$25/mo", "weakness": "Instagram-focused", "users": "7M"},
            {"name": "Typefully", "price": "$15/mo", "weakness": "Twitter/X focus only", "users": "unknown"},
        ],
        "saturation": "HIGH",
        "wtp_floor": "$6",
        "wtp_ceiling": "$99",
    },
    "landing_page": {
        "triggers": ["landing page", "website builder", "no-code website",
                     "page builder", "conversion page"],
        "competitors": [
            {"name": "Carrd", "price": "$19/yr", "weakness": "single-page only", "users": "unknown"},
            {"name": "Webflow", "price": "$14/mo", "weakness": "steep learning curve", "users": "3.5M"},
            {"name": "Framer", "price": "free tier + $15/mo", "weakness": "limited CMS", "users": "unknown"},
            {"name": "Unbounce", "price": "$99/mo", "weakness": "very expensive", "users": "15K"},
        ],
        "saturation": "HIGH",
        "wtp_floor": "$14",
        "wtp_ceiling": "$99",
    },
    "customer_support": {
        "triggers": ["customer support", "help desk", "ticket system",
                     "support tool", "customer service tool", "live chat"],
        "competitors": [
            {"name": "Zendesk", "price": "$19/mo", "weakness": "expensive, complex setup", "users": "100K+"},
            {"name": "Intercom", "price": "$74/mo", "weakness": "very expensive for startups", "users": "25K"},
            {"name": "Crisp", "price": "free tier + $25/mo", "weakness": "limited automation", "users": "500K"},
            {"name": "Freshdesk", "price": "free tier + $15/mo", "weakness": "clunky UI", "users": "60K"},
        ],
        "saturation": "HIGH",
        "wtp_floor": "$15",
        "wtp_ceiling": "$99",
    },
}


def match_known_competitors(idea_text: str) -> Optional[dict]:
    """
    Match idea text against KNOWN_COMPETITORS triggers.
    Returns the matched category data or None.
    """
    idea_lower = idea_text.lower()
    for category, data in KNOWN_COMPETITORS.items():
        for trigger in data["triggers"]:
            if trigger.lower() in idea_lower:
                print(f"    [COMP] Matched known category: {category} (trigger: '{trigger}')")
                return data
    return None


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


def analyze_competition(keywords: List[str], idea_text: str = "") -> Dict[str, CompetitionReport]:
    """
    Analyze competition for a list of keywords.
    Matches KNOWN_COMPETITORS first. If matched, returns immediately — skips
    Google search entirely to avoid timeout-induced BLUE_OCEAN false positives.
    Only falls through to Google if no known category matched.
    """
    results = {}

    # Step 1: Check known competitors database
    known_match = match_known_competitors(idea_text) if idea_text else None
    if known_match:
        # Inject known competitors as a synthetic report
        known_comp = known_match["competitors"]
        saturation = known_match["saturation"]
        tier_map = {"HIGH": "SATURATED", "MEDIUM": "COMPETITIVE", "LOW": "EMERGING"}
        tier = tier_map.get(saturation, "COMPETITIVE")

        report = CompetitionReport("known_database", tier, {
            "g2_products": len(known_comp) * 5,  # synthetic count
            "ph_launches": len(known_comp) * 3,
            "total_products": len(known_comp) * 8,
            "alternatives_searches": 50000,
            "switch_demand": "high",
            "known_competitors": known_comp,
            "wtp_floor": known_match.get("wtp_floor", "unknown"),
            "wtp_ceiling": known_match.get("wtp_ceiling", "unknown"),
            "source": "known_database",
        })
        results["known_database"] = report
        print(f"    [COMP] {report}")
        # ── Short-circuit: known database is accurate, skip Google ──
        # Google often times out and returns 0 products (BLUE_OCEAN), which directly
        # contradicts our curated known competitor data and confuses the AI models.
        print(f"    [COMP] Known category matched — skipping Google search to avoid timeout contamination")
        return results

    # Step 2: Google discovery for each keyword (only when no known category matched)
    for kw in keywords:
        print(f"    [COMP] Checking competition for: '{kw}'...")

        g2 = _count_g2_products(kw)
        time.sleep(2)
        ph = _count_ph_launches(kw)
        time.sleep(2)
        alt = _count_alternatives_searches(kw)
        time.sleep(2)

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


def competition_prompt_section(reports: Dict[str, CompetitionReport], idea_text: str = "") -> str:
    """Generate prompt section for AI synthesis, including known competitor data."""
    if not reports:
        return ""

    lines = ["COMPETITION ANALYSIS (auto-detected):"]

    # Known competitors section
    known_match = match_known_competitors(idea_text) if idea_text else None
    if known_match:
        lines.append("")
        lines.append("KNOWN COMPETITORS IN THIS SPACE:")
        for comp in known_match["competitors"]:
            lines.append(
                f"  - {comp['name']}: {comp['price']} "
                f"(weakness: {comp['weakness']}, users: {comp['users']})"
            )
        lines.append(f"  Market WTP floor: {known_match.get('wtp_floor', '?')}/mo")
        lines.append(f"  Market WTP ceiling: {known_match.get('wtp_ceiling', '?')}/mo")
        lines.append(f"  Market saturation: {known_match.get('saturation', '?')}")
        lines.append("")

    for kw, report in reports.items():
        if kw == "known_database":
            continue  # already shown above
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
    if known_match:
        lines.append(f"Use competitor pricing ({known_match.get('wtp_floor', '?')}-{known_match.get('wtp_ceiling', '?')}/mo) as WTP evidence.")

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
