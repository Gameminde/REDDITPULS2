import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { FEATURE_FLAGS } from "@/lib/feature-flags";

export async function requireRedditLabUser() {
    if (!FEATURE_FLAGS.REDDIT_CONNECTION_LAB_ENABLED) {
        return { error: NextResponse.json({ error: "Reddit Connection Lab is disabled." }, { status: 404 }) };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }

    return { user };
}

export function getRequestOrigin(req: NextRequest) {
    return req.nextUrl.origin || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}
