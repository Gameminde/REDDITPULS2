import { buildEvidenceSummary, buildOpportunityEvidence } from "@/lib/evidence";
import {
    buildOpportunitySignalContract,
    rankOpportunityRepresentativePosts,
    shouldSuppressOpportunityIdeaCard,
    type OpportunitySignalContract,
    type OpportunityTopPost,
} from "@/lib/opportunity-signal";
import {
    buildMarketOpportunityPresentation,
    type MarketOpportunityPresentation,
} from "@/lib/market-opportunity-presentation";
import {
    getPublicMarketEditorialVisibility,
    getVisibleMarketEditorial,
    getVisibleMarketEditorialProductAngle,
    parseMarketEditorial,
    type MarketEditorialPayload,
} from "@/lib/market-editorial";
import { buildMarketHint, type MarketHint } from "@/lib/opportunity-actionability";
import { buildOpportunityStrategyPreview, buildOpportunityStrategySnapshot } from "@/lib/opportunity-strategy";
import { isInvalidMarketTopicName, normalizeMarketTopicName } from "@/lib/market-topic-quality";
import {
    explainPublicOpportunityEligibility,
    getPublicOpportunityTitle,
    getSafePublicSummary,
    type PublicOpportunityRejectionReason,
} from "@/lib/public-idea-eligibility";
import {
    resolveMarketVisibilityDecision,
    type MarketVisibilityDecision,
} from "@/lib/market-visibility";
import { buildOpportunityTrust, normalizeSources } from "@/lib/trust";

export type MarketKind =
    | "tracked_theme"
    | "dynamic_theme"
    | "subreddit_bucket"
    | "entity"
    | "malformed";

export type MarketStatus = "visible" | "needs_wedge" | "suppressed";

export interface MarketVisibilityExplanation {
    coarse_classification: {
        market_kind: MarketKind;
        market_status: MarketStatus;
        suppression_reason: string | null;
        board_eligible: boolean;
        board_stale_reason: string | null;
        fresh_candidate: boolean;
    };
    presentation: {
        display_topic: string;
        shape_status: MarketOpportunityPresentation["shape_status"];
        suppress_from_market: boolean;
        suppress_reason: string | null;
    };
    editorial_visibility: {
        visibility: string;
        has_public_editorial: boolean;
        updated_at: string | null;
    };
    public_eligibility: {
        eligible: boolean;
        rejection_reason: PublicOpportunityRejectionReason | null;
    };
    final_surface: {
        user_status: MarketVisibilityDecision["status"];
        user_reason: MarketVisibilityDecision["reason"];
        user_visible: boolean;
        admin_visible: boolean;
        exploratory_visible: boolean;
        include_reason: string;
    };
}

export interface MarketHydratedIdea extends Record<string, unknown> {
    id: string;
    topic: string;
    slug: string;
    category: string;
    pain_summary: string | null;
    source_count: number;
    post_count_total: number;
    post_count_7d: number;
    sources: Array<{ platform: string; count: number }>;
    top_posts: OpportunityTopPost[];
    keywords: string[];
    signal_contract: OpportunitySignalContract;
    trust: ReturnType<typeof buildOpportunityTrust>;
    evidence: ReturnType<typeof buildOpportunityEvidence>;
    evidence_summary: ReturnType<typeof buildEvidenceSummary>;
    source_breakdown: ReturnType<typeof buildEvidenceSummary>["source_breakdown"];
    direct_vs_inferred: ReturnType<typeof buildEvidenceSummary>["direct_vs_inferred"];
    strategy_preview: ReturnType<typeof buildOpportunityStrategyPreview>;
    suggested_wedge_label: string | null;
    market_hint: MarketHint;
    market_kind: MarketKind;
    market_status: MarketStatus;
    suppression_reason: string | null;
    fresh_candidate: boolean;
    board_eligible: boolean;
    board_stale_reason: string | null;
    public_title: string;
    public_summary: string;
    public_verdict: string;
    public_next_step: string;
    public_product_angle: string;
    public_browse_eligible: boolean;
    market_editorial: MarketEditorialPayload | null;
    market_editorial_updated_at: string | null;
    visibility_decision: MarketVisibilityDecision;
    visibility_explanation: MarketVisibilityExplanation;
}

const SHARE_THREAD_PATTERNS = [
    /\bshare your project\b/i,
    /\blet'?s share\b/i,
    /\bshow us what you(?:')?re building\b/i,
    /\bfriday share\b/i,
];

const MALFORMED_TOPIC_PATTERNS = [
    /\bcan'?t in\b/i,
    /\bissue\b.*\bin\b/i,
    /\bproblem\b.*\bin\b/i,
    /\bhelp\b.*\bin\b/i,
];

const GENERIC_THEME_WORDS = new Set([
    "ai",
    "automation",
    "business",
    "content",
    "creator",
    "creators",
    "data",
    "developer",
    "developers",
    "ecommerce",
    "marketing",
    "media",
    "productivity",
    "saas",
    "side",
    "small",
    "social",
    "startup",
    "startups",
    "tools",
]);

const ENTITY_SIGNAL_PATTERNS = [
    /\balternative\b/i,
    /\breplace\b/i,
    /\breplacing\b/i,
    /\bmigration\b/i,
    /\bmigrate\b/i,
    /\bswitch(ed|ing)?\b/i,
    /\bmove(d|ing)?\b/i,
    /\breliability\b/i,
    /\bunstable\b/i,
    /\bbroken\b/i,
    /\bfail(ed|ing)?\b/i,
    /\boutage\b/i,
    /\bdowntime\b/i,
    /\bissue(s)?\b/i,
    /\bbug(s)?\b/i,
    /\bpricing\b/i,
    /\bexpensive\b/i,
    /\bcost\b/i,
];

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

function cleanText(value?: string | null) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueValues(values: Array<string | null | undefined>) {
    return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function countTopicWords(topic: string) {
    return cleanText(topic).split(/\s+/).filter(Boolean).length;
}

function isBroadTheme(topic: string, keywords: string[]) {
    if (countTopicWords(topic) <= 2) return true;
    return keywords.filter(Boolean).length >= 8;
}

function isRecurringShareThread(posts: OpportunityTopPost[]) {
    const normalizedTitles = uniqueValues(posts.slice(0, 4).map((post) => post.title)).map((title) => title.toLowerCase());
    if (normalizedTitles.length !== 1) return false;
    const onlyTitle = normalizedTitles[0] || "";
    return SHARE_THREAD_PATTERNS.some((pattern) => pattern.test(onlyTitle));
}

function isMalformedTopic(topic: string) {
    return MALFORMED_TOPIC_PATTERNS.some((pattern) => pattern.test(cleanText(topic)));
}

function isEntityTopic(topic: string, keywords: string[]) {
    const normalized = normalizeMarketTopicName(topic);
    const words = normalized.split(" ").filter(Boolean);
    if (words.length === 0 || words.length > 3) return false;
    if (keywords.length > 3) return false;
    return words.every((word) => !GENERIC_THEME_WORDS.has(word));
}

function hasEntityPainEvidence(posts: OpportunityTopPost[], signalContract: OpportunitySignalContract) {
    if (signalContract.buyer_native_direct_count > 0 || signalContract.supporting_signal_count > 0) {
        return true;
    }

    return posts.some((post) => {
        const title = cleanText(post.title);
        const signalKind = String(post.signal_kind || "").toLowerCase();
        return ENTITY_SIGNAL_PATTERNS.some((pattern) => pattern.test(title))
            || ["complaint", "workaround", "review_complaint", "feature_request", "willingness_to_pay"].includes(signalKind);
    });
}

function getMarketKind(slug: string, topic: string, keywords: string[]) {
    if (slug.startsWith("sub-")) return "subreddit_bucket" as const;
    if (slug.startsWith("dyn-")) return "dynamic_theme" as const;
    if (isEntityTopic(topic, keywords)) return "entity" as const;
    return "tracked_theme" as const;
}

function classifyMarketRow(input: {
    topic: string;
    slug: string;
    keywords: string[];
    topPosts: OpportunityTopPost[];
    signalContract: OpportunitySignalContract;
}) {
    const { topic, slug, keywords, topPosts, signalContract } = input;

    if (isInvalidMarketTopicName(topic)) {
        return {
            market_kind: "malformed" as const,
            market_status: "suppressed" as const,
            suppression_reason: "Invalid topic name",
        };
    }

    if (isRecurringShareThread(topPosts)) {
        return {
            market_kind: "malformed" as const,
            market_status: "suppressed" as const,
            suppression_reason: "Recurring share thread",
        };
    }

    if (isMalformedTopic(topic)) {
        return {
            market_kind: "malformed" as const,
            market_status: "suppressed" as const,
            suppression_reason: "Malformed cluster title",
        };
    }

    const marketKind = getMarketKind(slug, topic, keywords);

    if (marketKind === "subreddit_bucket") {
        return {
            market_kind: marketKind,
            market_status: "suppressed" as const,
            suppression_reason: "Subreddit pain bucket stays out of the main feed",
        };
    }

    if (marketKind === "entity") {
        if (!hasEntityPainEvidence(topPosts, signalContract)) {
            return {
                market_kind: marketKind,
                market_status: "suppressed" as const,
                suppression_reason: "Entity mention without replacement or reliability pain",
            };
        }

        return {
            market_kind: marketKind,
            market_status: "needs_wedge" as const,
            suppression_reason: null,
        };
    }

    if (isBroadTheme(topic, keywords)) {
        return {
            market_kind: marketKind,
            market_status: "needs_wedge" as const,
            suppression_reason: null,
        };
    }

    return {
        market_kind: marketKind,
        market_status: "visible" as const,
        suppression_reason: null,
    };
}

function isFreshCandidate(input: {
    firstSeen?: string | null;
    marketStatus: MarketStatus;
    sourceCount: number;
    signalContract: OpportunitySignalContract;
}) {
    if (input.marketStatus === "suppressed") return false;
    const firstSeen = input.firstSeen ? Date.parse(String(input.firstSeen)) : Number.NaN;
    if (!Number.isFinite(firstSeen)) return false;
    const ageHours = (Date.now() - firstSeen) / 3600000;
    if (ageHours > 72) return false;
    return input.sourceCount >= 2 || input.signalContract.buyer_native_direct_count >= 1;
}

function getBoardEligibility(input: {
    marketStatus: MarketStatus;
    topic: string;
    postCount7d: number;
    signalContract: OpportunitySignalContract;
    suggestedWedgeLabel: string | null;
}) {
    if (input.marketStatus === "suppressed") {
        return { boardEligible: false, boardStaleReason: "Suppressed market signal" };
    }
    if (input.marketStatus === "needs_wedge" && !input.suggestedWedgeLabel) {
        return { boardEligible: false, boardStaleReason: "Theme still needs a wedge" };
    }
    if (input.signalContract.support_level === "hypothesis") {
        return { boardEligible: false, boardStaleReason: "Still exploratory" };
    }
    if (input.postCount7d <= 0 || (input.signalContract.buyer_native_direct_count <= 0 && input.signalContract.supporting_signal_count <= 0)) {
        return { boardEligible: false, boardStaleReason: "No fresh buyer or supporting evidence in the last 7 days" };
    }
    return { boardEligible: true, boardStaleReason: null };
}

function buildDefaultIcpSummary(idea: MarketHydratedIdea) {
    const representativePosts = rankOpportunityRepresentativePosts(idea.top_posts || []).slice(0, 2);
    const communities = uniqueValues(
        representativePosts.map((post) => {
            const subreddit = cleanText(post.subreddit);
            if (subreddit) return `r/${subreddit}`;
            return cleanText(post.source);
        }),
    );
    if (communities.length > 0) {
        return `People active in ${communities.slice(0, 2).join(" and ")} keep surfacing this workflow pain.`;
    }
    if (idea.source_count > 1) {
        return `Buyers across ${idea.source_count} sources are showing repeated pain around ${idea.topic}.`;
    }
    return `This idea still needs a sharper ICP, but the current signal is clustering around ${idea.topic}.`;
}

export function buildOpportunityPromotionDefaults(idea: MarketHydratedIdea) {
    return {
        label: idea.suggested_wedge_label || idea.topic,
        icp_summary: buildDefaultIcpSummary(idea),
    };
}

export function hydrateIdeaForMarket(idea: Record<string, unknown>): MarketHydratedIdea {
    const parsedTopPosts = safeParseJson(idea.top_posts);
    const parsedKeywords = safeParseJson(idea.keywords);
    const parsedIcpData = safeParseJson(idea.icp_data);
    const parsedCompetitionData = safeParseJson(idea.competition_data);
    const parsedScoreBreakdown = safeParseJson(idea.score_breakdown);
    const parsedMarketEditorial = parseMarketEditorial(idea.market_editorial);
    const normalizedSources = normalizeSources(idea.sources);
    const topPosts = Array.isArray(parsedTopPosts) ? parsedTopPosts as OpportunityTopPost[] : [];
    const keywords = Array.isArray(parsedKeywords) ? parsedKeywords.map(String).filter(Boolean) : [];
    const signalContract = buildOpportunitySignalContract({
        topPosts,
        sources: normalizedSources,
        sourceCount: Number(idea.source_count || normalizedSources.length || 0),
    });
    const trust = buildOpportunityTrust({
        ...idea,
        sources: normalizedSources,
        top_posts: topPosts,
        signal_contract: signalContract,
    });
    const evidence = buildOpportunityEvidence({
        ...idea,
        top_posts: topPosts,
    }, 4);
    const evidenceSummary = buildEvidenceSummary(evidence);
    const strategy = buildOpportunityStrategySnapshot({
        ...(idea as Record<string, unknown>),
        id: String(idea.id || ""),
        slug: String(idea.slug || ""),
        topic: String(idea.topic || ""),
        category: String(idea.category || ""),
        sources: normalizedSources,
        top_posts: topPosts,
        keywords,
        icp_data: parsedIcpData as Record<string, unknown> | null,
        competition_data: parsedCompetitionData as Record<string, unknown> | null,
        trust,
        evidence,
        evidence_summary: evidenceSummary,
    });
    const presentation = buildMarketOpportunityPresentation({
        topic: String(idea.topic || ""),
        slug: String(idea.slug || ""),
        category: String(idea.category || ""),
        keywords,
        topPosts,
        signalContract,
    });
    const classification = classifyMarketRow({
        topic: String(idea.topic || ""),
        slug: String(idea.slug || ""),
        keywords,
        topPosts,
        signalContract,
    });
    const suggestedWedgeLabel = presentation.shape_status === "derived"
        ? presentation.display_topic
        : null;
    const shouldHardSuppressFromPresentation = presentation.suppress_from_market
        && presentation.suppress_reason !== "Broad theme still needs a wedge";

    const normalizedClassification = shouldHardSuppressFromPresentation
        ? {
            ...classification,
            market_status: "suppressed" as const,
            suppression_reason: presentation.suppress_reason || classification.suppression_reason,
        }
        : presentation.shape_status === "derived" && classification.market_status === "needs_wedge"
            ? {
                ...classification,
                market_status: "visible" as const,
                suppression_reason: null,
            }
            : classification;
    const freshness = isFreshCandidate({
        firstSeen: String(idea.first_seen || ""),
        marketStatus: normalizedClassification.market_status,
        sourceCount: Number(idea.source_count || normalizedSources.length || 0),
        signalContract,
    });

    const boardState = getBoardEligibility({
        marketStatus: normalizedClassification.market_status,
        topic: String(idea.topic || ""),
        postCount7d: Number(idea.post_count_7d || 0),
        signalContract,
        suggestedWedgeLabel,
    });

    const hydrated = {
        ...idea,
        id: String(idea.id || ""),
        topic: String(idea.topic || ""),
        slug: String(idea.slug || ""),
        category: String(idea.category || ""),
        pain_summary: typeof idea.pain_summary === "string" ? idea.pain_summary : null,
        source_count: Number(idea.source_count || normalizedSources.length || 0),
        post_count_total: Number(idea.post_count_total || 0),
        post_count_7d: Number(idea.post_count_7d || 0),
        sources: normalizedSources,
        top_posts: topPosts,
        keywords,
        icp_data: parsedIcpData,
        competition_data: parsedCompetitionData,
        score_breakdown: parsedScoreBreakdown,
        signal_contract: signalContract,
        trust,
        evidence,
        evidence_summary: evidenceSummary,
        source_breakdown: evidenceSummary.source_breakdown,
        direct_vs_inferred: evidenceSummary.direct_vs_inferred,
        strategy_preview: buildOpportunityStrategyPreview(strategy),
        suggested_wedge_label: suggestedWedgeLabel,
        market_kind: normalizedClassification.market_kind,
        market_status: normalizedClassification.market_status,
        suppression_reason: normalizedClassification.suppression_reason,
        fresh_candidate: freshness,
        board_eligible: boardState.boardEligible,
        board_stale_reason: boardState.boardStaleReason,
        public_title: "",
        public_summary: "",
        public_verdict: "",
        public_next_step: "",
        public_product_angle: "",
        public_browse_eligible: false,
        market_editorial: parsedMarketEditorial,
        market_editorial_updated_at: typeof idea.market_editorial_updated_at === "string" ? idea.market_editorial_updated_at : null,
        visibility_decision: {
            status: "hidden",
            reason: "weak_proof",
            decided_by: "heuristic",
            confidence_band: "low",
            updated_at: typeof idea.last_updated === "string" ? idea.last_updated : null,
        },
    } satisfies Omit<MarketHydratedIdea, "market_hint">;

    const withHint = {
        ...hydrated,
        market_hint: buildMarketHint(hydrated),
    };

    const public_title = getPublicOpportunityTitle(withHint);
    const public_summary = getSafePublicSummary(withHint);
    const approvedEditorial = getVisibleMarketEditorial(parsedMarketEditorial);
    const public_product_angle = getVisibleMarketEditorialProductAngle(parsedMarketEditorial);
    const publicEligibility = explainPublicOpportunityEligibility(withHint);

    const visibilityDecision = resolveMarketVisibilityDecision({
        ...withHint,
        suggested_wedge_label: public_title || withHint.suggested_wedge_label,
        pain_summary: public_summary || withHint.pain_summary,
        suppression_reason: withHint.suppression_reason,
        market_editorial_updated_at: withHint.market_editorial_updated_at,
        last_updated: typeof idea.last_updated === "string" ? idea.last_updated : null,
    });
    const includeExploratory = !shouldSuppressOpportunityIdeaCard({
        signalContract: withHint.signal_contract,
        postCountTotal: withHint.post_count_total,
    });

    return {
        ...withHint,
        public_title,
        public_summary,
        public_verdict: approvedEditorial?.verdict || "",
        public_next_step: approvedEditorial?.next_step || "",
        public_product_angle,
        public_browse_eligible: visibilityDecision.status === "visible",
        visibility_decision: visibilityDecision,
        visibility_explanation: {
            coarse_classification: {
                market_kind: withHint.market_kind,
                market_status: withHint.market_status,
                suppression_reason: withHint.suppression_reason,
                board_eligible: withHint.board_eligible,
                board_stale_reason: withHint.board_stale_reason,
                fresh_candidate: withHint.fresh_candidate,
            },
            presentation: {
                display_topic: presentation.display_topic,
                shape_status: presentation.shape_status,
                suppress_from_market: presentation.suppress_from_market,
                suppress_reason: presentation.suppress_reason,
            },
            editorial_visibility: {
                visibility: getPublicMarketEditorialVisibility(parsedMarketEditorial) || "none",
                has_public_editorial: Boolean(approvedEditorial),
                updated_at: withHint.market_editorial_updated_at,
            },
            public_eligibility: {
                eligible: publicEligibility.eligible,
                rejection_reason: publicEligibility.reason,
            },
            final_surface: {
                user_status: visibilityDecision.status,
                user_reason: visibilityDecision.reason,
                user_visible: visibilityDecision.status === "visible",
                admin_visible: withHint.market_status !== "suppressed",
                exploratory_visible: includeExploratory,
                include_reason:
                    visibilityDecision.status === "visible"
                        ? "Visible on the public board"
                        : withHint.market_status === "suppressed"
                            ? "Suppressed before public surfacing"
                            : `Hidden from the public board because ${visibilityDecision.reason.replace(/_/g, " ")}`,
            },
        },
    };
}

export function filterMarketIdeas(
    ideas: MarketHydratedIdea[],
    options?: { includeExploratory?: boolean; surface?: "user" | "admin" },
) {
    const includeExploratory = Boolean(options?.includeExploratory);
    const surface = options?.surface || "user";
    return ideas.filter((idea) => shouldIncludeMarketIdea(idea, includeExploratory, surface));
}

export function shouldIncludeMarketIdea(
    idea: MarketHydratedIdea,
    includeExploratory = false,
    surface: "user" | "admin" = "user",
) {
    if (surface === "user" && idea.visibility_decision.status !== "visible") return false;
    if (surface === "admin" && idea.market_status === "suppressed") return false;
    if (includeExploratory) return true;
    return !shouldSuppressOpportunityIdeaCard({
        signalContract: idea.signal_contract,
        postCountTotal: idea.post_count_total,
    });
}

export function buildMarketIdeas(
    rows: Array<Record<string, unknown>>,
    options?: { includeExploratory?: boolean; surface?: "user" | "admin" },
) {
    return filterMarketIdeas(rows.map((row) => hydrateIdeaForMarket(row)), options);
}
