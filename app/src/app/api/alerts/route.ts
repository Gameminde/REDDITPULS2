import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { trackServerEvent } from "@/lib/analytics";
import { buildAlertEvidence, buildEvidenceBackedTrust, buildEvidenceSummary } from "@/lib/evidence";

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function requireUser() {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function GET() {
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: alerts, error } = await supabaseAdmin
        .from("pain_alerts")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: matches, error: matchesError } = await supabaseAdmin
        .from("alert_matches")
        .select("*")
        .eq("user_id", user.id)
        .eq("seen", false)
        .order("matched_at", { ascending: false })
        .limit(200);

    if (matchesError) return NextResponse.json({ error: matchesError.message }, { status: 500 });

    const groupedMatches = new Map<string, any[]>();
    for (const match of matches || []) {
        const existing = groupedMatches.get(match.alert_id) || [];
        existing.push(match);
        groupedMatches.set(match.alert_id, existing);
    }

    const hydratedAlerts = (alerts || []).map((alert) => {
        const alertMatches = groupedMatches.get(alert.id) || [];
        const evidence = buildAlertEvidence(alert, alertMatches);
        const evidenceSummary = buildEvidenceSummary(evidence);

        return {
            ...alert,
            matches: alertMatches,
            evidence,
            evidence_summary: evidenceSummary,
            source_breakdown: evidenceSummary.source_breakdown,
            direct_vs_inferred: evidenceSummary.direct_vs_inferred,
            trust: buildEvidenceBackedTrust({
                items: evidence,
                extraWeakSignalReasons: alertMatches.length === 0 ? ["No live matches yet"] : [],
            }),
        };
    });

    return NextResponse.json({
        alerts: hydratedAlerts,
        unread_count: (matches || []).length,
    });
}

export async function POST(req: NextRequest) {
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const keywords = Array.isArray(body.keywords) ? body.keywords.filter(Boolean) : [];
    const subreddits = Array.isArray(body.subreddits) ? body.subreddits.filter(Boolean) : [];

    if (keywords.length === 0) {
        return NextResponse.json({ error: "keywords required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from("pain_alerts")
        .insert({
            user_id: user.id,
            validation_id: body.validation_id || null,
            keywords: keywords.slice(0, 10),
            subreddits: subreddits.slice(0, 20),
            min_score: Number(body.min_score || 10),
            is_active: true,
        })
        .select("id, created_at")
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await trackServerEvent(req, {
        eventName: "alert_created",
        scope: "product",
        userId: user.id,
        route: "/api/alerts",
        properties: {
            validation_id: body.validation_id || null,
            keyword_count: keywords.length,
            subreddit_count: subreddits.length,
            min_score: Number(body.min_score || 10),
        },
    });

    return NextResponse.json({ id: data.id, created: data.created_at }, { status: 201 });
}
