import { createHash } from "crypto";

export type MemoryDirection = "strengthening" | "weakening" | "steady" | "new";

export interface MonitorMemoryHints {
    primary_metric_label: string | null;
    primary_metric_value: number | null;
    secondary_metric_label: string | null;
    secondary_metric_value: number | null;
    evidence_count: number;
    timing_category: string | null;
    timing_momentum: string | null;
    weakness_signal_count: number;
    productization_posture: string | null;
    readiness_score: number | null;
    next_move_summary: string | null;
    anti_idea_verdict: string | null;
    strongest_caution: string | null;
    stale_reason: string | null;
}

export interface MonitorMemoryState {
    version: "v2";
    summary: string;
    trust_score: number;
    evidence_count: number;
    primary_metric_label: string | null;
    primary_metric_value: number | null;
    secondary_metric_label: string | null;
    secondary_metric_value: number | null;
    timing_category: string | null;
    timing_momentum: string | null;
    weakness_signal_count: number;
    productization_posture: string | null;
    readiness_score: number | null;
    next_move_summary: string | null;
    anti_idea_verdict: string | null;
    strongest_caution: string | null;
    stale_reason: string | null;
    status: string;
    captured_at: string;
}

export interface MonitorMemoryDelta {
    previous_state_summary: string;
    current_state_summary: string;
    delta_summary: string;
    direction: MemoryDirection;
    new_evidence_note: string | null;
    confidence_change: string | null;
    timing_change_note: string | null;
    weakness_change_note: string | null;
    previous_productization_posture: string | null;
    current_productization_posture: string | null;
    readiness_score_change: string | null;
    next_move_change_note: string | null;
    anti_idea_change_note: string | null;
    caution_change_note: string | null;
    stale_reason_change_note: string | null;
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

interface MemoryMonitorLike {
    title: string;
    summary: string;
    status: string;
    trust: {
        score: number;
        direct_evidence_count?: number;
    };
    data?: {
        memory_hints?: Partial<MonitorMemoryHints>;
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function numberOrNull(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function summarizeState(state: MonitorMemoryState) {
    const primary = state.primary_metric_label && state.primary_metric_value != null
        ? `${state.primary_metric_label} ${state.primary_metric_value}`
        : null;
    const timing = state.timing_category ? state.timing_category : null;
    const posture = state.productization_posture ? state.productization_posture : null;
    const evidence = `${state.evidence_count} evidence`;
    const staleReason = state.stale_reason ? `stale: ${state.stale_reason}` : null;
    return [primary, posture, timing, evidence, staleReason].filter(Boolean).join(" | ");
}

function hintsFromMonitor(monitor: MemoryMonitorLike): MonitorMemoryHints {
    const raw = isRecord(monitor.data?.memory_hints) ? monitor.data.memory_hints : {};
    return {
        primary_metric_label: stringOrNull(raw.primary_metric_label),
        primary_metric_value: numberOrNull(raw.primary_metric_value),
        secondary_metric_label: stringOrNull(raw.secondary_metric_label),
        secondary_metric_value: numberOrNull(raw.secondary_metric_value),
        evidence_count: Number(raw.evidence_count || 0),
        timing_category: stringOrNull(raw.timing_category),
        timing_momentum: stringOrNull(raw.timing_momentum),
        weakness_signal_count: Number(raw.weakness_signal_count || 0),
        productization_posture: stringOrNull(raw.productization_posture),
        readiness_score: numberOrNull(raw.readiness_score),
        next_move_summary: stringOrNull(raw.next_move_summary),
        anti_idea_verdict: stringOrNull(raw.anti_idea_verdict),
        strongest_caution: stringOrNull(raw.strongest_caution),
        stale_reason: stringOrNull(raw.stale_reason),
    };
}

export function buildMonitorMemoryState(monitor: MemoryMonitorLike): MonitorMemoryState {
    const hints = hintsFromMonitor(monitor);

    return {
        version: "v2",
        summary: String(monitor.summary || monitor.title || "Monitor state"),
        trust_score: Number(monitor.trust?.score || 0),
        evidence_count: hints.evidence_count,
        primary_metric_label: hints.primary_metric_label,
        primary_metric_value: hints.primary_metric_value,
        secondary_metric_label: hints.secondary_metric_label,
        secondary_metric_value: hints.secondary_metric_value,
        timing_category: hints.timing_category,
        timing_momentum: hints.timing_momentum,
        weakness_signal_count: hints.weakness_signal_count,
        productization_posture: hints.productization_posture,
        readiness_score: hints.readiness_score,
        next_move_summary: hints.next_move_summary,
        anti_idea_verdict: hints.anti_idea_verdict,
        strongest_caution: hints.strongest_caution,
        stale_reason: hints.stale_reason,
        status: String(monitor.status || "quiet"),
        captured_at: new Date().toISOString(),
    };
}

export function createSnapshotHash(state: MonitorMemoryState) {
    const stable = {
        ...state,
        captured_at: null,
    };
    return createHash("sha1").update(JSON.stringify(stable)).digest("hex");
}

export function normalizeStoredState(raw: unknown): MonitorMemoryState | null {
    if (!isRecord(raw)) return null;
    return {
        version: "v2",
        summary: String(raw.summary || ""),
        trust_score: Number(raw.trust_score || 0),
        evidence_count: Number(raw.evidence_count || 0),
        primary_metric_label: stringOrNull(raw.primary_metric_label),
        primary_metric_value: numberOrNull(raw.primary_metric_value),
        secondary_metric_label: stringOrNull(raw.secondary_metric_label),
        secondary_metric_value: numberOrNull(raw.secondary_metric_value),
        timing_category: stringOrNull(raw.timing_category),
        timing_momentum: stringOrNull(raw.timing_momentum),
        weakness_signal_count: Number(raw.weakness_signal_count || 0),
        productization_posture: stringOrNull(raw.productization_posture),
        readiness_score: numberOrNull(raw.readiness_score),
        next_move_summary: stringOrNull(raw.next_move_summary),
        anti_idea_verdict: stringOrNull(raw.anti_idea_verdict),
        strongest_caution: stringOrNull(raw.strongest_caution),
        stale_reason: stringOrNull(raw.stale_reason),
        status: String(raw.status || "quiet"),
        captured_at: String(raw.captured_at || new Date().toISOString()),
    };
}

export function normalizeStoredDelta(raw: unknown): MonitorMemoryDelta | null {
    if (!isRecord(raw)) return null;
    return {
        previous_state_summary: String(raw.previous_state_summary || ""),
        current_state_summary: String(raw.current_state_summary || ""),
        delta_summary: String(raw.delta_summary || ""),
        direction: (["strengthening", "weakening", "steady", "new"].includes(String(raw.direction)) ? raw.direction : "steady") as MemoryDirection,
        new_evidence_note: stringOrNull(raw.new_evidence_note),
        confidence_change: stringOrNull(raw.confidence_change),
        timing_change_note: stringOrNull(raw.timing_change_note),
        weakness_change_note: stringOrNull(raw.weakness_change_note),
        previous_productization_posture: stringOrNull(raw.previous_productization_posture),
        current_productization_posture: stringOrNull(raw.current_productization_posture),
        readiness_score_change: stringOrNull(raw.readiness_score_change),
        next_move_change_note: stringOrNull(raw.next_move_change_note),
        anti_idea_change_note: stringOrNull(raw.anti_idea_change_note),
        caution_change_note: stringOrNull(raw.caution_change_note),
        stale_reason_change_note: stringOrNull(raw.stale_reason_change_note),
        direct_vs_inferred: {
            direct_evidence_count: Number((isRecord(raw.direct_vs_inferred) ? raw.direct_vs_inferred.direct_evidence_count : 0) || 0),
            inferred_markers: isRecord(raw.direct_vs_inferred) && Array.isArray(raw.direct_vs_inferred.inferred_markers)
                ? raw.direct_vs_inferred.inferred_markers.map(String)
                : [],
        },
    };
}

function postureStrength(posture: string | null) {
    if (!posture) return 0;
    if (posture === "Productize now") return 85;
    if (posture === "Start hybrid service + software") return 72;
    if (posture === "Stay service-first") return 58;
    if (posture === "Concierge MVP first") return 48;
    if (posture === "Wait and validate more first") return 28;
    return 0;
}

function antiIdeaSeverity(verdict: string | null) {
    if (!verdict) return 50;
    if (verdict === "LOW_CONCERN") return 20;
    if (verdict === "WAIT") return 55;
    if (verdict === "PIVOT") return 68;
    if (verdict === "KILL_FOR_NOW") return 90;
    return 50;
}

export function buildMonitorMemoryDelta(previous: MonitorMemoryState | null, current: MonitorMemoryState, directEvidenceCount = 0): MonitorMemoryDelta | null {
    if (!previous) return null;

    const trustDelta = current.trust_score - previous.trust_score;
    const evidenceDelta = current.evidence_count - previous.evidence_count;
    const primaryDelta =
        current.primary_metric_value != null && previous.primary_metric_value != null
            ? current.primary_metric_value - previous.primary_metric_value
            : 0;
    const weaknessDelta = current.weakness_signal_count - previous.weakness_signal_count;
    const readinessDelta =
        current.readiness_score != null && previous.readiness_score != null
            ? current.readiness_score - previous.readiness_score
            : 0;
    const postureDelta = postureStrength(current.productization_posture) - postureStrength(previous.productization_posture);
    const antiIdeaDelta = antiIdeaSeverity(previous.anti_idea_verdict) - antiIdeaSeverity(current.anti_idea_verdict);
    const timingChanged = current.timing_category !== previous.timing_category || current.timing_momentum !== previous.timing_momentum;
    const statusChanged = current.status !== previous.status;
    const postureChanged = current.productization_posture !== previous.productization_posture;
    const nextMoveChanged =
        Boolean(current.next_move_summary)
        && Boolean(previous.next_move_summary)
        && current.next_move_summary !== previous.next_move_summary;
    const antiIdeaChanged = current.anti_idea_verdict !== previous.anti_idea_verdict;
    const cautionChanged = current.strongest_caution !== previous.strongest_caution;
    const staleReasonChanged = current.stale_reason !== previous.stale_reason;

    const changed =
        Math.abs(trustDelta) >= 5 ||
        Math.abs(primaryDelta) > 0 ||
        evidenceDelta > 0 ||
        weaknessDelta !== 0 ||
        Math.abs(readinessDelta) >= 5 ||
        postureChanged ||
        nextMoveChanged ||
        antiIdeaChanged ||
        cautionChanged ||
        staleReasonChanged ||
        timingChanged ||
        statusChanged;

    if (!changed) return null;

    let direction: MemoryDirection = "steady";
    if (!previous) {
        direction = "new";
    } else if (trustDelta > 0 || primaryDelta > 0 || evidenceDelta > 0 || readinessDelta > 0 || postureDelta > 0 || antiIdeaDelta > 0) {
        direction = "strengthening";
    } else if (trustDelta < 0 || primaryDelta < 0 || readinessDelta < 0 || postureDelta < 0 || antiIdeaDelta < 0 || current.status === "quiet") {
        direction = "weakening";
    }
    if (staleReasonChanged) {
        direction = current.stale_reason ? "weakening" : "strengthening";
    }

    const confidenceChange = Math.abs(trustDelta) >= 5
        ? `Trust ${trustDelta > 0 ? "rose" : "fell"} ${Math.abs(trustDelta)} points.`
        : null;

    const newEvidenceNote = evidenceDelta > 0
        ? `${evidenceDelta} new evidence item${evidenceDelta === 1 ? "" : "s"} appeared since the last check.`
        : null;

    const timingChangeNote = timingChanged
        ? `Timing moved from ${previous.timing_category || "unknown"} / ${previous.timing_momentum || "unknown"} to ${current.timing_category || "unknown"} / ${current.timing_momentum || "unknown"}.`
        : null;

    const weaknessChangeNote = weaknessDelta !== 0
        ? `Competitor weakness signal count ${weaknessDelta > 0 ? "increased" : "decreased"} by ${Math.abs(weaknessDelta)}.`
        : null;

    const postureChangeNote = postureChanged
        ? `Productization posture moved from ${previous.productization_posture || "unknown"} to ${current.productization_posture || "unknown"}.`
        : null;

    const readinessScoreChange = Math.abs(readinessDelta) >= 5
        ? `Readiness ${readinessDelta > 0 ? "rose" : "fell"} ${Math.abs(readinessDelta)} points.`
        : null;

    const nextMoveChangeNote = nextMoveChanged
        ? `Next move shifted from "${previous.next_move_summary}" to "${current.next_move_summary}".`
        : null;

    const antiIdeaChangeNote = antiIdeaChanged
        ? `Anti-idea risk changed from ${previous.anti_idea_verdict || "unknown"} to ${current.anti_idea_verdict || "unknown"}.`
        : null;

    const cautionChangeNote = cautionChanged
        ? `Strongest caution shifted from "${previous.strongest_caution || "unknown"}" to "${current.strongest_caution || "unknown"}".`
        : null;

    const staleReasonChangeNote = staleReasonChanged
        ? current.stale_reason
            ? `Board stale reason appeared: ${current.stale_reason}.`
            : `Board stale reason cleared from ${previous.stale_reason || "previous state"}.`
        : null;

    const primaryMetricChange =
        current.primary_metric_label &&
        current.primary_metric_value != null &&
        previous.primary_metric_value != null &&
        Math.abs(primaryDelta) > 0
            ? `${current.primary_metric_label} moved from ${previous.primary_metric_value} to ${current.primary_metric_value}.`
            : null;

    const deltaSummary = [
        postureChangeNote,
        staleReasonChangeNote,
        cautionChangeNote,
        readinessScoreChange,
        antiIdeaChangeNote,
        nextMoveChangeNote,
        primaryMetricChange,
        confidenceChange,
        newEvidenceNote,
        timingChangeNote,
        weaknessChangeNote,
        statusChanged ? `Status shifted from ${previous.status} to ${current.status}.` : null,
    ].filter(Boolean)[0] || "Meaningful monitor state changed since the last check.";

    return {
        previous_state_summary: summarizeState(previous),
        current_state_summary: summarizeState(current),
        delta_summary: deltaSummary,
        direction,
        new_evidence_note: newEvidenceNote,
        confidence_change: confidenceChange,
        timing_change_note: timingChangeNote,
        weakness_change_note: weaknessChangeNote,
        previous_productization_posture: previous.productization_posture,
        current_productization_posture: current.productization_posture,
        readiness_score_change: readinessScoreChange,
        next_move_change_note: nextMoveChangeNote,
        anti_idea_change_note: antiIdeaChangeNote,
        caution_change_note: cautionChangeNote,
        stale_reason_change_note: staleReasonChangeNote,
        direct_vs_inferred: {
            direct_evidence_count: directEvidenceCount,
            inferred_markers: [
                "Delta summary is inferred from persisted snapshots",
                "Timing and weakness change notes are synthesized from monitor state",
            ],
        },
    };
}

export function toNativeSnapshotRow(input: {
    userId: string;
    monitorId: string;
    hash: string;
    direction: MemoryDirection;
    state: MonitorMemoryState;
    delta: MonitorMemoryDelta | null;
}) {
    return {
        user_id: input.userId,
        monitor_id: input.monitorId,
        snapshot_hash: input.hash,
        direction: input.direction,
        state_summary: input.state,
        delta_summary: input.delta || {},
    };
}
