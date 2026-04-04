import type { User } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";

import { hasAdminOverrideFromAuthUser, normalizeProfileRole, type AdminProfileRole } from "@/lib/admin-access";
import { sanitizeNextPath } from "@/lib/auth-redirect";
import { createAdmin } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

type AdminProfile = {
    id: string;
    email: string;
    plan: string;
    role: AdminProfileRole;
    full_name?: string | null;
};

export type AdminContext = {
    user: User;
    profile: AdminProfile | null;
    role: AdminProfileRole;
    viaFallback: boolean;
};

export async function getAdminContext(): Promise<AdminContext | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
        .from("profiles")
        .select("id, email, plan, role, full_name")
        .eq("id", user.id)
        .maybeSingle();

    const normalizedRole = normalizeProfileRole(profile?.role);
    if (normalizedRole === "admin" || normalizedRole === "moderator") {
        return {
            user,
            profile: profile
                ? {
                    id: String(profile.id),
                    email: String(profile.email || user.email || ""),
                    plan: String(profile.plan || "free"),
                    role: normalizedRole,
                    full_name: profile.full_name ? String(profile.full_name) : null,
                }
                : null,
            role: normalizedRole,
            viaFallback: false,
        };
    }

    const admin = createAdmin();
    const { data: authData } = await admin.auth.admin.getUserById(user.id);
    if (hasAdminOverrideFromAuthUser(authData.user || user)) {
        return {
            user,
            profile: profile
                ? {
                    id: String(profile.id),
                    email: String(profile.email || user.email || ""),
                    plan: String(profile.plan || "free"),
                    role: "admin",
                    full_name: profile.full_name ? String(profile.full_name) : null,
                }
                : null,
            role: "admin",
            viaFallback: true,
        };
    }

    return null;
}

export async function requireAdmin(nextPath = "/admin") {
    const context = await getAdminContext();
    if (!context) {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            redirect(`/login?next=${encodeURIComponent(sanitizeNextPath(nextPath, "/admin"))}`);
        }
        notFound();
    }
    return context;
}
