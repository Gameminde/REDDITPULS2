"""
RedditPulse — Idea Graveyard (SEO Engine)
Pre-validates common failed startup ideas and caches the reports.
Public pages rank for "is [idea] a good startup idea" searches → organic traffic → signups.

Usage:
    from graveyard import seed_graveyard, get_graveyard_report
    seed_graveyard()  # run once to populate all 50+ ideas
"""

import os
import re
import json
import time
import hashlib
import requests
from datetime import datetime, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_KEY", ""))

# ═══════════════════════════════════════════════════════
# SEED LIST — 50+ commonly failed startup ideas
# ═══════════════════════════════════════════════════════

GRAVEYARD_IDEAS = [
    "Social network for pets",
    "Uber for dog walking",
    "AI-powered to-do list app",
    "Tinder for coworking spaces",
    "Blockchain-based voting platform",
    "Another note-taking app like Notion",
    "Crypto wallet for beginners",
    "Meal planning app with AI",
    "Social media scheduler tool",
    "AI resume builder",
    "Online tutoring marketplace",
    "Fitness tracking app",
    "AI writing assistant for blogs",
    "Marketplace for freelance designers",
    "Plant care reminder app",
    "Roommate matching platform",
    "Event planning app for small groups",
    "AI-powered email client",
    "Personal finance dashboard",
    "Habit tracking app",
    "Podcast discovery platform",
    "Local services marketplace",
    "Recipe sharing social network",
    "Mental health journaling app",
    "AI chatbot for customer support",
    "Gift recommendation engine",
    "Coupon aggregator app",
    "Group expense splitting app",
    "AI-powered logo maker",
    "Virtual event hosting platform",
    "Subscription box for snacks",
    "Language learning app with AI",
    "Smart home dashboard app",
    "Garage sale marketplace app",
    "Carpooling app for commuters",
    "AI interview practice tool",
    "Neighborhood watch app",
    "AI-powered dating profile writer",
    "Digital business card app",
    "Volunteer matching platform",
    "AI study buddy for students",
    "Time tracking tool for freelancers",
    "Subscription management dashboard",
    "AI-generated birthday cards",
    "Local restaurant review app",
    "Second-hand clothing marketplace",
    "AI-powered workout generator",
    "Meditation app with personalization",
    "Parking spot finder app",
    "AI homework helper",
    "QR code menu for restaurants",
    "Smart grocery list app",
]


def _slugify(text: str) -> str:
    """Convert idea text to URL-safe slug."""
    slug = text.lower().strip()
    slug = re.sub(r'[^a-z0-9\s-]', '', slug)
    slug = re.sub(r'[\s-]+', '-', slug)
    return slug[:80]


def _supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def generate_graveyard_report(idea_text: str) -> dict:
    """
    Generate a lightweight validation report for a graveyard idea.
    Uses Pass 1 only (market analysis) — no debate, no multi-model.
    Much cheaper than a full validation (~1 LLM call vs ~6).

    Returns: {slug, idea_text, verdict, confidence, pain_level,
              competition_tier, evidence_summary, top_posts}
    """
    slug = _slugify(idea_text)

    # Check if already exists
    if SUPABASE_URL:
        try:
            resp = requests.get(
                f"{SUPABASE_URL}/rest/v1/graveyard_reports",
                headers=_supabase_headers(),
                params={"slug": f"eq.{slug}", "select": "id,slug"},
                timeout=5,
            )
            if resp.status_code == 200 and resp.json():
                print(f"  [Graveyard] Skip (exists): {idea_text[:40]}")
                return resp.json()[0]
        except Exception:
            pass

    # Import AI brain for lightweight analysis
    try:
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "engine"))
        from multi_brain import AIBrain, get_user_ai_configs, extract_json
    except ImportError:
        print(f"  [Graveyard] ✗ Cannot import AI brain")
        return {"slug": slug, "idea_text": idea_text, "verdict": "UNKNOWN", "confidence": 0}

    # Single-pass lightweight analysis
    prompt = f"""Analyze this startup idea in 30 seconds. Be brutally honest.

IDEA: {idea_text}

Return ONLY valid JSON:
{{
  "verdict": "BUILD IT" or "RISKY" or "DON'T BUILD",
  "confidence": 0-100,
  "pain_level": "NONE" or "LOW" or "MEDIUM" or "HIGH",
  "competition_tier": "LOW" or "MEDIUM" or "HIGH" or "SATURATED",
  "evidence_summary": "2-3 sentence explanation of why this idea typically fails or succeeds",
  "common_failure_reasons": ["reason 1", "reason 2", "reason 3"],
  "better_angle": "If this idea could work, describe the one specific niche or twist that makes it viable"
}}"""

    system = "You are a startup advisor who has seen 10,000 pitches. Most ideas fail. Be honest about why."

    try:
        configs = []
        if os.environ.get("GEMINI_API_KEY"):
            configs.append({
                "id": "graveyard-gemini",
                "provider": "gemini",
                "api_key": os.environ["GEMINI_API_KEY"],
                "selected_model": "gemini-2.0-flash",
                "is_active": True,
                "priority": 1,
            })
        if os.environ.get("OPENROUTER_API_KEY"):
            configs.append({
                "id": "graveyard-openrouter",
                "provider": "openrouter",
                "api_key": os.environ["OPENROUTER_API_KEY"],
                "selected_model": "openrouter/deepseek/deepseek-r1",
                "is_active": True,
                "priority": 2,
            })
        if os.environ.get("OPENAI_API_KEY"):
            configs.append({
                "id": "graveyard-openai",
                "provider": "openai",
                "api_key": os.environ["OPENAI_API_KEY"],
                "selected_model": "gpt-4o",
                "is_active": True,
                "priority": 3,
            })
        if not configs:
            raise RuntimeError("No AI model environment variables configured for graveyard generation")
        brain = AIBrain(configs)
        raw = brain.single_call(prompt, system)
        result = extract_json(raw)
    except Exception as e:
        print(f"  [Graveyard] ✗ AI analysis failed for '{idea_text[:30]}': {e}")
        result = {
            "verdict": "RISKY",
            "confidence": 30,
            "pain_level": "UNKNOWN",
            "competition_tier": "UNKNOWN",
            "evidence_summary": f"Analysis failed: {e}",
        }

    report = {
        "slug": slug,
        "idea_text": idea_text,
        "verdict": result.get("verdict", "RISKY"),
        "confidence": result.get("confidence", 30),
        "pain_level": result.get("pain_level", "UNKNOWN"),
        "competition_tier": result.get("competition_tier", "UNKNOWN"),
        "evidence_summary": result.get("evidence_summary", ""),
        "top_posts": json.dumps({
            "common_failure_reasons": result.get("common_failure_reasons", []),
            "better_angle": result.get("better_angle", ""),
        }),
        "is_public": True,
    }

    # Save to Supabase
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/graveyard_reports",
                headers={**_supabase_headers(), "Prefer": "return=minimal"},
                json=report,
                timeout=10,
            )
            if resp.status_code in (200, 201):
                print(f"  [Graveyard] ✓ Saved: {idea_text[:40]} → {result.get('verdict')}")
            else:
                print(f"  [Graveyard] ✗ Save failed: {resp.status_code} {resp.text[:100]}")
        except Exception as e:
            print(f"  [Graveyard] ✗ Save error: {e}")

    return report


def seed_graveyard(max_concurrent: int = 3, delay: float = 2.0):
    """
    Generate reports for all ideas in GRAVEYARD_IDEAS.
    Skips any that already exist.
    Run this once to populate the graveyard, or periodically to refresh.
    """
    print(f"\n  [Graveyard] Seeding {len(GRAVEYARD_IDEAS)} ideas...")
    created = 0
    skipped = 0

    for i, idea in enumerate(GRAVEYARD_IDEAS):
        try:
            result = generate_graveyard_report(idea)
            if result.get("verdict") != "UNKNOWN":
                created += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"  [Graveyard] ✗ Error on '{idea[:30]}': {e}")
            skipped += 1

        if (i + 1) % 5 == 0:
            print(f"  [Graveyard] Progress: {i+1}/{len(GRAVEYARD_IDEAS)} ({created} created, {skipped} skipped)")

        time.sleep(delay)  # rate limit AI calls

    print(f"\n  [Graveyard] ✓ Done: {created} reports created, {skipped} skipped")


def get_graveyard_report(slug: str) -> dict:
    """Fetch a single graveyard report by slug."""
    if not SUPABASE_URL:
        return {}
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/graveyard_reports",
            headers=_supabase_headers(),
            params={"slug": f"eq.{slug}", "is_public": "eq.true"},
            timeout=10,
        )
        data = resp.json() if resp.status_code == 200 else []
        return data[0] if data else {}
    except Exception:
        return {}


def list_graveyard_reports(limit: int = 100) -> list:
    """List all public graveyard reports."""
    if not SUPABASE_URL:
        return []
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/graveyard_reports",
            headers=_supabase_headers(),
            params={"is_public": "eq.true", "order": "generated_at.desc", "limit": limit},
            timeout=10,
        )
        return resp.json() if resp.status_code == 200 else []
    except Exception:
        return []


# ═══════════════════════════════════════════════════════
# STANDALONE — run to seed the graveyard
# ═══════════════════════════════════════════════════════

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  Idea Graveyard — Seeder")
    print("=" * 60)
    seed_graveyard()
