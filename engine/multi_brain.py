"""
RedditPulse — Multi-Brain Debate Engine
Sends the same data to 2-3 AI models, collects independent analyses,
runs a debate round on disagreements, then synthesizes final report.
"""

import os
import re
import sys
import json
import time
import logging
import requests
import concurrent.futures
from typing import Optional
from ai_gateway import (
    call_with_ai_policy,
    classify_ai_error,
    estimate_tokens as gateway_estimate_tokens,
    summarize_ai_telemetry,
)
from model_registry import resolve_model_name

# Add engine to path
sys.path.insert(0, os.path.dirname(__file__))

# ── Supabase config ──
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_KEY", ""))
AI_ENCRYPTION_KEY = os.environ.get("AI_ENCRYPTION_KEY", "").strip()
ALLOW_LEGACY_PLAINTEXT_AI_CONFIG = os.environ.get("ALLOW_LEGACY_PLAINTEXT_AI_CONFIG", "").strip().lower() in ("1", "true", "yes")
logger = logging.getLogger(__name__)


def _supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def get_user_ai_configs(user_id):
    """Fetch active AI configs for a user, ordered by priority."""
    rpc_url = f"{SUPABASE_URL}/rest/v1/rpc/get_ai_configs_decrypted"
    legacy_url = (
        f"{SUPABASE_URL}/rest/v1/user_ai_config"
        f"?select=id,provider,api_key,selected_model,is_active,priority,endpoint_url"
        f"&user_id=eq.{user_id}&is_active=eq.true&order=priority.asc"
    )

    def _finalize(configs):
        usable = []
        missing_keys = 0
        for i, config in enumerate(configs):
            if not config.get("api_key"):
                missing_keys += 1
                continue
            if not config.get("id"):
                config["id"] = f"auto-{i}-{config.get('provider', 'unknown')}"
            usable.append(config)
        if missing_keys:
            print(f"  [!] Ignoring {missing_keys} AI config(s) with no stored API key")
        return usable

    try:
        if AI_ENCRYPTION_KEY:
            rpc_resp = requests.post(
                rpc_url,
                headers=_supabase_headers(),
                json={"p_user_id": user_id, "p_key": AI_ENCRYPTION_KEY},
                timeout=10,
            )
            if rpc_resp.status_code == 200:
                return _finalize(rpc_resp.json() or [])

            print(f"  [!] Decrypted AI config RPC failed ({rpc_resp.status_code}): {rpc_resp.text[:200]}")
            if not ALLOW_LEGACY_PLAINTEXT_AI_CONFIG:
                return []
        else:
            print("  [!] AI_ENCRYPTION_KEY missing - encrypted AI configs cannot be decrypted")
            if not ALLOW_LEGACY_PLAINTEXT_AI_CONFIG:
                return []

        print("  [!] Legacy plaintext AI config compatibility mode enabled")
        legacy_resp = requests.get(legacy_url, headers=_supabase_headers(), timeout=10)
        if legacy_resp.status_code == 200:
            return _finalize(legacy_resp.json() or [])
        print(f"  [!] Legacy AI config query failed ({legacy_resp.status_code}): {legacy_resp.text[:200]}")
    except Exception as e:
        print(f"  [!] Failed to fetch AI configs: {e}")
    return []


# ═══════════════════════════════════════════════════════
# PROVIDER CALL FUNCTIONS (2026 models)
# ═══════════════════════════════════════════════════════

def call_gemini(prompt, system_prompt, api_key, model="gemini-3.1-pro-preview"):
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


def call_anthropic(prompt, system_prompt, api_key, model="claude-sonnet-4-6"):
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
        "temperature": 0.3, "max_tokens": 16384,  # Was 8192 — caused Pass 3 JSON truncation
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


def call_openrouter(prompt, system_prompt, api_key, model="openrouter/deepseek/deepseek-r1", **_):
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://redditpulse.app",
        "X-Title": "RedditPulse",
    }
    api_model = model.replace("openrouter/", "", 1) if model.startswith("openrouter/") else model
    payload = {
        "model": api_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3, "max_tokens": 16384,
    }
    r = requests.post(url, json=payload, headers=headers, timeout=(10, 60))
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
    "gemini-3-pro": "gemini-3.1-pro-preview",
    "gemini-3-pro-preview": "gemini-3.1-pro-preview",
    "gemini-3.1-pro": "gemini-3.1-pro-preview",
    "gemini-3-flash": "gemini-3-flash-preview",
    "gemini-3.1-flash": "gemini-3-flash-preview",
    "gemini-3-flash-lite": "gemini-3.1-flash-lite-preview",
    "gemini-3.1-flash-lite": "gemini-3.1-flash-lite-preview",
    # OpenAI aliases
    "gpt-5.2": "gpt-5.4",
    "gpt-5": "gpt-5.4",
    "gpt-5-mini": "gpt-5.4-mini",
    "gpt-5-nano": "gpt-5.4-nano",
    # Anthropic aliases
    "claude-opus-4.5": "claude-opus-4-5-20251101",
    "claude-opus-4.6": "claude-opus-4-6",
    "claude-sonnet-4": "claude-sonnet-4-20250514",
    "claude-sonnet-4.5": "claude-sonnet-4-5-20250929",
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-haiku-4.5": "claude-haiku-4-5",
    # DeepSeek aliases
    "deepseek-v4": "deepseek-chat",
    "deepseek-v3.2-speciale": "deepseek-chat",
    # OpenRouter — fix broken Qwen model ID
    "qwen/qwen3-coder-480b-a35b": "qwen/qwen2.5-72b-instruct",
    "hunter-alpha": "openrouter/deepseek/deepseek-r1",
    "openrouter/hunter-alpha": "openrouter/deepseek/deepseek-r1",
    "openrouter/openrouter/hunter-alpha": "openrouter/deepseek/deepseek-r1",
    "openrouter/deepseek/deepseek-r1:free": "openrouter/deepseek/deepseek-r1",
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
    return resolve_model_name(model_name)


def _assigned_roles(count: int):
    """Return the ordered role list for the current agent count."""
    return [AGENT_ROLES[i][0] for i in range(min(count, len(AGENT_ROLES)))]


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

ROUND2_DISCIPLINE_BLOCK = """

CONFIDENCE RULES FOR ROUND 2:
- Your confidence score may ONLY increase if you directly rebut a specific argument made by another model. Name the role ([BULL], [SKEPTIC], or [MARKET_ANALYST]) and explain why their point is wrong or incomplete.
- If you cannot rebut any opposing argument, your confidence must stay at or below your Round 1 score.
- If you concede a major point raised by another model, reduce your confidence by 5-10 points.
- A response that simply restates your Round 1 position without engaging opposing arguments is not a rebuttal.

ENGAGEMENT REQUIREMENT:
- You must explicitly reference at least one argument from another model using their role label ([BULL], [SKEPTIC], or [MARKET_ANALYST]).
- If you do not reference any other model, your response will be treated as a position restatement, not a debate contribution.
"""


def get_role_system_prompt(agent_index, base_prompt):
    """Inject adversarial role + calibration into each agent's system prompt."""
    role_name, role_instruction = AGENT_ROLES.get(agent_index % len(AGENT_ROLES), ("ANALYST", "Provide balanced analysis."))
    return f"{base_prompt}\n\nYOUR ROLE: {role_name}\n{role_instruction}{CALIBRATION_BLOCK}"


def get_round2_role_system_prompt(agent_index, base_prompt):
    """Round 2 adds debate-discipline rules on top of the normal role prompt."""
    return f"{get_role_system_prompt(agent_index, base_prompt)}{ROUND2_DISCIPLINE_BLOCK}"


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


def clamp_confidence(value, default=50):
    """Keep confidence within 0-100 and robust to bad model output."""
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return max(0, min(100, int(default)))


def normalize_verdict_text(value, default="RISKY"):
    verdict = str(value or default).strip().upper().replace("-", "_").replace(" ", "_")
    verdict = verdict.replace("DON'T_", "DONT_").replace("DON_T_", "DONT_")
    return verdict or default


def extract_argument_text(result):
    if not isinstance(result, dict):
        return ""
    return str(
        result.get("debate_note")
        or result.get("executive_summary")
        or result.get("summary")
        or ""
    ).strip()


def calculate_engagement(response_text: str, other_roles: list[str]) -> tuple[int, str]:
    """
    Count how many other model roles are explicitly referenced in this response.
    other_roles = the roles of the OTHER 2 models (not this one)
    """
    normalized_text = str(response_text or "").upper()
    unique_roles = list(dict.fromkeys(role.upper() for role in other_roles if role))
    count = sum(1 for role in unique_roles if f"[{role}]" in normalized_text or role in normalized_text)
    total = max(len(unique_roles), 1)
    if count >= total:
        return total, f"Engaged {total}/{total} models"
    if count == 1:
        return 1, f"Partial engagement (1/{total} models)"
    return 0, "Restated position - no opposing models referenced"


def extract_first_substantive_sentence(text: str) -> Optional[str]:
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip().strip('"')
    if not cleaned:
        return None

    parts = re.split(r"(?<=[.!?])\s+", cleaned)
    for part in parts:
        candidate = part.strip().strip('"')
        if len(candidate) < 25:
            continue
        if len(candidate.split()) < 5:
            continue
        if not re.search(r"[A-Za-z]", candidate):
            continue
        return candidate

    return None


def build_dissent_reason(argument_text: str, verdict: str) -> Optional[str]:
    direct_sentence = extract_first_substantive_sentence(argument_text)
    if direct_sentence:
        return direct_sentence

    cleaned = re.sub(r"\s+", " ", str(argument_text or "")).strip().strip('"')
    if not cleaned:
        return None

    snippet = cleaned[:140].rstrip(" .")
    if not snippet:
        return None

    return f"{normalize_verdict_text(verdict, 'RISKY')} dissent focused on {snippet}."


def generate_round2_summary(r1_entries, r2_entries) -> str:
    changed = [entry for entry in r2_entries if not entry.get("held", True)]
    conf_increased_without_rebuttal = [
        entry for entry in r2_entries
        if entry.get("confidence_delta", 0) > 0 and entry.get("engagement_score", 0) == 0
    ]

    parts = []
    if not changed:
        parts.append("No verdicts changed.")
    else:
        parts.append(f"{len(changed)} model(s) changed verdict.")

    if r2_entries:
        best_debater = max(r2_entries, key=lambda entry: entry.get("engagement_score", 0))
        if best_debater.get("engagement_score", 0) >= 2:
            parts.append(f"{best_debater.get('role', 'ANALYST')} engaged both opposing models.")
        elif best_debater.get("engagement_score", 0) == 1:
            parts.append(f"{best_debater.get('role', 'ANALYST')} partially engaged one model.")

    for entry in conf_increased_without_rebuttal:
        parts.append(
            f"{entry.get('role', 'ANALYST')} raised confidence +{entry.get('confidence_delta', 0)}pts without rebutting any opposing argument."
        )

    return " ".join(parts).strip()


def _meaningful_tokens(text: str) -> set[str]:
    words = re.findall(r"[A-Za-z0-9']+", str(text or "").lower())
    stopwords = {
        "about", "after", "again", "also", "among", "around", "because", "being",
        "build", "built", "could", "does", "from", "have", "held", "into", "just",
        "more", "need", "only", "other", "position", "risk", "risky", "same",
        "should", "still", "that", "their", "them", "there", "they", "this",
        "through", "using", "very", "were", "what", "when", "with", "would",
    }
    return {
        word for word in words
        if len(word) >= 4 and word not in stopwords
    }


def build_stance_summary(argument_text: str, verdict: Optional[str] = None, max_words: int = 16) -> str:
    sentence = extract_first_substantive_sentence(argument_text)
    base = sentence or re.sub(r"\s+", " ", str(argument_text or "")).strip().strip('"')
    if not base:
        fallback = normalize_verdict_text(verdict, "RISKY").replace("_", " ")
        return f"{fallback.title()} position held."

    summary = re.sub(r"\s+", " ", base).strip().strip('"')
    summary = _truncate_words(summary, max_words)
    summary = summary.rstrip(" ,;:")
    if not summary.endswith("."):
        summary += "."
    return summary


def collect_engaged_model_ids(response_text: str, other_models: list[dict]) -> list[str]:
    normalized_text = str(response_text or "").upper()
    engaged = []
    for model in other_models:
        role = str(model.get("role") or "").upper()
        model_id = model.get("config_id") or model.get("id")
        if not role or not model_id:
            continue
        if f"[{role}]" in normalized_text or role in normalized_text:
            engaged.append(str(model_id))
    return list(dict.fromkeys(engaged))


def determine_response_mode(round_number: int, held: bool, engagement_score: int) -> str:
    if round_number <= 1:
        return "claim"
    if not held:
        return "change"
    if engagement_score > 0:
        return "rebuttal"
    return "hold"


def _coerce_tier_label(raw_value, default="SUPPORTING") -> str:
    value = str(raw_value or "").strip().upper().replace("-", "_").replace(" ", "_")
    if not value:
        return default
    if value in {"DIRECT", "BUYER_NATIVE_DIRECT", "DIRECT_SIGNAL"}:
        return "DIRECT"
    # RECON_BUYER_SIGNAL must NOT be coerced to DIRECT — recon signals are
    # AI-inferred, not canonical evidence.  Keep them visually distinct
    # so the evidence board never contradicts the canonical direct count.
    if value in {"DIRECT_BUYER", "RECON_BUYER_SIGNAL"}:
        return "RECON_BUYER_SIGNAL"
    if value in {"ADJACENT", "SUPPORTING", "SUPPORTING_CONTEXT", "CONTEXT"}:
        return "SUPPORTING" if value != "CONTEXT" else "CONTEXT"
    if value in {"RISK", "UNKNOWN"}:
        return value
    return value


def _extract_board_text(item) -> str:
    if isinstance(item, dict):
        for key in ("title", "what_it_proves", "summary", "text", "body", "quote"):
            value = str(item.get(key, "")).strip()
            if value:
                return value
        return json.dumps(item, sort_keys=True)[:220]
    return str(item or "").strip()


def _extract_board_source_type(item) -> str:
    if isinstance(item, dict):
        source_type = (
            item.get("source_type")
            or item.get("source")
            or item.get("platform")
            or item.get("channel")
            or "model_evidence"
        )
        return str(source_type).strip() or "model_evidence"
    return "model_evidence"


def _extract_board_source_ref(item) -> str:
    if isinstance(item, dict):
        for key in ("url", "permalink", "id", "title"):
            value = str(item.get(key, "")).strip()
            if value:
                return value[:160]
    return _extract_board_text(item)[:160]


def _extract_board_why(item) -> str:
    if isinstance(item, dict):
        for key in ("why_it_matters", "what_it_proves", "summary", "note"):
            value = str(item.get(key, "")).strip()
            if value:
                return _truncate_words(value, 24)
    return "Referenced by the debate as supporting evidence."


def _recon_summary_to_board_entries(recon_summary: dict | None) -> list[dict]:
    if not isinstance(recon_summary, dict):
        return []

    entries = []

    for signal in recon_summary.get("buyer_signals", [])[:3]:
        quote = str(signal.get("quote") or signal.get("text") or "").strip()
        if not quote:
            continue
        entries.append({
            "text": quote[:140],
            "tier": "RECON_BUYER_SIGNAL",
            "source_type": "buyer_signal",
            "source_ref": signal.get("post_title") or signal.get("source_ref") or "recon",
            "why_it_matters": "AI-inferred buyer signal from recon pass — not canonical direct evidence.",
        })

    for cluster in recon_summary.get("pain_clusters", [])[:3]:
        label = str(cluster.get("problem") or cluster.get("summary") or "").strip()
        if not label:
            continue
        post_count = cluster.get("post_count")
        subreddits = cluster.get("subreddits") or cluster.get("sources") or []
        refs = ", ".join(str(item) for item in subreddits[:3] if str(item).strip())
        entries.append({
            "text": f"{label} ({post_count or 'n/a'} posts)" if post_count else label,
            "tier": "PAIN_CLUSTER",
            "source_type": "pain_cluster",
            "source_ref": refs or "recon",
            "why_it_matters": "Repeated pain clustered before the debate so the room reasons over wedges, not noise.",
        })

    for comp in recon_summary.get("competitor_mentions", [])[:2]:
        name = str(comp.get("product") or comp.get("name") or "").strip()
        complaint = str(comp.get("complaint") or comp.get("gap") or "").strip()
        if not name:
            continue
        text = f"Users mention {name}" + (f" but complain about {complaint}" if complaint else "")
        entries.append({
            "text": text,
            "tier": "COMPETITOR_GAP",
            "source_type": "competitor_gap",
            "source_ref": comp.get("post_title") or "recon",
            "why_it_matters": "Existing tools are in the market, but the recon pass found an unresolved gap.",
        })

    for price in recon_summary.get("price_anchors", [])[:2]:
        text = str(price.get("text") or price.get("quote") or "").strip()
        if not text:
            continue
        entries.append({
            "text": text[:140],
            "tier": "PRICE_SIGNAL",
            "source_type": "price_anchor",
            "source_ref": price.get("post_title") or "recon",
            "why_it_matters": "Concrete pricing language grounds monetization assumptions.",
        })

    for timing in recon_summary.get("timing_markers", [])[:2]:
        text = str(timing.get("text") or timing.get("summary") or "").strip()
        if not text:
            continue
        entries.append({
            "text": text[:140],
            "tier": "TIMING_MARKER",
            "source_type": "timing_marker",
            "source_ref": timing.get("post_title") or "recon",
            "why_it_matters": "Time-sensitive context that can change build timing without proving pain by itself.",
        })

    return entries


def build_evidence_board(
    evidence_items,
    metadata=None,
    top_unknowns=None,
    risk_factors=None,
    max_items: int = 10,
) -> list[dict]:
    metadata = metadata or {}
    board = []
    seen = set()

    def _push(entry: dict):
        if len(board) >= max_items:
            return
        text_key = str(entry.get("text", "")).lower().strip()[:220]
        if not text_key or text_key in seen:
            return
        seen.add(text_key)
        board.append(entry)

    for item in evidence_items or []:
        text = _truncate_words(_extract_board_text(item), 28)
        if not text:
            continue
        tier = "DIRECT"
        if isinstance(item, dict):
            tier = _coerce_tier_label(
                item.get("tier")
                or item.get("evidence_tier")
                or item.get("directness_tier")
                or item.get("signal_kind"),
                default="SUPPORTING",
            )
        _push({
            "id": f"E{len(board) + 1}",
            "text": text,
            "tier": tier,
            "source_type": _extract_board_source_type(item),
            "source_ref": _extract_board_source_ref(item),
            "why_it_matters": _extract_board_why(item),
        })

    for item in _recon_summary_to_board_entries(metadata.get("recon_summary")):
        _push({
            "id": f"E{len(board) + 1}",
            **item,
        })

    trends = metadata.get("trends_data", {}) if isinstance(metadata.get("trends_data"), dict) else {}
    competition = metadata.get("competition_data", {}) if isinstance(metadata.get("competition_data"), dict) else {}

    if trends:
        trend_direction = trends.get("trend_direction") or trends.get("overall_trend") or "unknown"
        growth_rate = trends.get("growth_rate")
        trend_text = f"Google Trends is {trend_direction}"
        if growth_rate not in (None, ""):
            trend_text += f" ({growth_rate}% change over 90 days)"
        _push({
            "id": f"E{len(board) + 1}",
            "text": trend_text,
            "tier": "CONTEXT",
            "source_type": "trend_metadata",
            "source_ref": "trends_data",
            "why_it_matters": "Independent timing context from non-LLM market data.",
        })

    if competition:
        comp_text = (
            f"Competition density is {competition.get('saturation_tier', 'unknown')}; "
            f"strongest competitor is {competition.get('top_competitor', 'unknown')}."
        )
        _push({
            "id": f"E{len(board) + 1}",
            "text": comp_text,
            "tier": "CONTEXT",
            "source_type": "competition_metadata",
            "source_ref": "competition_data",
            "why_it_matters": "Independent market structure context used to test defensibility.",
        })

    for unknown in top_unknowns or []:
        unknown_text = _truncate_words(str(unknown or "").strip(), 24)
        if not unknown_text:
            continue
        _push({
            "id": f"E{len(board) + 1}",
            "text": unknown_text,
            "tier": "UNKNOWN",
            "source_type": "model_unknown",
            "source_ref": "top_unknowns",
            "why_it_matters": "Open question the moderator wants the room to keep in view.",
        })

    for risk in risk_factors or []:
        risk_text = _truncate_words(str(risk or "").strip(), 24)
        if not risk_text:
            continue
        _push({
            "id": f"E{len(board) + 1}",
            "text": risk_text,
            "tier": "RISK",
            "source_type": "model_risk",
            "source_ref": "risk_factors",
            "why_it_matters": "Named downside that can invalidate an otherwise attractive thesis.",
        })

    return board


def render_evidence_board_for_prompt(evidence_board: list[dict]) -> str:
    if not evidence_board:
        return "No shared evidence board available."

    lines = []
    for item in evidence_board:
        lines.append(
            f"- [{item['id']}] ({item['tier']}/{item['source_type']}) {item['text']} "
            f"| Why it matters: {item['why_it_matters']}"
        )
    return "\n".join(lines)


def extract_cited_evidence_ids(argument_text: str, evidence_board: list[dict]) -> list[str]:
    if not argument_text or not evidence_board:
        return []

    board_ids = {str(item.get("id")) for item in evidence_board if item.get("id")}
    explicit = re.findall(r"\bE\d+\b", str(argument_text).upper())
    cited = [item_id for item_id in explicit if item_id in board_ids]
    if cited:
        return list(dict.fromkeys(cited))

    argument_tokens = _meaningful_tokens(argument_text)
    ranked = []
    for item in evidence_board:
        evidence_id = str(item.get("id", ""))
        text = f"{item.get('text', '')} {item.get('why_it_matters', '')}"
        overlap = len(argument_tokens & _meaningful_tokens(text))
        if overlap >= 2 and evidence_id:
            ranked.append((overlap, evidence_id))
    ranked.sort(reverse=True)
    return [evidence_id for _, evidence_id in ranked[:2]]


def build_key_disagreements(final_verdict: str, round1_entries, round2_entries, dissent) -> list[str]:
    disagreements = []
    round1_verdicts = sorted({entry.get("verdict") for entry in (round1_entries or []) if entry.get("verdict")})
    if len(round1_verdicts) > 1:
        disagreements.append(
            f"Opening positions split across {', '.join(v.replace('_', ' ') for v in round1_verdicts)}."
        )

    for entry in round2_entries or []:
        if not entry.get("held", True):
            disagreements.append(
                f"{entry.get('role', 'ANALYST')} changed to {str(entry.get('verdict', '')).replace('_', ' ')} after rebuttal."
            )

    for item in dissent or []:
        role = item.get("role", "ANALYST")
        verdict = str(item.get("verdict", "RISKY")).replace("_", " ")
        reason = build_stance_summary(item.get("reasoning", ""), item.get("verdict"))
        disagreements.append(f"{role} stayed {verdict}: {reason}")

    if not disagreements:
        disagreements.append(
            f"The room aligned on {str(final_verdict).replace('_', ' ')} without a lasting split."
        )

    return disagreements[:3]


def build_moderator_summary(final_verdict: str, confidence: int, round2_entries, key_disagreements: list[str]) -> str:
    changed_count = sum(1 for entry in (round2_entries or []) if not entry.get("held", True))
    parts = [
        f"Moderator synthesis favored {str(final_verdict).replace('_', ' ')} at {confidence}% confidence."
    ]
    if round2_entries:
        parts.append(f"One rebuttal round completed with {changed_count} model(s) changing verdict.")
    else:
        parts.append("The room reached a consensus before a rebuttal round was needed.")
    if key_disagreements:
        parts.append(f"Main remaining disagreement: {key_disagreements[0]}")
    return " ".join(parts).strip()


def build_debate_events(
    round1_entries,
    round2_entries,
    final_weights,
    final_verdict: str,
    final_confidence: int,
    moderator_summary: str,
) -> list[dict]:
    events = []
    round1_by_model = {
        entry.get("model_id"): entry
        for entry in (round1_entries or [])
        if entry.get("model_id")
    }
    round2_by_model = {
        entry.get("model_id"): entry
        for entry in (round2_entries or [])
        if entry.get("model_id")
    }

    for entry in round1_entries or []:
        events.append({
            "type": "claim",
            "round": 1,
            "from": entry.get("model_id"),
            "text": entry.get("stance_summary") or entry.get("argument_text") or "",
            "confidence": entry.get("confidence"),
            "refs": entry.get("cited_evidence_ids") or [],
        })

    for entry in round2_entries or []:
        event = {
            "type": "rebuttal",
            "round": 2,
            "from": entry.get("model_id"),
            "text": entry.get("stance_summary") or entry.get("argument_text") or "",
            "confidence": entry.get("confidence"),
            "refs": entry.get("cited_evidence_ids") or [],
        }
        engaged = entry.get("engaged_model_ids") or []
        if len(engaged) == 1:
            event["to"] = engaged[0]
        events.append(event)

    final_round = 3 if round2_entries else 2
    for weight in final_weights or []:
        model_id = weight.get("model_id")
        source_entry = round2_by_model.get(model_id) or round1_by_model.get(model_id) or {}
        events.append({
            "type": "final_position",
            "round": final_round,
            "from": model_id,
            "text": source_entry.get("stance_summary") or source_entry.get("argument_text") or "",
            "confidence": source_entry.get("confidence") or 0,
            "refs": source_entry.get("cited_evidence_ids") or [],
        })

    events.append({
        "type": "verdict",
        "round": final_round,
        "from": "moderator",
        "text": moderator_summary,
        "confidence": final_confidence,
        "refs": [],
    })
    return events


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


def estimate_tokens(text: str) -> int:
    """Cheap token estimate good enough for prompt-budget guardrails."""
    return gateway_estimate_tokens(text)


def _truncate_words(text: str, max_words: int) -> str:
    words = str(text or "").split()
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]).rstrip(" ,;:.") + "..."


def summarize_round1_for_debate(result: dict, role: str, max_words: int = 300, include_verdict: bool = False) -> str:
    """Compress a round-1 result into a deterministic, shorter debate block."""
    parts = []
    verdict = normalize_verdict_text(result.get("verdict", "RISKY"), "RISKY")
    confidence = clamp_confidence(result.get("confidence", 50), default=50)
    if include_verdict:
        parts.append(f"[{role}] Round 1 verdict: {verdict} at {confidence}% confidence.")

    argument = _truncate_words(extract_argument_text(result), max(60, max_words // 2))
    if argument:
        parts.append(f"Core reasoning: {argument}")

    evidence = [
        _truncate_words(item, 30)
        for item in (result.get("evidence") or [])[:4]
        if str(item).strip()
    ]
    if evidence:
        parts.append("Top evidence: " + "; ".join(evidence))

    risks = [
        _truncate_words(item, 24)
        for item in (result.get("risk_factors") or [])[:3]
        if str(item).strip()
    ]
    if risks:
        parts.append("Risks: " + "; ".join(risks))

    unknowns = [
        _truncate_words(item, 20)
        for item in (result.get("top_unknowns") or [])[:3]
        if str(item).strip()
    ]
    if unknowns:
        parts.append("Unknowns: " + "; ".join(unknowns))

    price_signals = _truncate_words(result.get("price_signals", ""), 40)
    if price_signals:
        parts.append("Pricing/WTP: " + price_signals)

    return _truncate_words(" ".join(parts).strip(), max_words)


def call_provider(config, prompt, system_prompt):
    """Call a specific provider using its config. Returns (provider_name, model, response_text)."""
    import time as _time
    provider = config["provider"]
    api_key = config["api_key"]
    model = resolve_model(config["selected_model"])  # Auto-correct model name
    endpoint_url = config.get("endpoint_url")
    policy = dict(config.get("_policy") or {})

    fn = PROVIDER_FUNCTIONS.get(provider)
    if not fn:
        raise Exception(f"Unknown provider: {provider}")

    _t0 = _time.time()
    print(f"  [Brain] >>> CALLING {provider}/{model} at {_time.strftime('%H:%M:%S')} ...", flush=True)
    text, telemetry = call_with_ai_policy(
        provider=provider,
        model=model,
        prompt=prompt,
        system_prompt=system_prompt,
        api_key=api_key,
        provider_fn=fn,
        endpoint_url=endpoint_url,
        task_type=str(policy.get("task_type") or "general"),
        stage=str(policy.get("stage") or "general"),
        expect_json=bool(policy.get("expect_json", False)),
        max_retries=int(policy.get("max_retries", 2) or 2),
        observer=policy.get("observer"),
    )
    _elapsed = _time.time() - _t0
    retry_suffix = f", retries={telemetry.retry_count}" if telemetry.retry_count else ""
    print(f"  [Brain] <<< {provider}/{model} responded in {_elapsed:.1f}s ({len(text)} chars{retry_suffix})", flush=True)
    if _elapsed > 30:
        logger.warning(f"[Brain] ⚠ {provider} took {_elapsed:.1f}s — consider replacing")
    return provider, model, text


def _is_413_error(err) -> bool:
    """Treat provider 413s as run-scoped temporary unavailability."""
    msg = str(err)
    return bool(re.search(r"\b413\b", msg))


def _is_timeout_error(err) -> bool:
    """Detect connect/read timeouts so slow agents can be skipped cleanly."""
    if isinstance(err, requests.exceptions.Timeout):
        return True
    msg = str(err).lower()
    return "timed out" in msg or "timeout" in msg or "read timed out" in msg


def _should_quarantine_config(err) -> bool:
    """Skip clearly unavailable agents for the rest of the current validation run."""
    error_kind, error_status, _retryable = classify_ai_error(err)
    if error_kind in {"auth", "billing_inactive", "quota_exceeded", "context_too_large"}:
        return True
    return error_status in {401, 402, 403, 413, 429}


def _short_model_label(model_name: str) -> str:
    parts = [part for part in str(model_name).split("/") if part]
    return parts[-1] if parts else str(model_name)


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
        active_configs = [dict(c) for c in configs if c.get("is_active", True)]
        normalized_configs = []
        seen_ids = set()
        for c in sorted(active_configs, key=lambda row: row.get("priority", 9999)):
            resolved_model = resolve_model(c.get("selected_model", ""))
            config_id = str(c.get("id") or "").strip()
            if config_id and config_id in seen_ids:
                continue
            c["selected_model"] = resolved_model
            normalized_configs.append(c)
            if config_id:
                seen_ids.add(config_id)
        self.configs = normalized_configs
        # Ensure every config has a unique id
        for i, c in enumerate(self.configs):
            if not c.get("id"):
                c["id"] = f"auto-{i}-{c.get('provider', 'unknown')}"
        if not self.configs:
            raise Exception("No active AI models configured. Go to Settings → AI to add your API keys.")
        self._call_counter = 0
        self._unavailable_config_ids = set()
        self._ai_telemetry = []
        print(f"  [Brain] Initialized with {len(self.configs)} agents:")
        for c in self.configs:
            print(f"    [{c['priority']}] {c['provider']}/{c['selected_model']} (id={c['id'][:8]})")

    def _candidate_configs(self, pinned_index=None):
        total = len(self.configs)
        if total == 0:
            return []
        start = 0 if pinned_index is None else pinned_index % total
        candidates = []
        for offset in range(total):
            idx = (start + offset) % total
            config = self.configs[idx]
            if config["id"] in self._unavailable_config_ids:
                continue
            candidates.append((idx, config))
        return candidates

    def _record_ai_telemetry(self, event: dict):
        if isinstance(event, dict):
            self._ai_telemetry.append(event)

    def get_usage_summary(self) -> dict:
        return summarize_ai_telemetry(self._ai_telemetry)

    def single_call(self, prompt, system_prompt, pinned_index=None, *, task_type="general", stage="single_call", expect_json=False, max_retries=2):
        """
        Route sequential passes across configured models without shrinking the prompt.
        Auth, quota, and context-limit failures mark a model unavailable for the rest of the validation run.
        """
        self._call_counter += 1
        last_error = None
        failure_messages = []

        candidates = self._candidate_configs(pinned_index=pinned_index)
        if not candidates:
            raise Exception("No available AI models remain for this validation run.")

        for idx, config in candidates:
            try:
                call_config = dict(config)
                call_config["_policy"] = {
                    "task_type": task_type,
                    "stage": stage,
                    "expect_json": expect_json,
                    "max_retries": max_retries,
                    "observer": self._record_ai_telemetry,
                }
                provider, model, text = call_provider(call_config, prompt, system_prompt)
                print(
                    f"  [Brain] Single call #{self._call_counter} → {provider}/{model} "
                    f"(pinned agent {idx+1}/{len(self.configs)}, {len(text)} chars)"
                )
                return text
            except Exception as e:
                last_error = e
                label = f"{config['provider']}/{config['selected_model']}"
                failure_messages.append(f"{label}: {str(e)[:220]}")
                print(
                    f"  [Brain] Single call failed on {label}: {e}",
                    flush=True,
                )
                logger.warning(f"[Brain] Single call failed on {label}: {e}")
                if _should_quarantine_config(e):
                    self._unavailable_config_ids.add(config["id"])
                    msg = (
                        f"[Brain] ⚠ {_short_model_label(config['selected_model'])} marked unavailable "
                        f"for this validation — routing to next model"
                    )
                    print(f"  {msg}")
                    logger.warning(msg)
                    continue
                continue

        if failure_messages:
            raise Exception(
                "All AI models failed for this call. "
                + " | ".join(failure_messages[:4])
            ) from last_error
        raise last_error or Exception("All AI models failed for this call.")

    def _run_moderator_synthesis(
        self,
        *,
        weighted_verdict: str,
        weighted_confidence: int,
        round1_entries: list[dict],
        round2_entries: list[dict],
        evidence_board: list[dict],
        round2_summary: str,
    ) -> dict:
        round1_lines = [
            f"- [{entry.get('role', 'ANALYST')}] {entry.get('verdict', 'RISKY')} at {entry.get('confidence', 50)}% — {entry.get('stance_summary', '')}"
            for entry in round1_entries[:5]
        ]
        round2_lines = [
            f"- [{entry.get('role', 'ANALYST')}] {'HELD' if entry.get('held', True) else 'CHANGED'} to {entry.get('verdict', 'RISKY')} ({entry.get('confidence', 50)}%) — {entry.get('argument_text', '')[:240]}"
            for entry in round2_entries[:5]
        ]
        prompt = f"""You are the hidden moderator for a startup validation debate.

WEIGHTED CONSENSUS:
- Verdict: {weighted_verdict}
- Confidence: {weighted_confidence}%
- Round 2 summary: {round2_summary or 'No rebuttal summary available.'}

ROUND 1 POSITIONS:
{chr(10).join(round1_lines) or '- None'}

ROUND 2 REBUTTALS:
{chr(10).join(round2_lines) or '- No round 2 rebuttals'}

EVIDENCE BOARD:
{render_evidence_board_for_prompt(evidence_board)}

EVIDENCE STRENGTH:
- Canonical DIRECT evidence count: {sum(1 for e in evidence_board if e.get('tier') == 'DIRECT')}
- RECON_BUYER_SIGNAL count: {sum(1 for e in evidence_board if e.get('tier') == 'RECON_BUYER_SIGNAL')}
- If canonical DIRECT count is 0, the ICP MUST stay broad (role-level only, no years-of-experience, no MRR ranges, no failed-campaign counts).
- If canonical DIRECT count is 0, budget_range MUST be "Unknown — no willingness-to-pay evidence found".

Return valid JSON with:
{{
  "executive_summary": "30-second founder-ready summary",
  "ideal_customer_profile": {{
    "title": "specific buyer title — but stay broad if evidence is thin",
    "company_shape": "company size / type — say 'unclear' if fewer than 3 DIRECT posts support it",
    "current_workaround": "how they handle it today — cite evidence IDs or say 'unverified'",
    "budget_range": "MUST be 'Unknown' if 0 WTP signals exist. Never invent dollar ranges.",
    "where_they_hang_out": ["community 1", "community 2"]
  }},
  "first_move": "single most important action this week",
  "confidence_reasoning": "why the room is confident or cautious, citing evidence IDs like [E1]",
  "timing_analysis": {{
    "label": "growing | stable | early | late | unclear",
    "summary": "timing read with evidence IDs"
  }},
  "interview_question": "One clean, grammatically correct question a founder could ask a potential buyer in a discovery call. Do NOT paste raw post snippets — rewrite the pain in your own words."
}}

RULES:
- Write as the moderator, not as 'the models'.
- Keep every claim narrow and grounded in the evidence board.
- The interview_question must be a single complete sentence with proper grammar.
- Never fabricate specificity (years of experience, MRR ranges, campaign counts) that the evidence does not support."""
        try:
            raw = self.single_call(
                prompt,
                "You synthesize startup-validation debates into one founder-ready answer.",
                task_type="moderator_synthesis",
                stage="moderator_synthesis",
                expect_json=True,
                max_retries=1,
            )
            return extract_json(raw)
        except Exception as exc:
            logger.warning(f"[Brain] Moderator synthesis failed: {exc}")
            return {}

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
            assigned_roles = "+".join(_assigned_roles(n))
            missing_roles = [AGENT_ROLES[i][0] for i in range(n, min(3, len(AGENT_ROLES)))]
            print(f"  [Brain] ⚠ Only {n} model(s) — {assigned_roles} assigned. "
                  f"Add {3 - n} more model(s) in Settings for {', '.join(missing_roles)} role(s).")
            if n == 2:
                msg = "[Brain] ⚠ Only 2 models — SKEPTIC+BULL assigned. Add 3rd for MARKET_ANALYST."
                print(f"  {msg}")
                logger.warning(msg)
        if on_progress:
            on_progress("debating", f"Round 1: {n} models analyzing independently")

        analyses = []
        debate_log = []
        round1_entries = []
        unavailable_roles = []

        def _analyze(config, agent_index):
            # FIX 2: Each agent gets a unique role + FIX 3: Calibration
            role_prompt = get_role_system_prompt(agent_index, system_prompt)
            role_name = AGENT_ROLES.get(agent_index % len(AGENT_ROLES), ("ANALYST",))[0]

            if config["id"] in self._unavailable_config_ids:
                return {
                    "config_id": config["id"],
                    "provider": config["provider"],
                    "model": config["selected_model"],
                    "result": None,
                    "raw": "",
                    "error": "Skipped after earlier 413",
                    "status": "unavailable_413",
                    "role": role_name,
                    "agent_index": agent_index,
                }

            # FIX 4: Inject base rate context into prompt
            contextualized_prompt = prompt
            if metadata:
                context_block = build_data_context(metadata.get("posts", []), metadata)
                contextualized_prompt = context_block + prompt

            try:
                call_config = dict(config)
                call_config["_policy"] = {
                    "task_type": "debate_round1",
                    "stage": f"round1_{role_name.lower()}",
                    "expect_json": True,
                    "max_retries": 2,
                    "observer": self._record_ai_telemetry,
                }
                provider, model, text = call_provider(call_config, contextualized_prompt, role_prompt)
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
                    "error": str(e),
                    "status": "timeout" if _is_timeout_error(e) else (
                        "unavailable_413" if _is_413_error(e) else "error"
                    ),
                    "role": role_name,
                    "agent_index": agent_index,
                }

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            futures = {
                executor.submit(_analyze, c, i): c
                for i, c in enumerate(self.configs)
            }
            for future in concurrent.futures.as_completed(futures):
                analysis = future.result()
                if analysis.get("status") == "unavailable_413":
                    self._unavailable_config_ids.add(analysis["config_id"])
                    unavailable_roles.append(analysis["role"])
                elif analysis.get("status") == "timeout":
                    self._unavailable_config_ids.add(analysis["config_id"])
                    unavailable_roles.append(analysis["role"])
                    timeout_label = "qwen" if "qwen" in str(analysis["model"]).lower() else _short_model_label(analysis["model"])
                    msg = f"[Brain] {timeout_label} Round 1 timeout — skipping this agent"
                    print(f"  {msg}")
                    logger.warning(msg)
                elif analysis["error"]:
                    print(f"  [Brain] ✗ {analysis['provider']}/{analysis['model']} [{analysis['role']}]: {analysis['error']}")
                else:
                    round1_verdict = normalize_verdict_text(analysis["result"].get("verdict", "RISKY"), "RISKY")
                    round1_confidence = clamp_confidence(analysis["result"].get("confidence", 50), default=50)
                    round1_argument = extract_argument_text(analysis["result"])
                    analysis["result"]["verdict"] = round1_verdict
                    analysis["result"]["confidence"] = round1_confidence
                    unknowns = len(analysis["result"].get("top_unknowns", []))
                    print(f"  [Brain] ✓ {analysis['provider']}/{analysis['model']} [{analysis['role']}]: "
                          f"verdict={round1_verdict} "
                          f"conf={round1_confidence} "
                          f"unknowns={unknowns}")
                    round1_entries.append({
                        "model_id": analysis["config_id"],
                        "role": analysis["role"],
                        "verdict": round1_verdict,
                        "confidence": round1_confidence,
                        "confidence_delta": 0,
                        "held": True,
                        "argument_text": round1_argument,
                        "stance_summary": build_stance_summary(round1_argument, round1_verdict),
                        "cited_evidence_ids": [],
                        "engaged_model_ids": [],
                        "response_mode": "claim",
                        "status": "ok",
                        "engagement_score": 0,
                        "engagement_label": "Initial position",
                    })
                    debate_log.append({
                        "model": f"{analysis['provider']}/{analysis['model']}",
                        "role": analysis["role"],
                        "round": 1,
                        "verdict": round1_verdict,
                        "confidence": round1_confidence,
                        "reasoning": (
                            round1_argument
                        )[:500],
                        "changed": False,
                    })
                analyses.append(analysis)

        valid = [a for a in analyses if a["result"] is not None]
        transcript_models = [
            {
                "id": analysis["config_id"],
                "provider": analysis["provider"],
                "model": analysis["model"],
                "label": f"{analysis['provider']}/{analysis['model']}",
                "role": analysis.get("role", "ANALYST"),
            }
            for analysis in valid
        ]
        if unavailable_roles and valid:
            remaining_roles = " + ".join(a["role"] for a in valid)
            for role in unavailable_roles:
                msg = f"[Brain] ⚠ {role} unavailable (413) — debate running with {remaining_roles} only"
                print(f"  {msg}")
                logger.warning(msg)

        if len(valid) == 0:
            raise Exception("All AI models failed. Check your API keys in Settings.")

        # FIX 3: Detect if SKEPTIC role is missing from valid analyses
        valid_roles = {a["role"] for a in valid}
        if "SKEPTIC" not in valid_roles and n > 0:
            print(f"  [Brain] ⚠ SKEPTIC role missing from valid results! "
                  f"Roles present: {valid_roles}. Debate may lack adversarial tension.")

        if len(valid) == 1:
            print(f"  [Brain] Only 1 model succeeded → returning its analysis directly")
            return self._weighted_merge(
                valid,
                debate_log=debate_log,
                transcript_models=transcript_models,
                round1_entries=round1_entries,
                round2_entries=[],
                round2_summary="",
                metadata=metadata,
            )

        # ── Check for disagreements ──
        verdicts = [a["result"].get("verdict", "UNKNOWN") for a in valid]
        unique_verdicts = set(verdicts)
        print(f"\n  [Brain] Verdicts: {verdicts} (roles: {[a['role'] for a in valid]})")

        if len(unique_verdicts) == 1:
            print(f"  [Brain] ══ CONSENSUS: All models agree on '{verdicts[0]}' ══")
            return self._weighted_merge(
                valid,
                debate_log=debate_log,
                transcript_models=transcript_models,
                round1_entries=round1_entries,
                round2_entries=[],
                round2_summary="",
                metadata=metadata,
            )

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

        preliminary_evidence = []
        preliminary_risks = []
        preliminary_unknowns = []
        seen_preliminary = {
            "evidence": set(),
            "risks": set(),
            "unknowns": set(),
        }
        for analysis in valid:
            for ev in analysis["result"].get("evidence", []):
                ev_text = _extract_board_text(ev).lower().strip()[:220]
                if ev_text and ev_text not in seen_preliminary["evidence"]:
                    seen_preliminary["evidence"].add(ev_text)
                    preliminary_evidence.append(ev)
            for risk in analysis["result"].get("risk_factors", []):
                risk_text = str(risk or "").lower().strip()[:220]
                if risk_text and risk_text not in seen_preliminary["risks"]:
                    seen_preliminary["risks"].add(risk_text)
                    preliminary_risks.append(risk)
            for unknown in analysis["result"].get("top_unknowns", []):
                unknown_text = str(unknown or "").lower().strip()[:220]
                if unknown_text and unknown_text not in seen_preliminary["unknowns"]:
                    seen_preliminary["unknowns"].add(unknown_text)
                    preliminary_unknowns.append(unknown)

        shared_evidence_board = build_evidence_board(
            preliminary_evidence,
            metadata=metadata,
            top_unknowns=preliminary_unknowns[:2],
            risk_factors=preliminary_risks[:1],
            max_items=8,
        )
        evidence_board_block = render_evidence_board_for_prompt(shared_evidence_board)

        debate_prompt_template = """Multiple AI models analyzed the SAME data independently and reached DIFFERENT conclusions.

YOUR ORIGINAL ANALYSIS (for your reference only):
{own_analysis}

OTHER MODELS' REASONING (scores and verdicts HIDDEN to prevent anchoring):
{other_reasoning}
{non_llm_data}
SHARED EVIDENCE BOARD (neutral moderator summary — cite IDs like [E1] when relevant):
{evidence_board}

HIDDEN MODERATOR INSTRUCTION:
- Explicitly state whether you HOLD or CHANGE your verdict.
- In your debate_note, mention any opposing role you engaged with, e.g. [SKEPTIC].
- Cite evidence board IDs like [E1] or [E2] when they support your case.
- Do not free-chat. Deliver one disciplined rebuttal only.

Given this disagreement and the non-LLM data above, re-evaluate your position:
1. HOLD your position if your evidence is stronger
2. CHANGE your verdict if a colleague raised a point you genuinely missed

Do NOT change your verdict just to agree. The non-LLM data above cannot lie — weight it heavily.

Respond with the same JSON format. Add a "debate_note" field explaining why you held or changed."""

        debate_results = []
        round2_entries = []

        def _run_round2(a):
            """Run Round 2 debate for a single model. Returns (debate_result, r2_entry, log_entry)."""
            others = [o for o in valid if o["config_id"] != a["config_id"]]
            if not others:
                return (
                    {"config_id": a["config_id"], "provider": a["provider"], "model": a["model"],
                     "result": a["result"], "role": a["role"], "agent_index": a["agent_index"]},
                    None, None,
                )

            # Sanitize — only show reasoning + evidence, NOT scores/verdicts
            others_text = "\n\n".join([
                f"=== Model [{o['role']}] ===\n{json.dumps(sanitize_for_debate(o['result']), indent=2)}"
                for o in others
            ])
            own_analysis_text = json.dumps(a["result"], indent=2)

            debate_prompt = debate_prompt_template.format(
                own_analysis=own_analysis_text,
                other_reasoning=others_text,
                non_llm_data=non_llm_block,
                evidence_board=evidence_board_block,
            )

            model_label = f"{a['provider']}/{a['model']}".lower()
            initial_r2_tokens = estimate_tokens(debate_prompt)
            if "qwen" in model_label and initial_r2_tokens > 6000:
                summarized_own = summarize_round1_for_debate(
                    a["result"], a["role"], max_words=300, include_verdict=True,
                )
                summarized_others = "\n\n".join([
                    f"=== Model [{o['role']}] ===\n{summarize_round1_for_debate(o['result'], o['role'], max_words=300)}"
                    for o in others
                ])
                debate_prompt = debate_prompt_template.format(
                    own_analysis=summarized_own,
                    other_reasoning=summarized_others,
                    non_llm_data=non_llm_block,
                    evidence_board=evidence_board_block,
                )
                trimmed_r2_tokens = estimate_tokens(debate_prompt)
                print(
                    f"  [Brain] R2 context trimmed for qwen: {initial_r2_tokens} -> {trimmed_r2_tokens} tokens",
                    flush=True,
                )

            previous_verdict = normalize_verdict_text(a["result"].get("verdict", "RISKY"), "RISKY")
            previous_confidence = clamp_confidence(a["result"].get("confidence", 50), default=50)

            try:
                config = next(c for c in self.configs if c["id"] == a["config_id"])
                role_prompt = get_round2_role_system_prompt(a["agent_index"], system_prompt)
                call_config = dict(config)
                call_config["_policy"] = {
                    "task_type": "debate_round2",
                    "stage": f"round2_{a['role'].lower()}",
                    "expect_json": True,
                    "max_retries": 2,
                    "observer": self._record_ai_telemetry,
                }
                _, _, text = call_provider(call_config, debate_prompt, role_prompt)
                result = extract_json(text)
                if "top_unknowns" not in result:
                    result["top_unknowns"] = []
                current_verdict = normalize_verdict_text(result.get("verdict", previous_verdict), previous_verdict)
                current_confidence = clamp_confidence(result.get("confidence", previous_confidence), default=previous_confidence)
                argument_text = extract_argument_text(result)
                engagement_score, engagement_label = calculate_engagement(argument_text, [other["role"] for other in others])
                engaged_model_ids = collect_engaged_model_ids(argument_text, others)
                cited_evidence_ids = extract_cited_evidence_ids(argument_text, shared_evidence_board)
                held = current_verdict == previous_verdict
                if held:
                    current_confidence = max(previous_confidence - 10, min(previous_confidence + 10, current_confidence))
                if engagement_score == 0 and current_confidence > previous_confidence:
                    current_confidence = previous_confidence
                current_confidence = clamp_confidence(current_confidence, default=previous_confidence)
                confidence_delta = current_confidence - previous_confidence
                result["verdict"] = current_verdict
                result["confidence"] = current_confidence
                action = "HELD" if held else "CHANGED"
                print(f"  [Brain] Debate → [{a['role']}] {a['provider']}/{a['model']}: {action} → verdict={result.get('verdict', '?')} | {result.get('debate_note', '')[:80]}")
                return (
                    {"config_id": a["config_id"], "provider": a["provider"], "model": a["model"],
                     "result": result, "role": a["role"], "agent_index": a["agent_index"]},
                    {"model_id": a["config_id"], "role": a["role"], "verdict": current_verdict,
                     "confidence": current_confidence, "confidence_delta": confidence_delta,
                     "held": held, "argument_text": argument_text,
                     "stance_summary": build_stance_summary(argument_text, current_verdict),
                     "cited_evidence_ids": cited_evidence_ids,
                     "engaged_model_ids": engaged_model_ids,
                     "response_mode": determine_response_mode(2, held, engagement_score),
                     "status": "ok",
                     "engagement_score": engagement_score, "engagement_label": engagement_label},
                    {"model": f"{a['provider']}/{a['model']}", "role": a["role"], "round": 2,
                     "verdict": current_verdict, "confidence": current_confidence,
                     "reasoning": argument_text[:500], "changed": not held},
                )
            except Exception as e:
                if _is_timeout_error(e):
                    self._unavailable_config_ids.add(a["config_id"])
                    timeout_label = "qwen" if "qwen" in str(a["model"]).lower() else _short_model_label(a["model"])
                    msg = f"[Brain] {timeout_label} Round 2 timeout — skipping this agent"
                    print(f"  {msg}")
                    logger.warning(msg)
                    return (None, None, None)  # skip — timeout
                if _is_413_error(e):
                    self._unavailable_config_ids.add(a["config_id"])
                print(f"  [Brain] Debate failed for {a['provider']}/{a['model']}: {e}")
                fallback_argument = extract_argument_text(a["result"])
                return (
                    {"config_id": a["config_id"], "provider": a["provider"], "model": a["model"],
                     "result": a["result"], "role": a["role"], "agent_index": a["agent_index"]},
                    {"model_id": a["config_id"], "role": a["role"], "verdict": previous_verdict,
                     "confidence": previous_confidence, "confidence_delta": 0,
                     "held": True, "argument_text": fallback_argument,
                     "stance_summary": build_stance_summary(fallback_argument, previous_verdict),
                     "cited_evidence_ids": extract_cited_evidence_ids(fallback_argument, shared_evidence_board),
                     "engaged_model_ids": [],
                     "response_mode": "hold",
                     "status": "fallback_to_round1",
                     "engagement_score": 0, "engagement_label": "Restated position - round 2 failed"},
                    {"model": f"{a['provider']}/{a['model']}", "role": a["role"], "round": 2,
                     "verdict": previous_verdict, "confidence": previous_confidence,
                     "reasoning": fallback_argument[:500], "changed": False,
                     "status": "round2_error", "fallback_to_round1": True,
                     "round2_error": f"{type(e).__name__}: {e}"},
                )

        # ── Run Round 2 in parallel (matches Round 1 pattern) ──
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            futures = {executor.submit(_run_round2, a): a for a in valid}
            for future in concurrent.futures.as_completed(futures):
                debate_result, r2_entry, log_entry = future.result()
                if debate_result is not None:
                    debate_results.append(debate_result)
                if r2_entry is not None:
                    round2_entries.append(r2_entry)
                if log_entry is not None:
                    debate_log.append(log_entry)

        if not debate_results:
            print("  [Brain] All Round 2 agents failed — falling back to Round 1 results")
            debate_results = valid


        # ══ FINAL SYNTHESIS with Weighted Consensus ══
        print(f"\n  [Brain] ══ FINAL SYNTHESIS (uncertainty-weighted) ══")
        round2_summary = generate_round2_summary(round1_entries, round2_entries)
        if on_progress:
            on_progress("synthesizing", "Synthesizing with uncertainty-weighted consensus")

        return self._weighted_merge(
            debate_results,
            debate_log=debate_log,
            transcript_models=transcript_models,
            round1_entries=round1_entries,
            round2_entries=round2_entries,
            round2_summary=round2_summary,
            metadata=metadata,
        )

    def _weighted_merge(self, analyses, debate_log=None, transcript_models=None, round1_entries=None, round2_entries=None, round2_summary="", metadata=None):
        """
        FIX 5 — Uncertainty-Weighted Consensus.
        Models that admitted more unknowns get LESS weight.
        This rewards intellectual honesty over false confidence.
        """
        verdicts = [normalize_verdict_text(a["result"].get("verdict", "UNKNOWN"), "UNKNOWN") for a in analyses]
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
            confidence = clamp_confidence(a["result"].get("confidence", 50), default=50)
            # More evidence cited = higher weight. Min weight 0.5 to avoid full exclusion.
            weight = max(0.5, 1.0 + (evidence_count * 0.1))
            weighted_entries.append({
                "model_id": a.get("config_id") or f"{a['provider']}/{a['model']}",
                "provider": a["provider"],
                "model": a["model"],
                "role": a.get("role", "ANALYST"),
                "verdict": normalize_verdict_text(a["result"].get("verdict", "UNKNOWN"), "UNKNOWN"),
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

        ranked_verdicts = sorted(verdict_weights.items(), key=lambda item: item[1], reverse=True)
        top_weight = ranked_verdicts[0][1]
        top_verdicts = [verdict for verdict, weight in ranked_verdicts if abs(weight - top_weight) < 1e-9]
        tie_detected = len(top_verdicts) > 1
        final_verdict = "RISKY" if tie_detected else ranked_verdicts[0][0]
        majority_count = sum(1 for e in weighted_entries if e["verdict"] == final_verdict)

        # ── Weighted confidence ──
        total_weight = sum(e["weight"] for e in weighted_entries)
        if total_weight > 0:
            weighted_confidence = sum(e["confidence"] * e["weight"] for e in weighted_entries) / total_weight
        else:
            weighted_confidence = sum(e["confidence"] for e in weighted_entries) / len(weighted_entries)

        # Cap confidence if high dissent
        dissent_count = sum(1 for e in weighted_entries if e["verdict"] != final_verdict)
        if tie_detected:
            weighted_confidence = min(weighted_confidence, 40)
            consensus_note = "tie"
        elif dissent_count >= total_models / 2:
            weighted_confidence = min(weighted_confidence, 45)
            consensus_note = "high-dissent"
        elif majority_count == total_models:
            consensus_note = "unanimous"
        elif majority_count > total_models / 2:
            consensus_note = "majority"
        else:
            weighted_confidence = min(weighted_confidence, 40)
            consensus_note = "no-majority"

        avg_confidence = clamp_confidence(weighted_confidence, default=50)

        # ── Build dissent section with roles ──
        dissent = []
        dissent_entry = None
        for e in weighted_entries:
            if e["verdict"] != final_verdict:
                dissent.append({
                    "model": f"{e['provider']}/{e['model']}",
                    "model_id": e["model_id"],
                    "role": e["role"],
                    "verdict": e["verdict"],
                    "confidence": e["confidence"],
                    "weight": round(e["weight"], 2),
                    "unknowns": e["unknowns"],
                    "reasoning": extract_argument_text(e["result"])[:300],
                })
                if dissent_entry is None or e["weight"] > dissent_entry["weight"]:
                    dissent_entry = e

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
                "verdict": normalize_verdict_text(a["result"].get("verdict", "?"), "?"),
                "role": a.get("role", "ANALYST"),
            }
            for a in analyses
        }

        final_weights = [
            {
                "model_id": entry["model_id"],
                "role": entry["role"],
                "weight": round(entry["weight"], 2),
                "verdict": entry["verdict"],
                "label": f"{entry['provider']}/{entry['model']}",
            }
            for entry in weighted_entries
        ]
        evidence_board = build_evidence_board(
            all_evidence,
            metadata=metadata,
            top_unknowns=all_unknowns[:2],
            risk_factors=all_risks[:1],
            max_items=10,
        )
        round1_entries_normalized = []
        for entry in round1_entries or []:
            argument_text = entry.get("argument_text", "")
            normalized_entry = {
                **entry,
                "stance_summary": entry.get("stance_summary") or build_stance_summary(argument_text, entry.get("verdict")),
                "cited_evidence_ids": entry.get("cited_evidence_ids") or extract_cited_evidence_ids(argument_text, evidence_board),
                "engaged_model_ids": entry.get("engaged_model_ids") or [],
                "response_mode": entry.get("response_mode") or "claim",
                "status": entry.get("status") or "ok",
            }
            round1_entries_normalized.append(normalized_entry)
        round2_entries_normalized = []
        for entry in round2_entries or []:
            argument_text = entry.get("argument_text", "")
            engagement_score = int(entry.get("engagement_score", 0) or 0)
            held = bool(entry.get("held", True))
            normalized_entry = {
                **entry,
                "stance_summary": entry.get("stance_summary") or build_stance_summary(argument_text, entry.get("verdict")),
                "cited_evidence_ids": entry.get("cited_evidence_ids") or extract_cited_evidence_ids(argument_text, evidence_board),
                "engaged_model_ids": entry.get("engaged_model_ids") or [],
                "response_mode": entry.get("response_mode") or determine_response_mode(2, held, engagement_score),
                "status": entry.get("status") or "ok",
            }
            round2_entries_normalized.append(normalized_entry)
        round2_by_model_id = {
            entry["model_id"]: entry
            for entry in round2_entries_normalized
            if entry.get("model_id")
        }
        dissent_reason = None
        if dissent_entry is not None:
            dissent_round2 = round2_by_model_id.get(dissent_entry["model_id"])
            dissent_argument = dissent_round2.get("argument_text", "") if dissent_round2 else extract_argument_text(dissent_entry["result"])
            dissent_reason = build_dissent_reason(dissent_argument, dissent_entry["verdict"])
        key_disagreements = build_key_disagreements(
            final_verdict,
            round1_entries_normalized,
            round2_entries_normalized,
            dissent,
        )
        moderator_summary = build_moderator_summary(
            final_verdict,
            avg_confidence,
            round2_entries_normalized,
            key_disagreements,
        )
        debate_events = build_debate_events(
            round1_entries_normalized,
            round2_entries_normalized,
            final_weights,
            final_verdict,
            avg_confidence,
            moderator_summary,
        )

        transcript_rounds = []
        if round1_entries_normalized:
            transcript_rounds.append({
                "round": 1,
                "phase": "opening",
                "moderator_instruction": "State your initial position independently before engaging other models.",
                "entries": round1_entries_normalized,
            })
        if round2_entries_normalized:
            transcript_rounds.append({
                "round": 2,
                "phase": "rebuttal",
                "moderator_instruction": "Hold or change your verdict, explicitly engage opposing reasoning, and cite evidence board IDs when possible.",
                "entries": round2_entries_normalized,
            })

        debate_transcript = {
            "version": 2,
            "room": {
                "mode": "structured_room",
                "moderated": True,
                "moderator_hidden": True,
            },
            "models": transcript_models or [
                {
                    "id": entry["model_id"],
                    "provider": entry["provider"],
                    "model": entry["model"],
                    "label": f"{entry['provider']}/{entry['model']}",
                    "role": entry["role"],
                }
                for entry in weighted_entries
            ],
            "evidence_board": evidence_board,
            "debate_events": debate_events,
            "rounds": transcript_rounds,
            "round2_summary": round2_summary if round2_entries_normalized else "",
            "final": {
                "verdict": final_verdict,
                "confidence": avg_confidence,
                "weights": final_weights,
                "moderator_summary": moderator_summary,
                "key_disagreements": key_disagreements,
                "dissent": {
                    "exists": dissent_entry is not None,
                    "dissenting_model_id": dissent_entry["model_id"] if dissent_entry is not None else None,
                    "dissenting_role": dissent_entry["role"] if dissent_entry is not None else None,
                    "dissenting_verdict": dissent_entry["verdict"] if dissent_entry is not None else None,
                    "dissent_reason": dissent_reason,
                },
            },
        }

        moderator_synthesis = self._run_moderator_synthesis(
            weighted_verdict=final_verdict,
            weighted_confidence=avg_confidence,
            round1_entries=round1_entries_normalized,
            round2_entries=round2_entries_normalized,
            evidence_board=evidence_board,
            round2_summary=round2_summary,
        )
        ai_usage = self.get_usage_summary()

        merged = {
            "verdict": final_verdict,
            "confidence": avg_confidence,
            "executive_summary": moderator_synthesis.get("executive_summary") or _pick_longest("executive_summary") or _pick_longest("summary"),
            "summary": moderator_synthesis.get("executive_summary") or _pick_longest("executive_summary") or _pick_longest("summary"),
            "evidence": all_evidence[:25],
            "evidence_count": len(all_evidence),
            "audience_validation": _pick_longest("audience_validation"),
            "competitor_gaps": _pick_longest("competitor_gaps"),
            "price_signals": _pick_longest("price_signals"),
            "market_size_estimate": _pick_longest("market_size_estimate"),
            "ideal_customer_profile": moderator_synthesis.get("ideal_customer_profile", {}),
            "first_move": moderator_synthesis.get("first_move", ""),
            "confidence_reasoning": moderator_synthesis.get("confidence_reasoning", ""),
            "timing_analysis": moderator_synthesis.get("timing_analysis", {}),
            "risk_factors": all_risks[:8],
            "suggestions": all_suggestions[:10],
            "action_plan": all_actions[:8],
            "top_posts": all_top_posts[:6],
            "top_unknowns": all_unknowns[:10],
            # Multi-model metadata
            "models_used": models_used,
            "model_verdicts": model_verdicts,
            "debate_mode": len(analyses) > 1,
            "debate_log": debate_log or [],
            "debate_rounds": max((entry.get("round", 1) for entry in (debate_log or [])), default=1),
            "debate_transcript": debate_transcript,
            "moderator_synthesis": moderator_synthesis,
            "ai_usage": ai_usage,
            # Weighted consensus metadata
            "consensus_strength": f"{len(top_verdicts)}-way tie/{total_models}" if tie_detected else f"{majority_count}/{total_models}",
            "consensus_type": consensus_note,
            "weighting_method": "evidence_weighted",
            "dissent": dissent,
        }

        print(f"  [Brain] Final: {final_verdict} ({avg_confidence}%) — "
              f"{majority_count}/{total_models} {consensus_note}, "
              f"{len(all_evidence)} evidence, {len(all_risks)} risks, "
              f"{len(all_unknowns)} unknowns surfaced")
        return merged


MultiBrain = AIBrain


# ═══════════════════════════════════════════════════════
# STANDALONE TEST
# ═══════════════════════════════════════════════════════
if __name__ == "__main__":
    print("Multi-Brain Debate Engine — requires user AI configs in Supabase")
    print("Use via validate_idea.py or run_scan.py")
