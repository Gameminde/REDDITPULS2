"use client";

import React, { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, AlertCircle, ExternalLink, Search } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";

/**
 * Matches REAL `ideas` table from schema_stock_market.sql.
 * Every field here exists in the live Supabase DB.
 */
interface IdeaRow {
    id: string;
    topic: string;
    slug: string;
    current_score: number;
    change_24h: number;
    change_7d: number;
    change_30d: number;
    trend_direction: string;
    confidence_level: string;
    post_count_total: number;
    post_count_7d: number;
    source_count: number;
    sources: Array<{ platform: string; count: number }>;
    category: string;
    competition_data: Record<string, unknown> | null;
    icp_data: Record<string, unknown> | null;
    top_posts: Array<{ title: string; subreddit?: string; score?: number; permalink?: string }>;
    keywords: string[];
    first_seen: string;
    last_updated: string;
}

const verdictConfig: Record<string, { className: string; arrow: string }> = {
    "BUILD IT": { className: "bg-build/10 text-build border border-build/25", arrow: "▲" },
    "RISKY": { className: "bg-risky/10 text-risky border border-risky/25", arrow: "" },
    "DON'T BUILD": { className: "bg-dont/10 text-dont border border-dont/25", arrow: "▼" },
};

function scoreToVerdict(score: number): string {
    if (score >= 65) return "BUILD IT";
    if (score >= 35) return "RISKY";
    return "DON'T BUILD";
}

function formatTimeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "just now";
    if (hours < 24) return hours + "h ago";
    const days = Math.floor(hours / 24);
    if (days < 7) return days + "d ago";
    return Math.floor(days / 7) + "w ago";
}

export default function ExplorePage() {
    const supabase = useMemo(() => createClient(), []);
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
                const res = await fetch(`/api/ideas?sort=${sortParam}&limit=50`);
                const data = await res.json();
                if (data.ideas) setIdeas(data.ideas);
            } catch (err) {
                console.error("Failed to load ideas:", err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [sort]);

    useEffect(() => {
        const channel = supabase
            .channel("ideas-live")
            .on("postgres_changes", {
                event: "*",
                schema: "public",
                table: "ideas",
            }, (payload: any) => {
                const row = payload.new as IdeaRow;
                if (!row?.id) return;
                setIdeas((prev) => {
                    if (payload.eventType === "INSERT") {
                        return [row, ...prev].slice(0, 100);
                    }
                    if (payload.eventType === "UPDATE") {
                        return prev.map((idea) => idea.id === row.id ? row : idea);
                    }
                    return prev;
                });
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [supabase]);

    // Derive verdict from real score
    const enhancedIdeas = ideas.map(idea => ({
        ...idea,
        verdict: scoreToVerdict(idea.current_score),
    }));

    // Filter by verdict + search
    const filtered = enhancedIdeas
        .filter(idea => filter === "All" || idea.verdict === filter)
        .filter(idea => !searchQuery || idea.topic.toLowerCase().includes(searchQuery.toLowerCase()));

    return (
        <div className="max-w-6xl mx-auto relative z-10 pt-8">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6 px-6">
                <h1 className="text-[32px] font-bold font-display tracking-tight-custom text-white">Explore Ideas</h1>
                <p className="text-muted-foreground mt-1 text-sm font-mono">
                    Live idea market · {ideas.length} tracked opportunities
                </p>
            </motion.div>

            {/* Controls row */}
            <div className="flex items-center gap-3 mb-5 px-6 flex-wrap">
                {/* Filter tabs */}
                <div className="flex gap-1 p-1 rounded-[10px] w-fit" style={{ background: "hsl(0 0% 100% / 0.03)", border: "1px solid hsl(0 0% 100% / 0.07)" }}>
                    {filters.map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-[18px] py-1.5 rounded-[7px] text-[11px] font-medium tracking-wider transition-all ${
                                f === filter
                                    ? "text-primary"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                            style={f === filter ? { background: "hsl(16 100% 50% / 0.12)", border: "1px solid hsl(16 100% 50% / 0.2)" } : { border: "1px solid transparent" }}
                        >
                            {f}
                        </button>
                    ))}
                </div>

                {/* Sort */}
                <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    className="text-[11px] font-mono px-3 py-1.5 rounded-[7px] bg-white/[0.03] border border-white/[0.07] text-foreground outline-none"
                >
                    <option value="score">Top Score</option>
                    <option value="trending">Trending</option>
                    <option value="new">Newest</option>
                </select>

                {/* Search */}
                <div className="relative flex-1 max-w-[240px] ml-auto">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                    <input
                        type="text"
                        placeholder="Search ideas..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full text-[11px] font-mono pl-8 pr-3 py-1.5 rounded-[7px] bg-white/[0.03] border border-white/[0.07] text-foreground outline-none placeholder:text-muted-foreground/40"
                    />
                </div>
            </div>

            {/* Loading state */}
            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[14px] px-6 pb-24">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="bento-cell p-5 rounded-[14px] h-[200px]">
                            <div className="h-4 w-20 bg-white/5 rounded-[4px] mb-3" />
                            <div className="h-3 w-[80%] bg-white/[0.03] rounded-[4px] mb-2" />
                            <div className="h-3 w-[50%] bg-white/[0.03] rounded-[4px]" />
                        </div>
                    ))}
                </div>
            ) : filtered.length > 0 ? (
                /* Card grid — real data only */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[14px] px-6 pb-24">
                    {filtered.map((idea, i) => {
                        const v = verdictConfig[idea.verdict];
                        const scoreColor = idea.current_score >= 70 ? "text-build" : idea.current_score >= 40 ? "text-risky" : "text-dont";

                        return (
                            <motion.div
                                key={idea.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.03 }}
                                className="flip-wrap h-[200px]"
                            >
                                <div className="flip-inner">
                                    {/* Front */}
                                    <div
                                        className="flip-front p-5 flex flex-col gap-2.5 rounded-[14px]"
                                        style={{
                                            background: "hsl(0 0% 100% / 0.025)",
                                            border: "1px solid hsl(0 0% 100% / 0.07)",
                                            backdropFilter: "blur(20px)",
                                        }}
                                    >
                                        <div className="absolute top-0 left-0 right-0 h-px rounded-t-[14px]" style={{ background: "linear-gradient(90deg, transparent, hsl(0 0% 100% / 0.07), transparent)" }} />
                                        <div className="flex items-center gap-2">
                                            <span className={`inline-flex items-center gap-[5px] text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full w-fit font-mono ${v.className}`}>
                                                {v.arrow && <span className="text-[8px]">{v.arrow}</span>}
                                                {idea.verdict}
                                            </span>
                                            <span className={`text-[13px] font-bold font-mono ${scoreColor}`}>
                                                {Math.round(idea.current_score)}
                                            </span>
                                            <span className={`text-[10px] font-mono ml-auto ${idea.change_24h >= 0 ? "text-build" : "text-dont"}`}>
                                                {idea.change_24h >= 0 ? "+" : ""}{idea.change_24h.toFixed(1)} 24h
                                            </span>
                                        </div>
                                        <Link href={`/dashboard/idea/${idea.slug}`}>
                                            <h3 className="text-sm font-medium leading-snug text-foreground flex-1 line-clamp-3 hover:underline cursor-pointer">{idea.topic}</h3>
                                        </Link>
                                        <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground mt-auto">
                                            <span className="capitalize">{idea.category}</span>
                                            <span>{formatTimeAgo(idea.last_updated)}</span>
                                        </div>
                                    </div>

                                    {/* Back */}
                                    <div
                                        className="flip-back p-5 flex flex-col justify-center gap-2 rounded-[14px]"
                                        style={{
                                            background: "hsla(0,0%,4%,0.97)",
                                            border: "1px solid hsl(16 100% 50% / 0.2)",
                                            backdropFilter: "blur(20px)",
                                            boxShadow: "inset 0 0 30px hsla(16,100%,50%,0.04)",
                                        }}
                                    >
                                        {[
                                            { label: "Score", value: Math.round(idea.current_score).toString() },
                                            { label: "Posts", value: idea.post_count_total.toString() },
                                            { label: "Sources", value: idea.source_count.toString() },
                                            { label: "7d Change", value: (idea.change_7d >= 0 ? "+" : "") + idea.change_7d.toFixed(1) },
                                        ].map((stat) => (
                                            <div key={stat.label} className="flex justify-between items-center text-[13px] text-muted-foreground pb-1.5" style={{ borderBottom: "1px solid hsl(0 0% 100% / 0.04)" }}>
                                                <span>{stat.label}</span>
                                                <strong className="text-foreground font-mono">{stat.value}</strong>
                                            </div>
                                        ))}
                                        <div className="flex gap-1.5 mt-1">
                                            <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 capitalize">
                                                {idea.trend_direction}
                                            </span>
                                            <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-white/5 text-muted-foreground border border-white/10">
                                                {idea.confidence_level}
                                            </span>
                                        </div>
                                        <Link
                                            href={`/dashboard/idea/${idea.slug}`}
                                            className="absolute top-4 right-4 text-xs text-primary hover:underline font-mono flex items-center gap-1"
                                        >
                                            <ExternalLink className="w-3 h-3" /> Detail
                                        </Link>
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            ) : (
                <div className="bento-cell p-12 text-center rounded-2xl mx-6 flex flex-col items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-muted-foreground/30 mb-3" />
                    <p className="text-[14px] font-medium text-muted-foreground/80 mb-1">No ideas found</p>
                    <p className="text-[12px] text-muted-foreground/60">
                        {searchQuery ? "Try a different search query." : "The scraper hasn't collected any ideas yet. Run the scraper to populate the feed."}
                    </p>
                </div>
            )}
        </div>
    );
}
