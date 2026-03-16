"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

// ── Whitelisted emails — always premium ──
const PREMIUM_EMAILS = [
    "youcefneoyoucef@gmail.com",
    "chikhinazim@gmail.com",
    "cheriet.samimhamed@gmail.com",
];

/**
 * Hook that checks the current user's plan from the `profiles` table.
 * Returns `{ isPremium, plan, loading }`.
 *
 * Premium means plan !== "free".
 * Whitelisted emails always get premium.
 */
export function useUserPlan() {
    const [plan, setPlan] = useState<string>("free");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const supabase = createClient();

        async function fetchPlan() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { setLoading(false); return; }

            // Whitelist check
            if (user.email && PREMIUM_EMAILS.includes(user.email.toLowerCase())) {
                setPlan("lifetime");
                setLoading(false);
                return;
            }

            const { data } = await supabase
                .from("profiles")
                .select("plan")
                .eq("id", user.id)
                .single();

            if (data?.plan) setPlan(data.plan);
            setLoading(false);
        }

        fetchPlan();
    }, []);

    return { isPremium: plan !== "free", plan, loading };
}

