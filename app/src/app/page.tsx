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
import { extractScraperRunHealth } from "@/lib/scraper-run-health";
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
        title: "Live market feed",
        desc: "Browse raw community signal without hiding the underlying posts that created it.",
    },
    {
        icon: Activity,
        title: "Idea validation",
        desc: "Pressure-test one opportunity with structured evidence, debate, and recommendation logic.",
    },
    {
        icon: TrendingUp,
        title: "Trend and why-now",
        desc: "See which themes are accelerating and why timing might be opening now.",
    },
    {
        icon: Shield,
        title: "Competitor pressure",
        desc: "Surface repeated complaints, workflow friction, and competitor openings against incumbents.",
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
        const [{ data: ideaRows, error: ideasError }, { data: latestRuns, error: runsError }] = await Promise.all([
            admin.from("ideas").select("*").neq("confidence_level", "INSUFFICIENT"),
            admin.from("scraper_runs").select("*").order("started_at", { ascending: false }).limit(1),
        ]);

        if (ideasError) throw ideasError;
        if (runsError) throw runsError;

        const hydratedIdeas = (ideaRows || []).map((row) => hydrateIdeaForMarket(row as Record<string, unknown>));
        const visibleIdeas = buildMarketIdeas((ideaRows || []) as Array<Record<string, unknown>>, {
            includeExploratory: false,
        });
        const latestRun = (latestRuns?.[0] || null) as Record<string, unknown> | null;
        const sourceHealth = extractScraperRunHealth(latestRun);

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
            sourceHealth,
            stats,
            painExamples: painExamples.length > 0 ? painExamples : fallbackPainExamples,
            recentWedges: recentWedges.length > 0 ? recentWedges : fallbackWedges,
        };
    } catch {
        return {
            sourceHealth: {
                healthy_sources: ["reddit", "hackernews", "producthunt", "indiehackers", "githubissues"],
                degraded_sources: [],
                run_health: "healthy" as const,
                runner_label: null,
                reddit_access_mode: "unknown" as const,
                reddit_post_count: 0,
                reddit_successful_requests: 0,
                reddit_failed_requests: 0,
                reddit_degraded_reason: null,
            },
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
                <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6">
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

            <main className="relative z-10 mx-auto flex max-w-7xl flex-col gap-7 px-4 pb-16 pt-[4.4rem] sm:px-6 sm:pb-20 sm:pt-24 md:gap-12 md:pt-28">
                <section className="grid items-start gap-5 lg:min-h-[78vh] lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1fr)] lg:items-center xl:gap-8">
                    <div className="max-w-2xl">
                        <div className="section-kicker mb-4">
                            <span className="h-[6px] w-[6px] rounded-full bg-build status-live" />
                            {APP_NAME} open beta
                        </div>

                        <h1 className="max-w-3xl font-display text-[2.5rem] font-extrabold leading-[0.9] tracking-[-0.055em] text-white sm:text-5xl lg:text-6xl xl:text-[4.8rem]">
                            Extract.
                            <span className="block orange-text orange-glow-text">Validate.</span>
                            <span className="block">Dominate.</span>
                        </h1>

                        <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300 sm:text-base sm:leading-7 md:text-lg md:leading-8">
                            Real-time community intelligence for clearer opportunities and faster product conviction.
                        </p>
                        <p className="mt-2 hidden max-w-xl text-sm leading-7 text-muted-foreground sm:block">
                            CueIdea turns live Reddit pain, launch chatter, founder discussion, and proof from adjacent sources into opportunities you can inspect before you build.
                        </p>

                        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                            <Link
                                href="/dashboard"
                                className="pulse-button w-full justify-center text-sm md:text-base sm:w-auto"
                                data-track-event="hero_validate_cta_click"
                                data-track-scope="marketing"
                                data-track-label="hero start validating"
                            >
                                <Zap className="h-4 w-4 fill-white" />
                                Start validating
                            </Link>
                            <Link
                                href="/how-it-works"
                                className="pulse-button pulse-button--ghost w-full justify-center text-sm md:text-base sm:w-auto"
                                data-track-event="hero_how_it_works_click"
                                data-track-scope="marketing"
                                data-track-label="hero how it works"
                            >
                                See how it works <ArrowRight className="h-4 w-4" />
                            </Link>
                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                            {[
                                { label: "Live proof", value: stats.shapedWedges > 0 ? String(stats.shapedWedges) : "12+" },
                                { label: "Evidence", value: stats.evidencePosts > 0 ? String(stats.evidencePosts) : "943" },
                                { label: "Live signals", value: stats.visibleSignals > 0 ? String(stats.visibleSignals) : "20" },
                                { label: "Raw ideas", value: stats.rawIdeas > 0 ? String(stats.rawIdeas) : "151" },
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
                                <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">Live board preview</p>
                                <h2 className="mt-1.5 text-lg font-bold text-white sm:text-xl md:text-2xl">What the board sees right now</h2>
                            </div>
                            <Link href="/dashboard" className="hidden sm:inline-flex verdict-badge">
                                Open board
                            </Link>
                        </div>

                        <div
                            className="rounded-[22px] p-4 md:p-5"
                            style={{ background: "linear-gradient(135deg, hsl(16 100% 50% / 0.16), hsl(16 100% 50% / 0.04))", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-primary">{heroPain.topic}</p>
                                    <h3 className="mt-1 text-base font-semibold text-white sm:text-lg md:text-xl">{heroPain.wedge}</h3>
                                    <p className="mt-2 text-sm leading-6 text-slate-200">
                                        Clustered from {heroPain.source} pain in {heroPain.community}.
                                    </p>
                                </div>
                                <div className="shrink-0 text-right">
                                    <div className="text-2xl font-display font-black orange-text sm:text-3xl md:text-4xl">{Math.round(heroWedge.score)}</div>
                                    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-slate-300">signal</div>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-3">
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

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div className="evidence-card p-4">
                                <div className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                                    <MessageSquareQuote className="h-3.5 w-3.5 text-primary" />
                                    Raw pain
                                </div>
                                <p className="text-sm leading-6 text-slate-100">{heroPain.pain}</p>
                            </div>
                            <div className="evidence-card p-4">
                                <div className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-primary">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Recommended angle
                                </div>
                                <p className="text-base font-semibold text-white">{heroPain.wedge}</p>
                                <p className="mt-2 text-sm leading-6 text-slate-200">{summarizeReasonForUser(heroPain.why, "The opening is focused enough to inspect further.")}</p>
                            </div>
                        </div>

                        <div className="mt-4 rounded-[20px] border border-white/8 bg-black/30 p-4">
                            <div className="flex flex-wrap items-center gap-2">
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
                            <p className="mt-3 text-xs leading-6 text-muted-foreground">
                                Extended proof lanes also include {secondarySources.map((source) => source.name).join(", ")} when available.
                            </p>
                            <Link
                                href="/dashboard"
                                className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-primary sm:hidden"
                            >
                                Open board <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                        </div>
                    </div>
                </section>

                <section className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
                    <div
                        className="rounded-[26px] p-5 md:p-6"
                        style={{ border: "1px solid hsl(0 0% 100% / 0.08)", background: "linear-gradient(180deg, hsla(0,0%,8%,0.94), hsla(0,0%,5%,0.97))" }}
                    >
                        <div className="mb-5 flex items-center justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">Recent opportunities</p>
                                <h2 className="mt-2 text-2xl font-bold text-white">Proof the feed is moving</h2>
                            </div>
                            <Link href="/dashboard" className="text-xs text-primary transition-colors hover:text-white">
                                View board
                            </Link>
                        </div>

                        <div className="space-y-3">
                            {recentWedges.slice(0, 3).map((card) => (
                                <div key={card.wedge} className="rounded-[20px] border border-white/7 bg-white/[0.03] p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-primary">{card.category}</p>
                                            <h3 className="mt-1 text-base font-semibold text-white md:text-lg">{card.wedge}</h3>
                                            <p className="mt-1 text-sm text-muted-foreground">Clustered from {card.topic}</p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <p className="text-2xl font-display font-black orange-text">{Math.round(card.score)}</p>
                                            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">signal</p>
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
                                    <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">Source truth</p>
                                    <h3 className="mt-1 text-lg font-semibold text-white">What powers the board</h3>
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
                            <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">From complaint to opportunity</p>
                            <h2 className="mt-2 text-2xl font-bold text-white">Show the pain. Then show the opening.</h2>
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
                                            Live proof
                                        </div>
                                    </div>

                                    <div className="rounded-[18px] border border-white/7 bg-black/20 p-3.5">
                                        <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Raw pain</p>
                                        <p className="mt-2 text-sm leading-6 text-slate-100">{example.pain}</p>
                                    </div>

                                    <div className="my-3 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-primary">
                                        <ArrowRight className="h-3 w-3" />
                                        Clustered into
                                    </div>

                                    <div
                                        className="rounded-[18px] p-3.5"
                                        style={{ background: "linear-gradient(135deg, hsl(16 100% 50% / 0.16), hsl(16 100% 50% / 0.04))", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                                    >
                                        <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-primary">Recommended angle</p>
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
                            Browse the board. Catch the next opening before the market does.
                        </h2>
                        <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
                            The beta is open. Browse live market shifts, inspect source proof, and pressure-test one idea when you want to go deeper.
                        </p>

                        <div className="mt-5 grid gap-3">
                            {[
                                { icon: Search, title: "Watch live communities", body: "Read live founder and buyer signal instead of trend-chasing summaries." },
                                { icon: Radar, title: "Sharpen the angle", body: "Cluster repeated pain into a sharper angle you can actually build for." },
                                { icon: CheckCircle2, title: "Validate before building", body: "Run the opportunity through evidence, timing, competition, and proof." },
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
                                data-track-label="footer open beta board"
                                style={{ background: "hsl(16 100% 50%)", boxShadow: "0 0 24px hsla(16,100%,50%,0.3)" }}
                            >
                                Open beta board <Radar className="w-4 h-4" />
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
        </div>
    );
}
