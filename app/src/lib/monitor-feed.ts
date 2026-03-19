import { createClient } from "@supabase/supabase-js";
import {
    buildMonitorMemoryDelta,
    buildMonitorMemoryState,
    createSnapshotHash,
    normalizeStoredDelta,
    normalizeStoredState,
    toNativeSnapshotRow,
    type MonitorMemoryDelta,
} from "@/lib/live-market-memory";
import { loadWatchlist, watchlistErrorMessage } from "@/lib/watchlist-data";
import { buildAlertMonitor, buildNativeStandaloneMonitor, buildWatchlistMonitor, toNativeMonitorEvents, toNativeMonitorRow, type MonitorEvent, type MonitorItem } from "@/lib/monitors";

export const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function sortMonitors(monitors: MonitorItem[]) {
    return [...monitors].sort((a, b) => {
        const aTime = Date.parse(a.last_changed_at || a.created_at || "");
        const bTime = Date.parse(b.last_changed_at || b.created_at || "");
        return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    });
}

function sortEvents(events: MonitorEvent[]) {
    return [...events].sort((a, b) => {
        const aTime = a.observed_at ? Date.parse(a.observed_at) : 0;
        const bTime = b.observed_at ? Date.parse(b.observed_at) : 0;
        return bTime - aTime;
    });
}

function eventDirection(direction: MonitorMemoryDelta["direction"]) {
    if (direction === "strengthening") return "up";
    if (direction === "weakening") return "down";
    if (direction === "new") return "new";
    return "neutral";
}

function eventImpact(delta: MonitorMemoryDelta) {
    if (delta.confidence_change || delta.timing_change_note || delta.weakness_change_note) return "HIGH" as const;
    if (delta.new_evidence_note) return "MEDIUM" as const;
    return "LOW" as const;
}

function buildMemoryEvent(monitor: MonitorItem, delta: MonitorMemoryDelta, snapshotHash: string): MonitorEvent {
    return {
        id: `memory:${monitor.id}:${snapshotHash.slice(0, 12)}`,
        monitor_id: monitor.id,
        event_type: "memory_change",
        direction: eventDirection(delta.direction),
        impact_level: eventImpact(delta),
        summary: delta.delta_summary,
        observed_at: new Date().toISOString(),
        href: monitor.target_href,
        source_label: "Live Market Memory",
        seen: false,
        metadata: {
            memory_delta: delta,
        },
    };
}

export async function syncNativeMonitors(userId: string, monitors: MonitorItem[]) {
    if (monitors.length === 0) {
        return { supported: false, snapshotsSupported: false, memoryByMonitorId: new Map<string, MonitorMemoryDelta>(), generatedEvents: [] as MonitorEvent[] };
    }

    const rows = monitors.map((monitor) => toNativeMonitorRow(userId, monitor));
    const { data, error } = await supabaseAdmin
        .from("monitors")
        .upsert(rows, { onConflict: "user_id,legacy_type,legacy_id" })
        .select("id, legacy_type, legacy_id");

    if (error) {
        const message = watchlistErrorMessage(error);
        if (message.includes("monitors") || message.includes("relation") || message.includes("does not exist")) {
            return { supported: false, snapshotsSupported: false, memoryByMonitorId: new Map<string, MonitorMemoryDelta>(), generatedEvents: [] as MonitorEvent[] };
        }
        return { supported: false, snapshotsSupported: false, error, memoryByMonitorId: new Map<string, MonitorMemoryDelta>(), generatedEvents: [] as MonitorEvent[] };
    }

    const nativeMap = new Map((data || []).map((row: any) => [`${row.legacy_type}:${row.legacy_id}`, row.id]));
    const uiMemoryEvents: MonitorEvent[] = [];
    const memoryByMonitorId = new Map<string, MonitorMemoryDelta>();
    let snapshotsSupported = true;

    const nativeIds = [...new Set((data || []).map((row: any) => String(row.id)).filter(Boolean))];
    const latestSnapshotsByMonitorId = new Map<string, any>();

    if (nativeIds.length > 0) {
        const { data: snapshots, error: snapshotsError } = await supabaseAdmin
            .from("monitor_snapshots")
            .select("*")
            .in("monitor_id", nativeIds)
            .order("captured_at", { ascending: false });

        if (snapshotsError) {
            const message = watchlistErrorMessage(snapshotsError);
            if (message.includes("monitor_snapshots") || message.includes("relation") || message.includes("does not exist")) {
                snapshotsSupported = false;
            } else {
                return {
                    supported: true,
                    snapshotsSupported: false,
                    error: snapshotsError,
                    memoryByMonitorId,
                    generatedEvents: uiMemoryEvents,
                };
            }
        } else {
            for (const snapshot of snapshots || []) {
                const key = String(snapshot.monitor_id);
                if (!latestSnapshotsByMonitorId.has(key)) {
                    latestSnapshotsByMonitorId.set(key, snapshot);
                }
            }
        }
    }

    if (snapshotsSupported) {
        const snapshotRows: any[] = [];
        const nativeMemoryEventRows: any[] = [];

        for (const monitor of monitors) {
            const nativeId = nativeMap.get(`${monitor.legacy_type}:${monitor.legacy_id}`);
            if (!nativeId) continue;

            const state = buildMonitorMemoryState(monitor);
            const hash = createSnapshotHash(state);
            const previousSnapshot = latestSnapshotsByMonitorId.get(String(nativeId));
            const previousHash = previousSnapshot?.snapshot_hash ? String(previousSnapshot.snapshot_hash) : null;
            const previousState = normalizeStoredState(previousSnapshot?.state_summary);

            if (previousHash === hash) {
                const existingDelta = normalizeStoredDelta(previousSnapshot?.delta_summary);
                if (existingDelta) {
                    memoryByMonitorId.set(monitor.id, existingDelta);
                }
                continue;
            }

            const delta = buildMonitorMemoryDelta(previousState, state, monitor.trust?.direct_evidence_count || 0);
            if (delta) {
                memoryByMonitorId.set(monitor.id, delta);
                const uiEvent = buildMemoryEvent(monitor, delta, hash);
                uiMemoryEvents.push(uiEvent);
                nativeMemoryEventRows.push(...toNativeMonitorEvents(userId, nativeId, [uiEvent]));
            }

            snapshotRows.push(toNativeSnapshotRow({
                userId,
                monitorId: nativeId,
                hash,
                direction: delta?.direction || (previousState ? "steady" : "new"),
                state,
                delta,
            }));
        }

        if (snapshotRows.length > 0) {
            const { error: snapshotInsertError } = await supabaseAdmin
                .from("monitor_snapshots")
                .insert(snapshotRows);

            if (snapshotInsertError) {
                const message = watchlistErrorMessage(snapshotInsertError);
                if (message.includes("monitor_snapshots") || message.includes("relation") || message.includes("does not exist")) {
                    snapshotsSupported = false;
                } else {
                    return {
                        supported: true,
                        snapshotsSupported: false,
                        error: snapshotInsertError,
                        memoryByMonitorId,
                        generatedEvents: uiMemoryEvents,
                    };
                }
            }
        }

        if (nativeMemoryEventRows.length > 0) {
            const { error: nativeMemoryEventError } = await supabaseAdmin
                .from("monitor_events")
                .upsert(nativeMemoryEventRows, { onConflict: "event_key" });

            if (nativeMemoryEventError) {
                const message = watchlistErrorMessage(nativeMemoryEventError);
                if (!message.includes("monitor_events") && !message.includes("relation") && !message.includes("does not exist")) {
                    return {
                        supported: true,
                        snapshotsSupported,
                        error: nativeMemoryEventError,
                        memoryByMonitorId,
                        generatedEvents: uiMemoryEvents,
                    };
                }
            }
        }
    }

    const eventRows = monitors.flatMap((monitor) => {
        const nativeId = nativeMap.get(`${monitor.legacy_type}:${monitor.legacy_id}`);
        if (!nativeId || monitor.recent_events.length === 0) return [];
        return toNativeMonitorEvents(userId, nativeId, monitor.recent_events);
    });

    if (eventRows.length > 0) {
        const { error: eventError } = await supabaseAdmin
            .from("monitor_events")
            .upsert(eventRows, { onConflict: "event_key" });

        if (eventError) {
            const message = watchlistErrorMessage(eventError);
            if (!message.includes("monitor_events") && !message.includes("relation") && !message.includes("does not exist")) {
                return { supported: true, error: eventError };
            }
        }
    }

    return {
        supported: true,
        snapshotsSupported,
        memoryByMonitorId,
        generatedEvents: uiMemoryEvents,
    };
}

async function loadStandaloneNativeMonitors(userId: string, existingLegacyKeys: Set<string>) {
    const { data: rows, error } = await supabaseAdmin
        .from("monitors")
        .select("*")
        .eq("user_id", userId)
        .order("last_changed_at", { ascending: false })
        .limit(100);

    if (error) {
        const message = watchlistErrorMessage(error);
        if (message.includes("monitors") || message.includes("relation") || message.includes("does not exist")) {
            return [] as MonitorItem[];
        }
        throw error;
    }

    const standaloneRows = (rows || []).filter((row: any) => !existingLegacyKeys.has(`${row.legacy_type}:${row.legacy_id}`));
    if (standaloneRows.length === 0) {
        return [] as MonitorItem[];
    }

    const monitorIds = standaloneRows.map((row: any) => String(row.id)).filter(Boolean);
    const groupedEvents = new Map<string, Array<Record<string, unknown>>>();

    if (monitorIds.length > 0) {
        const { data: nativeEvents, error: nativeEventsError } = await supabaseAdmin
            .from("monitor_events")
            .select("*")
            .in("monitor_id", monitorIds)
            .order("observed_at", { ascending: false })
            .limit(200);

        if (nativeEventsError) {
            const message = watchlistErrorMessage(nativeEventsError);
            if (!message.includes("monitor_events") && !message.includes("relation") && !message.includes("does not exist")) {
                throw nativeEventsError;
            }
        } else {
            for (const event of nativeEvents || []) {
                const key = String(event.monitor_id);
                const bucket = groupedEvents.get(key) || [];
                bucket.push(event);
                groupedEvents.set(key, bucket);
            }
        }
    }

    return standaloneRows
        .map((row: any) => buildNativeStandaloneMonitor(row, groupedEvents.get(String(row.id)) || []))
        .filter(Boolean) as MonitorItem[];
}

export async function buildMonitorFeed(userId: string) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const [watchlistResult, alertsResult, matchesResult, complaintsResult] = await Promise.all([
        loadWatchlist(supabaseAdmin, userId),
        supabaseAdmin
            .from("pain_alerts")
            .select("*")
            .eq("user_id", userId)
            .eq("is_active", true)
            .order("created_at", { ascending: false }),
        supabaseAdmin
            .from("alert_matches")
            .select("*")
            .eq("user_id", userId)
            .gte("matched_at", sevenDaysAgo)
            .order("matched_at", { ascending: false })
            .limit(200),
        supabaseAdmin
            .from("competitor_complaints")
            .select("*")
            .gte("scraped_at", sevenDaysAgo)
            .order("scraped_at", { ascending: false })
            .limit(100),
    ]);

    if (watchlistResult.error) throw watchlistResult.error;
    if (alertsResult.error) throw alertsResult.error;
    if (matchesResult.error) throw matchesResult.error;
    if (complaintsResult.error) throw complaintsResult.error;

    const complaints = complaintsResult.data || [];
    const groupedMatches = new Map<string, Array<Record<string, unknown>>>();
    for (const match of matchesResult.data || []) {
        const existing = groupedMatches.get(String(match.alert_id)) || [];
        existing.push(match);
        groupedMatches.set(String(match.alert_id), existing);
    }

    const watchlistMonitors = (watchlistResult.data || [])
        .map((row: any) => buildWatchlistMonitor(row, complaints))
        .filter(Boolean) as MonitorItem[];

    const alertMonitors = (alertsResult.data || [])
        .map((alert: any) => buildAlertMonitor(alert, groupedMatches.get(String(alert.id)) || []));

    const legacyMonitors = sortMonitors([...watchlistMonitors, ...alertMonitors]);
    const nativeSync = await syncNativeMonitors(userId, legacyMonitors);
    const generatedEvents = nativeSync.generatedEvents || [];

    const monitorsWithMemory = sortMonitors(legacyMonitors.map((monitor) => {
        const memory = nativeSync.memoryByMonitorId?.get(monitor.id) || null;
        const memoryEvents = generatedEvents.filter((event) => event.monitor_id === monitor.id);
        const recentMonitorEvents = sortEvents([...memoryEvents, ...monitor.recent_events]).slice(0, 6);
        return {
            ...monitor,
            memory,
            recent_events: recentMonitorEvents,
            unread_count: recentMonitorEvents.filter((event) => !event.seen).length,
        };
    }));
    const existingLegacyKeys = new Set(legacyMonitors.map((monitor) => `${monitor.legacy_type}:${monitor.legacy_id}`));
    const standaloneNativeMonitors = nativeSync.supported
        ? await loadStandaloneNativeMonitors(userId, existingLegacyKeys)
        : [];
    const allMonitors = sortMonitors([...monitorsWithMemory, ...standaloneNativeMonitors]);
    const recentEvents = sortEvents(allMonitors.flatMap((monitor) => monitor.recent_events)).slice(0, 25);

    return {
        monitors: allMonitors,
        recent_events: recentEvents,
        unread_count: recentEvents.filter((event) => !event.seen).length,
        schemaSupportsValidations: watchlistResult.schemaSupportsValidations,
        schemaSupportsNativeMonitors: nativeSync.supported,
        schemaSupportsMemorySnapshots: nativeSync.snapshotsSupported,
    };
}
