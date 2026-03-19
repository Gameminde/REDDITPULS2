"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
    Activity,
    BellRing,
    Bookmark,
    ExternalLink,
    FileText,
    Radar,
    RefreshCw,
    Shield,
    Trash2,
    TrendingUp,
} from "lucide-react";
import { PremiumGate } from "@/app/components/premium-gate";
import { StaggerContainer, StaggerItem } from "@/app/components/motion";
import { useUserPlan } from "@/lib/use-user-plan";

type MonitorType = "opportunity" | "validation" | "pain_theme";

interface MonitorEvent {
    id: string;
    monitor_id: string;
    event_type: "score_change" | "confidence_change" | "pain_match" | "competitor_weakness" | "memory_change";
    direction: "up" | "down" | "new" | "neutral";
    impact_level: "HIGH" | "MEDIUM" | "LOW";
    summary: string;
    observed_at: string | null;
    href: string;
    source_label: string;
    seen?: boolean;
}

interface MonitorItem {
    id: string;
    legacy_type: "watchlist" | "alert";
    legacy_id: string;
    monitor_type: MonitorType;
    title: string;
    subtitle: string;
    summary: string;
    created_at: string;
    last_checked_at: string | null;
    last_changed_at: string | null;
    status: "active" | "quiet";
    trust: {
        level: "HIGH" | "MEDIUM" | "LOW";
        label: string;
        score: number;
        evidence_count: number;
        direct_evidence_count: number;
        source_count: number;
        freshness_label: string;
        weak_signal: boolean;
        weak_signal_reasons: string[];
    };
    target_href: string;
    tags: string[];
    metrics: Array<{ label: string; value: string; tone?: "build" | "risky" | "dont" | "default" }>;
    recent_events: MonitorEvent[];
    unread_count: number;
    strategy?: {
        posture: string;
        posture_rationale: string;
        strongest_reason: string;
        strongest_caution: string;
        readiness_score: number;
        why_now_category: string;
        why_now_momentum?: string;
        next_move_summary: string;
        next_move_recommended_action?: string;
        anti_idea_verdict?: string;
        anti_idea_summary?: string;
    } | null;
    memory?: {
        previous_state_summary: string;
        current_state_summary: string;
        delta_summary: string;
        direction: "strengthening" | "weakening" | "steady" | "new";
        new_evidence_note: string | null;
        confidence_change: string | null;
        timing_change_note: string | null;
        weakness_change_note: string | null;
        previous_productization_posture?: string | null;
        current_productization_posture?: string | null;
        readiness_score_change?: string | null;
        next_move_change_note?: string | null;
        anti_idea_change_note?: string | null;
    } | null;
}

type SortMode = "recent" | "activity" | "trust";

function timeAgo(value?: string | null) {
    if (!value) return "unknown";
    const diff = Date.now() - new Date(value).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "just now";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function trustTone(level?: "HIGH" | "MEDIUM" | "LOW") {
    if (level === "HIGH") return "border-build/20 bg-build/10 text-build";
    if (level === "MEDIUM") return "border-risky/20 bg-risky/10 text-risky";
    return "border-dont/20 bg-dont/10 text-dont";
}

function metricTone(tone?: "build" | "risky" | "dont" | "default") {
    if (tone === "build") return "text-build";
    if (tone === "risky") return "text-risky";
    if (tone === "dont") return "text-dont";
    return "text-foreground";
}

function typeMeta(type: MonitorType) {
    if (type === "validation") {
        return { label: "Validation", icon: FileText };
    }
    if (type === "pain_theme") {
        return { label: "Pain Theme", icon: BellRing };
    }
    return { label: "Opportunity", icon: TrendingUp };
}

function eventAccent(event: MonitorEvent) {
    if (event.event_type === "pain_match") return "text-primary";
    if (event.direction === "up") return "text-build";
    if (event.direction === "down") return "text-dont";
    return "text-muted-foreground";
}

function postureTone(posture?: string) {
    if (!posture) return "border-white/10 bg-white/5 text-muted-foreground";
    if (/productize now/i.test(posture)) return "border-build/20 bg-build/10 text-build";
    if (/hybrid/i.test(posture)) return "border-primary/20 bg-primary/10 text-primary";
    if (/service-first|concierge/i.test(posture)) return "border-risky/20 bg-risky/10 text-risky";
    return "border-dont/20 bg-dont/10 text-dont";
}

export default function SavedPage() {
    const { isPremium } = useUserPlan();
    const [monitors, setMonitors] = useState<MonitorItem[]>([]);
    const [recentEvents, setRecentEvents] = useState<MonitorEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sort, setSort] = useState<SortMode>("recent");
    const [removing, setRemoving] = useState<string | null>(null);

    useEffect(() => {
        if (!isPremium) return;
        fetch("/api/monitors", { cache: "no-store" })
            .then((res) => res.json())
            .then((data) => {
                setMonitors(data.monitors || []);
                setRecentEvents(data.recent_events || []);
                setError(null);
            })
            .catch((err) => {
                console.error("Failed to load monitors:", err);
                setError("Could not load monitors right now.");
            })
            .finally(() => setLoading(false));
    }, [isPremium]);

    const sortedMonitors = useMemo(() => {
        const items = [...monitors];
        items.sort((a, b) => {
            if (sort === "trust") return (b.trust?.score || 0) - (a.trust?.score || 0);
            if (sort === "activity") return (b.unread_count || 0) - (a.unread_count || 0);
            return new Date(b.last_changed_at || b.created_at).getTime() - new Date(a.last_changed_at || a.created_at).getTime();
        });
        return items;
    }, [monitors, sort]);

    const summary = useMemo(() => {
        const validationCount = monitors.filter((monitor) => monitor.monitor_type === "validation").length;
        const painCount = monitors.filter((monitor) => monitor.monitor_type === "pain_theme").length;
        const activeCount = monitors.filter((monitor) => monitor.status === "active").length;
        return {
            total: monitors.length,
            active: activeCount,
            validation: validationCount,
            pain: painCount,
        };
    }, [monitors]);

    const handleRemove = async (monitor: MonitorItem) => {
        setRemoving(monitor.id);
        try {
            const response = await fetch("/api/monitors", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    legacy_type: monitor.legacy_type,
                    legacy_id: monitor.legacy_id,
                }),
            });
            if (!response.ok) {
                throw new Error(`Failed with ${response.status}`);
            }
            setMonitors((prev) => prev.filter((item) => item.id !== monitor.id));
            setRecentEvents((prev) => prev.filter((event) => event.monitor_id !== monitor.id));
        } catch (err) {
            console.error("Failed to remove monitor:", err);
            setError("Could not update this monitor right now.");
        } finally {
            setRemoving(null);
        }
    };

    if (!isPremium) return <PremiumGate feature="Recurring Monitors" />;

    return (
        <div className="max-w-6xl mx-auto p-6 md:p-8">
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h1 className="text-[22px] font-bold font-display text-white flex items-center gap-2">
                            <Radar className="w-5 h-5 text-primary" /> Monitors
                        </h1>
                        <p className="text-[13px] text-muted-foreground mt-1">
                            Track opportunity movement, validation confidence, and live pain signals in one recurring workflow.
                        </p>
                    </div>

                    <select
                        value={sort}
                        onChange={(event) => setSort(event.target.value as SortMode)}
                        className="bg-surface-0 border border-white/10 rounded-lg px-3 py-2 text-xs text-foreground font-mono"
                    >
                        <option value="recent">Recently Changed</option>
                        <option value="activity">Most Activity</option>
                        <option value="trust">Highest Trust</option>
                    </select>
                </div>
            </motion.div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="bento-cell rounded-2xl p-4">
                    <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Total monitors</div>
                    <div className="mt-2 text-2xl font-mono text-white">{summary.total}</div>
                </div>
                <div className="bento-cell rounded-2xl p-4">
                    <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Active changes</div>
                    <div className="mt-2 text-2xl font-mono text-primary">{summary.active}</div>
                </div>
                <div className="bento-cell rounded-2xl p-4">
                    <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Validations</div>
                    <div className="mt-2 text-2xl font-mono text-white">{summary.validation}</div>
                </div>
                <div className="bento-cell rounded-2xl p-4">
                    <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Pain themes</div>
                    <div className="mt-2 text-2xl font-mono text-white">{summary.pain}</div>
                </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.6fr]">
                <div className="bento-cell rounded-2xl p-5">
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <div>
                            <h2 className="text-[14px] font-bold text-white">What changed</h2>
                            <p className="text-[12px] text-muted-foreground mt-1">Latest monitor events worth reviewing.</p>
                        </div>
                        <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-primary">
                            {recentEvents.filter((event) => !event.seen).length} unread
                        </span>
                    </div>

                    {loading ? (
                        <div className="space-y-3">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div key={index} className="rounded-xl border border-white/10 bg-white/5 p-4 h-[84px]" />
                            ))}
                        </div>
                    ) : recentEvents.length > 0 ? (
                        <div className="space-y-3">
                            {recentEvents.slice(0, 8).map((event) => (
                                <div key={event.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className={`text-xs font-mono uppercase tracking-[0.12em] ${eventAccent(event)}`}>
                                                {event.event_type.replace(/_/g, " ")}
                                            </div>
                                            <p className="mt-2 text-sm text-white leading-relaxed">{event.summary}</p>
                                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground font-mono">
                                                <span>{event.source_label}</span>
                                                <span>{timeAgo(event.observed_at)}</span>
                                                <span>{event.impact_level} impact</span>
                                            </div>
                                        </div>
                                        <Link href={event.href} className="text-xs font-mono text-primary inline-flex items-center gap-1 whitespace-nowrap">
                                            Open <ExternalLink className="w-3.5 h-3.5" />
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-muted-foreground">
                            No monitor events yet. Save an opportunity or run a validation to start building recurring signals.
                        </div>
                    )}
                </div>

                <div>
                    {error && (
                        <div className="bento-cell rounded-2xl p-4 mb-4 border border-dont/20 bg-dont/5 text-sm text-foreground/85">
                            {error}
                        </div>
                    )}

                    {loading ? (
                        <div className="space-y-4">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div key={index} className="bento-cell rounded-2xl p-5 h-[180px]" />
                            ))}
                        </div>
                    ) : sortedMonitors.length > 0 ? (
                        <StaggerContainer className="space-y-4">
                            {sortedMonitors.map((monitor) => {
                                const meta = typeMeta(monitor.monitor_type);
                                const Icon = meta.icon;
                                return (
                                    <StaggerItem key={monitor.id}>
                                        <div className="bento-cell rounded-2xl p-5 border border-white/8">
                                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2 mb-3">
                                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                                            <Icon className="w-3.5 h-3.5" /> {meta.label}
                                                        </span>
                                                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] ${trustTone(monitor.trust.level)}`}>
                                                            {monitor.trust.label}
                                                        </span>
                                                        <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-primary">
                                                            {monitor.status}
                                                        </span>
                                                        {monitor.unread_count > 0 && (
                                                            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-white">
                                                                {monitor.unread_count} updates
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex items-start gap-3">
                                                        <div className="mt-1 rounded-lg bg-primary/10 p-2 text-primary">
                                                            <Icon className="w-4 h-4" />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <h3 className="text-[16px] font-bold text-white leading-tight">{monitor.title}</h3>
                                                            <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-muted-foreground font-mono">{monitor.subtitle}</p>
                                                            <p className="mt-3 text-sm text-white/85 leading-relaxed">{monitor.summary}</p>
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 flex flex-wrap gap-2">
                                                        {monitor.tags.slice(0, 5).map((tag) => (
                                                            <span key={tag} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-mono text-muted-foreground">
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </div>

                                                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                                                        {monitor.metrics.map((metric) => (
                                                            <div key={metric.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                                                                <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">{metric.label}</div>
                                                                <div className={`mt-2 text-lg font-mono ${metricTone(metric.tone)}`}>{metric.value}</div>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    {monitor.monitor_type === "opportunity" && monitor.strategy && (
                                                        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                                                    Opportunity strategy
                                                                </span>
                                                                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] ${postureTone(monitor.strategy.posture)}`}>
                                                                    {monitor.strategy.posture}
                                                                </span>
                                                                <span className="text-[11px] font-mono text-foreground">
                                                                    {monitor.strategy.readiness_score}/100 readiness
                                                                </span>
                                                            </div>
                                                            <p className="mt-3 text-sm text-white/90 leading-relaxed">
                                                                {monitor.strategy.posture_rationale}
                                                            </p>
                                                            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                                                                <div>
                                                                    <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Why now</div>
                                                                    <p className="mt-1 text-xs text-foreground/80">
                                                                        {monitor.strategy.why_now_category}
                                                                        {monitor.strategy.why_now_momentum ? ` • ${monitor.strategy.why_now_momentum}` : ""}
                                                                    </p>
                                                                </div>
                                                                <div>
                                                                    <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Next move</div>
                                                                    <p className="mt-1 text-xs text-foreground/80">
                                                                        {monitor.strategy.next_move_summary}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {monitor.trust.weak_signal && monitor.trust.weak_signal_reasons.length > 0 && (
                                                        <p className="mt-4 text-xs text-risky">
                                                            Weak signal: {monitor.trust.weak_signal_reasons.join(" • ")}
                                                        </p>
                                                    )}

                                                    {monitor.memory && (
                                                        <div className="mt-4 rounded-xl border border-primary/15 bg-primary/5 p-4">
                                                            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-primary">
                                                                <RefreshCw className="w-3.5 h-3.5" /> Since last check
                                                            </div>
                                                            <p className="mt-3 text-sm text-white/90">{monitor.memory.delta_summary}</p>
                                                            <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-mono text-muted-foreground">
                                                                {monitor.memory.previous_productization_posture || monitor.memory.current_productization_posture ? (
                                                                    <span>
                                                                        Posture: {monitor.memory.previous_productization_posture || "unknown"} → {monitor.memory.current_productization_posture || "unknown"}
                                                                    </span>
                                                                ) : null}
                                                                {monitor.memory.readiness_score_change ? <span>{monitor.memory.readiness_score_change}</span> : null}
                                                                {monitor.memory.next_move_change_note ? <span>{monitor.memory.next_move_change_note}</span> : null}
                                                                {monitor.memory.anti_idea_change_note ? <span>{monitor.memory.anti_idea_change_note}</span> : null}
                                                                {monitor.memory.confidence_change ? <span>{monitor.memory.confidence_change}</span> : null}
                                                                {monitor.memory.timing_change_note ? <span>{monitor.memory.timing_change_note}</span> : null}
                                                                {monitor.memory.weakness_change_note ? <span>{monitor.memory.weakness_change_note}</span> : null}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {monitor.recent_events.length > 0 && (
                                                        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
                                                            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                                                <Activity className="w-3.5 h-3.5" /> Recent changes
                                                            </div>
                                                            <div className="mt-3 space-y-2">
                                                                {monitor.recent_events.slice(0, 3).map((event) => (
                                                                    <div key={event.id} className="flex flex-col gap-1 text-sm text-white/85">
                                                                        <span>{event.summary}</span>
                                                                        <span className="text-[11px] font-mono text-muted-foreground">
                                                                            {event.source_label} • {timeAgo(event.observed_at)}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex flex-col sm:flex-row lg:flex-col gap-2 lg:min-w-[190px]">
                                                    <Link
                                                        href={monitor.target_href}
                                                        className="px-4 py-2 rounded-lg text-xs font-mono text-center bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors inline-flex items-center justify-center gap-2"
                                                    >
                                                        <Shield className="w-3.5 h-3.5" /> Open Monitor
                                                    </Link>
                                                    <button
                                                        onClick={() => handleRemove(monitor)}
                                                        disabled={removing === monitor.id}
                                                        className="px-4 py-2 rounded-lg text-xs font-mono text-center bg-dont/10 border border-dont/20 text-dont hover:bg-dont/15 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                                                    >
                                                        {monitor.legacy_type === "alert" ? <BellRing className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                                                        {monitor.legacy_type === "alert" ? "Pause" : "Remove"}
                                                    </button>
                                                    <div className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] font-mono text-muted-foreground text-center">
                                                        Checked {timeAgo(monitor.last_checked_at || monitor.created_at)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </StaggerItem>
                                );
                            })}
                        </StaggerContainer>
                    ) : (
                        <div className="bento-cell rounded-2xl p-10 text-center">
                            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-muted-foreground">
                                <Bookmark className="w-5 h-5" />
                            </div>
                            <h2 className="text-white font-semibold">No monitors yet</h2>
                            <p className="mt-2 text-sm text-muted-foreground">
                                Save an opportunity, validate an idea, or create a pain alert to start a recurring market-monitoring workflow.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <div className="mt-8 text-xs text-muted-foreground font-mono">
                Monitors are built from your saved opportunities, validations, and live pain alerts. This is the first step toward a full recurring market memory system.
            </div>
        </div>
    );
}
