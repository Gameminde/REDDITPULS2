import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { buildOpportunityTrust } from "@/lib/trust";
import { buildCompetitorWeaknessRadar } from "@/lib/competitor-weakness";
import { buildWhyNowFromOpportunity, buildWhyNowFromWeaknessCluster, WHY_NOW_TAXONOMY } from "@/lib/why-now";

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function GET(req: NextRequest) {
    const supabase = await createServerClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id || null;

    const scope = (req.nextUrl.searchParams.get("scope") || "").trim().toLowerCase();
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") || 12), 1), 30);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const emptyResult = Promise.resolve({ data: [], error: null as { message?: string } | null });

    const [
        { data: ideas, error: ideasError },
        { data: complaints, error: complaintsError },
        { data: alerts, error: alertsError },
        { data: watchlists, error: watchlistsError },
    ] = await Promise.all([
        supabaseAdmin
            .from("ideas")
            .select("*")
            .neq("confidence_level", "INSUFFICIENT")
            .order("last_updated", { ascending: false })
            .limit(80),
        supabaseAdmin
            .from("competitor_complaints")
            .select("*")
            .gte("scraped_at", thirtyDaysAgo)
            .order("scraped_at", { ascending: false })
            .limit(300),
        userId
            ? supabaseAdmin
                .from("pain_alerts")
                .select("*")
                .eq("user_id", userId)
                .eq("is_active", true)
            : emptyResult,
        userId
            ? supabaseAdmin
                .from("watchlists")
                .select("idea_id")
                .eq("user_id", userId)
                .not("idea_id", "is", null)
            : emptyResult,
    ]);

    if (ideasError) return NextResponse.json({ error: ideasError.message }, { status: 500 });
    if (complaintsError) return NextResponse.json({ error: complaintsError.message }, { status: 500 });
    if (alertsError) return NextResponse.json({ error: alertsError.message }, { status: 500 });
    if (watchlistsError) return NextResponse.json({ error: watchlistsError.message }, { status: 500 });

    const watchedIdeaIds = new Set((watchlists || []).map((row) => String(row.idea_id)));

    const opportunitySignals = (ideas || [])
        .filter((idea: Record<string, unknown>) => {
            const lastUpdated = Date.parse(String(idea.last_updated || ""));
            if (Number.isNaN(lastUpdated)) return false;
            return Date.now() - lastUpdated <= 72 * 60 * 60 * 1000;
        })
        .map((idea: Record<string, unknown>) => {
            const trust = buildOpportunityTrust(idea);
            return buildWhyNowFromOpportunity(
                {
                    ...idea,
                    trust,
                },
                watchedIdeaIds.has(String(idea.id)),
            );
        })
        .sort((a, b) => (b.confidence.score - a.confidence.score) || ((Date.parse(b.freshness.latest_observed_at || "") || 0) - (Date.parse(a.freshness.latest_observed_at || "") || 0)));

    const radar = buildCompetitorWeaknessRadar({
        complaints: complaints || [],
        alerts: alerts || [],
        limit: 30,
    });
    const competitorSignals = radar.clusters
        .map((cluster) => buildWhyNowFromWeaknessCluster(cluster))
        .sort((a, b) => (b.confidence.score - a.confidence.score) || ((Date.parse(b.freshness.latest_observed_at || "") || 0) - (Date.parse(a.freshness.latest_observed_at || "") || 0)));

    const mixed = [
        ...(scope === "competitor" ? [] : opportunitySignals),
        ...(scope === "opportunity" ? [] : competitorSignals),
    ]
        .sort((a, b) => (b.confidence.score - a.confidence.score) || ((Date.parse(b.freshness.latest_observed_at || "") || 0) - (Date.parse(a.freshness.latest_observed_at || "") || 0)))
        .slice(0, limit);

    return NextResponse.json({
        signals: mixed,
        categories: [...WHY_NOW_TAXONOMY],
        summary: {
            total_signals: mixed.length,
            opportunity_signals: mixed.filter((signal) => signal.scope === "opportunity").length,
            competitor_signals: mixed.filter((signal) => signal.scope === "competitor").length,
            high_confidence_signals: mixed.filter((signal) => signal.confidence.level === "HIGH").length,
        },
    });
}
