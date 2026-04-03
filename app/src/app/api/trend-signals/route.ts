import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { buildOpportunityTrust, normalizeSources } from "@/lib/trust";

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type TrendTier = "EXPLODING" | "GROWING" | "STABLE" | "DECLINING";

interface PlatformWarning {
    platform: string;
    issue: string;
    status?: string;
    error_code?: string | null;
    error_detail?: string | null;
}

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

function normalizePosts(value: unknown) {
    const parsed = safeParseJson(value);
    return Array.isArray(parsed) ? parsed : [];
}

function estimatePostCount24h(row: Record<string, unknown>) {
    const direct = Number(row.post_count_24h || 0);
    if (direct > 0) return direct;

    const sevenDay = Number(row.post_count_7d || 0);
    if (sevenDay <= 0) return 0;
    return Math.max(1, Math.round(sevenDay / 7));
}

function estimateTrendVelocity(postCount24h: number, postCount7d: number) {
    const priorSixDays = Math.max(postCount7d - postCount24h, 0);
    const baseline = priorSixDays > 0 ? priorSixDays / 6 : Math.max(postCount24h / 2, 1);
    return Number((postCount24h / Math.max(baseline, 1)).toFixed(1));
}

function estimateTrendChange24h(postCount24h: number, postCount7d: number) {
    const priorSixDays = Math.max(postCount7d - postCount24h, 0);
    const baseline = priorSixDays > 0 ? priorSixDays / 6 : Math.max(postCount24h / 2, 1);
    return Number((((postCount24h - baseline) / Math.max(baseline, 1)) * 100).toFixed(1));
}

function isFreshIdea(row: Record<string, unknown>, maxAgeHours = 48) {
    const lastUpdated = String(row.last_updated || "");
    if (!lastUpdated) return false;

    const updatedAt = Date.parse(lastUpdated);
    if (Number.isNaN(updatedAt)) return false;

    return Date.now() - updatedAt <= maxAgeHours * 60 * 60 * 1000;
}

function classifyTrend(sourceCount: number, postCount24h: number, postCount7d: number, velocity: number, change24h: number): TrendTier | null {
    if (postCount7d < 8 && postCount24h < 3) return null;
    if (sourceCount < 2 && postCount7d < 12 && postCount24h < 4) return null;

    if (postCount24h >= 12 && velocity >= 1.5) {
        return "EXPLODING";
    }
    if (postCount24h >= 5 && velocity >= 1.15) {
        return "GROWING";
    }
    if (change24h <= -20 && postCount7d >= 12) {
        return "DECLINING";
    }
    if (postCount7d >= 12 && postCount24h >= 2) {
        return "STABLE";
    }

    return null;
}

function tierWeight(tier: TrendTier) {
    switch (tier) {
        case "EXPLODING":
            return 4;
        case "GROWING":
            return 3;
        case "STABLE":
            return 2;
        case "DECLINING":
            return 1;
        default:
            return 0;
    }
}

export async function GET() {
    const supabase = await createServerClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    const [{ data, error }, { data: validations }] = await Promise.all([
        supabaseAdmin
            .from("ideas")
            .select("*")
            .neq("confidence_level", "INSUFFICIENT")
            .order("last_updated", { ascending: false })
            .limit(300),
        user?.id
            ? supabaseAdmin
                .from("idea_validations")
                .select("report")
                .eq("user_id", user.id)
                .eq("status", "done")
                .order("created_at", { ascending: false })
                .limit(1)
            : Promise.resolve({ data: [], error: null as { message?: string } | null }),
    ]);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const latestReport = validations?.[0]?.report;
    const parsedReport = typeof latestReport === "string" ? JSON.parse(latestReport) : latestReport || {};
    const platformWarnings = (parsedReport?.data_quality?.platform_warnings ||
        parsedReport?.platform_warnings ||
        []) as PlatformWarning[];

    const trends = (data || [])
        .filter((row: Record<string, unknown>) => isFreshIdea(row))
        .map((row: Record<string, unknown>) => {
            const sources = normalizeSources(row.sources);
            const sourceCount = Number(row.source_count || sources.length || 0);
            const postCount24h = estimatePostCount24h(row);
            const postCount7d = Number(row.post_count_7d || 0);
            const derivedChange24h = estimateTrendChange24h(postCount24h, postCount7d);
            const velocity = estimateTrendVelocity(postCount24h, postCount7d);
            const tier = classifyTrend(sourceCount, postCount24h, postCount7d, velocity, derivedChange24h);

            if (!tier) {
                return null;
            }

            const trustRow = {
                ...row,
                source_count: sourceCount,
                post_count_24h: postCount24h,
                post_count_7d: postCount7d,
                sources,
                top_posts: normalizePosts(row.top_posts),
            };

            return {
                id: String(row.id || row.slug || row.topic),
                slug: String(row.slug || ""),
                topic: String(row.topic || "Unknown theme"),
                category: String(row.category || "general"),
                tier,
                current_score: Number(row.current_score || 0),
                change_24h: derivedChange24h,
                change_7d: Number(row.change_7d || 0),
                post_count_24h: postCount24h,
                post_count_7d: postCount7d,
                post_count_total: Number(row.post_count_total || 0),
                source_count: sourceCount,
                sources,
                confidence_level: String(row.confidence_level || "UNKNOWN"),
                pain_count: Number(row.pain_count || 0),
                pain_summary: String(row.pain_summary || ""),
                top_posts: trustRow.top_posts,
                last_updated: String(row.last_updated || ""),
                trust: buildOpportunityTrust(trustRow),
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (!a || !b) return 0;
            return (
                tierWeight(b.tier) - tierWeight(a.tier) ||
                b.post_count_24h - a.post_count_24h ||
                b.change_24h - a.change_24h ||
                b.current_score - a.current_score
            );
        })
        .slice(0, 24);

    return NextResponse.json({
        trends,
        platform_warnings: platformWarnings,
        source: "ideas",
    });
}
