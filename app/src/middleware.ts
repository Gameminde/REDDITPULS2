import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessDashboardAsGuest } from "@/lib/beta-access";
import { sanitizeNextPath } from "@/lib/auth-redirect";

export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request });

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value)
                    );
                    supabaseResponse = NextResponse.next({ request });
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    );
                },
            },
        }
    );

    const {
        data: { user },
    } = await supabase.auth.getUser();

    const protectedDashboard =
        request.nextUrl.pathname.startsWith("/dashboard")
        && !canAccessDashboardAsGuest(request.nextUrl.pathname);
    const protectedAdmin = request.nextUrl.pathname.startsWith("/admin");

    // Redirect to login if not authenticated and trying to access dashboard/admin
    if (
        !user
        && (protectedDashboard || protectedAdmin)
    ) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("next", sanitizeNextPath(
            `${request.nextUrl.pathname}${request.nextUrl.search || ""}`,
            protectedAdmin ? "/admin" : "/dashboard",
        ));
        return NextResponse.redirect(url);
    }

    // Redirect authenticated users away from login, honoring any safe next target
    if (user && request.nextUrl.pathname === "/login") {
        const url = request.nextUrl.clone();
        url.pathname = sanitizeNextPath(request.nextUrl.searchParams.get("next"), "/dashboard");
        url.search = "";
        return NextResponse.redirect(url);
    }

    return supabaseResponse;
}

export const config = {
    matcher: ["/dashboard/:path*", "/admin/:path*", "/login"],
};
