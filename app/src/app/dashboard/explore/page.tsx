"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
    Activity,
    AlertCircle,
    ArrowUpRight,
    BarChart3,
    Layers3,
    Search,
    Sparkles,
    TrendingDown,
    TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { useDashboardViewer } from "@/app/dashboard/viewer-context";
import { ValidationDepthChooser } from "@/app/dashboard/components/ValidationDepthChooser";
import { formatCountLabel, summarizeIdeaForBrowse } from "@/lib/user-facing-copy";
import type { ValidationPrefill } from "@/lib/validation-entry";

interface IdeaRow {
    id: string;
    topic: string;
    public_title?: string;
    public_summary?: string;
    slug: string;
    current_score: number;
    change_24h: number;
    change_7d: number;
    change_30d: number;
    trend_direction: string;
    confidence_level: string;
    post_count_total: number;
    post_count_24h?: number;
    post_count_7d: number;
    source_count: number;
    sources: Array<{ platform: string; count: number }>;
    category: string;
    competition_data: Record<string, unknown> | null;
    icp_data: Record<string, unknown> | null;
    top_posts: Array<{ title: string; subreddit?: string; score?: number; permalink?: string }>;
    keywords: string[];
    pain_count?: number;
    pain_summary?: string;
    first_seen: string;
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
    strategy_preview?: {
        posture: string;
        posture_rationale: string;
        strongest_reason: string;
        strongest_caution: string;
        readiness_score: number;
        why_now_category: string;
        next_move_summary: string;
    };
}

type IdeaVerdict = "BUILD IT" | "RISKY" | "DON'T BUILD";

const verdictConfig: Record<IdeaVerdict, { className: string; tone: string; summary: string }> = {
    "BUILD IT": {
        className: "bg-build/10 text-build border border-build/25",
        tone: "text-build",
        summary: "Demand and momentum are lining up.",
    },
    "RISKY": {
        className: "bg-risky/10 text-risky border border-risky/25",
        tone: "text-risky",
        summary: "There is signal here, but it still needs sharper proof.",
    },
    "DON'T BUILD": {
        className: "bg-dont/10 text-dont border border-dont/25",
        tone: "text-dont",
        summary: "Weak signal or too much downside right now.",
    },
};

function scoreToVerdict(score: number): IdeaVerdict {
    if (score >= 65) return "BUILD IT";
    if (score >= 35) return "RISKY";
    return "DON'T BUILD";
}

function formatTimeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "just now";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
}

function formatSigned(value: number, digits = 1): string {
    return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatCompact(value: number): string {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function getMomentumLabel(change24h: number): string {
    if (change24h >= 20) return "Heating up quickly";
    if (change24h >= 5) return "Gaining attention";
    if (change24h <= -10) return "Cooling down";
    return "Holding steady";
}

function getTrendLabel(trendDirection: string): string {
    switch (trendDirection?.toLowerCase()) {
        case "rising":
            return "Gaining traction";
        case "falling":
            return "Cooling off";
        case "new":
            return "Newly tracked";
        default:
            return "Holding steady";
    }
}

function getConfidenceLabel(confidenceLevel: string): string {
    switch ((confidenceLevel || "").toUpperCase()) {
        case "HIGH":
            return "Strong proof";
        case "MEDIUM":
            return "Cross-source proof";
        case "LOW":
            return "Early proof";
        default:
            return "Proof still forming";
    }
}

function describeIdea(idea: IdeaRow): string {
    return idea.public_summary || summarizeIdeaForBrowse(idea);
}

function displayIdeaTitle(idea: IdeaRow): string {
    return idea.public_title || idea.topic;
}

function buildExploreValidationPrefill(idea: IdeaRow): ValidationPrefill {
    const strongestPost = Array.isArray(idea.top_posts) && idea.top_posts.length > 0 ? idea.top_posts[0] : null;
    const target = strongestPost?.subreddit
        ? `People active in r/${strongestPost.subreddit}`
        : idea.category
          ? `${idea.category} operators`
          : idea.source_count > 1
            ? `Operators discussing this across ${idea.source_count} sources`
            : "Operators repeatedly describing this pain";

    return {
        idea: displayIdeaTitle(idea),
        target,
        pain: idea.pain_summary || describeIdea(idea),
    };
}

function getSourceMix(sources: IdeaRow["sources"]): string {
    if (!Array.isArray(sources) || sources.length === 0) {
        return "Source mix still forming";
    }

    return sources
        .slice(0, 3)
        .map((source) => `${source.platform}: ${source.count}`)
        .join(" | ");
}

function getTopSourceLabel(sources: IdeaRow["sources"]): string {
    if (!Array.isArray(sources) || sources.length === 0) return "No source data";
    const topSource = [...sources].sort((a, b) => b.count - a.count)[0];
    return `${topSource.platform} leads`;
}

function MetricCard({
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
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-mono">
                {icon}
                <span>{label}</span>
            </div>
            <div className="text-base font-mono font-semibold text-foreground">{value}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
        </div>
    );
}

export default function ExplorePage() {
    const supabase = useMemo(() => createClient(), []);
    const { isGuest } = useDashboardViewer();
    const [ideas, setIdeas] = useState<IdeaRow[]>([]);
    const [filter, setFilter] = useState("All");
    const [sort, setSort] = useState("score");
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const filters = ["All", "BUILD IT", "RISKY", "DON'T BUILD"];

    useEffect(() => {
        const load = async () => {
            try {
                const sortParam = sort === "trending" ? "trending" : sort === "new" ? "new" : "score";
                const endpoint = isGuest ? "/api/public/ideas" : "/api/ideas";
                const res = await fetch(`${endpoint}?sort=${sortParam}&limit=50`, { cache: "no-store" });
                const data = await res.json();
                if (data.ideas) setIdeas(data.ideas);
            } catch (err) {
                console.error("Failed to load ideas:", err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [isGuest, sort]);

    useEffect(() => {
        const channel = supabase
            .channel("ideas-live")
            .on(
                "postgres_changes" as any,
                {
                    event: "*",
                    schema: "public",
                    table: "ideas",
                } as any,
                (payload: { eventType: string; new: IdeaRow }) => {
                    const row = payload.new;
                    if (!row?.id) return;
                    setIdeas((prev) => {
                        if (payload.eventType === "INSERT") {
                            return [row, ...prev].slice(0, 100);
                        }
                        if (payload.eventType === "UPDATE") {
                            return prev.map((idea) => (idea.id === row.id ? row : idea));
                        }
                        return prev;
                    });
                },
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [supabase]);

    const enhancedIdeas = useMemo(
        () =>
            ideas.map((idea) => ({
                ...idea,
                verdict: scoreToVerdict(idea.current_score),
            })),
        [ideas],
    );

    const filtered = enhancedIdeas
        .filter((idea) => filter === "All" || idea.verdict === filter)
        .filter((idea) => !searchQuery || idea.topic.toLowerCase().includes(searchQuery.toLowerCase()));

    const summary = useMemo(() => {
        const buildIdeas = enhancedIdeas.filter((idea) => idea.verdict === "BUILD IT").length;
        const risingIdeas = enhancedIdeas.filter((idea) => idea.change_24h > 0).length;
        const averageScore = enhancedIdeas.length
            ? Math.round(enhancedIdeas.reduce((sum, idea) => sum + idea.current_score, 0) / enhancedIdeas.length)
            : 0;
        return {
            tracked: enhancedIdeas.length,
            buildIdeas,
            risingIdeas,
            averageScore,
        };
    }, [enhancedIdeas]);

    return (
        <div className="relative z-10 mx-auto max-w-[1120px] px-3 pb-20 pt-4 sm:px-4">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <h1 className="text-[26px] font-semibold font-display tracking-tight-custom text-white">Explore Ideas</h1>
                <p className="mt-2 max-w-2xl text-[12px] leading-6 text-muted-foreground">
                    A fast scan of startup ideas already showing real proof. Open any card to see the verdict, the evidence, and the next move.
                </p>
            </motion.div>

            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricCard
                    icon={<Layers3 className="h-3.5 w-3.5" />}
                    label="Tracked"
                    value={summary.tracked.toString()}
                    hint="Ideas currently ranked in the market board"
                />
                <MetricCard
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                    label="Build It"
                    value={summary.buildIdeas.toString()}
                    hint="Ideas currently scoring into the highest tier"
                />
                <MetricCard
                    icon={<TrendingUp className="h-3.5 w-3.5" />}
                    label="Gaining traction"
                    value={summary.risingIdeas.toString()}
                    hint="Ideas with positive 24h movement"
                />
                <MetricCard
                    icon={<BarChart3 className="h-3.5 w-3.5" />}
                    label="Avg Score"
                    value={summary.averageScore.toString()}
                    hint="Average market score across the board"
                />
            </div>

            <div className="mb-5 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 backdrop-blur-xl">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-3">
                        <div>
                            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-mono">
                                Opportunity Filter
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {filters.map((item) => (
                                    <button
                                        key={item}
                                        onClick={() => setFilter(item)}
                                        className={`rounded-full border px-3.5 py-1.5 text-[10px] font-mono uppercase tracking-[0.12em] transition ${
                                            item === filter
                                                ? "border-primary/30 bg-primary/10 text-primary"
                                                : "border-white/[0.07] bg-white/[0.02] text-muted-foreground hover:border-primary/20 hover:text-foreground"
                                        }`}
                                    >
                                        {item}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <label className="flex flex-col gap-2">
                                <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-mono">
                                    Sort By
                                </span>
                                <select
                                    value={sort}
                                    onChange={(e) => setSort(e.target.value)}
                                    className="min-w-[156px] rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-[13px] font-mono text-foreground outline-none"
                                >
                                    <option value="score">Top Score</option>
                                    <option value="trending">Strongest 24h momentum</option>
                                    <option value="new">Newest opportunities</option>
                                </select>
                            </label>
                        </div>
                    </div>

                    <label className="w-full max-w-sm">
                        <span className="mb-2 block text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-mono">
                            Search Ideas
                        </span>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                            <input
                                type="text"
                                placeholder="Search topics, niches, or themes"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full rounded-xl border border-white/[0.07] bg-black/20 py-2.5 pl-10 pr-4 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/45"
                            />
                        </div>
                    </label>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="bento-cell p-4">
                            <div className="skeleton mb-4 h-6 w-28" />
                            <div className="skeleton mb-3 h-5 w-3/4" />
                            <div className="skeleton mb-5 h-10 w-full" />
                            <div className="grid grid-cols-3 gap-3">
                                <div className="skeleton h-20" />
                                <div className="skeleton h-20" />
                                <div className="skeleton h-20" />
                            </div>
                            <div className="skeleton mt-4 h-24 w-full" />
                        </div>
                    ))}
                </div>
            ) : filtered.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((idea, index) => {
                        const verdict = verdictConfig[idea.verdict];
                        const scoreColor =
                            idea.current_score >= 70
                                ? "text-build"
                                : idea.current_score >= 40
                                  ? "text-risky"
                                  : "text-dont";
                        const validationPrefill = buildExploreValidationPrefill(idea);

                        return (
                            <motion.article
                                key={idea.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.03 }}
                                className="bento-cell flex h-full min-h-[204px] flex-col p-3.5"
                            >
                                <div className="mb-3 flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                                            <span
                                                className={`inline-flex rounded-full px-2 py-1 text-[10px] font-mono uppercase tracking-[0.12em] ${verdict.className}`}
                                            >
                                                {idea.verdict}
                                            </span>
                                            <span className={`text-[16px] font-semibold font-mono ${scoreColor}`}>
                                                {Math.round(idea.current_score)}
                                            </span>
                                            <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                                {idea.category || "General"}
                                            </span>
                                        </div>

                                        <Link href={`/dashboard/idea/${idea.slug}`} className="block">
                                            <h2 className="text-[17px] font-semibold leading-tight text-white transition hover:text-primary">
                                                {displayIdeaTitle(idea)}
                                            </h2>
                                        </Link>
                                        <p className="mt-1.5 text-[12px] leading-[1.55] text-muted-foreground">{describeIdea(idea)}</p>
                                    </div>

                                    <div className="shrink-0 text-right">
                                        <div
                                            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-mono ${
                                                idea.change_24h >= 0 ? "bg-build/10 text-build" : "bg-dont/10 text-dont"
                                            }`}
                                        >
                                            {idea.change_24h >= 0 ? (
                                                <TrendingUp className="h-3.5 w-3.5" />
                                            ) : (
                                                <TrendingDown className="h-3.5 w-3.5" />
                                            )}
                                            {formatSigned(idea.change_24h)} 24h
                                        </div>
                                        <div className="mt-2.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-mono">
                                            Updated
                                        </div>
                                        <div className="mt-1 text-[12px] font-mono text-foreground">{formatTimeAgo(idea.last_updated)}</div>
                                    </div>
                                </div>

                                <div className="mb-3 grid grid-cols-3 gap-2.5">
                                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2.5">
                                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-mono">
                                            <Activity className="h-3.5 w-3.5" />
                                            Momentum
                                        </div>
                                        <div className="text-[12px] font-semibold text-foreground">{getMomentumLabel(idea.change_24h)}</div>
                                        <p className="mt-1 text-[11px] text-muted-foreground">
                                            {formatSigned(idea.change_24h)} today
                                        </p>
                                    </div>

                                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2.5">
                                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-mono">
                                            <BarChart3 className="h-3.5 w-3.5" />
                                            Posts
                                        </div>
                                        <div className="text-[15px] font-semibold font-mono text-foreground">
                                            {formatCompact(idea.post_count_total)}
                                        </div>
                                        <p className="mt-1 text-[11px] text-muted-foreground">
                                            {(idea.post_count_24h ?? 0) > 0
                                                ? `${idea.post_count_24h} in 24h`
                                                : `${idea.post_count_7d} in 7d`}
                                        </p>
                                    </div>

                                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-2.5">
                                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-mono">
                                            <Layers3 className="h-3.5 w-3.5" />
                                            Sources
                                        </div>
                                        <div className="text-[15px] font-semibold font-mono text-foreground">{idea.source_count}</div>
                                        <p className="mt-1 text-[11px] text-muted-foreground">{formatCountLabel(idea.source_count, "source")}</p>
                                    </div>
                                </div>

                                <div className="mb-3 flex flex-wrap gap-1.5">
                                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                        {getTrendLabel(idea.trend_direction)}
                                    </span>
                                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                        {getConfidenceLabel(idea.confidence_level)}
                                    </span>
                                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                        {idea.trust.freshness_label}
                                    </span>
                                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                        {idea.trust.direct_quote_count > 0 ? `${idea.trust.direct_quote_count} buyer quotes` : "Needs buyer quotes"}
                                    </span>
                                </div>

                                <div className="mt-auto flex items-end justify-between gap-3 border-t border-white/[0.07] pt-3">
                                    <div className="min-w-0">
                                        <div className={`text-[13px] font-medium ${verdict.tone}`}>{verdict.summary}</div>
                                        <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{getSourceMix(idea.sources)}</div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        <ValidationDepthChooser
                                            prefill={validationPrefill}
                                            isGuest={isGuest}
                                            nextPath="/dashboard/explore"
                                            panelAlign="end"
                                        >
                                            <span className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12px] font-medium text-foreground transition hover:bg-white/[0.06]">
                                                Validate
                                            </span>
                                        </ValidationDepthChooser>
                                        <Link
                                            href={`/dashboard/idea/${idea.slug}`}
                                            className="inline-flex items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-[12px] font-medium text-primary transition hover:bg-primary/15"
                                        >
                                            Open idea
                                            <ArrowUpRight className="h-4 w-4" />
                                        </Link>
                                    </div>
                                </div>
                            </motion.article>
                        );
                    })}
                </div>
            ) : (
                <div className="bento-cell flex flex-col items-center justify-center rounded-2xl p-12 text-center">
                    <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/30" />
                    <p className="mb-1 text-sm font-medium text-muted-foreground/80">No ideas found</p>
                    <p className="text-sm text-muted-foreground/60">
                        {searchQuery
                            ? "Try a different search query."
                            : "The scraper has not collected any ideas yet. Run the scraper to populate the radar."}
                    </p>
                    <Link
                        href="/dashboard/validate"
                        className="mt-4 inline-flex items-center rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-primary transition-colors hover:bg-primary/20"
                    >
                        {"Run Validation ->"}
                    </Link>
                </div>
            )}
        </div>
    );
}
