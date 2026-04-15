import { NextRequest, NextResponse } from "next/server";

import {
    formatEncryptedConfigError,
    getDecryptedAiConfigsForUser,
    requireAiEncryptionKey,
} from "@/lib/ai-config-server";
import { verifyKey } from "@/lib/ai-key-verification";
import { consumeDurableRateLimit } from "@/lib/durable-rate-limit";
import { MODEL_CATALOG, getProviderRegistryEntry, resolveRegisteredModel } from "@/lib/ai-model-registry";
import { createClient } from "@/lib/supabase-server";

export { MODEL_CATALOG };

export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const configs = await getDecryptedAiConfigsForUser(supabase, user.id);

        const maskedConfigs = (configs || []).map((config) => ({
            ...config,
            selected_model: resolveRegisteredModel(String(config.selected_model || "")),
            api_key: config.api_key ? `*********${String(config.api_key).slice(-4)}` : "",
        }));

        return NextResponse.json({ configs: maskedConfigs, catalog: MODEL_CATALOG });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal server error";
        console.error("AI config GET fatal error:", error);
        return NextResponse.json({ error: message, configs: [], catalog: MODEL_CATALOG }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const rateLimit = await consumeDurableRateLimit({
            userId: user.id,
            scope: "settings_ai",
            limit: 10,
        });

        if (!rateLimit.allowed) {
            return NextResponse.json({ error: "Rate limit exceeded - max 10 config changes per hour" }, { status: 429 });
        }

        const encryptionKey = requireAiEncryptionKey();
        const body = await req.json();
        const { provider, api_key, selected_model, priority, endpoint_url, config_id } = body;
        const providerEntry = getProviderRegistryEntry(provider);

        if (!provider || !api_key || !selected_model) {
            return NextResponse.json({ error: "Provider, API key, and model are required" }, { status: 400 });
        }
        if (!providerEntry) {
            return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
        }

        const resolvedModel = resolveRegisteredModel(String(selected_model || ""));

        let verification = { status: "skipped", message: "Verification skipped" } as {
            status: string;
            message: string;
            resolved_model?: string;
        };

        try {
            verification = await verifyKey(provider, api_key, resolvedModel);
        } catch (verifyError) {
            console.error("Key verification failed:", verifyError);
            verification = {
                status: "error",
                message: "Could not verify this key right now. Try again in a moment.",
            };
        }

        if (verification.status !== "valid") {
            const statusCode = verification.status === "error" ? 502 : 400;
            return NextResponse.json({
                error: verification.message || "This AI key is not ready to use yet.",
                verification,
            }, { status: statusCode });
        }

        const safePriority = Math.max(1, Math.min(6, priority || 1));
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

        if (!existing) {
            const { count } = await supabase
                .from("user_ai_config")
                .select("id", { count: "exact" })
                .eq("user_id", user.id)
                .eq("is_active", true);

            if ((count || 0) >= 6) {
                return NextResponse.json({ error: "Maximum 6 active AI agents allowed" }, { status: 400 });
            }
        }

        const { error } = await supabase.rpc("upsert_ai_config_encrypted", {
            p_config_id: existing?.id || crypto.randomUUID(),
            p_user_id: user.id,
            p_provider: provider,
            p_api_key: api_key,
            p_model: resolvedModel,
            p_priority: safePriority,
            p_endpoint_url: endpoint_url || null,
            p_key: encryptionKey,
        });

        if (error) {
            return NextResponse.json({ error: formatEncryptedConfigError(error) }, { status: 500 });
        }

        return NextResponse.json({
            ok: true,
            verification: {
                status: verification.status,
                message: verification.message,
                resolved_model: verification.resolved_model || resolvedModel,
            },
        });
    } catch (error) {
        console.error("AI config POST error:", error);
        const message = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    } catch (error) {
        console.error("AI config DELETE error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
