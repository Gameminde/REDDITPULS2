import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildOpportunityTrust, normalizeSources } from "@/lib/trust";
import { buildOpportunitySignalContract } from "@/lib/opportunity-signal";
import { buildOpportunityLabIdea } from "@/lib/opportunity-lab";

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

export async function GET() {
    const { data, error } = await supabase
        .from("ideas")
        .select("*")
        .order("current_score", { ascending: false })
        .limit(80);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const ideas = (data || []).map((idea: Record<string, unknown>) => {
        const parsedTopPosts = safeParseJson(idea.top_posts);
        const parsedKeywords = safeParseJson(idea.keywords);
        const normalizedSources = normalizeSources(idea.sources);
        const signalContract = buildOpportunitySignalContract({
            topPosts: Array.isArray(parsedTopPosts) ? parsedTopPosts as Array<Record<string, unknown>> : [],
            sources: normalizedSources,
            sourceCount: Number(idea.source_count || normalizedSources.length || 0),
        });
        const trust = buildOpportunityTrust({
            ...idea,
            sources: normalizedSources,
            top_posts: parsedTopPosts,
            signal_contract: signalContract,
        });

        return buildOpportunityLabIdea({
            id: String(idea.id || ""),
            slug: String(idea.slug || ""),
            topic: String(idea.topic || ""),
            category: String(idea.category || "general"),
            current_score: Number(idea.current_score || 0),
            post_count_total: Number(idea.post_count_total || 0),
            source_count: Number(idea.source_count || normalizedSources.length || 0),
            sources: normalizedSources,
            top_posts: Array.isArray(parsedTopPosts) ? parsedTopPosts as [] : [],
            keywords: Array.isArray(parsedKeywords) ? parsedKeywords as string[] : [],
            signal_contract: signalContract,
            trust,
        });
    });

    const lanes = {
        candidate_opportunity: ideas.filter((idea) => idea.lane === "candidate_opportunity"),
        theme_to_shape: ideas.filter((idea) => idea.lane === "theme_to_shape"),
        market_context: ideas.filter((idea) => idea.lane === "market_context"),
        ignore: ideas.filter((idea) => idea.lane === "ignore"),
    };

    return NextResponse.json({
        generated_at: new Date().toISOString(),
        total: ideas.length,
        lanes,
    });
}
