"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

// ── Founder emergency fallback — DO NOT ADD CUSTOMER EMAILS HERE ──
// These only trigger if the profiles DB query fails entirely.
// To grant premium: update `profiles.plan` to 'pro' or 'enterprise' in Supabase.
const FOUNDER_EMAILS = [
    "youcefneoyoucef@gmail.com",
    "chikhinazim@gmail.com",
    "cheriet.samimhamed@gmail.com",
];

/**
 * Hook that checks the current user's plan from the `profiles` table.
 * Returns `{ isPremium, plan, loading }`.
 *
 * PRIMARY: Reads profiles.plan from Supabase.
 * FALLBACK: Founder email whitelist (only if DB query fails).
 */
export function useUserPlan() {
    const [plan, setPlan] = useState<string>("free");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const supabase = createClient();

        async function fetchPlan() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { setLoading(false); return; }

            // PRIMARY: check profiles.plan from database
            try {
                const { data, error } = await supabase
                    .from("profiles")
                    .select("plan")
                    .eq("id", user.id)
                    .single();

                if (!error && data?.plan) {
                    setPlan(data.plan);
                    setLoading(false);
                    return;
                }
            } catch { /* DB query failed — fall through to founder fallback */ }

            // FALLBACK: founder emails only (when DB is unreachable)
            if (user.email && FOUNDER_EMAILS.includes(user.email.toLowerCase())) {
                setPlan("founder");
            }

            setLoading(false);
        }

        fetchPlan();
    }, []);

    return { isPremium: plan !== "free", plan, loading };
}

