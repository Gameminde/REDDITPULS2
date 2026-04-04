import { createHash, randomUUID } from "node:crypto";

import { createAdmin } from "@/lib/supabase-admin";

export type AnalyticsScope = "marketing" | "auth" | "product" | "admin";

export type AnalyticsEventInput = {
    eventName: string;
    scope: AnalyticsScope;
    route?: string | null;
    userId?: string | null;
    sessionId?: string | null;
    anonymousId?: string | null;
    referrer?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    deviceType?: string | null;
    countryCode?: string | null;
    ipHash?: string | null;
    properties?: Record<string, unknown> | null;
};

type ServerAnalyticsEventInput = Omit<AnalyticsEventInput, "route" | "referrer" | "utmSource" | "utmMedium" | "utmCampaign" | "utmContent" | "utmTerm" | "deviceType" | "countryCode" | "ipHash" | "anonymousId" | "sessionId"> & {
    request?: Request | null;
    route?: string | null;
    referrer?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
    deviceType?: string | null;
    countryCode?: string | null;
    ipHash?: string | null;
    anonymousId?: string | null;
    sessionId?: string | null;
};

export const ANALYTICS_ANON_COOKIE = "cueidea_anon";
export const ANALYTICS_SESSION_COOKIE = "cueidea_sess";

function isMissingAnalyticsStorageError(error: { code?: string | null; message?: string | null } | null | undefined) {
    const code = String(error?.code || "").trim().toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    return code === "PGRST205"
        || message.includes("relation")
        || message.includes("does not exist")
        || message.includes("could not find the table");
}

function normalizeText(value: unknown) {
    const text = String(value || "").trim();
    return text ? text.slice(0, 500) : null;
}

function parseCookieHeader(cookieHeader: string | null) {
    const entries = new Map<string, string>();
    for (const part of String(cookieHeader || "").split(";")) {
        const [rawName, ...rest] = part.split("=");
        const name = rawName?.trim();
        if (!name) continue;
        entries.set(name, rest.join("=").trim());
    }
    return entries;
}

export function classifyDeviceType(userAgent: string | null | undefined) {
    const ua = String(userAgent || "").toLowerCase();
    if (!ua) return "unknown";
    if (/(bot|crawler|spider|preview)/i.test(ua)) return "bot";
    if (/(tablet|ipad)/i.test(ua)) return "tablet";
    if (/(mobi|iphone|android)/i.test(ua)) return "mobile";
    return "desktop";
}

export function hashIpAddress(ip: string | null | undefined) {
    const value = String(ip || "").trim();
    if (!value) return null;
    return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function extractClientIp(request: Request) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
        return forwarded.split(",")[0]?.trim() || null;
    }
    return request.headers.get("x-real-ip") || null;
}

export function getAnalyticsIdsFromRequest(request: Request) {
    const cookieMap = parseCookieHeader(request.headers.get("cookie"));
    return {
        anonymousId: normalizeText(cookieMap.get(ANALYTICS_ANON_COOKIE)) || null,
        sessionId: normalizeText(cookieMap.get(ANALYTICS_SESSION_COOKIE)) || null,
    };
}

export function buildAnalyticsContextFromRequest(request: Request) {
    const url = new URL(request.url);
    const { anonymousId, sessionId } = getAnalyticsIdsFromRequest(request);

    return {
        route: `${url.pathname}${url.search || ""}`,
        referrer: normalizeText(request.headers.get("referer")),
        utmSource: normalizeText(url.searchParams.get("utm_source")),
        utmMedium: normalizeText(url.searchParams.get("utm_medium")),
        utmCampaign: normalizeText(url.searchParams.get("utm_campaign")),
        utmContent: normalizeText(url.searchParams.get("utm_content")),
        utmTerm: normalizeText(url.searchParams.get("utm_term")),
        deviceType: classifyDeviceType(request.headers.get("user-agent")),
        ipHash: hashIpAddress(extractClientIp(request)),
        anonymousId: anonymousId || randomUUID(),
        sessionId: sessionId || randomUUID(),
        countryCode: normalizeText(request.headers.get("x-vercel-ip-country") || request.headers.get("cf-ipcountry")),
    };
}

export async function insertAnalyticsEvent(
    requestOrInput: Request | AnalyticsEventInput,
    maybeInput?: AnalyticsEventInput,
) {
    const derived = requestOrInput instanceof Request ? buildAnalyticsContextFromRequest(requestOrInput) : null;
    const input = requestOrInput instanceof Request ? (maybeInput as AnalyticsEventInput) : requestOrInput;
    const admin = createAdmin();
    const payload = {
        event_name: input.eventName,
        scope: input.scope,
        route: normalizeText(input.route || derived?.route),
        user_id: input.userId || null,
        session_id: normalizeText(input.sessionId || derived?.sessionId),
        anonymous_id: normalizeText(input.anonymousId || derived?.anonymousId),
        referrer: normalizeText(input.referrer || derived?.referrer),
        utm_source: normalizeText(input.utmSource || derived?.utmSource),
        utm_medium: normalizeText(input.utmMedium || derived?.utmMedium),
        utm_campaign: normalizeText(input.utmCampaign || derived?.utmCampaign),
        utm_content: normalizeText(input.utmContent || derived?.utmContent),
        utm_term: normalizeText(input.utmTerm || derived?.utmTerm),
        device_type: normalizeText(input.deviceType || derived?.deviceType),
        country_code: normalizeText(input.countryCode || derived?.countryCode),
        ip_hash: normalizeText(input.ipHash || derived?.ipHash),
        properties: input.properties || {},
    };

    const { error } = await admin.from("analytics_events").insert(payload);
    if (error) {
        if (isMissingAnalyticsStorageError(error)) {
            return false;
        }
        throw error;
    }

    return true;
}

export async function trackServerEvent(
    requestOrInput: Request | ServerAnalyticsEventInput,
    maybeInput?: ServerAnalyticsEventInput,
) {
    const input: ServerAnalyticsEventInput = requestOrInput instanceof Request
        ? {
            ...(maybeInput || { eventName: "unknown_event", scope: "admin" }),
            request: requestOrInput,
        }
        : requestOrInput;
    const derived = input.request ? buildAnalyticsContextFromRequest(input.request) : null;

    await insertAnalyticsEvent({
        eventName: input.eventName,
        scope: input.scope,
        userId: input.userId || null,
        route: input.route || derived?.route || null,
        referrer: input.referrer || derived?.referrer || null,
        utmSource: input.utmSource || derived?.utmSource || null,
        utmMedium: input.utmMedium || derived?.utmMedium || null,
        utmCampaign: input.utmCampaign || derived?.utmCampaign || null,
        utmContent: input.utmContent || derived?.utmContent || null,
        utmTerm: input.utmTerm || derived?.utmTerm || null,
        deviceType: input.deviceType || derived?.deviceType || null,
        countryCode: input.countryCode || derived?.countryCode || null,
        ipHash: input.ipHash || derived?.ipHash || null,
        anonymousId: input.anonymousId || derived?.anonymousId || null,
        sessionId: input.sessionId || derived?.sessionId || null,
        properties: input.properties || {},
    });
}
