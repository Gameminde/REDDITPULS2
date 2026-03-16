"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Bookmark, ChevronUp, ChevronDown, Minus, RefreshCw, Trash2, AlertCircle } from "lucide-react";
import { PremiumGate } from "@/app/components/premium-gate";
import { GlowBadge, StaggerContainer, StaggerItem } from "@/app/components/motion";
import { useUserPlan } from "@/lib/use-user-plan";

interface ValidationRow {
    id: string;
    idea_text: string;
    verdict: string;
    confidence: number;
    status: string;
    created_at: string;
    completed_at?: string | null;
    report?: Record<string, unknown> | string | null;
}

interface IdeaRow {
    id: string;
    topic: string;
    slug: string;
    current_score: number;
    change_24h: number;
    trend_direction: string;
    confidence_level: string;
    category: string;
}

interface WatchlistItem {
    id: string;
    idea_id?: string | null;
    validation_id?: string | null;
    added_at: string;
    notes?: string | null;
    alert_threshold?: number | null;
    ideas?: IdeaRow | null;
    idea_validations?: ValidationRow | null;
}

type SortMode = "recent" | "confidence" | "changed";

function parseReport(report: ValidationRow["report"]) {
    if (!report) return {};
    if (typeof report === "string") {
        try {
            return JSON.parse(report) as Record<string, unknown>;
        } catch {
            return {};
        }
    }
    return report;
}

function verdictColor(verdict: string) {
    const upper = (verdict || "").toUpperCase();
    if (upper.includes("BUILD")) return "emerald";
    if (upper.includes("DON")) return "red";
    return "amber";
}

function formatDaysAgo(value?: string | null) {
    if (!value) return "unknown";
    const diff = Date.now() - new Date(value).getTime();
    return `${Math.max(0, Math.floor(diff / 86400000))}d ago`;
}

export default function SavedPage() {
    const { isPremium } = useUserPlan();
    const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [removing, setRemoving] = useState<string | null>(null);
    const [sort, setSort] = useState<SortMode>("recent");

    useEffect(() => {
        if (!isPremium) return;
        fetch("/api/watchlist")
            .then((res) => res.json())
            .then((data) => setWatchlist(data.watchlist || []))
            .catch((err) => console.error("Failed to load watchlist:", err))
            .finally(() => setLoading(false));
    }, [isPremium]);

    const handleRemove = async (item: WatchlistItem) => {
        setRemoving(item.id);
        try {
            await fetch("/api/watchlist", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    idea_id: item.idea_id || null,
                    validation_id: item.validation_id || null,
                }),
            });
            setWatchlist((prev) => prev.filter((row) => row.id !== item.id));
        } catch (err) {
            console.error("Failed to remove watchlist item:", err);
        } finally {
            setRemoving(null);
        }
    };

    const sortedItems = useMemo(() => {
        const items = [...watchlist];
        items.sort((a, b) => {
            const aValidation = a.idea_validations;
            const bValidation = b.idea_validations;
            const aReport = parseReport(aValidation?.report);
            const bReport = parseReport(bValidation?.report);
            const aPulse = typeof aReport.market_pulse === "object" && aReport.market_pulse ? aReport.market_pulse as Record<string, unknown> : {};
            const bPulse = typeof bReport.market_pulse === "object" && bReport.market_pulse ? bReport.market_pulse as Record<string, unknown> : {};
            const aCurrent = Number(aValidation?.confidence || aReport.confidence || 0);
            const bCurrent = Number(bValidation?.confidence || bReport.confidence || 0);
            const aDelta = Math.abs(Number(aPulse.delta || 0));
            const bDelta = Math.abs(Number(bPulse.delta || 0));

            if (sort === "confidence") return bCurrent - aCurrent;
            if (sort === "changed") return bDelta - aDelta;
            return new Date(b.added_at).getTime() - new Date(a.added_at).getTime();
        });
        return items;
    }, [sort, watchlist]);

    if (!isPremium) return <PremiumGate feature="Saved Watchlist" />;

    return (
        <div className="max-w-5xl mx-auto p-6 md:p-8">
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                        <h1 className="text-[20px] font-bold font-display text-white flex items-center gap-2">
                            <Bookmark className="w-5 h-5 text-primary" /> Idea Watchlist
                        </h1>
                        <p className="text-[13px] text-muted-foreground mt-1">
                            Track validations like a portfolio and spot confidence shifts over time
                        </p>
                    </div>

                    <select
                        value={sort}
                        onChange={(event) => setSort(event.target.value as SortMode)}
                        className="bg-surface-0 border border-white/10 rounded-lg px-3 py-2 text-xs text-foreground font-mono"
                    >
                        <option value="recent">Recently Added</option>
                        <option value="confidence">Highest Confidence</option>
                        <option value="changed">Most Changed</option>
                    </select>
                </div>
            </motion.div>

            {loading ? (
                <div className="mt-6 flex flex-col gap-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                        <div key={index} className="bento-cell p-5 rounded-2xl h-[140px]" />
                    ))}
                </div>
            ) : sortedItems.length > 0 ? (
                <StaggerContainer className="flex flex-col gap-4 mt-6">
                    {sortedItems.map((item) => {
                        const validation = item.idea_validations;
                        if (validation) {
                            const report = parseReport(validation.report);
                            const marketPulse = typeof report.market_pulse === "object" && report.market_pulse ? report.market_pulse as Record<string, unknown> : {};
                            const currentConfidence = Number(validation.confidence || report.confidence || 0);
                            const confidenceDelta = Number(marketPulse.delta || 0);
                            const pulseUpdatedAt = typeof marketPulse.last_updated_at === "string" ? marketPulse.last_updated_at : null;
                            const hasMeaningfulShift = Boolean(pulseUpdatedAt) && Math.abs(confidenceDelta) > 5;
                            const keywords = Array.isArray(report.keywords) ? report.keywords.slice(0, 3) : [];

                            return (
                                <StaggerItem key={item.id}>
                                    <div className="bento-cell p-5 rounded-2xl border border-white/8">
                                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex flex-wrap items-center gap-2 mb-3">
                                                    <GlowBadge color={verdictColor(validation.verdict)}>
                                                        {validation.verdict || "Tracked"}
                                                    </GlowBadge>
                                                    <span className="font-mono text-lg text-white">{currentConfidence}%</span>
                                                    {pulseUpdatedAt ? (
                                                        <span className={`font-mono text-xs flex items-center gap-1 ${confidenceDelta > 0 ? "text-build" : confidenceDelta < 0 ? "text-dont" : "text-muted-foreground"}`}>
                                                            {confidenceDelta > 0 ? <ChevronUp className="w-3 h-3" /> : confidenceDelta < 0 ? <ChevronDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                                                            {confidenceDelta > 0 ? "+" : ""}{confidenceDelta.toFixed(0)}%
                                                        </span>
                                                    ) : (
                                                        <span className="font-mono text-xs text-muted-foreground">No live pulse yet</span>
                                                    )}
                                                    {hasMeaningfulShift && (
                                                        <span className="text-[10px] font-mono px-2 py-1 rounded bg-primary/10 border border-primary/20 text-primary uppercase tracking-wider">
                                                            Score Changed
                                                        </span>
                                                    )}
                                                </div>

                                                <p className="text-[15px] font-medium text-white leading-relaxed line-clamp-2">
                                                    {validation.idea_text}
                                                </p>

                                                <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-muted-foreground font-mono">
                                                    <span>Validated {formatDaysAgo(validation.created_at)}</span>
                                                    <span>Saved {formatDaysAgo(item.added_at)}</span>
                                                    <span>Status: {validation.status}</span>
                                                    {pulseUpdatedAt && <span>Pulse {formatDaysAgo(pulseUpdatedAt)}</span>}
                                                </div>

                                                {keywords.length > 0 && (
                                                    <div className="flex flex-wrap gap-2 mt-4">
                                                        {keywords.map((keyword: unknown) => (
                                                            <span key={String(keyword)} className="text-[10px] font-mono px-2 py-1 rounded border border-white/10 bg-white/5 text-muted-foreground">
                                                                {String(keyword)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex flex-col sm:flex-row gap-2 lg:min-w-[260px] lg:justify-end">
                                                <Link
                                                    href={`/dashboard/reports/${validation.id}`}
                                                    className="px-4 py-2 rounded-lg text-xs font-mono text-center bg-white/5 border border-white/10 text-foreground hover:bg-white/10 transition-colors"
                                                >
                                                    Open Report
                                                </Link>
                                                <Link
                                                    href={`/dashboard/validate?idea=${encodeURIComponent(validation.idea_text)}`}
                                                    className="px-4 py-2 rounded-lg text-xs font-mono text-center bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors inline-flex items-center justify-center gap-2"
                                                >
                                                    <RefreshCw className="w-3.5 h-3.5" /> Re-validate
                                                </Link>
                                                <button
                                                    onClick={() => handleRemove(item)}
                                                    disabled={removing === item.id}
                                                    className="px-4 py-2 rounded-lg text-xs font-mono text-center bg-dont/10 border border-dont/20 text-dont hover:bg-dont/15 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" /> Remove
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </StaggerItem>
                            );
                        }

                        const idea = item.ideas;
                        if (!idea) return null;

                        return (
                            <StaggerItem key={item.id}>
                                <div className="bento-cell p-5 rounded-2xl border border-white/8">
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                                <GlowBadge color={idea.current_score >= 65 ? "emerald" : idea.current_score >= 35 ? "amber" : "red"}>
                                                    {idea.current_score >= 65 ? "Build It" : idea.current_score >= 35 ? "Risky" : "Don't Build"}
                                                </GlowBadge>
                                                <span className="font-mono text-lg text-white">{Math.round(idea.current_score)}</span>
                                                <span className={`font-mono text-xs ${idea.change_24h >= 0 ? "text-build" : "text-dont"}`}>
                                                    {idea.change_24h >= 0 ? "+" : ""}{idea.change_24h.toFixed(1)} 24h
                                                </span>
                                            </div>
                                            <p className="text-[15px] font-medium text-white leading-relaxed">{idea.topic}</p>
                                            <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-muted-foreground font-mono">
                                                <span>{idea.category}</span>
                                                <span>{idea.confidence_level}</span>
                                                <span>{idea.trend_direction}</span>
                                            </div>
                                        </div>

                                        <div className="flex flex-col sm:flex-row gap-2 lg:min-w-[220px] lg:justify-end">
                                            <Link
                                                href={`/dashboard/idea/${idea.slug}`}
                                                className="px-4 py-2 rounded-lg text-xs font-mono text-center bg-white/5 border border-white/10 text-foreground hover:bg-white/10 transition-colors"
                                            >
                                                Open Idea
                                            </Link>
                                            <button
                                                onClick={() => handleRemove(item)}
                                                disabled={removing === item.id}
                                                className="px-4 py-2 rounded-lg text-xs font-mono text-center bg-dont/10 border border-dont/20 text-dont hover:bg-dont/15 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" /> Remove
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </StaggerItem>
                        );
                    })}
                </StaggerContainer>
            ) : (
                <div className="bento-cell p-12 text-center rounded-2xl mt-6 flex flex-col items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-muted-foreground/30 mb-3" />
                    <p className="text-[14px] font-medium text-muted-foreground/80 mb-1">No watchlist items yet</p>
                    <p className="text-[12px] text-muted-foreground/60">
                        Save validations to track your idea portfolio.
                    </p>
                </div>
            )}
        </div>
    );
}
