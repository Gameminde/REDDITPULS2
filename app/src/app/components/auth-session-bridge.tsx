"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { sanitizeNextPath } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase-browser";

function hasOAuthArtifacts() {
    if (typeof window === "undefined") return false;
    return (
        /(^|[?&])code=/.test(window.location.search)
        || /access_token=/.test(window.location.hash)
        || /refresh_token=/.test(window.location.hash)
        || /type=signup/.test(window.location.hash)
        || /type=invite/.test(window.location.hash)
    );
}

export function AuthSessionBridge() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const supabase = useMemo(() => createClient(), []);
    const handledRef = useRef(false);
    const searchKey = searchParams.toString();

    useEffect(() => {
        handledRef.current = false;
    }, [pathname, searchKey]);

    useEffect(() => {
        let cancelled = false;

        const syncUi = (hasSession: boolean) => {
            if (cancelled || !hasSession || handledRef.current) return;
            handledRef.current = true;

            const nextPath = sanitizeNextPath(searchParams.get("next"), "/dashboard");
            const oauthArtifacts = hasOAuthArtifacts();

            if (pathname === "/login") {
                router.replace(nextPath);
                router.refresh();
                return;
            }

            if (pathname === "/auth/complete") {
                window.location.replace(nextPath === "/login" ? "/dashboard" : nextPath);
                return;
            }

            if (oauthArtifacts) {
                window.location.replace(nextPath === "/login" ? "/dashboard" : nextPath);
                return;
            }

            if (pathname.startsWith("/dashboard")) {
                router.refresh();
            }
        };

        void supabase.auth.getSession().then(({ data }) => {
            syncUi(Boolean(data.session));
        });

        const { data } = supabase.auth.onAuthStateChange((event, session) => {
            if (!session) return;
            if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
                syncUi(true);
            }
        });

        return () => {
            cancelled = true;
            data.subscription.unsubscribe();
        };
    }, [pathname, router, searchKey, searchParams, supabase]);

    return null;
}
