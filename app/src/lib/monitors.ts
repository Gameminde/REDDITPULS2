import { buildAlertEvidence, buildCompetitorComplaintEvidence, buildEvidenceBackedTrust, buildEvidenceSummary, buildOpportunityEvidence } from "@/lib/evidence";
import { buildBoardIntelligence } from "@/lib/opportunity-actionability";
import { buildOpportunityStrategyPreview, buildOpportunityStrategySnapshot } from "@/lib/opportunity-strategy";
import { buildWhyNowFromOpportunity } from "@/lib/why-now";
import { formatFreshnessLabel, getFreshnessHours, type TrustMetadata } from "@/lib/trust";
import { safeParseJson } from "@/lib/watchlist-data";
import type { MarketHydratedIdea } from "@/lib/market-feed";

export type MonitorType = "opportunity" | "validation" | "pain_theme";
export type LegacyMonitorType = "watchlist" | "alert" | "opportunity";
export type MonitorEventType = "score_change" | "confidence_change" | "pain_match" | "competitor_weakness" | "memory_change";
export type MonitorEventDirection = "up" | "down" | "new" | "neutral";
export type MonitorImpact = "HIGH" | "MEDIUM" | "LOW";

export interface MonitorEvent {
    id: string;
    monitor_id: string;
    event_type: MonitorEventType;
    direction: MonitorEventDirection;
    impact_level: MonitorImpact;
    summary: string;
    observed_at: string | null;
    href: string;
    source_label: string;
    seen?: boolean;
    metadata?: Record<string, unknown>;
}

export interface MonitorItem {
    id: string;
    legacy_type: LegacyMonitorType;
    legacy_id: string;
    monitor_type: MonitorType;
    title: string;
    subtitle: string;
    summary: string;
    created_at: string;
    last_checked_at: string | null;
    last_changed_at: string | null;
    status: "active" | "quiet";
    trust: TrustMetadata;
    target_href: string;
    tags: string[];
    metrics: Array<{ label: string; value: string; tone?: "build" | "risky" | "dont" | "default" }>;
    recent_events: MonitorEvent[];
    unread_count: number;
    data: Record<string, unknown>;
    strategy?: {
        posture: string;
        posture_rationale: string;
        strongest_reason: string;
        strongest_caution: string;
        readiness_score: number;
        why_now_category: string;
        why_now_momentum?: string;
        next_move_summary: string;
        next_move_recommended_action?: string;
        anti_idea_verdict?: string;
        anti_idea_summary?: string;
    } | null;
    memory?: {
        previous_state_summary: string;
        current_state_summary: string;
        delta_summary: string;
        direction: "strengthening" | "weakening" | "steady" | "new";
        new_evidence_note: string | null;
        confidence_change: string | null;
        timing_change_note: string | null;
        weakness_change_note: string | null;
        previous_productization_posture?: string | null;
        current_productization_posture?: string | null;
        readiness_score_change?: string | null;
        next_move_change_note?: string | null;
        anti_idea_change_note?: string | null;
        direct_vs_inferred: {
            direct_evidence_count: number;
            inferred_markers: string[];
        };
    } | null;
}

function truncate(text: string, limit = 110) {
    const value = String(text || "").trim();
    if (value.length <= limit) return value;
    return `${value.slice(0, limit - 1)}…`;
}

function buildId(parts: Array<string | number | null | undefined>) {
    return parts
        .filter((part) => part != null && String(part).length > 0)
        .map((part) => String(part).trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9:_-]/g, ""))
        .join(":");
}

function parseReport(report: unknown) {
    const parsed = safeParseJson(report);
    return typeof parsed === "object" && parsed ? parsed as Record<string, unknown> : {};
}

function extractKeywords(report: Record<string, unknown>) {
    return Array.isArray(report.keywords)
        ? report.keywords.map(String).filter(Boolean).slice(0, 4)
        : [];
}

function extractCompetitorNames(report: Record<string, unknown>) {
    const landscape = (report.competition_landscape || {}) as Record<string, unknown>;
    const direct = Array.isArray(landscape.direct_competitors) ? landscape.direct_competitors : [];

    return direct
        .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object" && "name" in item) return String((item as Record<string, unknown>).name || "");
            return "";
        })
        .map((name) => name.trim())
        .filter(Boolean);
}

function eventImpactFromValue(value: number): MonitorImpact {
    const magnitude = Math.abs(value);
    if (magnitude >= 12) return "HIGH";
    if (magnitude >= 5) return "MEDIUM";
    return "LOW";
}

function toneFromDelta(value: number): "build" | "dont" | "default" {
    if (value > 0) return "build";
    if (value < 0) return "dont";
    return "default";
}

function toneFromReadiness(value: number): "build" | "risky" | "dont" {
    if (value >= 65) return "build";
    if (value >= 35) return "risky";
    return "dont";
}

function parseIso(value: unknown) {
    if (!value) return null;
    const parsed = Date.parse(String(value));
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toISOString();
}

function normalizeStrategyPreview(raw: unknown): MonitorItem["strategy"] {
    if (!raw || typeof raw !== "object") return null;
    const entry = raw as Record<string, unknown>;
    const posture = String(entry.posture || "").trim();
    if (!posture) return null;
    return {
        posture,
        posture_rationale: String(entry.posture_rationale || ""),
        strongest_reason: String(entry.strongest_reason || ""),
        strongest_caution: String(entry.strongest_caution || ""),
        readiness_score: Number(entry.readiness_score || 0),
        why_now_category: String(entry.why_now_category || ""),
        why_now_momentum: String(entry.why_now_momentum || ""),
        next_move_summary: String(entry.next_move_summary || ""),
        next_move_recommended_action: String(entry.next_move_recommended_action || ""),
        anti_idea_verdict: String(entry.anti_idea_verdict || ""),
        anti_idea_summary: String(entry.anti_idea_summary || ""),
    };
}

function sortEvents(events: MonitorEvent[]) {
    return [...events].sort((a, b) => {
        const aTime = a.observed_at ? Date.parse(a.observed_at) : 0;
        const bTime = b.observed_at ? Date.parse(b.observed_at) : 0;
        return bTime - aTime;
    });
}

function buildNativeTrust(row: any, metadataData: Record<string, unknown>, observedAt: string | null): TrustMetadata {
    const freshnessHours = getFreshnessHours(observedAt);
    const evidenceCount = Number(
        metadataData?.evidence_count
        || (metadataData?.memory_hints as Record<string, unknown> | undefined)?.evidence_count
        || 0,
    );
    const directEvidenceCount = Number(metadataData?.direct_evidence_count || 0);
    const directQuoteCount = Number(metadataData?.direct_quote_count || 0);
    const sourceCount = Number(metadataData?.source_count || 0);
    const level = String(row.trust_level || "MEDIUM").toUpperCase();
    const normalizedLevel = level === "HIGH" || level === "LOW" ? level : "MEDIUM";

    return {
        level: normalizedLevel as TrustMetadata["level"],
        label: normalizedLevel === "HIGH" ? "High trust" : normalizedLevel === "LOW" ? "Low trust" : "Moderate trust",
        score: Math.max(0, Math.min(100, Math.round(Number(row.trust_score || 0)))),
        evidence_count: evidenceCount,
        direct_evidence_count: directEvidenceCount,
        direct_quote_count: directQuoteCount,
        source_count: sourceCount,
        freshness_hours: freshnessHours,
        freshness_label: formatFreshnessLabel(freshnessHours),
        weak_signal: normalizedLevel === "LOW" || evidenceCount < 3 || sourceCount < 2,
        weak_signal_reasons: [
            ...(normalizedLevel === "LOW" ? ["Low persisted trust score"] : []),
            ...(evidenceCount > 0 && evidenceCount < 3 ? ["Few persisted evidence points"] : []),
            ...(sourceCount > 0 && sourceCount < 2 ? ["Limited source diversity"] : []),
        ],
        inference_flags: ["This monitor was reconstructed from native monitor storage, not a live legacy watchlist row."],
    };
}

export function buildNativeStandaloneMonitor(
    row: any,
    nativeEvents: Array<Record<string, unknown>> = [],
): MonitorItem | null {
    const metadata = safeParseJson(row.metadata);
    const parsedMetadata = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
    const metadataData = parsedMetadata.data && typeof parsedMetadata.data === "object"
        ? parsedMetadata.data as Record<string, unknown>
        : {};
    const metrics = Array.isArray(parsedMetadata.metrics)
        ? parsedMetadata.metrics
            .map((metric) => {
                if (!metric || typeof metric !== "object") return null;
                const entry = metric as Record<string, unknown>;
                return {
                    label: String(entry.label || "Metric"),
                    value: String(entry.value || "-"),
                    tone: ["build", "risky", "dont", "default"].includes(String(entry.tone || "default"))
                        ? String(entry.tone || "default") as "build" | "risky" | "dont" | "default"
                        : "default",
                };
            })
            .filter(Boolean) as MonitorItem["metrics"]
        : [];
    const tags = Array.isArray(parsedMetadata.tags) ? parsedMetadata.tags.map(String).filter(Boolean) : [];
    const observedAt = parseIso(row.last_checked_at || row.last_changed_at || row.created_at);
    const trust = buildNativeTrust(row, metadataData, observedAt);
    const events = sortEvents(nativeEvents.map((event) => ({
        id: String(event.event_key || event.id || `${row.id}:event`),
        monitor_id: String(row.id),
        event_type: String(event.event_type || "memory_change") as MonitorEventType,
        direction: String(event.direction || "neutral") as MonitorEventDirection,
        impact_level: String(event.impact_level || "LOW") as MonitorImpact,
        summary: String(event.summary || "Monitor updated"),
        observed_at: parseIso(event.observed_at || event.created_at),
        href: String(event.href || row.target_ref || "/dashboard/saved"),
        source_label: String(event.source_label || "Monitor"),
        seen: Boolean(event.seen),
        metadata: safeParseJson(event.metadata) as Record<string, unknown> | undefined,
    }))).slice(0, 6);

    const status = String(row.status || "quiet") === "active" ? "active" : "quiet";
    const monitorType = String(row.monitor_type || "validation");
    const subtitle = String(row.subtitle || (monitorType === "validation" ? "Validation monitor" : "Saved monitor"));
    const summary = String(parsedMetadata.summary || "Monitor restored from native storage.");
    const strategy = normalizeStrategyPreview(metadataData.strategy_preview);

    return {
        id: String(row.id),
        legacy_type: String(row.legacy_type || "watchlist") as LegacyMonitorType,
        legacy_id: String(row.legacy_id || row.id),
        monitor_type: (monitorType === "opportunity" || monitorType === "pain_theme") ? monitorType : "validation",
        title: truncate(String(row.title || "Saved monitor"), 120),
        subtitle,
        summary: truncate(summary, 180),
        created_at: String(row.created_at || new Date().toISOString()),
        last_checked_at: parseIso(row.last_checked_at),
        last_changed_at: parseIso(row.last_changed_at) || events[0]?.observed_at || observedAt,
        status,
        trust,
        target_href: String(row.target_ref || "/dashboard/saved"),
        tags,
        metrics,
        recent_events: events,
        unread_count: events.filter((event) => !event.seen).length,
        data: metadataData,
        strategy,
        memory: null,
    };
}

export function buildWatchlistMonitor(
    row: any,
    complaints: Array<Record<string, unknown>> = [],
): MonitorItem | null {
    if (row.idea_validations) {
        const validation = row.idea_validations;
        const report = parseReport(validation.report);
        const marketPulse = typeof report.market_pulse === "object" && report.market_pulse ? report.market_pulse as Record<string, unknown> : {};
        const delta = Number(marketPulse.delta || 0);
        const pulseUpdatedAt = parseIso(marketPulse.last_updated_at);
        const keywords = extractKeywords(report);
        const competitorNames = extractCompetitorNames(report);
        const events: MonitorEvent[] = [];

        if (pulseUpdatedAt && Math.abs(delta) > 0) {
            events.push({
                id: buildId(["watchlist", row.id, "pulse", pulseUpdatedAt]),
                monitor_id: buildId(["watchlist", row.id]),
                event_type: "confidence_change",
                direction: delta > 0 ? "up" : delta < 0 ? "down" : "neutral",
                impact_level: eventImpactFromValue(delta),
                summary: `Validation confidence ${delta > 0 ? "rose" : "fell"} ${Math.abs(delta).toFixed(0)} points since the last market pulse.`,
                observed_at: pulseUpdatedAt,
                href: `/dashboard/reports/${validation.id}`,
                source_label: "Market Pulse",
                seen: false,
                metadata: { delta },
            });
        }

        for (const complaint of complaints) {
            const mentioned = Array.isArray(complaint.competitors_mentioned)
                ? complaint.competitors_mentioned.map(String).map((name) => name.toLowerCase())
                : [];

            if (!competitorNames.some((name) => mentioned.includes(name.toLowerCase()))) {
                continue;
            }

            const score = Number(complaint.post_score || 0);
            events.push({
                id: buildId(["watchlist", row.id, "competitor", complaint.id || complaint.post_title]),
                monitor_id: buildId(["watchlist", row.id]),
                event_type: "competitor_weakness",
                direction: "new",
                impact_level: eventImpactFromValue(score),
                summary: `Fresh public complaint against ${Array.isArray(complaint.competitors_mentioned) ? complaint.competitors_mentioned.slice(0, 2).join(", ") : "a competitor"}.`,
                observed_at: parseIso(complaint.scraped_at),
                href: String(complaint.post_url || "/dashboard/competitors"),
                source_label: complaint.subreddit ? `r/${String(complaint.subreddit)}` : "Competitor signal",
                seen: false,
                metadata: {
                    complaint_signals: complaint.complaint_signals || [],
                },
            });
        }

        const sortedEvents = sortEvents(events).slice(0, 4);

        return {
            id: buildId(["watchlist", row.id]),
            legacy_type: "watchlist",
            legacy_id: String(row.id),
            monitor_type: "validation",
            title: truncate(validation.idea_text, 120),
            subtitle: "Validation monitor",
            summary: truncate(String(report.executive_summary || "Track confidence, evidence quality, and movement around this idea."), 180),
            created_at: row.added_at,
            last_checked_at: pulseUpdatedAt || validation.completed_at || validation.created_at,
            last_changed_at: sortedEvents[0]?.observed_at || pulseUpdatedAt || validation.completed_at || validation.created_at,
            status: sortedEvents.length > 0 ? "active" : "quiet",
            trust: validation.trust,
            target_href: `/dashboard/reports/${validation.id}`,
            tags: keywords,
            metrics: [
                { label: "Confidence", value: `${Number(validation.confidence || report.confidence || 0)}%`, tone: "default" },
                { label: "Pulse", value: pulseUpdatedAt ? `${delta > 0 ? "+" : ""}${delta.toFixed(0)} pts` : "No pulse", tone: toneFromDelta(delta) },
                { label: "Evidence", value: `${validation.trust?.evidence_count || 0}`, tone: "default" },
            ],
            recent_events: sortedEvents,
            unread_count: sortedEvents.length,
            data: {
                validation_id: validation.id,
                notes: row.notes || "",
                alert_threshold: row.alert_threshold ?? null,
                memory_hints: {
                    primary_metric_label: "Confidence",
                    primary_metric_value: Number(validation.confidence || report.confidence || 0),
                    secondary_metric_label: "Pulse delta",
                    secondary_metric_value: Number(delta || 0),
                    evidence_count: Number(validation.trust?.evidence_count || 0),
                    timing_category: null,
                    timing_momentum: delta > 0 ? "accelerating" : delta < 0 ? "cooling" : "steady",
                    weakness_signal_count: events.filter((event) => event.event_type === "competitor_weakness").length,
                },
            },
            memory: null,
        };
    }

    if (row.ideas) {
        const idea = row.ideas;
        const delta = Number(idea.change_24h || 0);
        const changedAt = parseIso(idea.last_updated);
        const events: MonitorEvent[] = [];
        const opportunityEvidence = buildOpportunityEvidence(idea, 4);
        const evidenceSummary = buildEvidenceSummary(opportunityEvidence);
        const strategy = buildOpportunityStrategySnapshot({
            ...(idea as Record<string, unknown>),
            id: String(idea.id || ""),
            slug: String(idea.slug || ""),
            topic: String(idea.topic || ""),
            category: String(idea.category || ""),
            trust: idea.trust,
            evidence: opportunityEvidence,
            evidence_summary: evidenceSummary,
        });
        const strategyPreview = buildOpportunityStrategyPreview(strategy);
        const whyNow = buildWhyNowFromOpportunity({
            ...idea,
            trust: idea.trust,
        }, true);

        if (Math.abs(delta) > 0 && changedAt) {
            events.push({
                id: buildId(["watchlist", row.id, "idea", changedAt]),
                monitor_id: buildId(["watchlist", row.id]),
                event_type: "score_change",
                direction: delta > 0 ? "up" : delta < 0 ? "down" : "neutral",
                impact_level: eventImpactFromValue(delta),
                summary: `Opportunity score ${delta > 0 ? "rose" : "fell"} ${Math.abs(delta).toFixed(1)} points in the last 24 hours.`,
                observed_at: changedAt,
                href: `/dashboard/idea/${idea.slug}`,
                source_label: "Opportunity pulse",
                seen: false,
                metadata: { delta },
            });
        }

        const sortedEvents = sortEvents(events).slice(0, 3);

        return {
            id: buildId(["watchlist", row.id]),
            legacy_type: "watchlist",
            legacy_id: String(row.id),
            monitor_type: "opportunity",
            title: String(idea.topic || "Saved opportunity"),
            subtitle: "Opportunity monitor",
            summary: truncate(String(idea.pain_summary || `Track whether this ${String(idea.category || "market").replace(/-/g, " ")} wedge is gaining momentum.`), 180),
            created_at: row.added_at,
            last_checked_at: changedAt,
            last_changed_at: sortedEvents[0]?.observed_at || changedAt,
            status: sortedEvents.length > 0 ? "active" : "quiet",
            trust: idea.trust,
            target_href: `/dashboard/idea/${idea.slug}`,
            tags: [String(idea.category || "")].filter(Boolean),
            metrics: [
                { label: "Score", value: `${Math.round(Number(idea.current_score || 0))}`, tone: "default" },
                { label: "24h move", value: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`, tone: toneFromDelta(delta) },
                { label: "Trend", value: String(idea.trend_direction || "stable"), tone: "default" },
            ],
            recent_events: sortedEvents,
            unread_count: sortedEvents.length,
            data: {
                idea_id: idea.id,
                notes: row.notes || "",
                alert_threshold: row.alert_threshold ?? null,
                strategy_preview: strategyPreview,
                memory_hints: {
                    primary_metric_label: "Score",
                    primary_metric_value: Number(idea.current_score || 0),
                    secondary_metric_label: "24h move",
                    secondary_metric_value: Number(delta || 0),
                    evidence_count: Number(idea.trust?.evidence_count || 0),
                    timing_category: whyNow.timing_category,
                    timing_momentum: whyNow.momentum_direction,
                    weakness_signal_count: 0,
                    productization_posture: strategyPreview.posture,
                    readiness_score: strategyPreview.readiness_score,
                    next_move_summary: strategyPreview.next_move_summary,
                    anti_idea_verdict: strategyPreview.anti_idea_verdict || null,
                },
            },
            strategy: strategyPreview,
            memory: null,
        };
    }

    return null;
}

export function buildAlertMonitor(alert: Record<string, unknown>, matches: Array<Record<string, unknown>>) {
    const evidence = buildAlertEvidence(alert, matches);
    const evidenceSummary = buildEvidenceSummary(evidence);
    const trust = buildEvidenceBackedTrust({
        items: evidence,
        extraWeakSignalReasons: matches.length === 0 ? ["No live matches yet"] : [],
    });

    const events = sortEvents(matches.map((match, index) => ({
        id: buildId([
            "alert",
            alert.id ? String(alert.id) : "unknown",
            "match",
            match.id ? String(match.id) : index,
        ]),
        monitor_id: buildId(["alert", alert.id ? String(alert.id) : "unknown"]),
        event_type: "pain_match" as const,
        direction: "new" as const,
        impact_level: eventImpactFromValue(Number(match.post_score || 0)),
        summary: `New pain match: ${String(match.post_title || "Untitled post")}`,
        observed_at: parseIso(match.matched_at),
        href: String(match.post_url || "/dashboard/alerts"),
        source_label: match.subreddit ? `r/${String(match.subreddit)}` : "Pain Stream",
        seen: Boolean(match.seen),
        metadata: {
            matched_keywords: match.matched_keywords || [],
        },
    }))).slice(0, 6);

    const keywords = Array.isArray(alert.keywords) ? alert.keywords.map(String).filter(Boolean) : [];
    const subreddits = Array.isArray(alert.subreddits) ? alert.subreddits.map(String).filter(Boolean) : [];

    return {
        id: buildId(["alert", alert.id ? String(alert.id) : "unknown"]),
        legacy_type: "alert" as const,
        legacy_id: String(alert.id),
        monitor_type: "pain_theme" as const,
        title: truncate(keywords.join(" • ") || "Pain theme monitor", 90),
        subtitle: "Pain theme monitor",
        summary: truncate(
            `Watching ${subreddits.length || 0} communities for repeated pain around ${keywords.slice(0, 4).join(", ") || "your saved keywords"}.`,
            180,
        ),
        created_at: String(alert.created_at || new Date().toISOString()),
        last_checked_at: parseIso(alert.last_checked),
        last_changed_at: events[0]?.observed_at || parseIso(alert.last_checked),
        status: events.length > 0 ? "active" : "quiet",
        trust,
        target_href: "/dashboard/alerts",
        tags: keywords.slice(0, 4),
        metrics: [
            { label: "New matches", value: `${matches.length}`, tone: matches.length > 0 ? "build" : "default" },
            { label: "Min score", value: `${Number(alert.min_score || 0)}`, tone: "default" },
            { label: "Direct proof", value: `${evidenceSummary.direct_evidence_count}`, tone: "default" },
        ],
        recent_events: events,
        unread_count: events.filter((event) => !event.seen).length,
        data: {
            alert_id: alert.id,
            keywords,
            subreddits,
            evidence_summary: evidenceSummary,
            memory_hints: {
                primary_metric_label: "Matches",
                primary_metric_value: matches.length,
                secondary_metric_label: "Direct proof",
                secondary_metric_value: evidenceSummary.direct_evidence_count,
                evidence_count: Number(trust.evidence_count || evidenceSummary.evidence_count || 0),
                timing_category: null,
                timing_momentum: matches.length > 0 ? "accelerating" : "steady",
                weakness_signal_count: 0,
            },
        },
        strategy: null,
        memory: null,
    } satisfies MonitorItem;
}

export function buildOpportunityWatchMonitor(input: {
    opportunity: Record<string, unknown>;
    primaryIdea: MarketHydratedIdea;
}): MonitorItem {
    const { opportunity, primaryIdea } = input;
    const opportunityId = String(opportunity.id || "");
    const boardIntelligence = buildBoardIntelligence(primaryIdea);
    const readinessScore = Number(boardIntelligence.readiness.score || primaryIdea.strategy_preview?.readiness_score || 0);
    const delta = Number(primaryIdea.change_24h || 0);
    const changedAt = parseIso(primaryIdea.last_updated || primaryIdea.updated_at || opportunity.updated_at);
    const title = String(opportunity.label || primaryIdea.suggested_wedge_label || primaryIdea.topic || "Opportunity watch");
    const events: MonitorEvent[] = [];

    if (Math.abs(delta) >= 2 && changedAt) {
        events.push({
            id: buildId(["opportunity", opportunityId || String(primaryIdea.slug || ""), "score", changedAt]),
            monitor_id: buildId(["opportunity", opportunityId || String(primaryIdea.slug || "")]),
            event_type: "score_change",
            direction: delta > 0 ? "up" : "down",
            impact_level: eventImpactFromValue(delta),
            summary: `Primary market signal ${delta > 0 ? "rose" : "fell"} ${Math.abs(delta).toFixed(1)} points in the last 24 hours.`,
            observed_at: changedAt,
            href: `/dashboard/opportunities#opportunity-${opportunityId}`,
            source_label: "Opportunity Board",
            seen: false,
            metadata: { delta },
        });
    }

    const sortedEvents = sortEvents(events).slice(0, 4);
    const directEvidenceCount = Number(boardIntelligence.evidence_snapshot.direct_evidence_count || 0);
    const evidenceCount = Number(primaryIdea.trust?.evidence_count || boardIntelligence.evidence_snapshot.evidence_count || 0);
    const strategyPreview = primaryIdea.strategy_preview;
    const boardStaleReason = primaryIdea.board_stale_reason || null;

    return {
        id: buildId(["opportunity", opportunityId || String(primaryIdea.slug || "")]),
        legacy_type: "opportunity",
        legacy_id: opportunityId,
        monitor_type: "opportunity",
        title,
        subtitle: "Opportunity watch",
        summary: truncate(
            boardIntelligence.summary_line
            || String(opportunity.icp_summary || "")
            || `Track whether ${title} is strengthening or weakening before you commit more.`,
            180,
        ),
        created_at: String(opportunity.created_at || new Date().toISOString()),
        last_checked_at: changedAt || new Date().toISOString(),
        last_changed_at: sortedEvents[0]?.observed_at || changedAt || String(opportunity.updated_at || opportunity.created_at || new Date().toISOString()),
        status: primaryIdea.board_eligible ? "active" : "quiet",
        trust: primaryIdea.trust,
        target_href: `/dashboard/opportunities#opportunity-${opportunityId}`,
        tags: [String(opportunity.category || primaryIdea.category || ""), primaryIdea.market_status === "needs_wedge" ? "Needs wedge" : ""].filter(Boolean),
        metrics: [
            { label: "Score", value: `${Math.round(Number(primaryIdea.current_score || 0))}`, tone: "default" },
            { label: "Readiness", value: `${Math.round(readinessScore)}`, tone: toneFromReadiness(readinessScore) },
            { label: "Direct proof", value: `${directEvidenceCount}`, tone: "default" },
        ],
        recent_events: sortedEvents,
        unread_count: sortedEvents.length,
        data: {
            opportunity_id: opportunityId,
            primary_idea_slug: String(opportunity.primary_idea_slug || primaryIdea.slug || ""),
            source_idea_slugs: Array.isArray(opportunity.source_idea_slugs) ? opportunity.source_idea_slugs : [],
            board_stale_reason: boardStaleReason,
            board_intelligence: boardIntelligence,
            strategy_preview: strategyPreview,
            memory_hints: {
                primary_metric_label: "Readiness",
                primary_metric_value: readinessScore,
                secondary_metric_label: "Trust",
                secondary_metric_value: Number(primaryIdea.trust?.score || 0),
                evidence_count: evidenceCount,
                timing_category: strategyPreview?.why_now_category || null,
                timing_momentum: strategyPreview?.why_now_momentum || null,
                weakness_signal_count: boardStaleReason ? 1 : 0,
                productization_posture: strategyPreview?.posture || null,
                readiness_score: readinessScore,
                next_move_summary: boardIntelligence.recommended_action,
                anti_idea_verdict: strategyPreview?.anti_idea_verdict || null,
                strongest_caution: boardIntelligence.strongest_caution,
                stale_reason: boardStaleReason,
            },
        },
        strategy: strategyPreview,
        memory: null,
    };
}

export function toNativeMonitorRow(userId: string, monitor: MonitorItem) {
    return {
        user_id: userId,
        legacy_type: monitor.legacy_type,
        legacy_id: monitor.legacy_id,
        monitor_type: monitor.monitor_type,
        target_ref: monitor.target_href,
        title: monitor.title,
        subtitle: monitor.subtitle,
        status: monitor.status,
        trust_level: monitor.trust.level,
        trust_score: monitor.trust.score,
        last_checked_at: monitor.last_checked_at,
        last_changed_at: monitor.last_changed_at,
        metadata: {
            summary: monitor.summary,
            tags: monitor.tags,
            metrics: monitor.metrics,
            data: monitor.data,
        },
    };
}

export function toNativeMonitorEvents(userId: string, nativeMonitorId: string, events: MonitorEvent[]) {
    return events.map((event) => ({
        user_id: userId,
        monitor_id: nativeMonitorId,
        event_key: event.id,
        event_type: event.event_type,
        direction: event.direction,
        impact_level: event.impact_level,
        summary: event.summary,
        source_label: event.source_label,
        href: event.href,
        observed_at: event.observed_at,
        seen: Boolean(event.seen),
        metadata: event.metadata || {},
    }));
}
