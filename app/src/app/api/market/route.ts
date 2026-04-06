import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildMarketIdeas } from "@/lib/market-feed";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

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

    return NextResponse.json({ ideas, total: ideas.length });
}
