import { buildOpportunityEvidence, buildEvidenceSummary } from "@/lib/evidence";
import { getVisibleMarketEditorial, getVisibleMarketEditorialProductAngle } from "@/lib/market-editorial";
import { buildMarketIdeas } from "@/lib/market-feed";
import { buildOpportunityStrategySnapshot } from "@/lib/opportunity-strategy";
import { getPublicOpportunityTitle, getSafePublicSummary } from "@/lib/public-idea-eligibility";
import { buildOpportunityTrust, normalizeSources } from "@/lib/trust";

const IDEA_LIST_BASE_FIELDS = [
    "id",
    "topic",
    "slug",
    "current_score",
    "change_24h",
    "change_7d",
    "change_30d",
    "trend_direction",
    "confidence_level",
    "post_count_total",
    "post_count_24h",
    "post_count_7d",
    "source_count",
    "sources",
    "category",
    "competition_data",
    "icp_data",
    "top_posts",
    "keywords",
    "pain_count",
    "pain_summary",
    "first_seen",
    "last_updated",
    "score_breakdown",
];

const IDEA_EDITORIAL_FIELDS = [
    "market_editorial",
    "market_editorial_updated_at",
];

export const IDEA_LIST_SELECT = [
    ...IDEA_LIST_BASE_FIELDS,
    ...IDEA_EDITORIAL_FIELDS,
].join(", ");

export const IDEA_LIST_SELECT_LEGACY = IDEA_LIST_BASE_FIELDS.join(", ");

export const IDEA_DETAIL_SELECT = [
    IDEA_LIST_SELECT,
    "reddit_velocity",
    "google_trend_score",
    "google_trend_growth",
    "competition_score",
    "cross_platform_multiplier",
].join(", ");

export const IDEA_DETAIL_SELECT_LEGACY = [
    IDEA_LIST_SELECT_LEGACY,
    "reddit_velocity",
    "google_trend_score",
    "google_trend_growth",
    "competition_score",
    "cross_platform_multiplier",
].join(", ");

export const IDEA_HISTORY_SELECT = "score, post_count, source_count, recorded_at";

export function isMissingMarketEditorialColumnError(error: unknown) {
    const message = String((error as { message?: unknown })?.message || error || "").toLowerCase();
    return message.includes("market_editorial");
}

export function safeParseJson<T = unknown>(value: unknown) {
    if (typeof value === "string") {
        try {
            return JSON.parse(value) as T;
        } catch {
            return value;
        }
    }
    return value;
}

export function buildIdeasListPayload(
    rows: Array<Record<string, unknown>>,
    options?: { includeExploratory?: boolean; surface?: "user" | "admin"; limit?: number },
) {
    const ideas = buildMarketIdeas(rows, options);
    const limitedIdeas = typeof options?.limit === "number" ? ideas.slice(0, options.limit) : ideas;
    return { ideas: limitedIdeas, total: ideas.length };
}

export function buildIdeaDetailPayload(
    idea: Record<string, unknown>,
    history: Array<Record<string, unknown>> = [],
) {
    const parsedTopPosts = safeParseJson(idea.top_posts);
    const parsedKeywords = safeParseJson(idea.keywords);
    const parsedIcpData = safeParseJson(idea.icp_data);
    const parsedCompetitionData = safeParseJson(idea.competition_data);
    const approvedEditorial = getVisibleMarketEditorial(idea.market_editorial);
    const normalizedSources = normalizeSources(idea.sources);
    const trust = buildOpportunityTrust({
        ...idea,
        sources: normalizedSources,
        top_posts: parsedTopPosts,
    });
    const evidence = buildOpportunityEvidence({
        ...idea,
        top_posts: parsedTopPosts,
    }, 8);
    const evidenceSummary = buildEvidenceSummary(evidence);
    const strategy = buildOpportunityStrategySnapshot({
        ...(idea as Record<string, unknown>),
        id: String(idea.id || ""),
        slug: String(idea.slug || ""),
        topic: String(idea.topic || ""),
        category: String(idea.category || ""),
        sources: normalizedSources,
        top_posts: Array.isArray(parsedTopPosts) ? parsedTopPosts : [],
        keywords: Array.isArray(parsedKeywords) ? parsedKeywords : [],
        icp_data: parsedIcpData as Record<string, unknown> | null,
        competition_data: parsedCompetitionData as Record<string, unknown> | null,
        trust,
        evidence,
        evidence_summary: evidenceSummary,
    });

    return {
        idea: {
            ...idea,
            public_title: getPublicOpportunityTitle({
                ...idea,
                sources: normalizedSources,
                top_posts: Array.isArray(parsedTopPosts) ? parsedTopPosts : [],
            }),
            public_summary: getSafePublicSummary({
                ...idea,
                sources: normalizedSources,
                top_posts: Array.isArray(parsedTopPosts) ? parsedTopPosts : [],
            }),
            public_verdict: approvedEditorial?.verdict || "",
            public_next_step: approvedEditorial?.next_step || "",
            public_product_angle: getVisibleMarketEditorialProductAngle(idea.market_editorial),
            sources: normalizedSources,
            top_posts: parsedTopPosts,
            keywords: parsedKeywords,
            icp_data: parsedIcpData,
            competition_data: parsedCompetitionData,
            trust,
            evidence,
            evidence_summary: evidenceSummary,
            source_breakdown: evidenceSummary.source_breakdown,
            direct_vs_inferred: evidenceSummary.direct_vs_inferred,
            strategy,
        },
        history,
    };
}
