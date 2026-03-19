"""
RedditPulse — Idea Enrichment Orchestrator
Calls SO + GitHub scrapers, caches results in Supabase, detects confirmed gaps.
"""

import os
import json
import time
from datetime import datetime, timezone, timedelta

import requests

from engine.stackoverflow_scraper import run_so_scrape
from engine.github_issues_scraper import run_github_scrape
from engine.g2_scraper import scrape_g2_signals
from engine.appstore_scraper import scrape_appstore_signals


SUPABASE_URL = os.environ.get("SUPABASE_URL", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", ""))
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", ""))


def _supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def get_cached_enrichment(topic_slug):
    """Check if we have fresh cached enrichment data (< 7 days old)."""
    if not SUPABASE_URL:
        return None

    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/enrichment_cache",
            params={
                "topic_slug": f"eq.{topic_slug}",
                "select": "*",
            },
            headers=_supabase_headers(),
            timeout=10,
        )
        if resp.status_code == 200:
            rows = resp.json()
            if rows:
                row = rows[0]
                # Check if expired
                expires = row.get("expires_at", "")
                if expires:
                    exp_dt = datetime.fromisoformat(expires.replace("Z", "+00:00"))
                    if exp_dt > datetime.now(timezone.utc):
                        return row  # Still fresh
                    # Expired — delete and re-enrich
                    return None
        return None
    except Exception as e:
        print(f"    [Enrich] Cache check error: {e}")
        return None


def save_enrichment(topic_slug, topic_name, so_data, gh_data, confirmed_gaps, g2_data=None, appstore_data=None):
    """Save enrichment results to Supabase cache."""
    if not SUPABASE_URL:
        print("    [Enrich] No SUPABASE_URL — skipping cache save")
        return None

    now = datetime.now(timezone.utc)
    row = {
        "topic_slug": topic_slug,
        "topic_name": topic_name,
        "so_questions": json.dumps(so_data.get("questions", []))[:50000],
        "so_total": so_data.get("total", 0),
        "so_top_tags": json.dumps(so_data.get("top_tags", [])),
        "gh_issues": json.dumps(gh_data.get("issues", []))[:50000],
        "gh_total": gh_data.get("total", 0),
        "gh_top_repos": json.dumps(gh_data.get("top_repos", [])),
        "g2_gaps": json.dumps((g2_data or {}).get("top_complaints", []))[:50000],
        "g2_total": (g2_data or {}).get("total", 0),
        "appstore_pains": json.dumps((appstore_data or {}).get("top_pains", []))[:50000],
        "appstore_total": (appstore_data or {}).get("total", 0),
        "confirmed_gaps": json.dumps(confirmed_gaps),
        "enriched_at": now.isoformat(),
        "expires_at": (now + timedelta(days=7)).isoformat(),
        "status": "done",
    }

    try:
        # PATCH existing row (created by API route with status="enriching")
        resp = requests.patch(
            f"{SUPABASE_URL}/rest/v1/enrichment_cache",
            params={"topic_slug": f"eq.{topic_slug}"},
            json=row,
            headers={
                **_supabase_headers(),
                "Prefer": "return=representation",
            },
            timeout=15,
        )
        if resp.status_code in (200, 201):
            result = resp.json()
            if result:
                print(f"    [Enrich] Cached enrichment for '{topic_slug}'")
                return result
            # Row didn't exist yet — fall back to INSERT
            resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/enrichment_cache",
                json=row,
                headers=_supabase_headers(),
                timeout=15,
            )
            if resp.status_code in (200, 201):
                print(f"    [Enrich] Cached enrichment for '{topic_slug}' (inserted)")
                return resp.json()
            else:
                print(f"    [Enrich] Cache insert error: {resp.status_code} — {resp.text[:200]}")
        else:
            print(f"    [Enrich] Cache save error: {resp.status_code} — {resp.text[:200]}")
    except Exception as e:
        print(f"    [Enrich] Cache save exception: {e}")

    return None


def detect_confirmed_gaps(so_data, gh_data, g2_data=None):
    """
    Triangulation: find gaps that appear in BOTH SO questions AND GitHub issues.
    When two independent sources point at the same missing feature, it's a confirmed gap.
    """
    gaps = []

    so_questions = so_data.get("questions", [])
    gh_issues = gh_data.get("issues", [])

    if not so_questions or not gh_issues:
        return gaps

    # Extract key terms from SO questions (titles)
    so_terms = set()
    for q in so_questions[:10]:
        title = q.get("title", "").lower()
        # Extract meaningful 2-3 word phrases
        words = title.split()
        for i in range(len(words) - 1):
            bigram = f"{words[i]} {words[i+1]}"
            if len(bigram) > 6 and not any(stop in bigram for stop in ["how to", "is it", "i am", "how do", "can i", "what is"]):
                so_terms.add(bigram)

    # Check if any SO terms appear in GitHub issue titles
    for issue in gh_issues[:10]:
        gh_title = issue.get("title", "").lower()
        for term in so_terms:
            if term in gh_title:
                gaps.append({
                    "gap_term": term,
                    "so_question": {
                        "title": next(
                            (q["title"] for q in so_questions if term in q.get("title", "").lower()),
                            ""
                        ),
                        "score": next(
                            (q["score"] for q in so_questions if term in q.get("title", "").lower()),
                            0
                        ),
                    },
                    "gh_issue": {
                        "title": issue["title"],
                        "thumbs_up": issue.get("thumbs_up", 0),
                        "repo": issue.get("repo", ""),
                    },
                    "confidence": "confirmed",
                })

    # Deduplicate by gap_term
    seen = set()
    unique_gaps = []
    for gap in gaps:
        if gap["gap_term"] not in seen:
            seen.add(gap["gap_term"])
            unique_gaps.append(gap)

    g2_phrases = {
        str(item.get("phrase", "")).lower()
        for item in (g2_data or {}).get("top_complaints", [])
        if item.get("phrase")
    }
    for gap in unique_gaps:
        if any(gap["gap_term"] in phrase for phrase in g2_phrases):
            gap["confidence"] = "triple-confirmed"
            gap["g2_match"] = True

    return unique_gaps[:5]  # Top 5 confirmed gaps


def enrich_idea(topic_slug, topic_name="", keywords=None, force_refresh=False):
    """
    Main enrichment function.
    1. Check cache (return immediately if fresh)
    2. Scrape SO + GitHub
    3. Detect confirmed gaps (triangulation)
    4. Cache results
    5. Return enrichment data
    """
    start = time.time()
    topic_name = topic_name or topic_slug.replace("-", " ").title()

    print(f"\n{'='*50}")
    print(f"  Enriching: {topic_name}")
    print(f"  Slug: {topic_slug}")
    print(f"{'='*50}")

    # Step 1: Check cache
    if not force_refresh:
        cached = get_cached_enrichment(topic_slug)
        if cached and cached.get("status") == "done":
            print(f"    [Enrich] Cache hit — serving cached data")
            elapsed = time.time() - start
            print(f"    Done in {elapsed:.1f}s (cached)")
            return _format_cached(cached)

    # Step 2: Scrape SO
    so_data = run_so_scrape(topic_slug, keywords)
    time.sleep(1)

    # Step 3: Scrape GitHub
    gh_data = run_github_scrape(topic_slug, keywords)

    # Step 4: Scrape G2 + App Store signals
    g2_data = scrape_g2_signals(topic_slug)
    appstore_query = (keywords or [topic_name])[0]
    appstore_data = scrape_appstore_signals(appstore_query)

    # Step 5: Detect confirmed gaps
    confirmed_gaps = detect_confirmed_gaps(so_data, gh_data, g2_data=g2_data)

    if confirmed_gaps:
        print(f"    [Enrich] 🎯 {len(confirmed_gaps)} Confirmed Gaps detected!")
        for gap in confirmed_gaps:
            print(f"      → '{gap['gap_term']}' (SO: {gap['so_question']['score']}⬆ + GH: {gap['gh_issue']['thumbs_up']}👍)")

    # Step 6: Cache results
    save_enrichment(topic_slug, topic_name, so_data, gh_data, confirmed_gaps, g2_data=g2_data, appstore_data=appstore_data)

    elapsed = time.time() - start
    print(f"\n    Enrichment complete in {elapsed:.1f}s")
    print(
        f"    SO: {so_data['total']} questions | GH: {gh_data['total']} issues | "
        f"G2: {g2_data['total']} reviews | App Store: {appstore_data['total']} reviews | "
        f"Gaps: {len(confirmed_gaps)}"
    )

    return {
        "topic_slug": topic_slug,
        "topic_name": topic_name,
        "status": "done",
        "stackoverflow": so_data,
        "github": gh_data,
        "g2": g2_data,
        "appstore": appstore_data,
        "confirmed_gaps": confirmed_gaps,
        "enriched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
    }


def _format_cached(row):
    """Format a cached Supabase row into the standard enrichment response."""
    def parse_json(val):
        if isinstance(val, str):
            try:
                return json.loads(val)
            except (json.JSONDecodeError, TypeError):
                return []
        return val if val else []

    return {
        "topic_slug": row.get("topic_slug", ""),
        "topic_name": row.get("topic_name", ""),
        "status": "done",
        "stackoverflow": {
            "questions": parse_json(row.get("so_questions")),
            "total": row.get("so_total", 0),
            "top_tags": parse_json(row.get("so_top_tags")),
        },
        "github": {
            "issues": parse_json(row.get("gh_issues")),
            "total": row.get("gh_total", 0),
            "top_repos": parse_json(row.get("gh_top_repos")),
        },
        "g2": {
            "top_complaints": parse_json(row.get("g2_gaps")),
            "total": row.get("g2_total", 0),
        },
        "appstore": {
            "top_pains": parse_json(row.get("appstore_pains")),
            "total": row.get("appstore_total", 0),
        },
        "confirmed_gaps": parse_json(row.get("confirmed_gaps")),
        "enriched_at": row.get("enriched_at", ""),
        "cached": True,
    }


if __name__ == "__main__":
    import sys
    import argparse

    parser = argparse.ArgumentParser(description="Enrich an idea with SO + GitHub + G2 + App Store signals")
    parser.add_argument("topic", nargs="?", default=None, help="Topic slug (e.g. invoice-automation)")
    parser.add_argument("--config-file", default="", help="Path to JSON config file (safe API mode)")
    parser.add_argument("--keywords", default="", help="Comma-separated keywords")
    parser.add_argument("--force", action="store_true", help="Force refresh (ignore cache)")
    args = parser.parse_args()

    # Config-file mode (from API route — safe, no shell interpolation)
    if args.config_file:
        with open(args.config_file, "r", encoding="utf-8") as f:
            config = json.load(f)
        topic = config.get("slug", "")
        topic_name = config.get("topic_name", "")
        kw_list = config.get("keywords", [])
        force = config.get("force", False)
    else:
        # Legacy CLI mode
        topic = args.topic or "invoice-automation"
        topic_name = ""
        kw_list = [k.strip() for k in args.keywords.split(",") if k.strip()] if args.keywords else ["invoice", "billing"]
        force = args.force

    result = enrich_idea(topic, topic_name=topic_name, keywords=kw_list, force_refresh=force)
    print(f"\n{'='*50}")
    print(f"Results for: {result['topic_name']}")
    print(f"SO: {result['stackoverflow']['total']} questions")
    print(f"GH: {result['github']['total']} issues")
    print(f"G2: {result['g2']['total']} reviews")
    print(f"App Store: {result['appstore']['total']} reviews")
    print(f"Confirmed Gaps: {len(result['confirmed_gaps'])}")

