import type { User } from "@supabase/supabase-js";

import { createAdmin } from "@/lib/supabase-admin";

function deriveDisplayName(user: User): string {
    const metadata = user.user_metadata ?? {};
    const candidates = [
        metadata.full_name,
        metadata.name,
        metadata.user_name,
        metadata.preferred_username,
        user.email?.split("@")[0],
        "user",
    ];

    for (const value of candidates) {
        const text = String(value || "").trim();
        if (text) {
            return text.slice(0, 120);
        }
    }

    return "user";
}

export async function ensureProfileForUser(user: User) {
    const admin = createAdmin();

    const payload = {
        id: user.id,
        email: user.email || "",
        full_name: deriveDisplayName(user),
        plan: "free",
    };

    const { error } = await admin
        .from("profiles")
        .upsert(payload, { onConflict: "id" });

    if (error) {
        throw error;
    }
}
