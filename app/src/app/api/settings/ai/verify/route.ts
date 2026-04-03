import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// ── Model name aliases (mirrors Python resolve_model) ──
const MODEL_ALIASES: Record<string, string> = {
    "llama-4-scout": "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-4-maverick": "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.3-70b": "llama-3.3-70b-versatile",
    "llama-3.1-8b": "llama-3.1-8b-instant",
    "gemini-3.1-pro": "gemini-2.0-flash",
    "gemini-3.1-flash-lite": "gemini-2.0-flash",
    "gemini-pro": "gemini-2.0-flash",
    "gemini-flash": "gemini-2.0-flash",
    "gpt-5.2": "gpt-4o",
    "gpt-5": "gpt-4o",
    "gpt-5.4": "gpt-4o",
    "claude-opus-4.6": "claude-3-5-sonnet-20241022",
    "claude-sonnet-4.6": "claude-3-5-sonnet-20241022",
    "claude-haiku-4.5": "claude-3-5-haiku-20241022",
    "deepseek-v4": "deepseek-chat",
    "deepseek-v3.2-speciale": "deepseek-chat",
    // OpenRouter broken model fix
    "qwen/qwen3-coder-480b-a35b": "qwen/qwen2.5-72b-instruct",
    // Mistral aliases
    "mistral-large": "mistral-large-latest",
    "mistral-small": "mistral-small-latest",
    "mixtral-8x22b": "open-mixtral-8x22b",
    // Cerebras aliases
    "llama3.1-70b-cerebras": "llama3.1-70b",
    "llama3.3-70b-cerebras": "llama-3.3-70b",
};

function resolveModel(model: string): string {
    return MODEL_ALIASES[model] || model;
}

// ── Provider key prefix detection ──
function detectProvider(apiKey: string): string | null {
    if (apiKey.startsWith("gsk_")) return "groq";
    if (apiKey.startsWith("AIzaSy") || apiKey.startsWith("AIza")) return "gemini";
    if (apiKey.startsWith("sk-ant-")) return "anthropic";
    if (apiKey.startsWith("sk-or-v1-") || apiKey.startsWith("sk-or-")) return "openrouter";
    if (apiKey.startsWith("xai-")) return "grok";
    if (apiKey.startsWith("nvapi-")) return "nvidia";
    if (apiKey.startsWith("fa-")) return "fireworks";
    if (apiKey.startsWith("csk-")) return "cerebras";
    if (apiKey.startsWith("together_") || /^[a-f0-9]{64}$/.test(apiKey)) return "together";
    if (apiKey.startsWith("sk-proj-") || (apiKey.startsWith("sk-") && apiKey.length >= 55)) return "openai";
    if (apiKey.startsWith("sk-")) return "openai"; // fallback for short sk-
    return null;
}

// ── Lightweight verification per provider ──
export async function verifyKey(provider: string, apiKey: string, model: string): Promise<{
    status: "valid" | "invalid" | "quota_exceeded" | "model_not_found" | "error";
    message: string;
    detected_provider?: string | null;
    resolved_model?: string;
}> {
    const resolvedModel = resolveModel(model);
    const detectedProvider = detectProvider(apiKey);
    const timeout = 15000;

    try {
        switch (provider) {
            case "groq": {
                const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: resolvedModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                        temperature: 0,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return { status: "valid", message: `✅ Groq key works — ${resolvedModel} responding`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                if (res.status === 401) return { status: "invalid", message: "❌ Invalid API key — check your Groq key", detected_provider: detectedProvider };
                if (res.status === 429) return { status: "quota_exceeded", message: "⚠️ Groq rate limit hit — key is valid but quota exceeded. Wait a moment.", detected_provider: detectedProvider };
                if (res.status === 404) return { status: "model_not_found", message: `❌ Model '${model}' not found on Groq. Resolved to '${resolvedModel}' but still failed.`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                const errText = await res.text().catch(() => "");
                return { status: "error", message: `Groq ${res.status}: ${errText.slice(0, 200)}`, detected_provider: detectedProvider };
            }

            case "gemini": {
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: "Say OK" }] }],
                            generationConfig: { maxOutputTokens: 5 },
                        }),
                        signal: AbortSignal.timeout(timeout),
                    }
                );
                if (res.status === 200) return { status: "valid", message: `✅ Gemini key works — ${resolvedModel} responding`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                if (res.status === 400) return { status: "invalid", message: "❌ Invalid API key — check your Gemini key", detected_provider: detectedProvider };
                if (res.status === 403) return { status: "invalid", message: "❌ API key forbidden — enable the Generative Language API in Google Cloud Console", detected_provider: detectedProvider };
                if (res.status === 429) return { status: "quota_exceeded", message: "⚠️ Gemini quota exceeded — key is valid but you've hit the free tier limit. Wait or upgrade billing.", detected_provider: detectedProvider };
                const errText = await res.text().catch(() => "");
                return { status: "error", message: `Gemini ${res.status}: ${errText.slice(0, 200)}`, detected_provider: detectedProvider };
            }

            case "openai": {
                const res = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: resolvedModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return { status: "valid", message: `✅ OpenAI key works — ${resolvedModel} responding`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                if (res.status === 401) return { status: "invalid", message: "❌ Invalid API key — check your OpenAI key", detected_provider: detectedProvider };
                if (res.status === 429) return { status: "quota_exceeded", message: "⚠️ OpenAI rate limit — key valid but quota exceeded", detected_provider: detectedProvider };
                const errText = await res.text().catch(() => "");
                return { status: "error", message: `OpenAI ${res.status}: ${errText.slice(0, 200)}`, detected_provider: detectedProvider };
            }

            case "anthropic": {
                const res = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: {
                        "x-api-key": apiKey,
                        "Content-Type": "application/json",
                        "anthropic-version": "2023-06-01",
                    },
                    body: JSON.stringify({
                        model: resolvedModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return { status: "valid", message: `✅ Anthropic key works — ${resolvedModel} responding`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                if (res.status === 401) return { status: "invalid", message: "❌ Invalid API key — check your Anthropic key", detected_provider: detectedProvider };
                if (res.status === 429) return { status: "quota_exceeded", message: "⚠️ Anthropic rate limit — key valid but quota exceeded", detected_provider: detectedProvider };
                const errText = await res.text().catch(() => "");
                return { status: "error", message: `Anthropic ${res.status}: ${errText.slice(0, 200)}`, detected_provider: detectedProvider };
            }

            case "grok": {
                const res = await fetch("https://api.x.ai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: resolvedModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return { status: "valid", message: `✅ Grok key works — ${resolvedModel} responding`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                if (res.status === 401) return { status: "invalid", message: "❌ Invalid API key — check your xAI key", detected_provider: detectedProvider };
                const errText = await res.text().catch(() => "");
                return { status: "error", message: `Grok ${res.status}: ${errText.slice(0, 200)}`, detected_provider: detectedProvider };
            }

            case "deepseek": {
                const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: resolvedModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return { status: "valid", message: `✅ DeepSeek key works — ${resolvedModel} responding`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                if (res.status === 401) return { status: "invalid", message: "❌ Invalid API key — check your DeepSeek key", detected_provider: detectedProvider };
                if (res.status === 402) return { status: "quota_exceeded", message: "⚠️ DeepSeek key is valid but has insufficient balance. Add credits at platform.deepseek.com", detected_provider: detectedProvider };
                if (res.status === 429) return { status: "quota_exceeded", message: "⚠️ DeepSeek rate limit — key valid but quota exceeded", detected_provider: detectedProvider };
                const errText = await res.text().catch(() => "");
                return { status: "error", message: `DeepSeek ${res.status}: ${errText.slice(0, 200)}`, detected_provider: detectedProvider };
            }

            case "ollama": {
                return { status: "valid", message: "✅ Ollama (local) — no key verification needed", detected_provider: "ollama" };
            }

            case "openrouter": {
                const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://redditpulse.app",
                        "X-Title": "RedditPulse",
                    },
                    body: JSON.stringify({
                        model: resolvedModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return { status: "valid", message: `✅ OpenRouter key works — ${resolvedModel} responding`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                if (res.status === 401) return { status: "invalid", message: "❌ Invalid API key — check your OpenRouter key at openrouter.ai/keys", detected_provider: detectedProvider };
                if (res.status === 402) return { status: "quota_exceeded", message: "⚠️ OpenRouter key valid but insufficient credits. Add funds at openrouter.ai", detected_provider: detectedProvider };
                if (res.status === 429) return { status: "quota_exceeded", message: "⚠️ OpenRouter rate limit — key valid but quota exceeded", detected_provider: detectedProvider };
                const errText = await res.text().catch(() => "");
                return { status: "error", message: `OpenRouter ${res.status}: ${errText.slice(0, 200)}`, detected_provider: detectedProvider };
            }

            case "together": {
                const res = await fetch("https://api.together.xyz/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: resolvedModel || "meta-llama/Llama-3-70b-chat-hf",
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return { status: "valid", message: `✅ Together AI key works — ${resolvedModel} responding`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                if (res.status === 401) return { status: "invalid", message: "❌ Invalid API key — check your Together AI key at api.together.xyz", detected_provider: detectedProvider };
                if (res.status === 429) return { status: "quota_exceeded", message: "⚠️ Together AI rate limit — key valid but quota exceeded", detected_provider: detectedProvider };
                const errTxt1 = await res.text().catch(() => "");
                return { status: "error", message: `Together AI ${res.status}: ${errTxt1.slice(0, 200)}`, detected_provider: detectedProvider };
            }

            case "nvidia": {
                const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: resolvedModel || "meta/llama-3.1-70b-instruct",
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                        stream: false,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return { status: "valid", message: `✅ NVIDIA NIM key works — ${resolvedModel} responding`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                if (res.status === 401) return { status: "invalid", message: "❌ Invalid API key — get your NVIDIA NIM key at build.nvidia.com", detected_provider: detectedProvider };
                if (res.status === 402) return { status: "quota_exceeded", message: "⚠️ NVIDIA NIM credits exhausted. Add credits at build.nvidia.com", detected_provider: detectedProvider };
                const errTxt2 = await res.text().catch(() => "");
                return { status: "error", message: `NVIDIA NIM ${res.status}: ${errTxt2.slice(0, 200)}`, detected_provider: detectedProvider };
            }

            case "fireworks": {
                const res = await fetch("https://api.fireworks.ai/inference/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: resolvedModel || "accounts/fireworks/models/llama-v3p1-70b-instruct",
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return { status: "valid", message: `✅ Fireworks AI key works — ${resolvedModel} responding`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                if (res.status === 401) return { status: "invalid", message: "❌ Invalid API key — check your Fireworks AI key at fireworks.ai", detected_provider: detectedProvider };
                const errTxt3 = await res.text().catch(() => "");
                return { status: "error", message: `Fireworks ${res.status}: ${errTxt3.slice(0, 200)}`, detected_provider: detectedProvider };
            }

            case "mistral": {
                const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: resolvedModel || "mistral-small-latest",
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return { status: "valid", message: `✅ Mistral AI key works — ${resolvedModel} responding`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                if (res.status === 401) return { status: "invalid", message: "❌ Invalid API key — check your Mistral key at console.mistral.ai", detected_provider: detectedProvider };
                if (res.status === 429) return { status: "quota_exceeded", message: "⚠️ Mistral rate limit — key valid but quota exceeded", detected_provider: detectedProvider };
                const errTxt4 = await res.text().catch(() => "");
                return { status: "error", message: `Mistral ${res.status}: ${errTxt4.slice(0, 200)}`, detected_provider: detectedProvider };
            }

            case "cerebras": {
                const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: resolvedModel || "llama3.1-70b",
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return { status: "valid", message: `✅ Cerebras key works — ${resolvedModel} responding (ultra-fast!)`, detected_provider: detectedProvider, resolved_model: resolvedModel };
                if (res.status === 401) return { status: "invalid", message: "❌ Invalid API key — get your Cerebras key at cloud.cerebras.ai", detected_provider: detectedProvider };
                const errTxt5 = await res.text().catch(() => "");
                return { status: "error", message: `Cerebras ${res.status}: ${errTxt5.slice(0, 200)}`, detected_provider: detectedProvider };
            }

            default:
                return { status: "error", message: `Unknown provider: ${provider}`, detected_provider: detectedProvider };
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (msg.includes("timeout") || msg.includes("abort")) {
            return { status: "error", message: `⚠️ ${provider} API timed out — server may be slow, key could still be valid`, detected_provider: detectedProvider };
        }
        return { status: "error", message: `${provider} verification failed: ${msg}`, detected_provider: detectedProvider };
    }
}

// ── POST: Verify API key ──
export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        const { provider, api_key, selected_model } = body;

        if (!api_key) {
            return NextResponse.json({ error: "API key is required" }, { status: 400 });
        }

        // Auto-detect provider from key prefix if not provided
        const effectiveProvider = provider || detectProvider(api_key);
        if (!effectiveProvider) {
            return NextResponse.json({
                error: "Could not detect provider from key. Please select a provider manually.",
                detected_provider: null,
            }, { status: 400 });
        }

        // Default model per provider if not specified
        const defaultModels: Record<string, string> = {
            groq: "meta-llama/llama-4-scout-17b-16e-instruct",
            gemini: "gemini-2.0-flash",
            openai: "gpt-4o",
            anthropic: "claude-sonnet-4-20250514",
            grok: "grok-4.1",
            deepseek: "deepseek-chat",
            openrouter: "anthropic/claude-3.5-sonnet",
        };
        const effectiveModel = selected_model || defaultModels[effectiveProvider] || "unknown";

        const result = await verifyKey(effectiveProvider, api_key, effectiveModel);

        return NextResponse.json({
            ...result,
            provider: effectiveProvider,
            model: effectiveModel,
        });
    } catch (err) {
        console.error("AI verify error:", err);
        return NextResponse.json({ status: "error", message: "Verification failed — internal error" }, { status: 500 });
    }
}
