import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdmin } from "@/lib/supabase-admin";
import {
    buildCompetitorPressure,
    buildEmergingWedges,
    buildThemesToShape,
    type MarketIntelligenceSummary,
} from "@/lib/market-intelligence";
import { loadMarketSnapshot } from "@/lib/market-snapshot";

function normalizeSlugArray(value: unknown, primaryIdeaSlug = "") {
    const parsed = typeof value === "string" ? (() => {
        try {
            return JSON.parse(value) as string[];
        } catch {
            return [];
        }
    })() : value;

    const rows = Array.isArray(parsed) ? parsed : [];
    return [...new Set(rows.map(String).filter(Boolean).filter((slug) => slug !== primaryIdeaSlug))];
}

export async function GET(req: NextRequest) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id || null;

    const category = (req.nextUrl.searchParams.get("category") || "").trim().toLowerCase();
    const admin = createAdmin();
    const recentHistorySince = new Date(Date.now() - 7 * 86400000).toISOString();
    const recentComplaintsSince = new Date(Date.now() - 30 * 86400000).toISOString();
    const snapshot = await loadMarketSnapshot(admin, { category });

    const emptyResult = Promise.resolve({ data: [], error: null as { message?: string } | null });

    const [
        { data: validationRows, error: validationsError },
        { data: opportunityRows, error: opportunitiesError },
        { data: alertRows, error: alertsError },
        { data: complaintRows, error: complaintsError },
        { data: trendRows, error: trendError },
    ] = await Promise.all([
        userId
            ? admin
                .from("idea_validations")
                .select("status, verdict, idea_text, extracted_keywords, extracted_audience, extracted_competitors")
                .eq("user_id", userId)
                .eq("status", "done")
                .limit(200)
            : emptyResult,
        userId
            ? admin
                .from("opportunities")
                .select("primary_idea_slug, source_idea_slugs")
                .eq("user_id", userId)
            : emptyResult,
        userId
            ? admin
                .from("pain_alerts")
                .select("*")
                .eq("user_id", userId)
                .eq("is_active", true)
            : emptyResult,
        admin
            .from("competitor_complaints")
            .select("*")
            .gte("scraped_at", recentComplaintsSince)
            .order("scraped_at", { ascending: false })
            .limit(400),
        admin
            .from("trend_signals")
            .select("keyword, change_24h, change_7d, updated_at")
            .order("updated_at", { ascending: false })
            .limit(400),
    ]);

    if (validationsError) return NextResponse.json({ error: validationsError.message }, { status: 500 });
    if (opportunitiesError) return NextResponse.json({ error: opportunitiesError.message }, { status: 500 });
    if (alertsError) return NextResponse.json({ error: alertsError.message }, { status: 500 });
    if (complaintsError) return NextResponse.json({ error: complaintsError.message }, { status: 500 });
    if (trendError) return NextResponse.json({ error: trendError.message }, { status: 500 });

    const laneIdeas = snapshot.laneHydratedIdeas;
    const userFacingIdeas = snapshot.laneUserVisibleIdeas;
    const laneFeedVisible = snapshot.laneUserVisibleIdeas;

    const recentIdeaIds = userFacingIdeas
        .filter((idea) => {
            const firstSeen = Date.parse(String(idea.first_seen || ""));
            return Number.isFinite(firstSeen) && Date.now() - firstSeen <= 72 * 3600000;
        })
        .map((idea) => idea.id)
        .filter(Boolean);

    const { data: ideaHistoryRows, error: historyError } = recentIdeaIds.length > 0
        ? await admin
            .from("idea_history")
            .select("idea_id, score, recorded_at")
            .gte("recorded_at", recentHistorySince)
            .in("idea_id", recentIdeaIds)
        : { data: [], error: null as { message?: string } | null };

    if (historyError) {
        return NextResponse.json({ error: historyError.message }, { status: 500 });
    }

    const promotedSlugs = new Set<string>();
    for (const row of opportunityRows || []) {
        const primary = String(row.primary_idea_slug || "");
        if (primary) promotedSlugs.add(primary);
        for (const slug of normalizeSlugArray(row.source_idea_slugs, primary)) {
            promotedSlugs.add(slug);
        }
    }

    const emergingWedges = buildEmergingWedges({
        ideas: userFacingIdeas,
        promotedSlugs,
        historyRows: (ideaHistoryRows || []) as Array<{ idea_id?: string | null; score?: number | null; recorded_at?: string | null }>,
        trendRows: (trendRows || []) as Array<{ keyword?: string | null; change_24h?: number | null; change_7d?: number | null; updated_at?: string | null }>,
        validationMemory: (validationRows || []) as Array<Record<string, unknown>>,
        category: category || undefined,
    });

    const themesToShape = buildThemesToShape({
        ideas: userFacingIdeas,
        promotedSlugs,
        emergingSlugs: new Set(emergingWedges.map((item) => item.slug)),
        category: category || undefined,
    });

    const competitorPressure = buildCompetitorPressure({
        complaints: (complaintRows || []) as Array<Record<string, unknown>>,
        alerts: (alertRows || []) as Array<Record<string, unknown>>,
        limit: 12,
    });

    return NextResponse.json({
        summary: {
            generated_at: new Date().toISOString(),
            ...snapshot.sourceHealth,
            raw_idea_count: laneIdeas.length,
            feed_visible_count: laneFeedVisible.length,
            new_72h_count: snapshot.new72hCount,
            emerging_wedge_count: emergingWedges.length,
        } satisfies MarketIntelligenceSummary,
        emerging_wedges: emergingWedges,
        themes_to_shape: themesToShape,
        competitor_pressure: competitorPressure,
    });
}
