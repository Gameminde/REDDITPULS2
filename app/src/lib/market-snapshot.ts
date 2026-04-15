import { filterMarketIdeas, hydrateIdeaForMarket, type MarketHydratedIdea } from "@/lib/market-feed";
import { extractMarketFunnel, extractScraperRunHealth, type MarketFunnelSnapshot, type ScraperRunHealth } from "@/lib/scraper-run-health";

type AdminClient = {
    from: (table: string) => {
        select: (columns?: string) => any;
    };
};

export interface MarketSnapshot {
    latestRun: Record<string, unknown> | null;
    sourceHealth: ScraperRunHealth;
    funnel: MarketFunnelSnapshot | null;
    hydratedIdeas: MarketHydratedIdea[];
    laneHydratedIdeas: MarketHydratedIdea[];
    userVisibleIdeas: MarketHydratedIdea[];
    laneUserVisibleIdeas: MarketHydratedIdea[];
    userArchiveIdeas: MarketHydratedIdea[];
    laneUserArchiveIdeas: MarketHydratedIdea[];
    adminIdeas: MarketHydratedIdea[];
    laneAdminIdeas: MarketHydratedIdea[];
    trackedPostCount: number;
    evidenceAttachedCount: number;
    new72hCount: number;
    rawIdeaCount: number;
    lastObservedAt: string | null;
}

function matchesCategory(idea: MarketHydratedIdea, category: string | null) {
    if (!category) return true;
    return String(idea.category || "").trim().toLowerCase() === category;
}

function selectByCategory(ideas: MarketHydratedIdea[], category: string | null) {
    return category ? ideas.filter((idea) => matchesCategory(idea, category)) : ideas;
}

function hasEvidenceAttached(idea: MarketHydratedIdea) {
    const evidenceCount = Number(idea?.evidence_summary?.evidence_count || 0);
    const directCount = Number(idea?.signal_contract?.buyer_native_direct_count || 0);
    const supportingCount = Number(idea?.signal_contract?.supporting_signal_count || 0);
    return evidenceCount > 0 || directCount > 0 || supportingCount > 0;
}

function isNewWithin72h(idea: MarketHydratedIdea) {
    const firstSeen = Date.parse(String(idea.first_seen || ""));
    return Number.isFinite(firstSeen) && Date.now() - firstSeen <= 72 * 3600000;
}

export async function loadMarketSnapshot(
    admin: AdminClient,
    options?: {
        category?: string | null;
    },
): Promise<MarketSnapshot> {
    const [
        { data: ideaRows, error: ideasError },
        { data: latestRuns, error: runsError },
    ] = await Promise.all([
        admin
            .from("ideas")
            .select("*")
            .neq("confidence_level", "INSUFFICIENT"),
        admin
            .from("scraper_runs")
            .select("*")
            .order("started_at", { ascending: false })
            .limit(1),
    ]);

    if (ideasError) {
        throw ideasError;
    }
    if (runsError) {
        throw runsError;
    }

    return buildMarketSnapshotFromRows(
        (ideaRows || []) as Array<Record<string, unknown>>,
        ((latestRuns || [])[0] || null) as Record<string, unknown> | null,
        options,
    );
}

export function buildMarketSnapshotFromRows(
    rows: Array<Record<string, unknown>>,
    latestRun: Record<string, unknown> | null,
    options?: {
        category?: string | null;
    },
): MarketSnapshot {
    const normalizedCategory = String(options?.category || "").trim().toLowerCase() || null;
    const hydratedIdeas = rows.map((row) => hydrateIdeaForMarket(row));
    const userVisibleIdeas = filterMarketIdeas(hydratedIdeas, {
        includeExploratory: false,
        surface: "user",
    });
    const userArchiveIdeas = filterMarketIdeas(hydratedIdeas, {
        includeExploratory: true,
        surface: "user",
    });
    const adminIdeas = filterMarketIdeas(hydratedIdeas, {
        includeExploratory: true,
        surface: "admin",
    });

    const laneHydratedIdeas = selectByCategory(hydratedIdeas, normalizedCategory);
    const laneUserVisibleIdeas = selectByCategory(userVisibleIdeas, normalizedCategory);
    const laneUserArchiveIdeas = selectByCategory(userArchiveIdeas, normalizedCategory);
    const laneAdminIdeas = selectByCategory(adminIdeas, normalizedCategory);

    return {
        latestRun,
        sourceHealth: extractScraperRunHealth(latestRun),
        funnel: extractMarketFunnel(latestRun),
        hydratedIdeas,
        laneHydratedIdeas,
        userVisibleIdeas,
        laneUserVisibleIdeas,
        userArchiveIdeas,
        laneUserArchiveIdeas,
        adminIdeas,
        laneAdminIdeas,
        trackedPostCount: laneUserVisibleIdeas.reduce((sum, idea) => sum + Number(idea.post_count_total || 0), 0),
        evidenceAttachedCount: laneUserVisibleIdeas.filter(hasEvidenceAttached).length,
        new72hCount: laneUserVisibleIdeas.filter(isNewWithin72h).length,
        rawIdeaCount: laneHydratedIdeas.length,
        lastObservedAt:
            typeof latestRun?.completed_at === "string"
                ? latestRun.completed_at
                : typeof latestRun?.started_at === "string"
                    ? latestRun.started_at
                    : null,
    };
}
