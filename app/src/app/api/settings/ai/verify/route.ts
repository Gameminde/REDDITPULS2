import { NextRequest, NextResponse } from "next/server";

import { detectProvider, verifyKey } from "@/lib/ai-key-verification";
import { getDefaultModel, resolveRegisteredModel } from "@/lib/ai-model-registry";
import { createClient } from "@/lib/supabase-server";

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
