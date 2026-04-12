import type { Metadata } from "next";
import LandingPageClient, {
    type LandingPainExample,
    type LandingStats,
    type LandingWedgeCard,
} from "@/app/components/landing-page-client";
import { buildMarketIdeas, hydrateIdeaForMarket, type MarketHydratedIdea } from "@/lib/market-feed";
import { createAdmin } from "@/lib/supabase-admin";

export const revalidate = 300;

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://cueidea.me";

export const metadata: Metadata = {
    title: "CueIdea: See Startup Demand Before You Build",
    description: "CueIdea turns live complaints from Reddit, Hacker News, Product Hunt, Indie Hackers, GitHub Issues, review complaints, and hiring signals into startup opportunities you can inspect and validate.",
    alternates: {
        canonical: "/",
    },
    openGraph: {
        title: "CueIdea: See Startup Demand Before You Build",
        description: "Live pain signals become startup opportunities you can inspect and validate before you build.",
        url: siteUrl,
        type: "website",
    },
    twitter: {
        card: "summary",
        title: "CueIdea: See Startup Demand Before You Build",
        description: "Live pain signals become startup opportunities you can inspect and validate before you build.",
    },
};

const fallbackPainExamples: LandingPainExample[] = [
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

const fallbackWedges: LandingWedgeCard[] = fallbackPainExamples.map((example) => ({
    topic: example.topic,
    wedge: example.wedge,
    category: "live theme",
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
    if (!normalized) return "uncategorized";
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
        const key = cleanText(idea.suggested_wedge_label || idea.topic).toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function getLandingData() {
    try {
        const admin = createAdmin();
        const { data: ideaRows, error } = await admin.from("ideas").select("*").neq("confidence_level", "INSUFFICIENT");
        if (error) throw error;

        const hydratedIdeas = (ideaRows || []).map((row) => hydrateIdeaForMarket(row as Record<string, unknown>));
        const visibleIdeas = buildMarketIdeas((ideaRows || []) as Array<Record<string, unknown>>, {
            includeExploratory: false,
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
                } satisfies LandingPainExample;
            })
            .filter((example): example is LandingPainExample => Boolean(example))
            .slice(0, 3);

        const recentWedges = proofIdeas
            .filter((idea) => !isLowQualityLandingText(cleanText(idea.topic)) && !isLowQualityLandingText(cleanText(idea.public_title || idea.suggested_wedge_label || "")))
            .slice(0, 3)
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
            } satisfies LandingWedgeCard));

        const stats: LandingStats = {
            visibleSignals: visibleIdeas.length,
            rawIdeas: hydratedIdeas.length,
            evidencePosts: hydratedIdeas.reduce((sum, idea) => sum + Number(idea.post_count_total || 0), 0),
            shapedWedges: proofIdeas.length,
        };

        return {
            stats,
            painExamples: painExamples.length > 0 ? painExamples : fallbackPainExamples,
            recentWedges: recentWedges.length > 0 ? recentWedges : fallbackWedges,
        };
    } catch {
        return {
            stats: {
                visibleSignals: 0,
                rawIdeas: 0,
                evidencePosts: 0,
                shapedWedges: fallbackWedges.length,
            },
            painExamples: fallbackPainExamples,
            recentWedges: fallbackWedges,
        };
    }
}

export default async function LandingPage() {
    const data = await getLandingData();
    const softwareApplicationSchema = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "CueIdea",
        url: siteUrl,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: "Startup idea radar that turns public pain points into validated product opportunities.",
        offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "USD",
        },
    };

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema) }}
            />
            <LandingPageClient {...data} />
        </>
    );
}
