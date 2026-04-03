import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ensureProfileForUser } from "@/lib/ensure-profile";

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get("code");
    const next = searchParams.get("next") ?? "/dashboard";

    // ── SECURITY: Validate redirect target to prevent open redirect ──
    // Must start with /, must not contain // (protocol-relative), must not start with /\
    const isValidRedirect = (path: string): boolean => {
        if (!path.startsWith("/")) return false;
        if (path.startsWith("//")) return false;
        if (path.startsWith("/\\")) return false;
        if (path.includes("://")) return false;
        // Only allow paths starting with /dashboard, /login, or /reset-password
        if (
            !path.startsWith("/dashboard")
            && !path.startsWith("/login")
            && !path.startsWith("/reset-password")
            && path !== "/"
        ) return false;
        return true;
    };

    const safePath = isValidRedirect(next) ? next : "/dashboard";

    if (code) {
        const cookieStore = await cookies();
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll();
                    },
                    setAll(cookiesToSet) {
                        try {
                            cookiesToSet.forEach(({ name, value, options }) =>
                                cookieStore.set(name, value, options)
                            );
                        } catch { }
                    },
                },
            }
        );

        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                try {
                    await ensureProfileForUser(user);
                } catch (profileError) {
                    console.error("OAuth profile sync error:", profileError);
                }
            }
            return NextResponse.redirect(`${origin}${safePath}`);
        }
    }

    return NextResponse.redirect(`${origin}/login`);
}
