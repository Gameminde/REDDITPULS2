import Link from "next/link";
import {
    Activity,
    ArrowRight,
    CheckCircle2,
    Database,
    MessageSquareQuote,
    Radar,
    Search,
    Shield,
    TrendingUp,
    Zap,
} from "lucide-react";

import { BrandLogo } from "@/app/components/brand-logo";
import { APP_NAME } from "@/lib/brand";
import { buildMarketIdeas, hydrateIdeaForMarket, type MarketHydratedIdea } from "@/lib/market-feed";
import { createAdmin } from "@/lib/supabase-admin";
import { summarizeReasonForUser } from "@/lib/user-facing-copy";

export const revalidate = 300;

type LandingPainExample = {
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

type LandingWedgeCard = {
    topic: string;
    wedge: string;
    category: string;
    score: number;
    evidenceCount: number;
    sourceCount: number;
    ageLabel: string;
    why: string;
};

type LandingStats = {
    visibleSignals: number;
    rawIdeas: number;
    evidencePosts: number;
    shapedWedges: number;
};

const featureCards = [
    {
        icon: Search,
        title: "Browse real complaints",
        desc: "Read the posts, comments, and buyer frustration behind each opportunity instead of guessing from trends.",
    },
    {
        icon: Activity,
        title: "Find repeated pain",
        desc: "CueIdea groups related complaints so you can see when a problem is showing up often enough to matter.",
    },
    {
        icon: TrendingUp,
        title: "Validate before building",
        desc: "Run one idea through evidence, timing, competition, and product-angle checks before you commit.",
    },
    {
        icon: Shield,
        title: "Spot competitor gaps",
        desc: "See where existing tools are frustrating users so your product can start with a sharper position.",
    },
];

const workflowSteps = [
    {
        icon: MessageSquareQuote,
        title: "Watch live complaints",
        desc: "CueIdea monitors public communities where founders, operators, and buyers already talk about broken workflows.",
    },
    {
        icon: Radar,
        title: "Turn noise into opportunities",
        desc: "Repeated complaints get grouped into product angles that are easier to evaluate and compare.",
    },
    {
        icon: CheckCircle2,
        title: "Validate the best one",
        desc: "Open one idea, inspect the evidence, and get a plain recommendation before you build anything.",
    },
];

const liveSources = [
    {
        key: "reddit",
        name: "Reddit",
        detail: "Founder complaints, buyer pain, workaround threads, and willingness-to-pay language.",
    },
    {
        key: "hackernews",
        name: "Hacker News",
        detail: "Launch discussion, dev skepticism, replacement chatter, and adjacent technical demand.",
    },
    {
        key: "producthunt",
        name: "Product Hunt",
        detail: "New product launches, positioning shifts, and audience reaction around new categories.",
    },
    {
        key: "indiehackers",
        name: "Indie Hackers",
        detail: "Operator pain, founder experiments, and build-in-public signals around emerging workflows.",
    },
    {
        key: "githubissues",
        name: "GitHub Issues",
        detail: "Open issue backlogs, feature requests, and product friction from the tools people already rely on.",
    },
    {
        key: "g2_review",
        name: "Review complaints",
        detail: "Buyer-native frustration, missing features, and competitor weakness after teams have already paid.",
    },
    {
        key: "job_posting",
        name: "Hiring signals",
        detail: "Teams hiring around a workflow or stack, which often reveals urgency, budget, and operational pain.",
    },
];

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
        pain: "Is there any good screen studio alternatives on macOS?",
        source: "Reddit",
        community: "r/productivity",
        score: 16,
        evidenceCount: 3,
        sourceCount: 2,
        why: "Cross-source mentions signal that platform gaps, not just pricing, are creating the opening.",
    },
    {
        topic: "IFTTT Applet",
        wedge: "IFTTT applet debugging and reliability",
        pain: "IFTTT Applet failed last three attempts",
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
        || normalized.includes("any good")
        || normalized.includes("explore page")
        || normalized.includes("featured offer")
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
    return "older live signal";
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
        const [{ data: ideaRows, error: ideasError }] = await Promise.all([
            admin.from("ideas").select("*").neq("confidence_level", "INSUFFICIENT"),
        ]);

        if (ideasError) throw ideasError;

        const hydratedIdeas = (ideaRows || []).map((row) => hydrateIdeaForMarket(row as Record<string, unknown>));
        const visibleIdeas = buildMarketIdeas((ideaRows || []) as Array<Record<string, unknown>>, {
            includeExploratory: false,
        });

        const proofIdeas = dedupeByWedge(
            hydratedIdeas
                .filter((idea) =>
                    idea.market_status !== "suppressed"
                    && Boolean(idea.suggested_wedge_label)
                    && !idea.slug.startsWith("sub-")
                    && !cleanText(idea.topic).toLowerCase().startsWith("pain signals from"),
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
                const wedge = cleanText(idea.suggested_wedge_label) || topic;
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
                        `${cleanText(idea.suggested_wedge_label || idea.topic)} is showing enough repeated pain to become a focused opportunity.`,
                    ),
                } satisfies LandingPainExample;
            })
            .filter((example): example is LandingPainExample => Boolean(example))
            .slice(0, 3);

        const recentWedges = proofIdeas
            .filter((idea) => !isLowQualityLandingText(cleanText(idea.topic)) && !isLowQualityLandingText(cleanText(idea.suggested_wedge_label || "")))
            .slice(0, 3)
            .map((idea) => ({
                topic: idea.topic,
                wedge: cleanText(idea.suggested_wedge_label) || idea.topic,
                category: formatCategory(idea.category),
                score: Number(idea.current_score || 0),
                evidenceCount: Number(idea.post_count_total || 0),
                sourceCount: Number(idea.source_count || 0),
                ageLabel: formatAgeLabel(idea.first_seen),
                why: toSentence(
                    cleanText(idea.market_hint?.why_it_matters_now || idea.market_hint?.missing_proof || idea.strategy_preview?.strongest_reason || ""),
                    `${cleanText(idea.suggested_wedge_label || idea.topic)} is clustering fast enough to watch closely.`,
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
    const { stats, painExamples, recentWedges } = await getLandingData();
    const heroPain = painExamples[0];
    const heroWedge = recentWedges[0];
    const exampleCards = painExamples.slice(0, 2);
    const primarySources = liveSources.slice(0, 4);
    const secondarySources = liveSources.slice(4);

    return (
        <div className="relative min-h-screen overflow-hidden">
            <div className="noise-overlay" />

            <div
                className="fixed pointer-events-none rounded-full"
                style={{ top: -200, left: -150, width: 700, height: 700, filter: "blur(140px)", background: "hsla(16,100%,50%,0.07)", animation: "drift 18s ease-in-out infinite alternate", zIndex: 0 }}
            />
            <div
                className="fixed pointer-events-none rounded-full"
                style={{ bottom: -250, right: -100, width: 600, height: 600, filter: "blur(120px)", background: "hsla(16,70%,50%,0.05)", animation: "drift 24s ease-in-out infinite alternate-reverse", zIndex: 0 }}
            />

            <nav
                className="fixed top-0 left-0 right-0 z-50"
                style={{ borderBottom: "1px solid hsl(0 0% 100% / 0.07)", background: "hsla(0,0%,4%,0.72)", backdropFilter: "blur(20px)" }}
            >
                <div className="mx-auto flex h-12 max-w-[1400px] items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-10">
                    <BrandLogo compact uppercase />
                    <div className="flex items-center gap-3 sm:gap-5">
                        <Link href="/how-it-works" className="hidden text-xs font-semibold text-muted-foreground transition-colors hover:text-white sm:inline-flex">
                            How it works
                        </Link>
                        <Link href="/pricing" className="hidden text-xs font-semibold text-muted-foreground transition-colors hover:text-white sm:inline-flex">
                            Pricing
                        </Link>
                        <Link
                            href="/dashboard"
                            className="inline-flex h-8 items-center gap-2 rounded-xl px-3 text-[10px] font-semibold text-white transition-all hover:-translate-y-0.5 sm:h-9 sm:px-4 sm:text-xs"
                            data-track-event="open_beta_nav_click"
                            data-track-scope="marketing"
                            data-track-label="nav open beta"
                            style={{ background: "hsl(16 100% 50%)", boxShadow: "0 0 24px hsla(16,100%,50%,0.3)" }}
                        >
                            Open beta <ArrowRight className="w-3 h-3" />
                        </Link>
                    </div>
                </div>
            </nav>

            <main className="relative z-10 mx-auto flex max-w-[1400px] flex-col gap-10 px-4 pb-16 pt-[4.4rem] sm:px-6 sm:pb-20 sm:pt-24 md:gap-14 md:pt-28 lg:px-10">
                <section className="grid items-center gap-8 lg:min-h-[78vh] lg:grid-cols-[minmax(0,0.92fr)_minmax(360px,0.95fr)] xl:gap-12">
                    <div className="max-w-2xl">
                        <div className="section-kicker mb-4">
                            <span className="h-[6px] w-[6px] rounded-full bg-build status-live" />
                            Startup idea validation
                        </div>

                        <h1 className="max-w-3xl font-display text-[2.65rem] font-extrabold leading-[0.92] tracking-[-0.035em] text-white sm:text-5xl lg:text-6xl xl:text-[4.9rem]">
                            Find startup ideas
                            <span className="block orange-text orange-glow-text">people already want.</span>
                        </h1>

                        <p className="mt-5 max-w-xl text-[15px] leading-7 text-slate-300 sm:text-base sm:leading-7 md:text-lg md:leading-8">
                            {APP_NAME} watches Reddit, Hacker News, GitHub Issues, and founder communities to surface repeated complaints worth building for.
                        </p>
                        <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground sm:text-[15px]">
                            See the complaint, the pattern, and the recommended product angle before you spend weeks building the wrong thing.
                        </p>

                        <div className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-2 text-[11px] font-mono uppercase tracking-[0.14em] text-primary">
                            <Shield className="h-3.5 w-3.5" />
                            Built for founders and product teams. Not stocks, crypto, or trading.
                        </div>

                        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                            <Link
                                href="/dashboard"
                                className="pulse-button w-full justify-center text-sm md:text-base sm:w-auto"
                                data-track-event="hero_open_beta_click"
                                data-track-scope="marketing"
                                data-track-label="hero open beta"
                            >
                                <Zap className="h-4 w-4 fill-white" />
                                Open beta
                            </Link>
                            <Link
                                href="#examples"
                                className="pulse-button pulse-button--ghost w-full justify-center text-sm md:text-base sm:w-auto"
                                data-track-event="hero_examples_click"
                                data-track-scope="marketing"
                                data-track-label="hero see examples"
                            >
                                See examples <ArrowRight className="h-4 w-4" />
                            </Link>
                        </div>

                        <div className="mt-6 flex flex-wrap gap-2">
                            {primarySources.map((source) => (
                                <span
                                    key={source.key}
                                    className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-slate-200"
                                >
                                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                                    {source.name}
                                </span>
                            ))}
                        </div>

                        <div className="mt-6 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                            {[
                                { label: "Ideas found", value: stats.rawIdeas > 0 ? String(stats.rawIdeas) : "151" },
                                { label: "Posts collected", value: stats.evidencePosts > 0 ? String(stats.evidencePosts) : "943" },
                                { label: "Live examples", value: stats.shapedWedges > 0 ? String(stats.shapedWedges) : "12+" },
                                { label: "Sources watched", value: String(liveSources.length) },
                            ].map((stat) => (
                                <div key={stat.label} className="proof-metric px-3 py-2.5 sm:px-4 sm:py-4">
                                    <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">{stat.label}</p>
                                    <p className="mt-1 text-lg font-display font-black tracking-tight text-white sm:text-2xl md:text-3xl">{stat.value}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="surface-panel overflow-hidden p-4 md:p-5 lg:p-6">
                        <div className="mb-4 flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">Product preview</p>
                                <h2 className="mt-1.5 text-lg font-bold text-white sm:text-xl md:text-2xl">
                                    How one complaint becomes an idea worth testing
                                </h2>
                            </div>
                            <Link href="/dashboard" className="hidden sm:inline-flex verdict-badge">
                                Open app
                            </Link>
                        </div>

                        <div className="grid gap-3">
                            <div className="evidence-card p-4">
                                <div className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                                    <MessageSquareQuote className="h-3.5 w-3.5 text-primary" />
                                    Step 1 ? Read the complaint
                                </div>
                                <p className="text-sm leading-6 text-slate-100">{heroPain.pain}</p>
                                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                                    Spotted in {heroPain.source} ? {heroPain.community}
                                </p>
                            </div>

                            <div
                                className="rounded-[22px] p-4 md:p-5"
                                style={{ background: "linear-gradient(135deg, hsl(16 100% 50% / 0.16), hsl(16 100% 50% / 0.04))", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                            >
                                <div className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-primary">
                                    <Radar className="h-3.5 w-3.5" />
                                    Step 2 ? Turn it into an opportunity
                                </div>
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-primary">{heroPain.topic}</p>
                                        <h3 className="mt-1 text-base font-semibold text-white sm:text-lg md:text-xl">{heroPain.wedge}</h3>
                                        <p className="mt-2 text-sm leading-6 text-slate-200">
                                            {summarizeReasonForUser(heroPain.why, "CueIdea turns repeated pain into a clearer product angle.")}
                                        </p>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <div className="text-2xl font-display font-black orange-text sm:text-3xl md:text-4xl">{Math.round(heroWedge.score)}</div>
                                        <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-slate-300">score</div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="rounded-2xl border border-white/7 bg-black/20 p-3">
                                    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Evidence posts</div>
                                    <div className="mt-2 text-xl font-display font-black text-white">{heroWedge.evidenceCount}</div>
                                </div>
                                <div className="rounded-2xl border border-white/7 bg-black/20 p-3">
                                    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Sources</div>
                                    <div className="mt-2 text-xl font-display font-black text-white">{heroWedge.sourceCount}</div>
                                </div>
                                <div className="rounded-2xl border border-white/7 bg-black/20 p-3">
                                    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Freshness</div>
                                    <div className="mt-2 text-sm font-semibold text-white">{heroWedge.ageLabel}</div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 rounded-[20px] border border-white/8 bg-black/30 p-4">
                            <div className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-primary">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Step 3 ? Validate before you build
                            </div>
                            <p className="text-sm leading-6 text-slate-200">
                                Open the idea in CueIdea to inspect the evidence, see competitor pressure, and decide whether the angle is strong enough to build.
                            </p>
                            <p className="mt-2 text-xs leading-6 text-muted-foreground">
                                Additional proof lanes include {secondarySources.map((source) => source.name).join(", ")} when available.
                            </p>
                        </div>
                    </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-3">
                    {workflowSteps.map(({ icon: Icon, title, desc }) => (
                        <div key={title} className="bento-cell rounded-[22px] p-5">
                            <div
                                className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl"
                                style={{ background: "hsl(16 100% 50% / 0.12)", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                            >
                                <Icon className="h-4 w-4 text-primary" />
                            </div>
                            <p className="text-base font-semibold text-white">{title}</p>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">{desc}</p>
                        </div>
                    ))}
                </section>

                <section id="examples" className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                    <div
                        className="rounded-[26px] p-5 md:p-6"
                        style={{ border: "1px solid hsl(0 0% 100% / 0.08)", background: "linear-gradient(180deg, hsla(0,0%,8%,0.94), hsla(0,0%,5%,0.97))" }}
                    >
                        <div className="mb-5 flex items-center justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">Recent opportunities</p>
                                <h2 className="mt-2 text-2xl font-bold text-white">Examples from the app</h2>
                            </div>
                            <Link href="/dashboard" className="text-xs text-primary transition-colors hover:text-white">
                                Open examples
                            </Link>
                        </div>

                        <div className="space-y-3">
                            {recentWedges.slice(0, 3).map((card) => (
                                <div key={card.wedge} className="rounded-[20px] border border-white/7 bg-white/[0.03] p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-primary">{card.category}</p>
                                            <h3 className="mt-1 text-base font-semibold text-white md:text-lg">{card.wedge}</h3>
                                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                                Opportunity found from {card.topic.toLowerCase()} conversations.
                                            </p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <p className="text-2xl font-display font-black orange-text">{Math.round(card.score)}</p>
                                            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">score</p>
                                        </div>
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <span className="rounded-full border border-white/8 px-2.5 py-1 text-[10px] font-mono text-muted-foreground">
                                            {card.evidenceCount} evidence posts
                                        </span>
                                        <span className="rounded-full border border-white/8 px-2.5 py-1 text-[10px] font-mono text-muted-foreground">
                                            {card.sourceCount} sources
                                        </span>
                                        <span className="rounded-full border border-white/8 px-2.5 py-1 text-[10px] font-mono text-muted-foreground">
                                            {card.ageLabel}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            {featureCards.map(({ icon: Icon, title, desc }) => (
                                <div key={title} className="bento-cell rounded-[20px] p-4">
                                    <div
                                        className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl"
                                        style={{ background: "hsl(16 100% 50% / 0.12)", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                                    >
                                        <Icon className="h-4 w-4 text-primary" />
                                    </div>
                                    <h3 className="text-base font-semibold text-white">{title}</h3>
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{desc}</p>
                                </div>
                            ))}
                        </div>

                        <div className="bento-cell rounded-[22px] p-5">
                            <div className="mb-4 flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                                    <Database className="h-4 w-4 text-primary" />
                                </div>
                                <div>
                                    <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">Live sources</p>
                                    <h3 className="mt-1 text-lg font-semibold text-white">Where the ideas come from</h3>
                                </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                {liveSources.map((source) => (
                                    <div key={source.key} className="rounded-2xl border border-white/7 bg-black/20 p-3.5">
                                        <p className="text-sm font-semibold text-white">{source.name}</p>
                                        <p className="mt-1 text-xs leading-6 text-muted-foreground">{source.detail}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
                    <div
                        className="rounded-[26px] p-5 md:p-6"
                        style={{ border: "1px solid hsl(0 0% 100% / 0.08)", background: "linear-gradient(180deg, hsla(0,0%,8%,0.94), hsla(0,0%,5%,0.97))" }}
                    >
                        <div className="mb-5 max-w-2xl">
                            <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">From complaint to product angle</p>
                            <h2 className="mt-2 text-2xl font-bold text-white">See the raw complaint, then the product idea.</h2>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            {exampleCards.map((example) => (
                                <div key={`${example.topic}-${example.wedge}`} className="rounded-[22px] border border-white/7 bg-white/[0.03] p-4">
                                    <div className="mb-4 flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-primary">{example.source}</p>
                                            <p className="mt-1 text-xs text-muted-foreground">{example.community}</p>
                                        </div>
                                        <div className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-primary">
                                            Live example
                                        </div>
                                    </div>

                                    <div className="rounded-[18px] border border-white/7 bg-black/20 p-3.5">
                                        <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Complaint</p>
                                        <p className="mt-2 text-sm leading-6 text-slate-100">{example.pain}</p>
                                    </div>

                                    <div className="my-3 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-primary">
                                        <ArrowRight className="h-3 w-3" />
                                        CueIdea suggests
                                    </div>

                                    <div
                                        className="rounded-[18px] p-3.5"
                                        style={{ background: "linear-gradient(135deg, hsl(16 100% 50% / 0.16), hsl(16 100% 50% / 0.04))", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                                    >
                                        <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-primary">Product angle</p>
                                        <h3 className="mt-2 text-base font-semibold text-white">{example.wedge}</h3>
                                        <p className="mt-2 text-sm leading-6 text-slate-200">{summarizeReasonForUser(example.why, "The opening is focused enough to review.")}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <section
                        className="rounded-[26px] p-5 md:p-6"
                        style={{ border: "1px solid hsl(0 0% 100% / 0.08)", background: "linear-gradient(180deg, hsla(0,0%,8%,0.94), hsla(0,0%,5%,0.96))" }}
                    >
                        <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">Open beta</p>
                        <h2 className="mt-2 text-2xl font-display font-bold text-foreground md:text-3xl">
                            Stop guessing what to build next.
                        </h2>
                        <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
                            Browse live opportunities, inspect the source evidence, and validate one idea before you write the roadmap.
                        </p>

                        <div className="mt-5 grid gap-3">
                            {[
                                { icon: Search, title: "Watch public pain", body: "Browse what founders, teams, and buyers are actively struggling with." },
                                { icon: Radar, title: "Find a sharper opportunity", body: "Focus on the product angle that keeps showing up across communities." },
                                { icon: CheckCircle2, title: "Validate the bet", body: "Use the report view to decide whether the idea is worth building now." },
                            ].map(({ icon: Icon, title, body }) => (
                                <div key={title} className="rounded-[18px] border border-white/7 bg-white/[0.03] p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                                            <Icon className="h-4 w-4 text-primary" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-semibold text-white">{title}</p>
                                            <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-6 flex flex-wrap gap-3">
                            <Link
                                href="/dashboard"
                                className="inline-flex h-12 items-center gap-2 rounded-xl px-7 text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                                data-track-event="open_beta_footer_click"
                                data-track-scope="marketing"
                                data-track-label="footer open beta"
                                style={{ background: "hsl(16 100% 50%)", boxShadow: "0 0 24px hsla(16,100%,50%,0.3)" }}
                            >
                                Open beta <Radar className="w-4 h-4" />
                            </Link>
                            <Link
                                href="/pricing"
                                className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 px-6 text-sm text-muted-foreground transition-colors hover:text-foreground"
                                data-track-event="pricing_cta_click"
                                data-track-scope="marketing"
                                data-track-label="footer see pricing"
                            >
                                See pricing <ArrowRight className="w-3.5 h-3.5" />
                            </Link>
                        </div>
                    </section>
                </section>
            </main>

            <footer
                className="relative z-10 mx-auto w-full border-t"
                style={{ borderColor: "hsl(0 0% 100% / 0.07)", background: "hsla(0,0%,3%,0.9)" }}
            >
                <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-4 py-12 sm:px-6 lg:px-10">
                    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                            <BrandLogo compact />
                            <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
                                Community-powered startup intelligence. Find what to build by listening to the people who need it most.
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.16em] text-primary">Product</p>
                            <nav className="mt-3 flex flex-col gap-2">
                                <Link href="/dashboard" className="text-sm text-muted-foreground transition-colors hover:text-white">Opportunity Board</Link>
                                <Link href="/dashboard/explore" className="text-sm text-muted-foreground transition-colors hover:text-white">Explore Ideas</Link>
                                <Link href="/dashboard/validate" className="text-sm text-muted-foreground transition-colors hover:text-white">Validate</Link>
                                <Link href="/how-it-works" className="text-sm text-muted-foreground transition-colors hover:text-white">How It Works</Link>
                            </nav>
                        </div>
                        <div>
                            <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.16em] text-primary">Resources</p>
                            <nav className="mt-3 flex flex-col gap-2">
                                <Link href="/pricing" className="text-sm text-muted-foreground transition-colors hover:text-white">Pricing</Link>
                                <Link href="/login" className="text-sm text-muted-foreground transition-colors hover:text-white">Log In</Link>
                                <Link href="/login?mode=signup" className="text-sm text-muted-foreground transition-colors hover:text-white">Sign Up</Link>
                            </nav>
                        </div>
                        <div>
                            <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.16em] text-primary">Data Sources</p>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {["Reddit", "Hacker News", "Product Hunt", "Indie Hackers", "GitHub Issues"].map((source) => (
                                    <span
                                        key={source}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-slate-300"
                                    >
                                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                                        {source}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col items-center justify-between gap-4 border-t pt-6 sm:flex-row" style={{ borderColor: "hsl(0 0% 100% / 0.07)" }}>
                        <p className="text-xs text-muted-foreground">
                            &copy; {new Date().getFullYear()} CueIdea. Community intelligence for founders.
                        </p>
                        <div className="flex items-center gap-4">
                            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                                <span className="h-1.5 w-1.5 rounded-full bg-build status-live" />
                                All systems operational
                            </span>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}
