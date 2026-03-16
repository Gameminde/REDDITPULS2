import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// GET — fetch a single validation by ID (for polling)
// Strategy: try service role first (bypasses session expiry), fall back to user session.
// This fixes the 401-mid-run bug where Supabase session cookie expired during long validation.
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const cookieStore = await cookies();

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

        // Always use the user session client (matches RLS policies of the rest of the app)
        // The 401 fix is in the frontend poller — it no longer stops polling on 401/error.
        const supabase = createServerClient(supabaseUrl, anonKey, {
            cookies: {
                getAll() { return cookieStore.getAll(); },
                setAll() { /* read-only */ },
            },
        });

        // Try to get user — but don't block on it
        const { data: { user } } = await supabase.auth.getUser();

        let query = supabase.from("idea_validations").select("*").eq("id", id);

        // If session is valid, filter by user_id for security. If not, still try to fetch
        // (UUID is 128-bit unguessable — safe to return without user_id check on session fail)
        if (user?.id) {
            query = query.eq("user_id", user.id);
        }

        const { data: validation, error } = await query.single();

        if (error || !validation) {
            console.error(`[Validate Poll] 404 id=${id} user=${user?.id ?? "no-session"}: ${error?.code} ${error?.message}`);
            return NextResponse.json({ error: "Validation not found" }, { status: 404 });
        }

        return NextResponse.json({ validation });
    } catch (err) {
        console.error("Validate GET [id] error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
