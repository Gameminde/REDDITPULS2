import { NextResponse } from "next/server";

import {
    IDEA_LIST_SELECT,
    IDEA_LIST_SELECT_LEGACY,
    buildIdeasListPayload,
    isMissingMarketEditorialColumnError,
} from "@/lib/idea-api";
import { createAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const sort = searchParams.get("sort") || "score";
    const direction = searchParams.get("direction") || "desc";
    const category = searchParams.get("category") || "";
    const includeExploratory = searchParams.get("include_exploratory") === "1";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 100);

    const admin = createAdmin();
    let query = admin
        .from("ideas")
        .select(IDEA_LIST_SELECT)
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

    const fetchLimit = Math.min(Math.max(limit * 4, limit), 400);
    let { data, error } = await query.limit(fetchLimit);

    if (error && isMissingMarketEditorialColumnError(error)) {
        let fallbackQuery = admin
            .from("ideas")
            .select(IDEA_LIST_SELECT_LEGACY)
            .neq("confidence_level", "INSUFFICIENT");

        if (category) {
            fallbackQuery = fallbackQuery.eq("category", category);
        }

        switch (sort) {
            case "change_24h":
                fallbackQuery = fallbackQuery.order("change_24h", { ascending: direction === "asc" });
                break;
            case "change_7d":
                fallbackQuery = fallbackQuery.order("change_7d", { ascending: direction === "asc" });
                break;
            case "trending":
                fallbackQuery = fallbackQuery.eq("trend_direction", "rising").order("change_24h", { ascending: false });
                break;
            case "dying":
                fallbackQuery = fallbackQuery.eq("trend_direction", "falling").order("change_24h", { ascending: true });
                break;
            case "new":
                fallbackQuery = fallbackQuery.order("first_seen", { ascending: false });
                break;
            default:
                fallbackQuery = fallbackQuery.order("current_score", { ascending: direction === "asc" });
        }

        const fallbackResponse = await fallbackQuery.limit(fetchLimit);
        data = fallbackResponse.data;
        error = fallbackResponse.error;
    }

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(buildIdeasListPayload((data || []) as unknown as Array<Record<string, unknown>>, {
        includeExploratory,
        surface: "user",
        limit,
    }));
}
