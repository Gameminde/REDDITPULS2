import { createClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";
import { checkPremium } from "@/lib/check-premium";

// Provider → model catalog (curated fallback list — live fetch happens via /api/settings/models)
export const MODEL_CATALOG: Record<string, { name: string; models: { id: string; label: string }[]; endpoint: string }> = {
    gemini: {
        name: "Google Gemini",
        models: [
            { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
            { id: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash Exp (Free)" },
            { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
            { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
        ],
        endpoint: "generativelanguage.googleapis.com",
    },
    anthropic: {
        name: "Anthropic",
        models: [
            { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
            { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
            { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
        ],
        endpoint: "api.anthropic.com",
    },
    openai: {
        name: "OpenAI",
        models: [
            { id: "gpt-4o", label: "GPT-4o" },
            { id: "gpt-4o-mini", label: "GPT-4o Mini" },
            { id: "o1-preview", label: "o1 Preview" },
            { id: "o1-mini", label: "o1 Mini" },
        ],
        endpoint: "api.openai.com",
    },
    grok: {
        name: "xAI (Grok)",
        models: [
            { id: "grok-2-1212", label: "Grok 2" },
            { id: "grok-beta", label: "Grok Beta" },
        ],
        endpoint: "api.x.ai",
    },
    deepseek: {
        name: "DeepSeek",
        models: [
            { id: "deepseek-chat", label: "DeepSeek V3" },
            { id: "deepseek-reasoner", label: "DeepSeek R1 (Reasoner)" },
        ],
        endpoint: "api.deepseek.com",
    },
    groq: {
        name: "Groq",
        models: [
            { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout (16K ctx)" },
            { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (128K ctx)" },
            { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
            { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
            { id: "gemma2-9b-it", label: "Gemma 2 9B" },
        ],
        endpoint: "api.groq.com",
    },
    openrouter: {
        name: "OpenRouter (200+ models)",
        models: [
            { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
            { id: "openai/gpt-4o", label: "GPT-4o" },
            { id: "deepseek/deepseek-r1", label: "DeepSeek R1" },
            { id: "deepseek/deepseek-chat", label: "DeepSeek V3" },
            { id: "qwen/qwen2.5-72b-instruct", label: "Qwen 2.5 72B" },
            { id: "meta-llama/llama-3.1-405b-instruct", label: "Llama 3.1 405B" },
            { id: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B" },
            { id: "mistralai/mixtral-8x22b-instruct", label: "Mixtral 8x22B" },
            { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
            { id: "microsoft/wizardlm-2-8x22b", label: "WizardLM 2 8x22B" },
        ],
        endpoint: "openrouter.ai",
    },
    together: {
        name: "Together AI",
        models: [
            { id: "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo", label: "Llama 3.1 405B Turbo" },
            { id: "meta-llama/Llama-3-70b-chat-hf", label: "Llama 3 70B" },
            { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", label: "Qwen 2.5 72B Turbo" },
            { id: "mistralai/Mixtral-8x22B-Instruct-v0.1", label: "Mixtral 8x22B" },
            { id: "NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO", label: "Nous Hermes 2 Mixtral" },
        ],
        endpoint: "api.together.xyz",
    },
    nvidia: {
        name: "NVIDIA NIM",
        models: [
            { id: "meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B (Free tier)" },
            { id: "meta/llama-3.1-405b-instruct", label: "Llama 3.1 405B" },
            { id: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B (Free tier)" },
            { id: "nvidia/llama-3.3-nemotron-super-49b-v1", label: "Nemotron Super 49B" },
            { id: "mistralai/mixtral-8x22b-instruct-v0.1", label: "Mixtral 8x22B" },
            { id: "qwen/qwen2.5-72b-instruct", label: "Qwen 2.5 72B" },
        ],
        endpoint: "integrate.api.nvidia.com",
    },
    fireworks: {
        name: "Fireworks AI",
        models: [
            { id: "accounts/fireworks/models/llama-v3p1-70b-instruct", label: "Llama 3.1 70B" },
            { id: "accounts/fireworks/models/llama-v3p1-405b-instruct", label: "Llama 3.1 405B" },
            { id: "accounts/fireworks/models/deepseek-r1", label: "DeepSeek R1" },
            { id: "accounts/fireworks/models/mixtral-8x22b-instruct", label: "Mixtral 8x22B" },
            { id: "accounts/fireworks/models/qwen2p5-72b-instruct", label: "Qwen 2.5 72B" },
        ],
        endpoint: "api.fireworks.ai",
    },
    mistral: {
        name: "Mistral AI",
        models: [
            { id: "mistral-large-latest", label: "Mistral Large" },
            { id: "mistral-medium-latest", label: "Mistral Medium" },
            { id: "mistral-small-latest", label: "Mistral Small" },
            { id: "open-mixtral-8x22b", label: "Mixtral 8x22B (Open)" },
            { id: "open-mistral-nemo", label: "Mistral Nemo (Free tier)" },
        ],
        endpoint: "api.mistral.ai",
    },
    cerebras: {
        name: "Cerebras (Ultra-fast)",
        models: [
            { id: "llama3.1-70b", label: "Llama 3.1 70B (Fast)" },
            { id: "llama-3.3-70b", label: "Llama 3.3 70B (Fast)" },
            { id: "llama3.1-8b", label: "Llama 3.1 8B (Fastest)" },
        ],
        endpoint: "api.cerebras.ai",
    },
    minimax: {
        name: "Minimax",
        models: [
            { id: "minimax-01", label: "MiniMax-01 (1M ctx)" },
            { id: "abab6.5s-chat", label: "ABAB 6.5s" },
        ],
        endpoint: "api.minimax.chat",
    },
    ollama: {
        name: "Ollama (Local)",
        models: [
            { id: "custom", label: "Custom Local Model" },
        ],
        endpoint: "localhost:11434",
    },
};


const ENCRYPTION_KEY = process.env.AI_ENCRYPTION_KEY || "redditpulse-default-key-change-me";

// GET — return user's AI configs (keys masked) + model catalog
export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // Server-side premium check
        const { isPremium } = await checkPremium(supabase, user.id);
        if (!isPremium) {
            return NextResponse.json({ error: "Premium subscription required" }, { status: 403 });
        }

        // Read configs — decrypt keys server-side, mask for frontend
        const { data: configs } = await supabase.rpc("get_ai_configs_decrypted", {
            p_user_id: user.id,
            p_key: ENCRYPTION_KEY,
        });

        // If RPC doesn't exist yet, fall back to raw query with plaintext column
        let finalConfigs = configs;
        if (!configs) {
            const { data: rawConfigs } = await supabase
                .from("user_ai_config")
                .select("*")
                .eq("user_id", user.id)
                .order("priority", { ascending: true });
            finalConfigs = (rawConfigs || []).map((c: Record<string, unknown>) => ({
                ...c,
                api_key: c.api_key || "",
            }));
        }

        // Mask API keys for frontend — show ONLY last 4 chars (ATK-3 fix)
        const masked = (finalConfigs || []).map((c: Record<string, string | boolean | number>) => ({
            ...c,
            api_key: c.api_key ? `•••••••••${String(c.api_key).slice(-4)}` : "",
        }));

        return NextResponse.json({ configs: masked, catalog: MODEL_CATALOG });
    } catch {
        return NextResponse.json({ configs: [], catalog: MODEL_CATALOG });
    }
}

// ── Rate Limiting ──
const configTimestamps = new Map<string, number[]>();
function checkConfigRateLimit(userId: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3600_000;
    const ts = (configTimestamps.get(userId) || []).filter(t => t > hourAgo);
    if (ts.length >= 10) return false;
    ts.push(now);
    configTimestamps.set(userId, ts);
    return true;
}

// POST — save or update a provider config (with verification)
export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // Server-side premium check
        const { isPremium } = await checkPremium(supabase, user.id);
        if (!isPremium) {
            return NextResponse.json({ error: "Premium subscription required" }, { status: 403 });
        }

        if (!checkConfigRateLimit(user.id)) {
            return NextResponse.json({ error: "Rate limit exceeded — max 10 config changes per hour" }, { status: 429 });
        }

        const body = await req.json();
        const { provider, api_key, selected_model, priority, endpoint_url, is_active, config_id } = body;

        if (!provider || !api_key || !selected_model) {
            return NextResponse.json({ error: "Provider, API key, and model are required" }, { status: 400 });
        }
        if (!MODEL_CATALOG[provider]) {
            return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
        }

        // ── Step 1: Verify the API key BEFORE saving ──
        let verification = { status: "skipped", message: "Verification skipped" } as {
            status: string; message: string; resolved_model?: string;
        };
        try {
            // Dynamic import to call verify function directly (no internal fetch needed)
            const { verifyKey } = await import("./verify/route");
            verification = await verifyKey(provider, api_key, selected_model);
        } catch (verifyErr) {
            console.error("Key verification failed:", verifyErr);
            verification = { status: "error", message: "Could not verify key -- saving anyway" };
        }

        // ── Step 2: Save to DB regardless (key might be temporarily rate-limited) ──
        const safePriority = Math.max(1, Math.min(6, priority || 1));

        // Check if this is an update (config_id provided) or new insert
        let existing: { id: string } | null = null;
        if (config_id) {
            const { data } = await supabase
                .from("user_ai_config")
                .select("id")
                .eq("id", config_id)
                .eq("user_id", user.id)
                .single();
            existing = data;
        }

        // Try encrypted insert; fall back to plaintext if encrypted column doesn't exist
        if (existing) {
            // Try encrypted update first
            const { error: encError } = await supabase.rpc("upsert_ai_config_encrypted", {
                p_user_id: user.id,
                p_provider: provider,
                p_api_key: api_key,
                p_model: selected_model,
                p_priority: safePriority,
                p_endpoint_url: endpoint_url || null,
                p_key: ENCRYPTION_KEY,
            });

            if (encError) {
                // Fallback: plaintext update
                const { error } = await supabase
                    .from("user_ai_config")
                    .update({
                        api_key,
                        selected_model,
                        priority: safePriority,
                        is_active: true,
                        endpoint_url: endpoint_url || null,
                    })
                    .eq("id", existing.id);
                if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            }
        } else {
            // Check max 3 active
            const { count } = await supabase
                .from("user_ai_config")
                .select("id", { count: "exact" })
                .eq("user_id", user.id)
                .eq("is_active", true);

            if ((count || 0) >= 6) {
                return NextResponse.json({ error: "Maximum 6 active AI agents allowed" }, { status: 400 });
            }

            // Try encrypted insert
            const { error: encError } = await supabase.rpc("upsert_ai_config_encrypted", {
                p_user_id: user.id,
                p_provider: provider,
                p_api_key: api_key,
                p_model: selected_model,
                p_priority: safePriority,
                p_endpoint_url: endpoint_url || null,
                p_key: ENCRYPTION_KEY,
            });

            if (encError) {
                // Fallback: plaintext insert
                const { error } = await supabase
                    .from("user_ai_config")
                    .insert({
                        user_id: user.id,
                        provider,
                        api_key,
                        selected_model,
                        priority: safePriority,
                        is_active: true,
                        endpoint_url: endpoint_url || null,
                    });
                if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            }
        }

        return NextResponse.json({
            ok: true,
            verification: {
                status: verification.status,
                message: verification.message,
                resolved_model: verification.resolved_model || selected_model,
            },
        });
    } catch (err) {
        console.error("AI config POST error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// DELETE — remove a specific config by id (supports multiple configs per provider)
export async function DELETE(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // Server-side premium check
        const { isPremium } = await checkPremium(supabase, user.id);
        if (!isPremium) {
            return NextResponse.json({ error: "Premium subscription required" }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const configId = searchParams.get("id");
        const provider = searchParams.get("provider");

        if (!configId && !provider) {
            return NextResponse.json({ error: "Config id or provider required" }, { status: 400 });
        }

        const query = supabase
            .from("user_ai_config")
            .delete()
            .eq("user_id", user.id);

        if (configId) {
            await query.eq("id", configId);
        } else {
            await query.eq("provider", provider!);
        }

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
