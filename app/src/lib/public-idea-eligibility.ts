import { isInvalidMarketTopicName, normalizeMarketTopicName } from "@/lib/market-topic-quality";
import { getApprovedMarketEditorial, getPublicMarketEditorialVisibility, getVisibleMarketEditorial } from "@/lib/market-editorial";
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
    market_editorial?: unknown;
}

export type PublicOpportunityRejectionReason =
    | "insufficient_confidence"
    | "suppressed_market_status"
    | "editorial_hidden"
    | "score_below_threshold"
    | "insufficient_posts"
    | "insufficient_sources"
    | "invalid_title"
    | "invalid_summary";

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
    const approvedEditorial = getVisibleMarketEditorial(input.market_editorial);
    if (approvedEditorial && !isBlockedPublicOpportunityTitle(approvedEditorial.edited_title)) {
        return approvedEditorial.edited_title;
    }

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
    const approvedEditorial = getVisibleMarketEditorial(input.market_editorial);
    if (approvedEditorial && !isLowQualityUserFacingCopy(approvedEditorial.edited_summary)) {
        return approvedEditorial.edited_summary;
    }

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

export function explainPublicOpportunityEligibility(input: PublicIdeaInput): {
    eligible: boolean;
    reason: PublicOpportunityRejectionReason | null;
} {
    if (cleanText(input.confidence_level).toUpperCase() === "INSUFFICIENT") {
        return { eligible: false, reason: "insufficient_confidence" };
    }
    if (cleanText(input.market_status).toLowerCase() === "suppressed") {
        return { eligible: false, reason: "suppressed_market_status" };
    }
    const editorialVisibility = getPublicMarketEditorialVisibility(input.market_editorial);
    if (editorialVisibility && editorialVisibility !== "public") {
        return { eligible: false, reason: "editorial_hidden" };
    }
    if (toFiniteNumber(input.current_score) < 30) {
        return { eligible: false, reason: "score_below_threshold" };
    }
    if (toFiniteNumber(input.post_count_total) < 5) {
        return { eligible: false, reason: "insufficient_posts" };
    }

    const directBuyerProofCount = getPublicDirectBuyerProofCount(input);
    if (toFiniteNumber(input.source_count) < 2 && directBuyerProofCount <= 0) {
        return { eligible: false, reason: "insufficient_sources" };
    }

    if (!getPublicOpportunityTitle(input)) {
        return { eligible: false, reason: "invalid_title" };
    }
    if (!getSafePublicSummary(input)) {
        return { eligible: false, reason: "invalid_summary" };
    }

    return { eligible: true, reason: null };
}

export function isPublicOpportunityEligible(input: PublicIdeaInput) {
    return explainPublicOpportunityEligibility(input).eligible;
}
