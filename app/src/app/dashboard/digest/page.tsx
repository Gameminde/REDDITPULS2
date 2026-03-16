"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Radar, TrendingUp } from "lucide-react";

interface Brief {
    date: string;
    alert_matches: number;
    top_signal: { keyword: string; trend: string; change: number } | null;
    competitor_alerts: number;
    top_complaint: { competitor: string; signal: string; score: number } | null;
    trending: Array<{ keyword: string; tier: string; change: number }>;
    revalidate_suggestions: Array<{ idea: string; days_ago: number }>;
}

interface TimelineItem {
    bucket: string;
    time: string;
    icon: string;
    description: string;
    action: { href: string; label: string };
}

export default function DigestPage() {
    const [brief, setBrief] = useState<Brief | null>(null);
    const [timeline, setTimeline] = useState<TimelineItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/digest")
            .then((r) => r.json())
            .then((res) => {
                setBrief(res.brief || null);
                setTimeline(res.timeline || []);
            })
            .catch(() => {
                setBrief(null);
                setTimeline([]);
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return <div className="max-w-5xl mx-auto p-8 text-sm font-mono text-muted-foreground">Loading Morning Brief…</div>;
    }

    return (
        <div className="max-w-5xl mx-auto p-6 md:p-8">
            <div className="mb-6">
                <h1 className="text-[24px] font-bold text-white">Morning Brief</h1>
                <p className="text-sm text-muted-foreground">Your daily market pulse in one screen</p>
            </div>

            {brief && (
                <div className="bento-cell p-6 mb-6">
                    <div className="text-xs font-mono text-muted-foreground mb-2">{brief.date}</div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                            <div className="text-xs font-mono text-muted-foreground uppercase">Alert Matches</div>
                            <div className="text-2xl font-mono text-primary mt-2">{brief.alert_matches}</div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                            <div className="text-xs font-mono text-muted-foreground uppercase">Top Signal</div>
                            <div className="text-sm text-white mt-2">{brief.top_signal?.keyword || "None yet"}</div>
                            <div className="text-xs text-build mt-1">{brief.top_signal ? `${brief.top_signal.trend} · ${brief.top_signal.change}%` : ""}</div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                            <div className="text-xs font-mono text-muted-foreground uppercase">Competitor Alerts</div>
                            <div className="text-2xl font-mono text-white mt-2">{brief.competitor_alerts}</div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                            <div className="text-xs font-mono text-muted-foreground uppercase">Revalidate</div>
                            <div className="text-sm text-white mt-2">{brief.revalidate_suggestions.length} ideas</div>
                        </div>
                    </div>
                </div>
            )}

            {brief?.trending?.length ? (
                <div className="bento-cell p-6 mb-6">
                    <div className="text-xs font-mono text-muted-foreground uppercase mb-3">Trending Keywords</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {brief.trending.map((trend) => (
                            <div key={trend.keyword} className="rounded-xl border border-white/10 bg-white/5 p-4">
                                <div className="text-sm text-white">{trend.keyword}</div>
                                <div className="text-xs text-muted-foreground mt-1">{trend.tier}</div>
                                <div className="text-xs text-primary mt-2">{trend.change}% 24h</div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            <div className="bento-cell p-6">
                <div className="text-xs font-mono text-muted-foreground uppercase mb-4">Timeline</div>
                {timeline.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No digest events yet.</div>
                ) : (
                    <div className="space-y-4">
                        {timeline.map((item, index) => {
                            const Icon = item.icon === "alert" ? Bell : item.icon === "competitor" ? Radar : TrendingUp;
                            return (
                                <div key={`${item.time}-${index}`} className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
                                    <div className="flex items-start gap-3">
                                        <Icon className="w-4 h-4 text-primary mt-0.5" />
                                        <div>
                                            <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">{item.bucket}</div>
                                            <div className="text-sm text-white">{item.description}</div>
                                            <div className="text-xs text-muted-foreground mt-1">{new Date(item.time).toLocaleString()}</div>
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
