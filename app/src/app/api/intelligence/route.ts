import { createClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/intelligence?section=trends|wtp|competitors|sources
 * Parses idea_validations.report JSON and returns the relevant section
 * aggregated across ALL of the user's completed validations.
 */
export async function GET(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const section = req.nextUrl.searchParams.get("section") || "all";

        // Fetch all completed validations with reports
        const { data: validations } = await supabase
            .from("idea_validations")
            .select("id, idea_text, verdict, confidence, report, created_at")
            .eq("user_id", user.id)
            .eq("status", "done")
            .order("created_at", { ascending: false })
            .limit(20);

        if (!validations || validations.length === 0) {
            return NextResponse.json({ section, data: null, message: "No completed validations yet. Run a validation first." });
        }

        // Parse reports
        const parsed = validations.map(v => {
            let report: Record<string, unknown> = {};
            try {
                report = typeof v.report === "string" ? JSON.parse(v.report) : (v.report || {});
            } catch { report = {}; }
            return { ...v, report };
        });

        if (section === "trends") {
            const trends = parsed.map(v => ({
                idea: v.idea_text,
                validation_id: v.id,
                created_at: v.created_at,
                market_timing: (v.report as Record<string, unknown>).market_analysis
                    ? ((v.report as Record<string, Record<string, string>>).market_analysis?.market_timing || "N/A")
                    : "N/A",
                trends_data: (v.report as Record<string, unknown>).trends_data || null,
                pain_frequency: (v.report as Record<string, Record<string, string>>).market_analysis?.pain_frequency || "N/A",
                pain_intensity: (v.report as Record<string, Record<string, string>>).market_analysis?.pain_intensity || "N/A",
                tam_estimate: (v.report as Record<string, Record<string, string>>).market_analysis?.tam_estimate || "N/A",
            }));
            return NextResponse.json({ section, data: trends });
        }

        if (section === "wtp") {
            const wtp = parsed.map(v => {
                const r = v.report as Record<string, unknown>;
                const market = (r.market_analysis || {}) as Record<string, unknown>;
                const pricing = (r.pricing_strategy || {}) as Record<string, unknown>;
                return {
                    idea: v.idea_text,
                    validation_id: v.id,
                    created_at: v.created_at,
                    willingness_to_pay: market.willingness_to_pay || "No signals",
                    price_signals: (pricing as Record<string, unknown>).summary || (pricing as Record<string, unknown>).recommended_model || null,
                    pricing_strategy: pricing,
                    evidence: ((market.evidence || []) as Array<Record<string, unknown>>)
                        .filter((e: Record<string, unknown>) =>
                            String(e.what_it_proves || "").toLowerCase().includes("pay") ||
                            String(e.what_it_proves || "").toLowerCase().includes("price") ||
                            String(e.what_it_proves || "").toLowerCase().includes("budget") ||
                            String(e.what_it_proves || "").toLowerCase().includes("wtp") ||
                            String(e.post_title || "").toLowerCase().includes("pay") ||
                            String(e.post_title || "").toLowerCase().includes("$")
                        ),
                };
            });
            return NextResponse.json({ section, data: wtp });
        }

        if (section === "competitors") {
            const comps = parsed.map(v => {
                const r = v.report as Record<string, unknown>;
                const landscape = (r.competition_landscape || {}) as Record<string, unknown>;
                return {
                    idea: v.idea_text,
                    validation_id: v.id,
                    created_at: v.created_at,
                    direct_competitors: landscape.direct_competitors || [],
                    indirect_competitors: landscape.indirect_competitors || [],
                    market_saturation: landscape.market_saturation || "N/A",
                    unfair_advantage: landscape.your_unfair_advantage || "N/A",
                    moat_strategy: landscape.moat_strategy || "N/A",
                    competition_data: r.competition_data || null,
                };
            });
            return NextResponse.json({ section, data: comps });
        }

        if (section === "sources") {
            const sources = parsed.map(v => {
                const r = v.report as Record<string, unknown>;
                return {
                    idea: v.idea_text,
                    validation_id: v.id,
                    created_at: v.created_at,
                    data_sources: r.data_sources || {},
                    platforms_used: r.platforms_used || 0,
                    models_used: r.models_used || [],
                    debate_mode: r.debate_mode || false,
                    evidence: ((r.market_analysis as Record<string, unknown>)?.evidence || []) as Array<Record<string, unknown>>,
                };
            });
            return NextResponse.json({ section, data: sources });
        }

        // Default: return summary of all sections
        const summary = parsed.map(v => {
            const r = v.report as Record<string, unknown>;
            return {
                idea: v.idea_text,
                validation_id: v.id,
                verdict: v.verdict,
                confidence: v.confidence,
                created_at: v.created_at,
                has_trends: !!(r.trends_data),
                has_competitors: !!(r.competition_landscape),
                has_wtp: !!(r.market_analysis && (r.market_analysis as Record<string, string>).willingness_to_pay),
                has_sources: !!(r.data_sources),
            };
        });
        return NextResponse.json({ section: "all", data: summary });

    } catch (err) {
        console.error("Intelligence API error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
