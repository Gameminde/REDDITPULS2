"""
RedditPulse — Idea Validator (Multi-Brain Edition)
3-Phase Pipeline using AIBrain debate engine:
  Phase 1: AI Decomposition (idea → keywords, competitors, audience, pain)
  Phase 2: Market Scraping (keywords → Reddit + HN posts)
  Phase 3: AI Synthesis via Multi-Model Debate (posts + idea → verdict + report)
"""

import os
import sys
import json
import time
import re
import argparse
import traceback
import requests

# Add engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "engine"))

from keyword_scraper import run_keyword_scan
from multi_brain import AIBrain, get_user_ai_configs, extract_json

# ── Scraper imports (graceful fallback if any missing) ──
try:
    from hn_scraper import run_hn_scrape
    HN_AVAILABLE = True
except ImportError:
    HN_AVAILABLE = False

try:
    from ph_scraper import run_ph_scrape
    PH_AVAILABLE = True
except ImportError:
    PH_AVAILABLE = False

try:
    from ih_scraper import run_ih_scrape
    IH_AVAILABLE = True
except ImportError:
    IH_AVAILABLE = False

# ── Intelligence imports ──
try:
    from trends import analyze_keywords, trend_summary_for_report
    TRENDS_AVAILABLE = True
except ImportError:
    TRENDS_AVAILABLE = False

try:
    from competition import analyze_competition, competition_prompt_section, competition_summary
    COMPETITION_AVAILABLE = True
except ImportError:
    COMPETITION_AVAILABLE = False

try:
    from icp import build_icp
    ICP_AVAILABLE = True
except ImportError:
    ICP_AVAILABLE = False

# ── Supabase config ──
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_KEY", ""))


def _supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def update_validation(validation_id, updates, retries=3):
    """Update idea_validations row in Supabase. Retries on transient network errors.
    
    ECONNRESET mid-run was leaving status stuck at 'queued' in Supabase,
    causing the frontend poller to always see phase=0 and show 'Starting'.
    """
    url = f"{SUPABASE_URL}/rest/v1/idea_validations?id=eq.{validation_id}"
    last_err = None
    for attempt in range(retries):
        try:
            r = requests.patch(url, json=updates, headers=_supabase_headers(), timeout=15)
            if r.status_code >= 400:
                print(f"  [!] Supabase update error: {r.status_code} {r.text[:200]}")
            return  # success
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                wait = 2 ** attempt  # 1s, 2s backoff
                print(f"  [!] Supabase update failed (attempt {attempt+1}/{retries}), retrying in {wait}s: {e}")
                time.sleep(wait)
    print(f"  [!] Supabase update gave up after {retries} attempts: {last_err}")


# ═══════════════════════════════════════════════════════
# PHASE 1: AI DECOMPOSITION
# ═══════════════════════════════════════════════════════

DECOMPOSE_SYSTEM = """You are a startup market research expert. Given a startup idea description, extract the essential components needed to validate it through market research.

Return ONLY valid JSON with this exact structure:
{
  "keywords": ["keyword1", "keyword2", ...],
  "competitors": ["Competitor1", "Competitor2", ...],
  "audience": "Description of target audience",
  "pain_hypothesis": "The core pain point this solves",
  "search_queries": ["reddit search query 1", "reddit search query 2", ...]
}

RULES:
- keywords MUST be SHORT (1-3 words max). Reddit search works best with short phrases.
  GOOD keywords: "code review", "PR review", "pull request", "code quality", "code linting"
  BAD keywords: "AI-powered code review tool for small teams", "automated pull request review system"
- Generate 8-12 short keywords covering: the pain, the solution category, and adjacent tool names
- Include both specific tool names and SHORT pain phrases ("slow reviews", "code bugs", "manual testing")
- Competitors should be existing tools that partially solve this problem (include 5-8)
- search_queries can be slightly longer (3-6 words) for targeted Reddit searches
- Keep all strings concise and search-engine friendly
"""


def phase1_decompose(idea_text, brain, validation_id):
    """Phase 1: Extract keywords, competitors, audience from idea text."""
    print("\n  ══ PHASE 1: AI Decomposition ══")
    update_validation(validation_id, {"status": "decomposing"})

    prompt = f"""Analyze this startup idea and extract the key components for market validation:

IDEA: {idea_text}

Extract keywords people would search for when experiencing this pain, list existing competitors, identify the target audience, and state the core pain hypothesis."""

    # Use single call for decomposition (no debate needed here)
    raw = brain.single_call(prompt, DECOMPOSE_SYSTEM)
    data = extract_json(raw)

    keywords = data.get("keywords", []) + data.get("search_queries", [])
    seen = set()
    unique_keywords = []
    for k in keywords:
        kl = k.lower().strip()
        if kl not in seen:
            seen.add(kl)
            unique_keywords.append(k)

    result = {
        "keywords": unique_keywords[:15],
        "competitors": data.get("competitors", []),
        "audience": data.get("audience", ""),
        "pain_hypothesis": data.get("pain_hypothesis", ""),
    }

    update_validation(validation_id, {
        "status": "decomposed",
        "extracted_keywords": result["keywords"],
        "extracted_competitors": result["competitors"],
        "extracted_audience": result["audience"],
        "pain_hypothesis": result["pain_hypothesis"],
    })

    print(f"  [✓] Keywords: {result['keywords']}")
    print(f"  [✓] Competitors: {result['competitors']}")
    print(f"  [✓] Audience: {result['audience']}")
    return result


# ═══════════════════════════════════════════════════════
# SIGNAL WEIGHTING (platform authority × score × recency)
# ═══════════════════════════════════════════════════════

PLATFORM_WEIGHTS = {
    "reddit": 1.0,
    "hackernews": 1.5,     # Higher-quality technical audience
    "producthunt": 1.3,    # Launch signals, maker audience
    "indiehackers": 1.2,   # Revenue-focused founders
}


def _compute_weighted_score(post):
    """Weight posts by platform authority × score × recency decay."""
    raw_score = max(post.get("score", 0), 1)
    platform = post.get("source", "reddit").lower()
    platform_w = PLATFORM_WEIGHTS.get(platform, 1.0)

    # Recency decay: last 7 days = 1.0x, 30 days = 0.7x, older = 0.4x
    from datetime import datetime, timedelta
    post_date = post.get("created_utc", 0)
    if post_date and isinstance(post_date, (int, float)) and post_date > 0:
        try:
            age_days = (datetime.utcnow() - datetime.utcfromtimestamp(post_date)).days
        except (OSError, ValueError):
            age_days = 30
    else:
        age_days = 30  # assume 30 days if no date

    recency = 1.0 if age_days <= 7 else (0.7 if age_days <= 30 else 0.4)

    return round(raw_score * platform_w * recency, 1)


# ═══════════════════════════════════════════════════════
# PHASE 2: MARKET SCRAPING
# ═══════════════════════════════════════════════════════

def phase2_scrape(keywords, validation_id):
    """Phase 2: Scrape ALL platforms for market signals."""
    print("\n  ══ PHASE 2: Market Scraping (All Platforms) ══")
    update_validation(validation_id, {"status": "scraping", "posts_found": 0})

    def on_progress(count, msg):
        update_validation(validation_id, {"posts_found": count, "status": "scraping"})

    scrape_keywords = keywords[:8]
    source_counts = {}
    platform_warnings = []  # Track platforms that returned 0 results or were unavailable

    # ── Reddit ──
    print(f"  [>] Scraping Reddit for: {scrape_keywords}")
    reddit_posts = run_keyword_scan(scrape_keywords, duration="10min", on_progress=on_progress)
    source_counts["reddit"] = len(reddit_posts)
    print(f"  [✓] Reddit: {len(reddit_posts)} posts")
    if len(reddit_posts) == 0:
        platform_warnings.append({"platform": "reddit", "issue": "0 posts returned — Reddit scraping may have been rate-limited or keywords too niche"})

    # ── Hacker News ──
    hn_posts = []
    if HN_AVAILABLE:
        print("  [>] Scraping Hacker News...")
        try:
            hn_posts = run_hn_scrape(scrape_keywords, max_pages=2)
            source_counts["hackernews"] = len(hn_posts)
            print(f"  [✓] HN: {len(hn_posts)} posts")
            if len(hn_posts) == 0:
                platform_warnings.append({"platform": "hackernews", "issue": "0 posts returned — keywords may not match HN discourse"})
        except Exception as e:
            print(f"  [!] HN scrape failed: {e}")
            platform_warnings.append({"platform": "hackernews", "issue": f"Scrape failed: {str(e)[:100]}"})
    else:
        platform_warnings.append({"platform": "hackernews", "issue": "Scraper not available (hn_scraper module missing)"})

    # ── ProductHunt ──
    ph_posts = []
    if PH_AVAILABLE:
        print("  [>] Scraping ProductHunt...")
        try:
            ph_posts = run_ph_scrape(scrape_keywords, max_pages=2)
            source_counts["producthunt"] = len(ph_posts)
            print(f"  [✓] ProductHunt: {len(ph_posts)} posts")
            if len(ph_posts) == 0:
                platform_warnings.append({
                    "platform": "producthunt",
                    "issue": "Limited to RSS fallback — GraphQL API requires auth (403). 0 posts returned. Data from Reddit+HN only."
                })
            elif len(ph_posts) <= 2:
                platform_warnings.append({
                    "platform": "producthunt",
                    "issue": f"Only {len(ph_posts)} post(s) from RSS fallback — GraphQL requires auth. Coverage is minimal."
                })
        except Exception as e:
            print(f"  [!] ProductHunt scrape failed: {e}")
            platform_warnings.append({"platform": "producthunt", "issue": f"Scrape error (infra): {str(e)[:100]}"})
    else:
        platform_warnings.append({"platform": "producthunt", "issue": "Scraper not available (ph_scraper module missing)"})

    # ── IndieHackers ──
    ih_posts = []
    if IH_AVAILABLE:
        print("  [>] Scraping IndieHackers...")
        try:
            ih_posts = run_ih_scrape(scrape_keywords, max_pages=2)
            source_counts["indiehackers"] = len(ih_posts)
            print(f"  [✓] IndieHackers: {len(ih_posts)} posts")
            if len(ih_posts) == 0:
                platform_warnings.append({
                    "platform": "indiehackers",
                    "issue": "Algolia API blocked (connection error on all retry attempts). 0 posts returned. Analysis based on Reddit+HN only."
                })
        except Exception as e:
            print(f"  [!] IndieHackers scrape failed: {e}")
            platform_warnings.append({"platform": "indiehackers", "issue": f"Scrape error (infra): {str(e)[:100]}"})
    else:
        platform_warnings.append({"platform": "indiehackers", "issue": "Scraper not available (ih_scraper module missing)"})

    # ── Merge + deduplicate + WEIGHT ──
    all_posts = reddit_posts + hn_posts + ph_posts + ih_posts

    # Apply signal weighting before dedup
    for p in all_posts:
        p["weighted_score"] = _compute_weighted_score(p)

    seen_titles = set()
    unique_posts = []
    for p in all_posts:
        title_key = p.get("title", "").lower().strip()[:200]
        if title_key and title_key not in seen_titles:
            seen_titles.add(title_key)
            unique_posts.append(p)

    # Sort by weighted score — AI sees highest-signal posts first
    unique_posts.sort(key=lambda p: p.get("weighted_score", 0), reverse=True)

    platforms_used = len([k for k, v in source_counts.items() if v > 0])
    update_validation(validation_id, {
        "status": "scraped",
        "posts_found": len(unique_posts),
    })

    # ── Log warnings ──
    if platform_warnings:
        print(f"  [⚠] Platform warnings ({len(platform_warnings)}):")
        for w in platform_warnings:
            print(f"       {w['platform']}: {w['issue']}")

    print(f"  [✓] Total unique posts: {len(unique_posts)} from {platforms_used} platforms")
    print(f"  [✓] Sources: {source_counts}")
    return unique_posts, source_counts, platform_warnings


def phase2b_intelligence(keywords, validation_id, idea_text=""):
    """Phase 2b: Google Trends + Competition Analysis."""
    intel = {"trends": None, "competition": None, "trend_prompt": "", "comp_prompt": ""}

    # ── Google Trends ──
    if TRENDS_AVAILABLE:
        print("\n  ══ PHASE 2b: Google Trends Analysis ══")
        update_validation(validation_id, {"status": "analyzing_trends"})
        try:
            trend_keywords = keywords[:5]  # Top 5 keywords for trends
            trend_results = analyze_keywords(trend_keywords)
            trend_report = trend_summary_for_report(trend_results)
            intel["trends"] = trend_report

            # Build prompt section
            growing = [k for k, v in trend_results.items() if v.tier in ("EXPLODING", "GROWING")]
            declining = [k for k, v in trend_results.items() if v.tier in ("DECLINING", "DEAD")]
            stable = [k for k, v in trend_results.items() if v.tier == "STABLE"]

            lines = ["\n--- GOOGLE TRENDS DATA ---"]
            for kw, r in trend_results.items():
                lines.append(f"  {kw}: {r.tier} ({r.change_pct:+.0f}% change, current interest: {r.current_interest})")
            if growing:
                lines.append(f"  Growing keywords: {', '.join(growing)}")
            if declining:
                lines.append(f"  Declining keywords: {', '.join(declining)}")
            intel["trend_prompt"] = "\n".join(lines)

            print(f"  [✓] Trends: {len(trend_results)} keywords analyzed")
            print(f"      Growing: {growing}, Declining: {declining}, Stable: {stable}")
        except Exception as e:
            print(f"  [!] Trends analysis failed: {e}")
    else:
        print("  [!] Trends module not available (install pytrends: pip install pytrends)")

    # ── Competition Analysis ──
    if COMPETITION_AVAILABLE:
        print("\n  ══ PHASE 2c: Competition Analysis ══")
        update_validation(validation_id, {"status": "analyzing_competition"})
        try:
            comp_keywords = keywords[:3]  # Top 3 for competition
            comp_results = analyze_competition(comp_keywords, idea_text=idea_text)
            comp_report = competition_summary(comp_results)
            intel["competition"] = comp_report
            intel["comp_prompt"] = competition_prompt_section(comp_results, idea_text=idea_text)
            print(f"  [✓] Competition: {len(comp_results)} keywords analyzed")
            for kw, r in comp_results.items():
                print(f"      {kw}: {r.tier} ({r.details})")
        except Exception as e:
            print(f"  [!] Competition analysis failed: {e}")

    return intel


# ═══════════════════════════════════════════════════════
# PHASE 3: MULTI-PASS AI SYNTHESIS (3 focused passes + debate verdict)
# ═══════════════════════════════════════════════════════
#
# WHY 3 PASSES: Groq Llama caps at 8192 output tokens. A single prompt
# requesting 12 sections runs out of space. Each pass focuses on 3-4
# sections and stays well under the limit. The FINAL VERDICT uses the
# debate engine so all models weigh in.

PASS1_SYSTEM = """You are a market research analyst. Given scraped posts from Reddit, Hacker News, ProductHunt, and IndieHackers, analyze the MARKET signal.

Return ONLY valid JSON:
{
  "pain_validated": true/false,
  "pain_description": "The EXACT pain people are expressing. Quote specific phrases from posts.",
  "pain_frequency": "daily/weekly/monthly — how often this complaint appears",
  "pain_intensity": "LOW/MEDIUM/HIGH — based on frustration language, urgency words",
  "willingness_to_pay": "SPECIFIC price signals. Quote exact statements like 'I'd pay $X'. If none found, say 'No explicit WTP signals found'",
  "market_timing": "GROWING/STABLE/DECLINING — reference the trend data if available",
  "tam_estimate": "Total Addressable Market rough estimate with reasoning",
  "evidence": [
    {"post_title": "Exact post title from the data", "source": "reddit/hn/ph/ih", "score": 123, "what_it_proves": "Specific insight this post provides"},
    {"post_title": "Another exact title", "source": "reddit/hn/ph/ih", "score": 456, "what_it_proves": "Another insight"}
  ]
}

RULES:
- Include AT LEAST 15 evidence posts. More is better. Quote exact titles from the scraped data.
- NEVER invent post titles. Only cite what appears in the data.
- For WTP, search for dollar amounts, "I'd pay", "take my money", "shut up and take", pricing discussions.
- Be specific with TAM — reference subreddit subscriber counts, post frequency, industry size.
"""

PASS2_SYSTEM = """You are a startup strategist. Given the market analysis results and competition data, design the STRATEGY.

Return ONLY valid JSON:
{
  "ideal_customer_profile": {
    "primary_persona": "WHO exactly — job title, industry, company size, daily workflow",
    "demographics": "Age range, income level, tech savviness, geographic focus",
    "psychographics": "Motivations, frustrations, values, buying behavior",
    "where_they_hang_out": ["Specific subreddits", "forums", "communities", "Slack groups"],
    "budget_range": "$X-$Y per month — based on evidence",
    "buying_triggers": ["Event that makes them search for a solution", "Trigger 2", "Trigger 3"]
  },
  "competition_landscape": {
    "direct_competitors": [
      {"name": "Tool name", "weakness": "Specific weakness from complaints", "price": "$X/mo", "users": "estimated user count"}
    ],
    "indirect_competitors": ["Tool 1 — and why it's indirect", "Tool 2"],
    "market_saturation": "EMPTY/LOW/MEDIUM/HIGH",
    "your_unfair_advantage": "The specific gap NO competitor fills. Be concrete.",
    "moat_strategy": "How to build a defensible competitive advantage over 12 months"
  },
  "pricing_strategy": {
    "recommended_model": "freemium/subscription/one-time/usage-based",
    "tiers": [
      {"name": "Free", "price": "$0", "features": ["Feature 1", "Feature 2"], "purpose": "Acquisition hook"},
      {"name": "Pro", "price": "$X/mo", "features": ["Feature 1", "Feature 2"], "purpose": "Core revenue"},
      {"name": "Team/Enterprise", "price": "$X/mo", "features": ["Feature 1", "Feature 2"], "purpose": "Expansion revenue"}
    ],
    "reasoning": "Why this pricing based on competitor pricing and WTP signals"
  },
  "monetization_channels": [
    {"channel": "Primary revenue method", "description": "Exactly how it works", "timeline": "When revenue starts"},
    {"channel": "Secondary method", "description": "How it works", "timeline": "When"},
    {"channel": "Tertiary method", "description": "How it works", "timeline": "When"}
  ]
}

RULES:
- Reference SPECIFIC competitor names, prices, and weaknesses from the data.
- Pricing tiers must have concrete dollar amounts, not placeholders.
- ICP must be specific enough to write a cold email to this person.
- Moat strategy must be actionable, not generic "build a great product".
- Geographic focus in ICP must be EVIDENCE-BASED from the post data. If no geographic signal exists in scraped posts, say "Global (remote-first)". NEVER hallucinate specific regions like "small towns" without data to support it.
"""

PASS3_SYSTEM = """You are a startup launch advisor. Given the market analysis and strategy, create the ACTION PLAN.

Return ONLY valid JSON:
{
  "launch_roadmap": [
    {"week": "Week 1-2", "title": "Validate & Build MVP", "tasks": ["Specific task 1", "Task 2", "Task 3"], "cost": "$0-$X", "outcome": "What you'll have"},
    {"week": "Week 3-4", "title": "Alpha Launch", "tasks": ["Task 1", "Task 2"], "cost": "$X", "outcome": "What you'll have"},
    {"week": "Week 5-6", "title": "Early Access", "tasks": ["Task 1", "Task 2"], "cost": "$X", "outcome": "What you'll have"},
    {"week": "Week 7-8", "title": "Public Launch", "tasks": ["Task 1", "Task 2"], "cost": "$X", "outcome": "What you'll have"},
    {"week": "Month 3-6", "title": "Growth", "tasks": ["Task 1", "Task 2"], "cost": "$X/mo", "outcome": "Target MRR"}
  ],
  "revenue_projections": {
    "month_1": {"users": "X", "paying": "X", "mrr": "$X", "assumptions": "Based on..."},
    "month_3": {"users": "X", "paying": "X", "mrr": "$X", "assumptions": "Based on..."},
    "month_6": {"users": "X", "paying": "X", "mrr": "$X", "assumptions": "Based on..."},
    "month_12": {"users": "X", "paying": "X", "mrr": "$X", "assumptions": "Based on..."}
  },
  "risk_matrix": [
    {"risk": "Specific risk", "severity": "HIGH/MEDIUM/LOW", "likelihood": "HIGH/MEDIUM/LOW", "mitigation": "Exact steps to handle it"},
    {"risk": "Another risk", "severity": "HIGH/MEDIUM/LOW", "likelihood": "HIGH/MEDIUM/LOW", "mitigation": "Steps"},
    {"risk": "Third risk", "severity": "HIGH/MEDIUM/LOW", "likelihood": "HIGH/MEDIUM/LOW", "mitigation": "Steps"}
  ],
  "first_10_customers_strategy": {
    "step_1": "First action — be hyper-specific (which subreddit, what to post, word for word)",
    "step_2": "Second action — outreach method, exact message template",
    "step_3": "Third action — partnership or community tactic",
    "step_4": "Fourth action — content or demo strategy",
    "step_5": "Conversion tactic — how to turn free users into paying"
  },
  "mvp_features": ["Core feature 1 (must have for launch)", "Core feature 2", "Core feature 3", "Core feature 4"],
  "cut_features": ["Feature that seems important but wastes time pre-launch", "Another one", "Third one"]
}

RULES:
- Launch roadmap must have REAL costs (domain, hosting, tools), REAL timelines, REAL tasks.
- Revenue projections must state assumptions. NEVER use 'based on continued growth' or circular reasoning.
  Each month's assumptions must cite a SPECIFIC comparable (e.g. 'similar to Grammarly's free-to-paid rate of 3%').
  If no comparable exists, say 'conservative assumption — no comparable found'.
  Use CONSERVATIVE estimates unless the data explicitly shows strong WTP.
- Risk matrix RULES (CRITICAL):
  * Each risk MUST name a specific competitor, technology, or real market condition — not a category.
  * BAD: 'Market competition risk' | GOOD: 'GitHub Copilot has 1.3M users at $10/mo — direct price overlap'
  * BAD: 'Technical debt' | GOOD: 'Real-time diff engine at scale: N+1 DB queries become critical at 1k concurrent users'
  * FORBIDDEN phrases in risks: 'Market competition', 'Technical debt', 'User adoption', 'unique features', 'differentiate', 'repayment'.
  * Must include: 1 risk naming a specific named competitor with market share/price data, 1 platform/infra risk with specific failure mode, 1 go-to-market risk citing a specific channel and why it may fail.
- First 10 customers: name SPECIFIC subreddits, communities, exact outreach templates.
- MVP features: max 4-5 features. Everything else is a cut feature.
"""

VERDICT_SYSTEM = """You are a venture analyst delivering a final verdict on a startup idea. You've been given the full analysis (market data, strategy, action plan, and scraped posts). Synthesize into a final decision.

Return ONLY valid JSON:
{
  "verdict": "BUILD IT" or "RISKY" or "DON'T BUILD",
  "confidence": 0-100,
  "executive_summary": "4-5 sentence summary. Include: post count, platforms analyzed, trend direction, competition level, key WTP signals, and your honest recommendation. Be direct and data-driven.",
  "evidence": [
    {"post_title": "Exact post title from the scraped data", "source": "reddit/hn/ph/ih", "score": 123, "what_it_proves": "Specific market signal this post reveals"},
    {"post_title": "Another exact title", "source": "reddit/hn/ph/ih", "score": 456, "what_it_proves": "Another insight from this post"}
  ],
  "risk_factors": [
    "Market risk: specific description with real data point",
    "Technical risk: specific challenge with mitigation hint",
    "Execution risk: specific bottleneck or dependency"
  ],
  "top_posts": [
    {"title": "Most important post title", "source": "platform", "score": 123, "relevance": "Why this post matters for the decision"},
    {"title": "Second post", "source": "platform", "score": 456, "relevance": "Why important"}
  ],
  "suggestions": [
    "Specific first action for the founder",
    "Second actionable suggestion"
  ]
}

RULES:
- evidence: MINIMUM 10 posts. Quote EXACT titles from the posts you were given. NEVER invent titles.
- risk_factors: MINIMUM 3 risks — at least one market risk, one technical risk, one execution risk.
- top_posts: Pick the 10-20 most impactful posts from the data. More is better.
- SCORING: "BUILD IT" = strong signal (50+ posts, multi-platform, WTP mentions, growing trends, clear gaps). "RISKY" = moderate signal (20-50 posts, few WTP, unclear differentiation, mixed trends). "DON'T BUILD" = weak signal (<20 posts, no WTP, saturated, declining trends).
- Be BRUTALLY honest. The founder wants truth that makes money, not encouragement that wastes time.
"""


# ═══════════════════════════════════════════════════════
# DATA QUALITY & CONTRADICTION DETECTION
# ═══════════════════════════════════════════════════════

def _check_data_quality(posts, source_counts, pass1, pass2, pass3,
                         platform_warnings=None):
    """
    Cross-check data quality and detect contradictions between passes.
    Returns a dict with confidence_cap, contradictions list, and warnings list.
    """
    platform_warnings = platform_warnings or []
    contradictions = []
    warnings = []
    confidence_cap = 100  # Start at max, reduce based on issues
    cap_reason = "No issues detected"

    total_posts = len(posts)
    platforms_with_data = len([k for k, v in source_counts.items() if v > 0])

    # ── FIX 1: Minimum post threshold ──
    if total_posts < 5:
        confidence_cap = min(confidence_cap, 30)
        cap_reason = f"Only {total_posts} posts scraped (need 20+ for reliable analysis)"
        warnings.append(f"CRITICAL: Only {total_posts} posts found — analysis is based on extremely thin data")
    elif total_posts < 10:
        confidence_cap = min(confidence_cap, 45)
        cap_reason = f"Only {total_posts} posts scraped (need 20+ for reliable analysis)"
        warnings.append(f"LOW DATA: Only {total_posts} posts found — confidence should be significantly penalized")
    elif total_posts < 20:
        confidence_cap = min(confidence_cap, 65)
        cap_reason = f"Only {total_posts} posts scraped (need 20+ for full confidence)"
        warnings.append(f"MODERATE DATA: {total_posts} posts found — below recommended minimum of 20")

    # Fix G: proportion-based platform balance (not just count)
    # A run with 547 HN + 1 Reddit = "2 platforms" but is 94% from one source
    total_scraped = sum(source_counts.values()) if source_counts else 0
    max_platform_posts = max(source_counts.values()) if source_counts else 0
    dominance = (max_platform_posts / total_scraped) if total_scraped > 0 else 1.0
    dominant_platform = max(source_counts, key=source_counts.get) if source_counts else "unknown"

    if platforms_with_data <= 1:
        confidence_cap = min(confidence_cap, 55)
        warnings.append(f"SINGLE SOURCE: Data from only {platforms_with_data} platform — multi-platform validation required for high confidence")
        if "only 1 platform" not in cap_reason.lower():
            cap_reason += f"; only {platforms_with_data} platform used"
    elif dominance > 0.85:
        confidence_cap = min(confidence_cap, 55)
        warnings.append(
            f"PLATFORM IMBALANCE: {dominance*100:.0f}% of posts from {dominant_platform} — "
            f"effectively single-source despite {platforms_with_data} platforms reporting"
        )
        if "platform imbalance" not in cap_reason.lower():
            cap_reason += f"; {dominance*100:.0f}% from {dominant_platform} (platform imbalance)"
    elif dominance > 0.70:
        warnings.append(
            f"PLATFORM SKEW: {dominance*100:.0f}% of posts from {dominant_platform} — "
            f"results may be biased toward {dominant_platform} audience"
        )

    # Log which platforms failed
    for pw in platform_warnings:
        warnings.append(f"Platform issue — {pw['platform']}: {pw['issue']}")

    # ── FIX 2: Contradiction detection ──

    # Contradiction: WTP says "no signals" but pricing gives specific dollar amounts
    wtp_text = str(pass1.get("willingness_to_pay", "")).lower()
    no_wtp_found = any(phrase in wtp_text for phrase in [
        "no explicit", "no wtp", "no signals", "not found", "no direct",
        "no mention", "no evidence", "no clear", "none found", "lacking",
    ])
    pricing = pass2.get("pricing_strategy", {})
    has_specific_pricing = bool(pricing.get("tiers")) and len(pricing.get("tiers", [])) > 1
    if no_wtp_found and has_specific_pricing:
        contradictions.append(
            "WTP MISMATCH: Market analysis found 'no WTP signals' but pricing strategy includes specific tiers/prices — "
            "pricing is theoretical, not evidence-based"
        )
        confidence_cap = min(confidence_cap, 60)

    # Contradiction: Pain not validated but verdict is BUILD IT
    pain_validated = pass1.get("pain_validated", False)
    if not pain_validated:
        warnings.append("Pain point was NOT validated by market data — all subsequent analysis builds on weak foundation")
        confidence_cap = min(confidence_cap, 50)

    # Contradiction: Pain intensity is LOW but pricing is high ($100+)
    pain_intensity = str(pass1.get("pain_intensity", "")).upper()
    tier_prices = []
    for tier in pricing.get("tiers", []):
        price_str = str(tier.get("price", ""))
        # Extract number from price string
        import re
        price_match = re.search(r'\$(\d+)', price_str)
        if price_match:
            tier_prices.append(int(price_match.group(1)))
    max_price = max(tier_prices) if tier_prices else 0
    if pain_intensity == "LOW" and max_price > 50:
        contradictions.append(
            f"PRICE vs PAIN: Pain intensity is LOW but highest priced tier is ${max_price}/mo — "
            "users rarely pay premium for low-pain solutions"
        )

    # Contradiction: Market timing is DECLINING but verdict says BUILD
    market_timing = str(pass1.get("market_timing", "")).upper()
    if "DECLINING" in market_timing or "DEAD" in market_timing:
        warnings.append(f"Market timing is {market_timing} — building in a declining market carries high risk")
        confidence_cap = min(confidence_cap, 55)

    # Contradiction: Few evidence posts cited vs claims of strong validation
    evidence_count = len(pass1.get("evidence", []))
    if evidence_count < 3:
        warnings.append(f"Only {evidence_count} evidence posts cited — insufficient for strong validation claims")
        confidence_cap = min(confidence_cap, 60)

    # Contradiction: Revenue projections assume unrealistic conversion rates
    # Fix D: normalize revenue_projections schema first — AI may use year_1/month1/etc.
    projections = pass3.get("revenue_projections", {})
    normalized_projections = {}
    for key, val in projections.items():
        if isinstance(val, dict) and any(m in key.lower() for m in ["month", "year", "quarter"]):
            normalized_projections[key] = val

    if not normalized_projections and projections:
        print(f"  [Q] CONVERSION check: no month/year keys found in projections schema {list(projections.keys())} — check skipped")
        warnings.append("CONVERSION check skipped — revenue_projections uses non-standard key schema")

    worst_conversion = {"rate": 0, "month": "", "users": 0, "paying": 0}
    for month_key, month_data in normalized_projections.items():
        if isinstance(month_data, dict):
            users_str = str(month_data.get("users", month_data.get("total_users", "0"))).replace(",", "")
            paying_str = str(month_data.get("paying", month_data.get("paying_users", month_data.get("customers", "0")))).replace(",", "")
            users_match = re.search(r'(\d+)', users_str)
            paying_match = re.search(r'(\d+)', paying_str)
            if users_match and paying_match:
                total_users = int(users_match.group(1))
                paying_users = int(paying_match.group(1))
                if total_users > 0:
                    rate = paying_users / total_users
                    if rate > worst_conversion["rate"]:
                        worst_conversion = {"rate": rate, "month": month_key, "users": total_users, "paying": paying_users}

    if worst_conversion["rate"] >= 0.10:
        contradictions.append(
            f"CONVERSION FANTASY: {worst_conversion['month']} projects {worst_conversion['rate']:.0%} conversion rate "
            f"({worst_conversion['paying']}/{worst_conversion['users']} users) — industry average is 2-5% for freemium B2B SaaS"
        )
    elif worst_conversion["rate"] >= 0.07:
        warnings.append(
            f"Optimistic conversion: {worst_conversion['month']} projects {worst_conversion['rate']:.0%} — above industry average of 2-5%"
        )

    # Competition check: if saturation is HIGH/MEDIUM but unfair advantage is vague
    comp = pass2.get("competition_landscape", {})
    saturation = str(comp.get("market_saturation", "")).upper()
    unfair_advantage = str(comp.get("your_unfair_advantage", ""))
    if saturation in ("HIGH", "MEDIUM") and len(unfair_advantage) < 50:
        warnings.append(
            f"WEAK DIFFERENTIATION: Market saturation is {saturation} but unfair advantage description "
            f"is only {len(unfair_advantage)} chars — needs concrete specifics"
        )

    return {
        "confidence_cap": confidence_cap,
        "cap_reason": cap_reason,
        "contradictions": contradictions,
        "warnings": warnings,
    }


def phase3_synthesize(idea_text, posts, decomposition, brain, validation_id,
                      source_counts=None, intel=None, **kwargs):
    """Phase 3: Multi-pass synthesis — 3 focused AI passes + debate verdict."""
    print("\n  ══ PHASE 3: Multi-Pass AI Synthesis ══")
    update_validation(validation_id, {"status": "synthesizing"})

    source_counts = source_counts or {}
    intel = intel or {}

    # ── Smart Sampling: top quality + random spread + outliers + recent ──
    def _smart_sample(all_posts: list, budget: int = 100) -> list:
        """
        Budget raised to 100 (was 50) — better coverage with same AI cost.
        Strategy (100 total):
          - Top 40 by score       → highest engagement / best signal
          - 10 most recent        → fresh market pulse
          - 35 random from rest   → prevents echo chamber bias
          - 15 outliers           → low-score but high-comment (hidden pain)
        """
        import random as _random
        if len(all_posts) <= budget:
            return all_posts

        # Bucket 1: top 40 by score
        sorted_by_score = sorted(all_posts, key=lambda p: p.get("score", 0), reverse=True)
        top_n = min(40, budget * 4 // 10)
        top_picks = sorted_by_score[:top_n]
        top_ids = {p.get("id", "") for p in top_picks}

        # Bucket 2: 10 most recent (by created_utc or date)
        remaining = [p for p in all_posts if p.get("id", "") not in top_ids]
        sorted_by_date = sorted(remaining, key=lambda p: p.get("created_utc", p.get("created_at", 0)), reverse=True)
        recent_picks = sorted_by_date[:10]
        recent_ids = {p.get("id", "") for p in recent_picks}

        # Bucket 3: outliers — low score, high comments (controversy/pain)
        remaining2 = [p for p in remaining if p.get("id", "") not in recent_ids]
        sorted_by_comments = sorted(remaining2, key=lambda p: p.get("num_comments", 0), reverse=True)
        outlier_candidates = [p for p in sorted_by_comments[:40] if p.get("score", 0) < 20]
        outlier_picks = outlier_candidates[:15]
        outlier_ids = {p.get("id", "") for p in outlier_picks}

        # Bucket 4: random from what's left
        random_pool = [p for p in remaining2 if p.get("id", "") not in outlier_ids]
        random_budget = budget - top_n - len(recent_picks) - len(outlier_picks)
        random_picks = _random.sample(random_pool, min(random_budget, len(random_pool)))

        sampled = top_picks + recent_picks + random_picks + outlier_picks
        print(f"  [Smart Sample] {len(sampled)} posts: {top_n} top + {len(recent_picks)} recent + {len(random_picks)} random + {len(outlier_picks)} outliers (from {len(all_posts)} total)")
        return sampled

    # ── Pre-filter: remove noise posts before sampling ──
    # Fix 3: Require at least 1 CORE keyword in the post TITLE specifically.
    # This eliminates posts that match on body text only (burnout, loneliness posts
    # that happen to mention 'developer' or 'code' but have zero idea relevance).
    MIN_SCORE = 3
    MIN_KW_HITS = 1
    core_keywords = [kw.lower() for kw in decomposition.get("keywords", [])]

    def _title_has_core_kw(p):
        """Returns True if the post title contains at least one core keyword."""
        title = (p.get("title", "") or "").lower()
        return any(kw in title for kw in core_keywords)

    def _relevance_score(p):
        kw_hits = len(p.get("matched_keywords", p.get("matched_phrases", [])))
        score = p.get("score", 0)
        source = p.get("source", p.get("subreddit", "")).lower()
        title_relevant = _title_has_core_kw(p)
        # All platforms: must pass score threshold AND have a core keyword in title
        # (HN posts previously bypassed this — they don't anymore)
        return score >= MIN_SCORE and (title_relevant or kw_hits >= 2)

    pre_filtered = [p for p in posts if _relevance_score(p)]
    print(f"  [Filter] {len(pre_filtered)}/{len(posts)} posts passed score≥{MIN_SCORE} + title-keyword filter", flush=True)
    if len(pre_filtered) < 10:
        # Don't discard everything if filter is too aggressive — fall back to score+body-keyword only
        pre_filtered = [p for p in posts if p.get("score", 0) >= MIN_SCORE and
                        len(p.get("matched_keywords", p.get("matched_phrases", []))) >= MIN_KW_HITS] or posts
        print(f"  [Filter] Fallback: {len(pre_filtered)} posts after score+body-keyword filter", flush=True)

    posts_filtered_count = len(pre_filtered)  # for pipeline UI display
    sampled_posts = _smart_sample(pre_filtered, budget=100)
    post_summaries = []
    for p in sampled_posts:
        summary = {
            "title": p.get("title", "")[:200],
            "source": p.get("source", p.get("subreddit", "unknown")),
            "subreddit": p.get("subreddit", ""),
            "score": p.get("score", 0),
            "comments": p.get("num_comments", 0),
            "text_snippet": (p.get("selftext", "") or "")[:300],
        }
        post_summaries.append(summary)

    platforms_used = len([k for k, v in source_counts.items() if v > 0])
    source_summary = ", ".join([f"{k}: {v} posts" for k, v in source_counts.items() if v > 0])

    # ── Batch summarization: run ALL filtered posts through AI in parallel batches ──
    # This replaces the naive approach of only telling the AI about 100 posts.
    # Every filtered post contributes to the verdict — coverage goes to 100%.
    def _batch_summarize_all(all_posts: list, keywords: list) -> dict:
        """
        Splits all_posts into batches of 50, runs each batch through the AI in
        parallel threads, and merges the results into a single signal block
        that replaces posts_block in Pass 1.
        Falls back to sampled posts_block if all batches fail.
        """
        import concurrent.futures as _cf

        BATCH_SIZE = 50
        batches = [all_posts[i:i + BATCH_SIZE] for i in range(0, len(all_posts), BATCH_SIZE)]
        kw_str = ", ".join(keywords[:10])
        print(f"  [BatchSummarize] {len(all_posts)} posts → {len(batches)} batches of ≤{BATCH_SIZE}", flush=True)

        BATCH_SYSTEM = "You are a market signal extractor. Return ONLY valid compact JSON."

        def _run_batch(batch_posts, batch_idx):
            lines = []
            for p in batch_posts:
                title = (p.get("title", "") or "")[:150]
                snippet = (p.get("selftext", "") or p.get("text", "") or "")[:200]
                score = p.get("score", 0)
                lines.append(f"[{score}pts] {title}\n{snippet}")
            posts_text = "\n---\n".join(lines)
            prompt = f"""Idea keywords: {kw_str}

Analyze these {len(batch_posts)} posts for startup market signals.
Return ONLY this JSON (no markdown, no explanation):
{{"pain_quotes":["exact quote 1","exact quote 2"],"wtp_signals":["signal or null"],"competitor_mentions":["name if explicitly mentioned"],"key_insight":"one specific sentence"}}

Posts:
{posts_text}"""
            try:
                raw = brain.single_call(prompt, BATCH_SYSTEM)
                data = extract_json(raw)
                print(f"  [Batch {batch_idx+1}/{len(batches)}] ✓ {len(batch_posts)} posts", flush=True)
                return data
            except Exception as ex:
                print(f"  [Batch {batch_idx+1}/{len(batches)}] ✗ {ex}", flush=True)
                return None

        # Run all batches in parallel threads
        with _cf.ThreadPoolExecutor(max_workers=6) as executor:
            futures = {executor.submit(_run_batch, batch, i): i for i, batch in enumerate(batches)}
            batch_results = []
            for future in _cf.as_completed(futures):
                result = future.result()
                if result is not None:
                    batch_results.append(result)

        if not batch_results:
            print("  [BatchSummarize] All batches failed — falling back to sampled block", flush=True)
            return None  # caller will use sampled posts_block instead

        # Merge all batch signals
        all_pain_quotes, all_wtp, all_competitors, all_insights = [], [], [], []
        for r in batch_results:
            all_pain_quotes.extend(r.get("pain_quotes", []))
            all_wtp.extend([w for w in r.get("wtp_signals", []) if w and w.lower() != "null"])
            all_competitors.extend(r.get("competitor_mentions", []))
            if r.get("key_insight"):
                all_insights.append(r["key_insight"])

        merged = {
            "posts_analyzed": len(all_posts),
            "batches_succeeded": len(batch_results),
            "batches_total": len(batches),
            "coverage": f"{len(all_posts)} posts ({len(batch_results)}/{len(batches)} batches)",
            "pain_quotes": list(dict.fromkeys(all_pain_quotes))[:25],  # dedupe, keep order
            "wtp_signals": list(dict.fromkeys(all_wtp))[:15],
            "competitor_mentions": list(dict.fromkeys(all_competitors))[:10],
            "key_insights": [i for i in all_insights if i][:20],
        }
        print(f"  [BatchSummarize] Merged: {len(merged['pain_quotes'])} pain quotes, {len(merged['wtp_signals'])} WTP signals, {len(merged['competitor_mentions'])} competitors", flush=True)
        return merged

    # Run batch analysis on ALL filtered posts
    update_validation(validation_id, {"status": "synthesizing (0/3 batch scan)"})
    batch_signals = _batch_summarize_all(pre_filtered, decomposition.get("keywords", []))

    # Build posts_block — prefer rich batch signals, fall back to sampled summaries
    if batch_signals:
        posts_block = f"""MARKET SIGNAL SCAN ({batch_signals['coverage']}):

PAIN QUOTES (exact from posts):
{json.dumps(batch_signals['pain_quotes'], indent=2)}

WILLINGNESS TO PAY SIGNALS:
{json.dumps(batch_signals['wtp_signals'], indent=2)}

COMPETITOR MENTIONS (from post discussions):
{json.dumps(batch_signals['competitor_mentions'], indent=2)}

KEY INSIGHTS (one per batch):
{json.dumps(batch_signals['key_insights'], indent=2)}

TOP {len(post_summaries)} REPRESENTATIVE POSTS (for title/score reference):
{json.dumps(post_summaries, indent=2)}"""
        posts_analyzed_count = len(pre_filtered)
    else:
        posts_block = f"TOP {len(post_summaries)} POSTS:\n{json.dumps(post_summaries, indent=2)}"
        posts_analyzed_count = len(sampled_posts)

    # ── Shared context block ──
    context_block = f"""IDEA: {idea_text}

TARGET AUDIENCE: {decomposition['audience']}
PAIN HYPOTHESIS: {decomposition['pain_hypothesis']}
COMPETITORS: {', '.join(decomposition['competitors'])}
KEYWORDS: {', '.join(decomposition['keywords'])}

DATA: {posts_filtered_count} filtered posts (from {len(posts)} total scraped) across {platforms_used} platforms ({source_summary})
"""
    if intel.get("trend_prompt"):
        context_block += intel["trend_prompt"] + "\n"
    if intel.get("comp_prompt"):
        context_block += intel["comp_prompt"] + "\n"

    # ═══════════════════════════════════════
    # PASS 1: MARKET ANALYSIS
    # ═══════════════════════════════════════
    print("\n  ── Pass 1/3: Market Analysis ──")
    update_validation(validation_id, {"status": "synthesizing (1/3 market analysis)"})
    try:
        pass1_prompt = f"""{context_block}

{posts_block}

Analyze the MARKET signal. Find pain validation, WTP signals, and cite specific evidence posts."""
        pass1_raw = brain.single_call(pass1_prompt, PASS1_SYSTEM)
        pass1 = extract_json(pass1_raw)
        evidence_count = len(pass1.get("evidence", []))
        print(f"  [✓] Pass 1 done: pain_validated={pass1.get('pain_validated')}, {evidence_count} evidence posts")
    except Exception as e:
        print(f"  [!] Pass 1 failed: {e} — retrying with next model...")
        try:
            pass1_raw = brain.single_call(pass1_prompt, PASS1_SYSTEM)
            pass1 = extract_json(pass1_raw)
            print(f"  [✓] Pass 1 retry succeeded")
        except Exception as e2:
            print(f"  [!] Pass 1 retry also failed: {e2}")
            pass1 = {"pain_validated": False, "pain_description": "Analysis failed", "evidence": []}

    # ═══════════════════════════════════════
    # PASS 2: STRATEGY
    # ═══════════════════════════════════════
    print("\n  ── Pass 2/3: Strategy & Competition ──")
    update_validation(validation_id, {"status": "synthesizing (2/3 strategy)"})
    try:
        pass2_prompt = f"""{context_block}

MARKET ANALYSIS (from Pass 1):
- Pain validated: {pass1.get('pain_validated')}
- Pain: {pass1.get('pain_description', 'N/A')}
- WTP: {pass1.get('willingness_to_pay', 'N/A')}
- Timing: {pass1.get('market_timing', 'N/A')}
- TAM: {pass1.get('tam_estimate', 'N/A')}
- Evidence posts cited: {len(pass1.get('evidence', []))}

Design the full strategy: ICP, competition landscape, pricing, and monetization.
(Do NOT re-analyze raw posts — reason from the market analysis above.)"""
        pass2_raw = brain.single_call(pass2_prompt, PASS2_SYSTEM)
        pass2 = extract_json(pass2_raw)
        competitors = pass2.get("competition_landscape", {}).get("direct_competitors", [])
        print(f"  [✓] Pass 2 done: {len(competitors)} competitors found, pricing model={pass2.get('pricing_strategy', {}).get('recommended_model', '?')}")
    except Exception as e:
        print(f"  [!] Pass 2 failed: {e} — retrying with next model...")
        try:
            pass2_raw = brain.single_call(pass2_prompt, PASS2_SYSTEM)
            pass2 = extract_json(pass2_raw)
            print(f"  [✓] Pass 2 retry succeeded")
        except Exception as e2:
            print(f"  [!] Pass 2 retry also failed: {e2}")
            pass2 = {"ideal_customer_profile": {}, "competition_landscape": {}, "pricing_strategy": {}}

    # ═══════════════════════════════════════
    # PASS 3: ACTION PLAN
    # ═══════════════════════════════════════
    print("\n  ── Pass 3/3: Action Plan ──")
    update_validation(validation_id, {"status": "synthesizing (3/3 action plan)"})
    try:
        pricing_summary = json.dumps(pass2.get("pricing_strategy", {}))
        icp_summary = pass2.get("ideal_customer_profile", {}).get("primary_persona", "Unknown")
        comp_landscape = pass2.get("competition_landscape", {})
        direct_competitors = comp_landscape.get("direct_competitors", [])
        # Pass competitor names + prices to Pass 3 so risks are idea-specific not generic
        competitors_block = ""
        if direct_competitors:
            comp_lines = []
            for c in direct_competitors[:5]:
                name = c.get("name", c.get("company", "Unknown"))
                price = c.get("price", c.get("pricing", c.get("price_point", "unknown price")))
                weakness = c.get("weakness", c.get("gap", ""))
                comp_lines.append(f"  - {name}: {price} | Gap: {weakness}")
            competitors_block = "NAMED COMPETITORS (use these in risks — do not invent others):\n" + "\n".join(comp_lines)
        else:
            competitors_block = "NAMED COMPETITORS: None identified in Pass 2 — use market saturation data for risks."

        pass3_prompt = f"""{context_block}

FROM MARKET ANALYSIS:
- Pain validated: {pass1.get('pain_validated')}
- Intensity: {pass1.get('pain_intensity', 'N/A')}
- WTP signals: {pass1.get('willingness_to_pay', 'N/A')}
- TAM: {pass1.get('tam_estimate', 'N/A')}
- Evidence posts count: {len(pass1.get('evidence', []))}

FROM STRATEGY:
- ICP: {icp_summary}
- Pricing: {pricing_summary[:500]}
- Market saturation: {comp_landscape.get('market_saturation', 'N/A')}
- Total products found: {comp_landscape.get('total_products_found', 'N/A')}
{competitors_block}

Create the ACTION PLAN. CRITICAL: risks must name specific competitors above, not generic categories.
Revenue assumptions must cite a specific comparable conversion rate or say 'no comparable found'.
Create the launch roadmap, revenue projections, risk matrix, and first 10 customers strategy."""

        # Pass 3 has a large JSON response — prefer second model (pinned_index=1) which avoids
        # re-using the same Groq Llama-4 Scout (configs[0]) that hits 8192 token limit mid-JSON
        # and truncates risk_matrix + first_10_customers. DeepSeek or other models handle this better.
        pass3_raw = brain.single_call(
            pass3_prompt,
            PASS3_SYSTEM,
            pinned_index=1,  # Use second configured model — avoids Groq 8K token truncation
        )
        pass3 = extract_json(pass3_raw)
        roadmap_steps = len(pass3.get("launch_roadmap", []))
        risk_count = len(pass3.get("risk_matrix", []))
        print(f"  [✓] Pass 3 done: {roadmap_steps} roadmap steps, {risk_count} risks, MVP features={pass3.get('mvp_features', [])}")
    except Exception as e:
        print(f"  [!] Pass 3 failed: {e} — retrying with different model...")
        try:
            # Retry with third model (or wraps to first if only 2 configs)
            pass3_raw = brain.single_call(pass3_prompt, PASS3_SYSTEM, pinned_index=2)
            pass3 = extract_json(pass3_raw)
            print(f"  [✓] Pass 3 retry succeeded")
        except Exception as e2:
            print(f"  [!] Pass 3 retry also failed: {e2}")
            print(f"  [!] Raw Pass 3 output (first 500 chars): {pass3_raw[:500] if 'pass3_raw' in dir() else 'no output'}")
            pass3 = {"launch_roadmap": [], "revenue_projections": {}, "risk_matrix": [], "first_10_customers_strategy": {}}

    # ═══════════════════════════════════════
    # DATA QUALITY CHECK + CONTRADICTION DETECTION
    # ═══════════════════════════════════════
    data_quality = _check_data_quality(posts, source_counts, pass1, pass2, pass3,
                                        platform_warnings=kwargs.get("platform_warnings", []))
    print(f"\n  ── Data Quality Check ──")
    print(f"  [Q] Post count: {len(posts)} (threshold: 20 for full confidence)")
    print(f"  [Q] Confidence cap: {data_quality['confidence_cap']}%")
    print(f"  [Q] Contradictions found: {len(data_quality['contradictions'])}")
    for c in data_quality["contradictions"]:
        print(f"      ⚠ {c}")
    for w in data_quality["warnings"]:
        print(f"      ℹ {w}")

    # ═══════════════════════════════════════
    # FINAL VERDICT: MULTI-MODEL DEBATE
    # ═══════════════════════════════════════
    print("\n  ── Final: Multi-Model Debate for Verdict ──")
    update_validation(validation_id, {"status": "debating (final verdict)"})

    def on_progress(status, msg):
        update_validation(validation_id, {"status": status})
        print(f"  [Brain] {msg}")

    # Inject quality context into verdict prompt so AI models know the data limitations
    quality_context = ""
    if data_quality["contradictions"]:
        quality_context += "\nDATA QUALITY WARNINGS (factor these into your confidence score):\n"
        for c in data_quality["contradictions"]:
            quality_context += f"  ⚠ CONTRADICTION: {c}\n"
    if data_quality["warnings"]:
        for w in data_quality["warnings"]:
            quality_context += f"  ℹ WARNING: {w}\n"
    if len(posts) < 20:
        quality_context += f"  ⚠ LOW DATA: Only {len(posts)} posts scraped (minimum 20 recommended for reliable analysis). Penalize confidence accordingly.\n"

    verdict_prompt = f"""{context_block}

MARKET ANALYSIS RESULTS:
- Pain validated: {pass1.get('pain_validated')}
- Pain description: {pass1.get('pain_description', 'N/A')}
- WTP signals: {pass1.get('willingness_to_pay', 'N/A')}
- Market timing: {pass1.get('market_timing', 'N/A')}
- TAM: {pass1.get('tam_estimate', 'N/A')}
- Evidence posts: {len(pass1.get('evidence', []))} cited

STRATEGY RESULTS:
- Competition: {pass2.get('competition_landscape', {}).get('market_saturation', 'N/A')}
- Direct competitors: {len(pass2.get('competition_landscape', {}).get('direct_competitors', []))}
- Pricing model: {pass2.get('pricing_strategy', {}).get('recommended_model', 'N/A')}

ACTION PLAN RESULTS:
- Roadmap steps: {len(pass3.get('launch_roadmap', []))}
- Month 6 MRR target: {pass3.get('revenue_projections', {}).get('month_6', {}).get('mrr', 'N/A')}
- Risks identified: {len(pass3.get('risk_matrix', []))}
{quality_context}
{posts_block}

Based on ALL analysis, deliver your FINAL VERDICT. Be honest and data-driven. If data is thin (<20 posts), your confidence MUST reflect that uncertainty."""

    try:
        verdict_report = brain.debate(verdict_prompt, VERDICT_SYSTEM, on_progress=on_progress)
        verdict_report["_source"] = "debate_engine"  # Fix A: mark as real computed result
    except Exception as e:
        # Fix A: log the full exception type + message so we can distinguish fallback from real verdict
        import traceback as _tb
        print(f"  [!!!] DEBATE ENGINE FAILED — {type(e).__name__}: {e}")
        print(f"  [!!!] This means RISKY/50% is the FALLBACK DEFAULT, not a computed verdict!")
        print(f"  [!!!] Traceback: {_tb.format_exc()[-1000:]}")
        verdict_report = {
            "verdict": "RISKY",
            "confidence": 50,
            "executive_summary": f"[FALLBACK] Verdict debate engine failed — this is NOT a real analysis result. Error: {type(e).__name__}: {str(e)}",
            "top_posts": [],
            "_source": "fallback_exception",  # Fix A: mark as fake/fallback
            "_error": str(e),
            "_error_type": type(e).__name__,
        }

    # ═══════════════════════════════════════
    # MERGE ALL PASSES INTO FINAL REPORT
    # ═══════════════════════════════════════
    report = {}
    report["verdict"] = verdict_report.get("verdict", "RISKY")
    raw_confidence = verdict_report.get("confidence", 50)

    # ── APPLY CONFIDENCE CAP based on data quality ──
    capped_confidence = min(raw_confidence, data_quality["confidence_cap"])
    if capped_confidence < raw_confidence:
        print(f"  [Q] Confidence capped: {raw_confidence}% → {capped_confidence}% (reason: {data_quality['cap_reason']})")
    report["confidence"] = capped_confidence

    # Override verdict if confidence was capped below thresholds
    if capped_confidence < 40 and report["verdict"] == "BUILD IT":
        report["verdict"] = "RISKY"
        print(f"  [Q] Verdict overridden: BUILD IT → RISKY (confidence too low after cap)")

    # Fix E: symmetric override — DONT_BUILD at high confidence + validated pain is contradictory
    if capped_confidence > 80 and report["verdict"] == "DONT_BUILD":
        if report.get("market_analysis", {}).get("pain_validated"):
            report["verdict"] = "RISKY"
            print(f"  [Q] Verdict overridden: DONT_BUILD → RISKY (high confidence + validated pain contradicts negative verdict)")
            data_quality["warnings"].append(
                "DONT_BUILD overridden to RISKY — confidence >80% with validated pain contradicts a hard negative. Review evidence."
            )

    report["executive_summary"] = verdict_report.get("executive_summary", "")

    # Pass 1: Market
    report["market_analysis"] = {
        "pain_validated": pass1.get("pain_validated", False),
        "pain_description": pass1.get("pain_description", ""),
        "pain_frequency": pass1.get("pain_frequency", ""),
        "pain_intensity": pass1.get("pain_intensity", ""),
        "willingness_to_pay": pass1.get("willingness_to_pay", ""),
        "market_timing": pass1.get("market_timing", ""),
        "tam_estimate": pass1.get("tam_estimate", ""),
        "evidence": pass1.get("evidence", []),
    }

    # Pass 2: Strategy
    report["ideal_customer_profile"] = pass2.get("ideal_customer_profile", {})
    report["competition_landscape"] = pass2.get("competition_landscape", {})
    report["pricing_strategy"] = pass2.get("pricing_strategy", {})
    report["monetization_channels"] = pass2.get("monetization_channels", [])

    # Pass 3: Action Plan
    report["launch_roadmap"] = pass3.get("launch_roadmap", [])
    report["revenue_projections"] = pass3.get("revenue_projections", {})

    # Risk fallback: Pass 3 often truncates on Groq 8K limit — use debate risks if empty
    pass3_risks = pass3.get("risk_matrix", [])
    if not pass3_risks:
        # Extract risks from debate output — they're always generated, even when Pass 3 fails
        debate_risks = verdict_report.get("risks", [])
        if debate_risks:
            # Normalize to same structure as pass3 risk_matrix
            pass3_risks = [
                {"risk": r if isinstance(r, str) else r.get("risk", str(r)), "severity": "HIGH", "mitigation": ""}
                for r in debate_risks
            ]
            print(f"  [Risks] Pass 3 empty — using {len(pass3_risks)} risks from debate output")
    report["risk_matrix"] = pass3_risks

    report["first_10_customers_strategy"] = pass3.get("first_10_customers_strategy", {})
    report["mvp_features"] = pass3.get("mvp_features", [])
    report["cut_features"] = pass3.get("cut_features", [])

    # Verdict extras
    report["top_posts"] = verdict_report.get("top_posts", [])

    # ── Fix 1: Write full debate metadata to report so frontend displays it ──
    # debate() returns models_used, model_verdicts, debate_mode, consensus_type, dissent
    # but validate_idea.py was only extracting top_posts — debate counter showed 0.
    debate_models = verdict_report.get("models_used", [])
    model_verdicts_raw = verdict_report.get("model_verdicts", {})
    # model_verdicts from _weighted_merge is {model: {verdict, role}} — flatten to {model: verdict} for frontend
    model_verdicts_flat = {
        m: (v.get("verdict", v) if isinstance(v, dict) else str(v))
        for m, v in model_verdicts_raw.items()
    }
    report["debate_mode"] = verdict_report.get("debate_mode", len(debate_models) > 1)
    report["models_used"] = debate_models
    report["model_verdicts"] = model_verdicts_flat
    report["debate_rounds"] = 2 if verdict_report.get("debate_mode") else 1  # actual rounds used
    report["consensus_type"] = verdict_report.get("consensus_type", "")
    report["consensus_strength"] = verdict_report.get("consensus_strength", "")
    report["debate_log"] = []  # flat debate — no per-round log yet; placeholder for future
    report["final_verdict"] = verdict_report.get("verdict", report.get("verdict", ""))

    # Metadata
    report["data_sources"] = source_counts
    report["platforms_used"] = platforms_used
    report["trends_data"] = intel.get("trends")
    report["competition_data"] = intel.get("competition")
    report["synthesis_method"] = "multi-pass-3"
    # Pipeline counts for UI
    report["posts_scraped"] = len(posts)
    report["posts_filtered"] = posts_filtered_count
    report["posts_analyzed"] = posts_analyzed_count

    # ── DATA QUALITY METADATA (new) ──
    report["data_quality"] = {
        "total_posts_scraped": len(posts),
        "minimum_recommended": 20,
        "data_sufficient": len(posts) >= 20,
        "platforms_with_data": platforms_used,
        "platforms_total": 4,
        "confidence_was_capped": capped_confidence < raw_confidence,
        "original_confidence": raw_confidence,
        "cap_reason": data_quality["cap_reason"] if capped_confidence < raw_confidence else None,
        "contradictions": data_quality["contradictions"],
        "warnings": data_quality["warnings"],
        "platform_warnings": kwargs.get("platform_warnings", []),
    }

    verdict = report["verdict"]
    confidence = report["confidence"]

    # Fix A: surface whether verdict came from real debate or fallback exception
    verdict_source = verdict_report.get("_source", "unknown")
    if verdict_source == "fallback_exception":
        data_quality["warnings"].append(
            f"DEBATE ENGINE FAILED — verdict '{verdict}' at {confidence}% is the FALLBACK DEFAULT, "
            f"not a computed result. Error: {verdict_report.get('_error', 'unknown')}. Fix your AI model config."
        )
        report["data_quality"]["warnings"] = data_quality["warnings"]  # refresh in report
        print(f"  [!!!] WARNING: verdict_source=fallback_exception — surfaced in data_quality.warnings")

    # Step 1: Write ESSENTIAL fields first — status=done must always land
    # so the frontend unblocks even if extra columns don't exist in schema yet.
    update_validation(validation_id, {
        "status": "done",
        "verdict": verdict,
        "confidence": confidence,
        "report": json.dumps(report),
        "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    print(f"  [DB] status=done written to Supabase", flush=True)

    # Step 2: Write extra columns separately — non-fatal if they don't exist
    try:
        url = f"{SUPABASE_URL}/rest/v1/idea_validations?id=eq.{validation_id}"
        r = requests.patch(url, json={
            "posts_analyzed": posts_analyzed_count,
            "posts_found": len(posts),
            "posts_filtered": posts_filtered_count,
            "verdict_source": verdict_source,
        }, headers=_supabase_headers(), timeout=10)
        if r.status_code >= 400:
            print(f"  [!] Extra columns update skipped (schema may not have them): {r.status_code}", flush=True)
    except Exception as ex:
        print(f"  [!] Extra columns update failed (non-fatal): {ex}", flush=True)

    print(f"\n  ═══════════════════════════════")
    print(f"  VERDICT: {verdict} ({confidence}% confidence)")
    if capped_confidence < raw_confidence:
        print(f"  QUALITY: Confidence was capped from {raw_confidence}% → {confidence}% due to data quality issues")
    if data_quality["contradictions"]:
        print(f"  CONTRADICTIONS: {len(data_quality['contradictions'])} found in analysis")
    print(f"  DATA: {len(posts)} posts from {platforms_used} platforms")
    print(f"  REPORT SECTIONS: market_analysis, ICP, competition, pricing, roadmap, projections, risks, first_10, data_quality")
    if intel.get("trends"):
        print(f"  TRENDS: {intel['trends']}")
    if intel.get("competition"):
        print(f"  COMPETITION: {intel['competition']}")
    if verdict_report.get("debate_mode"):
        print(f"  MODE: Multi-Model Debate ({len(verdict_report.get('models_used', []))} models)")
        for model, v in verdict_report.get("model_verdicts", {}).items():
            print(f"    -> {model}: {v}")
    print(f"  ═══════════════════════════════")
    return report


# ═══════════════════════════════════════════════════════
# MAIN PIPELINE
# ═══════════════════════════════════════════════════════

def validate_idea(validation_id: str, idea_text: str, user_id: str = ""):
    """Full 3-phase validation pipeline with multi-model debate."""
    print(f"\n{'='*50}")
    print(f"  IDEA VALIDATION {validation_id}")
    print(f"  User: {user_id or 'CLI mode'}")
    print(f"  Idea: {idea_text[:100]}...")
    print(f"{'='*50}\n")

    try:
        # Load user's AI configs from Supabase
        configs = []
        if user_id:
            configs = get_user_ai_configs(user_id)
            print(f"  [>] Found {len(configs)} AI configs for user")

        if not configs:
            # Fallback: check env vars for backward compatibility
            print("  [!] No user AI configs found, checking env vars...")
            fallback_configs = []
            if os.environ.get("GEMINI_API_KEY"):
                fallback_configs.append({
                    "provider": "gemini",
                    "api_key": os.environ["GEMINI_API_KEY"],
                    "selected_model": "gemini-2.0-flash",
                    "is_active": True,
                    "priority": 1,
                })
            if os.environ.get("GROQ_API_KEY"):
                fallback_configs.append({
                    "provider": "groq",
                    "api_key": os.environ["GROQ_API_KEY"],
                    "selected_model": "llama-3.3-70b-versatile",
                    "is_active": True,
                    "priority": 2,
                })
            if os.environ.get("OPENAI_API_KEY"):
                fallback_configs.append({
                    "provider": "openai",
                    "api_key": os.environ["OPENAI_API_KEY"],
                    "selected_model": "gpt-4o",
                    "is_active": True,
                    "priority": 3,
                })
            if os.environ.get("OPENROUTER_API_KEY"):
                fallback_configs.append({
                    "provider": "openrouter",
                    "api_key": os.environ["OPENROUTER_API_KEY"],
                    "selected_model": "anthropic/claude-3.5-sonnet",
                    "is_active": True,
                    "priority": 4,
                })
            configs = fallback_configs

        if not configs:
            raise Exception("No AI models configured. Go to Settings → AI to add your API keys.")

        # Initialize the multi-model brain
        brain = AIBrain(configs)

        # Phase 1: Decompose idea
        decomposition = phase1_decompose(idea_text, brain, validation_id)

        # Phase 2: Scrape ALL platforms
        posts, source_counts, platform_warnings = phase2_scrape(decomposition["keywords"], validation_id)

        # Phase 2b: Intelligence analysis (Trends + Competition)
        intel = phase2b_intelligence(decomposition["keywords"], validation_id, idea_text=idea_text)

        if len(posts) == 0:
            update_validation(validation_id, {
                "status": "done",
                "verdict": "INSUFFICIENT DATA",
                "confidence": 0,
                "report": json.dumps({
                    "verdict": "INSUFFICIENT DATA",
                    "confidence": 0,
                    "summary": "No relevant posts found across any platform. Try rephrasing your idea or the market may be too niche.",
                    "evidence": [],
                    "suggestions": ["Try broader keywords", "Consider adjacent markets", "Validate through user interviews"],
                    "action_plan": [],
                    "top_posts": [],
                    "data_sources": source_counts,
                    "platform_warnings": platform_warnings,
                    "trends_data": intel.get("trends"),
                    "competition_data": intel.get("competition"),
                    "models_used": [f"{c['provider']}/{c['selected_model']}" for c in configs],
                    "debate_mode": len(configs) > 1,
                }),
                "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
            print("\n  [!] No posts found — insufficient data for validation")
            return

        # Phase 3: Synthesize via multi-model debate (with ALL intelligence)
        report = phase3_synthesize(idea_text, posts, decomposition, brain, validation_id,
                                   source_counts=source_counts, intel=intel,
                                   platform_warnings=platform_warnings)

        print("\n  [✓] Validation complete!")

    except Exception as e:
        print(f"\n  [✗] PIPELINE ERROR: {e}")
        traceback.print_exc()
        update_validation(validation_id, {
            "status": "failed",
            "report": json.dumps({"error": str(e)}),
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })


# ═══════════════════════════════════════════════════════
# CLI USAGE
# ═══════════════════════════════════════════════════════
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate a startup idea")
    parser.add_argument("--idea", default="", help="The idea to validate")
    parser.add_argument("--validation-id", default="cli-test", help="Validation ID")
    parser.add_argument("--user-id", default="", help="User ID for loading AI configs")
    parser.add_argument("--config-file", default="", help="JSON config file (overrides other args)")
    args = parser.parse_args()

    # If config file provided, read from it (safe — no shell injection)
    if args.config_file:
        with open(args.config_file, "r") as f:
            config = json.load(f)
        validate_idea(
            config["validation_id"],
            config["idea"],
            config.get("user_id", ""),
        )
    else:
        validate_idea(args.validation_id, args.idea, args.user_id)

