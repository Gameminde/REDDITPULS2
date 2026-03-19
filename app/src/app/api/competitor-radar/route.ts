import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import {
    buildCompetitorWeaknessRadar,
    monitorKeywordsForWeakness,
    WEAKNESS_TAXONOMY,
    type WeaknessCategory,
} from "@/lib/competitor-weakness";
import { buildWhyNowFromWeaknessCluster } from "@/lib/why-now";
import { normalizeArray } from "@/lib/trust";

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

async function requireUser() {
    const supabase = await createServerClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    return user;
}

function isWeaknessCategory(value: string): value is WeaknessCategory {
    return WEAKNESS_TAXONOMY.includes(value as WeaknessCategory);
}

export async function GET(req: NextRequest) {
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const competitorFilter = (req.nextUrl.searchParams.get("competitor") || "").trim();
    const categoryFilter = (req.nextUrl.searchParams.get("category") || "").trim();
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") || 18), 1), 50);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const [{ data: complaints, error: complaintsError }, { data: alerts, error: alertsError }] = await Promise.all([
        supabaseAdmin
            .from("competitor_complaints")
            .select("*")
            .gte("scraped_at", thirtyDaysAgo)
            .order("scraped_at", { ascending: false })
            .limit(400),
        supabaseAdmin
            .from("pain_alerts")
            .select("*")
            .eq("user_id", user.id)
            .eq("is_active", true),
    ]);

    if (complaintsError) {
        return NextResponse.json({ error: complaintsError.message }, { status: 500 });
    }
    if (alertsError) {
        return NextResponse.json({ error: alertsError.message }, { status: 500 });
    }

    const radar = buildCompetitorWeaknessRadar({
        complaints: complaints || [],
        alerts: alerts || [],
        competitorFilter: competitorFilter || undefined,
        categoryFilter: categoryFilter || undefined,
        limit,
    });

    return NextResponse.json({
        ...radar,
        clusters: radar.clusters.map((cluster) => ({
            ...cluster,
            why_now: buildWhyNowFromWeaknessCluster(cluster),
        })),
    });
}

export async function POST(req: NextRequest) {
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const competitor = String(body.competitor || "").trim();
    const category = String(body.category || "").trim();

    if (!competitor) {
        return NextResponse.json({ error: "competitor required" }, { status: 400 });
    }

    if (!isWeaknessCategory(category)) {
        return NextResponse.json({ error: "valid weakness category required" }, { status: 400 });
    }

    const keywords = monitorKeywordsForWeakness(competitor, category);

    const { data: alerts, error: alertsError } = await supabaseAdmin
        .from("pain_alerts")
        .select("id, keywords")
        .eq("user_id", user.id)
        .eq("is_active", true);

    if (alertsError) {
        return NextResponse.json({ error: alertsError.message }, { status: 500 });
    }

    const existing = (alerts || []).find((alert) => {
        const alertKeywords = normalizeArray<string>(alert.keywords).map((value) => value.toLowerCase());
        return alertKeywords.includes(competitor.toLowerCase()) &&
            keywords.some((keyword) => alertKeywords.includes(keyword.toLowerCase()));
    });

    if (existing) {
        return NextResponse.json({
            ok: true,
            existing: true,
            alert_id: existing.id,
            keywords,
        });
    }

    const { data, error } = await supabaseAdmin
        .from("pain_alerts")
        .insert({
            user_id: user.id,
            validation_id: null,
            keywords,
            subreddits: [],
            min_score: Number(body.min_score || 4),
            is_active: true,
        })
        .select("id, created_at")
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        ok: true,
        existing: false,
        alert_id: data.id,
        created_at: data.created_at,
        keywords,
    }, { status: 201 });
}
