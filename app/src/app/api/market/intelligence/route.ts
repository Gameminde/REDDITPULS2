import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdmin } from "@/lib/supabase-admin";
import { buildMarketIdeas, hydrateIdeaForMarket } from "@/lib/market-feed";
import {
    buildCompetitorPressure,
    buildEmergingWedges,
    buildThemesToShape,
    type MarketIntelligenceSummary,
} from "@/lib/market-intelligence";

type ScraperRunRow = Record<string, unknown> | null;

function parseSourceList(value: unknown) {
    return String(value || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}

function parseNamedList(value: string) {
    return value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item && item !== "none");
}

function extractSourceHealth(latestRun: ScraperRunRow) {
    const rawSources = parseSourceList(latestRun?.source);
    const errorText = String(latestRun?.error_text || "");
    const structuredMatch = errorText.match(/Source health:\s*healthy=([^;|]+);\s*degraded=([^|]+)/i);

    let healthySources = structuredMatch ? parseNamedList(structuredMatch[1] || "") : [];
    let degradedSources = structuredMatch ? parseNamedList(structuredMatch[2] || "") : [];

    if (!structuredMatch) {
        const degradedHints = [
            { source: "reddit", pattern: /reddit degraded|layer 1 async degraded|layer 1 async failed|layer 2b/i },
            { source: "hackernews", pattern: /hacker news skipped/i },
            { source: "producthunt", pattern: /producthunt skipped/i },
            { source: "indiehackers", pattern: /indiehackers skipped/i },
        ];

        degradedSources = degradedHints
            .filter((hint) => hint.pattern.test(errorText))
            .map((hint) => hint.source);
        healthySources = rawSources.filter((source) => !degradedSources.includes(source));
    }

    const runHealth = String(latestRun?.status || "").toLowerCase() === "failed"
        ? "failed"
        : degradedSources.length > 0 || String(latestRun?.status || "").toLowerCase() === "degraded"
            ? "degraded"
            : "healthy";

    return {
        healthy_sources: healthySources,
        degraded_sources: degradedSources,
        run_health: runHealth as MarketIntelligenceSummary["run_health"],
    };
}

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

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const category = (req.nextUrl.searchParams.get("category") || "").trim().toLowerCase();
    const admin = createAdmin();
    const recentHistorySince = new Date(Date.now() - 7 * 86400000).toISOString();
    const recentComplaintsSince = new Date(Date.now() - 30 * 86400000).toISOString();

    const [
        { data: ideaRows, error: ideasError },
        { data: latestRuns, error: runsError },
        { data: validationRows, error: validationsError },
        { data: opportunityRows, error: opportunitiesError },
        { data: alertRows, error: alertsError },
        { data: complaintRows, error: complaintsError },
        { data: trendRows, error: trendError },
    ] = await Promise.all([
        admin.from("ideas").select("*"),
        admin.from("scraper_runs").select("*").order("started_at", { ascending: false }).limit(1),
        admin
            .from("idea_validations")
            .select("status, verdict, idea_text, extracted_keywords, extracted_audience, extracted_competitors")
            .eq("user_id", user.id)
            .eq("status", "done")
            .limit(200),
        admin
            .from("opportunities")
            .select("primary_idea_slug, source_idea_slugs")
            .eq("user_id", user.id),
        admin
            .from("pain_alerts")
            .select("*")
            .eq("user_id", user.id)
            .eq("is_active", true),
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

    if (ideasError) return NextResponse.json({ error: ideasError.message }, { status: 500 });
    if (runsError) return NextResponse.json({ error: runsError.message }, { status: 500 });
    if (validationsError) return NextResponse.json({ error: validationsError.message }, { status: 500 });
    if (opportunitiesError) return NextResponse.json({ error: opportunitiesError.message }, { status: 500 });
    if (alertsError) return NextResponse.json({ error: alertsError.message }, { status: 500 });
    if (complaintsError) return NextResponse.json({ error: complaintsError.message }, { status: 500 });
    if (trendError) return NextResponse.json({ error: trendError.message }, { status: 500 });

    const hydratedIdeas = (ideaRows || []).map((row) => hydrateIdeaForMarket(row as Record<string, unknown>));
    const feedVisible = buildMarketIdeas((ideaRows || []) as Array<Record<string, unknown>>, { includeExploratory: false });

    const recentIdeaIds = hydratedIdeas
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
        ideas: hydratedIdeas,
        promotedSlugs,
        historyRows: (ideaHistoryRows || []) as Array<{ idea_id?: string | null; score?: number | null; recorded_at?: string | null }>,
        trendRows: (trendRows || []) as Array<{ keyword?: string | null; change_24h?: number | null; change_7d?: number | null; updated_at?: string | null }>,
        validationMemory: (validationRows || []) as Array<Record<string, unknown>>,
        category: category || undefined,
    });

    const themesToShape = buildThemesToShape({
        ideas: hydratedIdeas,
        promotedSlugs,
        emergingSlugs: new Set(emergingWedges.map((item) => item.slug)),
        category: category || undefined,
    });

    const competitorPressure = buildCompetitorPressure({
        complaints: (complaintRows || []) as Array<Record<string, unknown>>,
        alerts: (alertRows || []) as Array<Record<string, unknown>>,
        limit: 12,
    });

    const sourceHealth = extractSourceHealth((latestRuns?.[0] || null) as ScraperRunRow);
    const new72hCount = hydratedIdeas.filter((idea) => {
        const firstSeen = Date.parse(String(idea.first_seen || ""));
        if (!Number.isFinite(firstSeen)) return false;
        if (category && idea.category !== category) return false;
        return Date.now() - firstSeen <= 72 * 3600000;
    }).length;

    return NextResponse.json({
        summary: {
            generated_at: new Date().toISOString(),
            ...sourceHealth,
            raw_idea_count: hydratedIdeas.length,
            feed_visible_count: category ? feedVisible.filter((idea) => idea.category === category).length : feedVisible.length,
            new_72h_count: new72hCount,
            emerging_wedge_count: emergingWedges.length,
        } satisfies MarketIntelligenceSummary,
        emerging_wedges: emergingWedges,
        themes_to_shape: themesToShape,
        competitor_pressure: competitorPressure,
    });
}
