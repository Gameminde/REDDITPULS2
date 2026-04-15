import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { STATIC_MODELS } from "@/lib/ai-model-registry";

export type ModelInfo = {
    id: string;
    label: string;
    contextWindow: number;
    tier: "free" | "paid" | "free-tier";
    description?: string;
};

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

    return data.data
        .filter((m) =>
            m.id
            && !m.id.includes(":extended")
            && !m.id.includes("vision")
            && (m.context_length || 0) >= 4096,
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
}

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
        .filter((m) => m.display_type === "chat" && (m.context_length || 0) > 4096 && m.id)
        .map((m) => ({
            id: m.id,
            label: m.display_name || m.id,
            contextWindow: m.context_length || 8192,
            tier: (m.pricing?.input || 0) === 0 ? ("free" as const) : ("paid" as const),
        }))
        .sort((a, b) => b.contextWindow - a.contextWindow)
        .slice(0, 25);
}

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
        tier: "free-tier" as const,
    }));
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get("provider") || "";
    const apiKey = searchParams.get("api_key") || "";

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!provider || !apiKey) {
        return NextResponse.json({ error: "provider and api_key required" }, { status: 400 });
    }

    const liveProviders = ["groq", "openrouter", "together", "fireworks", "mistral", "cerebras"];

    if (STATIC_MODELS[provider] && !liveProviders.includes(provider)) {
        return NextResponse.json({
            provider,
            models: STATIC_MODELS[provider],
            source: "static",
        });
    }

    try {
        let models: ModelInfo[] = [];
        switch (provider) {
            case "groq":
                models = await fetchGroqModels(apiKey);
                break;
            case "openrouter":
                models = await fetchOpenRouterModels(apiKey);
                break;
            case "together":
                models = await fetchTogetherModels(apiKey);
                break;
            case "fireworks":
                models = await fetchFireworksModels(apiKey);
                break;
            case "mistral":
                models = await fetchMistralModels(apiKey);
                break;
            case "cerebras":
                models = await fetchCerebrasModels(apiKey);
                break;
            case "nvidia":
                models = STATIC_MODELS.nvidia || [];
                break;
            default:
                models = STATIC_MODELS[provider] || [];
        }

        return NextResponse.json({ provider, models, source: "live" });
    } catch (err) {
        const fallback = STATIC_MODELS[provider] || [];
        return NextResponse.json({
            provider,
            models: fallback,
            source: "fallback",
            error: `Could not fetch live models - showing cached list. (${err instanceof Error ? err.message : "Network error"})`,
        });
    }
}
