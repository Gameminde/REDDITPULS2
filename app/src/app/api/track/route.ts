import { NextRequest, NextResponse } from "next/server";

import { insertAnalyticsEvent, type AnalyticsScope } from "@/lib/analytics";
import { createClient } from "@/lib/supabase-server";

function isAnalyticsScope(value: unknown): value is AnalyticsScope {
    return value === "marketing" || value === "auth" || value === "product" || value === "admin";
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => null);
        const eventName = typeof body?.event_name === "string" ? body.event_name.trim().slice(0, 120) : "";
        const scope = isAnalyticsScope(body?.scope) ? body.scope : "marketing";
        const route = typeof body?.route === "string" ? body.route.trim().slice(0, 240) : req.nextUrl.pathname;
        const properties = body?.properties && typeof body.properties === "object" ? body.properties : {};

        if (!eventName) {
            return NextResponse.json({ error: "event_name is required" }, { status: 400 });
        }

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        const stored = await insertAnalyticsEvent(req, {
            eventName,
            scope,
            route,
            userId: user?.id || null,
            anonymousId: typeof body?.anonymous_id === "string" ? body.anonymous_id.trim().slice(0, 120) : null,
            sessionId: typeof body?.session_id === "string" ? body.session_id.trim().slice(0, 120) : null,
            referrer: typeof body?.referrer === "string" ? body.referrer.trim().slice(0, 500) : null,
            properties,
        });

        return NextResponse.json({ ok: true, stored: Boolean(stored) }, { status: stored ? 200 : 202 });
    } catch (error) {
        console.error("[Analytics] Track route failed:", error);
        return NextResponse.json({ ok: false }, { status: 202 });
    }
}
