import {
    type NormalizedSource,
    type TrustLevel,
    type TrustMetadata,
    formatFreshnessLabel,
    getFreshnessHours,
    normalizeArray,
} from "@/lib/trust";

export type EvidenceEntityType = "opportunity" | "validation" | "alert" | "competitor";
export type SourceClass =
    | "pain"
    | "commercial"
    | "competitor"
    | "timing"
    | "verification"
    | "community"
    | "review"
    | "jobs"
    | "marketplace"
    | "vendor"
    | "trend"
    | "forum"
    | "dev-community";
export type SignalKind =
    | "pain_point"
    | "buyer_intent"
    | "pricing_signal"
    | "competitor_weakness"
    | "trend_signal"
    | "market_summary"
    | "execution_note"
    | "complaint"
    | "workaround"
    | "willingness_to_pay"
    | "job_requirement"
    | "review_complaint"
    | "launch_discussion"
    | "feature_request";
export type EvidenceDirectness = "direct_evidence" | "derived_metric" | "ai_inference";
export type EvidenceConfidence = "HIGH" | "MEDIUM" | "LOW";
export type VoiceType = "buyer" | "operator" | "founder" | "vendor" | "developer" | "marketplace" | "aggregator";
export type EvidenceLayer = "problem" | "business" | "supporting";
export type DirectnessTier = "direct" | "adjacent" | "supporting";
export type ReliabilityTier = "stable" | "moderate" | "fragile";

export interface EvidenceItem {
    id: string;
    entity_type: EvidenceEntityType;
    entity_key: string;
    source_class: SourceClass;
    source_name: string;
    platform: string;
    url: string | null;
    observed_at: string | null;
    signal_kind: SignalKind;
    title: string;
    snippet: string | null;
    author_handle: string | null;
    score: number | null;
    directness: EvidenceDirectness;
    confidence: EvidenceConfidence;
    voice_type?: VoiceType;
    evidence_layer?: EvidenceLayer;
    directness_tier?: DirectnessTier;
    reliability_tier?: ReliabilityTier;
    metadata: Record<string, unknown>;
}

export interface EvidenceSummary {
    evidence_count: number;
    direct_evidence_count: number;
    inferred_count: number;
    source_count: number;
    source_breakdown: NormalizedSource[];
    latest_observed_at: string | null;
    freshness_hours: number | null;
    freshness_label: string;
    direct_vs_inferred: {
        direct: number;
        derived: number;
        inferred: number;
    };
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

function toNullableIso(value: unknown): string | null {
    if (!value) return null;
    const parsed = Date.parse(String(value));
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toISOString();
}

function inferPlatform(value: unknown, fallback = "unknown") {
    const text = String(value || "").toLowerCase();
    if (text.includes("hackernews") || text.includes("news.ycombinator.com") || text.includes("hn")) return "hackernews";
    if (text.includes("reddit")) return "reddit";
    if (text.includes("producthunt")) return "producthunt";
    if (text.includes("indiehackers")) return "indiehackers";
    if (text.includes("stackoverflow")) return "stackoverflow";
    if (text.includes("github")) return "github";
    return fallback;
}

function buildId(parts: Array<string | number | null | undefined>) {
    return parts
        .filter((part) => part != null && String(part).length > 0)
        .map((part) => String(part).trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9:_-]/g, ""))
        .join(":");
}

function dedupeEvidence(items: EvidenceItem[]) {
    const seen = new Set<string>();
    const result: EvidenceItem[] = [];

    for (const item of items) {
        const key = `${item.entity_type}:${item.entity_key}:${item.url || item.title}:${item.directness}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(item);
    }

    return result;
}

function byObservedDesc(a: EvidenceItem, b: EvidenceItem) {
    const aTime = a.observed_at ? Date.parse(a.observed_at) : 0;
    const bTime = b.observed_at ? Date.parse(b.observed_at) : 0;
    return bTime - aTime;
}

function normalizeConfidence(value: unknown): EvidenceConfidence {
    const text = String(value || "").toUpperCase();
    if (text === "HIGH") return "HIGH";
    if (text === "LOW") return "LOW";
    return "MEDIUM";
}

function mapSourceClass(platform: string, signalKind: SignalKind): SourceClass {
    if (signalKind === "pricing_signal" || signalKind === "buyer_intent") return "commercial";
    if (signalKind === "competitor_weakness") return "competitor";
    if (signalKind === "trend_signal") return "timing";
    if (platform === "github" || platform === "stackoverflow") return "verification";
    return "pain";
}

function normalizeSourceClass(value: unknown, platform: string, signalKind: SignalKind): SourceClass {
    const raw = String(value || "").trim();
    if (!raw) return mapSourceClass(platform, signalKind);
    return raw as SourceClass;
}

function normalizeSignalKind(value: unknown, fallback: SignalKind): SignalKind {
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    return raw as SignalKind;
}

function mapDirectnessTier(value: unknown): DirectnessTier | undefined {
    const raw = String(value || "").toLowerCase();
    if (raw === "direct" || raw === "adjacent" || raw === "supporting") return raw as DirectnessTier;
    return undefined;
}

function mapEvidenceDirectness(value: unknown): EvidenceDirectness {
    const raw = String(value || "").toLowerCase();
    if (raw === "direct") return "direct_evidence";
    if (raw === "adjacent") return "derived_metric";
    if (raw === "supporting") return "ai_inference";
    return "direct_evidence";
}

export function buildEvidenceSummary(items: EvidenceItem[]): EvidenceSummary {
    const direct = items.filter((item) => item.directness === "direct_evidence").length;
    const derived = items.filter((item) => item.directness === "derived_metric").length;
    const inferred = items.filter((item) => item.directness === "ai_inference").length;
    const sourceCounter = new Map<string, number>();

    for (const item of items) {
        sourceCounter.set(item.platform, (sourceCounter.get(item.platform) || 0) + 1);
    }

    const latestObservedAt = [...items]
        .sort(byObservedDesc)
        .map((item) => item.observed_at)
        .find(Boolean) || null;

    const freshnessHours = getFreshnessHours(latestObservedAt);

    return {
        evidence_count: items.length,
        direct_evidence_count: direct,
        inferred_count: inferred,
        source_count: sourceCounter.size,
        source_breakdown: [...sourceCounter.entries()].map(([platform, count]) => ({ platform, count })),
        latest_observed_at: latestObservedAt,
        freshness_hours: freshnessHours,
        freshness_label: formatFreshnessLabel(freshnessHours),
        direct_vs_inferred: {
            direct,
            derived,
            inferred,
        },
    };
}

export function buildEvidenceBackedTrust(input: {
    items: EvidenceItem[];
    extraWeakSignalReasons?: string[];
    extraInferenceFlags?: string[];
}): TrustMetadata {
    const summary = buildEvidenceSummary(input.items);
    const weakSignalReasons = [...(input.extraWeakSignalReasons || [])];
    const inferenceFlags = [...(input.extraInferenceFlags || [])];

    if (summary.direct_evidence_count === 0) {
        weakSignalReasons.push("No direct evidence attached");
    }
    if (summary.source_count < 2) {
        weakSignalReasons.push("Single-source proof");
    }
    if (summary.evidence_count < 2) {
        weakSignalReasons.push("Very thin evidence");
    }
    if (summary.freshness_hours != null && summary.freshness_hours > 72) {
        weakSignalReasons.push("Evidence is stale");
    }
    if (summary.direct_vs_inferred.inferred > summary.direct_vs_inferred.direct) {
        inferenceFlags.push("More conclusions are inferred than directly observed");
    }

    const score = Math.max(
        0,
        Math.min(
            100,
            Math.round(
                Math.min(summary.direct_evidence_count, 6) * 10 +
                Math.min(summary.source_count, 4) * 8 +
                Math.min(summary.evidence_count, 10) * 3 +
                (summary.freshness_hours == null
                    ? 6
                    : summary.freshness_hours <= 24
                        ? 18
                        : summary.freshness_hours <= 72
                            ? 10
                            : 4),
            ),
        ),
    );

    const level = levelFromScore(score);

    return {
        level,
        label: labelFromLevel(level),
        score,
        evidence_count: summary.evidence_count,
        direct_evidence_count: summary.direct_evidence_count,
        direct_quote_count: 0,
        source_count: summary.source_count,
        freshness_hours: summary.freshness_hours,
        freshness_label: summary.freshness_label,
        weak_signal: weakSignalReasons.length > 0,
        weak_signal_reasons: weakSignalReasons,
        inference_flags: inferenceFlags,
    };
}

export function buildOpportunityEvidence(row: Record<string, unknown>, limit = 6): EvidenceItem[] {
    const topic = String(row.topic || row.slug || "opportunity");
    const topPosts = normalizeArray<Record<string, unknown>>(safeParseJson(row.top_posts));
    const items: EvidenceItem[] = topPosts.map((post, index) => {
        const url = String(post.url || post.permalink || "");
        const platform = inferPlatform(post.source || url || post.subreddit, "reddit");
        return {
            id: buildId(["opportunity", row.id ? String(row.id) : null, "post", index]),
            entity_type: "opportunity",
            entity_key: String(row.slug || row.id || topic),
            source_class: normalizeSourceClass(post.source_class, platform, "pain_point"),
            source_name: String(post.source_name || platform),
            platform,
            url: url || null,
            observed_at: toNullableIso(post.created_at || row.last_updated),
            signal_kind: normalizeSignalKind(post.signal_kind, "pain_point"),
            title: String(post.title || `Evidence for ${topic}`),
            snippet: String(post.summary || post.what_it_proves || "").trim() || null,
            author_handle: post.author ? String(post.author) : null,
            score: Number.isFinite(Number(post.score)) ? Number(post.score) : null,
            directness: mapEvidenceDirectness(post.directness_tier),
            confidence: "HIGH",
            voice_type: post.voice_type ? String(post.voice_type) as VoiceType : undefined,
            evidence_layer: post.evidence_layer ? String(post.evidence_layer) as EvidenceLayer : undefined,
            directness_tier: mapDirectnessTier(post.directness_tier),
            reliability_tier: post.reliability_tier ? String(post.reliability_tier) as ReliabilityTier : undefined,
            metadata: {
                subreddit: post.subreddit || null,
                comments: post.comments || null,
            },
        };
    });

    if (row.pain_summary) {
        items.push({
            id: buildId(["opportunity", row.id ? String(row.id) : null, "pain-summary"]),
            entity_type: "opportunity",
            entity_key: String(row.slug || row.id || topic),
            source_class: "pain",
            source_name: "redditpulse",
            platform: "cluster",
            url: null,
            observed_at: toNullableIso(row.last_updated),
            signal_kind: "market_summary",
            title: `${topic} pain summary`,
            snippet: String(row.pain_summary),
            author_handle: null,
            score: null,
            directness: "ai_inference",
            confidence: "MEDIUM",
            metadata: {
                pain_count: Number(row.pain_count || 0),
            },
        });
    }

    return dedupeEvidence(items).sort(byObservedDesc).slice(0, limit);
}

export function buildValidationEvidence(report: Record<string, unknown>, validationId?: string): EvidenceItem[] {
    const marketAnalysis = (report.market_analysis || {}) as Record<string, unknown>;
    const pricingStrategy = (report.pricing_strategy || {}) as Record<string, unknown>;
    const competitionLandscape = (report.competition_landscape || {}) as Record<string, unknown>;
    const marketEvidence = normalizeArray<Record<string, unknown>>(marketAnalysis.evidence);
    const debateEvidence = normalizeArray<Record<string, unknown>>(report.debate_evidence || report.evidence);

    const directItems = [...marketEvidence, ...debateEvidence].map((entry, index) => {
        const url = String(entry.url || entry.permalink || "");
        const title = String(entry.post_title || entry.title || entry.keyword || `Validation evidence ${index + 1}`);
        const snippet = String(entry.what_it_proves || entry.insight || entry.summary || entry.body || "").trim() || null;
        const platform = inferPlatform(entry.source || url || entry.subreddit, "reddit");
        const whatItProves = String(entry.what_it_proves || "").toLowerCase();
        const inferredSignalKind: SignalKind =
            whatItProves.includes("price") || whatItProves.includes("pay") || whatItProves.includes("budget")
                ? "pricing_signal"
                : whatItProves.includes("compet")
                    ? "competitor_weakness"
                    : "pain_point";
        const signalKind = normalizeSignalKind(entry.signal_kind, inferredSignalKind);

        return {
            id: buildId(["validation", validationId || "pending", "evidence", index]),
            entity_type: "validation" as const,
            entity_key: String(validationId || report.slug || "validation"),
            source_class: normalizeSourceClass(entry.source_class, platform, signalKind),
            source_name: String(entry.source_name || platform),
            platform,
            url: url || null,
            observed_at: toNullableIso(entry.created_at || report.completed_at || report.generated_at),
            signal_kind: signalKind,
            title,
            snippet,
            author_handle: entry.author ? String(entry.author) : null,
            score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : null,
            directness: mapEvidenceDirectness(entry.directness_tier),
            confidence: normalizeConfidence(entry.confidence),
            voice_type: entry.voice_type ? String(entry.voice_type) as VoiceType : undefined,
            evidence_layer: entry.evidence_layer ? String(entry.evidence_layer) as EvidenceLayer : undefined,
            directness_tier: mapDirectnessTier(entry.directness_tier),
            reliability_tier: entry.reliability_tier ? String(entry.reliability_tier) as ReliabilityTier : undefined,
            metadata: {
                subreddit: entry.subreddit || null,
                what_it_proves: entry.what_it_proves || null,
            },
        };
    });

    const inferredItems: EvidenceItem[] = [];

    if (report.executive_summary) {
        inferredItems.push({
            id: buildId(["validation", validationId || "pending", "executive-summary"]),
            entity_type: "validation",
            entity_key: String(validationId || report.slug || "validation"),
            source_class: "verification",
            source_name: "redditpulse",
            platform: "analysis",
            url: null,
            observed_at: toNullableIso(report.generated_at || report.completed_at),
            signal_kind: "market_summary",
            title: "Executive summary",
            snippet: String(report.executive_summary),
            author_handle: null,
            score: null,
            directness: "ai_inference",
            confidence: "MEDIUM",
            metadata: {},
        });
    }

    if (pricingStrategy.summary || pricingStrategy.recommended_model) {
        inferredItems.push({
            id: buildId(["validation", validationId || "pending", "pricing"]),
            entity_type: "validation",
            entity_key: String(validationId || report.slug || "validation"),
            source_class: "commercial",
            source_name: "redditpulse",
            platform: "analysis",
            url: null,
            observed_at: toNullableIso(report.generated_at || report.completed_at),
            signal_kind: "pricing_signal",
            title: "Pricing hypothesis",
            snippet: String(pricingStrategy.summary || pricingStrategy.recommended_model || ""),
            author_handle: null,
            score: null,
            directness: "ai_inference",
            confidence: "MEDIUM",
            metadata: {},
        });
    }

    if (competitionLandscape.your_unfair_advantage || competitionLandscape.market_saturation) {
        inferredItems.push({
            id: buildId(["validation", validationId || "pending", "competition"]),
            entity_type: "validation",
            entity_key: String(validationId || report.slug || "validation"),
            source_class: "competitor",
            source_name: "redditpulse",
            platform: "analysis",
            url: null,
            observed_at: toNullableIso(report.generated_at || report.completed_at),
            signal_kind: "competitor_weakness",
            title: "Competitive landscape",
            snippet: String(competitionLandscape.your_unfair_advantage || competitionLandscape.market_saturation || ""),
            author_handle: null,
            score: null,
            directness: "ai_inference",
            confidence: "MEDIUM",
            metadata: {},
        });
    }

    return dedupeEvidence([...directItems, ...inferredItems]).sort(byObservedDesc);
}

export function buildAlertEvidence(alert: Record<string, unknown>, matches: Array<Record<string, unknown>>): EvidenceItem[] {
    const entityKey = String(alert.id || "alert");
    const keywords = normalizeArray<string>(alert.keywords).map(String);

    return dedupeEvidence(matches.map((match, index) => {
        const url = String(match.post_url || "");
        const platform = inferPlatform(url || match.subreddit, "reddit");
        return {
            id: buildId(["alert", entityKey, "match", index]),
            entity_type: "alert" as const,
            entity_key: entityKey,
            source_class: "pain",
            source_name: platform,
            platform,
            url: url || null,
            observed_at: toNullableIso(match.matched_at),
            signal_kind: "pain_point",
            title: String(match.post_title || `Alert match for ${keywords.join(", ")}`),
            snippet: keywords.length > 0
                ? `Matched alert keywords: ${keywords.join(", ")}`
                : "Matched a live pain signal.",
            author_handle: null,
            score: Number.isFinite(Number(match.post_score)) ? Number(match.post_score) : null,
            directness: "direct_evidence",
            confidence: "HIGH",
            metadata: {
                subreddit: match.subreddit || null,
                matched_keywords: normalizeArray<string>(match.matched_keywords),
            },
        };
    })).sort(byObservedDesc);
}

export function buildCompetitorComplaintEvidence(complaint: Record<string, unknown>, competitorOverride?: string): EvidenceItem[] {
    const competitors = normalizeArray<string>(complaint.competitors_mentioned).map(String);
    const signals = normalizeArray<string>(complaint.complaint_signals).map(String);
    const url = String(complaint.post_url || "");
    const platform = inferPlatform(url || complaint.subreddit, "reddit");
    const competitor = competitorOverride || competitors[0] || String(complaint.id || "competitor");

    return [{
        id: buildId([
            "competitor",
            competitorOverride ? competitorOverride : null,
            complaint.id ? String(complaint.id) : complaint.post_title ? String(complaint.post_title) : "complaint",
        ]),
        entity_type: "competitor",
        entity_key: competitor,
        source_class: "competitor",
        source_name: platform,
        platform,
        url: url || null,
        observed_at: toNullableIso(complaint.scraped_at),
        signal_kind: "competitor_weakness",
        title: String(complaint.post_title || "Competitor complaint"),
        snippet: signals.length > 0
            ? `Complaint signals: ${signals.join(", ")}`
            : competitors.length > 0
                ? `Users are complaining about ${competitorOverride || competitors.join(", ")}`
                : "Users surfaced a competitor weakness signal.",
        author_handle: null,
        score: Number.isFinite(Number(complaint.post_score)) ? Number(complaint.post_score) : null,
        directness: "direct_evidence",
        confidence: "HIGH",
        metadata: {
            subreddit: complaint.subreddit || null,
            competitors_mentioned: competitors,
            complaint_signals: signals,
        },
    }];
}
