export function sanitizeNextPath(path: string | null | undefined, fallback = "/dashboard") {
    const value = String(path || "").trim();
    if (!value) return fallback;
    if (!value.startsWith("/")) return fallback;
    if (value.startsWith("//")) return fallback;
    if (value.startsWith("/\\")) return fallback;
    if (value.includes("://")) return fallback;

    const allowedPrefixes = [
        "/",
        "/dashboard",
        "/admin",
        "/login",
        "/reset-password",
    ];

    if (!allowedPrefixes.some((prefix) => value === prefix || value.startsWith(`${prefix}/`) || (prefix === "/" && value === "/"))) {
        return fallback;
    }

    return value;
}

