import {
    buildOpportunitySignalContract,
    type OpportunitySignalContract,
} from "@/lib/opportunity-signal";

export type TrustLevel = "HIGH" | "MEDIUM" | "LOW";

export interface NormalizedSource {
    platform: string;
    count: number;
}

export interface TrustMetadata {
    level: TrustLevel;
    label: string;
    score: number;
    evidence_count: number;
    direct_evidence_count: number;
    direct_quote_count: number;
    source_count: number;
    freshness_hours: number | null;
    freshness_label: string;
    weak_signal: boolean;
    weak_signal_reasons: string[];
    inference_flags: string[];
}

function safeParseJson<T = unknown>(value: unknown): T | unknown {
    if (typeof value === "string") {
        try {
            return JSON.parse(value) as T;
        } catch {
            return value;
        }
    }
    return value;
}

export function normalizeSources(value: unknown): NormalizedSource[] {
    const parsed = safeParseJson(value);

    if (Array.isArray(parsed)) {
        return parsed
            .map((item) => {
                if (typeof item === "string") {
                    return { platform: item, count: 0 };
                }
                if (item && typeof item === "object") {
                    const row = item as { platform?: unknown; count?: unknown };
                    return {
                        platform: String(row.platform || "unknown"),
                        count: Number(row.count || 0),
                    };
                }
                return null;
            })
            .filter(Boolean) as NormalizedSource[];
    }

    if (parsed && typeof parsed === "object") {
        return Object.entries(parsed as Record<string, unknown>).map(([platform, count]) => ({
            platform,
            count: Number(count || 0),
        }));
    }

    return [];
}

export function normalizeArray<T = unknown>(value: unknown): T[] {
    const parsed = safeParseJson<T[]>(value);
    return Array.isArray(parsed) ? parsed : [];
}

export function getFreshnessHours(dateValue?: string | null): number | null {
    if (!dateValue) return null;

    const timestamp = Date.parse(dateValue);
    if (Number.isNaN(timestamp)) return null;

    return Math.max(0, (Date.now() - timestamp) / 3600000);
}

export function formatFreshnessLabel(hours: number | null): string {
    if (hours == null) return "Freshness unknown";
    if (hours < 1) return "Updated just now";
    if (hours < 6) return `Updated ${Math.round(hours)}h ago`;
    if (hours < 24) return `Updated ${Math.round(hours)}h ago`;
    if (hours < 72) return `Updated ${Math.round(hours / 24)}d ago`;
    return "Stale signal";
}

function levelFromScore(score: number): TrustLevel {
    if (score >= 75) return "HIGH";
    if (score >= 50) return "MEDIUM";
    return "LOW";
}

function labelFromLevel(level: TrustLevel): string {
    if (level === "HIGH") return "High trust";
    if (level === "MEDIUM") return "Moderate trust";
    return "Low trust";
}

function baseConfidencePoints(confidenceLevel: string, confidenceScore?: number): number {
    if (typeof confidenceScore === "number" && !Number.isNaN(confidenceScore)) {
        if (confidenceScore >= 75) return 25;
        if (confidenceScore >= 55) return 18;
        return 10;
    }

    const normalized = String(confidenceLevel || "").toUpperCase();
    if (normalized === "HIGH" || normalized === "STRONG") return 25;
    if (normalized === "MEDIUM") return 18;
    return 10;
}

function firstFiniteNumber(...values: unknown[]): number {
    for (const value of values) {
        if (value === null || value === undefined || value === "") continue;
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

export function buildOpportunityTrust(row: Record<string, unknown>): TrustMetadata {
    const sources = normalizeSources(row.sources);
    const topPosts = normalizeArray<Record<string, unknown>>(row.top_posts);
    const signalContract = (
        row.signal_contract && typeof row.signal_contract === "object"
            ? row.signal_contract
            : buildOpportunitySignalContract({
                topPosts,
                sources,
                sourceCount: Number(row.source_count || sources.length || 0),
            })
    ) as OpportunitySignalContract;
    const sourceCount = Number(row.source_count || sources.length || 0);
    const evidenceCount = Number(row.post_count_7d || row.post_count_total || topPosts.length || 0);
    const directEvidenceCount = Number(signalContract.buyer_native_direct_count || 0);
    const directQuoteCount = Math.min(
        Number(row.pain_count || 0),
        Math.max(directEvidenceCount, 0),
    );
    const freshnessHours = getFreshnessHours(String(row.last_updated || ""));

    const weakSignalReasons: string[] = [];
    const inferenceFlags: string[] = [];

    if (sourceCount < 2) {
        weakSignalReasons.push("Single-source signal");
    }
    if (evidenceCount < 12) {
        weakSignalReasons.push("Thin recent evidence");
    }
    if (freshnessHours != null && freshnessHours > 48) {
        weakSignalReasons.push("Signal is stale");
    }
    if (String(row.confidence_level || "").toUpperCase() === "LOW") {
        weakSignalReasons.push("Model confidence is low");
    }
    for (const reason of signalContract.reasons || []) {
        if (!weakSignalReasons.includes(reason)) {
            weakSignalReasons.push(reason);
        }
    }
    if (directEvidenceCount === 0) {
        inferenceFlags.push("No buyer-native direct proof attached yet");
    }
    if (directQuoteCount === 0 && evidenceCount > 0) {
        inferenceFlags.push("Pain summary is inferred from clustered posts, not direct quotes");
    }
    if (signalContract.support_level === "hypothesis") {
        inferenceFlags.push("Representative posts lean more on context than validated buyer pain");
    }

    const score =
        Math.min(evidenceCount, 40) * 0.6 +
        Math.min(sourceCount, 4) * 6 +
        Math.min(directEvidenceCount, 4) * 6 +
        baseConfidencePoints(String(row.confidence_level || "")) +
        (signalContract.support_level === "evidence_backed" ? 16 : signalContract.support_level === "supporting_context" ? 8 : 0) +
        (freshnessHours == null ? 8 : freshnessHours <= 6 ? 20 : freshnessHours <= 24 ? 16 : freshnessHours <= 48 ? 10 : 4) -
        (signalContract.single_source ? 8 : 0) -
        (signalContract.hn_launch_heavy ? 14 : 0);

    const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
    const level = levelFromScore(normalizedScore);

    return {
        level,
        label: labelFromLevel(level),
        score: normalizedScore,
        evidence_count: evidenceCount,
        direct_evidence_count: directEvidenceCount,
        direct_quote_count: directQuoteCount,
        source_count: sourceCount,
        freshness_hours: freshnessHours,
        freshness_label: formatFreshnessLabel(freshnessHours),
        weak_signal: weakSignalReasons.length > 0,
        weak_signal_reasons: weakSignalReasons,
        inference_flags: inferenceFlags,
    };
}

export function buildValidationTrust(input: {
    confidence?: number | null;
    created_at?: string | null;
    completed_at?: string | null;
    report?: Record<string, unknown> | null;
}): TrustMetadata {
    const report = (input.report || {}) as Record<string, unknown>;
    const signalSummary = (report.signal_summary || {}) as Record<string, unknown>;
    const dataQuality = (report.data_quality || {}) as Record<string, unknown>;
    const audit = (report._audit || {}) as Record<string, unknown>;
    const platformWarnings = normalizeArray<Record<string, unknown>>(dataQuality.platform_warnings || report.platform_warnings);
    const contradictions = normalizeArray<unknown>(dataQuality.contradictions);
    const warnings = normalizeArray<unknown>(dataQuality.warnings);
    const platformBreakdown = normalizeSources(report.platform_breakdown || report.data_sources);

    const sourceCount =
        Number(report.platforms_used || 0) ||
        Number(report.source_count || 0) ||
        platformBreakdown.length;
    const evidenceCount =
        Number(report.evidence_count || 0) ||
        Number(signalSummary.evidence_points || 0) ||
        normalizeArray(report.debate_evidence || report.evidence).length;
    const directQuoteCount =
        Number(signalSummary.pain_quotes_found || 0) ||
        normalizeArray((report.market_analysis as Record<string, unknown> | undefined)?.pain_quotes).length;
    const directEvidenceCount = firstFiniteNumber(
        audit.direct_evidence_count,
        dataQuality.direct_evidence_count,
        signalSummary.direct_evidence_count,
        report.direct_evidence_count,
        0,
    );
    const freshnessHours = getFreshnessHours(String(input.completed_at || input.created_at || ""));

    const weakSignalReasons: string[] = [];
    const inferenceFlags: string[] = [];

    if (sourceCount < 2) {
        weakSignalReasons.push("Limited source diversity");
    }
    if (evidenceCount < 3) {
        weakSignalReasons.push("Few evidence points");
    }
    if (platformWarnings.length > 0) {
        weakSignalReasons.push("Some sources were degraded or unavailable");
    }
    if (Boolean(dataQuality.partial_coverage)) {
        weakSignalReasons.push("Only part of the evidence corpus was analyzed");
    }
    if (contradictions.length > 0) {
        weakSignalReasons.push("Contradictions were found in the analysis");
    }
    if (directQuoteCount === 0) {
        inferenceFlags.push("Buyer and pricing conclusions rely partly on inference, not direct quotes");
    }
    if (warnings.some((warning) => String(warning).toLowerCase().includes("fallback_exception"))) {
        inferenceFlags.push("Fallback synthesis was used for part of the final report");
    }
    if (platformWarnings.length > 0) {
        inferenceFlags.push("Coverage is strongest on the healthiest available sources");
    }

    const score =
        Math.min(evidenceCount, 10) * 3 +
        Math.min(sourceCount, 4) * 8 +
        baseConfidencePoints("", Number(input.confidence || 0)) +
        (freshnessHours == null ? 8 : freshnessHours <= 24 ? 20 : freshnessHours <= 72 ? 12 : 6) -
        platformWarnings.length * 4 -
        contradictions.length * 5 -
        (Boolean(dataQuality.partial_coverage) ? 8 : 0);

    const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
    const level = levelFromScore(normalizedScore);

    return {
        level,
        label: labelFromLevel(level),
        score: normalizedScore,
        evidence_count: evidenceCount,
        direct_evidence_count: directEvidenceCount,
        direct_quote_count: directQuoteCount,
        source_count: sourceCount,
        freshness_hours: freshnessHours,
        freshness_label: formatFreshnessLabel(freshnessHours),
        weak_signal: weakSignalReasons.length > 0,
        weak_signal_reasons: weakSignalReasons,
        inference_flags: inferenceFlags,
    };
}
