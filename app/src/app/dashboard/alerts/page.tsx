"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, BellRing, ChevronDown, ChevronUp, ExternalLink, PauseCircle } from "lucide-react";
import { ValidationDepthChooser } from "@/app/dashboard/components/ValidationDepthChooser";

interface AlertMatch {
    id: string;
    alert_id: string;
    post_title: string;
    post_score: number;
    post_url: string;
    subreddit: string;
    matched_keywords: string[];
    matched_at: string;
    seen: boolean;
}

interface EvidenceItem {
    id: string;
    platform: string;
    title: string;
    snippet: string | null;
    url: string | null;
    directness: "direct_evidence" | "derived_metric" | "ai_inference";
}

interface PainAlert {
    id: string;
    validation_id?: string | null;
    keywords: string[];
    subreddits: string[];
    min_score: number;
    is_active: boolean;
    created_at: string;
    matches: AlertMatch[];
    evidence: EvidenceItem[];
    evidence_summary: {
        evidence_count: number;
        direct_evidence_count: number;
        inferred_count: number;
        source_count: number;
        freshness_label: string;
        direct_vs_inferred: {
            direct: number;
            derived: number;
            inferred: number;
        };
    };
    trust: {
        level: "HIGH" | "MEDIUM" | "LOW";
        label: string;
        score: number;
        freshness_label: string;
        weak_signal: boolean;
        weak_signal_reasons: string[];
    };
}

function timeAgo(value: string) {
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

export default function AlertsPage() {
    const [alerts, setAlerts] = useState<PainAlert[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadAlerts = useCallback(async () => {
        try {
            const res = await fetch("/api/alerts", { cache: "no-store" });
            if (!res.ok) {
                throw new Error(`alerts fetch failed with ${res.status}`);
            }
            const data = await res.json();
            if (data.error) {
                throw new Error(data.error);
            }
            setAlerts(data.alerts || []);
            setUnreadCount(data.unread_count || 0);
            setError(null);
        } catch {
            setError("Could not load alerts — check connection and retry");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAlerts();
        const interval = setInterval(loadAlerts, 60000);
        return () => clearInterval(interval);
    }, [loadAlerts]);

    const deactivateAlert = async (alertId: string) => {
        await fetch(`/api/alerts/${alertId}`, { method: "DELETE" });
        setAlerts((prev) => prev.filter((alert) => alert.id !== alertId));
    };

    const markSeen = async (alertId: string) => {
        await fetch(`/api/alerts/${alertId}/seen`, { method: "PATCH" });
        setAlerts((prev) => prev.map((alert) => (
            alert.id === alertId
                ? { ...alert, matches: alert.matches.map((match) => ({ ...match, seen: true })) }
                : alert
        )));
        setUnreadCount((count) => Math.max(0, count - (alerts.find((alert) => alert.id === alertId)?.matches.length || 0)));
    };

    if (loading) {
        return (
            <div className="max-w-5xl mx-auto p-6 md:p-8">
                <div className="space-y-4">
                    {[0, 1, 2].map((index) => (
                        <div
                            key={index}
                            className="bento-cell p-5 rounded-2xl bg-[linear-gradient(90deg,rgba(255,255,255,0.03),rgba(255,255,255,0.08),rgba(255,255,255,0.03))] bg-[length:200%_100%] animate-shimmer"
                        >
                            <div className="h-4 w-32 rounded bg-white/10 mb-4" />
                            <div className="h-3 w-64 rounded bg-white/10 mb-3" />
                            <div className="h-3 w-48 rounded bg-white/10" />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto p-6 md:p-8">
            <div className="flex items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
                        {unreadCount > 0 ? <BellRing className="w-5 h-5 text-primary" /> : <Bell className="w-5 h-5 text-primary" />}
                    </div>
                    <div>
                        <h1 className="text-[24px] font-bold text-white">Pain Stream</h1>
                        <p className="text-sm text-muted-foreground">Live alerts when your market moves</p>
                    </div>
                </div>
                <div className="px-3 py-1.5 rounded-xl border border-primary/20 bg-primary/10 font-mono text-xs text-primary">
                    {unreadCount} unread
                </div>
            </div>

            {error && (
                <div className="bento-cell p-5 mb-4 border border-dont/20 bg-dont/5">
                    <p className="text-sm text-foreground/85 mb-3">{error}</p>
                    <button
                        onClick={() => {
                            setLoading(true);
                            loadAlerts();
                        }}
                        className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] font-mono text-foreground hover:bg-white/10"
                    >
                        Retry
                    </button>
                </div>
            )}

            {!error && alerts.length === 0 ? (
                <div className="bento-cell p-12 text-center">
                    <Link
                        href="/dashboard/validate"
                        className="mt-4 inline-flex items-center rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-primary transition-colors hover:bg-primary/20"
                    >
                        {"Run Validation ->"}
                    </Link>
                    <p className="text-white text-sm">No alerts yet — run a validation to auto-create alerts</p>
                </div>
            ) : !error ? (
                <div className="space-y-4">
                    {alerts.map((alert) => {
                        const isOpen = expanded[alert.id] ?? alert.matches.length > 0;
                        return (
                            <div key={alert.id} className="bento-cell p-5">
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                    <div className="flex-1">
                                        <div className="flex flex-wrap gap-2 mb-3">
                                            {alert.keywords.map((keyword) => (
                                                <span key={keyword} className="px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-mono">
                                                    {keyword}
                                                </span>
                                            ))}
                                            <span className={`px-2.5 py-1 rounded-full border text-[10px] font-mono uppercase tracking-[0.12em] ${trustTone(alert.trust?.level)}`}>
                                                {alert.trust?.label || "Signal quality"}
                                            </span>
                                        </div>
                                        <div className="text-xs text-muted-foreground font-mono">
                                            Active since {new Date(alert.created_at).toLocaleDateString()} · Watching {alert.subreddits?.length || 0} subreddits
                                        </div>
                                        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
                                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-muted-foreground">
                                                <span>{alert.evidence_summary?.direct_evidence_count || 0} direct signals</span>
                                                <span>{alert.evidence_summary?.source_count || 0} sources</span>
                                                <span>{alert.evidence_summary?.freshness_label || "Freshness unknown"}</span>
                                            </div>
                                            <p className="mt-2 text-sm text-white/90">
                                                {alert.evidence?.[0]?.snippet || "This monitor is watching for repeated pain signals tied to your keywords."}
                                            </p>
                                            {alert.trust?.weak_signal && alert.trust.weak_signal_reasons.length > 0 && (
                                                <p className="mt-2 text-xs text-risky">
                                                    Weak signal: {alert.trust.weak_signal_reasons.join(" • ")}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {alert.matches.length > 0 && (
                                            <button
                                                onClick={() => markSeen(alert.id)}
                                                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-muted-foreground hover:text-white"
                                            >
                                                Mark Seen
                                            </button>
                                        )}
                                        <button
                                            onClick={() => deactivateAlert(alert.id)}
                                            className="px-3 py-2 rounded-lg bg-dont/10 border border-dont/20 text-xs font-mono text-dont"
                                        >
                                            <PauseCircle className="w-3.5 h-3.5 inline mr-1" />
                                            Deactivate
                                        </button>
                                        <button
                                            onClick={() => setExpanded((prev) => ({ ...prev, [alert.id]: !isOpen }))}
                                            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-white"
                                        >
                                            {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                        </button>
                                    </div>
                                </div>

                                {isOpen && (
                                    <div className="mt-5 space-y-3">
                                        {alert.matches.length === 0 ? (
                                            <div className="text-xs text-muted-foreground font-mono">No unseen matches yet.</div>
                                        ) : alert.matches.map((match) => {
                                            const platform = match.post_url.includes("news.ycombinator.com") ? "Hacker News" : "Reddit";
                                            const badgeClass = platform === "Reddit"
                                                ? "bg-[#ff4500]/10 border-[#ff4500]/20 text-[#ff4500]"
                                                : "bg-amber-500/10 border-amber-500/20 text-amber-400";
                                            return (
                                                <div key={match.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                                                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                                                        <div className="flex-1">
                                                            <div className="flex flex-wrap gap-2 mb-2">
                                                                <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono ${badgeClass}`}>
                                                                    {platform}
                                                                </span>
                                                                <span className="px-2 py-0.5 rounded-full border border-white/10 text-[10px] font-mono text-muted-foreground">
                                                                    r/{match.subreddit}
                                                                </span>
                                                                <span className="px-2 py-0.5 rounded-full border border-white/10 text-[10px] font-mono text-muted-foreground">
                                                                    +{match.post_score}
                                                                </span>
                                                                <span className="px-2 py-0.5 rounded-full border border-white/10 text-[10px] font-mono text-muted-foreground">
                                                                    {timeAgo(match.matched_at)}
                                                                </span>
                                                            </div>
                                                            <p className="text-sm text-white leading-relaxed">{match.post_title}</p>
                                                            <p className="mt-2 text-xs text-muted-foreground">
                                                                Why this matters: this post matched your alert keywords and cleared the quality bar for a live opportunity signal.
                                                            </p>
                                                            <div className="flex flex-wrap gap-2 mt-3">
                                                                {match.matched_keywords.map((keyword) => (
                                                                    <span key={keyword} className="text-[10px] font-mono text-primary">
                                                                        #{keyword}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <a
                                                                href={match.post_url}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-white inline-flex items-center gap-1.5"
                                                            >
                                                                View Post <ExternalLink className="w-3.5 h-3.5" />
                                                            </a>
                                                            <ValidationDepthChooser
                                                                prefill={{
                                                                    idea: `Angle from live signal: ${match.post_title}`,
                                                                    target: match.subreddit ? `People active in r/${match.subreddit}` : "People discussing this live signal",
                                                                    pain: `Source signal scored ${match.post_score} and matched: ${match.matched_keywords.join(", ")}.`,
                                                                }}
                                                            >
                                                                <span className="px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-xs font-mono text-primary">
                                                                    Validate This Angle
                                                                </span>
                                                            </ValidationDepthChooser>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : null}

            <div className="mt-8 text-xs text-muted-foreground font-mono">
                Alerts update automatically every 60 seconds. Want more coverage? <Link href="/dashboard/validate" className="text-primary">Run another validation</Link>.
            </div>
        </div>
    );
}
