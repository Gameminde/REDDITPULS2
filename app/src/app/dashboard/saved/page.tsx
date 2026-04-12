"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
    BellRing,
    Bookmark,
    ChevronRight,
    Clock3,
    Eye,
    FileText,
    Radio,
    Sparkles,
    Trash2,
} from "lucide-react";
import { PremiumGate } from "@/app/components/premium-gate";
import { StaggerContainer, StaggerItem } from "@/app/components/motion";
import { useUserPlan } from "@/lib/use-user-plan";

type MonitorType = "opportunity" | "validation" | "pain_theme";
type SortMode = "recent" | "attention" | "confidence";
type ViewMode = "review" | "all" | "quiet";
type ChangeState = "stronger" | "weaker" | "new" | "quiet";

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
    legacy_type: "watchlist" | "alert" | "opportunity";
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

function timeAgo(value?: string | null) {
    if (!value) return "unknown";
    const diff = Date.now() - new Date(value).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "just now";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function typeMeta(type: MonitorType) {
    if (type === "validation") {
        return { label: "Validation", icon: FileText };
    }
    if (type === "pain_theme") {
        return { label: "Alert", icon: BellRing };
    }
    return { label: "Opportunity", icon: Sparkles };
}

function getChangeState(monitor: MonitorItem): ChangeState {
    if (monitor.memory?.direction === "new") return "new";
    if (monitor.memory?.direction === "strengthening") return "stronger";
    if (monitor.memory?.direction === "weakening") return "weaker";

    const eventDirections = monitor.recent_events.map((event) => event.direction);
    if (eventDirections.includes("new")) return "new";
    if (eventDirections.includes("up")) return "stronger";
    if (eventDirections.includes("down")) return "weaker";

    if (monitor.status === "active" && monitor.unread_count > 0) return "stronger";
    return "quiet";
}

function statePriority(state: ChangeState) {
    if (state === "new") return 3;
    if (state === "stronger") return 2;
    if (state === "weaker") return 1;
    return 0;
}

function stateLabel(state: ChangeState) {
    if (state === "stronger") return "Stronger";
    if (state === "weaker") return "Weaker";
    if (state === "new") return "New";
    return "Quiet";
}

function stateTone(state: ChangeState) {
    if (state === "stronger") return "border-build/20 bg-build/10 text-build";
    if (state === "weaker") return "border-dont/20 bg-dont/10 text-dont";
    if (state === "new") return "border-primary/20 bg-primary/10 text-primary";
    return "border-white/10 bg-white/5 text-muted-foreground";
}

function stateRail(state: ChangeState) {
    if (state === "stronger") return "bg-build";
    if (state === "weaker") return "bg-dont";
    if (state === "new") return "bg-primary";
    return "bg-white/10";
}

function getChangeSummary(monitor: MonitorItem) {
    if (monitor.memory?.delta_summary) return monitor.memory.delta_summary;
    if (monitor.recent_events[0]?.summary) return monitor.recent_events[0].summary;
    if (monitor.strategy?.strongest_reason && getChangeState(monitor) === "stronger") return monitor.strategy.strongest_reason;
    if (monitor.strategy?.strongest_caution && getChangeState(monitor) === "weaker") return monitor.strategy.strongest_caution;
    return monitor.summary;
}

function getMeaningLine(monitor: MonitorItem) {
    const state = getChangeState(monitor);
    if (state === "stronger") return "This looks more promising than the last time you checked.";
    if (state === "weaker") return "Confidence slipped or a caution got stronger.";
    if (state === "new") return "This just became worth a first serious look.";
    return "Nothing important changed. You do not need to reopen it yet.";
}

function getNextStep(monitor: MonitorItem) {
    if (monitor.strategy?.next_move_recommended_action) return monitor.strategy.next_move_recommended_action;
    if (monitor.strategy?.next_move_summary) return monitor.strategy.next_move_summary;
    if (monitor.memory?.next_move_change_note) return monitor.memory.next_move_change_note;
    if (monitor.monitor_type === "validation") return "Open the report and decide whether to rerun validation.";
    return "Recheck the opportunity only if you are close to building in this space.";
}

function getFacts(monitor: MonitorItem) {
    const directProof = monitor.trust?.direct_evidence_count ?? 0;
    const sources = monitor.trust?.source_count ?? 0;
    return [
        directProof > 0 ? `${directProof} direct proof` : "No direct proof yet",
        `${sources} sources`,
        `Trust ${monitor.trust?.score ?? 0}`,
    ];
}

function FilterPill({
    active,
    count,
    label,
    onClick,
}: {
    active: boolean;
    count: number;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={`rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                active
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"
            }`}
        >
            {label} <span className="ml-1 text-white">{count}</span>
        </button>
    );
}

export default function SavedPage() {
    const { isPremium } = useUserPlan();
    const [monitors, setMonitors] = useState<MonitorItem[]>([]);
    const [recentEvents, setRecentEvents] = useState<MonitorEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sort, setSort] = useState<SortMode>("attention");
    const [view, setView] = useState<ViewMode>("review");
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
                console.error("Failed to load followed items:", err);
                setError("Could not load your followed ideas right now.");
            })
            .finally(() => setLoading(false));
    }, [isPremium]);

    const following = useMemo(
        () => monitors.filter((monitor) => monitor.monitor_type === "validation" || monitor.monitor_type === "opportunity"),
        [monitors],
    );

    const alertMonitors = useMemo(
        () => monitors.filter((monitor) => monitor.monitor_type === "pain_theme"),
        [monitors],
    );

    const followingIds = useMemo(() => new Set(following.map((monitor) => monitor.id)), [following]);

    const unreadChanges = useMemo(
        () => recentEvents.filter((event) => followingIds.has(event.monitor_id) && !event.seen).length,
        [followingIds, recentEvents],
    );

    const sortedFollowing = useMemo(() => {
        const items = [...following];
        items.sort((a, b) => {
            if (sort === "confidence") return (b.trust?.score || 0) - (a.trust?.score || 0);
            if (sort === "attention") {
                const byState = statePriority(getChangeState(b)) - statePriority(getChangeState(a));
                if (byState !== 0) return byState;
                return (b.unread_count || 0) - (a.unread_count || 0);
            }
            return new Date(b.last_changed_at || b.created_at).getTime() - new Date(a.last_changed_at || a.created_at).getTime();
        });
        return items;
    }, [following, sort]);

    const reviewItems = useMemo(
        () => sortedFollowing.filter((monitor) => getChangeState(monitor) !== "quiet"),
        [sortedFollowing],
    );

    const quietItems = useMemo(
        () => sortedFollowing.filter((monitor) => getChangeState(monitor) === "quiet"),
        [sortedFollowing],
    );

    const visibleItems = useMemo(() => {
        if (view === "quiet") return quietItems;
        if (view === "review") return reviewItems;
        return sortedFollowing;
    }, [quietItems, reviewItems, sortedFollowing, view]);

    const reviewNow = useMemo(() => reviewItems.slice(0, 3), [reviewItems]);

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
            console.error("Failed to remove followed item:", err);
            setError("Could not update this item right now.");
        } finally {
            setRemoving(null);
        }
    };

    if (!isPremium) return <PremiumGate feature="Following" />;

    return (
        <div className="mx-auto max-w-6xl p-6 md:p-8">
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <div className="flex flex-col gap-3">
                    <div>
                        <h1 className="flex items-center gap-2 font-display text-[24px] font-bold text-white">
                            <Radio className="h-5 w-5 text-primary" /> Following
                        </h1>
                        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                            Watched opportunities and reports.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">{following.length} followed</span>
                        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-primary">{reviewItems.length} need review</span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">{quietItems.length} quiet</span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">{unreadChanges} unread changes</span>
                    </div>
                </div>
            </motion.div>

            {alertMonitors.length > 0 ? (
                <div className="mb-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">{alertMonitors.length} alerts in Alerts</span>
                    <Link href="/dashboard/alerts" className="inline-flex items-center gap-1 text-primary">
                        Open Alerts <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                </div>
            ) : null}

            <section className="mb-8 rounded-3xl border border-primary/15 bg-primary/5 p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                        <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-primary">Review now</div>
                        <h2 className="mt-2 font-display text-xl font-semibold text-white">Open only if something changed enough to matter</h2>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                        {reviewItems.length} items
                    </div>
                </div>

                <div className="space-y-3">
                    {loading ? (
                        Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="h-[112px] rounded-2xl border border-white/10 bg-white/5" />
                        ))
                    ) : reviewNow.length > 0 ? (
                        reviewNow.map((monitor) => {
                            const state = getChangeState(monitor);
                            const meta = typeMeta(monitor.monitor_type);
                            const Icon = meta.icon;
                            return (
                                <div key={monitor.id} className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f1116]">
                                    <div className="flex">
                                        <div className={`w-1.5 ${stateRail(state)}`} />
                                        <div className="flex-1 p-4">
                                            <div className="mb-2 flex flex-wrap items-center gap-2">
                                                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                                    <Icon className="h-3.5 w-3.5" /> {meta.label}
                                                </span>
                                                <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${stateTone(state)}`}>
                                                    {stateLabel(state)}
                                                </span>
                                            </div>
                                            <div className="text-sm font-semibold text-white">{monitor.title}</div>
                                            <p className="mt-2 text-sm text-foreground/80">{getChangeSummary(monitor)}</p>
                                            <div className="mt-3 flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                                                    <Clock3 className="h-3.5 w-3.5" />
                                                    Changed {timeAgo(monitor.last_changed_at || monitor.created_at)}
                                                </div>
                                                <Link href={monitor.target_href} className="inline-flex items-center gap-1 font-mono text-xs text-primary">
                                                    Open <ChevronRight className="h-3.5 w-3.5" />
                                                </Link>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="rounded-2xl border border-white/10 bg-[#0f1116] p-5 text-sm text-muted-foreground">
                            Nothing changed enough to reopen right now.
                        </div>
                    )}
                </div>
            </section>

            {error ? (
                <div className="mt-6 rounded-2xl border border-dont/20 bg-dont/5 p-4 text-sm text-foreground/85">
                    {error}
                </div>
            ) : null}

            <section className="mt-8">
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Everything you follow</div>
                        <h2 className="mt-2 font-display text-lg font-semibold text-white">Your full queue</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <FilterPill active={view === "review"} count={reviewItems.length} label="Review now" onClick={() => setView("review")} />
                        <FilterPill active={view === "all"} count={following.length} label="All" onClick={() => setView("all")} />
                        <FilterPill active={view === "quiet"} count={quietItems.length} label="Quiet" onClick={() => setView("quiet")} />
                        <select
                            value={sort}
                            onChange={(event) => setSort(event.target.value as SortMode)}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground"
                        >
                            <option value="attention">Needs review first</option>
                            <option value="recent">Recently changed</option>
                            <option value="confidence">Highest confidence</option>
                        </select>
                    </div>
                </div>

                {loading ? (
                    <div className="space-y-3">
                        {Array.from({ length: 5 }).map((_, index) => (
                            <div key={index} className="h-[148px] rounded-2xl border border-white/10 bg-white/5" />
                        ))}
                    </div>
                ) : visibleItems.length > 0 ? (
                    <StaggerContainer className="space-y-3">
                        {visibleItems.map((monitor) => {
                            const state = getChangeState(monitor);
                            const meta = typeMeta(monitor.monitor_type);
                            const Icon = meta.icon;
                            const facts = getFacts(monitor);
                            return (
                                <StaggerItem key={monitor.id}>
                                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f1116]">
                                        <div className="flex">
                                            <div className={`w-1.5 shrink-0 ${stateRail(state)}`} />
                                            <div className="flex-1 p-5">
                                                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_auto] lg:items-start">
                                                    <div className="min-w-0">
                                                        <div className="mb-2 flex flex-wrap items-center gap-2">
                                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                                                <Icon className="h-3.5 w-3.5" /> {meta.label}
                                                            </span>
                                                            <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${stateTone(state)}`}>
                                                                {stateLabel(state)}
                                                            </span>
                                                            {monitor.unread_count > 0 ? (
                                                                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white">
                                                                    {monitor.unread_count} updates
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        <h3 className="text-[16px] font-semibold leading-tight text-white">{monitor.title}</h3>
                                                        <p className="mt-2 text-sm text-foreground/80">{monitor.summary}</p>
                                                        <div className="mt-3 flex flex-wrap gap-3 font-mono text-[11px] text-muted-foreground">
                                                            {facts.map((fact) => (
                                                                <span key={fact}>{fact}</span>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div className="space-y-3">
                                                        <div>
                                                            <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">What changed</div>
                                                            <p className="mt-1 text-sm text-white/90">{getChangeSummary(monitor)}</p>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">What it means</div>
                                                            <p className="mt-1 text-sm text-white/90">{getMeaningLine(monitor)}</p>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Next step</div>
                                                            <p className="mt-1 text-sm text-white/90">{getNextStep(monitor)}</p>
                                                        </div>
                                                    </div>

                                                    <div className="flex gap-2 lg:min-w-[180px] lg:flex-col">
                                                        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                                                            <div className="flex items-center gap-2">
                                                                <Eye className="h-3.5 w-3.5" />
                                                                Changed {timeAgo(monitor.last_changed_at || monitor.created_at)}
                                                            </div>
                                                            <div className="mt-1">Checked {timeAgo(monitor.last_checked_at || monitor.created_at)}</div>
                                                        </div>
                                                        <Link
                                                            href={monitor.target_href}
                                                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-4 py-2 text-center font-mono text-xs text-primary transition-colors hover:bg-primary/15"
                                                        >
                                                            Open
                                                        </Link>
                                                        <button
                                                            onClick={() => handleRemove(monitor)}
                                                            disabled={removing === monitor.id}
                                                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-dont/20 bg-dont/10 px-4 py-2 text-center font-mono text-xs text-dont transition-colors hover:bg-dont/15 disabled:opacity-50"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                            Unfollow
                                                        </button>
                                                    </div>
                                                </div>

                                                <details className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
                                                    <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                                                        More context
                                                    </summary>
                                                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                                                        {monitor.memory?.current_state_summary ? (
                                                            <div>
                                                                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Current read</div>
                                                                <p className="mt-1 text-sm text-white/85">{monitor.memory.current_state_summary}</p>
                                                            </div>
                                                        ) : null}
                                                        {monitor.strategy?.strongest_reason ? (
                                                            <div>
                                                                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Strongest reason</div>
                                                                <p className="mt-1 text-sm text-white/85">{monitor.strategy.strongest_reason}</p>
                                                            </div>
                                                        ) : null}
                                                        {monitor.strategy?.strongest_caution ? (
                                                            <div>
                                                                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Strongest caution</div>
                                                                <p className="mt-1 text-sm text-white/85">{monitor.strategy.strongest_caution}</p>
                                                            </div>
                                                        ) : null}
                                                        {monitor.recent_events.length > 0 ? (
                                                            <div>
                                                                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Recent signals</div>
                                                                <div className="mt-1 space-y-2">
                                                                    {monitor.recent_events.slice(0, 3).map((event) => (
                                                                        <div key={event.id} className="text-sm text-white/85">
                                                                            <div>{event.summary}</div>
                                                                            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                                                                                {event.source_label} • {timeAgo(event.observed_at)}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ) : null}
                                                        {monitor.trust.weak_signal && monitor.trust.weak_signal_reasons.length > 0 ? (
                                                            <div>
                                                                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Watch-outs</div>
                                                                <p className="mt-1 text-sm text-risky">{monitor.trust.weak_signal_reasons.join(" • ")}</p>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </details>
                                            </div>
                                        </div>
                                    </div>
                                </StaggerItem>
                            );
                        })}
                    </StaggerContainer>
                ) : (
                    <div className="rounded-3xl border border-white/10 bg-[#0f1116] p-10 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-muted-foreground">
                            <Bookmark className="h-5 w-5" />
                        </div>
                        <h2 className="font-semibold text-white">Nothing followed yet</h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Save an opportunity or keep a validation report so this page becomes a useful review queue later.
                        </p>
                        <div className="mt-4 flex justify-center gap-3">
                            <Link
                                href="/dashboard/opportunities"
                                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 font-mono text-xs text-foreground transition-colors hover:bg-white/10"
                            >
                                Browse opportunities
                            </Link>
                            <Link
                                href="/dashboard/reports"
                                className="rounded-lg border border-primary/20 bg-primary/10 px-4 py-2 font-mono text-xs text-primary transition-colors hover:bg-primary/15"
                            >
                                Open reports
                            </Link>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
