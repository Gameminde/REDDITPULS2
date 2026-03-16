import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function safeParseJson(value: unknown) {
    if (typeof value === "string") {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }
    return value;
}

function normalizeSources(value: unknown) {
    const parsed = safeParseJson(value);
    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed
        .map((item) => {
            if (typeof item === "string") {
                return { platform: item, count: 0 };
            }
            if (item && typeof item === "object") {
                const row = item as { platform?: unknown; count?: unknown };
                return {
                    platform: String(row.platform || "unknown"),
                    count: Number(row.count || 0),
                };
            }
            return null;
        })
        .filter(Boolean);
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const sort = searchParams.get("sort") || "score";
    const direction = searchParams.get("direction") || "desc";
    const category = searchParams.get("category") || "";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    let query = supabase
        .from("ideas")
        .select("*")
        .neq("confidence_level", "INSUFFICIENT");

    if (category) {
        query = query.eq("category", category);
    }

    // Sort options
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
            query = query.eq("trend_direction", "new").order("first_seen", { ascending: false });
            break;
        default:
            query = query.order("current_score", { ascending: direction === "asc" });
    }

    query = query.limit(limit);

    const { data, error } = await query;

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Parse JSONB fields
    const ideas = (data || []).map((idea: Record<string, unknown>) => ({
        ...idea,
        sources: normalizeSources(idea.sources),
        top_posts: safeParseJson(idea.top_posts),
        keywords: safeParseJson(idea.keywords),
        icp_data: safeParseJson(idea.icp_data),
        competition_data: safeParseJson(idea.competition_data),
    }));

    return NextResponse.json({ ideas, total: ideas.length });
}
