"""
RedditPulse — AI Opportunity Analyzer
Per-post LLM analysis using the multi_brain.py provider system.
No duplicated provider logic — uses the same functions as the debate engine.
"""

import os
import json
import time
from typing import Optional

from multi_brain import call_gemini, call_groq, call_openai, extract_json

# ═══════════════════════════════════════════════════════
# AI PERSONA — The Opportunity Hunter
# ═══════════════════════════════════════════════════════
SYSTEM_PROMPT = """You are an elite business opportunity analyst working for a SaaS intelligence platform. 
You read Reddit posts and identify REAL business opportunities — problems people would PAY to solve.

For each post, you MUST respond with ONLY a JSON object (no markdown, no explanation):

{
  "is_opportunity": true/false,
  "problem_description": "One sentence describing the core problem",
  "urgency_score": 1-10,
  "willingness_to_pay": true/false,
  "wtp_evidence": "Quote or reasoning why they would/wouldn't pay",
  "opportunity_type": "saas" | "service" | "marketplace" | "content" | "tool" | "none",
  "market_size": "niche" | "medium" | "large" | "universal",
  "solution_idea": "One sentence — what product would solve this",
  "confidence": 1-10,
  "icp": {
    "persona": "freelancer" | "agency_owner" | "startup_founder" | "small_biz" | "enterprise" | "developer" | "marketer" | "creator" | "ecommerce" | "other",
    "persona_detail": "Short description: 'solo freelance designer, 2-5 years experience'",
    "tools_mentioned": ["Tool1", "Tool2"],
    "tools_sentiment": {"Tool1": "negative", "Tool2": "neutral"},
    "budget_signal": "none" | "price_sensitive" | "mid_range" | "premium",
    "budget_evidence": "Quote: '$20/month max' or 'enterprise budget'",
    "pain_intensity": "mild" | "moderate" | "severe" | "desperate"
  }
}

RULES:
- ONLY flag real business opportunities. Ignore venting, jokes, memes, personal problems.
- "willingness_to_pay" = true ONLY if there's evidence (mentions budget, pricing, alternatives, or desperation)
- "urgency_score" 8+ means they need this solved THIS WEEK
- "market_size" = "universal" means millions of people have this problem
- ICP fields: extract WHO is complaining. "persona" = their role. "tools_mentioned" = every product/tool name in the post. "budget_signal" = infer from context.
- Be ruthlessly objective. Most posts are NOT opportunities. That's fine.
- If the post is not a business opportunity, set is_opportunity to false and fill minimal fields.
"""

ANALYSIS_PROMPT = """Analyze this Reddit post for business opportunities:

Subreddit: r/{subreddit}
Title: {title}
Content: {content}
Upvotes: {score} | Comments: {num_comments}

Respond with ONLY the JSON object, nothing else."""


# ═══════════════════════════════════════════════════════
# PROVIDER CHAIN (uses multi_brain.py functions)
# ═══════════════════════════════════════════════════════

def _try_provider(fn, prompt, system, api_key, model):
    """Try a single provider, return parsed JSON or None."""
    try:
        text = fn(prompt, system, api_key, model)
        return extract_json(text)
    except Exception:
        return None


class OpportunityAnalyzer:
    """
    Per-post AI analyzer with automatic fallback chain.
    Uses multi_brain.py provider functions — no duplicated API code.
    Priority: Gemini Flash (free) → Groq (free) → OpenAI (paid)
    """
    
    def __init__(self):
        self.chain = []
        self.stats = {"analyzed": 0, "opportunities": 0, "errors": 0}
        
        # Build fallback chain from env vars
        gemini_key = os.environ.get("GEMINI_API_KEY", "")
        groq_key = os.environ.get("GROQ_API_KEY", "")
        openai_key = os.environ.get("OPENAI_API_KEY", "")
        
        if gemini_key:
            self.chain.append(("gemini", call_gemini, gemini_key, "gemini-3.1-flash-lite-preview"))
            print("  [AI] Gemini 3.1 Flash-Lite Preview loaded")
        if groq_key:
            self.chain.append(("groq", call_groq, groq_key, "meta-llama/llama-4-scout-17b-16e-instruct"))
            print("  [AI] Groq Llama 4 Scout loaded")
        if openai_key:
            self.chain.append(("openai", call_openai, openai_key, "gpt-5.4-mini"))
            print("  [AI] OpenAI GPT-5.4 Mini loaded")
        
        if not self.chain:
            print("  [!] No AI API keys found! Set GEMINI_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY")
    
    def analyze_post(self, post: dict) -> Optional[dict]:
        """Analyze a single post through the fallback chain."""
        prompt = ANALYSIS_PROMPT.format(
            subreddit=post.get("subreddit", "unknown"),
            title=post.get("title", ""),
            content=post.get("full_text", post.get("selftext", ""))[:2000],
            score=post.get("score", 0),
            num_comments=post.get("num_comments", 0),
        )
        
        for name, fn, key, model in self.chain:
            result = _try_provider(fn, prompt, SYSTEM_PROMPT, key, model)
            if result:
                result["ai_model_used"] = f"{name}/{model}"
                self.stats["analyzed"] += 1
                if result.get("is_opportunity"):
                    self.stats["opportunities"] += 1
                return result
            time.sleep(1)
        
        self.stats["errors"] += 1
        return None
    
    def analyze_batch(self, posts: list, delay: float = 1.0, callback=None) -> list:
        """Analyze a batch of posts with rate limiting."""
        results = []
        total = len(posts)
        
        for i, post in enumerate(posts):
            result = self.analyze_post(post)
            
            if result:
                result["post_id"] = post.get("id", "")
                results.append(result)
                is_opp = "OPP" if result.get("is_opportunity") else "skip"
                print(f"    [{i+1}/{total}] {is_opp} — {post.get('title', '')[:60]}")
            else:
                print(f"    [{i+1}/{total}] FAIL — {post.get('title', '')[:60]}")
            
            if callback:
                callback(post, result, i, total)
            
            time.sleep(delay)
        
        return results


if __name__ == "__main__":
    analyzer = OpportunityAnalyzer()
    
    test_post = {
        "id": "test1",
        "title": "Is there a tool that automatically generates invoices from my time tracking?",
        "full_text": "I'm a freelancer and I waste 2 hours every week manually creating invoices. I'd happily pay $20/month for something that just does this automatically.",
        "subreddit": "freelance",
        "score": 45,
        "num_comments": 23,
    }
    
    result = analyzer.analyze_post(test_post)
    if result:
        print("\n" + json.dumps(result, indent=2))
    else:
        print("\nNo AI providers configured. Set GEMINI_API_KEY in environment.")
