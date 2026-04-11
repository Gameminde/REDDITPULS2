import { buildMarketIdeas, hydrateIdeaForMarket, type MarketHydratedIdea } from "@/lib/market-feed";
import { createAdmin } from "@/lib/supabase-admin";

export type PublicPainExample = {
    topic: string;
    wedge: string;
    pain: string;
    source: string;
    community: string;
    score: number;
    evidenceCount: number;
    sourceCount: number;
    why: string;
};

export type PublicWedgeCard = {
    topic: string;
    wedge: string;
    category: string;
    score: number;
    evidenceCount: number;
    sourceCount: number;
    ageLabel: string;
    why: string;
};

export type PublicSiteStats = {
    visibleSignals: number;
    rawIdeas: number;
    evidencePosts: number;
    shapedWedges: number;
};

export type PublicRadarIdea = {
    slug: string;
    title: string;
    topic: string;
    category: string;
    score: number;
    evidenceCount: number;
    sourceCount: number;
    ageLabel: string;
    trendLabel: string;
    summary: string;
    why: string;
    sourceMix: string;
    directBuyerCount: number;
    href: string;
};

export type PublicCategorySummary = {
    name: string;
    count: number;
};

export type PublicSiteData = {
    stats: PublicSiteStats;
    painExamples: PublicPainExample[];
    recentWedges: PublicWedgeCard[];
    radarIdeas: PublicRadarIdea[];
    categories: PublicCategorySummary[];
};

const FALLBACK_PAIN_EXAMPLES: PublicPainExample[] = [
    {
        topic: "Social Media",
        wedge: "Social media content workflow for managers",
        pain: "How are social media managers getting branded video series that perform without weekly burnout?",
        source: "Reddit",
        community: "r/socialmedia",
        score: 31,
        evidenceCount: 8,
        sourceCount: 2,
        why: "Repeated workflow pain plus founder-side build chatter suggests room for a calmer manager-first workflow.",
    },
    {
        topic: "Screen Studio",
        wedge: "Screen recording alternative for macOS and Windows",
        pain: "Is there any good screen studio alternative on macOS?",
        source: "Hacker News",
        community: "launch thread",
        score: 16,
        evidenceCount: 3,
        sourceCount: 2,
        why: "Cross-source mentions signal that platform gaps, not just pricing, are creating the opening.",
    },
    {
        topic: "IFTTT Applet",
        wedge: "IFTTT applet debugging and reliability",
        pain: "IFTTT applet failed on the last three attempts.",
        source: "Reddit",
        community: "r/ifttt",
        score: 14,
        evidenceCount: 3,
        sourceCount: 1,
        why: "Reliability complaints are specific enough to become a focused opportunity instead of a generic automation theme.",
    },
];

const FALLBACK_WEDGES: PublicWedgeCard[] = FALLBACK_PAIN_EXAMPLES.map((example) => ({
    topic: example.topic,
    wedge: example.wedge,
    category: "Live theme",
    score: example.score,
    evidenceCount: example.evidenceCount,
    sourceCount: example.sourceCount,
    ageLabel: "recently discovered",
    why: example.why,
}));

function cleanText(value: unknown) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function formatPlatform(value: string) {
    const normalized = cleanText(value).toLowerCase();
    switch (normalized) {
        case "hackernews":
            return "Hacker News";
        case "producthunt":
            return "Product Hunt";
        case "indiehackers":
            return "Indie Hackers";
        case "githubissues":
            return "GitHub Issues";
        case "g2_review":
            return "G2 Reviews";
        case "job_posting":
            return "Job Signals";
        case "reddit":
            return "Reddit";
        default:
            return cleanText(value) || "Community";
    }
}

function formatCategory(value: string) {
    const normalized = cleanText(value).replace(/-/g, " ");
    if (!normalized) return "Uncategorized";
    return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function toSentence(value: string, fallback: string) {
    const text = cleanText(value || fallback);
    if (!text) return fallback;
    return /[.!?]$/.test(text) ? text : `${text}.`;
}

function isLowQualityLandingText(value: string) {
    const normalized = cleanText(value).toLowerCase();
    if (!normalized) return true;
    return (
        normalized === "http status 0"
        || normalized.startsWith("http status ")
        || normalized.includes("trying create")
        || normalized.includes("pain signals from")
        || normalized.includes("people repeatedly complain about")
        || normalized.includes("explore page")
        || normalized.includes("featured offer")
        || normalized.includes("hey guys")
    );
}

function hoursSince(firstSeen: unknown) {
    const parsed = Date.parse(String(firstSeen || ""));
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, (Date.now() - parsed) / 3600000);
}

function formatAgeLabel(firstSeen: unknown) {
    const hours = hoursSince(firstSeen);
    if (hours == null) return "timing unavailable";
    if (hours < 24) return `${Math.max(1, Math.round(hours))}h old`;
    const days = Math.max(1, Math.round(hours / 24));
    if (days < 14) return `${days}d old`;
    return "older live idea";
}

function formatTrendLabel(direction: unknown) {
    const normalized = cleanText(direction).toLowerCase();
    if (normalized === "rising") return "Gaining traction";
    if (normalized === "falling") return "Cooling off";
    if (normalized === "new") return "Newly tracked";
    return "Holding steady";
}

function pickPainPost(idea: MarketHydratedIdea) {
    const ranked = [...(idea.top_posts || [])].sort((a, b) => {
        const painPriority = (post: MarketHydratedIdea["top_posts"][number]) =>
            Number((post as { pain_score?: number } | null)?.pain_score || 0);
        const signalPriority = (post: MarketHydratedIdea["top_posts"][number]) => {
            const kind = cleanText(post?.signal_kind).toLowerCase();
            if (kind === "complaint") return 4;
            if (kind === "feature_request") return 3;
            if (kind === "willingness_to_pay") return 2;
            return 1;
        };
        const directPriority = (post: MarketHydratedIdea["top_posts"][number]) => {
            const tier = cleanText(post?.directness_tier).toLowerCase();
            if (tier === "direct") return 3;
            if (tier === "adjacent") return 2;
            return 1;
        };

        return (
            signalPriority(b) - signalPriority(a)
            || directPriority(b) - directPriority(a)
            || painPriority(b) - painPriority(a)
            || Number(b?.comments || 0) - Number(a?.comments || 0)
            || Number(b?.score || 0) - Number(a?.score || 0)
        );
    });

    return ranked.find((post) => cleanText(post?.title)) || idea.top_posts?.[0] || null;
}

function dedupeByWedge(ideas: MarketHydratedIdea[]) {
    const seen = new Set<string>();
    return ideas.filter((idea) => {
        const key = cleanText(idea.suggested_wedge_label || idea.public_title || idea.topic).toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function buildSourceMix(idea: MarketHydratedIdea) {
    const topSources = [...(idea.sources || [])]
        .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
        .slice(0, 3)
        .map((source) => `${formatPlatform(source.platform)} ${Number(source.count || 0)}`);

    return topSources.join(" · ");
}

export async function getPublicSiteData(): Promise<PublicSiteData> {
    try {
        const admin = createAdmin();
        const { data: ideaRows, error } = await admin
            .from("ideas")
            .select("*")
            .neq("confidence_level", "INSUFFICIENT");

        if (error) throw error;

        const hydratedIdeas = (ideaRows || []).map((row) => hydrateIdeaForMarket(row as Record<string, unknown>));
        const visibleIdeas = buildMarketIdeas((ideaRows || []) as Array<Record<string, unknown>>, {
            includeExploratory: false,
            surface: "user",
        });

        const proofIdeas = dedupeByWedge(
            visibleIdeas
                .filter((idea) =>
                    idea.market_status !== "suppressed"
                    && Boolean(idea.public_title || idea.suggested_wedge_label || idea.topic)
                    && !idea.slug.startsWith("sub-"),
                )
                .sort((a, b) =>
                    (hoursSince(a.first_seen) ?? Number.POSITIVE_INFINITY) - (hoursSince(b.first_seen) ?? Number.POSITIVE_INFINITY)
                    || Number(b.current_score || 0) - Number(a.current_score || 0),
                ),
        );

        const painExamples = proofIdeas
            .map((idea) => {
                const painPost = pickPainPost(idea);
                if (!painPost) return null;
                const topic = cleanText(idea.topic);
                const wedge = cleanText(idea.public_title || idea.suggested_wedge_label) || topic;
                const pain = cleanText(painPost.title);
                if (isLowQualityLandingText(topic) || isLowQualityLandingText(wedge) || isLowQualityLandingText(pain)) {
                    return null;
                }

                return {
                    topic,
                    wedge,
                    pain,
                    source: formatPlatform(cleanText(painPost.source_name || painPost.source)),
                    community: painPost.subreddit ? `r/${cleanText(painPost.subreddit)}` : "public thread",
                    score: Number(idea.current_score || 0),
                    evidenceCount: Number(idea.post_count_total || 0),
                    sourceCount: Number(idea.source_count || 0),
                    why: toSentence(
                        cleanText(idea.market_hint?.why_it_matters_now || idea.market_hint?.missing_proof || idea.signal_contract?.summary || ""),
                        `${cleanText(idea.public_title || idea.suggested_wedge_label || idea.topic)} is showing enough repeated pain to become a focused opportunity.`,
                    ),
                } satisfies PublicPainExample;
            })
            .filter((example): example is PublicPainExample => Boolean(example))
            .slice(0, 3);

        const recentWedges = proofIdeas
            .filter((idea) => !isLowQualityLandingText(cleanText(idea.topic)) && !isLowQualityLandingText(cleanText(idea.public_title || idea.suggested_wedge_label || "")))
            .slice(0, 9)
            .map((idea) => ({
                topic: idea.topic,
                wedge: cleanText(idea.public_title || idea.suggested_wedge_label) || idea.topic,
                category: formatCategory(idea.category),
                score: Number(idea.current_score || 0),
                evidenceCount: Number(idea.post_count_total || 0),
                sourceCount: Number(idea.source_count || 0),
                ageLabel: formatAgeLabel(idea.first_seen),
                why: toSentence(
                    cleanText(idea.market_hint?.why_it_matters_now || idea.market_hint?.missing_proof || idea.strategy_preview?.strongest_reason || ""),
                    `${cleanText(idea.public_title || idea.suggested_wedge_label || idea.topic)} is clustering fast enough to watch closely.`,
                ),
            } satisfies PublicWedgeCard));

        const radarIdeas = proofIdeas
            .slice(0, 18)
            .map((idea) => ({
                slug: idea.slug,
                title: cleanText(idea.public_title || idea.suggested_wedge_label || idea.topic),
                topic: cleanText(idea.topic),
                category: formatCategory(idea.category),
                score: Number(idea.current_score || 0),
                evidenceCount: Number(idea.post_count_total || 0),
                sourceCount: Number(idea.source_count || 0),
                ageLabel: formatAgeLabel(idea.first_seen),
                trendLabel: formatTrendLabel(idea.trend_direction),
                summary: toSentence(
                    cleanText(idea.public_summary || idea.signal_contract?.summary || idea.market_hint?.missing_proof || ""),
                    `${cleanText(idea.public_title || idea.suggested_wedge_label || idea.topic)} is clustering around repeated workflow pain.`,
                ),
                why: toSentence(
                    cleanText(idea.market_hint?.why_it_matters_now || idea.market_hint?.recommended_board_action || ""),
                    `${cleanText(idea.public_title || idea.suggested_wedge_label || idea.topic)} is moving enough to deserve a closer look.`,
                ),
                sourceMix: buildSourceMix(idea),
                directBuyerCount: Number(idea.signal_contract?.buyer_native_direct_count || 0),
                href: `/dashboard/idea/${encodeURIComponent(idea.slug)}`,
            } satisfies PublicRadarIdea));

        const categoryCounts = new Map<string, number>();
        for (const idea of proofIdeas) {
            const category = formatCategory(idea.category);
            categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
        }
        const categories = [...categoryCounts.entries()]
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
            .slice(0, 8);

        const stats: PublicSiteStats = {
            visibleSignals: visibleIdeas.length,
            rawIdeas: hydratedIdeas.length,
            evidencePosts: hydratedIdeas.reduce((sum, idea) => sum + Number(idea.post_count_total || 0), 0),
            shapedWedges: proofIdeas.length,
        };

        return {
            stats,
            painExamples: painExamples.length > 0 ? painExamples : FALLBACK_PAIN_EXAMPLES,
            recentWedges: recentWedges.length > 0 ? recentWedges : FALLBACK_WEDGES,
            radarIdeas,
            categories,
        };
    } catch {
        return {
            stats: {
                visibleSignals: 0,
                rawIdeas: 0,
                evidencePosts: 0,
                shapedWedges: FALLBACK_WEDGES.length,
            },
            painExamples: FALLBACK_PAIN_EXAMPLES,
            recentWedges: FALLBACK_WEDGES,
            radarIdeas: FALLBACK_WEDGES.map((idea, index) => ({
                slug: `fallback-${index}`,
                title: idea.wedge,
                topic: idea.topic,
                category: idea.category,
                score: idea.score,
                evidenceCount: idea.evidenceCount,
                sourceCount: idea.sourceCount,
                ageLabel: idea.ageLabel,
                trendLabel: "Holding steady",
                summary: idea.why,
                why: idea.why,
                sourceMix: "Public signals",
                directBuyerCount: 0,
                href: "/dashboard",
            })),
            categories: [
                { name: "Marketing", count: 1 },
                { name: "Dev Tools", count: 1 },
                { name: "Automation", count: 1 },
            ],
        };
    }
}
