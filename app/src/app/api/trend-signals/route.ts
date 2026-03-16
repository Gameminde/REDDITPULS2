import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase-server";

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function GET() {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [{ data, error }, { data: validations }] = await Promise.all([
        supabaseAdmin
            .from("trend_signals")
            .select("*")
            .order("change_24h", { ascending: false })
            .limit(50),
        supabaseAdmin
            .from("idea_validations")
            .select("report")
            .eq("user_id", user.id)
            .eq("status", "done")
            .order("created_at", { ascending: false })
            .limit(1),
    ]);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const latestReport = validations?.[0]?.report;
    const parsedReport =
        typeof latestReport === "string"
            ? JSON.parse(latestReport)
            : (latestReport || {});
    const platformWarnings = parsedReport?.data_quality?.platform_warnings || parsedReport?.platform_warnings || [];

    return NextResponse.json({
        trends: data || [],
        platform_warnings: platformWarnings,
    });
}
