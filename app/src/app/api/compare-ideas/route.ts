import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { buildIdeasComparisonForFounder } from "@/lib/compare-ideas";
import { buildEnrichedValidationView, type ValidationRowLike } from "@/lib/validation-insights";

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function parseIds(value: string | null) {
    return [...new Set(
        String(value || "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
    )].slice(0, 4);
}

function founderProfileFromSearchParams(searchParams: URLSearchParams) {
    return {
        technical_level: searchParams.get("technical_level"),
        domain_familiarity: searchParams.get("domain_familiarity"),
        sales_gtm_strength: searchParams.get("sales_gtm_strength"),
        preferred_gtm_motion: searchParams.get("preferred_gtm_motion"),
        available_time: searchParams.get("available_time"),
        budget_tolerance: searchParams.get("budget_tolerance"),
        team_mode: searchParams.get("team_mode"),
        complexity_appetite: searchParams.get("complexity_appetite"),
    };
}

export async function GET(req: NextRequest) {
    const supabase = await createServerClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ids = parseIds(req.nextUrl.searchParams.get("ids"));
    if (ids.length < 2) {
        return NextResponse.json({ error: "Pick between 2 and 4 validations to compare." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from("idea_validations")
        .select("id, idea_text, verdict, confidence, status, posts_analyzed, created_at, completed_at, report")
        .eq("user_id", user.id)
        .in("id", ids)
        .eq("status", "done");

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length < 2) {
        return NextResponse.json({ error: "Not enough completed validations were found for comparison." }, { status: 400 });
    }

    const order = new Map(ids.map((id, index) => [id, index]));
    const enriched = await Promise.all(
        [...data]
            .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
            .map((row) => buildEnrichedValidationView(row as ValidationRowLike, user.id)),
    );

    return NextResponse.json({
        comparison: buildIdeasComparisonForFounder(
            enriched,
            founderProfileFromSearchParams(req.nextUrl.searchParams),
        ),
    });
}
