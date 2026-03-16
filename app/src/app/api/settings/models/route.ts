import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export type ModelInfo = {
    id: string;
    label: string;
    contextWindow: number;
    tier: "free" | "paid" | "free-tier";
    description?: string;
};

// ── Static curated lists for providers that don't expose clean /models endpoints ──
const STATIC_MODELS: Record<string, ModelInfo[]> = {
    openai: [
        { id: "gpt-4o", label: "GPT-4o", contextWindow: 128000, tier: "paid" },
        { id: "gpt-4o-mini", label: "GPT-4o Mini", contextWindow: 128000, tier: "paid" },
        { id: "o1-preview", label: "o1 Preview", contextWindow: 128000, tier: "paid" },
        { id: "o1-mini", label: "o1 Mini", contextWindow: 128000, tier: "paid" },
        { id: "gpt-4-turbo", label: "GPT-4 Turbo", contextWindow: 128000, tier: "paid" },
        { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", contextWindow: 16385, tier: "paid" },
    ],
    anthropic: [
        { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", contextWindow: 200000, tier: "paid" },
        { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", contextWindow: 200000, tier: "paid" },
        { id: "claude-3-opus-20240229", label: "Claude 3 Opus", contextWindow: 200000, tier: "paid" },
        { id: "claude-3-sonnet-20240229", label: "Claude 3 Sonnet", contextWindow: 200000, tier: "paid" },
        { id: "claude-3-haiku-20240307", label: "Claude 3 Haiku", contextWindow: 200000, tier: "paid" },
    ],
    gemini: [
        { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", contextWindow: 1048576, tier: "free-tier" },
        { id: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash Exp", contextWindow: 1048576, tier: "free" },
        { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", contextWindow: 2097152, tier: "paid" },
        { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", contextWindow: 1048576, tier: "free-tier" },
        { id: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash 8B", contextWindow: 1048576, tier: "free-tier" },
    ],
    grok: [
        { id: "grok-2-1212", label: "Grok 2 (Dec 2024)", contextWindow: 131072, tier: "paid" },
        { id: "grok-2-vision-1212", label: "Grok 2 Vision", contextWindow: 8192, tier: "paid" },
        { id: "grok-beta", label: "Grok Beta", contextWindow: 131072, tier: "paid" },
    ],
    deepseek: [
        { id: "deepseek-chat", label: "DeepSeek V3", contextWindow: 65536, tier: "paid" },
        { id: "deepseek-reasoner", label: "DeepSeek R1 (Reasoner)", contextWindow: 65536, tier: "paid" },
    ],
    nvidia: [
        { id: "meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B Instruct", contextWindow: 131072, tier: "free-tier" },
        { id: "meta/llama-3.1-405b-instruct", label: "Llama 3.1 405B Instruct", contextWindow: 131072, tier: "paid" },
        { id: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B", contextWindow: 131072, tier: "free-tier" },
        { id: "nvidia/llama-3.3-nemotron-super-49b-v1", label: "Nemotron Super 49B", contextWindow: 131072, tier: "free-tier" },
        { id: "mistralai/mixtral-8x22b-instruct-v0.1", label: "Mixtral 8x22B (NVIDIA)", contextWindow: 65536, tier: "paid" },
        { id: "google/gemma-2-27b-it", label: "Gemma 2 27B IT", contextWindow: 8192, tier: "free-tier" },
        { id: "qwen/qwen2.5-72b-instruct", label: "Qwen 2.5 72B (NVIDIA)", contextWindow: 32768, tier: "paid" },
    ],
    minimax: [
        { id: "minimax-01", label: "MiniMax 01", contextWindow: 1000000, tier: "paid" },
        { id: "abab6.5s-chat", label: "ABAB 6.5s", contextWindow: 245760, tier: "paid" },
    ],
    ollama: [
        { id: "custom", label: "Custom Local Model", contextWindow: 8192, tier: "free" },
    ],
};

// ── Groq: live fetch via /models ─────────────────────────────────
async function fetchGroqModels(apiKey: string): Promise<ModelInfo[]> {
    const r = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Groq models ${r.status}`);
    const data = await r.json() as { data: { id: string; context_window?: number }[] };
    return data.data
        .filter((m) => m.id && !m.id.includes("whisper") && !m.id.includes("tts"))
        .map((m) => ({
            id: m.id,
            label: m.id
                .replace("meta-llama/", "")
                .replace("-instruct", "")
                .replace(/-/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase()),
            contextWindow: m.context_window || 8192,
            tier: "free-tier" as const,
        }))
        .sort((a, b) => b.contextWindow - a.contextWindow);
}

// ── OpenRouter: live fetch + filter ─────────────────────────────
async function fetchOpenRouterModels(apiKey: string): Promise<ModelInfo[]> {
    const r = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`OpenRouter models ${r.status}`);
    const data = await r.json() as {
        data: {
            id: string;
            name: string;
            context_length?: number;
            pricing?: { prompt: string; completion: string };
        }[];
    };

    // Filter: only text/chat models, sort by context window descending, top 30
    const models = data.data
        .filter((m) =>
            m.id &&
            !m.id.includes(":extended") &&
            !m.id.includes("vision") &&
            (m.context_length || 0) >= 4096
        )
        .map((m) => {
            const promptCost = parseFloat(m.pricing?.prompt || "0");
            return {
                id: m.id,
                label: m.name || m.id,
                contextWindow: m.context_length || 4096,
                tier: promptCost === 0 ? ("free" as const) : ("paid" as const),
            };
        })
        .sort((a, b) => b.contextWindow - a.contextWindow)
        .slice(0, 30);

    return models;
}

// ── Together AI: live fetch + filter to chat models ──────────────
async function fetchTogetherModels(apiKey: string): Promise<ModelInfo[]> {
    const r = await fetch("https://api.together.xyz/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`Together models ${r.status}`);
    const data = await r.json() as {
        id: string;
        display_name?: string;
        display_type?: string;
        context_length?: number;
        pricing?: { input?: number };
    }[];

    return data
        .filter(
            (m) =>
                m.display_type === "chat" &&
                (m.context_length || 0) > 4096 &&
                m.id
        )
        .map((m) => ({
            id: m.id,
            label: m.display_name || m.id,
            contextWindow: m.context_length || 8192,
            tier: (m.pricing?.input || 0) === 0 ? ("free" as const) : ("paid" as const),
        }))
        .sort((a, b) => b.contextWindow - a.contextWindow)
        .slice(0, 25);
}

// ── Fireworks AI: live fetch ─────────────────────────────────────
async function fetchFireworksModels(apiKey: string): Promise<ModelInfo[]> {
    const r = await fetch("https://api.fireworks.ai/inference/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Fireworks models ${r.status}`);
    const data = await r.json() as { data: { id: string; supports_chat?: boolean }[] };
    return data.data
        .filter((m) => m.id && m.id.includes("instruct"))
        .map((m) => ({
            id: m.id,
            label: m.id.replace("accounts/fireworks/models/", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            contextWindow: 131072,
            tier: "paid" as const,
        }))
        .slice(0, 20);
}

// ── Mistral: live fetch ──────────────────────────────────────────
async function fetchMistralModels(apiKey: string): Promise<ModelInfo[]> {
    const r = await fetch("https://api.mistral.ai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Mistral models ${r.status}`);
    const data = await r.json() as { data: { id: string; name?: string; max_context_length?: number }[] };
    return data.data
        .filter((m) => m.id && !m.id.includes("embed"))
        .map((m) => ({
            id: m.id,
            label: m.name || m.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            contextWindow: m.max_context_length || 32768,
            tier: m.id.includes("mistral-nemo") ? ("free-tier" as const) : ("paid" as const),
        }))
        .sort((a, b) => b.contextWindow - a.contextWindow);
}

// ── Cerebras: live fetch ─────────────────────────────────────────
async function fetchCerebrasModels(apiKey: string): Promise<ModelInfo[]> {
    const r = await fetch("https://api.cerebras.ai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Cerebras models ${r.status}`);
    const data = await r.json() as { data: { id: string; context_window?: number }[] };
    return data.data.map((m) => ({
        id: m.id,
        label: m.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        contextWindow: m.context_window || 8192,
        tier: "free-tier" as const,  // Cerebras offers generous free tier
    }));
}

// ── Route handler ────────────────────────────────────────────────
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get("provider") || "";
    const apiKey = searchParams.get("api_key") || "";

    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!provider || !apiKey) {
        return NextResponse.json({ error: "provider and api_key required" }, { status: 400 });
    }

    // If we have a static list and no live fetch needed, return immediately
    if (STATIC_MODELS[provider]) {
        // For providers with static lists but live fetch capability, try live first
        const liveProviders = ["groq", "openrouter", "together", "fireworks", "mistral", "cerebras"];
        if (!liveProviders.includes(provider)) {
            return NextResponse.json({
                provider,
                models: STATIC_MODELS[provider],
                source: "static",
            });
        }
    }

    // Live fetch
    try {
        let models: ModelInfo[] = [];
        switch (provider) {
            case "groq":      models = await fetchGroqModels(apiKey); break;
            case "openrouter": models = await fetchOpenRouterModels(apiKey); break;
            case "together":  models = await fetchTogetherModels(apiKey); break;
            case "fireworks": models = await fetchFireworksModels(apiKey); break;
            case "mistral":   models = await fetchMistralModels(apiKey); break;
            case "cerebras":  models = await fetchCerebrasModels(apiKey); break;
            case "nvidia":    models = STATIC_MODELS.nvidia || []; break;  // NVIDIA /models needs auth header quirks
            default:          models = STATIC_MODELS[provider] || [];
        }

        return NextResponse.json({ provider, models, source: "live" });
    } catch (err) {
        // Fallback to static — show error banner but still return usable models
        const fallback = STATIC_MODELS[provider] || [];
        return NextResponse.json({
            provider,
            models: fallback,
            source: "fallback",
            error: `Could not fetch live models — showing cached list. (${err instanceof Error ? err.message : "Network error"})`,
        });
    }
}
