import {
    explainPublicOpportunityEligibility,
    getPublicOpportunityTitle,
    type PublicIdeaInput,
    type PublicOpportunityRejectionReason,
} from "@/lib/public-idea-eligibility";
import { getPublicMarketEditorialVisibility } from "@/lib/market-editorial";

export type MarketVisibilityStatus = "visible" | "hidden";
export type MarketVisibilityReason =
    | "visible"
    | "malformed"
    | "needs_wedge"
    | "weak_proof"
    | "duplicate"
    | "editorial_hidden"
    | "invalid_copy";
export type MarketVisibilityDecidedBy = "heuristic" | "editorial" | "manual";
export type MarketVisibilityConfidenceBand = "high" | "medium" | "low";

export interface MarketVisibilityDecision {
    status: MarketVisibilityStatus;
    reason: MarketVisibilityReason;
    decided_by: MarketVisibilityDecidedBy;
    confidence_band: MarketVisibilityConfidenceBand;
    updated_at: string | null;
}

export interface MarketVisibilityInput extends PublicIdeaInput {
    suppression_reason?: string | null;
    last_updated?: string | null;
    market_editorial_updated_at?: string | null;
}

export const MARKET_VISIBILITY_REASON_LABELS: Record<MarketVisibilityReason, string> = {
    visible: "Visible on the board",
    malformed: "Hidden as malformed or unshaped",
    needs_wedge: "Hidden until the wedge is clearer",
    weak_proof: "Hidden because proof is still too weak",
    duplicate: "Hidden as a duplicate opportunity",
    editorial_hidden: "Hidden by editorial review",
    invalid_copy: "Hidden because the public copy is still too weak",
};

function cleanText(value: unknown) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeConfidenceBand(value: unknown): MarketVisibilityConfidenceBand {
    const normalized = cleanText(value).toUpperCase();
    if (normalized === "HIGH") return "high";
    if (normalized === "MEDIUM") return "medium";
    return "low";
}

function normalizeUpdatedAt(input: MarketVisibilityInput) {
    return cleanText(input.market_editorial_updated_at || input.last_updated) || null;
}

function getDecidedBy(input: MarketVisibilityInput, reason: MarketVisibilityReason): MarketVisibilityDecidedBy {
    const editorialVisibility = getPublicMarketEditorialVisibility(input.market_editorial);
    if (
        editorialVisibility === "public"
        || editorialVisibility === "internal"
        || editorialVisibility === "duplicate"
        || editorialVisibility === "needs_more_proof"
    ) {
        return "editorial";
    }
    return "heuristic";
}

function mapSuppressionReason(reason: string): MarketVisibilityReason {
    const normalized = cleanText(reason).toLowerCase();
    if (!normalized) return "malformed";
    if (
        normalized.includes("invalid topic")
        || normalized.includes("malformed")
        || normalized.includes("share thread")
        || normalized.includes("subreddit pain bucket")
    ) {
        return "malformed";
    }
    if (normalized.includes("wedge")) {
        return "needs_wedge";
    }
    return "weak_proof";
}

function mapEligibilityReason(
    input: MarketVisibilityInput,
    reason: PublicOpportunityRejectionReason | null,
): MarketVisibilityReason {
    const editorialVisibility = getPublicMarketEditorialVisibility(input.market_editorial);
    if (editorialVisibility === "duplicate") return "duplicate";
    if (editorialVisibility === "internal") return "editorial_hidden";

    if (cleanText(input.market_status).toLowerCase() === "suppressed") {
        return mapSuppressionReason(cleanText(input.suppression_reason));
    }

    if (cleanText(input.market_status).toLowerCase() === "needs_wedge" && !cleanText(input.suggested_wedge_label)) {
        const publicTitle = cleanText(getPublicOpportunityTitle(input));
        const topic = cleanText(input.topic);
        if (!publicTitle || publicTitle.toLowerCase() === topic.toLowerCase()) {
            return "needs_wedge";
        }
    }

    switch (reason) {
        case "editorial_hidden":
            return "editorial_hidden";
        case "needs_wedge":
            return "needs_wedge";
        case "editorial_needs_more_proof":
        case "insufficient_confidence":
        case "score_below_threshold":
        case "insufficient_posts":
        case "insufficient_sources":
        case "suppressed_market_status":
            return "weak_proof";
        case "invalid_title":
        case "invalid_summary":
            return "invalid_copy";
        default:
            return "weak_proof";
    }
}

export function resolveMarketVisibilityDecision(input: MarketVisibilityInput): MarketVisibilityDecision {
    const eligibility = explainPublicOpportunityEligibility(input);
    const status: MarketVisibilityStatus = eligibility.eligible ? "visible" : "hidden";
    const reason = eligibility.eligible ? "visible" : mapEligibilityReason(input, eligibility.reason);

    return {
        status,
        reason,
        decided_by: getDecidedBy(input, reason),
        confidence_band: normalizeConfidenceBand(input.confidence_level),
        updated_at: normalizeUpdatedAt(input),
    };
}
