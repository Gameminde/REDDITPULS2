import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function GET(req: NextRequest) {
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 50), 100);
    const competitorFilter = (req.nextUrl.searchParams.get("competitor") || "").toLowerCase();
    const signalFilter = (req.nextUrl.searchParams.get("signal") || "").toLowerCase();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const { data, error } = await supabase
        .from("competitor_complaints")
        .select("*")
        .gte("scraped_at", sevenDaysAgo)
        .order("post_score", { ascending: false })
        .limit(limit);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const complaints = (data || []).filter((item: Record<string, unknown>) => {
        const competitors = Array.isArray(item.competitors_mentioned) ? item.competitors_mentioned.map(String) : [];
        const signals = Array.isArray(item.complaint_signals) ? item.complaint_signals.map(String) : [];
        const matchesCompetitor = !competitorFilter || competitors.some((name) => name.toLowerCase() === competitorFilter);
        const matchesSignal = !signalFilter || signals.some((signal) => signal.toLowerCase().includes(signalFilter));
        return matchesCompetitor && matchesSignal;
    });

    const competitors = Array.from(new Set(
        complaints.flatMap((item: Record<string, unknown>) =>
            Array.isArray(item.competitors_mentioned) ? item.competitors_mentioned.map(String) : [],
        ),
    )).sort();

    return NextResponse.json({ complaints, competitors });
}
