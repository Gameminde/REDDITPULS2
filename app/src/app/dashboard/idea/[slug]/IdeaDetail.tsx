"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
    TrendingUp, TrendingDown, ArrowLeft, Star, Plus, Minus,
    BarChart3, Users, Target, ExternalLink, Clock, Activity,
    Sparkles, BookmarkPlus, AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { useDashboardViewer } from "@/app/dashboard/viewer-context";

interface HistoryPoint {
    score: number;
    post_count: number;
    source_count: number;
    recorded_at: string;
}

interface TopPost {
    title: string;
    source: string;
    subreddit: string;
    score: number;
    comments: number;
    url: string;
}

interface IdeaDetail {
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
    pain_count?: number;
    pain_summary?: string;
    post_count_7d: number;
    source_count: number;
    sources: Array<{ platform: string; count: number }>;
    category: string;
    reddit_velocity: number;
    google_trend_score: number;
    google_trend_growth: number;
    competition_score: number;
    cross_platform_multiplier: number;
    icp_data: Record<string, unknown>;
    competition_data: Record<string, unknown>;
    top_posts: TopPost[];
    keywords: string[];
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
    strategy?: {
        demand_proof: {
            summary: string;
        };
        buyer_clarity: {
            summary: string;
            wedge_summary: string;
        };
        competitor_gap: {
            strongest_gap: string;
        };
        why_now: {
            timing_category: string;
            summary: string;
            inferred_why_now_note: string;
        };
        revenue_path: {
            summary: string;
            recommended_entry_mode: string;
            first_offer_suggestion: string;
            first_customer_path: string;
        };
        service_first_pathfinder: {
            recommended_productization_posture: string;
            posture_rationale: string;
            strongest_reason_for_posture: string;
            strongest_caution: string;
            productization_readiness_score: number;
            what_must_become_true_before_productization: string[];
        };
        anti_idea: {
            verdict: {
                label: string;
                summary: string;
            };
        };
        next_move: {
            summary: string;
            recommended_action: string;
            first_step: string;
        };
    };
}

function decodeHtml(str: string) {
    return str
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

const CONF_MAP: Record<string, { label: string; color: string; bg: string }> = {
    LOW: { label: "⚠️ Weak Signal", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
    MEDIUM: { label: "📊 Moderate", color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
    HIGH: { label: "✅ Strong Signal", color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
    STRONG: { label: "🔥 Very Strong", color: "#10b981", bg: "rgba(16,185,129,0.1)" },
};

const TREND_MAP: Record<string, { label: string; icon: LucideIcon; color: string }> = {
    rising: { label: "Gaining traction", icon: TrendingUp, color: "#22c55e" },
    falling: { label: "Cooling off", icon: TrendingDown, color: "#ef4444" },
    stable: { label: "Stable", icon: Minus, color: "#64748b" },
    new: { label: "New", icon: Sparkles, color: "#8b5cf6" },
};

function MiniChart({ history }: { history: HistoryPoint[] }) {
    if (!history || history.length < 2) {
        return (
            <div className="flex items-center justify-center h-[200px] text-[12px] text-muted-foreground w-full text-center p-4">
                Not enough history for chart. Run the scraper a few more times.
            </div>
        );
    }

    const scores = history.map((h) => h.score);
    const maxScore = Math.max(...scores, 1);
    const minScore = Math.min(...scores, 0);
    const range = maxScore - minScore || 1;
    const width = 600;
    const height = 180;
    const padding = 30;

    const points = scores.map((s, i) => {
        const x = padding + (i / (scores.length - 1)) * (width - 2 * padding);
        const y = height - padding - ((s - minScore) / range) * (height - 2 * padding);
        return `${x},${y}`;
    });

    const line = `M${points.join(" L")}`;
    const area = `${line} L${padding + ((scores.length - 1) / (scores.length - 1)) * (width - 2 * padding)},${height - padding} L${padding},${height - padding} Z`;

    const isUp = scores[scores.length - 1] >= scores[0];
    const color = isUp ? "#22c55e" : "#ef4444";

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[200px]">
            <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
            </defs>
            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
                <line key={pct}
                    x1={padding} y1={height - padding - pct * (height - 2 * padding)}
                    x2={width - padding} y2={height - padding - pct * (height - 2 * padding)}
                    stroke="rgba(255,255,255,0.04)" strokeWidth={1}
                />
            ))}
            {/* Area fill */}
            <path d={area} fill="url(#chartGrad)" />
            {/* Line */}
            <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            {/* End dot */}
            <circle cx={parseFloat(points[points.length - 1].split(",")[0])} cy={parseFloat(points[points.length - 1].split(",")[1])}
                r={4} fill={color} stroke="#0f172a" strokeWidth={2} />
            {/* Labels */}
            <text x={padding} y={height - 8} fill="#475569" fontSize={10} fontFamily="var(--font-mono)">
                {new Date(history[0].recorded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </text>
            <text x={width - padding} y={height - 8} fill="#475569" fontSize={10} fontFamily="var(--font-mono)" textAnchor="end">
                {new Date(history[history.length - 1].recorded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </text>
            <text x={4} y={padding + 4} fill="#475569" fontSize={10} fontFamily="var(--font-mono)">{maxScore.toFixed(0)}</text>
            <text x={4} y={height - padding} fill="#475569" fontSize={10} fontFamily="var(--font-mono)">{minScore.toFixed(0)}</text>
        </svg>
    );
}

function MetricBox({ label, value, color, subtitle }: {
    label: string; value: string | number; color: string; subtitle?: string;
}) {
    return (
        <div className="bento-cell p-4 rounded-xl flex-1 min-w-[120px]">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5 font-bold">
                {label}
            </div>
            <div style={{ color }} className="text-[22px] font-extrabold font-mono leading-none">
                {value}
            </div>
            {subtitle && <div className="text-[11px] text-muted-foreground mt-1">{subtitle}</div>}
        </div>
    );
}

function SourceBadge({ source }: { source: string }) {
    const colors: Record<string, { bg: string; text: string; label: string }> = {
        reddit: { bg: "rgba(255,69,0,0.15)", text: "#ff4500", label: "Reddit" },
        hackernews: { bg: "rgba(255,102,0,0.15)", text: "#ff6600", label: "Hacker News" },
        producthunt: { bg: "rgba(218,85,47,0.15)", text: "#da552f", label: "ProductHunt" },
        indiehackers: { bg: "rgba(79,70,229,0.15)", text: "#4f46e5", label: "IndieHackers" },
    };
    const c = colors[source] || { bg: "rgba(100,116,139,0.1)", text: "#64748b", label: source };

    return (
        <span 
            className="text-[11px] px-2.5 py-1 rounded-md font-bold"
            style={{ background: c.bg, color: c.text }}
        >
            {c.label}
        </span>
    );
}

function trustTone(level: IdeaDetail["trust"]["level"]) {
    if (level === "HIGH") return "border-build/20 bg-build/10 text-build";
    if (level === "MEDIUM") return "border-risky/20 bg-risky/10 text-risky";
    return "border-dont/20 bg-dont/10 text-dont";
}

function postureTone(posture?: string) {
    if (!posture) return "border-white/10 bg-white/[0.03] text-muted-foreground";
    if (/productize now/i.test(posture)) return "border-build/20 bg-build/10 text-build";
    if (/hybrid/i.test(posture)) return "border-primary/20 bg-primary/10 text-primary";
    if (/service-first|concierge/i.test(posture)) return "border-risky/20 bg-risky/10 text-risky";
    return "border-dont/20 bg-dont/10 text-dont";
}

export default function IdeaDetailPage() {
    const params = useParams();
    const router = useRouter();
    const slug = params?.slug as string;
    const { isGuest } = useDashboardViewer();

    const [idea, setIdea] = useState<IdeaDetail | null>(null);
    const [history, setHistory] = useState<HistoryPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [watchlistLoading, setWatchlistLoading] = useState(false);

    useEffect(() => {
        if (!slug) return;
        setLoading(true);
        const endpoint = isGuest ? `/api/public/ideas/${slug}` : `/api/ideas/${slug}`;
        fetch(endpoint)
            .then((r) => r.json())
            .then((data) => {
                setIdea(data.idea);
                setHistory(data.history || []);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [isGuest, slug]);

    const addToWatchlist = async () => {
        if (!idea) return;
        setWatchlistLoading(true);
        try {
            await fetch("/api/watchlist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idea_id: idea.id }),
            });
            alert("Added to watchlist!");
        } catch {
            alert("Failed to add to watchlist");
        } finally {
            setWatchlistLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="p-16 text-center text-muted-foreground flex flex-col items-center justify-center">
                <Activity className="w-6 h-6 mb-3 opacity-50 animate-pulse" />
                <span className="text-sm font-medium">Loading idea...</span>
            </div>
        );
    }

    if (!idea) {
        return (
            <div className="p-16 text-center text-muted-foreground flex flex-col items-center justify-center">
                <AlertTriangle className="w-6 h-6 mb-3 opacity-50" />
                <span className="text-sm font-medium">Idea not found</span>
            </div>
        );
    }

    const conf = CONF_MAP[idea.confidence_level] || CONF_MAP.LOW;
    const trend = TREND_MAP[idea.trend_direction] || TREND_MAP.stable;
    const TrendI = trend.icon;
    const scoreColor = idea.current_score >= 70 ? "#22c55e" : idea.current_score >= 40 ? "#f97316" : "#64748b";

    return (
        <div className="max-w-6xl mx-auto p-6 md:p-8">
            {/* Back */}
            <button
                onClick={() => router.push("/dashboard")}
                className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-white transition-colors mb-5 font-medium bg-transparent border-none cursor-pointer p-0"
            >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Board
            </button>

            {/* Title + Actions */}
            <div className="flex flex-col md:flex-row md:justify-between md:items-start mb-6 gap-4 border-b border-white/5 pb-6">
                <div>
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h1 className="text-[28px] font-extrabold text-white font-display tracking-tight m-0">
                            {decodeHtml(idea.public_title || idea.topic)}
                        </h1>
                        <span 
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-bold"
                            style={{ background: `${trend.color}15`, color: trend.color }}
                        >
                            <TrendI className="w-3 h-3" />
                            {trend.label}
                        </span>
                    </div>
                    <div className="flex gap-2 items-center flex-wrap mt-2">
                        <span className="text-[11px] px-2 py-0.5 rounded bg-primary/10 text-primary uppercase font-bold tracking-wider">
                            {decodeHtml(idea.category)}
                        </span>
                        <span 
                            className="text-[11px] px-2 py-0.5 rounded font-bold tracking-wider" 
                            style={{ background: conf.bg, color: conf.color }}
                        >
                            {conf.label}
                        </span>
                        {(idea.sources || []).map((s) => <SourceBadge key={s.platform} source={s.platform} />)}
                    </div>
                </div>

                <button
                    onClick={addToWatchlist}
                    disabled={watchlistLoading}
                    className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 rounded-xl font-medium text-[13px] transition-colors"
                >
                    <BookmarkPlus className="w-4 h-4" />
                    {watchlistLoading ? "Adding..." : "Add to Watchlist"}
                </button>
            </div>

            {/* Score Row */}
            <div className="flex flex-wrap gap-3 mb-6">
                <MetricBox label="Score" value={idea.current_score.toFixed(0)} color={scoreColor} />
                <MetricBox label="24h Change" value={`${idea.change_24h > 0 ? "+" : ""}${idea.change_24h.toFixed(1)}`} color={idea.change_24h >= 0 ? "#22c55e" : "#ef4444"} />
                <MetricBox label="7d Change" value={`${idea.change_7d > 0 ? "+" : ""}${idea.change_7d.toFixed(1)}`} color={idea.change_7d >= 0 ? "#22c55e" : "#ef4444"} />
                <MetricBox label="30d Change" value={`${idea.change_30d > 0 ? "+" : ""}${idea.change_30d.toFixed(1)}`} color={idea.change_30d >= 0 ? "#22c55e" : "#ef4444"} />
                <MetricBox label="Volume" value={idea.post_count_total} color="#8b5cf6" subtitle={`${idea.post_count_7d} this week`} />
                <MetricBox label="Sources" value={idea.source_count} color="#3b82f6" />
            </div>

            <motion.div className="bento-cell p-6 rounded-2xl mb-6"
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h2 className="text-[14px] font-bold text-white mb-2">
                            Trust and Evidence
                        </h2>
                        {idea.public_summary ? (
                            <p className="mb-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                                {idea.public_summary}
                            </p>
                        ) : null}
                        <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-[0.12em] ${trustTone(idea.trust.level)}`}>
                            {idea.trust.label}
                            <span className="text-current/80">{idea.trust.score}/100</span>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 text-sm text-muted-foreground md:grid-cols-3">
                        <div>
                            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Evidence</div>
                            <div className="mt-1 text-white">{idea.trust.evidence_count} recent posts</div>
                        </div>
                        <div>
                            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Direct proof</div>
                            <div className="mt-1 text-white">{idea.trust.direct_evidence_count} posts | {idea.trust.direct_quote_count} quotes</div>
                        </div>
                        <div>
                            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Freshness</div>
                            <div className="mt-1 text-white">{idea.trust.freshness_label}</div>
                        </div>
                    </div>
                </div>

                {idea.trust.weak_signal && idea.trust.weak_signal_reasons.length > 0 && (
                    <div className="mt-4 rounded-xl border border-risky/20 bg-risky/8 p-4 text-sm text-risky">
                        Proof still needs work: {idea.trust.weak_signal_reasons.join(" • ")}
                    </div>
                )}

                {idea.trust.inference_flags.length > 0 && (
                    <div className="mt-3 text-xs text-muted-foreground">
                        Read with caution: {idea.trust.inference_flags.join(" • ")}
                    </div>
                )}
            </motion.div>

            {idea.strategy && (
                <motion.div
                    className="bento-cell p-6 rounded-2xl mb-6"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 }}
                >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div>
                            <h2 className="text-[14px] font-bold text-white mb-2">
                                Productization posture
                            </h2>
                            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-[0.12em] ${postureTone(idea.strategy.service_first_pathfinder.recommended_productization_posture)}`}>
                                {idea.strategy.service_first_pathfinder.recommended_productization_posture}
                                <span className="text-current/80">{idea.strategy.service_first_pathfinder.productization_readiness_score}/100</span>
                            </div>
                        </div>
                        <div className="max-w-2xl text-sm text-muted-foreground leading-relaxed">
                            {idea.strategy.service_first_pathfinder.posture_rationale}
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Strongest reason</div>
                            <p className="mt-2 text-sm text-foreground/90 leading-relaxed">
                                {idea.strategy.service_first_pathfinder.strongest_reason_for_posture}
                            </p>
                        </div>
                        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Strongest caution</div>
                            <p className="mt-2 text-sm text-foreground/90 leading-relaxed">
                                {idea.strategy.service_first_pathfinder.strongest_caution}
                            </p>
                        </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
                        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Why now</div>
                            <p className="mt-2 text-sm text-foreground/90 leading-relaxed">
                                {idea.strategy.why_now.inferred_why_now_note}
                            </p>
                        </div>
                        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Revenue path</div>
                            <p className="mt-2 text-sm text-foreground/90 leading-relaxed">
                                {idea.strategy.revenue_path.summary}
                            </p>
                        </div>
                        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Next move</div>
                            <p className="mt-2 text-sm text-foreground/90 leading-relaxed">
                                {idea.strategy.next_move.summary}
                            </p>
                        </div>
                    </div>

                    {idea.strategy.service_first_pathfinder.what_must_become_true_before_productization.length > 0 && (
                        <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Before productizing</div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {idea.strategy.service_first_pathfinder.what_must_become_true_before_productization.map((item, index) => (
                                    <span
                                        key={`${item}-${index}`}
                                        className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground"
                                    >
                                        {item}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </motion.div>
            )}

            {/* Chart */}
            <motion.div className="bento-cell p-6 rounded-2xl mb-6"
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                <h2 className="text-[14px] font-bold text-white mb-4">
                    Score History
                </h2>
                <MiniChart history={history} />
            </motion.div>

            {/* Report Card */}
            <motion.div className="bento-cell p-6 rounded-2xl mb-6"
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <h2 className="text-[14px] font-bold text-white mb-4">
                    📊 Opportunity Report Card
                </h2>
                <div className="font-mono text-[13px] leading-loose text-muted-foreground whitespace-pre-line bg-black/20 p-5 rounded-xl border border-white/5">
                    {`Score:          ${idea.current_score.toFixed(0)}/100  ${idea.change_7d > 0 ? "📈" : idea.change_7d < 0 ? "📉" : "→"} ${idea.change_7d > 0 ? "+" : ""}${idea.change_7d.toFixed(1)} this week`}
                    {"\n"}{`Confidence:     ${conf.label} — ${idea.post_count_total} posts, ${idea.source_count} platform${idea.source_count > 1 ? "s" : ""}`}
                    {"\n"}{`Trend:          ${trend.label} (${idea.change_30d > 0 ? "+" : ""}${idea.change_30d.toFixed(1)} over 30d)`}
                    {"\n"}{`Velocity:       ${idea.reddit_velocity.toFixed(1)} (Reddit post acceleration)`}
                    {"\n"}{`Category:       ${idea.category}`}
                    {"\n"}{`First seen:     ${new Date(idea.first_seen).toLocaleDateString()}`}
                    {"\n"}{`Last updated:   ${new Date(idea.last_updated).toLocaleString()}`}
                </div>
            </motion.div>

            {/* Top Posts */}
            {idea.top_posts && idea.top_posts.length > 0 && (
                <motion.div className="bento-cell p-6 rounded-2xl mb-6"
                    initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                    <h2 className="text-[14px] font-bold text-white mb-4">
                        Top Posts
                    </h2>
                    <div className="flex flex-col gap-2.5">
                        {idea.top_posts.map((post, i) => (
                            <a key={i} href={post.url} target="_blank" rel="noopener noreferrer"
                                className="flex justify-between items-center p-3.5 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-inherit transition-colors hover:bg-white/5 hover:border-white/10 group"
                            >
                                <div className="flex-1 min-w-0 pr-4">
                                    <div className="text-[13px] text-white/90 mb-1 font-medium truncate group-hover:text-primary transition-colors">
                                        {decodeHtml(post.title)}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground/80">
                                        {decodeHtml(post.source)}{post.subreddit ? ` | r/${decodeHtml(post.subreddit)}` : ""}
                                    </div>
                                </div>
                                <div className="flex gap-3 md:gap-4 items-center text-[11px] text-muted-foreground flex-shrink-0">
                                    <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded">↑{post.score}</span>
                                    <span className="font-mono bg-white/5 px-1.5 py-0.5 rounded">💬{post.comments}</span>
                                    <ExternalLink className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 group-hover:text-primary transition-colors" />
                                </div>
                            </a>
                        ))}
                    </div>
                </motion.div>
            )}

            {/* Keywords */}
            {idea.keywords && idea.keywords.length > 0 && (
                <motion.div className="bento-cell p-6 rounded-2xl mb-6"
                    initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                    <h2 className="text-[14px] font-bold text-white mb-4">
                        Keywords
                    </h2>
                    <div className="flex gap-2 flex-wrap">
                        {idea.keywords.map((kw) => (
                            <span key={kw} className="text-[12px] px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 font-medium">
                                {decodeHtml(kw)}
                            </span>
                        ))}
                    </div>
                </motion.div>
            )}
        </div>
    );
}
