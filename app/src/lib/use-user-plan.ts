"use client";

import { useEffect, useState } from "react";

import { hasAdminOverrideFromAuthUser, normalizeProfileRole } from "@/lib/admin-access";
import { BETA_FULL_ACCESS } from "@/lib/beta-access";
import { createClient } from "@/lib/supabase-browser";

/**
 * Hook that checks the current user's plan from the `profiles` table.
 * Returns `{ isPremium, isAdmin, plan, loading }`.
 *
 * PRIMARY: Reads profiles.plan + profiles.role from Supabase.
 * FALLBACK: founder/admin metadata override if the DB lookup fails.
 */
export function useUserPlan() {
    const [plan, setPlan] = useState<string>("free");
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const supabase = createClient();

        async function fetchPlan() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                setLoading(false);
                return;
            }

            if (hasAdminOverrideFromAuthUser(user)) {
                setIsAdmin(true);
            }

            if (BETA_FULL_ACCESS) {
                setPlan("beta");
                setLoading(false);
                return;
            }

            try {
                const { data, error } = await supabase
                    .from("profiles")
                    .select("plan, role")
                    .eq("id", user.id)
                    .single();

                if (!error && data) {
                    if (data.plan) {
                        setPlan(data.plan);
                    }
                    if (normalizeProfileRole(data.role) !== "user") {
                        setIsAdmin(true);
                    }
                    setLoading(false);
                    return;
                }
            } catch {
                // DB lookup failed; fall back to auth metadata below.
            }

            if (hasAdminOverrideFromAuthUser(user)) {
                setPlan("founder");
                setIsAdmin(true);
            }

            setLoading(false);
        }

        fetchPlan();
    }, []);

    return { isPremium: plan !== "free", isAdmin, plan, loading };
}
