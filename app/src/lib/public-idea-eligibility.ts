import { isInvalidMarketTopicName, normalizeMarketTopicName } from "@/lib/market-topic-quality";
import { isLowQualityUserFacingCopy, summarizeIdeaForBrowse } from "@/lib/user-facing-copy";

type PublicSourceCount = {
    platform?: string | null;
    count?: number | null;
};

type PublicTopPost = {
    title?: string | null;
    subreddit?: string | null;
    source?: string | null;
    source_name?: string | null;
};

type PublicSignalContract = {
    buyer_native_direct_count?: number | null;
};

export interface PublicIdeaInput {
    topic?: string | null;
    suggested_wedge_label?: string | null;
    category?: string | null;
    pain_summary?: string | null;
    current_score?: number | null;
    post_count_total?: number | null;
    post_count_7d?: number | null;
    source_count?: number | null;
    confidence_level?: string | null;
    market_status?: string | null;
    sources?: PublicSourceCount[] | null;
    top_posts?: PublicTopPost[] | null;
    signal_contract?: PublicSignalContract | null;
}

const HARD_BLOCK_TOPIC_PATTERNS = [
    /^pain signals from /i,
    /^people repeatedly /i,
    /^why this card is here$/i,
    /^explore page$/i,
    /^featured offer$/i,
    /^hey guys$/i,
    /^hey all$/i,
    /^don know$/i,
    /^else tired$/i,
];

function cleanText(value: unknown) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function toFiniteNumber(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizePublicOpportunityTitle(value?: string | null) {
    return cleanText(value)
        .replace(/^pain signals from\s+/i, "")
        .replace(/^people repeatedly\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function isBlockedPublicOpportunityTitle(value?: string | null) {
    const normalized = normalizePublicOpportunityTitle(value);
    if (!normalized) return true;
    if (HARD_BLOCK_TOPIC_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
    if (isInvalidMarketTopicName(normalized)) return true;

    const normalizedTopic = normalizeMarketTopicName(normalized);
    if (!normalizedTopic) return true;
    if (normalizedTopic.startsWith("pain signals from")) return true;
    if (normalizedTopic.startsWith("people repeatedly")) return true;

    return false;
}

export function getPublicOpportunityTitle(input: PublicIdeaInput) {
    const preferred = normalizePublicOpportunityTitle(input.suggested_wedge_label);
    if (preferred && !isBlockedPublicOpportunityTitle(preferred)) {
        return preferred;
    }

    const fallback = normalizePublicOpportunityTitle(input.topic);
    if (fallback && !isBlockedPublicOpportunityTitle(fallback)) {
        return fallback;
    }

    return "";
}

export function getPublicDirectBuyerProofCount(input: PublicIdeaInput) {
    return Math.max(0, toFiniteNumber(input.signal_contract?.buyer_native_direct_count));
}

export function getSafePublicSummary(input: PublicIdeaInput) {
    const publicTitle = getPublicOpportunityTitle(input);
    if (!publicTitle) return "";

    const summary = summarizeIdeaForBrowse({
        topic: publicTitle,
        category: input.category,
        pain_summary: input.pain_summary,
        post_count_total: input.post_count_total,
        post_count_7d: input.post_count_7d,
        top_posts: input.top_posts,
        sources: input.sources,
    });

    if (!summary || isLowQualityUserFacingCopy(summary)) {
        return "";
    }

    return summary;
}

export function isPublicOpportunityEligible(input: PublicIdeaInput) {
    if (cleanText(input.confidence_level).toUpperCase() === "INSUFFICIENT") return false;
    if (cleanText(input.market_status).toLowerCase() === "suppressed") return false;
    if (toFiniteNumber(input.current_score) < 30) return false;
    if (toFiniteNumber(input.post_count_total) < 5) return false;

    const directBuyerProofCount = getPublicDirectBuyerProofCount(input);
    if (toFiniteNumber(input.source_count) < 2 && directBuyerProofCount <= 0) return false;

    if (!getPublicOpportunityTitle(input)) return false;
    if (!getSafePublicSummary(input)) return false;

    return true;
}
