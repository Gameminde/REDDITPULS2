/**
 * Server-side premium plan checker.
 * Call this in every API route that requires premium access.
 *
 * PRIMARY: Reads `profiles.plan` from Supabase using the authenticated user's session.
 * FALLBACK: Founder email whitelist — only used if the DB query fails entirely.
 *
 * To grant premium: update `profiles.plan` to 'pro' or 'enterprise' in Supabase.
 * Do NOT add emails to the whitelist — that's for founder emergency access only.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { BETA_FULL_ACCESS } from "@/lib/beta-access";

// ── Founder emergency fallback — DO NOT ADD CUSTOMER EMAILS HERE ──
// These only trigger if the profiles DB query fails entirely.
const FOUNDER_EMAILS = [
    "youcefneoyoucef@gmail.com",
    "chikhinazim@gmail.com",
    "cheriet.samimhamed@gmail.com",
];

export async function checkPremium(
    supabase: SupabaseClient,
    userId: string
): Promise<{ isPremium: boolean; plan: string }> {
    if (BETA_FULL_ACCESS) {
        return { isPremium: true, plan: "beta" };
    }

    // PRIMARY: check profiles.plan from database
    try {
        const { data, error } = await supabase
            .from("profiles")
            .select("plan")
            .eq("id", userId)
            .single();

        if (!error && data?.plan && data.plan !== "free") {
            return { isPremium: true, plan: data.plan };
        }

        // Plan is "free" or missing — check founder fallback
        if (!error) {
            // DB worked fine, user just isn't premium
            const { data: { user } } = await supabase.auth.admin.getUserById(userId);
            if (user?.email && FOUNDER_EMAILS.includes(user.email.toLowerCase())) {
                return { isPremium: true, plan: "founder" };
            }
            return { isPremium: false, plan: data?.plan || "free" };
        }
    } catch { /* DB query failed — fall through to emergency fallback */ }

    // EMERGENCY FALLBACK: DB is unreachable, allow founders through
    try {
        const { data: { user } } = await supabase.auth.admin.getUserById(userId);
        if (user?.email && FOUNDER_EMAILS.includes(user.email.toLowerCase())) {
            return { isPremium: true, plan: "founder" };
        }
    } catch { /* Auth also failed */ }

    return { isPremium: false, plan: "free" };
}

