import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { trackServerEvent } from "@/lib/analytics";
import { buildValidationTrust } from "@/lib/trust";
import { loadWatchlist, loadWatchlistById, safeParseJson, watchlistErrorMessage } from "@/lib/watchlist-data";
import {
    deleteNativeValidationFallbackMonitor,
    deleteNativeWatchlistMonitorRows,
    syncWatchlistRowsToNativeMonitors,
} from "@/lib/watchlist-monitor-bridge";

async function getUser() {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll: () => cookieStore.getAll() } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function isValidationSchemaConflict(error: { message?: string } | null | undefined) {
    const message = watchlistErrorMessage(error);
    return message.includes("validation_id") && (
        message.includes("column")
        || message.includes("schema cache")
        || message.includes("does not exist")
        || message.includes("could not find")
    );
}

function isDuplicateWatchlistConflict(error: { message?: string; code?: string } | null | undefined) {
    const message = watchlistErrorMessage(error);
    return error?.code === "23505"
        || message.includes("duplicate key")
        || message.includes("idx_watchlists_user_validation_unique")
        || message.includes("idx_watchlists_user_idea_unique");
}

function nativeMonitorUnavailable(error: { message?: string } | null | undefined) {
    const message = watchlistErrorMessage(error);
    return message.includes("monitors")
        || message.includes("relation")
        || message.includes("does not exist");
}

function truncate(text: string, limit = 120) {
    const value = String(text || "").trim();
    if (value.length <= limit) return value;
    return `${value.slice(0, limit - 1).trim()}...`;
}

function parseValidationReport(report: unknown) {
    const parsed = safeParseJson<Record<string, unknown>>(report);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
}

function extractValidationKeywords(report: Record<string, unknown>) {
    return Array.isArray(report.keywords)
        ? report.keywords.map(String).filter(Boolean).slice(0, 4)
        : [];
}

async function loadNativeValidationMonitor(userId: string, validationId: string) {
    const result = await supabaseAdmin
        .from("monitors")
        .select("*")
        .eq("user_id", userId)
        .eq("legacy_type", "watchlist")
        .eq("legacy_id", validationId)
        .eq("monitor_type", "validation")
        .maybeSingle();

    if (result.error && !nativeMonitorUnavailable(result.error)) {
        return { data: null, error: result.error };
    }

    return { data: result.data, error: null };
}

async function upsertNativeValidationMonitor(
    userId: string,
    validationId: string,
    body: Record<string, unknown>,
) {
    const existing = await loadNativeValidationMonitor(userId, validationId);
    if (existing.error) {
        return { data: null, error: existing.error, already_saved: false };
    }
    if (existing.data) {
        return { data: existing.data, error: null, already_saved: true };
    }

    const validationResult = await supabaseAdmin
        .from("idea_validations")
        .select("id, idea_text, confidence, created_at, completed_at, report")
        .eq("id", validationId)
        .maybeSingle();

    if (validationResult.error) {
        return { data: null, error: validationResult.error, already_saved: false };
    }
    if (!validationResult.data) {
        return { data: null, error: new Error("Validation not found"), already_saved: false };
    }

    const parsedReport = parseValidationReport(validationResult.data.report);
    const trust = buildValidationTrust({
        confidence: validationResult.data.confidence,
        created_at: validationResult.data.created_at,
        completed_at: validationResult.data.completed_at,
        report: parsedReport,
    });
    const keywords = extractValidationKeywords(parsedReport);
    const summary = String(
        parsedReport.executive_summary
        || parsedReport.summary
        || "Track confidence, evidence quality, and market movement around this validation.",
    );
    const lastCheckedAt = validationResult.data.completed_at || validationResult.data.created_at || new Date().toISOString();

    const { data, error } = await supabaseAdmin
        .from("monitors")
        .upsert({
            user_id: userId,
            legacy_type: "watchlist",
            legacy_id: validationId,
            monitor_type: "validation",
            target_ref: `/dashboard/reports/${validationId}`,
            title: truncate(validationResult.data.idea_text, 120),
            subtitle: "Validation monitor",
            status: "active",
            trust_level: trust.level,
            trust_score: trust.score,
            last_checked_at: lastCheckedAt,
            last_changed_at: lastCheckedAt,
            metadata: {
                summary,
                tags: keywords,
                metrics: [
                    { label: "Confidence", value: `${Number(validationResult.data.confidence || 0)}%`, tone: "default" },
                    { label: "Evidence", value: `${trust.evidence_count}`, tone: "default" },
                    { label: "Sources", value: `${trust.source_count}`, tone: "default" },
                ],
                data: {
                    validation_id: validationId,
                    notes: String(body.notes || ""),
                    alert_threshold: body.alert_threshold ?? null,
                    fallback_origin: "native_validation_monitor",
                    evidence_count: trust.evidence_count,
                    direct_evidence_count: trust.direct_evidence_count,
                    direct_quote_count: trust.direct_quote_count,
                    source_count: trust.source_count,
                    memory_hints: {
                        primary_metric_label: "Confidence",
                        primary_metric_value: Number(validationResult.data.confidence || 0),
                        secondary_metric_label: "Evidence",
                        secondary_metric_value: trust.evidence_count,
                        evidence_count: trust.evidence_count,
                        timing_category: null,
                        timing_momentum: "steady",
                        weakness_signal_count: 0,
                    },
                },
            },
        }, { onConflict: "user_id,legacy_type,legacy_id" })
        .select()
        .single();

    return { data, error, already_saved: false };
}

async function deleteNativeValidationMonitor(userId: string, validationId: string) {
    const result = await supabaseAdmin
        .from("monitors")
        .delete()
        .eq("user_id", userId)
        .eq("legacy_type", "watchlist")
        .eq("legacy_id", validationId)
        .eq("monitor_type", "validation");

    if (result.error && !nativeMonitorUnavailable(result.error)) {
        return { error: result.error };
    }

    return { error: null };
}

async function findExistingWatchlist(userId: string, ideaId: string | null, validationId: string | null) {
    if (validationId) {
        const existing = await supabaseAdmin
            .from("watchlists")
            .select("id, user_id, idea_id, validation_id, alert_threshold, notes, added_at")
            .eq("user_id", userId)
            .eq("validation_id", validationId)
            .maybeSingle();

        if (existing.data) {
            return { data: existing.data, error: null };
        }
        if (existing.error && !isValidationSchemaConflict(existing.error)) {
            return { data: null, error: existing.error };
        }
    }

    if (ideaId) {
        const existing = await supabaseAdmin
            .from("watchlists")
            .select("id, user_id, idea_id, validation_id, alert_threshold, notes, added_at")
            .eq("user_id", userId)
            .eq("idea_id", ideaId)
            .maybeSingle();

        if (existing.data) {
            return { data: existing.data, error: null };
        }
        if (existing.error) {
            return { data: null, error: existing.error };
        }
    }

    return { data: null, error: null };
}

async function syncNativeMonitorForWatchlistRow(
    userId: string,
    watchlistId: string,
    validationId?: string | null,
) {
    const hydrated = await loadWatchlistById(supabaseAdmin, userId, watchlistId);
    if (hydrated.error) {
        return { error: hydrated.error };
    }

    if ((hydrated.data || []).length > 0) {
        const sync = await syncWatchlistRowsToNativeMonitors(supabaseAdmin, userId, hydrated.data);
        if (sync.error) {
            return { error: sync.error };
        }
    }

    if (validationId) {
        const cleanup = await deleteNativeValidationFallbackMonitor(supabaseAdmin, userId, validationId);
        if (cleanup.error) {
            return { error: cleanup.error };
        }
    }

    return { error: null };
}

export async function GET(req: NextRequest) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const validationId = req.nextUrl.searchParams.get("validation_id");
    const result = await loadWatchlist(supabaseAdmin, user.id, validationId);

    if (result.error) {
        return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    if (validationId && !result.schemaSupportsValidations) {
        const nativeResult = await loadNativeValidationMonitor(user.id, validationId);
        if (nativeResult.error) {
            return NextResponse.json({ error: nativeResult.error.message }, { status: 500 });
        }

        if (nativeResult.data) {
            return NextResponse.json({
                watchlist: [nativeResult.data],
                saved: true,
                schemaSupportsValidations: false,
                nativeMonitorFallback: true,
            });
        }
    }

    const nativeSync = await syncWatchlistRowsToNativeMonitors(supabaseAdmin, user.id, result.data || []);
    if (nativeSync.error) {
        return NextResponse.json({ error: nativeSync.error.message }, { status: 500 });
    }

    return NextResponse.json({
        watchlist: result.data,
        saved: validationId ? result.data.length > 0 : undefined,
        schemaSupportsValidations: result.schemaSupportsValidations,
    });
}

export async function POST(request: Request) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const ideaId = body.idea_id || null;
    const validationId = body.validation_id || null;

    if (!ideaId && !validationId) {
        return NextResponse.json({ error: "idea_id or validation_id required" }, { status: 400 });
    }

    if (validationId) {
        const existing = await supabaseAdmin
            .from("watchlists")
            .select("id")
            .eq("user_id", user.id)
            .eq("validation_id", validationId)
            .maybeSingle();

        if (existing.error && !isValidationSchemaConflict(existing.error)) {
            return NextResponse.json({ error: existing.error.message }, { status: 500 });
        }
        if (existing.error && isValidationSchemaConflict(existing.error)) {
            const nativeFallback = await upsertNativeValidationMonitor(user.id, validationId, body);
            if (nativeFallback.error) {
                return NextResponse.json({
                    error: nativeFallback.error.message,
                    schema_hint: nativeMonitorUnavailable(nativeFallback.error)
                        ? "watchlists.validation_id is missing and native monitors are unavailable. Run the latest watchlist and monitor migrations."
                        : undefined,
                }, { status: nativeMonitorUnavailable(nativeFallback.error) ? 409 : 500 });
            }
            return NextResponse.json({
                watchlist: nativeFallback.data,
                already_saved: nativeFallback.already_saved,
                nativeMonitorFallback: true,
            });
        }
        if (existing.data) {
            const nativeSync = await syncNativeMonitorForWatchlistRow(user.id, String(existing.data.id), validationId);
            if (nativeSync.error) {
                return NextResponse.json({ error: nativeSync.error.message }, { status: 500 });
            }
            return NextResponse.json({ watchlist: existing.data, already_saved: true });
        }
    }

    if (ideaId) {
        const existing = await supabaseAdmin
            .from("watchlists")
            .select("id")
            .eq("user_id", user.id)
            .eq("idea_id", ideaId)
            .maybeSingle();

        if (existing.error) {
            return NextResponse.json({ error: existing.error.message }, { status: 500 });
        }
        if (existing.data) {
            const nativeSync = await syncNativeMonitorForWatchlistRow(user.id, String(existing.data.id), null);
            if (nativeSync.error) {
                return NextResponse.json({ error: nativeSync.error.message }, { status: 500 });
            }
            return NextResponse.json({ watchlist: existing.data, already_saved: true });
        }
    }

    const { data, error } = await supabaseAdmin
        .from("watchlists")
        .insert({
            user_id: user.id,
            idea_id: ideaId,
            validation_id: validationId,
            alert_threshold: body.alert_threshold || null,
            notes: body.notes || "",
        })
        .select()
        .single();

    if (error) {
        if (isDuplicateWatchlistConflict(error)) {
            const existing = await findExistingWatchlist(user.id, ideaId, validationId);
            if (existing.error) {
                return NextResponse.json({ error: existing.error.message }, { status: 500 });
            }
            if (existing.data) {
                return NextResponse.json({ watchlist: existing.data, already_saved: true });
            }
        }

        if (validationId && isValidationSchemaConflict(error)) {
            const nativeFallback = await upsertNativeValidationMonitor(user.id, validationId, body);
            if (nativeFallback.error) {
                return NextResponse.json({
                    error: nativeFallback.error.message,
                    schema_hint: nativeMonitorUnavailable(nativeFallback.error)
                        ? "watchlists.validation_id is missing and native monitors are unavailable. Run the latest watchlist and monitor migrations."
                        : undefined,
                }, { status: nativeMonitorUnavailable(nativeFallback.error) ? 409 : 500 });
            }
            return NextResponse.json({
                watchlist: nativeFallback.data,
                already_saved: nativeFallback.already_saved,
                nativeMonitorFallback: true,
            });
        }

        const status = isValidationSchemaConflict(error) ? 409 : 500;
        return NextResponse.json({
            error: error.message,
            schema_hint: status === 409
                ? "watchlists.validation_id is missing in Supabase. Run the latest watchlist migration."
                : undefined,
        }, { status });
    }

    const nativeSync = await syncNativeMonitorForWatchlistRow(user.id, String(data.id), validationId);
    if (nativeSync.error) {
        return NextResponse.json({ error: nativeSync.error.message }, { status: 500 });
    }

    await trackServerEvent(request, {
        eventName: "watchlist_added",
        scope: "product",
        userId: user.id,
        route: "/api/watchlist",
        properties: {
            idea_id: ideaId,
            validation_id: validationId,
        },
    });

    return NextResponse.json({ watchlist: data });
}

export async function DELETE(request: Request) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const ideaId = body.idea_id || null;
    const validationId = body.validation_id || null;

    if (!ideaId && !validationId) {
        return NextResponse.json({ error: "idea_id or validation_id required" }, { status: 400 });
    }

    const existingWatchlist = await findExistingWatchlist(user.id, ideaId, validationId);
    if (existingWatchlist.error) {
        return NextResponse.json({ error: existingWatchlist.error.message }, { status: 500 });
    }

    let watchlistDeleteError: { message?: string } | null = null;

    let query = supabaseAdmin
        .from("watchlists")
        .delete()
        .eq("user_id", user.id);

    query = validationId ? query.eq("validation_id", validationId) : query.eq("idea_id", ideaId);

    const { error } = await query;
    watchlistDeleteError = error;

    if (validationId && error && isValidationSchemaConflict(error)) {
        const nativeDelete = await deleteNativeValidationMonitor(user.id, validationId);
        if (nativeDelete.error) {
            return NextResponse.json({ error: nativeDelete.error.message }, { status: 500 });
        }
        return NextResponse.json({ success: true, nativeMonitorFallback: true });
    }

    if (watchlistDeleteError) return NextResponse.json({ error: watchlistDeleteError.message }, { status: 500 });

    const legacyIds = existingWatchlist.data?.id ? [String(existingWatchlist.data.id)] : [];
    const nativeDelete = await deleteNativeWatchlistMonitorRows(supabaseAdmin, user.id, legacyIds);
    if (nativeDelete.error) {
        return NextResponse.json({ error: nativeDelete.error.message }, { status: 500 });
    }

    if (validationId) {
        const fallbackDelete = await deleteNativeValidationFallbackMonitor(supabaseAdmin, user.id, validationId);
        if (fallbackDelete.error) {
            return NextResponse.json({ error: fallbackDelete.error.message }, { status: 500 });
        }
    }

    return NextResponse.json({ success: true });
}
