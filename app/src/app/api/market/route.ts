import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildMarketIdeas } from "@/lib/market-feed";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

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

    let query = supabase
        .from("ideas")
        .select("*")
        .neq("confidence_level", "INSUFFICIENT");

    if (category) {
        query = query.eq("category", category);
    }

    switch (sort) {
        case "change_24h":
            query = query.order("change_24h", { ascending: direction === "asc" });
            break;
        case "change_7d":
            query = query.order("change_7d", { ascending: direction === "asc" });
            break;
        case "trending":
            query = query.eq("trend_direction", "rising").order("change_24h", { ascending: false });
            break;
        case "dying":
            query = query.eq("trend_direction", "falling").order("change_24h", { ascending: true });
            break;
        case "new":
            query = query.order("first_seen", { ascending: false });
            break;
        default:
            query = query.order("current_score", { ascending: direction === "asc" });
    }

    const fetchLimit = Math.min(Math.max(limit * 4, limit), 500);
    const { data, error } = await query.limit(fetchLimit);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const ideas = buildMarketIdeas((data || []) as Array<Record<string, unknown>>, {
        includeExploratory,
        surface: "user",
    });
    const sortedIdeas = sortIdeasForFeed(ideas as Array<Record<string, unknown>>, sort, direction);
    const limitedIdeas = sortedIdeas.slice(0, limit);

    return NextResponse.json({ ideas: limitedIdeas, total: sortedIdeas.length });
}
