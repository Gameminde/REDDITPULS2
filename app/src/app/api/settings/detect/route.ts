import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/settings/detect
 * Body: { api_key: string }
 * Returns: { provider, confidence, hint }
 *
 * Detects the provider purely from API key format — no network calls.
 * Every major provider uses a unique key prefix or length pattern.
 */

type DetectResult = {
    provider: string;
    confidence: "high" | "medium" | "low" | "unknown";
    hint: string;
    name: string;
};

function detectProvider(key: string): DetectResult {
    const k = key.trim();

    // ── High-confidence prefix matches ──────────────────────────────
    if (k.startsWith("gsk_")) {
        return { provider: "groq", confidence: "high", hint: "Groq keys start with gsk_", name: "Groq" };
    }
    if (k.startsWith("sk-or-v1-")) {
        return { provider: "openrouter", confidence: "high", hint: "OpenRouter keys start with sk-or-v1-", name: "OpenRouter" };
    }
    if (k.startsWith("sk-ant-")) {
        return { provider: "anthropic", confidence: "high", hint: "Anthropic keys start with sk-ant-", name: "Anthropic" };
    }
    if (k.startsWith("nvapi-")) {
        return { provider: "nvidia", confidence: "high", hint: "NVIDIA NIM keys start with nvapi-", name: "NVIDIA NIM" };
    }
    if (k.startsWith("xai-")) {
        return { provider: "grok", confidence: "high", hint: "xAI Grok keys start with xai-", name: "xAI (Grok)" };
    }
    if (k.startsWith("AIza")) {
        return { provider: "gemini", confidence: "high", hint: "Google API keys start with AIza", name: "Google Gemini" };
    }
    if (k.startsWith("fa-")) {
        return { provider: "fireworks", confidence: "high", hint: "Fireworks AI keys start with fa-", name: "Fireworks AI" };
    }
    if (k.startsWith("csk-")) {
        return { provider: "cerebras", confidence: "high", hint: "Cerebras keys start with csk-", name: "Cerebras" };
    }

    // ── Medium-confidence: OpenAI-style sk- (length differentiates) ─
    if (k.startsWith("sk-") && k.length >= 40) {
        // Together AI uses a long hex-like key without dashes
        // OpenAI uses sk-proj-... or sk-... with 48+ chars
        if (k.startsWith("sk-proj-") || k.length >= 55) {
            return { provider: "openai", confidence: "high", hint: "OpenAI project keys start with sk-proj-", name: "OpenAI" };
        }
        return { provider: "openai", confidence: "medium", hint: "Looks like an OpenAI key (sk- prefix)", name: "OpenAI" };
    }

    // ── Together AI: long hex string, 64 chars, no dashes ──────────
    if (/^[a-f0-9]{64}$/.test(k) || k.startsWith("together_")) {
        return { provider: "together", confidence: "high", hint: "Together AI keys are 64-char hex strings", name: "Together AI" };
    }

    // ── Mistral: specific prefix ─────────────────────────────────────
    if (k.startsWith("mq-") || k.length === 32 && /^[a-zA-Z0-9]+$/.test(k)) {
        return { provider: "mistral", confidence: "medium", hint: "Possible Mistral AI key", name: "Mistral AI" };
    }

    // ── DeepSeek: sk- prefix but shorter ────────────────────────────
    if (k.startsWith("sk-") && k.length < 55) {
        return { provider: "deepseek", confidence: "medium", hint: "Short sk- keys often belong to DeepSeek", name: "DeepSeek" };
    }

    return {
        provider: "unknown",
        confidence: "unknown",
        hint: "Could not identify provider from key format — select manually",
        name: "Unknown",
    };
}

export async function POST(req: NextRequest) {
    try {
        const { api_key } = await req.json();
        if (!api_key || typeof api_key !== "string") {
            return NextResponse.json({ error: "api_key required" }, { status: 400 });
        }
        const result = detectProvider(api_key);
        return NextResponse.json(result);
    } catch {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
}
