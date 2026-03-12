"""
RedditPulse — AI Report Synthesizer (Multi-Brain Edition)
Generates Market Signal Reports from scan results using AIBrain.
"""

import os
import json
from typing import Optional

SYNTHESIZER_PROMPT = """You are a world-class market analyst and startup advisor. You've just been given ALL the Reddit posts from a scan about a specific topic, along with individual AI analysis results.

Your job is to SYNTHESIZE everything into a single, actionable Market Signal Report. This is NOT a summary of posts — it's a strategic intelligence brief that a founder can use to decide whether to build a product.

You MUST respond with ONLY a JSON object (no markdown, no explanation):

{
  "title": "Short title for the opportunity area",
  "verdict": "BUILD" or "EXPLORE" or "SKIP",
  "verdict_reason": "One sentence explaining the verdict",
  "confidence": 1-10,
  "demand_signals": {
    "total_posts": <number>,
    "posts_with_wtp": <number>,
    "avg_urgency": <float>,
    "subreddits_seen": ["list of subreddits"],
    "time_span": "how far back the posts go"
  },
  "who_is_asking": "Describe the exact persona",
  "the_exact_pain": "Specific, visceral description of the problem",
  "what_theyve_tried": ["List of tools/solutions they tried and why they failed"],
  "competitor_sentiment": [
    {"name": "Competitor name", "complaint": "What people hate about it"}
  ],
  "pricing_signals": {
    "mentioned_budgets": ["$X/month"],
    "current_spend": "What they currently pay",
    "sweet_spot": "Recommended price point"
  },
  "suggested_positioning": "One-liner positioning statement",
  "gap_description": "What's specifically missing from existing solutions",
  "risk_factors": ["Risk 1", "Risk 2", "Risk 3"],
  "next_steps": ["3 concrete actions the founder should take this week"]
}

RULES:
- Be SPECIFIC. "Freelance designers with 2-5 years experience" not "creative professionals"
- Quote actual phrases from posts as evidence
- If the data doesn't support building, say SKIP — don't sugarcoat
- competitor_sentiment should come from actual negative mentions in posts
- pricing_signals should be based on what people actually said about budgets
"""

SYNTHESIS_USER_PROMPT = """Here are the scan results to synthesize:

SCAN KEYWORDS: {keywords}
TOTAL POSTS FOUND: {total_posts}
POSTS ANALYZED: {analyzed}

HIGH-SCORING RESULTS (urgency 5+):
{high_results}

WILLINGNESS TO PAY SIGNALS:
{wtp_signals}

RAW POST TITLES (sample):
{post_titles}

Generate the Market Signal Report as JSON."""


class ReportSynthesizer:
    """Generates Market Signal Reports using AIBrain (multi-model debate)."""

    def __init__(self, brain=None, user_id=""):
        """
        Initialize with an AIBrain instance or user_id to load config.
        Falls back to env var GEMINI_API_KEY if nothing else works.
        """
        self.brain = brain

        if not self.brain and user_id:
            try:
                from multi_brain import AIBrain, get_user_ai_configs
                configs = get_user_ai_configs(user_id)
                if configs:
                    self.brain = AIBrain(configs)
            except Exception as e:
                print(f"  [!] Failed to init AIBrain from user config: {e}")

        if not self.brain:
            # Fallback: build single-model brain from env
            api_key = os.environ.get("GEMINI_API_KEY", "")
            if api_key:
                try:
                    from multi_brain import AIBrain
                    self.brain = AIBrain([{
                        "provider": "gemini",
                        "api_key": api_key,
                        "selected_model": "gemini-2.0-flash",
                        "is_active": True,
                        "priority": 1,
                    }])
                except Exception:
                    pass

        if not self.brain:
            print("  ⚠ No AI models available — report synthesis disabled")

    def generate_report(self, scan: dict, results: list, posts: list) -> Optional[dict]:
        """Generate a synthesis report from scan data using multi-model debate."""
        if not self.brain:
            return None

        # Prepare high-scoring results
        high = [r for r in results if r.get("urgency_score", 0) >= 5]
        high_text = "\n".join([
            f"- [{r.get('urgency_score',0)}/10] {r.get('problem_description','')} | Type: {r.get('opportunity_type','')} | Market: {r.get('market_size','')}"
            for r in high[:30]
        ]) or "No high-scoring results found."

        # WTP signals
        wtp = [r for r in results if r.get("willingness_to_pay")]
        wtp_text = "\n".join([
            f"- {r.get('problem_description','')} — Evidence: \"{r.get('wtp_evidence','')}\""
            for r in wtp[:20]
        ]) or "No WTP signals detected."

        # Post titles
        titles = "\n".join([
            f"- [r/{p.get('subreddit','')}] {p.get('title','')}"
            for p in posts[:40]
        ]) or "No posts."

        keywords = ", ".join(scan.get("keywords", []))

        prompt = SYNTHESIS_USER_PROMPT.format(
            keywords=keywords,
            total_posts=scan.get("posts_found", len(posts)),
            analyzed=scan.get("posts_analyzed", len(results)),
            high_results=high_text,
            wtp_signals=wtp_text,
            post_titles=titles,
        )

        try:
            print(f"  🧠 Generating Market Signal Report for: {keywords}")
            # Use debate for multi-model, single_call for single model
            if len(self.brain.configs) > 1:
                report = self.brain.debate(prompt, SYNTHESIZER_PROMPT)
            else:
                raw = self.brain.single_call(prompt, SYNTHESIZER_PROMPT)
                from multi_brain import extract_json
                report = extract_json(raw)

            print(f"  ✅ Report generated: {report.get('verdict', '?')} — {report.get('title', '?')}")
            return report

        except Exception as e:
            print(f"  ⚠ Synthesis error: {e}")
            return None


if __name__ == "__main__":
    synth = ReportSynthesizer()
    mock_scan = {"keywords": ["invoice automation"], "posts_found": 34, "posts_analyzed": 28}
    mock_results = [
        {"urgency_score": 8, "problem_description": "Manual invoice creation from time tracking",
         "willingness_to_pay": True, "wtp_evidence": "Would pay $20/month",
         "opportunity_type": "saas", "market_size": "large"},
    ]
    mock_posts = [
        {"subreddit": "freelance", "title": "Is there a tool that auto-generates invoices from Toggl?"},
    ]
    report = synth.generate_report(mock_scan, mock_results, mock_posts)
    if report:
        print("\n" + json.dumps(report, indent=2))
