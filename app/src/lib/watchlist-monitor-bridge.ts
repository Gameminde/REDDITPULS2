import { buildWatchlistMonitor, toNativeMonitorRow } from "@/lib/monitors";
import { watchlistErrorMessage } from "@/lib/watchlist-data";

function nativeMonitorsMissing(error: { message?: string } | null | undefined) {
    const message = watchlistErrorMessage(error);
    return message.includes("monitors")
        || message.includes("relation")
        || message.includes("does not exist");
}

export async function syncWatchlistRowsToNativeMonitors(
    supabaseAdmin: any,
    userId: string,
    rows: Array<Record<string, unknown>>,
) {
    const nativeRows = rows
        .map((row) => buildWatchlistMonitor(row, []))
        .filter(Boolean)
        .map((monitor) => toNativeMonitorRow(userId, monitor!));

    if (nativeRows.length === 0) {
        return { supported: true, error: null };
    }

    const { error } = await supabaseAdmin
        .from("monitors")
        .upsert(nativeRows, { onConflict: "user_id,legacy_type,legacy_id" });

    if (error && nativeMonitorsMissing(error)) {
        return { supported: false, error: null };
    }

    return { supported: !error, error };
}

export async function deleteNativeWatchlistMonitorRows(
    supabaseAdmin: any,
    userId: string,
    legacyIds: string[],
) {
    if (legacyIds.length === 0) {
        return { supported: true, error: null };
    }

    const { error } = await supabaseAdmin
        .from("monitors")
        .delete()
        .eq("user_id", userId)
        .eq("legacy_type", "watchlist")
        .in("legacy_id", legacyIds);

    if (error && nativeMonitorsMissing(error)) {
        return { supported: false, error: null };
    }

    return { supported: !error, error };
}

export async function deleteNativeValidationFallbackMonitor(
    supabaseAdmin: any,
    userId: string,
    validationId: string,
) {
    const { error } = await supabaseAdmin
        .from("monitors")
        .delete()
        .eq("user_id", userId)
        .eq("legacy_type", "watchlist")
        .eq("legacy_id", validationId)
        .eq("monitor_type", "validation");

    if (error && nativeMonitorsMissing(error)) {
        return { supported: false, error: null };
    }

    return { supported: !error, error };
}
