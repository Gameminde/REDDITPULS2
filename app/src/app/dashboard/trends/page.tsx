"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Activity,
    AlertCircle,
    BarChart3,
    Flame,
    Layers3,
    Radar,
    TrendingDown,
    TrendingUp,
} from "lucide-react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase-browser";

interface PlatformWarning {
    platform: string;
    issue: string;
    status?: string;
    error_code?: string | null;
    error_detail?: string | null;
}

interface ThemeTrend {
    id: string;
    slug: string;
    topic: string;
    category: string;
    tier: "EXPLODING" | "GROWING" | "STABLE" | "DECLINING";
    current_score: number;
    change_24h: number;
    change_7d: number;
    post_count_24h: number;
    post_count_7d: number;
    post_count_total: number;
    source_count: number;
    sources: Array<{ platform: string; count: number }>;
    confidence_level: string;
    pain_count: number;
    pain_summary: string;
    top_posts: Array<{ title?: string; score?: number; source?: string; subreddit?: string; url?: string }>;
    last_updated: string;
    trust: {
        level: "HIGH" | "MEDIUM" | "LOW";
        label: string;
        score: number;
        evidence_count: number;
        direct_evidence_count: number;
        direct_quote_count: number;
        source_count: number;
        freshness_hours: number | null;
        freshness_label: string;
        weak_signal: boolean;
        weak_signal_reasons: string[];
        inference_flags: string[];
    };
}

interface WhyNowSignal {
    id: string;
    scope: "opportunity" | "competitor";
    title: string;
    href: string;
    timing_category: string;
    summary: string;
    direct_timing_evidence: Array<{ label: string; value: string; kind: "metric" | "observation" }>;
    inferred_why_now_note: string;
    freshness: {
        latest_observed_at: string | null;
        freshness_label: string;
    };
    confidence: {
        level: "HIGH" | "MEDIUM" | "LOW";
        label: string;
        score: number;
    };
    momentum_direction: "accelerating" | "steady" | "cooling" | "new" | "unknown";
    monitorable_change_note: string;
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

const trendConfig: Record<
    ThemeTrend["tier"],
    {
        color: string;
        badge: string;
        summary: string;
        emphasis: string;
    }
> = {
    EXPLODING: {
        color: "text-primary",
        badge: "bg-primary/10 text-primary border-primary/25",
        summary: "This conversation theme is breaking out fast across recent posts.",
        emphasis: "Fast breakout",
    },
    GROWING: {
        color: "text-build",
        badge: "bg-build/10 text-build border-build/20",
        summary: "This theme is steadily gaining attention and deserves monitoring.",
        emphasis: "Healthy climb",
    },
    STABLE: {
        color: "text-risky",
        badge: "bg-risky/10 text-risky border-risky/20",
        summary: "This topic has meaningful volume, but momentum is mostly flat.",
        emphasis: "Established demand",
    },
    DECLINING: {
        color: "text-dont",
        badge: "bg-dont/10 text-dont border-dont/20",
        summary: "Attention is fading even though the theme still has some demand.",
        emphasis: "Cooling off",
    },
};

function formatSigned(value: number, digits = 1) {
    return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatTimeAgo(dateStr: string) {
    if (!dateStr) return "recently";
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "just now";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
}

function normalizeTopicName(topic: string) {
    return topic.replace(/\bAi\b/g, "AI");
}

function buildCoverageNote(warnings: PlatformWarning[]) {
    if (warnings.length === 0) return null;

    const platforms = warnings.map((warning) => warning.platform.toLowerCase());
    const hasProductHunt = platforms.includes("producthunt");
    const hasIndieHackers = platforms.includes("indiehackers");

    if (hasProductHunt && hasIndieHackers) {
        return "Theme detection is currently strongest on Reddit and Hacker News while Product Hunt and Indie Hackers continue refreshing in the background.";
    }
    if (hasProductHunt) {
        return "Theme detection is currently strongest on Reddit and Hacker News while Product Hunt coverage refreshes in the background.";
    }
    if (hasIndieHackers) {
        return "Theme detection is currently strongest on Reddit and Hacker News while Indie Hackers coverage refreshes in the background.";
    }

    return "Theme detection is currently strongest on the sources with the healthiest recent coverage.";
}

function buildThemeMeaning(trend: ThemeTrend) {
    if (trend.pain_summary) return trend.pain_summary;

    const topPost = trend.top_posts?.[0]?.title?.trim();
    if (!topPost) {
        return `People are repeatedly discussing ${normalizeTopicName(trend.topic)} and the theme has enough evidence to clear the quality threshold.`;
    }

    const cleaned = topPost
        .replace(/^Show HN:\s*/i, "")
        .replace(/^Ask HN:\s*/i, "")
        .replace(/^Launch HN:\s*/i, "")
        .replace(/^Tell HN:\s*/i, "")
        .trim();

    return `People discussing ${normalizeTopicName(trend.topic)} keep returning to ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}.`;
}

function sourceMixLabel(sources: ThemeTrend["sources"]) {
    if (!Array.isArray(sources) || sources.length === 0) {
        return "Source mix still forming";
    }

    return sources
        .slice(0, 3)
        .map((source) => `${source.platform}: ${source.count}`)
        .join(" | ");
}

function getTrustTone(level: ThemeTrend["trust"]["level"]) {
    if (level === "HIGH") return "text-build border-build/20 bg-build/10";
    if (level === "MEDIUM") return "text-risky border-risky/20 bg-risky/10";
    return "text-dont border-dont/20 bg-dont/10";
}

function LoadingSkeleton() {
    return (
        <div className="grid grid-cols-1 gap-4 pb-24 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="bento-cell p-5">
                    <div className="skeleton mb-4 h-6 w-36" />
                    <div className="skeleton mb-3 h-4 w-4/5" />
                    <div className="grid grid-cols-2 gap-3">
                        <div className="skeleton h-20" />
                        <div className="skeleton h-20" />
                        <div className="skeleton h-20" />
                        <div className="skeleton h-20" />
                    </div>
                    <div className="skeleton mt-4 h-24 w-full" />
                </div>
            ))}
        </div>
    );
}

function SummaryCard({
    icon,
    label,
    value,
    hint,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    hint: string;
}) {
    return (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                {icon}
                <span>{label}</span>
            </div>
            <div className="text-xl font-semibold font-mono text-foreground">{value}</div>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
    );
}

export default function TrendsPage() {
    const supabase = useMemo(() => createClient(), []);
    const [trends, setTrends] = useState<ThemeTrend[]>([]);
    const [whyNowSignals, setWhyNowSignals] = useState<WhyNowSignal[]>([]);
    const [platformWarnings, setPlatformWarnings] = useState<PlatformWarning[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadTrends = useCallback(async () => {
        try {
            const [trendsResponse, whyNowResponse] = await Promise.all([
                fetch("/api/trend-signals", { cache: "no-store" }),
                fetch("/api/why-now?scope=opportunity&limit=4", { cache: "no-store" }),
            ]);

            if (!trendsResponse.ok) {
                throw new Error(`trend fetch failed with ${trendsResponse.status}`);
            }
            if (!whyNowResponse.ok) {
                throw new Error(`why-now fetch failed with ${whyNowResponse.status}`);
            }

            const payload = await trendsResponse.json();
            const whyNowPayload = await whyNowResponse.json();
            if (payload.error) {
                throw new Error(payload.error);
            }
            setTrends(payload.trends || []);
            setPlatformWarnings(payload.platform_warnings || []);
            setWhyNowSignals(whyNowPayload.signals || []);
            setError(null);
        } catch {
            setTrends([]);
            setWhyNowSignals([]);
            setPlatformWarnings([]);
            setError("Could not load trends - check connection and retry");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadTrends();

        const channel = supabase
            .channel("ideas-trends")
            .on(
                "postgres_changes" as any,
                {
                    event: "*",
                    schema: "public",
                    table: "ideas",
                } as any,
                () => {
                    loadTrends();
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [loadTrends, supabase]);

    const summary = useMemo(() => {
        const exploding = trends.filter((trend) => trend.tier === "EXPLODING").length;
        const growing = trends.filter((trend) => trend.tier === "GROWING").length;
        const mentions24h = trends.reduce((sum, trend) => sum + trend.post_count_24h, 0);
        const avgSources = trends.length
            ? (trends.reduce((sum, trend) => sum + trend.source_count, 0) / trends.length).toFixed(1)
            : "0.0";

        return { exploding, growing, mentions24h, avgSources };
    }, [trends]);

    const coverageNote = useMemo(() => buildCoverageNote(platformWarnings), [platformWarnings]);

    return (
        <div className="max-w-7xl mx-auto px-4 pt-8 sm:px-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <h1 className="text-[32px] font-bold font-display tracking-tight-custom text-white">Market Trends</h1>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                    This board shows recurring market themes with enough recent evidence to matter. A trend appears here only
                    when repeated conversation builds into a real signal, not because of one lucky post.
                </p>
            </motion.div>

            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <SummaryCard
                    icon={<Flame className="h-3.5 w-3.5" />}
                    label="Exploding"
                    value={summary.exploding.toString()}
                    hint="Themes breaking out fastest"
                />
                <SummaryCard
                    icon={<TrendingUp className="h-3.5 w-3.5" />}
                    label="Growing"
                    value={summary.growing.toString()}
                    hint="Themes steadily gathering momentum"
                />
                <SummaryCard
                    icon={<Activity className="h-3.5 w-3.5" />}
                    label="Mentions 24h"
                    value={summary.mentions24h.toString()}
                    hint="Recent evidence across qualified themes"
                />
                <SummaryCard
                    icon={<Layers3 className="h-3.5 w-3.5" />}
                    label="Avg Sources"
                    value={summary.avgSources}
                    hint="Average number of sources per theme"
                />
            </div>

            {coverageNote && (
                <div className="mb-5 rounded-2xl border border-risky/20 bg-risky/8 p-4">
                    <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.12em] text-risky">Coverage Note</div>
                    <p className="text-sm leading-relaxed text-foreground/85">{coverageNote}</p>
                </div>
            )}

            {!loading && whyNowSignals.length > 0 && (
                <div className="mb-6 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
                    <div className="mb-4 flex items-start justify-between gap-4">
                        <div>
                            <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-primary">Why Now</div>
                            <h2 className="mt-2 text-lg font-semibold text-white">Timing intelligence</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                This layer explains why a theme is surfacing now, not just that it exists.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        {whyNowSignals.map((signal) => (
                            <div key={signal.id} className="rounded-xl border border-white/[0.07] bg-black/20 p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.12em] text-primary">
                                        {signal.timing_category}
                                    </span>
                                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.12em] ${getTrustTone(signal.confidence.level)}`}>
                                        {signal.confidence.label}
                                    </span>
                                </div>

                                <div className="mt-3 text-base font-semibold text-white">{signal.title}</div>
                                <p className="mt-2 text-sm text-white/80">{signal.inferred_why_now_note}</p>

                                <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-mono text-muted-foreground">
                                    <span>{signal.momentum_direction}</span>
                                    <span>{signal.freshness.freshness_label}</span>
                                    <span>{signal.direct_vs_inferred.direct_evidence_count} direct timing signals</span>
                                </div>

                                <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                                    <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                        Direct timing evidence
                                    </div>
                                    <div className="space-y-2">
                                        {signal.direct_timing_evidence.slice(0, 3).map((point) => (
                                            <div key={`${signal.id}-${point.label}`} className="text-sm text-white/85">
                                                <span className="text-muted-foreground">{point.label}:</span> {point.value}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="mt-3 text-xs text-muted-foreground">{signal.monitorable_change_note}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {loading ? (
                <LoadingSkeleton />
            ) : error ? (
                <div className="bento-cell mt-6 flex flex-col items-center justify-center rounded-2xl p-12 text-center">
                    <AlertCircle className="mb-3 h-8 w-8 text-dont" />
                    <p className="mb-2 text-sm font-medium text-foreground">{error}</p>
                    <button
                        onClick={() => {
                            setLoading(true);
                            setError(null);
                            loadTrends();
                        }}
                        className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-mono text-foreground transition hover:bg-white/10"
                    >
                        Retry
                    </button>
                </div>
            ) : trends.length === 0 ? (
                <div className="bento-cell mt-6 flex flex-col items-center justify-center rounded-2xl p-12 text-center">
                    <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/30" />
                    <p className="mb-1 text-sm font-medium text-muted-foreground/80">No strong market trends yet</p>
                    <p className="text-sm text-muted-foreground/60">
                        A theme needs repeated recent discussion before it appears here. As new scraper runs land, this board
                        will fill with stronger signals.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 pb-24 md:grid-cols-2 xl:grid-cols-3">
                    {trends.map((trend, index) => {
                        const config = trendConfig[trend.tier] || trendConfig.STABLE;
                        return (
                            <motion.article
                                key={trend.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.03 }}
                                className="bento-cell flex min-h-[360px] flex-col p-5"
                            >
                                <div className="mb-4 flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                            Market theme
                                        </div>
                                        <h2 className="text-2xl font-semibold text-white">{normalizeTopicName(trend.topic)}</h2>
                                        <p className="mt-2 text-sm text-muted-foreground">{config.summary}</p>
                                    </div>

                                    <span
                                        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.12em] ${config.badge}`}
                                    >
                                        {trend.tier === "EXPLODING" && <Flame className="h-3.5 w-3.5" />}
                                        {trend.tier}
                                    </span>
                                </div>

                                <div className="mb-4 grid grid-cols-2 gap-3">
                                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                                        <div className="mb-2 flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                            <TrendingUp className="h-3.5 w-3.5" />
                                            24h momentum
                                        </div>
                                        <div className={`text-xl font-semibold font-mono ${config.color}`}>
                                            {formatSigned(trend.change_24h)}%
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">{config.emphasis}</p>
                                    </div>

                                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                                        <div className="mb-2 flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                            <Radar className="h-3.5 w-3.5" />
                                            Theme score
                                        </div>
                                        <div className="text-xl font-semibold font-mono text-foreground">{Math.round(trend.current_score)}</div>
                                        <p className="mt-1 text-xs text-muted-foreground">{trend.confidence_level.toLowerCase()} confidence</p>
                                    </div>

                                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                                        <div className="mb-2 flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                            <BarChart3 className="h-3.5 w-3.5" />
                                            Mentions 24h
                                        </div>
                                        <div className="text-xl font-semibold font-mono text-foreground">{trend.post_count_24h}</div>
                                        <p className="mt-1 text-xs text-muted-foreground">{trend.post_count_7d} mentions across the last 7 days</p>
                                    </div>

                                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                                        <div className="mb-2 flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                            <Layers3 className="h-3.5 w-3.5" />
                                            Sources
                                        </div>
                                        <div className="text-xl font-semibold font-mono text-foreground">{trend.source_count}</div>
                                        <p className="mt-1 text-xs text-muted-foreground">{sourceMixLabel(trend.sources)}</p>
                                    </div>
                                </div>

                                <div className="mb-4 rounded-xl border border-primary/12 bg-primary/[0.04] p-4">
                                    <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.12em] text-primary">
                                        Why this theme matters
                                    </div>
                                    <p className="text-sm leading-relaxed text-foreground/88">{buildThemeMeaning(trend)}</p>
                                </div>

                                <div className="mb-4 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                                    <div className="mb-3 flex flex-wrap items-center gap-2">
                                        <span
                                            className={`rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-[0.12em] ${getTrustTone(trend.trust.level)}`}
                                        >
                                            {trend.trust.label}
                                        </span>
                                        <span className="text-sm font-mono text-foreground">{trend.trust.score}/100 trust</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {trend.trust.evidence_count} recent mentions | {trend.trust.direct_quote_count} direct pain quotes | {trend.trust.freshness_label}
                                    </p>
                                    {trend.trust.weak_signal && trend.trust.weak_signal_reasons.length > 0 && (
                                        <p className="mt-2 text-xs text-risky">
                                            Weak signal: {trend.trust.weak_signal_reasons.join(" • ")}
                                        </p>
                                    )}
                                </div>

                                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4">
                                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                        {trend.category}
                                    </span>
                                    {trend.change_7d < 0 ? (
                                        <span className="rounded-full border border-dont/20 bg-dont/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.12em] text-dont">
                                            <TrendingDown className="mr-1 inline h-3.5 w-3.5" />
                                            Cooling vs 7d
                                        </span>
                                    ) : (
                                        <span className="rounded-full border border-build/20 bg-build/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.12em] text-build">
                                            <TrendingUp className="mr-1 inline h-3.5 w-3.5" />
                                            Updated {formatTimeAgo(trend.last_updated)}
                                        </span>
                                    )}
                                </div>
                            </motion.article>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
