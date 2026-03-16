import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
    const parsed = {
        ...idea,
        sources: typeof idea.sources === "string" ? JSON.parse(idea.sources) : idea.sources,
        top_posts: typeof idea.top_posts === "string" ? JSON.parse(idea.top_posts) : idea.top_posts,
        keywords: typeof idea.keywords === "string" ? JSON.parse(idea.keywords) : idea.keywords,
        icp_data: typeof idea.icp_data === "string" ? JSON.parse(idea.icp_data) : idea.icp_data,
        competition_data: typeof idea.competition_data === "string" ? JSON.parse(idea.competition_data) : idea.competition_data,
    };

    return NextResponse.json({ idea: parsed, history: history || [] });
}
