import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { buildEnrichedValidationView } from "@/lib/validation-insights";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ jobId: string }> },
) {
    try {
        const { jobId } = await params;
        const cookieStore = await cookies();
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const publishableKey =
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

        const supabase = createServerClient(supabaseUrl, publishableKey, {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll() {
                    // Read-only in route handlers.
                },
            },
        });

        const { data: { user } } = await supabase.auth.getUser();
        let query = supabase.from("idea_validations").select("*").eq("id", jobId);

        if (user?.id) {
            query = query.eq("user_id", user.id);
        }

        const { data: validation, error } = await query.single();

        if (error || !validation) {
            console.error(`[Validate Poll] 404 id=${jobId} user=${user?.id ?? "no-session"}: ${error?.code} ${error?.message}`);
            return NextResponse.json({ error: "Validation not found" }, { status: 404 });
        }

        const enriched = await buildEnrichedValidationView(validation, user?.id || null);

        return NextResponse.json({
            validation: {
                ...enriched,
            },
        });
    } catch (error) {
        console.error("Validate GET [jobId] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
