import { createClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

// GET /api/scan/[id] — poll scan progress + get results
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Get scan info
    const { data: scan } = await supabase
        .from("scans")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

    if (!scan) {
        return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }

    // Get AI analysis results for this scan (scan ownership already verified above)
    const { data: results } = await supabase
        .from("ai_analysis")
        .select("*")
        .eq("scan_id", id)
        .order("urgency_score", { ascending: false });

    // Get posts for this scan (scan ownership already verified above)
    const { data: posts } = await supabase
        .from("posts")
        .select("id,title,subreddit,score,num_comments,full_text,matched_phrases")
        .eq("scan_id", id)
        .order("score", { ascending: false })
        .limit(200);

    return NextResponse.json({
        scan,
        results: results || [],
        posts: posts || [],
        summary: {
            total_posts: scan.posts_found,
            analyzed: scan.posts_analyzed,
            opportunities: (results || []).filter((r: { willingness_to_pay: boolean }) => r.willingness_to_pay).length,
            avg_urgency: (results || []).length
                ? Math.round((results || []).reduce((a: number, r: { urgency_score: number }) => a + r.urgency_score, 0) / (results || []).length * 10) / 10
                : 0,
        },
    });
}
