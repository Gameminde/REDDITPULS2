import { buildCompetitorWeaknessRadar } from "@/lib/competitor-weakness";
import { buildWhyNowFromWeaknessCluster } from "@/lib/why-now";
import type { MarketHydratedIdea } from "@/lib/market-feed";
import { isInvalidMarketTopicName, normalizeMarketTopicName } from "@/lib/market-topic-quality";

export type ValidationBias = "positive" | "neutral" | "caution";

export interface MarketIntelligenceSummary {
    generated_at: string;
    run_health: "healthy" | "degraded" | "failed";
    healthy_sources: string[];
    degraded_sources: string[];
    raw_idea_count: number;
    feed_visible_count: number;
    new_72h_count: number;
    emerging_wedge_count: number;
}

export interface EmergingWedgeCard {
    topic: string;
    slug: string;
    category: string;
    current_score: number;
    source_count: number;
    post_count_total: number;
    post_count_7d: number;
    freshness_hours: number | null;
    suggested_wedge_label: string | null;
    why_it_matters_now: string;
    missing_proof: string;
    promotion_readiness: "ready" | "needs_wedge" | "needs_more_proof";
    buyer_native_direct_count: number;
    supporting_signal_count: number;
    board_eligible: boolean;
    board_stale_reason: string | null;
    validation_bias: ValidationBias;
    validation_note: string;
}

export interface ThemeToShapeCard {
    topic: string;
    slug: string;
    category: string;
    current_score: number;
    source_count: number;
    post_count_total: number;
    direct_buyer_count: number;
    supporting_signal_count: number;
    suggested_wedge_label: string | null;
    missing_proof: string;
    recommended_shape_direction: string;
    recommended_shape_mode: "suggested_wedge" | "direct_buyer_language" | "cross_source_pattern" | "theme_watch";
    observed_pattern: string;
}

export interface CompetitorPressureCard {
    competitor: string;
    weakness_category: string;
    complaint_count: number;
    source_count: number;
    latest_seen_at: string | null;
    freshness_label: string;
    confidence: {
        level: "HIGH" | "MEDIUM" | "LOW";
        score: number;
        label: string;
    };
    summary: string;
    affected_segment: string | null;
    direct_evidence_count: number;
    why_now: string;
    recommended_angle: string;
    recommendation_mode: "evidence_led" | "heuristic";
    inference_note: string;
}

interface ValidationMemoryRow {
    verdict?: string | null;
    status?: string | null;
    idea_text?: string | null;
    extracted_keywords?: unknown;
    extracted_audience?: unknown;
    extracted_competitors?: unknown;
}

interface IdeaHistoryRow {
    idea_id?: string | null;
    score?: number | null;
    recorded_at?: string | null;
}

interface TrendSignalRow {
    keyword?: string | null;
    change_24h?: number | null;
    change_7d?: number | null;
    updated_at?: string | null;
}

interface CompetitorComplaintRow extends Record<string, unknown> {}
interface PainAlertRow extends Record<string, unknown> {}

interface ValidationMemoryAssessment {
    validation_bias: ValidationBias;
    validation_note: string;
    rank_adjustment: number;
}

const INVALID_COMPETITOR_NAMES = new Set([
    "competitor",
    "competitors",
    "trigger",
    "triggers",
    "saturation",
    "pricing",
    "support",
    "feature",
    "features",
]);

const INTELLIGENCE_GENERIC_TOKENS = new Set([
    "after",
    "before",
    "choose",
    "create",
    "different",
    "even",
    "feedback",
    "love",
    "posting",
    "run",
    "should",
    "stay",
    "trying",
    "without",
    "wins",
]);

function cleanText(value: unknown) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function ensureSentence(value: string, fallback: string) {
    const text = cleanText(value || fallback);
    if (!text) return fallback;
    return /[.!?]$/.test(text) ? text : `${text}.`;
}

function safeParseJson<T = unknown>(value: unknown): T | unknown {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value) as T;
    } catch {
        return value;
    }
}

function asStringArray(value: unknown) {
    const parsed = safeParseJson<string[] | string>(value);
    if (Array.isArray(parsed)) {
        return parsed.map((item) => cleanText(item)).filter(Boolean);
    }
    if (typeof parsed === "string") {
        return parsed
            .split(/[,\n]/)
            .map((item) => cleanText(item))
            .filter(Boolean);
    }
    return [];
}

function tokenize(value: string) {
    return normalizeMarketTopicName(value)
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token && token.length > 2);
}

function unique<T>(values: T[]) {
    return [...new Set(values)];
}

function clamp(value: number, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
}

function getFreshnessHours(firstSeen?: string | null) {
    if (!firstSeen) return null;
    const parsed = Date.parse(String(firstSeen));
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, (Date.now() - parsed) / 3600000);
}

function matchesTrendKeyword(idea: MarketHydratedIdea, keyword: string) {
    const normalizedKeyword = normalizeMarketTopicName(keyword);
    if (!normalizedKeyword) return false;

    const topic = normalizeMarketTopicName(idea.topic);
    if (topic === normalizedKeyword) return true;
    if ((idea.keywords || []).some((entry) => normalizeMarketTopicName(entry) === normalizedKeyword)) return true;

    const suggestion = normalizeMarketTopicName(idea.suggested_wedge_label || "");
    if (suggestion && suggestion.includes(normalizedKeyword)) return true;

    return false;
}

function getRecentHistory(idea: MarketHydratedIdea, rows: IdeaHistoryRow[]) {
    const history = rows
        .filter((row) => String(row.idea_id || "") === idea.id)
        .sort((a, b) => (Date.parse(String(a.recorded_at || "")) || 0) - (Date.parse(String(b.recorded_at || "")) || 0));

    if (history.length < 2) {
        return {
            scoreDelta: 0,
            snapshotCount: history.length,
        };
    }

    const first = Number(history[0]?.score || 0);
    const last = Number(history[history.length - 1]?.score || 0);
    return {
        scoreDelta: Number((last - first).toFixed(1)),
        snapshotCount: history.length,
    };
}

function getBestTrendSignal(idea: MarketHydratedIdea, rows: TrendSignalRow[]) {
    const matches = rows.filter((row) => matchesTrendKeyword(idea, String(row.keyword || "")));
    if (matches.length === 0) return null;

    return matches.sort((a, b) =>
        (Number(b.change_7d || 0) - Number(a.change_7d || 0))
        || (Number(b.change_24h || 0) - Number(a.change_24h || 0))
        || ((Date.parse(String(b.updated_at || "")) || 0) - (Date.parse(String(a.updated_at || "")) || 0))
    )[0] || null;
}

function buildValidationMemory(validations: ValidationMemoryRow[]) {
    return validations
        .filter((row) => String(row.status || "").toLowerCase() === "done")
        .map((row) => ({
            verdict: cleanText(row.verdict).toUpperCase(),
            tokens: unique([
                ...tokenize(cleanText(row.idea_text)),
                ...asStringArray(row.extracted_keywords).flatMap(tokenize),
                ...asStringArray(row.extracted_audience).flatMap(tokenize),
                ...asStringArray(row.extracted_competitors).flatMap(tokenize),
            ]),
        }))
        .filter((row) => row.tokens.length > 0);
}

function assessValidationMemory(idea: MarketHydratedIdea, memory: Array<{ verdict: string; tokens: string[] }>): ValidationMemoryAssessment {
    if (memory.length === 0) {
        return {
            validation_bias: "neutral",
            validation_note: "",
            rank_adjustment: 0,
        };
    }

    const candidateTokens = new Set(unique([
        ...tokenize(idea.topic),
        ...tokenize(cleanText(idea.suggested_wedge_label)),
        ...(idea.keywords || []).flatMap(tokenize),
        ...tokenize(cleanText(idea.category)),
    ]));

    let bestPositive = 0;
    let bestCaution = 0;

    for (const row of memory) {
        const overlap = row.tokens.filter((token) => candidateTokens.has(token)).length;
        if (overlap <= 0) continue;

        if (row.verdict === "BUILD IT") {
            bestPositive = Math.max(bestPositive, overlap);
        } else if (row.verdict === "RISKY" || row.verdict === "DON'T BUILD") {
            bestCaution = Math.max(bestCaution, overlap);
        }
    }

    if (bestPositive >= 2 && bestPositive > bestCaution) {
        return {
            validation_bias: "positive",
            validation_note: "Past similar completed validations skewed toward BUILD IT.",
            rank_adjustment: 4,
        };
    }

    if (bestCaution >= 2 && bestCaution >= bestPositive) {
        return {
            validation_bias: "caution",
            validation_note: "Past similar completed validations skewed toward RISKY or DON'T BUILD.",
            rank_adjustment: -4,
        };
    }

    return {
        validation_bias: "neutral",
        validation_note: "",
        rank_adjustment: 0,
    };
}

function isNonsenseTopic(idea: MarketHydratedIdea) {
    const topic = cleanText(idea.topic);
    const normalized = normalizeMarketTopicName(topic);
    if (!normalized) return true;
    if (isInvalidMarketTopicName(topic)) return true;
    if (/[a-z]+_[a-z0-9]+/i.test(topic)) return true;
    if (/\b\d+\b/.test(topic) && !/\b(b2b|b2c)\b/i.test(topic)) return true;
    if (/\bfuck/i.test(topic)) return true;

    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length === 0) return true;

    const genericTokenCount = tokens.filter((token) => INTELLIGENCE_GENERIC_TOKENS.has(token)).length;
    if (genericTokenCount >= Math.max(2, tokens.length - 1)) return true;

    return false;
}

function buildWhyItMattersNow(idea: MarketHydratedIdea, historyRows: IdeaHistoryRow[], trendRows: TrendSignalRow[]) {
    const baseReason = cleanText(idea.strategy_preview?.strongest_reason || idea.signal_contract?.summary || "");
    const marketReason = cleanText(idea.market_hint?.why_it_matters_now || "");
    const candidateReason = /^(there are no|single-source|thin recent evidence)/i.test(marketReason)
        ? baseReason
        : marketReason || baseReason;
    const preferredReason = /^(there are no|single-source|thin recent evidence)/i.test(candidateReason)
        ? `Repeated discussion keeps clustering around ${idea.topic}.`
        : candidateReason;

    const noteParts = [ensureSentence(
        preferredReason,
        `Repeated discussion keeps clustering around ${idea.topic}.`,
    )];

    const history = getRecentHistory(idea, historyRows);
    if (history.snapshotCount >= 2 && history.scoreDelta > 0) {
        noteParts.push(`Market score is up ${history.scoreDelta.toFixed(1)} points across ${history.snapshotCount} recent snapshots.`);
    }

    const trend = getBestTrendSignal(idea, trendRows);
    if (trend && (Number(trend.change_24h || 0) > 4 || Number(trend.change_7d || 0) > 8)) {
        noteParts.push(`Related keyword momentum is also rising (${Number(trend.change_24h || 0).toFixed(1)} 24h, ${Number(trend.change_7d || 0).toFixed(1)} 7d).`);
    }

    return noteParts.join(" ");
}

function getPromotionReadiness(idea: MarketHydratedIdea) {
    return idea.market_hint?.promotion_readiness || (idea.board_eligible ? "ready" : idea.market_status === "needs_wedge" ? "needs_wedge" : "needs_more_proof");
}

function buildRecommendedShapeDirection(idea: MarketHydratedIdea) {
    if (idea.suggested_wedge_label) {
        return {
            mode: "suggested_wedge" as const,
            text: `Test the wedge "${idea.suggested_wedge_label}" against this broader pain cluster before treating it like a build-ready opportunity.`,
        };
    }
    const directCount = Number(idea.signal_contract?.buyer_native_direct_count || 0);
    if (directCount > 0) {
        return {
            mode: "direct_buyer_language" as const,
            text: `Use the direct buyer language to narrow ${idea.topic} into one workflow, one buyer, and one first promise.`,
        };
    }
    if (idea.source_count >= 2) {
        return {
            mode: "cross_source_pattern" as const,
            text: `Find the repeated workflow behind ${idea.topic} across multiple sources before you turn it into a named wedge.`,
        };
    }
    return {
        mode: "theme_watch" as const,
        text: `Keep this as a watched theme until it gains a clearer wedge or a second confirming source.`,
    };
}

function buildThemeObservedPattern(idea: MarketHydratedIdea) {
    const directCount = Number(idea.signal_contract?.buyer_native_direct_count || 0);
    const supportingCount = Number(idea.signal_contract?.supporting_signal_count || 0);

    if (directCount > 0) {
        return `${directCount} direct buyer signal${directCount === 1 ? "" : "s"} across ${Number(idea.source_count || 0)} source${Number(idea.source_count || 0) === 1 ? "" : "s"}.`;
    }
    if (supportingCount > 0) {
        return `${supportingCount} supporting signal${supportingCount === 1 ? "" : "s"} across ${Number(idea.source_count || 0)} source${Number(idea.source_count || 0) === 1 ? "" : "s"}.`;
    }
    return `${Number(idea.post_count_total || 0)} post${Number(idea.post_count_total || 0) === 1 ? "" : "s"} seen across ${Number(idea.source_count || 0)} source${Number(idea.source_count || 0) === 1 ? "" : "s"}.`;
}

function buildEmergingScore(idea: MarketHydratedIdea, historyRows: IdeaHistoryRow[], trendRows: TrendSignalRow[], validation: ValidationMemoryAssessment) {
    const freshnessHours = getFreshnessHours(String(idea.first_seen || ""));
    const freshnessScore = freshnessHours == null ? 0 : clamp(1 - (freshnessHours / 72));
    const buyerDirect = Number(idea.signal_contract?.buyer_native_direct_count || 0);
    const supporting = Number(idea.signal_contract?.supporting_signal_count || 0);
    const evidenceStrength = clamp(((buyerDirect * 1.5) + supporting) / 6);
    const sourceScore = clamp(Number(idea.source_count || 0) / 3);
    const history = getRecentHistory(idea, historyRows);
    const trend = getBestTrendSignal(idea, trendRows);
    const scoreStrength = clamp(Number(idea.current_score || 0) / 100);
    const historyStrength = clamp(history.scoreDelta / 12);
    const trendStrength = clamp(Math.max(Number(trend?.change_24h || 0), Number(trend?.change_7d || 0)) / 25);
    const momentumScore = Math.max(scoreStrength, historyStrength, trendStrength);
    const wedgeScore = idea.suggested_wedge_label ? 1 : 0;

    return (
        freshnessScore * 35 +
        evidenceStrength * 25 +
        sourceScore * 20 +
        momentumScore * 10 +
        wedgeScore * 10 +
        validation.rank_adjustment
    );
}

function buildThemeScore(idea: MarketHydratedIdea) {
    const sourceScore = clamp(Number(idea.source_count || 0) / 3) * 50;
    const signalDensity = clamp((Number(idea.signal_contract?.buyer_native_direct_count || 0) + Number(idea.signal_contract?.supporting_signal_count || 0)) / 6) * 30;
    const marketScore = clamp(Number(idea.current_score || 0) / 100) * 20;
    return sourceScore + signalDensity + marketScore;
}

export function buildEmergingWedges(input: {
    ideas: MarketHydratedIdea[];
    promotedSlugs: Set<string>;
    historyRows: IdeaHistoryRow[];
    trendRows: TrendSignalRow[];
    validationMemory: ValidationMemoryRow[];
    category?: string;
}) {
    const memory = buildValidationMemory(input.validationMemory);

    return input.ideas
        .filter((idea) => {
            const freshnessHours = getFreshnessHours(String(idea.first_seen || ""));
            if (freshnessHours == null || freshnessHours > 72) return false;
            if (input.category && idea.category !== input.category) return false;
            if (idea.market_status === "suppressed") return false;
            if (idea.market_kind === "subreddit_bucket" || idea.market_kind === "malformed") return false;
            if (String(idea.confidence_level || "").toUpperCase() === "INSUFFICIENT") return false;
            if (!["supporting_context", "evidence_backed"].includes(String(idea.signal_contract?.support_level || ""))) return false;
            if (input.promotedSlugs.has(idea.slug)) return false;
            if (isNonsenseTopic(idea)) return false;
            if (!idea.suggested_wedge_label) return false;
            return true;
        })
        .map((idea) => {
            const validation = assessValidationMemory(idea, memory);
            const whyItMattersNow = buildWhyItMattersNow(idea, input.historyRows, input.trendRows);
            const freshnessHours = getFreshnessHours(String(idea.first_seen || ""));

            return {
                topic: idea.topic,
                slug: idea.slug,
                category: idea.category,
                current_score: Number(idea.current_score || 0),
                source_count: Number(idea.source_count || 0),
                post_count_total: Number(idea.post_count_total || 0),
                post_count_7d: Number(idea.post_count_7d || 0),
                freshness_hours: freshnessHours,
                suggested_wedge_label: idea.suggested_wedge_label || null,
                why_it_matters_now: whyItMattersNow,
                missing_proof: ensureSentence(
                    cleanText(idea.market_hint?.missing_proof || idea.board_stale_reason || ""),
                    "This still needs stronger direct buyer proof before promotion.",
                ),
                promotion_readiness: getPromotionReadiness(idea),
                buyer_native_direct_count: Number(idea.signal_contract?.buyer_native_direct_count || 0),
                supporting_signal_count: Number(idea.signal_contract?.supporting_signal_count || 0),
                board_eligible: Boolean(idea.board_eligible),
                board_stale_reason: idea.board_stale_reason || null,
                validation_bias: validation.validation_bias,
                validation_note: validation.validation_note,
                _rank: buildEmergingScore(idea, input.historyRows, input.trendRows, validation),
            };
        })
        .sort((a, b) => b._rank - a._rank || b.current_score - a.current_score)
        .map(({ _rank, ...card }) => card as EmergingWedgeCard);
}

export function buildThemesToShape(input: {
    ideas: MarketHydratedIdea[];
    promotedSlugs: Set<string>;
    emergingSlugs: Set<string>;
    category?: string;
}) {
    return input.ideas
        .filter((idea) => {
            if (input.category && idea.category !== input.category) return false;
            if (idea.market_status !== "needs_wedge") return false;
            if (input.promotedSlugs.has(idea.slug) || input.emergingSlugs.has(idea.slug)) return false;
            if (!["LOW", "MEDIUM"].includes(String(idea.confidence_level || "").toUpperCase())) return false;
            if (!["tracked_theme", "dynamic_theme", "entity"].includes(String(idea.market_kind || ""))) return false;
            if (isNonsenseTopic(idea)) return false;
            const signalCount = Number(idea.signal_contract?.buyer_native_direct_count || 0) + Number(idea.signal_contract?.supporting_signal_count || 0);
            return Boolean(idea.suggested_wedge_label) || Number(idea.source_count || 0) >= 2 || signalCount >= 2;
        })
        .map((idea) => {
            const shapeDirection = buildRecommendedShapeDirection(idea);
            return {
                topic: idea.topic,
                slug: idea.slug,
                category: idea.category,
                current_score: Number(idea.current_score || 0),
                source_count: Number(idea.source_count || 0),
                post_count_total: Number(idea.post_count_total || 0),
                direct_buyer_count: Number(idea.signal_contract?.buyer_native_direct_count || 0),
                supporting_signal_count: Number(idea.signal_contract?.supporting_signal_count || 0),
                suggested_wedge_label: idea.suggested_wedge_label || null,
                missing_proof: ensureSentence(
                    cleanText(idea.market_hint?.missing_proof || idea.board_stale_reason || ""),
                    "This theme still needs a sharper wedge before it becomes board-ready.",
                ),
                recommended_shape_direction: shapeDirection.text,
                recommended_shape_mode: shapeDirection.mode,
                observed_pattern: buildThemeObservedPattern(idea),
                _rank: buildThemeScore(idea),
            };
        })
        .sort((a, b) => b._rank - a._rank || b.current_score - a.current_score)
        .map(({ _rank, ...card }) => card as ThemeToShapeCard);
}

function isUsefulCompetitorName(value: string) {
    const normalized = normalizeMarketTopicName(value);
    if (!normalized) return false;
    if (INVALID_COMPETITOR_NAMES.has(normalized)) return false;
    if (normalized.startsWith("u ") || normalized.startsWith("r ")) return false;
    if (normalized.split(" ").length > 4) return false;
    return true;
}

export function buildCompetitorPressure(input: {
    complaints: CompetitorComplaintRow[];
    alerts: PainAlertRow[];
    limit?: number;
}) {
    const radar = buildCompetitorWeaknessRadar({
        complaints: input.complaints,
        alerts: input.alerts,
        limit: Math.max((input.limit || 12) * 2, 12),
    });

    return radar.clusters
        .filter((cluster) => isUsefulCompetitorName(cluster.competitor))
        .map((cluster) => {
            const whyNow = buildWhyNowFromWeaknessCluster(cluster);
            return {
                competitor: cluster.competitor,
                weakness_category: cluster.weakness_category,
                complaint_count: cluster.evidence_count,
                source_count: cluster.source_count,
                latest_seen_at: cluster.freshness.latest_observed_at,
                freshness_label: cluster.freshness.freshness_label,
                confidence: whyNow.confidence,
                summary: ensureSentence(cluster.summary, `${cluster.competitor} is seeing repeated weakness signals.`),
                affected_segment: cluster.affected_segment,
                direct_evidence_count: cluster.direct_vs_inferred.direct_evidence_count,
                why_now: whyNow.inferred_why_now_note,
                recommended_angle: ensureSentence(cluster.wedge_opportunity_note, cluster.wedge_opportunity_note),
                recommendation_mode: cluster.direct_vs_inferred.direct_evidence_count > 0 ? "evidence_led" : "heuristic",
                inference_note: cluster.direct_vs_inferred.direct_evidence_count > 0
                    ? "Observed weakness is grounded in repeated complaint rows. The wedge still needs buyer validation before it becomes a product thesis."
                    : "Observed weakness is real, but the wedge is heuristic only. It is inferred from complaint clustering, not direct demand proof.",
            } satisfies CompetitorPressureCard;
        })
        .sort((a, b) =>
            (b.confidence.score - a.confidence.score)
            || (b.complaint_count - a.complaint_count)
            || ((Date.parse(String(b.latest_seen_at || "")) || 0) - (Date.parse(String(a.latest_seen_at || "")) || 0))
        )
        .slice(0, input.limit || 12);
}
