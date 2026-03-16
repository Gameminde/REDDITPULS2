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


def _extract_content(data: dict) -> str:
    """Safely extract text from any OpenAI-compatible response format.

    Handles:
    1. Standard: data["choices"][0]["message"]["content"]  (OpenAI/Groq/etc)
    2. Direct:   data["content"]                           (some OpenRouter models)
    3. Nested:   data["choices"][0]["text"]                (completion-style)
    """
    if "choices" in data and data["choices"]:
        choice = data["choices"][0]
        if "message" in choice:
            return choice["message"].get("content") or choice["message"].get("text", "")
        if "text" in choice:
            return choice["text"]
    if "content" in data:
        # Some providers (OpenRouter w/ certain models) return top-level content
        c = data["content"]
        if isinstance(c, list) and c:
            return c[0].get("text", "")  # Anthropic-style nested
        if isinstance(c, str):
            return c
    raise ValueError(f"Unexpected response format — keys: {list(data.keys())}")


def call_openai(prompt, system_prompt, api_key, model="gpt-4o"):
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
    return _extract_content(r.json())


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
    return _extract_content(r.json())


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
    return _extract_content(r.json())


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
    return _extract_content(r.json())


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
    return _extract_content(r.json())


def call_together(prompt, system_prompt, api_key, model="meta-llama/Llama-3-70b-chat-hf"):
    """Together AI — OpenAI-compatible endpoint, huge model catalog."""
    url = "https://api.together.xyz/v1/chat/completions"
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
        raise Exception(f"Together AI {r.status_code}: {r.text[:300]}")
    return _extract_content(r.json())


def call_nvidia(prompt, system_prompt, api_key, model="meta/llama-3.1-70b-instruct"):
    """NVIDIA NIM — OpenAI-compatible. Base URL: integrate.api.nvidia.com/v1"""
    url = "https://integrate.api.nvidia.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3, "max_tokens": 16384,
        "stream": False,
    }
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    if r.status_code != 200:
        raise Exception(f"NVIDIA NIM {r.status_code}: {r.text[:300]}")
    return _extract_content(r.json())


def call_fireworks(prompt, system_prompt, api_key, model="accounts/fireworks/models/llama-v3p1-70b-instruct"):
    """Fireworks AI — OpenAI-compatible."""
    url = "https://api.fireworks.ai/inference/v1/chat/completions"
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
        raise Exception(f"Fireworks {r.status_code}: {r.text[:300]}")
    return _extract_content(r.json())


def call_mistral(prompt, system_prompt, api_key, model="mistral-large-latest"):
    """Mistral AI — native API format."""
    url = "https://api.mistral.ai/v1/chat/completions"
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
        raise Exception(f"Mistral {r.status_code}: {r.text[:300]}")
    return _extract_content(r.json())


def call_cerebras(prompt, system_prompt, api_key, model="llama3.1-70b"):
    """Cerebras — OpenAI-compatible, ultra-fast inference."""
    url = "https://api.cerebras.ai/v1/chat/completions"
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
        raise Exception(f"Cerebras {r.status_code}: {r.text[:300]}")
    return _extract_content(r.json())


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
    "gpt-5.4": "gpt-4o",
    "gpt-5.3-codex": "gpt-4o",
    # Anthropic aliases
    "claude-opus-4.6": "claude-3-5-sonnet-20241022",
    "claude-sonnet-4.6": "claude-3-5-sonnet-20241022",
    "claude-haiku-4.5": "claude-3-5-haiku-20241022",
    # DeepSeek aliases
    "deepseek-v4": "deepseek-chat",
    "deepseek-v3.2-speciale": "deepseek-chat",
    # OpenRouter — fix broken Qwen model ID
    "qwen/qwen3-coder-480b-a35b": "qwen/qwen2.5-72b-instruct",
    # Together AI aliases
    "llama-3-70b": "meta-llama/Llama-3-70b-chat-hf",
    "llama-3.1-405b": "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo",
    "qwen2.5-72b": "Qwen/Qwen2.5-72B-Instruct-Turbo",
    # NVIDIA NIM aliases
    "llama-3.1-70b-nvidia": "meta/llama-3.1-70b-instruct",
    "nemotron-70b": "nvidia/llama-3.1-nemotron-70b-instruct",
    # Mistral aliases
    "mistral-large": "mistral-large-latest",
    "mixtral-8x22b": "open-mixtral-8x22b",
    "mistral-small": "mistral-small-latest",
    # Cerebras aliases
    "llama3.1-70b-cerebras": "llama3.1-70b",
    "llama3.3-70b-cerebras": "llama-3.3-70b",
    # Fireworks AI aliases
    "llama-3.1-70b-fireworks": "accounts/fireworks/models/llama-v3p1-70b-instruct",
    "deepseek-r1-fireworks": "accounts/fireworks/models/deepseek-r1",
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
    # New providers (2025)
    "together": call_together,
    "nvidia": call_nvidia,
    "fireworks": call_fireworks,
    "mistral": call_mistral,
    "cerebras": call_cerebras,
}


# ═══════════════════════════════════════════════════════
# FIX 2 — ADVERSARIAL ROLE ASSIGNMENT
# Each model gets a different analytical lens
# ═══════════════════════════════════════════════════════

AGENT_ROLES = {
    0: ("SKEPTIC", "Find reasons this will FAIL. Poke holes in the data. Consensus is your enemy — disagree if the evidence is thin."),
    1: ("BULL", "Find the strongest case FOR this opportunity. Steelman it. Look for hidden demand signals others miss."),
    2: ("MARKET_ANALYST", "Ignore hype. Focus strictly on: total addressable market, competition density, willingness-to-pay evidence, and switching costs."),
    3: ("TIMING_ANALYST", "Is this too early, too late, or perfect timing? Focus on trend velocity, adoption curves, and technology readiness."),
    4: ("ICP_ANALYST", "Who exactly pays for this? Define the ideal customer profile so precisely you could write a cold email to them right now."),
}

# ═══════════════════════════════════════════════════════
# FIX 3 — CALIBRATION BLOCK
# Ensures scores mean the same thing across all models
# ═══════════════════════════════════════════════════════

CALIBRATION_BLOCK = """

SCORE CALIBRATION (mandatory — use this scale):
- 85-100: Clear willingness-to-pay, growing market, weak competition. BUILD immediately.
- 65-84: Strong signal but 1-2 major unknowns remain. EXPLORE further.
- 45-64: Interesting pattern but insufficient evidence. MONITOR only.
- 25-44: Weak signal. Pain exists but WTP unclear or market saturated. SKIP.
- 0-24: INSUFFICIENT DATA or declining market. Output verdict DONT_BUILD.

ANTI-SYCOPHANCY RULES:
- If fewer than 10 posts mention this topic → output "INSUFFICIENT_DATA" as verdict
- Never invent market size numbers — say "unknown" if not in the data
- You MUST include a "top_unknowns" field: list your TOP 3 UNKNOWNS — things that would change your verdict if known
- Your confidence MUST be below 50 if you have more than 2 unknowns
- Do NOT agree with other models just to be agreeable. Disagree if the evidence supports it.
"""


def get_role_system_prompt(agent_index, base_prompt):
    """Inject adversarial role + calibration into each agent's system prompt."""
    role_name, role_instruction = AGENT_ROLES.get(agent_index % len(AGENT_ROLES), ("ANALYST", "Provide balanced analysis."))
    return f"{base_prompt}\n\nYOUR ROLE: {role_name}\n{role_instruction}{CALIBRATION_BLOCK}"


# ═══════════════════════════════════════════════════════
# FIX 1 — ANCHORING CASCADE PREVENTION
# Strip scores before showing analyses to peers in debate
# ═══════════════════════════════════════════════════════

def sanitize_for_debate(analysis_result):
    """Remove scores/verdicts to prevent anchoring. Only show reasoning + evidence."""
    return {
        "top_evidence": analysis_result.get("evidence", [])[:5],
        "top_unknowns": analysis_result.get("top_unknowns", []),
        "key_reasoning": (
            analysis_result.get("executive_summary", "")
            or analysis_result.get("summary", "")
        )[:500],
        "risk_factors": analysis_result.get("risk_factors", [])[:3],
        "price_signals": analysis_result.get("price_signals", "")[:300],
        # NO confidence score, NO verdict — prevents anchoring
    }


# ═══════════════════════════════════════════════════════
# FIX 4 — BASE RATE CONTEXT BUILDER
# ═══════════════════════════════════════════════════════

def build_data_context(posts, metadata=None):
    """Build base-rate context block that gets prepended to analysis prompts."""
    metadata = metadata or {}
    total_scraped = metadata.get("total_scraped", 0)
    match_count = len(posts) if isinstance(posts, list) else 0

    if total_scraped > 0 and match_count > 0:
        match_rate = match_count / total_scraped * 100
        signal_strength = (
            "STRONG signal (>5% match rate) — this topic has real traction"
            if match_rate > 5
            else "MODERATE signal (1-5% match rate) — promising but verify"
            if match_rate > 1
            else "WEAK signal (<1% match rate) — be very conservative in your assessment"
        )
    else:
        match_rate = 0
        signal_strength = "UNKNOWN signal strength — base rate data unavailable"

    return f"""DATA CONTEXT (read before analyzing):
- Total posts scraped this run: {total_scraped or 'unknown'}
- Posts matching this topic: {match_count}
- Match rate: {match_rate:.1f}%
- Signal assessment: {signal_strength}
- Time range: {metadata.get('date_range', 'unknown')}
- Platforms: {metadata.get('platforms', 'unknown')}

"""


def call_provider(config, prompt, system_prompt):
    """Call a specific provider using its config. Returns (provider_name, model, response_text)."""
    import time as _time
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

    _t0 = _time.time()
    print(f"  [Brain] >>> CALLING {provider}/{model} at {_time.strftime('%H:%M:%S')} ...", flush=True)
    text = fn(**kwargs)
    _elapsed = _time.time() - _t0
    print(f"  [Brain] <<< {provider}/{model} responded in {_elapsed:.1f}s ({len(text)} chars)", flush=True)
    return provider, model, text


def extract_json(text):
    """Extract JSON from LLM response, with truncated JSON repair."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines)
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        candidate = text[start:end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass  # Fall through to repair
    # Try to repair truncated JSON — LLMs sometimes cut off mid-output
    if start != -1:
        candidate = text[start:]
        repaired = _repair_truncated_json(candidate)
        if repaired is not None:
            return repaired
    # Last resort: original parse (will raise with clear error)
    if start != -1 and end != -1:
        return json.loads(text[start:end + 1])
    return json.loads(text)


def _repair_truncated_json(text):
    """Try to close unclosed brackets/braces in truncated JSON output.
    Returns parsed dict on success, None on failure."""
    # Strip trailing incomplete key-value pairs (common truncation pattern)
    # e.g., '..."key": "some incomplete value' → remove the dangling entry
    import re
    # Remove any trailing string that's clearly cut off (no closing quote)
    text = re.sub(r',\s*"[^"]*":\s*"[^"]*$', '', text)
    text = re.sub(r',\s*"[^"]*":\s*$', '', text)
    text = re.sub(r',\s*$', '', text)

    open_braces = text.count('{') - text.count('}')
    open_brackets = text.count('[') - text.count(']')
    if open_braces <= 0 and open_brackets <= 0:
        return None  # Not a truncation issue
    repaired = text + (']' * max(0, open_brackets)) + ('}' * max(0, open_braces))
    try:
        result = json.loads(repaired)
        print(f"  [JSON-REPAIR] Successfully repaired truncated JSON (closed {open_brackets} brackets, {open_braces} braces)")
        return result
    except json.JSONDecodeError:
        return None


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

    def single_call(self, prompt, system_prompt, pinned_index=None):
        """
        Fix H: Always use the SAME model for sequential passes within a validation run.
        Previously round-robined across models — meaning Pass 1, Pass 2, Pass 3 each went
        to a DIFFERENT model, causing error cascade where each pass reasoned on a different
        model's output of a digest of raw data.

        Default: pin to self.configs[0] (highest priority model by Supabase ordering).
        Pass pinned_index explicitly to override (e.g. for retry on different model).
        """
        if pinned_index is None:
            # Always use highest-priority config for sequential reasoning passes
            config = self.configs[0]
            idx = 0
        else:
            idx = pinned_index % len(self.configs)
            config = self.configs[idx]
        self._call_counter += 1
        provider, model, text = call_provider(config, prompt, system_prompt)
        print(f"  [Brain] Single call #{self._call_counter} → {provider}/{model} (pinned agent {idx+1}/{len(self.configs)}, {len(text)} chars)")
        return text

    def debate(self, prompt, system_prompt, on_progress=None, metadata=None):
        """
        Full 3-round debate pipeline (v2 — Opus-audited):
        1. All models analyze independently with adversarial roles (parallel)
        2. If verdicts disagree → debate with sanitized peer reasoning + non-LLM signals
        3. Weighted consensus (penalizes overconfidence)
        """
        n = len(self.configs)
        metadata = metadata or {}

        # ══ ROUND 1: Independent Analysis with Adversarial Roles ══
        print(f"\n  [Brain] ══ ROUND 1: Independent Analysis ({n} models, adversarial roles) ══")
        if n < 3:
            missing_roles = [AGENT_ROLES[i][0] for i in range(n, min(3, len(AGENT_ROLES)))]
            print(f"  [Brain] ⚠ Only {n} model(s) — {'+'.join([AGENT_ROLES[i][0] for i in range(n)])} assigned. "
                  f"Add {3 - n} more model(s) in Settings for {', '.join(missing_roles)} role(s).")
        if on_progress:
            on_progress("debating", f"Round 1: {n} models analyzing independently")

        analyses = []

        def _analyze(config, agent_index):
            # FIX 2: Each agent gets a unique role + FIX 3: Calibration
            role_prompt = get_role_system_prompt(agent_index, system_prompt)
            role_name = AGENT_ROLES.get(agent_index % len(AGENT_ROLES), ("ANALYST",))[0]

            # FIX 4: Inject base rate context into prompt
            contextualized_prompt = prompt
            if metadata:
                context_block = build_data_context(metadata.get("posts", []), metadata)
                contextualized_prompt = context_block + prompt

            try:
                provider, model, text = call_provider(config, contextualized_prompt, role_prompt)
                result = extract_json(text)
                # Ensure top_unknowns exists for weighted consensus
                if "top_unknowns" not in result:
                    result["top_unknowns"] = []
                return {
                    "config_id": config["id"], "provider": provider, "model": model,
                    "result": result, "raw": text, "error": None,
                    "role": role_name, "agent_index": agent_index,
                }
            except Exception as e:
                return {
                    "config_id": config["id"], "provider": config["provider"],
                    "model": config["selected_model"], "result": None, "raw": "",
                    "error": str(e), "role": role_name, "agent_index": agent_index,
                }

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            futures = {
                executor.submit(_analyze, c, i): c
                for i, c in enumerate(self.configs)
            }
            for future in concurrent.futures.as_completed(futures):
                analysis = future.result()
                if analysis["error"]:
                    print(f"  [Brain] ✗ {analysis['provider']}/{analysis['model']} [{analysis['role']}]: {analysis['error']}")
                else:
                    unknowns = len(analysis["result"].get("top_unknowns", []))
                    print(f"  [Brain] ✓ {analysis['provider']}/{analysis['model']} [{analysis['role']}]: "
                          f"verdict={analysis['result'].get('verdict', '?')} "
                          f"conf={analysis['result'].get('confidence', '?')} "
                          f"unknowns={unknowns}")
                analyses.append(analysis)

        valid = [a for a in analyses if a["result"] is not None]

        if len(valid) == 0:
            raise Exception("All AI models failed. Check your API keys in Settings.")

        # FIX 3: Detect if SKEPTIC role is missing from valid analyses
        valid_roles = {a["role"] for a in valid}
        if "SKEPTIC" not in valid_roles and n > 0:
            print(f"  [Brain] ⚠ SKEPTIC role missing from valid results! "
                  f"Roles present: {valid_roles}. Debate may lack adversarial tension.")

        if len(valid) == 1:
            print(f"  [Brain] Only 1 model succeeded → returning its analysis directly")
            return valid[0]["result"]

        # ── Check for disagreements ──
        verdicts = [a["result"].get("verdict", "UNKNOWN") for a in valid]
        unique_verdicts = set(verdicts)
        print(f"\n  [Brain] Verdicts: {verdicts} (roles: {[a['role'] for a in valid]})")

        if len(unique_verdicts) == 1:
            print(f"  [Brain] ══ CONSENSUS: All models agree on '{verdicts[0]}' ══")
            return self._weighted_merge(valid)

        # ══ ROUND 2: Debate with Sanitized Reasoning + Non-LLM Data ══
        print(f"\n  [Brain] ══ ROUND 2: Debate (models disagree — scores hidden from peers) ══")
        if on_progress:
            on_progress("debating", "Round 2: Models debating with hidden scores")

        # FIX 6: Gather non-LLM signals if available
        non_llm_block = ""
        if metadata:
            trends = metadata.get("trends_data", {})
            competition = metadata.get("competition_data", {})
            if trends or competition:
                non_llm_block = f"""\n\nINDEPENDENT DATA (not from any AI model — weight this heavily):
Google Trends velocity: {trends.get('trend_direction', 'unknown')} ({trends.get('growth_rate', 'unknown')}% change last 90 days)
Competition density: {competition.get('saturation_tier', 'unknown')}
Competitor count found: {competition.get('product_count', 'unknown')}
Strongest competitor: {competition.get('top_competitor', 'unknown')}
Stack Overflow activity: {trends.get('so_unanswered', 'unknown')} unanswered questions
GitHub interest: {trends.get('gh_reactions', 'unknown')} issue reactions
"""

        debate_prompt_template = """Multiple AI models analyzed the SAME data independently and reached DIFFERENT conclusions.

YOUR ORIGINAL ANALYSIS (for your reference only):
{own_analysis}

OTHER MODELS' REASONING (scores and verdicts HIDDEN to prevent anchoring):
{other_reasoning}
{non_llm_data}
Given this disagreement and the non-LLM data above, re-evaluate your position:
1. HOLD your position if your evidence is stronger
2. CHANGE your verdict if a colleague raised a point you genuinely missed

Do NOT change your verdict just to agree. The non-LLM data above cannot lie — weight it heavily.

Respond with the same JSON format. Add a "debate_note" field explaining why you held or changed."""

        debate_results = []
        for a in valid:
            others = [o for o in valid if o["config_id"] != a["config_id"]]
            if not others:
                debate_results.append({"provider": a["provider"], "model": a["model"], "result": a["result"], "role": a["role"]})
                continue

            # FIX 1: Sanitize — only show reasoning + evidence, NOT scores/verdicts
            others_text = "\n\n".join([
                f"=== Model [{o['role']}] ===\n{json.dumps(sanitize_for_debate(o['result']), indent=2)}"
                for o in others
            ])

            debate_prompt = debate_prompt_template.format(
                own_analysis=json.dumps(a["result"], indent=2),
                other_reasoning=others_text,
                non_llm_data=non_llm_block,
            )

            try:
                config = next(c for c in self.configs if c["id"] == a["config_id"])
                # Keep the same role-specific system prompt
                role_prompt = get_role_system_prompt(a["agent_index"], system_prompt)
                _, _, text = call_provider(config, debate_prompt, role_prompt)
                result = extract_json(text)
                if "top_unknowns" not in result:
                    result["top_unknowns"] = []
                debate_results.append({
                    "provider": a["provider"], "model": a["model"],
                    "result": result, "role": a["role"],
                    "debate_note": result.get("debate_note", ""),
                })
                action = "HELD" if result.get("verdict") == a["result"].get("verdict") else "CHANGED"
                print(f"  [Brain] Debate → [{a['role']}] {a['provider']}/{a['model']}: {action} → verdict={result.get('verdict', '?')} | {result.get('debate_note', '')[:80]}")
            except Exception as e:
                print(f"  [Brain] Debate failed for {a['provider']}/{a['model']}: {e}")
                debate_results.append({"provider": a["provider"], "model": a["model"], "result": a["result"], "role": a["role"]})

        # ══ FINAL SYNTHESIS with Weighted Consensus ══
        print(f"\n  [Brain] ══ FINAL SYNTHESIS (uncertainty-weighted) ══")
        if on_progress:
            on_progress("synthesizing", "Synthesizing with uncertainty-weighted consensus")

        return self._weighted_merge(
            [{"provider": d["provider"], "model": d["model"], "result": d["result"], "role": d.get("role", "ANALYST")} for d in debate_results]
        )

    def _weighted_merge(self, analyses):
        """
        FIX 5 — Uncertainty-Weighted Consensus.
        Models that admitted more unknowns get LESS weight.
        This rewards intellectual honesty over false confidence.
        """
        from collections import Counter

        verdicts = [a["result"].get("verdict", "UNKNOWN") for a in analyses]
        total_models = len(analyses)

        # ── Fix I: evidence-rewarding weight formula ──
        # OLD (broken): weight = 1 / (1 + unknowns * 0.2)
        # Problem: models that honestly listed 5 unknowns got weight=0.5 vs 1.0 for
        # a model that listed none — systematic reward for superficiality.
        #
        # NEW: weight based on evidence_count — models that cite more evidence from
        # the actual posts get more weight. Models that admit unknowns are NOT penalized.
        # Both evidence_count and unknowns are positive signals for epistemic honesty.
        weighted_entries = []
        for a in analyses:
            unknowns_count = len(a["result"].get("top_unknowns", []))
            evidence_count = len(a["result"].get("evidence", []))
            confidence = a["result"].get("confidence", 50)
            # More evidence cited = higher weight. Min weight 0.5 to avoid full exclusion.
            weight = max(0.5, 1.0 + (evidence_count * 0.1))
            weighted_entries.append({
                "provider": a["provider"],
                "model": a["model"],
                "role": a.get("role", "ANALYST"),
                "verdict": a["result"].get("verdict", "UNKNOWN"),
                "confidence": confidence,
                "weight": weight,
                "unknowns": unknowns_count,
                "evidence_count": evidence_count,
                "result": a["result"],
            })

        # ── Weighted majority vote ──
        verdict_weights = {}
        for e in weighted_entries:
            v = e["verdict"]
            verdict_weights[v] = verdict_weights.get(v, 0) + e["weight"]

        final_verdict = max(verdict_weights, key=verdict_weights.get)
        majority_count = sum(1 for e in weighted_entries if e["verdict"] == final_verdict)

        # ── Weighted confidence ──
        total_weight = sum(e["weight"] for e in weighted_entries)
        if total_weight > 0:
            weighted_confidence = sum(e["confidence"] * e["weight"] for e in weighted_entries) / total_weight
        else:
            weighted_confidence = sum(e["confidence"] for e in weighted_entries) / len(weighted_entries)

        # Cap confidence if high dissent
        dissent_count = sum(1 for e in weighted_entries if e["verdict"] != final_verdict)
        if dissent_count >= total_models / 2:
            weighted_confidence = min(weighted_confidence, 45)
            consensus_note = "high-dissent"
        elif majority_count == total_models:
            consensus_note = "unanimous"
        elif majority_count > total_models / 2:
            consensus_note = "majority"
        else:
            weighted_confidence = min(weighted_confidence, 40)
            consensus_note = "no-majority"

        avg_confidence = int(weighted_confidence)

        # ── Build dissent section with roles ──
        dissent = []
        for e in weighted_entries:
            if e["verdict"] != final_verdict:
                dissent.append({
                    "model": f"{e['provider']}/{e['model']}",
                    "role": e["role"],
                    "verdict": e["verdict"],
                    "confidence": e["confidence"],
                    "weight": round(e["weight"], 2),
                    "unknowns": e["unknowns"],
                    "reasoning": (
                        e["result"].get("debate_note", "")
                        or e["result"].get("executive_summary", "")
                        or e["result"].get("summary", "")
                    )[:300],
                })

        if dissent:
            print(f"  [Brain] Dissent from {len(dissent)} model(s):")
            for d in dissent:
                print(f"    [{d['role']}] {d['model']}: {d['verdict']} ({d['confidence']}%, weight={d['weight']}) — {d['reasoning'][:80]}")

        # ── Print weighting details ──
        print(f"  [Brain] Weights:")
        for e in weighted_entries:
            print(f"    [{e['role']}] {e['provider']}/{e['model']}: "
                  f"verdict={e['verdict']} conf={e['confidence']} "
                  f"unknowns={e['unknowns']} weight={e['weight']:.2f}")

        # ── Merge evidence (deduplicate) ──
        all_evidence = []
        seen_evidence = set()
        for a in analyses:
            for ev in a["result"].get("evidence", []):
                ev_str = ev if isinstance(ev, str) else json.dumps(ev)
                ev_key = ev_str.lower().strip()[:200]
                if ev_key not in seen_evidence:
                    seen_evidence.add(ev_key)
                    all_evidence.append(ev)

        all_suggestions = []
        seen_sug = set()
        for a in analyses:
            for sug in a["result"].get("suggestions", []):
                sug_key = sug.lower().strip()[:200]
                if sug_key not in seen_sug:
                    seen_sug.add(sug_key)
                    all_suggestions.append(sug)

        all_risks = []
        seen_risks = set()
        for a in analyses:
            for risk in a["result"].get("risk_factors", []):
                risk_str = risk if isinstance(risk, str) else json.dumps(risk)
                risk_key = risk_str.lower().strip()[:200]
                if risk_key not in seen_risks:
                    seen_risks.add(risk_key)
                    all_risks.append(risk)

        all_actions = []
        seen_actions = set()
        for a in analyses:
            for act in a["result"].get("action_plan", []):
                act_str = act if isinstance(act, str) else json.dumps(act)
                act_key = act_str.lower().strip()[:200]
                if act_key not in seen_actions:
                    seen_actions.add(act_key)
                    all_actions.append(act)

        all_top_posts = []
        seen_titles = set()
        for a in analyses:
            for tp in a["result"].get("top_posts", []):
                tp_title = (tp.get("title", "") if isinstance(tp, dict) else str(tp)).lower().strip()[:200]
                if tp_title and tp_title not in seen_titles:
                    seen_titles.add(tp_title)
                    all_top_posts.append(tp)

        # Merge all top_unknowns from all models (critical for transparency)
        all_unknowns = []
        seen_unknowns = set()
        for a in analyses:
            for unk in a["result"].get("top_unknowns", []):
                unk_key = unk.lower().strip()[:200]
                if unk_key not in seen_unknowns:
                    seen_unknowns.add(unk_key)
                    all_unknowns.append(unk)

        def _pick_longest(field, default=""):
            candidates = [str(a["result"].get(field, "")) for a in analyses if a["result"].get(field)]
            return max(candidates, key=len) if candidates else default

        models_used = [f"{a['provider']}/{a['model']}" for a in analyses]
        model_verdicts = {
            f"{a['provider']}/{a['model']}": {
                "verdict": a["result"].get("verdict", "?"),
                "role": a.get("role", "ANALYST"),
            }
            for a in analyses
        }

        merged = {
            "verdict": final_verdict,
            "confidence": avg_confidence,
            "summary": _pick_longest("summary"),
            "evidence": all_evidence[:25],
            "audience_validation": _pick_longest("audience_validation"),
            "competitor_gaps": _pick_longest("competitor_gaps"),
            "price_signals": _pick_longest("price_signals"),
            "market_size_estimate": _pick_longest("market_size_estimate"),
            "risk_factors": all_risks[:8],
            "suggestions": all_suggestions[:10],
            "action_plan": all_actions[:8],
            "top_posts": all_top_posts[:6],
            "top_unknowns": all_unknowns[:10],
            # Multi-model metadata
            "models_used": models_used,
            "model_verdicts": model_verdicts,
            "debate_mode": len(analyses) > 1,
            # Weighted consensus metadata
            "consensus_strength": f"{majority_count}/{total_models}",
            "consensus_type": consensus_note,
            "weighting_method": "inverse_uncertainty",
            "dissent": dissent,
        }

        print(f"  [Brain] Final: {final_verdict} ({avg_confidence}%) — "
              f"{majority_count}/{total_models} {consensus_note}, "
              f"{len(all_evidence)} evidence, {len(all_risks)} risks, "
              f"{len(all_unknowns)} unknowns surfaced")
        return merged


# ═══════════════════════════════════════════════════════
# STANDALONE TEST
# ═══════════════════════════════════════════════════════
if __name__ == "__main__":
    print("Multi-Brain Debate Engine — requires user AI configs in Supabase")
    print("Use via validate_idea.py or run_scan.py")
