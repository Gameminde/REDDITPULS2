"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase-browser";

export function AuthCompleteClient({
    nextPath,
    loginHref,
}: {
    nextPath: string;
    loginHref: string;
}) {
    const supabase = useMemo(() => createClient(), []);
    const [timedOut, setTimedOut] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let redirected = false;

        const finish = () => {
            if (cancelled || redirected) return;
            redirected = true;
            window.location.replace(nextPath);
        };

        const timeout = window.setTimeout(() => {
            if (!redirected) {
                setTimedOut(true);
            }
        }, 4500);

        void supabase.auth.getSession().then(({ data }) => {
            if (data.session) {
                finish();
            }
        });

        const { data } = supabase.auth.onAuthStateChange((event, session) => {
            if (!session) return;
            if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
                finish();
            }
        });

        return () => {
            cancelled = true;
            window.clearTimeout(timeout);
            data.subscription.unsubscribe();
        };
    }, [nextPath, supabase]);

    return (
        <div className="min-h-screen flex items-center justify-center px-6">
            <div className="w-full max-w-md rounded-2xl border border-white/8 bg-black/35 p-8 text-center shadow-2xl backdrop-blur-xl">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-primary">Auth complete</p>
                <h1 className="mt-3 text-2xl font-bold text-white">Finishing your beta session</h1>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                    We are syncing your session and sending you back into the app.
                </p>

                {timedOut ? (
                    <div className="mt-6 space-y-3">
                        <p className="text-sm text-orange-300">
                            The session is taking longer than expected. You can retry the login page safely.
                        </p>
                        <Link
                            href={loginHref}
                            className="inline-flex items-center justify-center rounded-lg border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/15"
                        >
                            Back to login
                        </Link>
                    </div>
                ) : (
                    <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-muted-foreground">
                        <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                        Syncing session
                    </div>
                )}
            </div>
        </div>
    );
}
