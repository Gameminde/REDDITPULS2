/**
 * Server-side premium plan checker.
 * Call this in every API route that requires premium access.
 * Reads `profiles.plan` from Supabase using the authenticated user's session.
 * Whitelisted emails always get premium access.
 */

import { SupabaseClient } from "@supabase/supabase-js";

// ── Whitelisted emails — always premium ──
const PREMIUM_EMAILS = [
    "youcefneoyoucef@gmail.com",
    "chikhinazim@gmail.com",
    "cheriet.samimhamed@gmail.com",
];

export async function checkPremium(
    supabase: SupabaseClient,
    userId: string
): Promise<{ isPremium: boolean; plan: string }> {
    // Check whitelist first (by email)
    const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    if (user?.email && PREMIUM_EMAILS.includes(user.email.toLowerCase())) {
        return { isPremium: true, plan: "lifetime" };
    }

    // Fall back to profiles table
    const { data } = await supabase
        .from("profiles")
        .select("plan")
        .eq("id", userId)
        .single();

    const plan = data?.plan || "free";
    return { isPremium: plan !== "free", plan };
}
