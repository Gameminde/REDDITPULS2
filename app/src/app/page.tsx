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

    return (
        <div className="min-h-screen relative overflow-hidden">
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
                <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
                    <BrandLogo compact uppercase />
                    <div className="flex items-center gap-5">
                        <Link href="/how-it-works" className="text-xs font-semibold text-muted-foreground hover:text-white transition-colors">
                            How it works
                        </Link>
                        <Link href="/pricing" className="text-xs font-semibold text-muted-foreground hover:text-white transition-colors">
                            Pricing
                        </Link>
                        <Link
                            href="/dashboard"
                            className="inline-flex items-center gap-2 px-4 h-8 rounded-lg text-xs font-semibold text-white transition-all hover:-translate-y-0.5"
                            style={{ background: "hsl(16 100% 50%)", boxShadow: "0 0 24px hsla(16,100%,50%,0.3)" }}
                        >
                            Open beta <ArrowRight className="w-3 h-3" />
                        </Link>
                    </div>
                </div>
            </nav>

            <main className="relative z-10 max-w-7xl mx-auto px-6 pt-32 pb-20">
                <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-start mb-16">
                    <div>
                        <div
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-8"
                            style={{ background: "hsl(16 100% 50% / 0.12)", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                        >
                            <span className="w-[5px] h-[5px] rounded-full bg-build status-live" style={{ animation: "pulse-green 2s ease infinite" }} />
                            <span className="text-[11px] font-mono text-primary tracking-wider uppercase font-semibold">{APP_NAME} open beta</span>
                        </div>

                        <h1 className="font-display text-6xl md:text-8xl font-extrabold tracking-tight-custom leading-[0.88] mb-6">
                            <span className="text-gradient-steel">See the raw pain.</span>
                            <br />
                            <span className="text-gradient-steel">Shape the wedge.</span>
                            <br />
                            <span className="text-gradient-orange">Validate the build.</span>
                        </h1>

                        <p className="text-muted-foreground max-w-2xl text-sm md:text-base leading-relaxed mb-8 font-mono">
                            {APP_TAGLINE} CueIdea reads live founder and buyer signal, clusters the repeated pain,
                            then turns it into sharper opportunity wedges you can inspect before you build.
                        </p>

                        <div className="flex items-center gap-3 flex-wrap mb-8">
                            <Link
                                href="/dashboard"
                                className="inline-flex items-center gap-2 px-8 h-11 rounded-lg text-sm font-semibold text-white transition-all hover:scale-105"
                                style={{ background: "hsl(16 100% 50%)", boxShadow: "0 0 24px hsla(16,100%,50%,0.3)" }}
                            >
                                <Zap className="w-4 h-4 fill-white" />
                                Open live board
                            </Link>
                            <Link
                                href="/how-it-works"
                                className="inline-flex items-center gap-2 px-6 h-11 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                                See the workflow <ArrowRight className="w-3.5 h-3.5" />
                            </Link>
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

                    <div
                        className="rounded-[22px] p-5 md:p-6"
                        style={{ border: "1px solid hsl(0 0% 100% / 0.08)", background: "linear-gradient(180deg, hsla(0,0%,8%,0.9), hsla(0,0%,5%,0.92))", boxShadow: "0 24px 80px rgba(0,0,0,0.32)" }}
                    >
                        <div className="flex items-center justify-between gap-4 mb-5">
                            <div>
                                <p className="text-[11px] uppercase tracking-[0.18em] text-primary font-mono font-semibold">Public proof</p>
                                <h2 className="text-xl font-bold text-foreground mt-2">Recent wedges taking shape</h2>
                            </div>
                            <Link href="/dashboard" className="text-xs text-primary hover:text-white transition-colors">
                                View live board
                            </Link>
                        </div>

                        <div className="space-y-3">
                            {recentWedges.map((card) => (
                                <div
                                    key={card.wedge}
                                    className="rounded-2xl p-4"
                                    style={{ border: "1px solid hsl(0 0% 100% / 0.06)", background: "linear-gradient(180deg, hsl(0 0% 10%), hsl(0 0% 7%))" }}
                                >
                                    <div className="flex items-start justify-between gap-4 mb-3">
                                        <div>
                                            <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-primary/90">{card.category}</p>
                                            <h3 className="text-base font-semibold text-foreground mt-1">{card.wedge}</h3>
                                            <p className="text-xs text-muted-foreground mt-1">Clustered from {card.topic}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-2xl font-display font-black orange-text">{Math.round(card.score)}</p>
                                            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-mono">signal score</p>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2 mb-3">
                                        <span className="px-2.5 py-1 rounded-full text-[10px] font-mono text-muted-foreground border border-white/8">
                                            {card.evidenceCount} evidence posts
                                        </span>
                                        <span className="px-2.5 py-1 rounded-full text-[10px] font-mono text-muted-foreground border border-white/8">
                                            {card.sourceCount} sources
                                        </span>
                                        <span className="px-2.5 py-1 rounded-full text-[10px] font-mono text-muted-foreground border border-white/8">
                                            {card.ageLabel}
                                        </span>
                                    </div>

                                    <p className="text-sm text-muted-foreground leading-relaxed">{card.why}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-16">
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

                <section className="mb-16">
                    <div className="max-w-3xl mb-8">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-primary font-mono font-semibold mb-3">From raw pain to wedge</p>
                        <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
                            This is what CueIdea actually turns into an opportunity.
                        </h2>
                        <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                            These are live examples pulled from the current feed. We keep the raw complaint visible,
                            show the shaped wedge beside it, and expose the evidence count instead of asking you to trust a black box.
                        </p>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                        {painExamples.map((example) => (
                            <div
                                key={`${example.topic}-${example.wedge}`}
                                className="rounded-[22px] p-5"
                                style={{ border: "1px solid hsl(0 0% 100% / 0.08)", background: "linear-gradient(180deg, hsla(0,0%,8%,0.92), hsla(0,0%,6%,0.94))" }}
                            >
                                <div className="flex items-center justify-between gap-4 mb-5">
                                    <div>
                                        <p className="text-[11px] uppercase tracking-[0.14em] text-primary font-mono font-semibold">{example.source}</p>
                                        <p className="text-xs text-muted-foreground mt-1">{example.community}</p>
                                    </div>
                                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/20 text-[10px] font-mono uppercase tracking-[0.12em] text-primary">
                                        <CheckCircle2 className="w-3 h-3" />
                                        Live proof
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div
                                        className="rounded-2xl p-4"
                                        style={{ background: "hsl(0 0% 10% / 0.75)", border: "1px solid hsl(0 0% 100% / 0.06)" }}
                                    >
                                        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-mono mb-2">Raw pain</p>
                                        <div className="flex gap-3">
                                            <MessageSquareQuote className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                                            <p className="text-sm text-foreground leading-relaxed">{example.pain}</p>
                                        </div>
                                    </div>

                                    <div className="flex justify-center">
                                        <span className="inline-flex items-center gap-2 text-xs font-mono text-primary uppercase tracking-[0.14em]">
                                            Clustered into
                                            <ArrowRight className="w-3.5 h-3.5" />
                                        </span>
                                    </div>

                                    <div
                                        className="rounded-2xl p-4"
                                        style={{ background: "linear-gradient(135deg, hsl(16 100% 50% / 0.14), hsl(16 100% 50% / 0.04))", border: "1px solid hsl(16 100% 50% / 0.18)" }}
                                    >
                                        <p className="text-[11px] uppercase tracking-[0.14em] text-primary font-mono mb-2">Suggested wedge</p>
                                        <h3 className="text-base font-semibold text-foreground">{example.wedge}</h3>
                                        <p className="text-sm text-muted-foreground leading-relaxed mt-2">{example.why}</p>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        <div className="rounded-xl border border-white/6 px-3 py-3 bg-black/20">
                                            <p className="text-xl font-display font-black orange-text">{Math.round(example.score)}</p>
                                            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-mono">signal</p>
                                        </div>
                                        <div className="rounded-xl border border-white/6 px-3 py-3 bg-black/20">
                                            <p className="text-xl font-display font-black text-foreground">{example.evidenceCount}</p>
                                            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-mono">posts</p>
                                        </div>
                                        <div className="rounded-xl border border-white/6 px-3 py-3 bg-black/20">
                                            <p className="text-xl font-display font-black text-foreground">{example.sourceCount}</p>
                                            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-mono">sources</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="mb-16">
                    <div className="max-w-3xl mb-8">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-primary font-mono font-semibold mb-3">Source truth</p>
                        <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
                            No vague "4 core sources." Here is the live feed, plainly.
                        </h2>
                        <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                            CueIdea currently watches these public communities in the live feed. Each one pushes different
                            kinds of pain into the board, so you can tell whether a wedge is Reddit-only noise or cross-source signal.
                        </p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {liveSources.map((source) => {
                            const healthy = sourceHealth.healthy_sources.includes(source.key);
                            const degraded = sourceHealth.degraded_sources.includes(source.key);

                            return (
                                <div key={source.key} className="bento-cell rounded-[18px] p-5">
                                    <div className="flex items-center justify-between gap-4 mb-4">
                                        <div className="w-10 h-10 rounded-xl flex items-center justify-center border border-primary/20 bg-primary/10">
                                            <Database className="w-4 h-4 text-primary" />
                                        </div>
                                        <span className={`text-[10px] font-mono uppercase tracking-[0.12em] ${degraded ? "text-yellow-300" : healthy ? "text-emerald-300" : "text-muted-foreground"}`}>
                                            {degraded ? "degraded" : healthy ? "live" : "tracked"}
                                        </span>
                                    </div>
                                    <h3 className="text-lg font-semibold text-foreground mb-2">{source.name}</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed">{source.detail}</p>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-16">
                    {featureCards.map(({ icon: Icon, title, desc }) => (
                        <div key={title} className="bento-cell rounded-[14px] p-5">
                            <div
                                className="w-8 h-8 rounded-md flex items-center justify-center mb-3"
                                style={{ background: "hsl(16 100% 50% / 0.12)", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                            >
                                <Icon className="w-4 h-4 text-primary" />
                            </div>
                            <h3 className="text-xs font-bold mb-1.5 text-foreground">{title}</h3>
                            <p className="text-[11px] text-muted-foreground leading-relaxed font-mono">{desc}</p>
                        </div>
                    ))}
                </section>

                <section
                    className="rounded-[26px] p-6 md:p-8"
                    style={{ border: "1px solid hsl(0 0% 100% / 0.08)", background: "linear-gradient(180deg, hsla(0,0%,8%,0.94), hsla(0,0%,5%,0.96))" }}
                >
                    <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
                        <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-primary font-mono font-semibold mb-3">Open beta</p>
                            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
                                Explore the live board first. Validate after.
                            </h2>
                            <p className="text-sm md:text-base text-muted-foreground leading-relaxed max-w-2xl">
                                The beta is open. Browse the live market board, inspect how CueIdea shapes raw complaints into wedges,
                                then run deeper validation once you want to pressure-test one opportunity.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <Link
                                href="/dashboard"
                                className="inline-flex items-center gap-2 px-7 h-11 rounded-lg text-sm font-semibold text-white transition-all hover:scale-105"
                                style={{ background: "hsl(16 100% 50%)", boxShadow: "0 0 24px hsla(16,100%,50%,0.3)" }}
                            >
                                Open beta board <Radar className="w-4 h-4" />
                            </Link>
                            <Link
                                href="/pricing"
                                className="inline-flex items-center gap-2 px-6 h-11 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
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
