import {
    type AiVerificationResult,
    type AiVerificationStatus,
} from "@/lib/ai-config-health";
import { getVerificationModel, resolveRegisteredModel } from "@/lib/ai-model-registry";

function buildSuccess(providerLabel: string, model: string, detectedProvider: string | null): AiVerificationResult {
    return {
        status: "valid",
        message: `OK ${providerLabel} key works - ${model} responded`,
        detected_provider: detectedProvider,
        resolved_model: model,
    };
}

function buildInvalid(providerLabel: string, hint: string, detectedProvider: string | null): AiVerificationResult {
    return {
        status: "invalid",
        message: `Invalid ${providerLabel} API key - ${hint}`,
        detected_provider: detectedProvider,
    };
}

function buildQuota(providerLabel: string, hint: string, detectedProvider: string | null): AiVerificationResult {
    return {
        status: "quota_exceeded",
        message: `${providerLabel} key is valid but quota or credits are exhausted - ${hint}`,
        detected_provider: detectedProvider,
    };
}

function buildBillingInactive(providerLabel: string, hint: string, detectedProvider: string | null): AiVerificationResult {
    return {
        status: "billing_inactive",
        message: `${providerLabel} key is valid but billing is not active - ${hint}`,
        detected_provider: detectedProvider,
    };
}

function buildModelNotFound(providerLabel: string, requestedModel: string, resolvedModel: string, detectedProvider: string | null): AiVerificationResult {
    return {
        status: "model_not_found",
        message: `${providerLabel} rejected '${requestedModel}' after resolving it to '${resolvedModel}'.`,
        detected_provider: detectedProvider,
        resolved_model: resolvedModel,
    };
}

async function readErrorText(response: Response) {
    return (await response.text().catch(() => "")).slice(0, 400);
}

export function detectProvider(apiKey: string): string | null {
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

export function classifyOpenAi429(text: string): AiVerificationStatus {
    const lower = text.toLowerCase();
    if (lower.includes("billing_not_active") || (lower.includes("billing") && lower.includes("active"))) {
        return "billing_inactive";
    }
    return "quota_exceeded";
}

async function verifyOpenAiCompatible(input: {
    providerLabel: string;
    url: string;
    apiKey: string;
    provider: string;
    model: string;
    detectedProvider: string | null;
    extraHeaders?: Record<string, string>;
    extraBody?: Record<string, unknown>;
    quotaHint?: string;
    creditsHint?: string;
    invalidHint?: string;
    quotaStatuses?: number[];
    creditStatuses?: number[];
}): Promise<AiVerificationResult> {
    const response = await fetch(input.url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${input.apiKey}`,
            "Content-Type": "application/json",
            ...(input.extraHeaders || {}),
        },
        body: JSON.stringify({
            model: input.model,
            messages: [{ role: "user", content: "Say OK" }],
            max_tokens: 5,
            ...(input.extraBody || {}),
        }),
        signal: AbortSignal.timeout(15000),
    });

    if (response.status === 200) return buildSuccess(input.providerLabel, input.model, input.detectedProvider);
    if (response.status === 401) return buildInvalid(input.providerLabel, input.invalidHint || "check your key", input.detectedProvider);
    if (response.status === 404) return buildModelNotFound(input.providerLabel, input.model, input.model, input.detectedProvider);

    const quotaStatuses = new Set(input.quotaStatuses || [429]);
    const creditStatuses = new Set(input.creditStatuses || []);

    if (creditStatuses.has(response.status)) {
        return buildQuota(input.providerLabel, input.creditsHint || "credits exhausted", input.detectedProvider);
    }
    if (quotaStatuses.has(response.status)) {
        return buildQuota(input.providerLabel, input.quotaHint || "rate limit exceeded", input.detectedProvider);
    }

    return {
        status: "error" as const,
        message: `${input.providerLabel} ${response.status}: ${(await readErrorText(response)).slice(0, 200)}`,
        detected_provider: input.detectedProvider,
    };
}

export async function verifyKey(provider: string, apiKey: string, model: string): Promise<AiVerificationResult> {
    const detectedProvider = detectProvider(apiKey);
    const resolvedModel = resolveRegisteredModel(model);
    const verificationModel = getVerificationModel(provider, resolvedModel);

    try {
        switch (provider) {
            case "groq":
                return await verifyOpenAiCompatible({
                    providerLabel: "Groq",
                    url: "https://api.groq.com/openai/v1/chat/completions",
                    apiKey,
                    provider,
                    model: verificationModel,
                    detectedProvider,
                    extraBody: { temperature: 0 },
                    quotaHint: "wait a moment or upgrade your limit",
                });
            case "gemini": {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${verificationModel}:generateContent?key=${apiKey}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: "Say OK" }] }],
                            generationConfig: { maxOutputTokens: 5 },
                        }),
                        signal: AbortSignal.timeout(15000),
                    },
                );

                if (response.status === 200) return buildSuccess("Gemini", resolvedModel, detectedProvider);
                if (response.status === 400) return buildInvalid("Gemini", "check your key", detectedProvider);
                if (response.status === 403) return buildInvalid("Gemini", "enable the Generative Language API", detectedProvider);
                if (response.status === 404) return buildModelNotFound("Gemini", model, resolvedModel, detectedProvider);
                if (response.status === 429) return buildQuota("Gemini", "free-tier quota is exhausted", detectedProvider);

                return {
                    status: "error",
                    message: `Gemini ${response.status}: ${(await readErrorText(response)).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "openai": {
                const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
                    signal: AbortSignal.timeout(15000),
                });

                if (response.status === 200) return buildSuccess("OpenAI", resolvedModel, detectedProvider);
                if (response.status === 401) return buildInvalid("OpenAI", "check your key", detectedProvider);
                if (response.status === 404) return buildModelNotFound("OpenAI", model, resolvedModel, detectedProvider);
                if (response.status === 429) {
                    const errorText = await readErrorText(response);
                    const status = classifyOpenAi429(errorText);
                    return status === "billing_inactive"
                        ? buildBillingInactive("OpenAI", "enable billing or add credits", detectedProvider)
                        : buildQuota("OpenAI", "quota exhausted or rate limit exceeded", detectedProvider);
                }

                return {
                    status: "error",
                    message: `OpenAI ${response.status}: ${(await readErrorText(response)).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "anthropic": {
                const response = await fetch("https://api.anthropic.com/v1/messages", {
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
                    signal: AbortSignal.timeout(15000),
                });

                if (response.status === 200) return buildSuccess("Anthropic", resolvedModel, detectedProvider);
                if (response.status === 401) return buildInvalid("Anthropic", "check your key", detectedProvider);
                if (response.status === 404) return buildModelNotFound("Anthropic", model, resolvedModel, detectedProvider);
                if (response.status === 429) return buildQuota("Anthropic", "rate limit exceeded", detectedProvider);

                return {
                    status: "error",
                    message: `Anthropic ${response.status}: ${(await readErrorText(response)).slice(0, 200)}`,
                    detected_provider: detectedProvider,
                };
            }
            case "grok":
                return await verifyOpenAiCompatible({
                    providerLabel: "Grok",
                    url: "https://api.x.ai/v1/chat/completions",
                    apiKey,
                    provider,
                    model: verificationModel,
                    detectedProvider,
                    invalidHint: "check your xAI key",
                });
            case "deepseek":
                return await verifyOpenAiCompatible({
                    providerLabel: "DeepSeek",
                    url: "https://api.deepseek.com/v1/chat/completions",
                    apiKey,
                    provider,
                    model: verificationModel,
                    detectedProvider,
                    quotaHint: "balance or quota exhausted",
                    creditStatuses: [402],
                });
            case "ollama":
                return {
                    status: "valid",
                    message: "OK Ollama local model - no key verification needed",
                    detected_provider: "ollama",
                    resolved_model: resolvedModel,
                };
            case "openrouter":
                return await verifyOpenAiCompatible({
                    providerLabel: "OpenRouter",
                    url: "https://openrouter.ai/api/v1/chat/completions",
                    apiKey,
                    provider,
                    model: verificationModel,
                    detectedProvider,
                    extraHeaders: {
                        "HTTP-Referer": "https://cueidea.me",
                        "X-Title": "CueIdea",
                    },
                    quotaHint: "credits or rate limit exhausted",
                    creditStatuses: [402],
                });
            case "together":
                return await verifyOpenAiCompatible({
                    providerLabel: "Together AI",
                    url: "https://api.together.xyz/v1/chat/completions",
                    apiKey,
                    provider,
                    model: verificationModel,
                    detectedProvider,
                });
            case "nvidia":
                return await verifyOpenAiCompatible({
                    providerLabel: "NVIDIA NIM",
                    url: "https://integrate.api.nvidia.com/v1/chat/completions",
                    apiKey,
                    provider,
                    model: verificationModel,
                    detectedProvider,
                    extraBody: { stream: false },
                    creditStatuses: [402],
                });
            case "fireworks":
                return await verifyOpenAiCompatible({
                    providerLabel: "Fireworks AI",
                    url: "https://api.fireworks.ai/inference/v1/chat/completions",
                    apiKey,
                    provider,
                    model: verificationModel,
                    detectedProvider,
                });
            case "mistral":
                return await verifyOpenAiCompatible({
                    providerLabel: "Mistral AI",
                    url: "https://api.mistral.ai/v1/chat/completions",
                    apiKey,
                    provider,
                    model: verificationModel,
                    detectedProvider,
                });
            case "cerebras":
                return await verifyOpenAiCompatible({
                    providerLabel: "Cerebras",
                    url: "https://api.cerebras.ai/v1/chat/completions",
                    apiKey,
                    provider,
                    model: verificationModel,
                    detectedProvider,
                });
            default:
                return { status: "error", message: `Unknown provider: ${provider}`, detected_provider: detectedProvider };
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (message.includes("timeout") || message.includes("abort")) {
            return { status: "error", message: `${provider} API timed out - the key could still be valid`, detected_provider: detectedProvider };
        }
        return { status: "error", message: `${provider} verification failed: ${message}`, detected_provider: detectedProvider };
    }
}
