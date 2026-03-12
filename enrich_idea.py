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


def save_enrichment(topic_slug, topic_name, so_data, gh_data, confirmed_gaps):
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
        "confirmed_gaps": json.dumps(confirmed_gaps),
        "enriched_at": now.isoformat(),
        "expires_at": (now + timedelta(days=7)).isoformat(),
        "status": "done",
    }

    try:
        # Upsert by topic_slug
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/enrichment_cache",
            json=row,
            headers={
                **_supabase_headers(),
                "Prefer": "resolution=merge-duplicates,return=representation",
            },
            timeout=15,
        )
        if resp.status_code in (200, 201):
            print(f"    [Enrich] Cached enrichment for '{topic_slug}'")
            return resp.json()
        else:
            print(f"    [Enrich] Cache save error: {resp.status_code} — {resp.text[:200]}")
    except Exception as e:
        print(f"    [Enrich] Cache save exception: {e}")

    return None


def detect_confirmed_gaps(so_data, gh_data):
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

    # Step 4: Detect confirmed gaps
    confirmed_gaps = detect_confirmed_gaps(so_data, gh_data)

    if confirmed_gaps:
        print(f"    [Enrich] 🎯 {len(confirmed_gaps)} Confirmed Gaps detected!")
        for gap in confirmed_gaps:
            print(f"      → '{gap['gap_term']}' (SO: {gap['so_question']['score']}⬆ + GH: {gap['gh_issue']['thumbs_up']}👍)")

    # Step 5: Cache results
    save_enrichment(topic_slug, topic_name, so_data, gh_data, confirmed_gaps)

    elapsed = time.time() - start
    print(f"\n    Enrichment complete in {elapsed:.1f}s")
    print(f"    SO: {so_data['total']} questions | GH: {gh_data['total']} issues | Gaps: {len(confirmed_gaps)}")

    return {
        "topic_slug": topic_slug,
        "topic_name": topic_name,
        "status": "done",
        "stackoverflow": so_data,
        "github": gh_data,
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
        "confirmed_gaps": parse_json(row.get("confirmed_gaps")),
        "enriched_at": row.get("enriched_at", ""),
        "cached": True,
    }


if __name__ == "__main__":
    import sys
    topic = sys.argv[1] if len(sys.argv) > 1 else "invoice-automation"
    result = enrich_idea(topic, keywords=["invoice", "billing"])
    print(f"\n{'='*50}")
    print(f"Results for: {result['topic_name']}")
    print(f"SO: {result['stackoverflow']['total']} questions")
    print(f"GH: {result['github']['total']} issues")
    print(f"Confirmed Gaps: {len(result['confirmed_gaps'])}")
