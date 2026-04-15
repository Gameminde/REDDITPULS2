import { NextResponse } from "next/server";
import { createAdmin } from "@/lib/supabase-admin";
import { loadMarketSnapshot } from "@/lib/market-snapshot";

function toFiniteNumber(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function toTimestamp(value: unknown) {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

function sortIdeasForFeed(ideas: Array<Record<string, unknown>>, sort: string, direction: string) {
    const ascending = direction === "asc";
    const rows = [...ideas];

    switch (sort) {
        case "change_24h":
            return rows.sort((a, b) =>
                (ascending ? 1 : -1) * (toFiniteNumber(a.change_24h) - toFiniteNumber(b.change_24h))
                || toFiniteNumber(b.current_score) - toFiniteNumber(a.current_score),
            );
        case "change_7d":
            return rows.sort((a, b) =>
                (ascending ? 1 : -1) * (toFiniteNumber(a.change_7d) - toFiniteNumber(b.change_7d))
                || toFiniteNumber(b.current_score) - toFiniteNumber(a.current_score),
            );
        case "trending":
            return rows
                .filter((idea) => String(idea.trend_direction || "").toLowerCase() === "rising")
                .sort((a, b) =>
                    toFiniteNumber(b.change_24h) - toFiniteNumber(a.change_24h)
                    || toFiniteNumber(b.change_7d) - toFiniteNumber(a.change_7d)
                    || toFiniteNumber(b.current_score) - toFiniteNumber(a.current_score),
                );
        case "dying":
            return rows
                .filter((idea) => String(idea.trend_direction || "").toLowerCase() === "falling")
                .sort((a, b) =>
                    toFiniteNumber(a.change_24h) - toFiniteNumber(b.change_24h)
                    || toFiniteNumber(a.change_7d) - toFiniteNumber(b.change_7d)
                    || toFiniteNumber(b.current_score) - toFiniteNumber(a.current_score),
                );
        case "new":
            return rows.sort((a, b) =>
                toTimestamp(b.first_seen) - toTimestamp(a.first_seen)
                || toFiniteNumber(b.current_score) - toFiniteNumber(a.current_score),
            );
        default:
            return rows.sort((a, b) =>
                (ascending ? 1 : -1) * (toFiniteNumber(a.current_score) - toFiniteNumber(b.current_score))
                || toFiniteNumber(b.change_24h) - toFiniteNumber(a.change_24h),
            );
    }
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const sort = searchParams.get("sort") || "score";
    const direction = searchParams.get("direction") || "desc";
    const category = searchParams.get("category") || "";
    const includeExploratory = searchParams.get("include_exploratory") === "1";
    const limit = Math.min(parseInt(searchParams.get("limit") || "120", 10) || 120, 250);

    try {
        const snapshot = await loadMarketSnapshot(createAdmin(), { category });
        const ideas = includeExploratory ? snapshot.laneUserArchiveIdeas : snapshot.laneUserVisibleIdeas;
        const sortedIdeas = sortIdeasForFeed(ideas as Array<Record<string, unknown>>, sort, direction);
        const limitedIdeas = sortedIdeas.slice(0, limit);

        return NextResponse.json({ ideas: limitedIdeas, total: sortedIdeas.length });
    } catch (error) {
        return NextResponse.json({ error: (error as Error)?.message || "Could not load market feed" }, { status: 500 });
    }
}
