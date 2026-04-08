import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { trackServerEvent } from "@/lib/analytics";
import { sanitizeNextPath } from "@/lib/auth-redirect";
import { getAuthCompleteHref, getBetaLoginHref } from "@/lib/beta-access";
import { ensureProfileForUser } from "@/lib/ensure-profile";

type PendingCookie = {
    name: string;
    value: string;
    options?: Record<string, unknown>;
};

function resolvePublicOrigin(request: Request): string {
    const requestUrl = new URL(request.url);
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const forwardedHost = request.headers.get("x-forwarded-host");
    const host = forwardedHost || request.headers.get("host");
    const envOrigin = (
        process.env.NEXT_PUBLIC_SITE_URL
        || process.env.SITE_URL
        || ""
    ).replace(/\/+$/, "");

    if (host && !/^0\.0\.0\.0(?::\d+)?$/i.test(host) && !/^localhost(?::\d+)?$/i.test(host)) {
        const protocol = forwardedProto || requestUrl.protocol.replace(":", "") || "http";
        return `${protocol}://${host}`;
    }

    if (envOrigin && !/localhost|0\.0\.0\.0/i.test(envOrigin)) {
        return envOrigin;
    }

    if (envOrigin) {
        return envOrigin;
    }

    return requestUrl.origin;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const origin = resolvePublicOrigin(request);
    const code = searchParams.get("code");
    const safePath = sanitizeNextPath(searchParams.get("next"), "/dashboard");
    const pendingCookies: PendingCookie[] = [];

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
                            cookiesToSet.forEach(({ name, value, options }) => {
                                pendingCookies.push({ name, value, options });
                                cookieStore.set(name, value, options);
                            });
                        } catch {}
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

                await trackServerEvent(request, {
                    eventName: "google_oauth_success",
                    scope: "auth",
                    userId: user.id,
                    route: safePath,
                    properties: {
                        provider: "google",
                        redirect_to: safePath,
                    },
                });

                await trackServerEvent(request, {
                    eventName: "login_success",
                    scope: "auth",
                    userId: user.id,
                    route: safePath,
                    properties: {
                        method: "oauth_google",
                    },
                });
            }

            const response = NextResponse.redirect(`${origin}${getAuthCompleteHref(safePath)}`);
            pendingCookies.forEach(({ name, value, options }) => {
                response.cookies.set(name, value, options);
            });
            return response;
        }
    }

    return NextResponse.redirect(`${origin}${getBetaLoginHref(safePath)}`);
}
