"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { ANALYTICS_ANON_COOKIE, ANALYTICS_SESSION_COOKIE, type AnalyticsScope } from "@/lib/analytics";

const ONE_YEAR = 60 * 60 * 24 * 365;

function randomId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readCookie(name: string) {
    if (typeof document === "undefined") return null;
    const match = document.cookie
        .split("; ")
        .find((entry) => entry.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

function writeCookie(name: string, value: string, maxAge = ONE_YEAR) {
    if (typeof document === "undefined") return;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function ensureAnalyticsIds() {
    if (typeof window === "undefined") {
        return { anonymousId: "", sessionId: "" };
    }

    let anonymousId = window.localStorage.getItem(ANALYTICS_ANON_COOKIE) || readCookie(ANALYTICS_ANON_COOKIE) || "";
    let sessionId = window.sessionStorage.getItem(ANALYTICS_SESSION_COOKIE) || readCookie(ANALYTICS_SESSION_COOKIE) || "";

    if (!anonymousId) {
        anonymousId = randomId();
        window.localStorage.setItem(ANALYTICS_ANON_COOKIE, anonymousId);
    }
    if (!sessionId) {
        sessionId = randomId();
        window.sessionStorage.setItem(ANALYTICS_SESSION_COOKIE, sessionId);
    }

    writeCookie(ANALYTICS_ANON_COOKIE, anonymousId, ONE_YEAR);
    writeCookie(ANALYTICS_SESSION_COOKIE, sessionId, 60 * 60 * 12);

    return { anonymousId, sessionId };
}

export async function trackClientEvent(
    eventName: string,
    scope: AnalyticsScope,
    properties: Record<string, unknown> = {},
    route = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/",
) {
    if (typeof window === "undefined") return;
    const { anonymousId, sessionId } = ensureAnalyticsIds();

    try {
        await fetch("/api/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
                event_name: eventName,
                scope,
                route,
                anonymous_id: anonymousId,
                session_id: sessionId,
                referrer: document.referrer || null,
                properties,
            }),
        });
    } catch {
        // best effort only
    }
}

export function AnalyticsTracker() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const lastPageviewRef = useRef<string>("");

    useEffect(() => {
        ensureAnalyticsIds();
    }, []);

    useEffect(() => {
        if (!pathname) return;
        const route = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;
        if (lastPageviewRef.current === route) return;
        lastPageviewRef.current = route;

        const scope: AnalyticsScope = pathname.startsWith("/admin")
            ? "admin"
            : pathname.startsWith("/dashboard")
                ? "product"
                : pathname.startsWith("/login") || pathname.startsWith("/reset-password")
                    ? "auth"
                    : "marketing";

        void trackClientEvent("page_view", scope, {}, route);
    }, [pathname, searchParams]);

    useEffect(() => {
        const handler = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            const tracked = target?.closest<HTMLElement>("[data-track-event]");
            if (!tracked) return;

            const eventName = tracked.dataset.trackEvent;
            if (!eventName) return;

            const scope = (tracked.dataset.trackScope as AnalyticsScope | undefined) || "marketing";
            const label = tracked.dataset.trackLabel || tracked.textContent?.trim() || null;
            const href = tracked instanceof HTMLAnchorElement ? tracked.href : tracked.getAttribute("href");
            void trackClientEvent(eventName, scope, {
                label,
                href,
            });
        };

        document.addEventListener("click", handler);
        return () => document.removeEventListener("click", handler);
    }, []);

    return null;
}
