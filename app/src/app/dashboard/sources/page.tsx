"use client";

import React, { useState, useEffect, useCallback } from "react";
import { PremiumGate } from "@/app/components/premium-gate";
import { motion } from "framer-motion";
import { GlassCard, GlowBadge, StaggerContainer, StaggerItem, AnimatedCounter } from "@/app/components/motion";
import { Globe, CheckCircle2, AlertCircle, Cpu, Database } from "lucide-react";
import { useUserPlan } from "@/lib/use-user-plan";

interface SourceItem {
    idea: string;
    validation_id: string;
    created_at: string;
    data_sources: Record<string, number>;
    platforms_used: number;
    models_used: string[];
    debate_mode: boolean;
    evidence: Array<Record<string, unknown>>;
}

const PLATFORM_META: Record<string, { icon: string; color: string }> = {
    reddit: { icon: "🔶", color: "#f97316" },
    hackernews: { icon: "🟧", color: "#f59e0b" },
    producthunt: { icon: "🟣", color: "#a855f7" },
    indiehackers: { icon: "🔵", color: "#3b82f6" },
};

export default function SourcesPage() {
    const { isPremium } = useUserPlan();
    const [sources, setSources] = useState<SourceItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadSources = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/intelligence?section=sources");
            const payload = await response.json();
            if (!response.ok || payload?.error) {
                throw new Error(payload?.error || "Could not load data");
            }
            setSources(payload.data || []);
            setError(null);
        } catch (err) {
            console.error(err);
            setSources([]);
            setError("Could not load data");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isPremium) return;
        loadSources();
    }, [isPremium, loadSources]);

    if (!isPremium) return <PremiumGate feature="Multi-Source Intelligence" />;

    // Aggregate totals across all validations
    const totalPosts = sources.reduce((sum, s) => {
        const ds = s.data_sources || {};
        return sum + Object.values(ds).reduce((a: number, b: unknown) => a + (typeof b === "number" ? b : 0), 0);
    }, 0);
    const totalPlatforms = new Set(sources.flatMap(s => Object.keys(s.data_sources || {}))).size;
    const totalModels = new Set(sources.flatMap(s => s.models_used || [])).size;

    return (
        <div className="max-w-4xl mx-auto p-6 md:p-8">
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <h1 className="text-[20px] font-bold font-display text-white flex items-center gap-2">
                    <Globe className="w-5 h-5 text-primary" /> Sources
                </h1>
                <p className="text-[13px] text-muted-foreground mt-1">Multi-source intelligence pipeline — real data from your validations</p>
            </motion.div>

            {/* Aggregate Stats */}
            <StaggerContainer className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6 mb-6">
                {[
                    { label: "Total Posts Scraped", value: totalPosts, icon: <Database className="w-3.5 h-3.5 text-primary" /> },
                    { label: "Platforms Used", value: totalPlatforms, icon: <Globe className="w-3.5 h-3.5 text-blue-500" /> },
                    { label: "AI Models Used", value: totalModels, icon: <Cpu className="w-3.5 h-3.5 text-purple-500" /> },
                ].map(s => (
                    <StaggerItem key={s.label}>
                        <div className="bento-cell p-5 rounded-2xl">
                            <div className="flex items-center gap-2 mb-2.5">
                                {s.icon}
                                <div className="text-[11px] text-muted-foreground uppercase tracking-widest font-bold">{s.label}</div>
                            </div>
                            <AnimatedCounter value={s.value} />
                        </div>
                    </StaggerItem>
                ))}
            </StaggerContainer>

            {loading ? (
                <div className="flex flex-col gap-2.5">
                    {Array.from({ length: 2 }).map((_, i) => (
                        <div key={i} className="bento-cell p-5 rounded-2xl">
                            <div className="h-3.5 w-[200px] bg-white/5 rounded-[4px] mb-2.5" />
                            <div className="h-[60px] w-full bg-white/[0.03] rounded-lg" />
                        </div>
                    ))}
                </div>
            ) : error ? (
                <div className="bento-cell p-12 text-center rounded-2xl mt-6 flex flex-col items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-dont/70 mb-3" />
                    <p className="text-[14px] font-medium text-foreground mb-1">Could not load data</p>
                    <button
                        onClick={loadSources}
                        className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-foreground hover:bg-white/10"
                    >
                        Retry
                    </button>
                </div>
            ) : sources.length > 0 ? (
                <StaggerContainer className="flex flex-col gap-3">
                    {sources.map(src => {
                        const ds = src.data_sources || {};
                        const platforms = Object.entries(ds);
                        const platformGridClass =
                            platforms.length <= 2
                                ? "grid grid-cols-2 md:grid-cols-2 gap-2.5 mb-4"
                                : platforms.length === 3
                                    ? "grid grid-cols-2 md:grid-cols-3 gap-2.5 mb-4"
                                    : "grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4";

                        return (
                            <StaggerItem key={src.validation_id}>
                                <div className="bento-cell p-6 rounded-2xl hover:bg-white/[0.03] transition-colors">
                                    <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
                                        <h3 className="text-[14px] font-bold text-white font-display flex-1">{src.idea}</h3>
                                        {src.debate_mode && (
                                            <GlowBadge color="amber">
                                                <Cpu className="w-2.5 h-2.5" /> Multi-model debate
                                            </GlowBadge>
                                        )}
                                        <div className="text-[10px] text-muted-foreground font-mono flex-shrink-0">
                                            {new Date(src.created_at).toLocaleDateString()}
                                        </div>
                                    </div>

                                    {/* Platform breakdown */}
                                    <div className={platformGridClass}>
                                        {platforms.map(([platform, count]) => {
                                            const meta = PLATFORM_META[platform] || { icon: "📊", color: "#64748b" };
                                            return (
                                                <div key={platform} className="bg-white/[0.02] rounded-xl p-3.5 md:p-4 border border-white/5">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className="text-[16px] leading-none">{meta.icon}</span>
                                                        <span className="text-[12px] font-bold text-white capitalize">{platform}</span>
                                                    </div>
                                                    <div style={{ color: meta.color }} className="text-[20px] font-extrabold font-display leading-none mb-1">
                                                        {typeof count === "number" ? count : 0}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground leading-none">posts scraped</div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* AI Models used */}
                                    {src.models_used && src.models_used.length > 0 && (
                                        <div className="flex gap-1.5 flex-wrap">
                                            {src.models_used.map((m, i) => (
                                                <span key={i} className="text-[10px] px-2 py-1 rounded bg-purple-500/10 text-purple-400 font-mono border border-purple-500/20">
                                                    {m}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </StaggerItem>
                        );
                    })}
                </StaggerContainer>
            ) : (
                <div className="bento-cell p-12 text-center rounded-2xl mt-6 flex flex-col items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-muted-foreground/30 mb-3" />
                    <p className="text-[14px] font-medium text-muted-foreground/80 mb-1">No source data yet</p>
                    <p className="text-[12px] text-muted-foreground/60">Run an idea validation to see which platforms and AI models were used.</p>
                </div>
            )}
        </div>
    );
}
