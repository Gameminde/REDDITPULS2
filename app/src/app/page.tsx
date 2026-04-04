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
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { buildMarketIdeas, hydrateIdeaForMarket, type MarketHydratedIdea } from "@/lib/market-feed";
import { extractScraperRunHealth } from "@/lib/scraper-run-health";
import { createAdmin } from "@/lib/supabase-admin";

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
        desc: "Pressure-test one wedge with structured evidence, debate, and recommendation logic.",
    },
    {
        icon: TrendingUp,
        title: "Trend and why-now",
        desc: "See which themes are accelerating and why timing might be opening now.",
    },
    {
        icon: Shield,
        title: "Competitor pressure",
        desc: "Surface repeated complaints, workflow friction, and wedge openings against incumbents.",
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
        why: "Reliability complaints are specific enough to become a focused wedge instead of a generic automation theme.",
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
                        `${cleanText(idea.suggested_wedge_label || idea.topic)} is showing enough repeated pain to sharpen into a wedge.`,
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
                healthy_sources: ["reddit", "hackernews", "producthunt", "indiehackers"],
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
    const { sourceHealth, stats, painExamples, recentWedges } = await getLandingData();
    const heroPain = painExamples[0];
    const heroWedge = recentWedges[0];

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
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                    <BrandLogo compact uppercase />
                    <div className="flex items-center gap-5">
                        <Link href="/how-it-works" className="text-xs font-semibold text-muted-foreground transition-colors hover:text-white">
                            How it works
                        </Link>
                        <Link href="/pricing" className="text-xs font-semibold text-muted-foreground transition-colors hover:text-white">
                            Pricing
                        </Link>
                        <Link
                            href="/dashboard"
                            className="inline-flex h-9 items-center gap-2 rounded-xl px-4 text-xs font-semibold text-white transition-all hover:-translate-y-0.5"
                            style={{ background: "hsl(16 100% 50%)", boxShadow: "0 0 24px hsla(16,100%,50%,0.3)" }}
                        >
                            Open beta <ArrowRight className="w-3 h-3" />
                        </Link>
                    </div>
                </div>
            </nav>

            <main className="relative z-10 mx-auto flex max-w-7xl flex-col gap-16 px-6 pb-24 pt-28">
                <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.02fr)_460px] xl:grid-cols-[minmax(0,1.08fr)_500px]">
                    <div className="max-w-2xl">
                        <div
                            className="mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5"
                            style={{ background: "hsl(16 100% 50% / 0.12)", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                        >
                            <span className="w-[5px] h-[5px] rounded-full bg-build status-live" style={{ animation: "pulse-green 2s ease infinite" }} />
                            <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">
                                {APP_NAME} open beta
                            </span>
                        </div>

                        <h1 className="mb-6 max-w-4xl font-display text-5xl font-extrabold leading-[0.94] tracking-[-0.05em] text-white md:text-7xl xl:text-[5.3rem]">
                            Turn raw complaints into
                            <span className="block orange-text">clear startup wedges.</span>
                        </h1>

                        <p className="mb-8 max-w-xl text-base leading-8 text-muted-foreground md:text-[1.05rem]">
                            CueIdea watches live founder and buyer signal across Reddit, Hacker News, Product Hunt, and Indie Hackers,
                            then shapes repeated pain into sharper wedges you can inspect before you build.
                        </p>

                        <div className="mb-8 flex flex-wrap items-center gap-3">
                            <Link
                                href="/dashboard"
                                className="inline-flex h-12 items-center gap-2 rounded-xl px-7 text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                                style={{ background: "hsl(16 100% 50%)", boxShadow: "0 0 24px hsla(16,100%,50%,0.3)" }}
                            >
                                <Zap className="w-4 h-4 fill-white" />
                                Open live board
                            </Link>
                            <Link
                                href="/how-it-works"
                                className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 px-6 text-sm text-muted-foreground transition-colors hover:text-foreground"
                            >
                                See the workflow <ArrowRight className="w-3.5 h-3.5" />
                            </Link>
                        </div>

                        <div className="mb-8 grid gap-3 sm:grid-cols-3">
                            <div className="bento-cell rounded-[18px] p-4">
                                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Live proof</p>
                                <p className="mt-2 text-3xl font-display font-black orange-text">{stats.shapedWedges || "12+"}</p>
                                <p className="mt-1 text-sm text-muted-foreground">wedges taking shape right now</p>
                            </div>
                            <div className="bento-cell rounded-[18px] p-4">
                                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Evidence volume</p>
                                <p className="mt-2 text-3xl font-display font-black text-white">{stats.evidencePosts || "943"}</p>
                                <p className="mt-1 text-sm text-muted-foreground">posts behind the visible board</p>
                            </div>
                            <div className="bento-cell rounded-[18px] p-4">
                                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Open beta</p>
                                <p className="mt-2 text-3xl font-display font-black text-white">Full</p>
                                <p className="mt-1 text-sm text-muted-foreground">signed-in testers get full access</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {liveSources.map((source) => {
                                const healthy = sourceHealth.healthy_sources.includes(source.key);
                                const degraded = sourceHealth.degraded_sources.includes(source.key);
                                const label = degraded ? "degraded" : healthy ? "live" : "tracked";

                                return (
                                    <div
                                        key={source.key}
                                        className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-mono"
                                        style={{ border: "1px solid hsl(0 0% 100% / 0.08)", background: "hsl(0 0% 8% / 0.72)" }}
                                    >
                                        <span className={`w-2 h-2 rounded-full ${degraded ? "bg-yellow-400" : "bg-emerald-400"}`} />
                                        <span className="text-foreground">{source.name}</span>
                                        <span className="text-muted-foreground uppercase">{label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="relative">
                        <div
                            className="card-glow rounded-[30px] p-5 md:p-6"
                            style={{ boxShadow: "0 32px 90px rgba(0,0,0,0.4)" }}
                        >
                            <div className="mb-5 flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">
                                        Live signal loop
                                    </p>
                                    <h2 className="mt-2 text-xl font-bold text-white">From complaint to wedge</h2>
                                </div>
                                <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.14em] text-primary">
                                    Public proof
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="rounded-[22px] border border-white/7 bg-white/[0.03] p-4">
                                    <div className="mb-3 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                                        <MessageSquareQuote className="h-3.5 w-3.5 text-primary" />
                                        Raw pain
                                    </div>
                                    <p className="text-sm leading-7 text-slate-100">{heroPain.pain}</p>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <span className="rounded-full border border-white/8 px-2.5 py-1 text-[10px] font-mono text-muted-foreground">
                                            {heroPain.source}
                                        </span>
                                        <span className="rounded-full border border-white/8 px-2.5 py-1 text-[10px] font-mono text-muted-foreground">
                                            {heroPain.community}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex justify-center">
                                    <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-primary">
                                        Cluster into wedge
                                        <ArrowRight className="h-3 w-3" />
                                    </div>
                                </div>

                                <div
                                    className="rounded-[22px] p-4"
                                    style={{ background: "linear-gradient(135deg, hsl(16 100% 50% / 0.16), hsl(16 100% 50% / 0.04))", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                                >
                                    <div className="mb-2 text-[10px] font-mono font-semibold uppercase tracking-[0.16em] text-primary">Shaped wedge</div>
                                    <h3 className="text-lg font-semibold text-white">{heroPain.wedge}</h3>
                                    <p className="mt-2 text-sm leading-7 text-slate-200">{heroPain.why}</p>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-3">
                                    <div className="rounded-2xl border border-white/7 bg-black/20 p-4">
                                        <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Signal</div>
                                        <div className="mt-2 text-3xl font-display font-black orange-text">{Math.round(heroWedge.score)}</div>
                                    </div>
                                    <div className="rounded-2xl border border-white/7 bg-black/20 p-4">
                                        <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Evidence</div>
                                        <div className="mt-2 text-3xl font-display font-black text-white">{heroWedge.evidenceCount}</div>
                                    </div>
                                    <div className="rounded-2xl border border-white/7 bg-black/20 p-4">
                                        <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Sources</div>
                                        <div className="mt-2 text-3xl font-display font-black text-white">{heroWedge.sourceCount}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="absolute -left-3 bottom-6 hidden rounded-2xl border border-white/8 bg-black/75 px-4 py-3 shadow-2xl backdrop-blur lg:block">
                            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Open beta</div>
                            <div className="mt-1 text-sm font-semibold text-white">Read the board. Validate the build.</div>
                        </div>
                    </div>
                </section>

                <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {[
                        { label: "Live feed signals", value: stats.visibleSignals > 0 ? String(stats.visibleSignals) : "Live" },
                        { label: "Raw market ideas", value: stats.rawIdeas > 0 ? String(stats.rawIdeas) : "151" },
                        { label: "Evidence posts tracked", value: stats.evidencePosts > 0 ? String(stats.evidencePosts) : "943" },
                        { label: "Wedges taking shape", value: stats.shapedWedges > 0 ? String(stats.shapedWedges) : "12+" },
                    ].map((stat) => (
                        <div key={stat.label} className="bento-cell rounded-[14px] p-5 text-center">
                            <p className="font-mono text-4xl font-extrabold tracking-tight-custom orange-text tabular-nums">{stat.value}</p>
                            <p className="text-[11px] text-muted-foreground mt-2 uppercase tracking-[0.12em] font-mono font-semibold">{stat.label}</p>
                        </div>
                    ))}
                </section>

                <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                    <div
                        className="rounded-[28px] p-6"
                        style={{ border: "1px solid hsl(0 0% 100% / 0.08)", background: "linear-gradient(180deg, hsla(0,0%,8%,0.94), hsla(0,0%,5%,0.97))" }}
                    >
                        <div className="mb-6 flex items-center justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">Recent wedges</p>
                                <h2 className="mt-2 text-2xl font-bold text-white">Proof that the feed is alive</h2>
                            </div>
                            <Link href="/dashboard" className="text-xs text-primary transition-colors hover:text-white">
                                View board
                            </Link>
                        </div>

                        <div className="space-y-4">
                            {recentWedges.map((card) => (
                                <div key={card.wedge} className="rounded-[22px] border border-white/7 bg-white/[0.03] p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-primary">{card.category}</p>
                                            <h3 className="mt-1 text-lg font-semibold text-white">{card.wedge}</h3>
                                            <p className="mt-1 text-sm text-muted-foreground">Clustered from {card.topic}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-3xl font-display font-black orange-text">{Math.round(card.score)}</p>
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

                                    <p className="mt-3 text-sm leading-7 text-muted-foreground">{card.why}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1">
                        {[
                            {
                                icon: Search,
                                title: "Watch live communities",
                                body: "CueIdea reads raw founder and buyer signal instead of trend-chasing headlines.",
                            },
                            {
                                icon: Radar,
                                title: "Shape a sharper wedge",
                                body: "The pipeline clusters repeated pain into something more focused than a broad market theme.",
                            },
                            {
                                icon: CheckCircle2,
                                title: "Validate before you build",
                                body: "Pressure-test one wedge with evidence, trend timing, competitor pressure, and source confidence.",
                            },
                        ].map(({ icon: Icon, title, body }) => (
                            <div key={title} className="bento-cell rounded-[22px] p-5">
                                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                                    <Icon className="h-5 w-5 text-primary" />
                                </div>
                                <h3 className="text-lg font-semibold text-white">{title}</h3>
                                <p className="mt-2 text-sm leading-7 text-muted-foreground">{body}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section>
                    <div className="mb-8 max-w-3xl">
                        <p className="mb-3 text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">From raw pain to wedge</p>
                        <h2 className="mb-4 text-3xl font-display font-bold text-foreground md:text-4xl">
                            Show the complaint, then show the opportunity.
                        </h2>
                        <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
                            These examples keep the raw complaint visible, then place the shaped wedge and the proof score beside it.
                            That is the product story visitors need to trust immediately.
                        </p>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                        {painExamples.map((example) => (
                            <div
                                key={`${example.topic}-${example.wedge}`}
                                className="rounded-[24px] border border-white/8 p-5"
                                style={{ background: "linear-gradient(180deg, hsla(0,0%,8%,0.92), hsla(0,0%,6%,0.96))" }}
                            >
                                <div className="mb-5 flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.16em] text-primary">{example.source}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">{example.community}</p>
                                    </div>
                                    <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-primary">
                                        <CheckCircle2 className="h-3 w-3" />
                                        Live proof
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="rounded-[20px] border border-white/7 bg-white/[0.03] p-4">
                                        <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Raw pain</p>
                                        <p className="text-sm leading-7 text-slate-100">{example.pain}</p>
                                    </div>

                                    <div className="flex justify-center">
                                        <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.03] px-3 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-primary">
                                            Clustered into <ArrowRight className="h-3 w-3" />
                                        </span>
                                    </div>

                                    <div
                                        className="rounded-[20px] p-4"
                                        style={{ background: "linear-gradient(135deg, hsl(16 100% 50% / 0.16), hsl(16 100% 50% / 0.04))", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                                    >
                                        <p className="mb-2 text-[10px] font-mono uppercase tracking-[0.16em] text-primary">Suggested wedge</p>
                                        <h3 className="text-base font-semibold text-white">{example.wedge}</h3>
                                        <p className="mt-2 text-sm leading-7 text-slate-200">{example.why}</p>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2">
                                        <div className="rounded-2xl border border-white/7 bg-black/20 p-3 text-center">
                                            <div className="text-xl font-display font-black orange-text">{Math.round(example.score)}</div>
                                            <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">signal</div>
                                        </div>
                                        <div className="rounded-2xl border border-white/7 bg-black/20 p-3 text-center">
                                            <div className="text-xl font-display font-black text-white">{example.evidenceCount}</div>
                                            <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">posts</div>
                                        </div>
                                        <div className="rounded-2xl border border-white/7 bg-black/20 p-3 text-center">
                                            <div className="text-xl font-display font-black text-white">{example.sourceCount}</div>
                                            <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">sources</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section>
                    <div className="mb-8 max-w-3xl">
                        <p className="mb-3 text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">Source truth</p>
                        <h2 className="mb-4 text-3xl font-display font-bold text-foreground md:text-4xl">
                            The live feed, plainly listed.
                        </h2>
                        <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
                            Each source adds a different kind of signal, so you can tell whether a wedge is cross-source demand
                            or just one loud thread.
                        </p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {liveSources.map((source) => {
                            const healthy = sourceHealth.healthy_sources.includes(source.key);
                            const degraded = sourceHealth.degraded_sources.includes(source.key);

                            return (
                                <div key={source.key} className="bento-cell rounded-[20px] p-5">
                                    <div className="mb-4 flex items-center justify-between gap-4">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                                            <Database className="h-4 w-4 text-primary" />
                                        </div>
                                        <span className={`text-[10px] font-mono uppercase tracking-[0.14em] ${degraded ? "text-yellow-300" : healthy ? "text-emerald-300" : "text-muted-foreground"}`}>
                                            {degraded ? "degraded" : healthy ? "live" : "tracked"}
                                        </span>
                                    </div>
                                    <h3 className="text-lg font-semibold text-white">{source.name}</h3>
                                    <p className="mt-2 text-sm leading-7 text-muted-foreground">{source.detail}</p>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                    {featureCards.map(({ icon: Icon, title, desc }) => (
                        <div key={title} className="bento-cell rounded-[18px] p-5">
                            <div
                                className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl"
                                style={{ background: "hsl(16 100% 50% / 0.12)", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                            >
                                <Icon className="h-4 w-4 text-primary" />
                            </div>
                            <h3 className="text-lg font-semibold text-white">{title}</h3>
                            <p className="mt-2 text-sm leading-7 text-muted-foreground">{desc}</p>
                        </div>
                    ))}
                </section>

                <section
                    className="rounded-[30px] p-6 md:p-8"
                    style={{ border: "1px solid hsl(0 0% 100% / 0.08)", background: "linear-gradient(180deg, hsla(0,0%,8%,0.94), hsla(0,0%,5%,0.96))" }}
                >
                    <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
                        <div>
                            <p className="mb-3 text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-primary">Open beta</p>
                            <h2 className="mb-4 text-3xl font-display font-bold text-foreground md:text-4xl">
                                Browse the board. Catch the wedge before the market does.
                            </h2>
                            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
                                The beta is open right now. Read the live board, inspect the source proof,
                                and pressure-test one idea when you want to go deeper.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <Link
                                href="/dashboard"
                                className="inline-flex h-12 items-center gap-2 rounded-xl px-7 text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                                style={{ background: "hsl(16 100% 50%)", boxShadow: "0 0 24px hsla(16,100%,50%,0.3)" }}
                            >
                                Open beta board <Radar className="w-4 h-4" />
                            </Link>
                            <Link
                                href="/pricing"
                                className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 px-6 text-sm text-muted-foreground transition-colors hover:text-foreground"
                            >
                                See pricing <ArrowRight className="w-3.5 h-3.5" />
                            </Link>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}
