"""
RedditPulse — Scan Runner (Multi-Brain Edition)
Orchestrates: keyword scrape → HN scrape → AI analysis → AI Synthesis → Supabase storage.
Called by the API route when a user launches a scan.
Accepts --config-file (JSON) for safe argument passing.
"""

import os
import sys
import json
import time
import traceback
import requests
import argparse

# Add engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "engine"))

from keyword_scraper import run_keyword_scan
from ai_analyzer import OpportunityAnalyzer
from multi_brain import AIBrain, get_user_ai_configs
from credibility import (
    assess_credibility,
    credibility_prompt_modifier,
    deduplicate_cross_platform,
)

try:
    from trends import analyze_keywords, trend_summary_for_report, get_trend_multiplier
    TRENDS_AVAILABLE = True
except ImportError:
    TRENDS_AVAILABLE = False

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

try:
    from icp import build_icp
    ICP_AVAILABLE = True
except ImportError:
    ICP_AVAILABLE = False

try:
    from competition import analyze_competition, competition_prompt_section, competition_summary
    COMPETITION_AVAILABLE = True
except ImportError:
    COMPETITION_AVAILABLE = False

# ── Supabase config (read from env) ──
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_KEY", ""))


def _supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def update_scan(scan_id, updates):
    """Update scan row in Supabase. Silently ignores unknown columns."""
    url = f"{SUPABASE_URL}/rest/v1/scans?id=eq.{scan_id}"
    try:
        r = requests.patch(url, json=updates, headers=_supabase_headers(), timeout=10)
        if r.status_code >= 400:
            print(f"  [!] Supabase update {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  [!] Supabase update failed: {e}")


def _normalize_timestamp(value):
    """Normalize mixed epoch/ISO timestamps to a JSON-safe value for Supabase."""
    if isinstance(value, (int, float)):
        return value if value > 0 else None
    if isinstance(value, str):
        return value or None
    return None


def upload_posts(posts, scan_id, user_id=""):
    """Upload scraped posts to the canonical posts table in batches."""
    url = f"{SUPABASE_URL}/rest/v1/posts?on_conflict=id"
    batch_size = 50
    headers = _supabase_headers()
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"

    for i in range(0, len(posts), batch_size):
        batch = posts[i:i + batch_size]
        rows = []
        for p in batch:
            rows.append({
                "id": p.get("id", ""),
                "title": (p.get("title") or "")[:500],
                "selftext": (p.get("selftext") or "")[:5000],
                "full_text": (p.get("full_text") or p.get("selftext") or p.get("title") or "")[:5000],
                "subreddit": p.get("subreddit", ""),
                "score": p.get("score", 0),
                "upvote_ratio": p.get("upvote_ratio", 0.5),
                "num_comments": p.get("num_comments", 0),
                "permalink": p.get("permalink", ""),
                "author": p.get("author", ""),
                "url": p.get("url", ""),
                "created_utc": _normalize_timestamp(p.get("created_utc")),
                "matched_phrases": p.get("matched_keywords", p.get("matched_phrases", [])),
                "scan_id": scan_id,
                "user_id": user_id or None,
            })

        try:
            r = requests.post(url, json=rows, headers=headers, timeout=30)
            if r.status_code >= 400:
                print(f"  [!] Post upload batch {i//batch_size + 1}: {r.status_code} {r.text[:200]}")
        except Exception as e:
            print(f"  [!] Post upload failed: {e}")


def upload_analysis(results, scan_id):
    """Upload AI analysis results to Supabase in batches."""
    url = f"{SUPABASE_URL}/rest/v1/ai_analysis"
    batch_size = 50

    for i in range(0, len(results), batch_size):
        batch = results[i:i + batch_size]
        rows = []
        for r_item in batch:
            rows.append({
                "scan_id": scan_id,
                "post_id": r_item.get("post_id", ""),
                "problem_description": r_item.get("problem_description", ""),
                "willingness_to_pay": r_item.get("willingness_to_pay", False),
                "wtp_evidence": r_item.get("wtp_evidence", ""),
                "urgency_score": r_item.get("urgency_score", 0),
                "opportunity_type": r_item.get("opportunity_type", "none"),
                "market_size": r_item.get("market_size", "niche"),
                "solution_idea": r_item.get("solution_idea", ""),
                "ai_model_used": r_item.get("ai_model_used", ""),
                "raw_ai_response": r_item,
            })

        try:
            r = requests.post(url, json=rows, headers=_supabase_headers(), timeout=30)
            if r.status_code >= 400:
                print(f"  [!] Analysis upload batch {i//batch_size + 1}: {r.status_code} {r.text[:200]}")
        except Exception as e:
            print(f"  [!] Analysis upload failed: {e}")


def upload_synthesis(synthesis, scan_id):
    """Upload AI synthesis report to scan row."""
    update_scan(scan_id, {
        "synthesis_report": synthesis,
    })


# ═══════════════════════════════════════════════════════
# SYNTHESIS PROMPT (for multi-brain debate on scan data)
# ═══════════════════════════════════════════════════════

SCAN_SYNTHESIS_SYSTEM = """You are an elite market analyst. You've just been given ALL the AI-analyzed results from a Reddit/HN scan about specific keywords. Your job is to synthesize everything into a single strategic intelligence brief.

Return ONLY valid JSON:
{
  "verdict": "BUILD" or "EXPLORE" or "SKIP",
  "confidence": 1-10,
  "title": "Short title for the opportunity area",
  "summary": "2-3 sentence executive summary",
  "who_is_asking": "Exact persona description",
  "the_exact_pain": "Specific, visceral description of the problem",
  "evidence": ["Evidence point 1", "Evidence point 2", ...],
  "competitor_gaps": "What existing tools fail at",
  "price_signals": "What people said they'd pay",
  "market_size_estimate": "TAM estimate based on data",
  "risk_factors": ["Risk 1", "Risk 2"],
  "suggestions": ["Strategic suggestion 1", "Strategic suggestion 2", "Strategic suggestion 3"],
  "action_plan": [
    {"step": 1, "title": "Step title", "description": "What to do"},
    {"step": 2, "title": "Step title", "description": "What to do"},
    {"step": 3, "title": "Step title", "description": "What to do"}
  ]
}

RULES:
- Base EVERYTHING on the actual data. Do not invent evidence.
- Be brutally honest. SKIP if the data doesn't support building.
- Include specific post titles and quotes as evidence.
"""


def run_scan(scan_id: str, keywords: list, duration: str = "10min", user_id: str = ""):
    """
    Full scan pipeline:
    1. Scrape Reddit for keywords (+ HN if available)
    2. Upload posts to Supabase
    3. AI-analyze each post (per-post opportunity scoring)
    4. AI Synthesis via Multi-Model Debate (phase 4 — NEW)
    5. Mark scan as done
    """
    print(f"\n{'='*50}")
    print(f"  SCAN {scan_id}")
    print(f"  Keywords: {keywords}")
    print(f"  Duration: {duration}")
    print(f"  User: {user_id or 'CLI mode'}")
    print(f"{'='*50}\n")

    try:
        # ── Phase 1: Scrape ──
        print("\n  ══ PHASE 1: Scraping ══")
        update_scan(scan_id, {"status": "scraping", "posts_found": 0})

        def on_scrape_progress(count, msg):
            update_scan(scan_id, {"posts_found": count, "status": "scraping"})

        reddit_posts = run_keyword_scan(keywords, duration=duration, on_progress=on_scrape_progress)
        print(f"  [✓] Reddit: {len(reddit_posts)} posts")

        hn_posts = []
        if HN_AVAILABLE:
            print("  [▸] Scraping Hacker News...")
            try:
                hn_posts = run_hn_scrape(keywords, max_pages=2)
                print(f"  [✓] HN: {len(hn_posts)} posts")
            except Exception as e:
                print(f"  [!] HN scrape failed: {e}")

        ph_posts = []
        if PH_AVAILABLE:
            print("  [▸] Scraping ProductHunt...")
            try:
                ph_posts = run_ph_scrape(keywords, max_pages=2)
                print(f"  [✓] ProductHunt: {len(ph_posts)} posts")
            except Exception as e:
                print(f"  [!] PH scrape failed: {e}")

        ih_posts = []
        if IH_AVAILABLE:
            print("  [▸] Scraping IndieHackers...")
            try:
                ih_posts = run_ih_scrape(keywords, max_pages=2)
                print(f"  [✓] IndieHackers: {len(ih_posts)} posts")
            except Exception as e:
                print(f"  [!] IH scrape failed: {e}")

        # Merge ALL sources + deduplicate
        all_posts = reddit_posts + hn_posts + ph_posts + ih_posts
        seen_titles = set()
        unique_posts = []
        for p in all_posts:
            title_key = p.get("title", "").lower().strip()[:80]
            if title_key and title_key not in seen_titles:
                seen_titles.add(title_key)
                unique_posts.append(p)

        unique_posts.sort(key=lambda p: p.get("score", 0), reverse=True)

        # Cross-platform deduplication (title similarity > 85%)
        pre_dedup = len(unique_posts)
        unique_posts = deduplicate_cross_platform(unique_posts, threshold=0.85)
        dupes_removed = pre_dedup - len(unique_posts)
        if dupes_removed > 0:
            print(f"  [✓] Dedup: removed {dupes_removed} cross-platform duplicates")

        # ── Credibility Assessment ──
        credibility = assess_credibility(unique_posts)
        print(f"  [▸] Credibility: {credibility.icon} {credibility.label} ({credibility.tier})")
        print(f"  [▸] {credibility._human_summary()}")
        if credibility.warning:
            print(f"  [⚠] {credibility.warning}")

        update_scan(scan_id, {
            "status": "scraped",
            "posts_found": len(unique_posts),
            "credibility_tier": credibility.tier,
            "credibility_data": credibility.to_dict(),
        })

        print(f"  [✓] Total unique posts: {len(unique_posts)}")

        # If insufficient data, mark done early with honest messaging
        if not credibility.show_opportunity or not unique_posts:
            update_scan(scan_id, {
                "status": "done",
                "posts_found": len(unique_posts),
                "posts_analyzed": 0,
                "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "credibility_tier": credibility.tier,
                "credibility_data": credibility.to_dict(),
            })
            if not unique_posts:
                print("  [!] No posts found — try different keywords")
            else:
                print(f"  [!] Only {len(unique_posts)} posts — INSUFFICIENT for opportunity claims")
                print("  [!] Try broader keywords or wait for more data")
            return

        # ── Phase 1.5: Google Trends Velocity ──
        trend_results = {}
        trend_summary = {"available": False}
        if TRENDS_AVAILABLE:
            print("\n  == PHASE 1.5: Google Trends Velocity ==")
            try:
                trend_results = analyze_keywords(keywords)
                trend_summary = trend_summary_for_report(trend_results)
                trend_mult = get_trend_multiplier(keywords, trend_results)
                if trend_summary.get("available"):
                    overall = trend_summary.get("overall_trend", "?")
                    avg_chg = trend_summary.get("avg_change_percent", 0)
                    print(f"  [>] Overall trend: {overall} ({avg_chg:+.1f}%)")
                    print(f"  [>] Trend multiplier: {trend_mult}x")
            except Exception as e:
                print(f"  [!] Trends failed: {e}")
        else:
            print("  [!] pytrends not available -- skipping trend analysis")

        # ── Phase 1.6: Competition Analysis ──
        comp_reports = {}
        comp_summary_data = {"available": False}
        if COMPETITION_AVAILABLE:
            print("\n  == PHASE 1.6: Competition Analysis ==")
            try:
                comp_reports = analyze_competition(keywords[:3])  # limit to 3 keywords to avoid rate limiting
                comp_summary_data = competition_summary(comp_reports)
                if comp_summary_data.get("available"):
                    overall = comp_summary_data.get("overall_tier", "?")
                    print(f"  [>] Overall competition: {overall}")
            except Exception as e:
                print(f"  [!] Competition analysis failed: {e}")
        else:
            print("  [!] Competition module not available -- skipping")

        # ── Phase 2: Upload posts ──
        print("\n  ══ PHASE 2: Uploading Posts ══")
        upload_posts(unique_posts, scan_id, user_id=user_id)
        print(f"  [✓] Uploaded {len(unique_posts)} posts")

        # ── Phase 3: AI Per-Post Analysis ──
        print("\n  ══ PHASE 3: AI Per-Post Analysis ══")
        update_scan(scan_id, {"status": "analyzing", "posts_analyzed": 0})

        analyzer = OpportunityAnalyzer()
        results = []
        analyzed_count = 0

        def on_analyze(post, result, idx, total):
            nonlocal analyzed_count
            analyzed_count += 1
            if analyzed_count % 5 == 0 or analyzed_count == total:
                update_scan(scan_id, {"posts_analyzed": analyzed_count})

        top_posts = unique_posts[:50]
        results = analyzer.analyze_batch(top_posts, delay=1.5, callback=on_analyze)
        print(f"  [✓] Analyzed {len(results)} posts")

        # Upload analysis results
        upload_analysis(results, scan_id)

        # ── Phase 3.5: ICP Detection ──
        icp_data = {}
        icp_prompt = ""
        if ICP_AVAILABLE and results:
            print("\n  == PHASE 3.5: ICP Detection ==")
            icp_report = build_icp(results)
            icp_data = icp_report.to_dict()
            icp_prompt = icp_report.to_prompt_section()
            primary = icp_data.get("primary_persona", "unknown")
            coverage = icp_data.get("coverage", {}).get("icp_rate", 0)
            print(f"  [>] Primary persona: {primary}")
            print(f"  [>] ICP coverage: {coverage}% of posts")
            tools = icp_data.get("top_tools", [])
            if tools:
                tool_names = [t['tool'] for t in tools[:5]]
                print(f"  [>] Top tools mentioned: {', '.join(tool_names)}")

        update_scan(scan_id, {
            "status": "analyzed",
            "posts_analyzed": len(results),
        })

        # ── Phase 4: AI Synthesis via Multi-Model Debate (NEW) ──
        print("\n  ══ PHASE 4: AI Synthesis (Multi-Model Debate) ══")
        update_scan(scan_id, {"status": "synthesizing"})

        # Load user's AI configs
        brain = None
        configs = []
        if user_id:
            configs = get_user_ai_configs(user_id)

        if not configs:
            # Fallback to env vars
            if os.environ.get("GEMINI_API_KEY"):
                configs.append({
                    "provider": "gemini",
                    "api_key": os.environ["GEMINI_API_KEY"],
                    "selected_model": "gemini-3.1-pro",
                    "is_active": True, "priority": 1,
                })

        if configs:
            try:
                brain = AIBrain(configs)

                # Prepare synthesis prompt from analyzed results
                high_scoring = [r for r in results if r.get("urgency_score", 0) >= 5]
                wtp_results = [r for r in results if r.get("willingness_to_pay")]

                # Build trend section for prompt
                trend_section = ""
                if trend_summary.get("available") and trend_summary.get("keywords"):
                    trend_lines = []
                    for t in trend_summary["keywords"]:
                        trend_lines.append(
                            f"  {t['keyword']}: {t['icon']} {t['label']} "
                            f"({t['change_percent']:+.1f}%, interest={t['current_interest']}/100)"
                        )
                    trend_section = f"""\nGOOGLE TRENDS VELOCITY:
Overall: {trend_summary.get('overall_trend', '?')} ({trend_summary.get('avg_change_percent', 0):+.1f}%)
{chr(10).join(trend_lines)}

IMPORTANT: Factor trend direction into your analysis.
Growing trends = opportunity window open NOW.
Declining trends = market may be saturated or solved."""

                # Build ICP section for prompt
                icp_section = icp_prompt if icp_prompt else ""

                # Build competition section for prompt
                comp_section = ""
                if comp_reports:
                    comp_section = competition_prompt_section(comp_reports)

                synthesis_prompt = f"""SCAN KEYWORDS: {', '.join(keywords)}
TOTAL POSTS FOUND: {len(unique_posts)}
POSTS ANALYZED: {len(results)}
CREDIBILITY: {credibility.tier} ({credibility._human_summary()})

{credibility_prompt_modifier(credibility)}
{trend_section}
{icp_section}
{comp_section}

HIGH-SCORING OPPORTUNITIES (urgency 5+): {len(high_scoring)}
{json.dumps([{{
    'problem': r.get('problem_description', ''),
    'urgency': r.get('urgency_score', 0),
    'type': r.get('opportunity_type', ''),
    'market': r.get('market_size', ''),
    'solution': r.get('solution_idea', ''),
}} for r in high_scoring[:20]], indent=2)}

WILLINGNESS TO PAY SIGNALS: {len(wtp_results)}
{json.dumps([{{
    'problem': r.get('problem_description', ''),
    'evidence': r.get('wtp_evidence', ''),
}} for r in wtp_results[:15]], indent=2)}

TOP POST TITLES:
{chr(10).join([f"- [{{p.get('source','reddit')}}|r/{{p.get('subreddit','')}}] {{p.get('title','')}}" for p in unique_posts[:30]])}

Synthesize ALL evidence into a strategic intelligence report.
Include ICP analysis and competition findings in your verdict."""

                synthesis = brain.debate(synthesis_prompt, SCAN_SYNTHESIS_SYSTEM)
                upload_synthesis(synthesis, scan_id)
                print(f"  [✓] Synthesis complete: {synthesis.get('verdict', '?')}")

            except Exception as e:
                print(f"  [!] Synthesis failed: {e}")
                traceback.print_exc()
        else:
            print("  [!] No AI models configured — skipping synthesis")

        # -- Done --
        final_data = {
            "status": "done",
            "posts_analyzed": len(results),
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "credibility_tier": credibility.tier,
            "credibility_data": credibility.to_dict(),
        }
        if trend_summary.get("available"):
            final_data["trend_data"] = trend_summary
        if icp_data:
            final_data["icp_data"] = icp_data
        if comp_summary_data.get("available"):
            final_data["competition_data"] = comp_summary_data
        update_scan(scan_id, final_data)

        print(f"\n  [>] Scan complete! {len(unique_posts)} posts, {len(results)} analyzed")
        print(f"  [>] Credibility: {credibility.icon} {credibility.label}")
        if trend_summary.get("available"):
            print(f"  [>] Trend: {trend_summary.get('overall_trend', '?')} ({trend_summary.get('avg_change_percent', 0):+.1f}%)")
        if icp_data:
            print(f"  [>] ICP: {icp_data.get('primary_persona', '?')}")
        if comp_summary_data.get("available"):
            print(f"  [>] Competition: {comp_summary_data.get('overall_tier', '?')}")

    except Exception as e:
        print(f"\n  [✗] SCAN ERROR: {e}")
        traceback.print_exc()
        update_scan(scan_id, {
            "status": "failed",
            "synthesis_report": {"error": str(e)},
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })


# ═══════════════════════════════════════════════════════
# CLI USAGE
# ═══════════════════════════════════════════════════════
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run a RedditPulse scan")
    parser.add_argument("--keywords", nargs="+", help="Keywords to scan")
    parser.add_argument("--duration", default="10min", choices=["10min", "1h", "10h", "48h"])
    parser.add_argument("--scan-id", default="cli-test", help="Scan ID for Supabase")
    parser.add_argument("--user-id", default="", help="User ID for AI config lookup")
    parser.add_argument("--config-file", default="", help="JSON config file (overrides other args)")
    args = parser.parse_args()

    # If config file provided, read from it (safe — no shell injection)
    if args.config_file:
        with open(args.config_file, "r") as f:
            config = json.load(f)
        run_scan(
            config["scan_id"],
            config["keywords"],
            config.get("duration", "10min"),
            config.get("user_id", ""),
        )
    else:
        run_scan(args.scan_id, args.keywords or [], args.duration, args.user_id)
