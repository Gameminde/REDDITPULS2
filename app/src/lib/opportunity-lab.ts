import {
    buildOpportunitySignalContract,
    rankOpportunityRepresentativePosts,
    shouldSuppressOpportunityIdeaCard,
    type OpportunitySignalContract,
    type OpportunityTopPost,
} from "@/lib/opportunity-signal";
import type { NormalizedSource, TrustMetadata } from "@/lib/trust";

export type OpportunityLabLane =
    | "candidate_opportunity"
    | "theme_to_shape"
    | "market_context"
    | "ignore";

export interface OpportunityLabIdeaInput {
    id: string;
    slug: string;
    topic: string;
    category: string;
    current_score: number;
    post_count_total: number;
    source_count: number;
    sources: NormalizedSource[];
    top_posts: OpportunityTopPost[];
    keywords?: string[];
    signal_contract?: OpportunitySignalContract | null;
    trust: TrustMetadata;
}

export interface OpportunityLabIdea {
    id: string;
    slug: string;
    topic: string;
    category: string;
    lane: OpportunityLabLane;
    lane_label: string;
    action_label: string;
    thesis: string;
    reason: string;
    validation_seed: string | null;
    representative_titles: string[];
    score: number;
    source_count: number;
    post_count_total: number;
    signal_contract: OpportunitySignalContract;
    trust: TrustMetadata;
}

function countWords(text: string) {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

function isBroadTheme(topic: string, keywords: string[]) {
    const normalized = String(topic || "").trim();
    if (!normalized) return true;
    if (countWords(normalized) <= 2) return true;
    if (keywords.length >= 8) return true;
    return false;
}

function cleanTitle(title?: string | null) {
    return String(title || "").replace(/\s+/g, " ").trim();
}

function buildValidationSeed(topic: string, post?: OpportunityTopPost | null) {
    if (!post) return null;
    const headline = cleanTitle(post.title);
    if (!headline) return topic;
    return `${topic} for teams struggling with: "${headline}"`;
}

function classifyLane(input: {
    topic: string;
    keywords: string[];
    signalContract: OpportunitySignalContract;
    trust: TrustMetadata;
    postCountTotal: number;
}) {
    const broadTheme = isBroadTheme(input.topic, input.keywords);
    const directCount = Number(input.signalContract.buyer_native_direct_count || 0);
    const supportLevel = input.signalContract.support_level;
    const suppressed = shouldSuppressOpportunityIdeaCard({
        signalContract: input.signalContract,
        postCountTotal: input.postCountTotal,
    });

    if (!suppressed && supportLevel === "evidence_backed" && directCount >= 2 && input.trust.source_count >= 2 && !broadTheme) {
        return {
            lane: "candidate_opportunity" as const,
            lane_label: "Candidate Opportunity",
            action_label: "Validate now",
            thesis: "This already looks like a shaped opportunity, not just a broad theme.",
        };
    }

    if (supportLevel !== "hypothesis" || directCount > 0) {
        return {
            lane: "theme_to_shape" as const,
            lane_label: "Theme To Shape",
            action_label: "Shape before validating",
            thesis: "Pain is visible, but the market still needs a tighter wedge and ICP framing.",
        };
    }

    if (!suppressed) {
        return {
            lane: "market_context" as const,
            lane_label: "Market Context",
            action_label: "Watch only",
            thesis: "This is useful context, but not strong enough to treat as a real opportunity yet.",
        };
    }

    return {
        lane: "ignore" as const,
        lane_label: "Ignore / Noise",
        action_label: "Ignore",
        thesis: "This is mostly builder chatter or weak context and should not drive product decisions.",
    };
}

export function buildOpportunityLabIdea(input: OpportunityLabIdeaInput): OpportunityLabIdea {
    const signalContract = input.signal_contract || buildOpportunitySignalContract({
        topPosts: input.top_posts,
        sources: input.sources,
        sourceCount: input.source_count,
    });
    const rankedPosts = rankOpportunityRepresentativePosts(input.top_posts || []);
    const strongestPost = rankedPosts[0] || null;
    const keywords = Array.isArray(input.keywords) ? input.keywords.filter(Boolean) : [];
    const classification = classifyLane({
        topic: input.topic,
        keywords,
        signalContract,
        trust: input.trust,
        postCountTotal: input.post_count_total,
    });

    let reason = signalContract.summary;
    if (classification.lane === "candidate_opportunity") {
        reason = `${signalContract.summary} The current signal is strong enough to validate as a specific bet.`;
    } else if (classification.lane === "theme_to_shape") {
        reason = `${signalContract.summary} Treat this as a theme that needs a sharper wedge before you ask the validator for a verdict.`;
    } else if (classification.lane === "market_context") {
        reason = `${signalContract.summary} Keep it as background context, not a decision-ready idea.`;
    } else {
        reason = `${signalContract.summary} It should stay out of the main market flow unless stronger buyer-native proof appears.`;
    }

    return {
        id: input.id,
        slug: input.slug,
        topic: input.topic,
        category: input.category,
        lane: classification.lane,
        lane_label: classification.lane_label,
        action_label: classification.action_label,
        thesis: classification.thesis,
        reason,
        validation_seed: buildValidationSeed(input.topic, strongestPost),
        representative_titles: rankedPosts.slice(0, 3).map((post) => cleanTitle(post.title)).filter(Boolean),
        score: input.current_score,
        source_count: input.source_count,
        post_count_total: input.post_count_total,
        signal_contract: signalContract,
        trust: input.trust,
    };
}
