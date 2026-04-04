import type { User } from "@supabase/supabase-js";

export type AdminProfileRole = "user" | "moderator" | "admin";

export const FOUNDER_EMAILS = [
    "youcefneoyoucef@gmail.com",
    "chikhinazim@gmail.com",
    "cheriet.samimhamed@gmail.com",
];

export function normalizeProfileRole(value: unknown): AdminProfileRole {
    const normalized = String(value || "").toLowerCase();
    if (normalized === "admin" || normalized === "moderator") {
        return normalized;
    }
    return "user";
}

export function isPrivilegedRole(value: unknown) {
    const role = normalizeProfileRole(value);
    return role === "admin" || role === "moderator";
}

export function hasAdminOverrideFromAuthUser(
    user: Pick<User, "email" | "app_metadata" | "user_metadata"> | null | undefined,
) {
    if (!user) return false;

    const email = String(user.email || "").toLowerCase();
    if (email && FOUNDER_EMAILS.includes(email)) {
        return true;
    }

    const appMetadata = user.app_metadata || {};
    const userMetadata = user.user_metadata || {};

    return (
        appMetadata.admin === true
        || appMetadata.founder === true
        || appMetadata.role === "admin"
        || userMetadata.is_admin === true
        || userMetadata.is_founder === true
        || userMetadata.app_role === "admin"
    );
}

