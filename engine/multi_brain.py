"""
RedditPulse — Multi-Brain Debate Engine
Sends the same data to 2-3 AI models, collects independent analyses,
runs a debate round on disagreements, then synthesizes final report.
"""

import os
import sys
import json
import time
import requests
import concurrent.futures
from typing import Optional

# Add engine to path
sys.path.insert(0, os.path.dirname(__file__))

# ── Supabase config ──
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_KEY", ""))


def _supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def get_user_ai_configs(user_id):
    """Fetch active AI configs for a user, ordered by priority."""
    url = (
        f"{SUPABASE_URL}/rest/v1/user_ai_config"
        f"?select=id,provider,api_key,selected_model,is_active,priority,endpoint_url"
        f"&user_id=eq.{user_id}&is_active=eq.true&order=priority.asc"
    )
    try:
        r = requests.get(url, headers=_supabase_headers(), timeout=10)
        if r.status_code == 200:
            configs = r.json()
            # Ensure every config has an id for multi-instance tracking
            for i, c in enumerate(configs):
                if not c.get("id"):
                    c["id"] = f"auto-{i}-{c.get('provider', 'unknown')}"
            return configs
    except Exception as e:
        print(f"  [!] Failed to fetch AI configs: {e}")
    return []


# ═══════════════════════════════════════════════════════
# PROVIDER CALL FUNCTIONS (2026 models)
# ═══════════════════════════════════════════════════════

def call_gemini(prompt, system_prompt, api_key, model="gemini-3.1-pro"):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 16384},
    }
    r = requests.post(url, json=payload, timeout=120)
    if r.status_code != 200:
        raise Exception(f"Gemini {r.status_code}: {r.text[:300]}")
    return r.json()["candidates"][0]["content"]["parts"][0]["text"]


def call_anthropic(prompt, system_prompt, api_key, model="claude-opus-4.6"):
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "max_tokens": 16384,
        "system": system_prompt,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
    }
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    if r.status_code != 200:
        raise Exception(f"Anthropic {r.status_code}: {r.text[:300]}")
    return r.json()["content"][0]["text"]


def call_openai(prompt, system_prompt, api_key, model="gpt-5.4"):
    url = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3, "max_tokens": 16384,
    }
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    if r.status_code != 200:
        raise Exception(f"OpenAI {r.status_code}: {r.text[:300]}")
    return r.json()["choices"][0]["message"]["content"]


def call_groq(prompt, system_prompt, api_key, model="meta-llama/llama-4-scout-17b-16e-instruct"):
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3, "max_tokens": 8192,
    }
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    if r.status_code != 200:
        raise Exception(f"Groq {r.status_code}: {r.text[:300]}")
    return r.json()["choices"][0]["message"]["content"]


def call_grok(prompt, system_prompt, api_key, model="grok-4.1"):
    url = "https://api.x.ai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3, "max_tokens": 16384,
    }
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    if r.status_code != 200:
        raise Exception(f"Grok {r.status_code}: {r.text[:300]}")
    return r.json()["choices"][0]["message"]["content"]


def call_deepseek(prompt, system_prompt, api_key, model="deepseek-v4"):
    # DeepSeek maps model names to API IDs
    model_map = {
        "deepseek-v4": "deepseek-chat",
        "deepseek-v3.2-speciale": "deepseek-chat",
        "deepseek-reasoner": "deepseek-reasoner",
    }
    api_model = model_map.get(model, "deepseek-chat")
    url = "https://api.deepseek.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": api_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3, "max_tokens": 16384,
    }
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    if r.status_code != 200:
        raise Exception(f"DeepSeek {r.status_code}: {r.text[:300]}")
    return r.json()["choices"][0]["message"]["content"]


def call_minimax(prompt, system_prompt, api_key, model="minimax-01"):
    url = "https://api.minimax.chat/v1/text/chatcompletion_v2"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
    }
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    if r.status_code != 200:
        raise Exception(f"Minimax {r.status_code}: {r.text[:300]}")
    data = r.json()
    return data.get("choices", [{}])[0].get("message", {}).get("content", "")


def call_ollama(prompt, system_prompt, api_key, model="custom", endpoint_url=None):
    base = endpoint_url or "http://localhost:11434"
    url = f"{base}/api/chat"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
    }
    r = requests.post(url, json=payload, timeout=120)
    if r.status_code != 200:
        raise Exception(f"Ollama {r.status_code}: {r.text[:300]}")
    return r.json().get("message", {}).get("content", "")


def call_openrouter(prompt, system_prompt, api_key, model="anthropic/claude-3.5-sonnet", **_):
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://redditpulse.app",
        "X-Title": "RedditPulse",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3, "max_tokens": 16384,
    }
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    if r.status_code != 200:
        raise Exception(f"OpenRouter {r.status_code}: {r.text[:300]}")
    return r.json()["choices"][0]["message"]["content"]


# ── Model name normalization ── 
# Maps short/old/wrong names → correct API model IDs.
# If a model name is in this map, it gets auto-corrected before hitting the API.
# This handles stale DB entries, renamed models, and user typos.
MODEL_ALIASES = {
    # Groq aliases
    "llama-4-scout": "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-4-maverick": "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.3-70b": "llama-3.3-70b-versatile",
    "llama-3.1-8b": "llama-3.1-8b-instant",
    # Gemini aliases
    "gemini-3.1-pro": "gemini-2.0-flash",
    "gemini-3.1-flash-lite": "gemini-2.0-flash",
    "gemini-pro": "gemini-2.0-flash",
    "gemini-flash": "gemini-2.0-flash",
    # OpenAI aliases
    "gpt-5.2": "gpt-4o",
    "gpt-5": "gpt-4o",
    # Anthropic aliases
    "claude-opus-4.6": "claude-sonnet-4-20250514",
    # DeepSeek aliases
    "deepseek-v4": "deepseek-chat",
    "deepseek-v3.2-speciale": "deepseek-chat",
}


def resolve_model(model_name):
    """Resolve a model name through aliases. Returns the correct API model ID."""
    return MODEL_ALIASES.get(model_name, model_name)


# Provider dispatcher
PROVIDER_FUNCTIONS = {
    "gemini": call_gemini,
    "anthropic": call_anthropic,
    "openai": call_openai,
    "groq": call_groq,
    "grok": call_grok,
    "deepseek": call_deepseek,
    "minimax": call_minimax,
    "ollama": call_ollama,
    "openrouter": call_openrouter,
}


def call_provider(config, prompt, system_prompt):
    """Call a specific provider using its config. Returns (provider_name, model, response_text)."""
    provider = config["provider"]
    api_key = config["api_key"]
    model = resolve_model(config["selected_model"])  # Auto-correct model name
    endpoint_url = config.get("endpoint_url")

    fn = PROVIDER_FUNCTIONS.get(provider)
    if not fn:
        raise Exception(f"Unknown provider: {provider}")

    kwargs = {"prompt": prompt, "system_prompt": system_prompt, "api_key": api_key, "model": model}
    if provider == "ollama":
        kwargs["endpoint_url"] = endpoint_url

    text = fn(**kwargs)
    return provider, model, text


def extract_json(text):
    """Extract JSON from LLM response."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines)
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


# ═══════════════════════════════════════════════════════
# AI BRAIN — MULTI-MODEL DEBATE ENGINE
# ═══════════════════════════════════════════════════════

class AIBrain:
    """
    Multi-model debate engine.
    1. Sends same prompt to all configured models in parallel
    2. Collects independent analyses
    3. If verdicts disagree → debate round
    4. Synthesizes final report from all inputs
    """

    def __init__(self, configs):
        """configs: list of user_ai_config rows from Supabase."""
        self.configs = [c for c in configs if c.get("is_active", True)]
        # Ensure every config has a unique id
        for i, c in enumerate(self.configs):
            if not c.get("id"):
                c["id"] = f"auto-{i}-{c.get('provider', 'unknown')}"
        if not self.configs:
            raise Exception("No active AI models configured. Go to Settings → AI to add your API keys.")
        self._call_counter = 0
        print(f"  [Brain] Initialized with {len(self.configs)} agents:")
        for c in self.configs:
            print(f"    [{c['priority']}] {c['provider']}/{c['selected_model']} (id={c['id'][:8]})")

    def single_call(self, prompt, system_prompt):
        """Round-robin across all models — distributes load evenly."""
        idx = self._call_counter % len(self.configs)
        self._call_counter += 1
        config = self.configs[idx]
        provider, model, text = call_provider(config, prompt, system_prompt)
        print(f"  [Brain] Single call #{self._call_counter} → {provider}/{model} (agent {idx+1}/{len(self.configs)}, {len(text)} chars)")
        return text

    def debate(self, prompt, system_prompt, on_progress=None):
        """
        Full debate pipeline:
        1. All models analyze independently (parallel)
        2. If only 1 model → return its analysis directly
        3. If 2-3 models → check for disagreements → debate → synthesize
        """
        n = len(self.configs)

        # ── Step 1: Independent analysis ──
        print(f"\n  [Brain] ══ ROUND 1: Independent Analysis ({n} models) ══")
        if on_progress:
            on_progress("debating", f"Round 1: {n} models analyzing independently")

        analyses = []

        def _analyze(config):
            try:
                provider, model, text = call_provider(config, prompt, system_prompt)
                result = extract_json(text)
                return {"config_id": config["id"], "provider": provider, "model": model, "result": result, "raw": text, "error": None}
            except Exception as e:
                return {"config_id": config["id"], "provider": config["provider"], "model": config["selected_model"], "result": None, "raw": "", "error": str(e)}

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            futures = {executor.submit(_analyze, c): c for c in self.configs}
            for future in concurrent.futures.as_completed(futures):
                analysis = future.result()
                if analysis["error"]:
                    print(f"  [Brain] ✗ {analysis['provider']}/{analysis['model']}: {analysis['error']}")
                else:
                    print(f"  [Brain] ✓ {analysis['provider']}/{analysis['model']}: verdict={analysis['result'].get('verdict', '?')}")
                analyses.append(analysis)

        # Filter successful analyses
        valid = [a for a in analyses if a["result"] is not None]

        if len(valid) == 0:
            raise Exception("All AI models failed. Check your API keys in Settings.")

        if len(valid) == 1:
            print(f"  [Brain] Only 1 model succeeded → returning its analysis directly")
            return valid[0]["result"]

        # ── Step 2: Check for disagreements ──
        verdicts = [a["result"].get("verdict", "UNKNOWN") for a in valid]
        unique_verdicts = set(verdicts)
        print(f"\n  [Brain] Verdicts: {verdicts}")

        if len(unique_verdicts) == 1:
            # All agree → merge and return
            print(f"  [Brain] ══ CONSENSUS: All models agree on '{verdicts[0]}' ══")
            return self._merge_analyses(valid)

        # ── Step 3: Debate round ──
        print(f"\n  [Brain] ══ ROUND 2: Debate (models disagree!) ══")
        if on_progress:
            on_progress("debating", "Round 2: Models disagree — debate in progress")

        debate_prompt_template = """Your colleague AI models analyzed the SAME data and reached DIFFERENT conclusions.

YOUR ORIGINAL ANALYSIS:
{own_analysis}

OTHER MODELS' ANALYSES:
{other_analyses}

Given this disagreement, reconsider your verdict. You may:
1. HOLD your position if you believe your evidence is stronger
2. CHANGE your verdict if a colleague raised a point you missed

Respond with the same JSON format as before, but add a "debate_note" field explaining why you held or changed your position."""

        debate_results = []
        for a in valid:
            # Match by config_id, NOT provider name — critical for same-provider multi-agent
            others = [o for o in valid if o["config_id"] != a["config_id"]]
            if not others:
                # Only one analysis (shouldn't happen if we got here, but safety)
                debate_results.append({"provider": a["provider"], "model": a["model"], "result": a["result"]})
                continue

            others_text = "\n\n".join([
                f"=== {o['provider']}/{o['model']} (Verdict: {o['result'].get('verdict', '?')}) ===\n{json.dumps(o['result'], indent=2)}"
                for o in others
            ])

            debate_prompt = debate_prompt_template.format(
                own_analysis=json.dumps(a["result"], indent=2),
                other_analyses=others_text,
            )

            try:
                # Find the EXACT config by id, not by provider name
                config = next(c for c in self.configs if c["id"] == a["config_id"])
                _, _, text = call_provider(config, debate_prompt, system_prompt)
                result = extract_json(text)
                debate_results.append({
                    "provider": a["provider"],
                    "model": a["model"],
                    "result": result,
                    "debate_note": result.get("debate_note", ""),
                })
                print(f"  [Brain] Debate → {a['provider']}/{a['model']}: verdict={result.get('verdict', '?')} | note={result.get('debate_note', '')[:80]}")
            except Exception as e:
                print(f"  [Brain] Debate failed for {a['provider']}/{a['model']}: {e}")
                debate_results.append({"provider": a["provider"], "model": a["model"], "result": a["result"]})

        # ── Step 4: Final synthesis ──
        print(f"\n  [Brain] ══ FINAL SYNTHESIS ══")
        if on_progress:
            on_progress("synthesizing", "Synthesizing final report from debate results")

        return self._merge_analyses(
            [{"provider": d["provider"], "model": d["model"], "result": d["result"]} for d in debate_results]
        )

    def _merge_analyses(self, analyses):
        """Merge multiple model analyses into a single report with tiebreaker + dissent."""
        verdicts = [a["result"].get("verdict", "UNKNOWN") for a in analyses]
        confidences = [a["result"].get("confidence", 50) for a in analyses]

        # ── Majority vote with explicit tiebreaker ──
        from collections import Counter
        verdict_counts = Counter(verdicts)
        final_verdict = verdict_counts.most_common(1)[0][0]
        majority_count = verdict_counts[final_verdict]
        total_models = len(analyses)

        # ── Confidence: weighted by agreement strength ──
        if majority_count == total_models:
            # Unanimous — average confidence as-is
            avg_confidence = int(sum(confidences) / len(confidences))
            consensus_note = "unanimous"
        elif majority_count > total_models / 2:
            # True majority — use only majority models' confidence, penalized 10%
            majority_confs = [
                a["result"].get("confidence", 50) for a in analyses
                if a["result"].get("verdict") == final_verdict
            ]
            avg_confidence = int(sum(majority_confs) / len(majority_confs) * 0.9)
            consensus_note = "majority"
        else:
            # No majority (3-way tie) — use minimum (most conservative)
            avg_confidence = min(confidences)
            consensus_note = "no-majority"
            print(f"  [Brain] ⚠ No majority verdict — using most conservative confidence ({avg_confidence}%)")

        # ── Build dissent section ──
        dissent = []
        for a in analyses:
            v = a["result"].get("verdict", "?")
            if v != final_verdict:
                dissent.append({
                    "model": f"{a['provider']}/{a['model']}",
                    "verdict": v,
                    "confidence": a["result"].get("confidence", 0),
                    "reasoning": (
                        a["result"].get("debate_note", "")
                        or a["result"].get("executive_summary", "")
                        or a["result"].get("summary", "")
                    )[:300],
                })

        if dissent:
            print(f"  [Brain] Dissent from {len(dissent)} model(s):")
            for d in dissent:
                print(f"    {d['model']}: {d['verdict']} ({d['confidence']}%) — {d['reasoning'][:80]}...")

        # ── Merge evidence (deduplicate — use 200 chars to avoid false matches) ──
        all_evidence = []
        seen_evidence = set()
        for a in analyses:
            for ev in a["result"].get("evidence", []):
                ev_str = ev if isinstance(ev, str) else json.dumps(ev)
                ev_key = ev_str.lower().strip()[:200]
                if ev_key not in seen_evidence:
                    seen_evidence.add(ev_key)
                    all_evidence.append(ev)

        # Merge suggestions
        all_suggestions = []
        seen_sug = set()
        for a in analyses:
            for sug in a["result"].get("suggestions", []):
                sug_key = sug.lower().strip()[:200]
                if sug_key not in seen_sug:
                    seen_sug.add(sug_key)
                    all_suggestions.append(sug)

        # Merge risk_factors from all models
        all_risks = []
        seen_risks = set()
        for a in analyses:
            for risk in a["result"].get("risk_factors", []):
                risk_str = risk if isinstance(risk, str) else json.dumps(risk)
                risk_key = risk_str.lower().strip()[:200]
                if risk_key not in seen_risks:
                    seen_risks.add(risk_key)
                    all_risks.append(risk)

        # Merge action_plan items
        all_actions = []
        seen_actions = set()
        for a in analyses:
            for act in a["result"].get("action_plan", []):
                act_str = act if isinstance(act, str) else json.dumps(act)
                act_key = act_str.lower().strip()[:200]
                if act_key not in seen_actions:
                    seen_actions.add(act_key)
                    all_actions.append(act)

        # Merge top_posts from all models (dedup by title)
        all_top_posts = []
        seen_titles = set()
        for a in analyses:
            for tp in a["result"].get("top_posts", []):
                tp_title = (tp.get("title", "") if isinstance(tp, dict) else str(tp)).lower().strip()[:200]
                if tp_title and tp_title not in seen_titles:
                    seen_titles.add(tp_title)
                    all_top_posts.append(tp)

        # For text fields, pick the LONGEST version across all models (more detail = better)
        def _pick_longest(field, default=""):
            candidates = [str(a["result"].get(field, "")) for a in analyses if a["result"].get(field)]
            return max(candidates, key=len) if candidates else default

        # Build models_used
        models_used = [f"{a['provider']}/{a['model']}" for a in analyses]
        model_verdicts = {f"{a['provider']}/{a['model']}": a["result"].get("verdict", "?") for a in analyses}

        merged = {
            "verdict": final_verdict,
            "confidence": avg_confidence,
            "summary": _pick_longest("summary"),
            "evidence": all_evidence[:15],
            "audience_validation": _pick_longest("audience_validation"),
            "competitor_gaps": _pick_longest("competitor_gaps"),
            "price_signals": _pick_longest("price_signals"),
            "market_size_estimate": _pick_longest("market_size_estimate"),
            "risk_factors": all_risks[:8],
            "suggestions": all_suggestions[:10],
            "action_plan": all_actions[:8],
            "top_posts": all_top_posts[:6],
            # Multi-model metadata
            "models_used": models_used,
            "model_verdicts": model_verdicts,
            "debate_mode": len(analyses) > 1,
            # Tiebreaker metadata
            "consensus_strength": f"{majority_count}/{total_models}",
            "consensus_type": consensus_note,
            "dissent": dissent,
        }

        print(f"  [Brain] Final: {final_verdict} ({avg_confidence}%) — {majority_count}/{total_models} consensus, {len(all_evidence)} evidence, {len(all_risks)} risks")
        return merged


# ═══════════════════════════════════════════════════════
# STANDALONE TEST
# ═══════════════════════════════════════════════════════
if __name__ == "__main__":
    print("Multi-Brain Debate Engine — requires user AI configs in Supabase")
    print("Use via validate_idea.py or run_scan.py")
