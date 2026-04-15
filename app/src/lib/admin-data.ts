import { exec } from "node:child_process";
import { promisify } from "node:util";

import { MODEL_CATALOG } from "@/lib/ai-model-registry";
import { normalizeProfileRole, type AdminProfileRole } from "@/lib/admin-access";
import { recordAdminEvent } from "@/lib/admin-events";
import { trackServerEvent } from "@/lib/analytics";
import { getApprovedMarketEditorial, getMarketEditorialPublishMode, parseMarketEditorial } from "@/lib/market-editorial";
import { MARKET_VISIBILITY_REASON_LABELS } from "@/lib/market-visibility";
import { buildMarketIdeas, hydrateIdeaForMarket } from "@/lib/market-feed";
import { enqueueValidationJob } from "@/lib/queue";
import { getRuntimeSettings, updateRuntimeSettings } from "@/lib/runtime-settings";
import { extractMarketFunnel, extractScraperRunHealth } from "@/lib/scraper-run-health";
import { getScraperRuntimeMonitor, type ScraperRuntimeMonitor } from "@/lib/scraper-runtime-monitor";
import { createAdmin } from "@/lib/supabase-admin";
import { summarizeValidationCoverage } from "@/lib/validation-coverage";

const execAsync = promisify(exec);
const DAY_MS = 86_400_000;
const MARKET_AUDIT_IDEA_SELECT = "id, topic, slug, current_score, change_24h, change_7d, trend_direction, confidence_level, post_count_total, post_count_7d, source_count, sources, category, competition_data, icp_data, top_posts, keywords, pain_count, pain_summary, first_seen, last_updated, score_breakdown, market_editorial, market_editorial_updated_at";
export type AdminActor = {
    id: string;
    email: string;
    role: AdminProfileRole;
};

export type AdminLogEntry = {
    id: string;
    at: string;
    source: "admin" | "scraper" | "validation" | "analytics";
    severity: "info" | "warning" | "error";
    title: string;
    message: string;
    metadata?: Record<string, unknown> | null;
};

function daysAgo(days: number) {
    return new Date(Date.now() - days * DAY_MS).toISOString();
}

function isMissingRelation(error: { message?: string } | null | undefined) {
    const text = String(error?.message || "").toLowerCase();
    return text.includes("relation") || text.includes("does not exist") || text.includes("column");
}

function toRows(data: unknown) {
    return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

function toNumber(value: unknown) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function mapValidationStatus(value: unknown) {
    const status = String(value || "").toLowerCase();
    if (status === "starting" || status === "running") return "running";
    if (status === "done") return "done";
    if (status === "failed" || status === "error" || status === "timeout") return "failed";
    return "queued";
}

function percentage(numerator: number, denominator: number) {
    if (!denominator) return 0;
    return Math.round((numerator / denominator) * 100);
}

async function fetchAnalyticsEvents(rangeDays = 30) {
    const admin = createAdmin();
    const { data, error } = await admin
        .from("analytics_events")
        .select("id, created_at, event_name, scope, route, user_id, anonymous_id, session_id, referrer, utm_source, properties")
        .gte("created_at", daysAgo(rangeDays))
        .order("created_at", { ascending: false })
        .limit(5000);

    if (error) {
        if (isMissingRelation(error)) return [];
        throw error;
    }

    return toRows(data);
}

async function fetchLatestScraperRuns(limit = 10) {
    const admin = createAdmin();
    const { data, error } = await admin
        .from("scraper_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(limit);

    if (error) {
        if (isMissingRelation(error)) return [];
        throw error;
    }

    return toRows(data);
}

async function fetchValidations(limit = 250) {
    const admin = createAdmin();
    const { data, error } = await admin
        .from("idea_validations")
        .select("id, user_id, idea_text, depth, status, verdict, confidence, model, created_at, completed_at, progress_log, report")
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) {
        if (isMissingRelation(error)) return [];
        throw error;
    }

    return toRows(data);
}

async function fetchProfiles(userIds: string[]) {
    if (!userIds.length) return new Map<string, Record<string, unknown>>();
    const admin = createAdmin();
    const { data, error } = await admin
        .from("profiles")
        .select("id, email, full_name, plan, role")
        .in("id", userIds);

    if (error) {
        if (isMissingRelation(error)) return new Map();
        throw error;
    }

    return new Map(toRows(data).map((row) => [String(row.id || ""), row]));
}

async function fetchAiConfigs(userIds?: string[]) {
    const admin = createAdmin();
    let query = admin
        .from("user_ai_config")
        .select("id, user_id, provider, selected_model, endpoint_url, is_active, priority, created_at");

    if (userIds?.length) {
        query = query.in("user_id", userIds);
    }

    const { data, error } = await query.order("created_at", { ascending: false }).limit(500);
    if (error) {
        if (isMissingRelation(error)) return [];
        throw error;
    }

    return toRows(data);
}

async function fetchIdeasForMarketAudit(limit = 1000) {
    const admin = createAdmin();
    const { data, error } = await admin
        .from("ideas")
        .select(MARKET_AUDIT_IDEA_SELECT)
        .order("last_updated", { ascending: false })
        .limit(limit);

    if (error) {
        if (isMissingRelation(error)) return [];
        throw error;
    }

    return toRows(data);
}

async function fetchTableCountExact(table: string) {
    const admin = createAdmin();
    const { count, error } = await admin
        .from(table)
        .select("*", { count: "exact", head: true });

    if (error) {
        if (isMissingRelation(error)) return 0;
        throw error;
    }

    return count || 0;
}

async function getDbUsageSummary() {
    const [posts, ideas, ideaHistory, scraperRuns, ideaValidations, analyticsEvents] = await Promise.all([
        fetchTableCountExact("posts"),
        fetchTableCountExact("ideas"),
        fetchTableCountExact("idea_history"),
        fetchTableCountExact("scraper_runs"),
        fetchTableCountExact("idea_validations"),
        fetchTableCountExact("analytics_events"),
    ]);

    const totalTrackedRows = posts + ideas + ideaHistory + scraperRuns + ideaValidations + analyticsEvents;
    let pressureLabel = "Low pressure";
    let pressureTone: "healthy" | "warning" | "degraded" = "healthy";

    if (totalTrackedRows >= 100_000 || posts >= 40_000 || ideaHistory >= 80_000) {
        pressureLabel = "Watch closely";
        pressureTone = "degraded";
    } else if (totalTrackedRows >= 25_000 || posts >= 12_000 || ideaHistory >= 30_000) {
        pressureLabel = "Moderate pressure";
        pressureTone = "warning";
    }

    return {
        counts: {
            posts,
            ideas,
            ideaHistory,
            scraperRuns,
            ideaValidations,
            analyticsEvents,
        },
        totalTrackedRows,
        pressureLabel,
        pressureTone,
        note: "Exact database bytes are not exposed through the current REST-only admin path, so this panel tracks row pressure instead.",
    };
}

function buildRecentActivity(input: {
    validations?: Array<Record<string, unknown>>;
    runs?: Array<Record<string, unknown>>;
    analytics?: Array<Record<string, unknown>>;
    adminEvents?: Array<Record<string, unknown>>;
}) {
    const validationEntries: AdminLogEntry[] = (input.validations || []).slice(0, 6).map((row) => ({
        id: `validation:${row.id}`,
        at: String(row.created_at || new Date().toISOString()),
        source: "validation",
        severity: mapValidationStatus(row.status) === "failed" ? "error" : "info",
        title: `Validation ${row.status || "queued"}`,
        message: String(row.idea_text || "").slice(0, 140) || "Validation event",
        metadata: row.report && typeof row.report === "object" ? row.report as Record<string, unknown> : null,
    }));

    const runEntries: AdminLogEntry[] = (input.runs || []).slice(0, 6).map((row) => ({
        id: `run:${row.id || row.started_at}`,
        at: String(row.started_at || row.completed_at || new Date().toISOString()),
        source: "scraper",
        severity: String(row.status || "").toLowerCase() === "failed" ? "error" : String(row.status || "").toLowerCase() === "degraded" ? "warning" : "info",
        title: `Scraper ${row.status || "unknown"}`,
        message: String(row.error_text || row.source || "Scraper run"),
        metadata: row,
    }));

    const analyticsEntries: AdminLogEntry[] = (input.analytics || []).slice(0, 8).map((row) => ({
        id: `analytics:${row.id}`,
        at: String(row.created_at || new Date().toISOString()),
        source: "analytics",
        severity: "info",
        title: String(row.event_name || "analytics_event"),
        message: String(row.route || row.referrer || "Analytics event"),
        metadata: row.properties && typeof row.properties === "object" ? row.properties as Record<string, unknown> : null,
    }));

    const adminEntries: AdminLogEntry[] = (input.adminEvents || []).slice(0, 6).map((row) => ({
        id: `admin:${row.id || row.created_at}`,
        at: String(row.created_at || new Date().toISOString()),
        source: "admin",
        severity: String(row.severity || "info") as AdminLogEntry["severity"],
        title: String(row.action || "admin_action"),
        message: String(row.message || row.target_type || "Admin action"),
        metadata: row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : null,
    }));

    return [...validationEntries, ...runEntries, ...analyticsEntries, ...adminEntries]
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, 18);
}

function buildRuntimeLogEntries(runtime: ScraperRuntimeMonitor): AdminLogEntry[] {
    return runtime.log.highlights.map((entry, index) => ({
        id: `runtime:${entry.id}:${index}`,
        at: entry.at || runtime.log.updatedAt || new Date().toISOString(),
        source: "scraper",
        severity: entry.severity,
        title: "Scraper runtime",
        message: entry.line,
        metadata: {
            log_path: runtime.log.path,
            host: runtime.host,
            service_state: runtime.service.activeState,
            timer_state: runtime.timer.activeState,
        },
    }));
}

function buildMarketAuditSummary(rows: Array<Record<string, unknown>>) {
    const hydratedIdeas = rows.map((row) => hydrateIdeaForMarket(row));
    const visibilityReasonCounts = new Map<string, number>();
    let publicEligible = 0;

    for (const idea of hydratedIdeas) {
        if (idea.visibility_decision.status === "visible") {
            publicEligible += 1;
            continue;
        }
        visibilityReasonCounts.set(
            idea.visibility_decision.reason,
            (visibilityReasonCounts.get(idea.visibility_decision.reason) || 0) + 1,
        );
    }

    const rejectionBreakdown = [...visibilityReasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({
            reason,
            label: MARKET_VISIBILITY_REASON_LABELS[reason as keyof typeof MARKET_VISIBILITY_REASON_LABELS] || reason,
            count,
        }));

    return {
        totalIdeas: hydratedIdeas.length,
        publicEligible,
        publicRejected: Math.max(0, hydratedIdeas.length - publicEligible),
        userFeedVisible: buildMarketIdeas(rows, { surface: "user" }).length,
        adminFeedVisible: buildMarketIdeas(rows, { includeExploratory: true, surface: "admin" }).length,
        visibleMarketStatus: hydratedIdeas.filter((idea) => idea.visibility_decision.status === "visible").length,
        needsFocus: hydratedIdeas.filter((idea) => idea.market_status === "needs_wedge").length,
        suppressed: hydratedIdeas.filter((idea) => idea.market_status === "suppressed").length,
        rejectionBreakdown,
    };
}

export async function getAdminOverviewData() {
    const admin = createAdmin();
    const [runtimeSettings, runs, validations, analytics, ideas24h, adminEvents, authUsers, topIdeaRows, dbUsage] = await Promise.all([
        getRuntimeSettings(),
        fetchLatestScraperRuns(),
        fetchValidations(),
        fetchAnalyticsEvents(30),
        admin.from("ideas").select("id", { count: "exact", head: true }).gte("last_updated", daysAgo(1)),
        admin.from("admin_events").select("id, created_at, action, severity, message, target_type, metadata").order("created_at", { ascending: false }).limit(12),
        admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
        admin
            .from("ideas")
            .select("id, topic, slug, current_score, change_24h, change_7d, trend_direction, confidence_level, post_count_total, post_count_7d, source_count, sources, category, competition_data, icp_data, top_posts, keywords, pain_count, pain_summary, first_seen, last_updated, score_breakdown")
            .neq("confidence_level", "INSUFFICIENT")
            .order("current_score", { ascending: false })
            .limit(8),
        getDbUsageSummary(),
    ]);

    const latestRun = runs[0] || null;
    const health = extractScraperRunHealth(latestRun);
    const todayIso = daysAgo(1);
    const recentValidations = validations.filter((row) => Date.parse(String(row.created_at || "")) >= Date.parse(todayIso));
    const buildDone = validations.filter((row) => String(row.status || "").toLowerCase() === "done");
    const buildItCount = buildDone.filter((row) => String(row.verdict || "").toUpperCase().includes("BUILD")).length;
    const pageviews24h = analytics.filter((row) => String(row.event_name || "") === "page_view" && Date.parse(String(row.created_at || "")) >= Date.parse(todayIso));
    const recentSignups24h = (authUsers.data?.users || []).filter((user) => user.created_at && Date.parse(user.created_at) >= Date.parse(todayIso)).length;

    return {
        systemHealth: health,
        runtimeSettings,
        latestScraperRun: latestRun,
        kpis: {
            validationsToday: recentValidations.length,
            queuedValidations: validations.filter((row) => mapValidationStatus(row.status) === "queued").length,
            runningValidations: validations.filter((row) => mapValidationStatus(row.status) === "running").length,
            completedValidations: validations.filter((row) => mapValidationStatus(row.status) === "done").length,
            failedValidations: validations.filter((row) => mapValidationStatus(row.status) === "failed").length,
            updatedIdeas24h: ideas24h.count || 0,
            buildItRate: percentage(buildItCount, buildDone.length),
            landingPageviews24h: pageviews24h.filter((row) => row.route === "/").length,
            signupSuccess24h: analytics.filter((row) => String(row.event_name || "") === "signup_success" && Date.parse(String(row.created_at || "")) >= Date.parse(todayIso)).length,
            loginSuccess24h: analytics.filter((row) => String(row.event_name || "") === "login_success" && Date.parse(String(row.created_at || "")) >= Date.parse(todayIso)).length,
            validateStarts24h: analytics.filter((row) => String(row.event_name || "") === "validation_queued" && Date.parse(String(row.created_at || "")) >= Date.parse(todayIso)).length,
            recentSignups24h,
        },
        estimated: {
            aiCostToday: "Estimated",
            billingSummary: "Mock",
            usersOnlineLive: "Estimated",
        },
        dbUsage,
        recentActivity: buildRecentActivity({
            validations,
            runs,
            analytics,
            adminEvents: toRows(adminEvents.data),
        }),
        topIdeas: topIdeaRows.error
            ? []
            : ((topIdeaRows.data || []) as unknown as Array<Record<string, unknown>>)
                .map((row) => hydrateIdeaForMarket(row))
                .filter((idea) => idea.visibility_decision.status === "visible")
                .slice(0, 5),
    };
}

export async function getAdminAnalyticsData(rangeDays = 30) {
    const events = await fetchAnalyticsEvents(rangeDays);
    const pageviews = events.filter((row) => String(row.event_name || "") === "page_view");
    const countMap = (items: string[]) => {
        const map = new Map<string, number>();
        for (const item of items.filter(Boolean)) map.set(item, (map.get(item) || 0) + 1);
        return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
    };

    const signupUsers = new Set(events.filter((row) => String(row.event_name || "") === "signup_success" && row.user_id).map((row) => String(row.user_id)));
    const validationUsers = new Set(events.filter((row) => String(row.event_name || "") === "validation_queued" && row.user_id).map((row) => String(row.user_id)));
    const savedUsers = new Set(events.filter((row) => ["watchlist_added", "opportunity_watch_added"].includes(String(row.event_name || "")) && row.user_id).map((row) => String(row.user_id)));

    return {
        rangeDays,
        traffic: {
            pageviews: pageviews.length,
            uniqueVisitors: new Set(pageviews.map((row) => String(row.anonymous_id || ""))).size,
            sessions: new Set(pageviews.map((row) => String(row.session_id || ""))).size,
            topPages: countMap(pageviews.map((row) => String(row.route || ""))).slice(0, 10).map((row) => ({ route: row.label, count: row.count })),
            topReferrers: countMap(pageviews.map((row) => String(row.referrer || ""))).slice(0, 10).map((row) => ({ referrer: row.label, count: row.count })),
            utmSources: countMap(pageviews.map((row) => String(row.utm_source || ""))).slice(0, 10).map((row) => ({ source: row.label, count: row.count })),
        },
        funnel: {
            landingView: pageviews.filter((row) => row.route === "/").length,
            pricingView: pageviews.filter((row) => row.route === "/pricing" || row.route === "/dashboard/pricing").length,
            signupStart: events.filter((row) => String(row.event_name || "") === "signup_submit_click").length,
            signupSuccess: events.filter((row) => String(row.event_name || "") === "signup_success").length,
            loginSuccess: events.filter((row) => String(row.event_name || "") === "login_success").length,
            dashboardFirstVisit: pageviews.filter((row) => String(row.route || "").startsWith("/dashboard")).length,
        },
        productUsage: {
            validationStarts: events.filter((row) => String(row.event_name || "") === "validation_queued").length,
            validationCompleted: events.filter((row) => String(row.event_name || "") === "validation_completed").length,
            validationFailed: events.filter((row) => String(row.event_name || "") === "validation_failed").length,
            reportsViewed: pageviews.filter((row) => String(row.route || "").startsWith("/dashboard/reports")).length,
            watchlistSaves: events.filter((row) => String(row.event_name || "") === "watchlist_added").length,
            alertCreations: events.filter((row) => String(row.event_name || "") === "alert_created").length,
            opportunityWatchAdds: events.filter((row) => String(row.event_name || "") === "opportunity_watch_added").length,
        },
        conversions: {
            anonymousToSignupPct: percentage(events.filter((row) => String(row.event_name || "") === "signup_success").length, new Set(pageviews.map((row) => String(row.anonymous_id || ""))).size),
            signupToFirstValidationPct: percentage([...signupUsers].filter((id) => validationUsers.has(id)).length, signupUsers.size),
            firstValidationToSavedPct: percentage([...validationUsers].filter((id) => savedUsers.has(id)).length, validationUsers.size),
        },
        recentEvents: events.slice(0, 80),
    };
}

export async function getAdminValidationsData(filters?: { status?: string; depth?: string; user?: string; days?: number }) {
    const rows = await fetchValidations();
    const profileMap = await fetchProfiles([...new Set(rows.map((row) => String(row.user_id || "")).filter(Boolean))]);
    const cutoff = filters?.days ? Date.parse(daysAgo(filters.days)) : null;
    const items = rows
        .filter((row) => !filters?.status || String(row.status || "").toLowerCase() === filters.status.toLowerCase())
        .filter((row) => !filters?.depth || String(row.depth || "").toLowerCase() === filters.depth.toLowerCase())
        .filter((row) => !cutoff || Date.parse(String(row.created_at || "")) >= cutoff)
        .map((row) => {
            const report = row.report && typeof row.report === "object" && !Array.isArray(row.report)
                ? row.report as Record<string, unknown>
                : {};
            const dataQuality = report.data_quality && typeof report.data_quality === "object" && !Array.isArray(report.data_quality)
                ? report.data_quality as Record<string, unknown>
                : {};
            const coverage = summarizeValidationCoverage({
                platformWarnings: Array.isArray(dataQuality.platform_warnings)
                    ? dataQuality.platform_warnings as unknown[]
                    : Array.isArray(report.platform_warnings)
                        ? report.platform_warnings as unknown[]
                        : [],
                partialCoverage: Boolean(dataQuality.partial_coverage),
                progressLog: Array.isArray(row.progress_log) ? row.progress_log as unknown[] : [],
            });

            return {
                id: String(row.id || ""),
                idea_text: String(row.idea_text || ""),
                user_id: String(row.user_id || ""),
                user_email: String(profileMap.get(String(row.user_id || ""))?.email || row.user_id || "unknown"),
                depth: String(row.depth || "quick"),
                status: String(row.status || "queued"),
                verdict: row.verdict ? String(row.verdict) : null,
                confidence: row.confidence == null ? null : Number(row.confidence),
                created_at: row.created_at ? String(row.created_at) : null,
                completed_at: row.completed_at ? String(row.completed_at) : null,
                coverage_status: coverage.status,
                coverage_summary: coverage.summary,
                warning_platforms: coverage.warningPlatforms,
                used_database_fallback: coverage.usedDatabaseFallback,
            };
        })
        .filter((row) => !filters?.user || row.user_email.toLowerCase().includes(filters.user.toLowerCase()));

    return {
        items,
        counts: {
            total: items.length,
            queued: items.filter((row) => mapValidationStatus(row.status) === "queued").length,
            running: items.filter((row) => mapValidationStatus(row.status) === "running").length,
            done: items.filter((row) => mapValidationStatus(row.status) === "done").length,
            failed: items.filter((row) => mapValidationStatus(row.status) === "failed").length,
        },
    };
}

export async function getAdminValidationDetail(id: string) {
    const admin = createAdmin();
    const { data, error } = await admin
        .from("idea_validations")
        .select("id, user_id, idea_text, depth, status, verdict, confidence, model, created_at, completed_at, progress_log, report")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        if (isMissingRelation(error)) return null;
        throw error;
    }
    if (!data) return null;

    const profileMap = await fetchProfiles([String(data.user_id || "")]);
    return {
        id: String(data.id || ""),
        idea_text: String(data.idea_text || ""),
        user_id: String(data.user_id || ""),
        user_email: String(profileMap.get(String(data.user_id || ""))?.email || data.user_id || "unknown"),
        depth: String(data.depth || "quick"),
        status: String(data.status || "queued"),
        verdict: data.verdict ? String(data.verdict) : null,
        confidence: data.confidence == null ? null : Number(data.confidence),
        created_at: data.created_at ? String(data.created_at) : null,
        completed_at: data.completed_at ? String(data.completed_at) : null,
        report: data.report && typeof data.report === "object" ? data.report as Record<string, unknown> : null,
        progress_log: Array.isArray(data.progress_log) ? data.progress_log : [],
        model: data.model ? String(data.model) : null,
    };
}

export async function retryValidationAsAdmin(validationId: string, actor: AdminActor) {
    const admin = createAdmin();
    const { data: source, error } = await admin
        .from("idea_validations")
        .select("id, user_id, idea_text, depth")
        .eq("id", validationId)
        .maybeSingle();

    if (error || !source) {
        throw new Error(error?.message || "Validation not found");
    }

    const { data: inserted, error: insertError } = await admin
        .from("idea_validations")
        .insert({
            user_id: source.user_id,
            idea_text: source.idea_text,
            model: "multi-brain",
            status: "queued",
            depth: source.depth || "quick",
            report: null,
        })
        .select("id, user_id, idea_text, depth")
        .single();

    if (insertError || !inserted) {
        throw new Error(insertError?.message || "Could not create retried validation");
    }

    const jobId = await enqueueValidationJob({
        validationId: String(inserted.id),
        userId: String(inserted.user_id),
        idea: String(inserted.idea_text || ""),
        depth: String(inserted.depth || "quick") as "quick" | "deep" | "investigation",
    });

    await recordAdminEvent({
        actorUserId: actor.id,
        action: "validation_retry",
        targetType: "validation",
        targetId: validationId,
        message: `Retried validation ${validationId}`,
        metadata: { new_validation_id: inserted.id, job_id: jobId },
    });

    await trackServerEvent({
        eventName: "admin_action",
        scope: "admin",
        userId: actor.id,
        route: "/admin/validations",
        properties: { action: "validation_retry", validation_id: validationId, new_validation_id: inserted.id },
    });

    return { newValidationId: String(inserted.id), jobId };
}

export async function getAdminJobsData() {
    const [runtimeSettings, runs, validations, ideaRows, scraperRuntime] = await Promise.all([
        getRuntimeSettings(),
        fetchLatestScraperRuns(),
        fetchValidations(),
        fetchIdeasForMarketAudit(),
        getScraperRuntimeMonitor(),
    ]);
    const latestRun = runs[0] || null;
    const latestRunHealth = extractScraperRunHealth(latestRun);
    const latestRunFunnel = extractMarketFunnel(latestRun);
    const currentMarketFunnel = buildMarketAuditSummary(ideaRows);

    return {
        runtimeSettings,
        latestRun,
        latestRunHealth,
        latestRunFunnel,
        currentMarketFunnel,
        recentRuns: runs,
        scraperRuntime,
        queue: {
            queued: validations.filter((row) => mapValidationStatus(row.status) === "queued").length,
            running: validations.filter((row) => mapValidationStatus(row.status) === "running").length,
            doneToday: validations.filter((row) => mapValidationStatus(row.status) === "done" && Date.parse(String(row.created_at || "")) >= Date.parse(daysAgo(1))).length,
            failedToday: validations.filter((row) => mapValidationStatus(row.status) === "failed" && Date.parse(String(row.created_at || "")) >= Date.parse(daysAgo(1))).length,
        },
        operatorNotes: [
            {
                label: "Scraper runtime",
                value: runtimeSettings.scrapers_paused ? "Paused by operator" : "Live",
                status: runtimeSettings.scrapers_paused ? "degraded" : "healthy",
            },
            {
                label: "Validation queue",
                value: runtimeSettings.validations_paused ? "Paused by operator" : "Accepting jobs",
                status: runtimeSettings.validations_paused ? "degraded" : "healthy",
            },
            {
                label: "Reddit lane",
                value: latestRun ? latestRunHealth.reddit_access_mode : "unknown",
                status: latestRunHealth.reddit_degraded_reason ? "degraded" : "healthy",
            },
            {
                label: "Scraper runtime",
                value: scraperRuntime.status.label,
                status: scraperRuntime.status.state === "failed"
                    ? "degraded"
                    : scraperRuntime.status.state === "running"
                        ? "healthy"
                        : scraperRuntime.status.state === "stale"
                            ? "degraded"
                            : "neutral",
            },
        ],
    };
}

export async function setValidationPauseState(paused: boolean, actor: AdminActor) {
    const runtimeSettings = await updateRuntimeSettings({ validations_paused: paused }, actor.id);
    await recordAdminEvent({
        actorUserId: actor.id,
        action: paused ? "validations_paused" : "validations_resumed",
        targetType: "runtime_settings",
        targetId: "default",
        message: paused ? "Validation queue paused" : "Validation queue resumed",
        metadata: { paused },
    });
    return runtimeSettings;
}

export async function setScraperPauseState(paused: boolean, actor: AdminActor) {
    const runtimeSettings = await updateRuntimeSettings({ scrapers_paused: paused }, actor.id);
    await recordAdminEvent({
        actorUserId: actor.id,
        action: paused ? "scraper_paused" : "scraper_resumed",
        targetType: "runtime_settings",
        targetId: "default",
        message: paused ? "Scraper runtime paused" : "Scraper runtime resumed",
        metadata: { paused },
    });
    return runtimeSettings;
}

export async function runScraperAsAdmin(actor: AdminActor) {
    const command = process.env.ADMIN_SCRAPER_COMMAND?.trim();
    if (!command) {
        await recordAdminEvent({
            actorUserId: actor.id,
            action: "scraper_force_run_unavailable",
            targetType: "scraper",
            severity: "warning",
            message: "ADMIN_SCRAPER_COMMAND is not configured.",
        });
        return { ok: false, supported: false, message: "ADMIN_SCRAPER_COMMAND is not configured." };
    }

    const result = await execAsync(command, { cwd: process.cwd(), windowsHide: true, timeout: 15 * 60 * 1000 });
    await recordAdminEvent({
        actorUserId: actor.id,
        action: "scraper_force_run",
        targetType: "scraper",
        message: "Manual scraper force-run executed.",
        metadata: {
            command,
            stdout: result.stdout?.slice(0, 2000) || "",
            stderr: result.stderr?.slice(0, 2000) || "",
        },
    });
    await trackServerEvent({
        eventName: "scraper_force_run",
        scope: "admin",
        userId: actor.id,
        route: "/admin/jobs",
        properties: { command },
    });
    return { ok: true, supported: true, message: "Scraper force-run executed.", stdout: result.stdout, stderr: result.stderr };
}

export async function getAdminUsersData() {
    const admin = createAdmin();
    const authUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const users = authUsers.data?.users || [];
    const userIds = users.map((user) => user.id);
    const [profileMap, validations, aiConfigs, analytics] = await Promise.all([
        fetchProfiles(userIds),
        fetchValidations(1000),
        fetchAiConfigs(userIds),
        fetchAnalyticsEvents(30),
    ]);

    const validationCounts = new Map<string, number>();
    for (const row of validations) {
        const userId = String(row.user_id || "");
        validationCounts.set(userId, (validationCounts.get(userId) || 0) + 1);
    }

    const aiCounts = new Map<string, number>();
    for (const row of aiConfigs) {
        if (!row.is_active) continue;
        const userId = String(row.user_id || "");
        aiCounts.set(userId, (aiCounts.get(userId) || 0) + 1);
    }

    const lastActive = new Map<string, string>();
    for (const row of analytics) {
        const userId = String(row.user_id || "");
        if (userId && !lastActive.has(userId)) {
            lastActive.set(userId, String(row.created_at || ""));
        }
    }

    const items = users.map((user) => {
        const profile = profileMap.get(user.id);
        return {
            id: user.id,
            email: String(profile?.email || user.email || "unknown"),
            full_name: profile?.full_name ? String(profile.full_name) : null,
            plan: String(profile?.plan || "free"),
            role: normalizeProfileRole(profile?.role),
            last_active_at: lastActive.get(user.id) || null,
            validations_count: validationCounts.get(user.id) || 0,
            active_ai_configs: aiCounts.get(user.id) || 0,
            created_at: user.created_at || null,
        };
    }).sort((a, b) => Date.parse(String(b.created_at || "")) - Date.parse(String(a.created_at || "")));

    return {
        items,
        summary: {
            totalUsers: items.length,
            paidUsers: items.filter((row) => row.plan !== "free").length,
            admins: items.filter((row) => row.role === "admin" || row.role === "moderator").length,
            activeLast7d: items.filter((row) => row.last_active_at && Date.parse(String(row.last_active_at)) >= Date.parse(daysAgo(7))).length,
        },
    };
}

export async function updateUserPlanAsAdmin(userId: string, plan: string, actor: AdminActor) {
    const admin = createAdmin();
    const { error } = await admin.from("profiles").update({ plan }).eq("id", userId);
    if (error) throw error;
    await recordAdminEvent({
        actorUserId: actor.id,
        action: "user_plan_updated",
        targetType: "user",
        targetId: userId,
        message: `Updated user plan to ${plan}`,
        metadata: { plan },
    });
}

export async function updateUserRoleAsAdmin(userId: string, role: AdminProfileRole, actor: AdminActor) {
    const admin = createAdmin();
    const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
    if (error) throw error;
    await admin.auth.admin.updateUserById(userId, {
        app_metadata: { role, admin: role === "admin", founder: role === "admin" },
        user_metadata: { app_role: role, is_admin: role === "admin" },
    });
    await recordAdminEvent({
        actorUserId: actor.id,
        action: "user_role_updated",
        targetType: "user",
        targetId: userId,
        message: `Updated user role to ${role}`,
        metadata: { role },
    });
}

export async function getAdminAiData() {
    const [configs, users] = await Promise.all([fetchAiConfigs(), getAdminUsersData()]);
    const userMap = new Map(users.items.map((row) => [row.id, row]));
    return configs.map((row) => ({
        id: String(row.id || ""),
        user_id: String(row.user_id || ""),
        user_email: userMap.get(String(row.user_id || ""))?.email || String(row.user_id || ""),
        provider: String(row.provider || ""),
        provider_label: MODEL_CATALOG[String(row.provider || "")]?.name || String(row.provider || ""),
        selected_model: String(row.selected_model || ""),
        endpoint_url: row.endpoint_url ? String(row.endpoint_url) : null,
        is_active: Boolean(row.is_active),
        priority: toNumber(row.priority),
        created_at: row.created_at ? String(row.created_at) : null,
    }));
}

export async function getAdminMarketData() {
    const admin = createAdmin();
    const [ideaRows, runs] = await Promise.all([
        admin
            .from("ideas")
            .select(MARKET_AUDIT_IDEA_SELECT)
            .neq("confidence_level", "INSUFFICIENT")
            .order("current_score", { ascending: false })
            .limit(60),
        fetchLatestScraperRuns(),
    ]);

    const hydratedIdeas = ideaRows.error
        ? []
        : ((ideaRows.data || []) as unknown as Array<Record<string, unknown>>).map((row) => hydrateIdeaForMarket(row));
    const ideas = ideaRows.error ? [] : buildMarketIdeas((ideaRows.data || []) as unknown as Array<Record<string, unknown>>, { includeExploratory: true, surface: "admin" });
    const visibleIdeas = hydratedIdeas.filter((idea) => idea.visibility_decision.status === "visible");
    const visibilityBreakdown = [...hydratedIdeas.reduce((acc, idea) => {
        if (idea.visibility_decision.status === "visible") return acc;
        acc.set(idea.visibility_decision.reason, (acc.get(idea.visibility_decision.reason) || 0) + 1);
        return acc;
    }, new Map<string, number>()).entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({
            reason,
            label: MARKET_VISIBILITY_REASON_LABELS[reason as keyof typeof MARKET_VISIBILITY_REASON_LABELS] || reason,
            count,
        }));
    const editorialComparisons = ideas
        .map((idea) => {
            const editorial = parseMarketEditorial(idea.market_editorial);
            const approved = getApprovedMarketEditorial(idea.market_editorial);
            if (!editorial) return null;
            return {
                id: String(idea.id || idea.slug || ""),
                slug: String(idea.slug || ""),
                category: String(idea.category || "general"),
                heuristic_title: String(idea.public_title || idea.topic || ""),
                heuristic_summary: String(idea.public_summary || idea.pain_summary || ""),
                heuristic_verdict: String(idea.market_hint?.recommended_board_action || ""),
                ai_title: approved?.edited_title || String(editorial.edited_title || ""),
                ai_summary: approved?.edited_summary || String(editorial.edited_summary || ""),
                ai_verdict: approved?.verdict || String(editorial.verdict || ""),
                ai_next_step: approved?.next_step || String(editorial.next_step || ""),
                critic_visibility_decision: String(editorial.visibility_decision || "unknown"),
                quality_score: toNumber(editorial.quality_score),
                status: String(editorial.status || "unknown"),
                updated_at: String(editorial.updated_at || idea.market_editorial_updated_at || ""),
            };
        })
        .filter((item): item is {
            id: string;
            slug: string;
            category: string;
            heuristic_title: string;
            heuristic_summary: string;
            heuristic_verdict: string;
            ai_title: string;
            ai_summary: string;
            ai_verdict: string;
            ai_next_step: string;
            critic_visibility_decision: string;
            quality_score: number;
            status: string;
            updated_at: string;
        } => Boolean(item))
        .slice(0, 10);

    return {
        summary: {
            visibleIdeas: visibleIdeas.length,
            risingIdeas: visibleIdeas.filter((row) => String(row.trend_direction || "").toLowerCase() === "rising").length,
            fallingIdeas: visibleIdeas.filter((row) => String(row.trend_direction || "").toLowerCase() === "falling").length,
            needsWedge: ideas.filter((row) => String(row.market_status || "") === "needs_wedge").length,
            suppressedIdeas: hydratedIdeas.filter((row) => row.visibility_decision.status === "hidden").length,
            editorialReviewed: editorialComparisons.length,
            publishMode: getMarketEditorialPublishMode(),
        },
        sourceHealth: extractScraperRunHealth(runs[0] || null),
        topIdeas: visibleIdeas.slice(0, 12),
        editorialComparisons,
        visibilityBreakdown,
    };
}

export async function getAdminLogsData() {
    const admin = createAdmin();
    const [adminEvents, runs, validations, analytics, scraperRuntime] = await Promise.all([
        admin.from("admin_events").select("id, created_at, action, severity, message, metadata").order("created_at", { ascending: false }).limit(40),
        admin.from("scraper_runs").select("id, started_at, completed_at, status, error_text, source").order("started_at", { ascending: false }).limit(20),
        admin.from("idea_validations").select("id, created_at, status, idea_text, report").in("status", ["failed", "error", "timeout"]).order("created_at", { ascending: false }).limit(20),
        fetchAnalyticsEvents(7),
        getScraperRuntimeMonitor(),
    ]);

    const entries = buildRecentActivity({
        validations: toRows(validations.data),
        runs: toRows(runs.data),
        analytics: analytics.slice(0, 20),
        adminEvents: toRows(adminEvents.data),
    });

    return {
        entries: [...buildRuntimeLogEntries(scraperRuntime), ...entries]
            .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
            .slice(0, 40),
        scraperRuntime,
    };
}

export async function getAdminSettingsData() {
    return {
        runtimeSettings: await getRuntimeSettings(),
        capabilities: {
            scraperControl: Boolean(process.env.ADMIN_SCRAPER_COMMAND?.trim()),
            firstPartyAnalytics: true,
            aiVisibility: true,
        },
    };
}
