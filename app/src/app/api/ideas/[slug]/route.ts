import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildOpportunityTrust, normalizeSources } from "@/lib/trust";
import { buildEvidenceSummary, buildOpportunityEvidence } from "@/lib/evidence";
import { buildOpportunityStrategySnapshot } from "@/lib/opportunity-strategy";

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

export async function GET(
    request: Request,
    { params }: { params: Promise<{ slug: string }> }
) {
    const { slug } = await params;

    // Get the idea
    const { data: idea, error: ideaError } = await supabase
        .from("ideas")
        .select("*")
        .eq("slug", slug)
        .single();

    if (ideaError || !idea) {
        return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    // Get history for charts (last 90 days)
    const { data: history } = await supabase
        .from("idea_history")
        .select("score, post_count, source_count, recorded_at")
        .eq("idea_id", idea.id)
        .order("recorded_at", { ascending: true })
        .limit(180);

    // Parse JSONB fields
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
    }, 8);
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

    const parsed = {
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
        strategy,
    };

    return NextResponse.json({ idea: parsed, history: history || [] });
}
