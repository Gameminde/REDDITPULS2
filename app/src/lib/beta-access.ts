const PUBLIC_DASHBOARD_EXACT_PATHS = new Set([
    "/dashboard",
]);

const PUBLIC_DASHBOARD_PREFIXES = [
    "/dashboard/explore",
    "/dashboard/trends",
    "/dashboard/pricing",
    "/dashboard/how-it-works",
    "/dashboard/idea",
] as const;

function normalizePathname(pathname: string) {
    if (!pathname) return "/";
    if (pathname.length > 1) {
        return pathname.replace(/\/+$/, "") || "/";
    }
    return pathname;
}

export const BETA_OPEN = process.env.NEXT_PUBLIC_BETA_OPEN === "true";
export const BETA_FULL_ACCESS = process.env.NEXT_PUBLIC_BETA_FULL_ACCESS === "true";

export function isPublicDashboardPath(pathname: string) {
    const normalized = normalizePathname(pathname);
    if (PUBLIC_DASHBOARD_EXACT_PATHS.has(normalized)) {
        return true;
    }
    return PUBLIC_DASHBOARD_PREFIXES.some((prefix) => (
        normalized === prefix || normalized.startsWith(`${prefix}/`)
    ));
}

export function canAccessDashboardAsGuest(pathname: string) {
    return BETA_OPEN && isPublicDashboardPath(pathname);
}
