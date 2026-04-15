import { NextResponse } from "next/server";

import { getActiveAiConfigHealth } from "@/lib/ai-config-server";
import { createClient } from "@/lib/supabase-server";

export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const summary = await getActiveAiConfigHealth(supabase, user.id);
        return NextResponse.json(summary);
    } catch (error) {
        console.error("AI config health GET error:", error);
        const message = error instanceof Error ? error.message : "Could not inspect AI provider health";
        return NextResponse.json(
            { error: message, health: [], checked_count: 0, usable_count: 0, blocked: false, message: null },
            { status: 500 },
        );
    }
}
