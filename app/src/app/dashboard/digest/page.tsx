"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, ExternalLink, Radar, RefreshCw, TrendingUp } from "lucide-react";
import { PremiumGate } from "@/app/components/premium-gate";
import { useUserPlan } from "@/lib/use-user-plan";

interface Brief {
    date: string;
    total_monitors: number;
    active_changes: number;
    unread_updates: number;
    strongest_monitor: {
        title: string;
        type: string;
        trust_score: number;
        summary: string;
        href: string;
    } | null;
    top_event: {
        summary: string;
        impact_level: string;
        source_label: string;
        href: string;
    } | null;
    monitor_mix: {
        validation: number;
        opportunity: number;
        pain_theme: number;
    };
    recommended_actions: string[];
    changed_monitors: Array<{
        title: string;
        delta_summary: string;
        direction: string;
        href: string;
    }>;
    stale_monitors: Array<{
        title: string;
        type: string;
        days_since_check: number;
        href: string;
    }>;
}

interface TimelineItem {
    bucket: string;
    time: string | null;
    icon: string;
    description: string;
    action: { href: string; label: string };
    source_label?: string;
    impact_level?: string;
}

function normalizeBrief(raw: unknown): Brief | null {
    if (!raw || typeof raw !== "object") return null;

    const brief = raw as Partial<Brief> & Record<string, unknown>;
    const mix = brief.monitor_mix && typeof brief.monitor_mix === "object"
        ? brief.monitor_mix as Partial<Brief["monitor_mix"]>
        : {};

    return {
        date: typeof brief.date === "string" ? brief.date : "",
        total_monitors: typeof brief.total_monitors === "number" ? brief.total_monitors : 0,
        active_changes: typeof brief.active_changes === "number" ? brief.active_changes : 0,
        unread_updates: typeof brief.unread_updates === "number" ? brief.unread_updates : 0,
        strongest_monitor: brief.strongest_monitor && typeof brief.strongest_monitor === "object"
            ? {
                title: typeof brief.strongest_monitor.title === "string" ? brief.strongest_monitor.title : "",
                type: typeof brief.strongest_monitor.type === "string" ? brief.strongest_monitor.type : "Opportunity",
                trust_score: typeof brief.strongest_monitor.trust_score === "number" ? brief.strongest_monitor.trust_score : 0,
                summary: typeof brief.strongest_monitor.summary === "string" ? brief.strongest_monitor.summary : "",
                href: typeof brief.strongest_monitor.href === "string" ? brief.strongest_monitor.href : "/dashboard/saved",
            }
            : null,
        top_event: brief.top_event && typeof brief.top_event === "object"
            ? {
                summary: typeof brief.top_event.summary === "string" ? brief.top_event.summary : "",
                impact_level: typeof brief.top_event.impact_level === "string" ? brief.top_event.impact_level : "LOW",
                source_label: typeof brief.top_event.source_label === "string" ? brief.top_event.source_label : "",
                href: typeof brief.top_event.href === "string" ? brief.top_event.href : "/dashboard/saved",
            }
            : null,
        monitor_mix: {
            validation: typeof mix.validation === "number" ? mix.validation : 0,
            opportunity: typeof mix.opportunity === "number" ? mix.opportunity : 0,
            pain_theme: typeof mix.pain_theme === "number" ? mix.pain_theme : 0,
        },
        recommended_actions: Array.isArray(brief.recommended_actions)
            ? brief.recommended_actions.filter((value): value is string => typeof value === "string")
            : [],
        changed_monitors: Array.isArray(brief.changed_monitors)
            ? brief.changed_monitors.map((monitor) => ({
                title: typeof monitor?.title === "string" ? monitor.title : "Monitor",
                delta_summary: typeof monitor?.delta_summary === "string" ? monitor.delta_summary : "",
                direction: typeof monitor?.direction === "string" ? monitor.direction : "steady",
                href: typeof monitor?.href === "string" ? monitor.href : "/dashboard/saved",
            }))
            : [],
        stale_monitors: Array.isArray(brief.stale_monitors)
            ? brief.stale_monitors.map((monitor) => ({
                title: typeof monitor?.title === "string" ? monitor.title : "Monitor",
                type: typeof monitor?.type === "string" ? monitor.type : "Opportunity",
                days_since_check: typeof monitor?.days_since_check === "number" ? monitor.days_since_check : 0,
                href: typeof monitor?.href === "string" ? monitor.href : "/dashboard/saved",
            }))
            : [],
    };
}

function normalizeTimeline(raw: unknown): TimelineItem[] {
    if (!Array.isArray(raw)) return [];

    return raw.map((item) => ({
        bucket: typeof item?.bucket === "string" ? item.bucket : "Recent",
        time: typeof item?.time === "string" ? item.time : null,
        icon: typeof item?.icon === "string" ? item.icon : "trend",
        description: typeof item?.description === "string" ? item.description : "",
        action: {
            href: typeof item?.action?.href === "string" ? item.action.href : "/dashboard/saved",
            label: typeof item?.action?.label === "string" ? item.action.label : "Open",
        },
        source_label: typeof item?.source_label === "string" ? item.source_label : undefined,
        impact_level: typeof item?.impact_level === "string" ? item.impact_level : undefined,
    }));
}

function iconFor(kind: string) {
    if (kind === "alert") return BellRing;
    if (kind === "competitor") return Radar;
    return TrendingUp;
}

export default function DigestPage() {
    const { isPremium } = useUserPlan();
    const [brief, setBrief] = useState<Brief | null>(null);
    const [timeline, setTimeline] = useState<TimelineItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const loadBrief = async (refresh = false) => {
        try {
            const res = await fetch(`/api/digest${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
            const payload = await res.json();
            setBrief(normalizeBrief(payload.brief));
            setTimeline(normalizeTimeline(payload.timeline));
        } catch {
            setBrief(null);
            setTimeline([]);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        if (!isPremium) return;
        loadBrief();
    }, [isPremium]);

    if (!isPremium) return <PremiumGate feature="Daily Brief" />;

    if (loading) {
        return <div className="max-w-5xl mx-auto p-8 text-sm font-mono text-muted-foreground">Loading Brief...</div>;
    }

    return (
        <div className="max-w-5xl mx-auto p-6 md:p-8">
            <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                    <h1 className="text-[24px] font-bold text-white">Brief</h1>
                    <p className="text-sm text-muted-foreground">Your shortest view of what changed and what deserves action next.</p>
                </div>
                <button
                    onClick={() => {
                        setRefreshing(true);
                        loadBrief(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-mono text-white hover:bg-white/10"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    Refresh brief
                </button>
            </div>

            {!brief && (
                <div className="bento-cell mb-6 p-8 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-muted-foreground">
                        <BellRing className="h-5 w-5" />
                    </div>
                    <h2 className="text-lg font-semibold text-white">Your brief is waiting for signal</h2>
                    <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
                        Your daily brief appears here once you have active monitors and alerts running.
                        Run a validation first to create your first monitor.
                    </p>
                    <Link
                        href="/dashboard/validate"
                        className="mt-5 inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-xs font-mono uppercase tracking-widest text-primary transition-colors hover:bg-primary/20"
                    >
                        Run Validation
                    </Link>
                </div>
            )}

            {brief && (
                <>
                    <div className="bento-cell mb-6 p-6">
                        <div className="mb-2 text-xs font-mono text-muted-foreground">{brief.date}</div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                                <div className="text-xs font-mono uppercase text-muted-foreground">Monitors</div>
                                <div className="mt-2 text-2xl font-mono text-white">{brief.total_monitors}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                                <div className="text-xs font-mono uppercase text-muted-foreground">Active Changes</div>
                                <div className="mt-2 text-2xl font-mono text-primary">{brief.active_changes}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                                <div className="text-xs font-mono uppercase text-muted-foreground">Unread Updates</div>
                                <div className="mt-2 text-2xl font-mono text-white">{brief.unread_updates}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                                <div className="text-xs font-mono uppercase text-muted-foreground">Priority</div>
                                <div className="mt-2 text-sm text-white">{brief.top_event?.impact_level || "Quiet"}</div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_1fr]">
                        <div className="space-y-6">
                            <div className="bento-cell p-6">
                                <div className="mb-4 text-xs font-mono uppercase text-muted-foreground">Recommended Actions</div>
                                {brief.recommended_actions.length > 0 ? (
                                    <div className="space-y-3">
                                        {brief.recommended_actions.map((action) => (
                                            <div key={action} className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/90">
                                                {action}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-sm text-muted-foreground">No urgent actions right now.</div>
                                )}
                            </div>

                            {brief.changed_monitors.length > 0 && (
                                <div className="bento-cell p-6">
                                    <div className="mb-3 text-xs font-mono uppercase text-muted-foreground">Since Last Check</div>
                                    <div className="space-y-3">
                                        {brief.changed_monitors.map((monitor) => (
                                            <div key={`${monitor.title}-${monitor.href}`} className="rounded-xl border border-white/10 bg-white/5 p-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="text-sm font-semibold text-white">{monitor.title}</div>
                                                        <div className="mt-2 text-sm text-white/85">{monitor.delta_summary}</div>
                                                    </div>
                                                    <Link href={monitor.href} className="text-xs font-mono text-primary">
                                                        Open
                                                    </Link>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {brief.strongest_monitor && (
                                <div className="bento-cell p-6">
                                    <div className="mb-3 text-xs font-mono uppercase text-muted-foreground">Strongest Monitor</div>
                                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-semibold text-white">{brief.strongest_monitor.title}</div>
                                                <div className="mt-1 text-[11px] font-mono uppercase text-muted-foreground">
                                                    {brief.strongest_monitor.type} - Trust {brief.strongest_monitor.trust_score}/100
                                                </div>
                                                <p className="mt-3 text-sm text-white/85">{brief.strongest_monitor.summary}</p>
                                            </div>
                                            <Link href={brief.strongest_monitor.href} className="inline-flex items-center gap-1 text-xs font-mono text-primary">
                                                Open <ExternalLink className="h-3.5 w-3.5" />
                                            </Link>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="space-y-6">
                            <div className="bento-cell p-6">
                                <div className="mb-3 text-xs font-mono uppercase text-muted-foreground">Monitor Mix</div>
                                <div className="grid grid-cols-1 gap-3">
                                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                                        <div className="text-xs font-mono uppercase text-muted-foreground">Validations</div>
                                        <div className="mt-2 text-xl font-mono text-white">{brief.monitor_mix.validation}</div>
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                                        <div className="text-xs font-mono uppercase text-muted-foreground">Opportunities</div>
                                        <div className="mt-2 text-xl font-mono text-white">{brief.monitor_mix.opportunity}</div>
                                    </div>
                                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                                        <div className="text-xs font-mono uppercase text-muted-foreground">Pain Themes</div>
                                        <div className="mt-2 text-xl font-mono text-white">{brief.monitor_mix.pain_theme}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="bento-cell p-6">
                                <div className="mb-3 text-xs font-mono uppercase text-muted-foreground">Stale Monitors</div>
                                {brief.stale_monitors.length > 0 ? (
                                    <div className="space-y-3">
                                        {brief.stale_monitors.map((monitor) => (
                                            <div key={`${monitor.title}-${monitor.href}`} className="rounded-xl border border-white/10 bg-white/5 p-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="text-sm text-white">{monitor.title}</div>
                                                        <div className="mt-1 text-[11px] font-mono uppercase text-muted-foreground">
                                                            {monitor.type} - {monitor.days_since_check}d since last meaningful refresh
                                                        </div>
                                                    </div>
                                                    <Link href={monitor.href} className="text-xs font-mono text-primary">
                                                        Open
                                                    </Link>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-sm text-muted-foreground">Nothing looks stale right now.</div>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}

            <div className="bento-cell mt-6 p-6">
                <div className="mb-4 text-xs font-mono uppercase text-muted-foreground">Recent Monitor Events</div>
                {timeline.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No monitor events yet.</div>
                ) : (
                    <div className="space-y-4">
                        {timeline.map((item, index) => {
                            const Icon = iconFor(item.icon);
                            return (
                                <div key={`${item.time}-${index}`} className="flex flex-col justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-4 lg:flex-row lg:items-center">
                                    <div className="flex items-start gap-3">
                                        <Icon className="mt-0.5 h-4 w-4 text-primary" />
                                        <div>
                                            <div className="mb-1 text-[10px] font-mono uppercase text-muted-foreground">
                                                {item.bucket}{item.impact_level ? ` - ${item.impact_level}` : ""}
                                            </div>
                                            <div className="text-sm text-white">{item.description}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {item.source_label ? `${item.source_label} - ` : ""}
                                                {item.time ? new Date(item.time).toLocaleString() : "Recent"}
                                            </div>
                                        </div>
                                    </div>
                                    <Link href={item.action.href} className="text-xs font-mono text-primary">
                                        {item.action.label}
                                    </Link>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
