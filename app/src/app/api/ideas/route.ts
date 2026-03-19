import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildOpportunityTrust, normalizeSources } from "@/lib/trust";
import { buildEvidenceSummary, buildOpportunityEvidence } from "@/lib/evidence";
import { buildOpportunityStrategyPreview, buildOpportunityStrategySnapshot } from "@/lib/opportunity-strategy";

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
    const ideas = (data || []).map((idea: Record<string, unknown>) => {
        const parsedTopPosts = safeParseJson(idea.top_posts);
        const parsedKeywords = safeParseJson(idea.keywords);
        const parsedIcpData = safeParseJson(idea.icp_data);
        const parsedCompetitionData = safeParseJson(idea.competition_data);
        const normalizedSources = normalizeSources(idea.sources);
        const trust = buildOpportunityTrust({
            ...idea,
            sources: normalizedSources,
            top_posts: parsedTopPosts,
        });
        const evidence = buildOpportunityEvidence({
            ...idea,
            top_posts: parsedTopPosts,
        }, 4);
        const evidenceSummary = buildEvidenceSummary(evidence);
        const strategy = buildOpportunityStrategySnapshot({
            ...(idea as Record<string, unknown>),
            id: String(idea.id || ""),
            slug: String(idea.slug || ""),
            topic: String(idea.topic || ""),
            category: String(idea.category || ""),
            sources: normalizedSources,
            top_posts: parsedTopPosts,
            keywords: parsedKeywords,
            icp_data: parsedIcpData as Record<string, unknown> | null,
            competition_data: parsedCompetitionData as Record<string, unknown> | null,
            trust,
            evidence,
            evidence_summary: evidenceSummary,
        });

        return {
            ...idea,
            sources: normalizedSources,
            top_posts: parsedTopPosts,
            keywords: parsedKeywords,
            icp_data: parsedIcpData,
            competition_data: parsedCompetitionData,
            trust,
            evidence,
            evidence_summary: evidenceSummary,
            source_breakdown: evidenceSummary.source_breakdown,
            direct_vs_inferred: evidenceSummary.direct_vs_inferred,
            strategy_preview: buildOpportunityStrategyPreview(strategy),
        };
    });

    return NextResponse.json({ ideas, total: ideas.length });
}
