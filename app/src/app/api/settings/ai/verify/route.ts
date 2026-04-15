import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getDefaultModel, getVerificationModel, resolveRegisteredModel } from "@/lib/ai-model-registry";

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
    if (apiKey.startsWith("sk-")) return "openai";
    return null;
}

function buildSuccess(providerLabel: string, model: string, detectedProvider: string | null) {
    return {
        status: "valid" as const,
        message: `OK ${providerLabel} key works - ${model} responded`,
        detected_provider: detectedProvider,
        resolved_model: model,
    };
}

function buildInvalid(providerLabel: string, hint: string, detectedProvider: string | null) {
    return {
        status: "invalid" as const,
        message: `Invalid ${providerLabel} API key - ${hint}`,
        detected_provider: detectedProvider,
    };
}

function buildQuota(providerLabel: string, hint: string, detectedProvider: string | null) {
    return {
        status: "quota_exceeded" as const,
        message: `${providerLabel} key is valid but quota or credits are exhausted - ${hint}`,
        detected_provider: detectedProvider,
    };
}

export async function verifyKey(provider: string, apiKey: string, model: string): Promise<{
    status: "valid" | "invalid" | "quota_exceeded" | "model_not_found" | "error";
    message: string;
    detected_provider?: string | null;
    resolved_model?: string;
}> {
    const detectedProvider = detectProvider(apiKey);
    const resolvedModel = resolveRegisteredModel(model);
    const verificationModel = getVerificationModel(provider, resolvedModel);
    const timeout = 15000;

    try {
        switch (provider) {
            case "groq": {
                const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: verificationModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                        temperature: 0,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return buildSuccess("Groq", resolvedModel, detectedProvider);
                if (res.status === 401) return buildInvalid("Groq", "check your key", detectedProvider);
                if (res.status === 429) return buildQuota("Groq", "wait a moment or upgrade your limit", detectedProvider);
                if (res.status === 404) {
                    return {
                        status: "model_not_found",
                        message: `Model '${model}' resolved to '${resolvedModel}' but Groq rejected it.`,
                        detected_provider: detectedProvider,
                        resolved_model: resolvedModel,
                    };
                }
                return {
                    status: "error",
                    message: `Groq ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "gemini": {
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${verificationModel}:generateContent?key=${apiKey}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: "Say OK" }] }],
                            generationConfig: { maxOutputTokens: 5 },
                        }),
                        signal: AbortSignal.timeout(timeout),
                    },
                );
                if (res.status === 200) return buildSuccess("Gemini", resolvedModel, detectedProvider);
                if (res.status === 400) return buildInvalid("Gemini", "check your key", detectedProvider);
                if (res.status === 403) return buildInvalid("Gemini", "enable the Generative Language API", detectedProvider);
                if (res.status === 429) return buildQuota("Gemini", "free-tier quota is exhausted", detectedProvider);
                return {
                    status: "error",
                    message: `Gemini ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "openai": {
                const res = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: verificationModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return buildSuccess("OpenAI", resolvedModel, detectedProvider);
                if (res.status === 401) return buildInvalid("OpenAI", "check your key", detectedProvider);
                if (res.status === 429) return buildQuota("OpenAI", "quota or rate limit exceeded", detectedProvider);
                return {
                    status: "error",
                    message: `OpenAI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
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
                        model: verificationModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return buildSuccess("Anthropic", resolvedModel, detectedProvider);
                if (res.status === 401) return buildInvalid("Anthropic", "check your key", detectedProvider);
                if (res.status === 429) return buildQuota("Anthropic", "rate limit exceeded", detectedProvider);
                return {
                    status: "error",
                    message: `Anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "grok": {
                const res = await fetch("https://api.x.ai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: verificationModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return buildSuccess("Grok", resolvedModel, detectedProvider);
                if (res.status === 401) return buildInvalid("Grok", "check your xAI key", detectedProvider);
                return {
                    status: "error",
                    message: `Grok ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "deepseek": {
                const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: verificationModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return buildSuccess("DeepSeek", resolvedModel, detectedProvider);
                if (res.status === 401) return buildInvalid("DeepSeek", "check your key", detectedProvider);
                if (res.status === 402 || res.status === 429) return buildQuota("DeepSeek", "balance or quota exhausted", detectedProvider);
                return {
                    status: "error",
                    message: `DeepSeek ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "ollama":
                return { status: "valid", message: "OK Ollama local model - no key verification needed", detected_provider: "ollama", resolved_model: resolvedModel };
            case "openrouter": {
                const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                        "HTTP-Referer": "https://cueidea.me",
                        "X-Title": "CueIdea",
                    },
                    body: JSON.stringify({
                        model: verificationModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return buildSuccess("OpenRouter", resolvedModel, detectedProvider);
                if (res.status === 401) return buildInvalid("OpenRouter", "check your key", detectedProvider);
                if (res.status === 402 || res.status === 429) return buildQuota("OpenRouter", "credits or rate limit exhausted", detectedProvider);
                return {
                    status: "error",
                    message: `OpenRouter ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "together": {
                const res = await fetch("https://api.together.xyz/v1/chat/completions", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: verificationModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return buildSuccess("Together AI", resolvedModel, detectedProvider);
                if (res.status === 401) return buildInvalid("Together AI", "check your key", detectedProvider);
                if (res.status === 429) return buildQuota("Together AI", "rate limit exceeded", detectedProvider);
                return {
                    status: "error",
                    message: `Together AI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "nvidia": {
                const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: verificationModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                        stream: false,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return buildSuccess("NVIDIA NIM", resolvedModel, detectedProvider);
                if (res.status === 401) return buildInvalid("NVIDIA NIM", "check your key", detectedProvider);
                if (res.status === 402) return buildQuota("NVIDIA NIM", "credits exhausted", detectedProvider);
                return {
                    status: "error",
                    message: `NVIDIA NIM ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "fireworks": {
                const res = await fetch("https://api.fireworks.ai/inference/v1/chat/completions", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: verificationModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return buildSuccess("Fireworks AI", resolvedModel, detectedProvider);
                if (res.status === 401) return buildInvalid("Fireworks AI", "check your key", detectedProvider);
                return {
                    status: "error",
                    message: `Fireworks ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "mistral": {
                const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: verificationModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return buildSuccess("Mistral AI", resolvedModel, detectedProvider);
                if (res.status === 401) return buildInvalid("Mistral AI", "check your key", detectedProvider);
                if (res.status === 429) return buildQuota("Mistral AI", "rate limit exceeded", detectedProvider);
                return {
                    status: "error",
                    message: `Mistral ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "cerebras": {
                const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
                    method: "POST",
                    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: verificationModel,
                        messages: [{ role: "user", content: "Say OK" }],
                        max_tokens: 5,
                    }),
                    signal: AbortSignal.timeout(timeout),
                });
                if (res.status === 200) return buildSuccess("Cerebras", resolvedModel, detectedProvider);
                if (res.status === 401) return buildInvalid("Cerebras", "check your key", detectedProvider);
                return {
                    status: "error",
                    message: `Cerebras ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            default:
                return { status: "error", message: `Unknown provider: ${provider}`, detected_provider: detectedProvider };
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (msg.includes("timeout") || msg.includes("abort")) {
            return { status: "error", message: `${provider} API timed out - the key could still be valid`, detected_provider: detectedProvider };
        }
        return { status: "error", message: `${provider} verification failed: ${msg}`, detected_provider: detectedProvider };
    }
}

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

        const effectiveProvider = provider || detectProvider(api_key);
        if (!effectiveProvider) {
            return NextResponse.json({
                error: "Could not detect provider from key. Please select a provider manually.",
                detected_provider: null,
            }, { status: 400 });
        }

        const effectiveModel = selected_model || getDefaultModel(effectiveProvider) || "unknown";
        const result = await verifyKey(effectiveProvider, api_key, effectiveModel);

        return NextResponse.json({
            ...result,
            provider: effectiveProvider,
            model: resolveRegisteredModel(effectiveModel),
        });
    } catch (err) {
        console.error("AI verify error:", err);
        return NextResponse.json({ status: "error", message: "Verification failed - internal error" }, { status: 500 });
    }
}
