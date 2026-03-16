"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Flame, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase-browser";

interface TrendSignal {
    id: string;
    keyword: string;
    tier: "EXPLODING" | "GROWING" | "STABLE" | "DECLINING" | "DEAD";
    post_count_24h: number;
    post_count_7d: number;
    change_24h: number;
    change_7d: number;
    sentiment_score: number;
    velocity: number;
    top_posts: Array<{ title: string; score?: number }>;
}

interface PlatformWarning {
    platform: string;
    issue: string;
    status?: string;
    error_code?: string | null;
    error_detail?: string | null;
}

const trendConfig: Record<string, { color: string; badge: string }> = {
    EXPLODING: { color: "text-primary", badge: "bg-primary/10 text-primary border-primary/25" },
    GROWING: { color: "text-build", badge: "bg-build/10 text-build border-build/20" },
    STABLE: { color: "text-risky", badge: "bg-risky/10 text-risky border-risky/20" },
    DECLINING: { color: "text-orange-400", badge: "bg-orange-400/10 text-orange-400 border-orange-400/20" },
    DEAD: { color: "text-dont", badge: "bg-dont/10 text-dont border-dont/20" },
};

function LoadingSkeleton() {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-24">
            {[0, 1, 2].map((index) => (
                <div
                    key={index}
                    className="bento-cell p-5 bg-[linear-gradient(90deg,rgba(255,255,255,0.03),rgba(255,255,255,0.08),rgba(255,255,255,0.03))] bg-[length:200%_100%] animate-shimmer"
                >
                    <div className="h-4 w-32 rounded bg-white/10 mb-4" />
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="h-12 rounded bg-white/10" />
                        <div className="h-12 rounded bg-white/10" />
                        <div className="h-10 rounded bg-white/10" />
                        <div className="h-10 rounded bg-white/10" />
                    </div>
                    <div className="h-14 rounded bg-white/10" />
                </div>
            ))}
        </div>
    );
}

export default function TrendsPage() {
    const supabase = useMemo(() => createClient(), []);
    const [trends, setTrends] = useState<TrendSignal[]>([]);
    const [platformWarnings, setPlatformWarnings] = useState<PlatformWarning[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadTrends = useCallback(async () => {
        try {
            const response = await fetch("/api/trend-signals", { cache: "no-store" });
            if (!response.ok) {
                throw new Error(`trend fetch failed with ${response.status}`);
            }
            const payload = await response.json();
            if (payload.error) {
                throw new Error(payload.error);
            }
            setTrends(payload.trends || []);
            setPlatformWarnings(payload.platform_warnings || []);
            setError(null);
        } catch {
            setTrends([]);
            setPlatformWarnings([]);
            setError("Could not load trends — check connection and retry");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadTrends();

        const channel = supabase
            .channel("trend-signals")
            .on("postgres_changes", {
                event: "*",
                schema: "public",
                table: "trend_signals",
            }, (payload: any) => {
                const nextRow = payload.new as TrendSignal;
                setTrends((prev) => {
                    if (!nextRow?.keyword) {
                        return prev;
                    }
                    const index = prev.findIndex((item) => item.keyword === nextRow.keyword);
                    if (index >= 0) {
                        const updated = [...prev];
                        updated[index] = nextRow;
                        return updated;
                    }
                    return [nextRow, ...prev].slice(0, 50);
                });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [loadTrends, supabase]);

    return (
        <div className="max-w-6xl mx-auto pt-8 px-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <h1 className="text-[32px] font-bold font-display tracking-tight-custom text-white">Market Trends</h1>
                <p className="text-muted-foreground mt-1 text-sm font-mono">Live keyword momentum from trend_signals</p>
            </motion.div>

            {platformWarnings.length > 0 && (
                <div className="mb-4 rounded-2xl border border-risky/20 bg-risky/8 p-4">
                    <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-risky mb-2">Source Coverage Warning</div>
                    <div className="space-y-2">
                        {platformWarnings.map((warning, index) => (
                            <p key={`${warning.platform}-${index}`} className="text-sm text-foreground/85">
                                {warning.issue}
                            </p>
                        ))}
                    </div>
                </div>
            )}

            {loading ? (
                <LoadingSkeleton />
            ) : error ? (
                <div className="bento-cell p-12 text-center rounded-2xl mt-6 flex flex-col items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-dont mb-3" />
                    <p className="text-[14px] font-medium text-foreground mb-2">{error}</p>
                    <button
                        onClick={() => {
                            setLoading(true);
                            setError(null);
                            loadTrends();
                        }}
                        className="mt-3 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] font-mono text-foreground hover:bg-white/10"
                    >
                        Retry
                    </button>
                </div>
            ) : trends.length === 0 ? (
                <div className="bento-cell p-12 text-center rounded-2xl mt-6 flex flex-col items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-muted-foreground/30 mb-3" />
                    <p className="text-[14px] font-medium text-muted-foreground/80 mb-1">No trends yet</p>
                    <p className="text-[12px] text-muted-foreground/60">No trends yet — scraper runs every 4 hours.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-24">
                    {trends.map((trend, index) => {
                        const cfg = trendConfig[trend.tier] || trendConfig.STABLE;
                        return (
                            <motion.div
                                key={trend.id || trend.keyword}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.03 }}
                                className="bento-cell p-5"
                            >
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <h3 className="text-sm font-medium text-white">{trend.keyword}</h3>
                                    <span className={`inline-flex items-center gap-1 text-[11px] font-bold tracking-wider px-2.5 py-1 rounded-md border ${cfg.badge}`}>
                                        {trend.tier === "EXPLODING" && <Flame className="w-3 h-3" />}
                                        {trend.tier}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-3 mb-3">
                                    <div>
                                        <div className="text-[11px] font-mono text-muted-foreground uppercase">24h Change</div>
                                        <div className={`text-lg font-mono font-bold ${cfg.color}`}>{trend.change_24h >= 0 ? "+" : ""}{trend.change_24h}%</div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] font-mono text-muted-foreground uppercase">Velocity</div>
                                        <div className="text-lg font-mono font-bold text-white">{trend.velocity}x</div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] font-mono text-muted-foreground uppercase">Posts 24h</div>
                                        <div className="text-sm font-mono text-white">{trend.post_count_24h}</div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] font-mono text-muted-foreground uppercase">Posts 7d</div>
                                        <div className="text-sm font-mono text-white">{trend.post_count_7d}</div>
                                    </div>
                                </div>
                                {Array.isArray(trend.top_posts) && trend.top_posts.length > 0 && (
                                    <div className="border-t border-white/10 pt-3">
                                        <div className="text-[11px] font-mono text-muted-foreground uppercase mb-2">Top Signal</div>
                                        <p className="text-xs text-white/80 leading-relaxed">
                                            {trend.top_posts[0]?.title || "No top post available"}
                                        </p>
                                    </div>
                                )}
                            </motion.div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
