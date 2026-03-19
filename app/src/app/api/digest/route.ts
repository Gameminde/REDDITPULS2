import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";
import { buildMonitorFeed, supabaseAdmin } from "@/lib/monitor-feed";

const CACHE_TABLE = "morning_brief_cache";
const CACHE_TTL_MS = 60 * 60 * 1000;

function safeParseDate(value: unknown) {
    if (!value) return null;
    const parsed = Date.parse(String(value));
    if (Number.isNaN(parsed)) return null;
    return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeBrief(raw: unknown) {
    if (!isRecord(raw)) return null;

    const looksLikeMonitorBrief =
        "monitor_mix" in raw ||
        "recommended_actions" in raw ||
        "stale_monitors" in raw;

    if (!looksLikeMonitorBrief) {
        return null;
    }

    const monitorMix = isRecord(raw.monitor_mix) ? raw.monitor_mix : {};
    const strongestMonitor = isRecord(raw.strongest_monitor) ? raw.strongest_monitor : null;
    const topEvent = isRecord(raw.top_event) ? raw.top_event : null;
    const changedMonitors = Array.isArray(raw.changed_monitors) ? raw.changed_monitors.filter(isRecord) : [];

    return {
        date: typeof raw.date === "string" ? raw.date : "",
        total_monitors: typeof raw.total_monitors === "number" ? raw.total_monitors : 0,
        active_changes: typeof raw.active_changes === "number" ? raw.active_changes : 0,
        unread_updates: typeof raw.unread_updates === "number" ? raw.unread_updates : 0,
        strongest_monitor: strongestMonitor ? {
            title: typeof strongestMonitor.title === "string" ? strongestMonitor.title : "",
            type: typeof strongestMonitor.type === "string" ? strongestMonitor.type : "Opportunity",
            trust_score: typeof strongestMonitor.trust_score === "number" ? strongestMonitor.trust_score : 0,
            summary: typeof strongestMonitor.summary === "string" ? strongestMonitor.summary : "",
            href: typeof strongestMonitor.href === "string" ? strongestMonitor.href : "/dashboard/saved",
        } : null,
        top_event: topEvent ? {
            summary: typeof topEvent.summary === "string" ? topEvent.summary : "",
            impact_level: typeof topEvent.impact_level === "string" ? topEvent.impact_level : "LOW",
            source_label: typeof topEvent.source_label === "string" ? topEvent.source_label : "",
            href: typeof topEvent.href === "string" ? topEvent.href : "/dashboard/saved",
        } : null,
        monitor_mix: {
            validation: typeof monitorMix.validation === "number" ? monitorMix.validation : 0,
            opportunity: typeof monitorMix.opportunity === "number" ? monitorMix.opportunity : 0,
            pain_theme: typeof monitorMix.pain_theme === "number" ? monitorMix.pain_theme : 0,
        },
        recommended_actions: Array.isArray(raw.recommended_actions)
            ? raw.recommended_actions.filter((value): value is string => typeof value === "string")
            : [],
        changed_monitors: changedMonitors.map((monitor) => ({
            title: typeof monitor.title === "string" ? monitor.title : "Monitor",
            delta_summary: typeof monitor.delta_summary === "string" ? monitor.delta_summary : "",
            direction: typeof monitor.direction === "string" ? monitor.direction : "steady",
            href: typeof monitor.href === "string" ? monitor.href : "/dashboard/saved",
        })),
        stale_monitors: Array.isArray(raw.stale_monitors)
            ? raw.stale_monitors
                .filter(isRecord)
                .map((monitor) => ({
                    title: typeof monitor.title === "string" ? monitor.title : "Monitor",
                    type: typeof monitor.type === "string" ? monitor.type : "Opportunity",
                    days_since_check: typeof monitor.days_since_check === "number" ? monitor.days_since_check : 0,
                    href: typeof monitor.href === "string" ? monitor.href : "/dashboard/saved",
                }))
            : [],
    };
}

function normalizeTimeline(raw: unknown) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(isRecord)
        .map((item) => {
            const action = isRecord(item.action) ? item.action : {};
            return {
                bucket: typeof item.bucket === "string" ? item.bucket : "Recent",
                time: typeof item.time === "string" ? item.time : null,
                icon: typeof item.icon === "string" ? item.icon : "trend",
                description: typeof item.description === "string" ? item.description : "",
                action: {
                    href: typeof action.href === "string" ? action.href : "/dashboard/saved",
                    label: typeof action.label === "string" ? action.label : "Open",
                },
                source_label: typeof item.source_label === "string" ? item.source_label : undefined,
                impact_level: typeof item.impact_level === "string" ? item.impact_level : undefined,
            };
        });
}

async function loadCache(userId: string) {
    const { data, error } = await supabaseAdmin
        .from(CACHE_TABLE)
        .select("brief, timeline, generated_at")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) {
        const message = String(error.message || "").toLowerCase();
        if (message.includes(CACHE_TABLE) || message.includes("relation") || message.includes("does not exist")) {
            return { supported: false as const, payload: null };
        }
        throw error;
    }

    if (!data) return { supported: true as const, payload: null };
    const generatedAt = safeParseDate(data.generated_at);
    if (!generatedAt || Date.now() - generatedAt > CACHE_TTL_MS) {
        return { supported: true as const, payload: null };
    }

    const brief = normalizeBrief(data.brief);
    if (!brief) {
        return { supported: true as const, payload: null };
    }

    return {
        supported: true as const,
        payload: {
            brief,
            timeline: normalizeTimeline(data.timeline),
            cached: true,
            generated_at: new Date(generatedAt).toISOString(),
        },
    };
}

async function saveCache(userId: string, payload: { brief: unknown; timeline: unknown[]; generated_at: string }) {
    const { error } = await supabaseAdmin
        .from(CACHE_TABLE)
        .upsert({
            user_id: userId,
            brief: payload.brief || {},
            timeline: payload.timeline || [],
            generated_at: payload.generated_at,
        }, { onConflict: "user_id" });

    if (error) {
        const message = String(error.message || "").toLowerCase();
        if (!message.includes(CACHE_TABLE) && !message.includes("relation") && !message.includes("does not exist")) {
            throw error;
        }
    }
}

function impactRank(level: string) {
    if (level === "HIGH") return 3;
    if (level === "MEDIUM") return 2;
    return 1;
}

function typeLabel(type: string) {
    if (type === "validation") return "Validation";
    if (type === "pain_theme") return "Pain theme";
    return "Opportunity";
}

function buildBriefPayload(feed: Awaited<ReturnType<typeof buildMonitorFeed>>) {
    const now = new Date();
    const monitors = feed.monitors || [];
    const recentEvents = feed.recent_events || [];
    const strongestMonitor = [...monitors].sort((a, b) => (b.trust?.score || 0) - (a.trust?.score || 0))[0] || null;
    const topEvent = [...recentEvents].sort((a, b) => impactRank(b.impact_level) - impactRank(a.impact_level))[0] || null;
    const changedMonitors = monitors
        .filter((monitor) => monitor.memory)
        .slice(0, 5)
        .map((monitor) => ({
            title: monitor.title,
            delta_summary: monitor.memory?.delta_summary || "",
            direction: monitor.memory?.direction || "steady",
            href: monitor.target_href,
        }));
    const staleMonitors = monitors
        .filter((monitor) => {
            const checked = safeParseDate(monitor.last_checked_at || monitor.created_at);
            if (!checked) return false;
            return Date.now() - checked > 14 * 86400000;
        })
        .slice(0, 5)
        .map((monitor) => ({
            title: monitor.title,
            type: typeLabel(monitor.monitor_type),
            days_since_check: Math.max(1, Math.floor((Date.now() - (safeParseDate(monitor.last_checked_at || monitor.created_at) || Date.now())) / 86400000)),
            href: monitor.target_href,
        }));

    const brief = {
        date: now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
        total_monitors: monitors.length,
        active_changes: recentEvents.length,
        unread_updates: feed.unread_count || 0,
        strongest_monitor: strongestMonitor
            ? {
                title: strongestMonitor.title,
                type: typeLabel(strongestMonitor.monitor_type),
                trust_score: strongestMonitor.trust.score,
                summary: strongestMonitor.summary,
                href: strongestMonitor.target_href,
            }
            : null,
        top_event: topEvent
            ? {
                summary: topEvent.summary,
                impact_level: topEvent.impact_level,
                source_label: topEvent.source_label,
                href: topEvent.href,
            }
            : null,
        monitor_mix: {
            validation: monitors.filter((monitor) => monitor.monitor_type === "validation").length,
            opportunity: monitors.filter((monitor) => monitor.monitor_type === "opportunity").length,
            pain_theme: monitors.filter((monitor) => monitor.monitor_type === "pain_theme").length,
        },
        recommended_actions: [
            changedMonitors[0] ? `Since last check: ${changedMonitors[0].delta_summary}` : null,
            topEvent ? `Review: ${topEvent.summary}` : null,
            strongestMonitor ? `Prioritize: ${strongestMonitor.title}` : null,
            staleMonitors.length > 0 ? `Refresh ${staleMonitors.length} stale monitor${staleMonitors.length > 1 ? "s" : ""}` : null,
        ].filter(Boolean),
        changed_monitors: changedMonitors,
        stale_monitors: staleMonitors,
    };

    const timeline = recentEvents.slice(0, 12).map((event) => ({
        bucket: event.event_type === "memory_change" ? "Since last check" : event.impact_level === "HIGH" ? "Priority" : "Recent",
        time: event.observed_at,
        icon: event.event_type === "pain_match" ? "alert" : event.event_type === "competitor_weakness" ? "competitor" : "trend",
        description: event.summary,
        action: { href: event.href, label: "Open" },
        source_label: event.source_label,
        impact_level: event.impact_level,
    }));

    return {
        brief,
        timeline,
        cached: false,
        generated_at: now.toISOString(),
    };
}

export async function GET(req: NextRequest) {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";

    try {
        if (!forceRefresh) {
            const cached = await loadCache(user.id);
            if (cached.payload) {
                return NextResponse.json(cached.payload);
            }
        }

        const feed = await buildMonitorFeed(user.id);
        const payload = buildBriefPayload(feed);
        await saveCache(user.id, payload);
        return NextResponse.json(payload);
    } catch (error) {
        console.error("[Digest] Failed to build monitor brief:", error);
        return NextResponse.json({ error: "Could not load brief" }, { status: 500 });
    }
}
