import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { watchlistErrorMessage } from "@/lib/watchlist-data";
import { buildMonitorFeed, supabaseAdmin } from "@/lib/monitor-feed";

async function getUser() {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll: () => cookieStore.getAll() } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function GET() {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const feed = await buildMonitorFeed(user.id);
        return NextResponse.json(feed);
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "Could not load monitors" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const legacyType = String(body.legacy_type || "");
    const legacyId = String(body.legacy_id || "");

    if (!legacyType || !legacyId) {
        return NextResponse.json({ error: "legacy_type and legacy_id are required" }, { status: 400 });
    }

    if (legacyType === "watchlist") {
        const { error } = await supabaseAdmin
            .from("watchlists")
            .delete()
            .eq("id", legacyId)
            .eq("user_id", user.id);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (legacyType === "alert") {
        const { error } = await supabaseAdmin
            .from("pain_alerts")
            .update({ is_active: false })
            .eq("id", legacyId)
            .eq("user_id", user.id);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (legacyType === "opportunity") {
        // Opportunity watches are native monitors only, so deleting the monitor row is enough.
    } else {
        return NextResponse.json({ error: "Unsupported monitor type" }, { status: 400 });
    }

    const { error: monitorDeleteError } = await supabaseAdmin
        .from("monitors")
        .delete()
        .eq("user_id", user.id)
        .eq("legacy_type", legacyType)
        .eq("legacy_id", legacyId);

    if (monitorDeleteError) {
        const message = watchlistErrorMessage(monitorDeleteError);
        if (!message.includes("monitors") && !message.includes("relation") && !message.includes("does not exist")) {
            return NextResponse.json({ error: monitorDeleteError.message }, { status: 500 });
        }
    }

    return NextResponse.json({ success: true });
}
