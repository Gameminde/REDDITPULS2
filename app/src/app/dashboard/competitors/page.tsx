"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { PremiumGate } from "@/app/components/premium-gate";
import { GlowBadge, StaggerContainer, StaggerItem } from "@/app/components/motion";
import { AlertCircle, AlertTriangle, ExternalLink, Radar, Shield, Target } from "lucide-react";
import { useUserPlan } from "@/lib/use-user-plan";

interface Competitor {
    name?: string;
    weakness?: string;
    strengths?: string;
    pricing?: string;
    market_share?: string;
}

interface CompetitionItem {
    idea: string;
    validation_id: string;
    created_at: string;
    direct_competitors: Competitor[];
    indirect_competitors: Competitor[];
    market_saturation: string;
    unfair_advantage: string;
    moat_strategy: string;
}

interface ComplaintItem {
    id?: string;
    post_title: string;
    post_score: number;
    post_url: string;
    subreddit?: string;
    scraped_at?: string;
    competitors_mentioned?: string[];
    complaint_signals?: string[];
    evidence?: Array<{
        id: string;
        title: string;
        snippet: string | null;
        directness: "direct_evidence" | "derived_metric" | "ai_inference";
        platform: string;
    }>;
    evidence_summary?: {
        evidence_count: number;
        direct_evidence_count: number;
        inferred_count: number;
        source_count: number;
        freshness_label: string;
    };
    trust?: {
        level: "HIGH" | "MEDIUM" | "LOW";
        label: string;
        score: number;
        freshness_label: string;
        weak_signal: boolean;
        weak_signal_reasons: string[];
    };
}

interface RadarCluster {
    id: string;
    competitor: string;
    weakness_category: string;
    summary: string;
    affected_segment: string | null;
    evidence_count: number;
    source_count: number;
    freshness: {
        latest_observed_at: string | null;
        freshness_label: string;
    };
    trust: {
        level: "HIGH" | "MEDIUM" | "LOW";
        label: string;
        score: number;
        weak_signal: boolean;
        weak_signal_reasons: string[];
        inference_flags: string[];
    };
    representative_evidence: Array<{
        id: string;
        title: string;
        snippet: string | null;
        url: string | null;
        platform: string;
        observed_at: string | null;
        score: number | null;
        directness: "direct_evidence" | "derived_metric" | "ai_inference";
        confidence: "HIGH" | "MEDIUM" | "LOW";
    }>;
    wedge_opportunity_note: string;
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
    monitor: {
        is_monitored: boolean;
        alert_id: string | null;
        suggested_keywords: string[];
    };
    why_now?: {
        timing_category: string;
        inferred_why_now_note: string;
        momentum_direction: "accelerating" | "steady" | "cooling" | "new" | "unknown";
        monitorable_change_note: string;
    };
}

function getSaturationColor(saturation: string): "emerald" | "amber" | "red" | "orange" {
    const value = (saturation || "").toLowerCase();
    if (value.includes("low") || value.includes("none")) return "emerald";
    if (value.includes("medium") || value.includes("moderate")) return "amber";
    if (value.includes("high") || value.includes("saturated")) return "red";
    return "orange";
}

function timeAgo(value?: string) {
    if (!value) return "recent";
    const diff = Date.now() - new Date(value).getTime();
    const hours = Math.max(1, Math.floor(diff / 3600000));
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function trustTone(level?: "HIGH" | "MEDIUM" | "LOW") {
    if (level === "HIGH") return "border-build/20 bg-build/10 text-build";
    if (level === "MEDIUM") return "border-risky/20 bg-risky/10 text-risky";
    return "border-dont/20 bg-dont/10 text-dont";
}

export default function CompetitorsPage() {
    const { isPremium } = useUserPlan();
    const [compData, setCompData] = useState<CompetitionItem[]>([]);
    const [complaints, setComplaints] = useState<ComplaintItem[]>([]);
    const [competitorOptions, setCompetitorOptions] = useState<string[]>([]);
    const [radarClusters, setRadarClusters] = useState<RadarCluster[]>([]);
    const [radarCategories, setRadarCategories] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [monitoringId, setMonitoringId] = useState<string | null>(null);
    const [complaintCompetitor, setComplaintCompetitor] = useState("all");
    const [complaintType, setComplaintType] = useState("all");
    const [radarCategory, setRadarCategory] = useState("all");

    const loadCompetitors = useCallback(async () => {
        setLoading(true);
        try {
            const [competitionRes, complaintsRes, radarRes] = await Promise.all([
                fetch("/api/intelligence?section=competitors"),
                fetch("/api/competitor-complaints?limit=50"),
                fetch("/api/competitor-radar?limit=18"),
            ]);

            const [competitionResponse, complaintsResponse, radarResponse] = await Promise.all([
                competitionRes.json(),
                complaintsRes.json(),
                radarRes.json(),
            ]);

            if (!competitionRes.ok || !complaintsRes.ok || !radarRes.ok || competitionResponse?.error || complaintsResponse?.error || radarResponse?.error) {
                throw new Error(
                    competitionResponse?.error
                    || complaintsResponse?.error
                    || radarResponse?.error
                    || "Could not load data",
                );
            }

            setCompData(competitionResponse.data || []);
            setComplaints(complaintsResponse.complaints || []);
            setCompetitorOptions(complaintsResponse.competitors || []);
            setRadarClusters(radarResponse.clusters || []);
            setRadarCategories(radarResponse.categories || []);
            setError(null);
        } catch (err) {
            console.error(err);
            setCompData([]);
            setComplaints([]);
            setCompetitorOptions([]);
            setRadarClusters([]);
            setRadarCategories([]);
            setError("Could not load data");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isPremium) return;
        loadCompetitors();
    }, [isPremium, loadCompetitors]);

    const filteredComplaints = useMemo(() => {
        return complaints.filter((complaint) => {
            const competitors = complaint.competitors_mentioned || [];
            const signals = complaint.complaint_signals || [];
            const matchesCompetitor = complaintCompetitor === "all" || competitors.includes(complaintCompetitor);
            const matchesSignal = complaintType === "all" || signals.some((signal) => signal.toLowerCase().includes(complaintType));
            return matchesCompetitor && matchesSignal;
        });
    }, [complaintCompetitor, complaintType, complaints]);

    const filteredRadarClusters = useMemo(() => {
        return radarClusters.filter((cluster) => {
            const matchesCompetitor = complaintCompetitor === "all" || cluster.competitor === complaintCompetitor;
            const matchesCategory = radarCategory === "all" || cluster.weakness_category === radarCategory;
            return matchesCompetitor && matchesCategory;
        });
    }, [complaintCompetitor, radarCategory, radarClusters]);

    const radarSummary = useMemo(() => ({
        clusterCount: filteredRadarClusters.length,
        monitoredCount: filteredRadarClusters.filter((cluster) => cluster.monitor.is_monitored).length,
        highTrustCount: filteredRadarClusters.filter((cluster) => cluster.trust.level === "HIGH").length,
    }), [filteredRadarClusters]);

    async function handleMonitorCompetitor(cluster: RadarCluster) {
        if (cluster.monitor.is_monitored) return;

        setMonitoringId(cluster.id);
        try {
            const res = await fetch("/api/competitor-radar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    competitor: cluster.competitor,
                    category: cluster.weakness_category,
                }),
            });

            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload.error || "Could not create competitor monitor");
            }

            const payload = await res.json();
            setRadarClusters((current) =>
                current.map((item) =>
                    item.id === cluster.id
                        ? {
                            ...item,
                            monitor: {
                                ...item.monitor,
                                is_monitored: true,
                                alert_id: payload.alert_id || item.monitor.alert_id,
                            },
                        }
                        : item,
                ),
            );
        } catch (error) {
            console.error(error);
        } finally {
            setMonitoringId(null);
        }
    }

    if (!isPremium) return <PremiumGate feature="Competitor Tracking" />;

    return (
        <div className="max-w-5xl mx-auto p-6 md:p-8">
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <h1 className="text-[20px] font-bold font-display text-white flex items-center gap-2">
                    <Radar className="w-5 h-5 text-primary" /> Competitors
                </h1>
                <p className="text-[13px] text-muted-foreground mt-1">Competition landscape from your validated ideas</p>
            </motion.div>

            {error && (
                <div className="bento-cell p-5 rounded-2xl mb-6 border border-dont/20 bg-dont/5">
                    <p className="text-sm text-foreground/85 mb-3">Could not load data</p>
                    <button
                        onClick={loadCompetitors}
                        className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-foreground hover:bg-white/10"
                    >
                        Retry
                    </button>
                </div>
            )}

            <div className="bento-cell p-6 rounded-2xl mb-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h2 className="text-[15px] font-bold text-white">Competitor Weakness Radar</h2>
                        <p className="text-[12px] text-muted-foreground mt-1">
                            Repeated public complaints grouped into attackable weakness clusters.
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                        <select
                            value={radarCategory}
                            onChange={(event) => setRadarCategory(event.target.value)}
                            className="bg-surface-0 border border-white/10 rounded-lg px-3 py-2 text-xs text-foreground font-mono"
                        >
                            <option value="all">All weakness categories</option>
                            {radarCategories.map((category) => (
                                <option key={category} value={category}>{category}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <div className="text-[10px] font-mono uppercase text-muted-foreground">Weakness Clusters</div>
                        <div className="mt-2 text-2xl font-mono text-white">{radarSummary.clusterCount}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <div className="text-[10px] font-mono uppercase text-muted-foreground">High Trust Clusters</div>
                        <div className="mt-2 text-2xl font-mono text-build">{radarSummary.highTrustCount}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <div className="text-[10px] font-mono uppercase text-muted-foreground">Monitored Competitors</div>
                        <div className="mt-2 text-2xl font-mono text-white">{radarSummary.monitoredCount}</div>
                    </div>
                </div>

                <div className="mt-5 space-y-3">
                    {loading ? (
                        Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="rounded-xl border border-white/10 bg-white/5 p-4 h-[160px]" />
                        ))
                    ) : filteredRadarClusters.length > 0 ? (
                        filteredRadarClusters.slice(0, 12).map((cluster) => (
                            <div key={cluster.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap gap-2 mb-2">
                                            <span className="text-[10px] font-mono px-2 py-1 rounded border border-primary/20 bg-primary/10 text-primary">
                                                {cluster.competitor}
                                            </span>
                                            <span className="text-[10px] font-mono px-2 py-1 rounded border border-white/10 bg-white/5 text-muted-foreground">
                                                {cluster.weakness_category}
                                            </span>
                                            <span className={`text-[10px] font-mono px-2 py-1 rounded border uppercase tracking-[0.12em] ${trustTone(cluster.trust.level)}`}>
                                                {cluster.trust.label}
                                            </span>
                                        </div>

                                        <div className="text-sm text-white leading-relaxed">{cluster.summary}</div>

                                        <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-mono text-muted-foreground">
                                            <span>{cluster.evidence_count} evidence items</span>
                                            <span>{cluster.source_count} sources</span>
                                            <span>{cluster.freshness.freshness_label}</span>
                                            {cluster.affected_segment ? <span>Segment: {cluster.affected_segment}</span> : null}
                                        </div>

                                        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                                            <div className="text-[10px] font-mono uppercase text-muted-foreground">Representative Evidence</div>
                                            <div className="mt-2 text-sm text-white">
                                                {cluster.representative_evidence[0]?.title || "Repeated complaint evidence captured from public discussions."}
                                            </div>
                                            <p className="mt-2 text-sm text-white/80">
                                                {cluster.representative_evidence[0]?.snippet || "Direct complaint signals support this weakness cluster."}
                                            </p>
                                            <div className="mt-2 text-xs text-muted-foreground">
                                                {cluster.direct_vs_inferred.direct_evidence_count} direct evidence item
                                                {cluster.direct_vs_inferred.direct_evidence_count === 1 ? "" : "s"} support this cluster.
                                            </div>
                                        </div>

                                        <div className="mt-3 rounded-xl border border-build/15 bg-build/5 p-3">
                                            <div className="text-[10px] font-mono uppercase text-build">Wedge Opportunity Note</div>
                                            <p className="mt-2 text-sm text-white/85">{cluster.wedge_opportunity_note}</p>
                                            <div className="mt-2 text-xs text-muted-foreground">
                                                Inferred from repeated complaint patterns, not direct buyer quotes.
                                            </div>
                                        </div>

                                        {cluster.why_now && (
                                            <div className="mt-3 rounded-xl border border-primary/15 bg-primary/5 p-3">
                                                <div className="text-[10px] font-mono uppercase text-primary">Why Now</div>
                                                <div className="mt-2 text-sm text-white">{cluster.why_now.timing_category}</div>
                                                <p className="mt-2 text-sm text-white/80">{cluster.why_now.inferred_why_now_note}</p>
                                                <div className="mt-2 text-xs text-muted-foreground">
                                                    {cluster.why_now.momentum_direction} - {cluster.why_now.monitorable_change_note}
                                                </div>
                                            </div>
                                        )}

                                        {cluster.trust.weak_signal && cluster.trust.weak_signal_reasons.length > 0 && (
                                            <p className="mt-3 text-xs text-risky">
                                                Weak signal: {cluster.trust.weak_signal_reasons.join(" - ")}
                                            </p>
                                        )}
                                    </div>

                                    <div className="flex flex-col gap-2 lg:w-[180px]">
                                        <button
                                            onClick={() => handleMonitorCompetitor(cluster)}
                                            disabled={cluster.monitor.is_monitored || monitoringId === cluster.id}
                                            className={`rounded-lg px-3 py-2 text-xs font-mono border ${
                                                cluster.monitor.is_monitored
                                                    ? "border-build/20 bg-build/10 text-build"
                                                    : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                                            } disabled:cursor-not-allowed`}
                                        >
                                            {cluster.monitor.is_monitored
                                                ? "Monitoring"
                                                : monitoringId === cluster.id
                                                    ? "Creating..."
                                                    : "Monitor this competitor"}
                                        </button>

                                        {cluster.representative_evidence[0]?.url ? (
                                            <a
                                                href={cluster.representative_evidence[0].url || "#"}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center justify-center gap-1 text-xs font-mono text-primary hover:underline"
                                            >
                                                View evidence <ExternalLink className="w-3.5 h-3.5" />
                                            </a>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-muted-foreground">
                            No weakness clusters are strong enough yet. As more complaint evidence accumulates, the radar will surface clearer openings.
                        </div>
                    )}
                </div>
            </div>

            <div className="bento-cell p-6 rounded-2xl mb-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h2 className="text-[15px] font-bold text-white">Competitor Pain Signals</h2>
                        <p className="text-[12px] text-muted-foreground mt-1">
                            Real complaints from competitor users - your sales intelligence
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                        <select
                            value={complaintCompetitor}
                            onChange={(event) => setComplaintCompetitor(event.target.value)}
                            className="bg-surface-0 border border-white/10 rounded-lg px-3 py-2 text-xs text-foreground font-mono"
                        >
                            <option value="all">All competitors</option>
                            {competitorOptions.map((name) => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>

                        <select
                            value={complaintType}
                            onChange={(event) => setComplaintType(event.target.value)}
                            className="bg-surface-0 border border-white/10 rounded-lg px-3 py-2 text-xs text-foreground font-mono"
                        >
                            <option value="all">All complaint types</option>
                            <option value="expensive">Price</option>
                            <option value="support">Support</option>
                            <option value="feature">Features</option>
                            <option value="switch">Switching</option>
                        </select>
                    </div>
                </div>

                <div className="mt-5 space-y-3">
                    {loading ? (
                        Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="rounded-xl border border-white/10 bg-white/5 p-4 h-[88px]" />
                        ))
                    ) : filteredComplaints.length > 0 ? (
                        filteredComplaints.slice(0, 20).map((complaint, index) => (
                            <motion.div
                                key={`${complaint.post_title}-${index}`}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: Math.min(index * 0.03, 0.2) }}
                                className="rounded-xl border border-white/10 bg-white/5 p-4"
                            >
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap gap-2 mb-2">
                                            {(complaint.competitors_mentioned || []).map((name) => (
                                                <span key={name} className="text-[10px] font-mono px-2 py-1 rounded border border-primary/20 bg-primary/10 text-primary">
                                                    {name}
                                                </span>
                                            ))}
                                            {(complaint.complaint_signals || []).slice(0, 4).map((signal) => (
                                                <span key={signal} className="text-[10px] font-mono px-2 py-1 rounded border border-white/10 bg-white/5 text-muted-foreground">
                                                    {signal}
                                                </span>
                                            ))}
                                            <span className={`text-[10px] font-mono px-2 py-1 rounded border uppercase tracking-[0.12em] ${trustTone(complaint.trust?.level)}`}>
                                                {complaint.trust?.label || "Signal quality"}
                                            </span>
                                        </div>

                                        <div className="text-sm text-white leading-relaxed">{complaint.post_title}</div>
                                        <div className="flex flex-wrap gap-3 mt-2 text-[11px] font-mono text-muted-foreground">
                                            <span>{complaint.post_score} pts</span>
                                            {complaint.subreddit ? <span>r/{complaint.subreddit}</span> : null}
                                            <span>{timeAgo(complaint.scraped_at)}</span>
                                            {complaint.evidence_summary ? <span>{complaint.evidence_summary.freshness_label}</span> : null}
                                        </div>
                                        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                                            <div className="flex flex-wrap gap-2 text-[11px] font-mono text-muted-foreground">
                                                <span>{complaint.evidence_summary?.direct_evidence_count || 0} direct proof item</span>
                                                <span>{complaint.evidence_summary?.source_count || 0} sources</span>
                                            </div>
                                            <p className="mt-2 text-sm text-white/85">
                                                {complaint.evidence?.[0]?.snippet || "This complaint shows where an incumbent is frustrating users in public."}
                                            </p>
                                            {complaint.trust?.weak_signal && complaint.trust.weak_signal_reasons.length > 0 && (
                                                <p className="mt-2 text-xs text-risky">
                                                    Weak signal: {complaint.trust.weak_signal_reasons.join(" • ")}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {complaint.post_url && (
                                        <a
                                            href={complaint.post_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:underline"
                                        >
                                            View post <ExternalLink className="w-3.5 h-3.5" />
                                        </a>
                                    )}
                                </div>
                            </motion.div>
                        ))
                    ) : (
                        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-muted-foreground">
                            No competitor complaints this week - data updates every scrape
                        </div>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="mt-6 flex flex-col gap-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="bento-cell p-5 rounded-2xl h-[120px]" />
                    ))}
                </div>
            ) : compData.length > 0 ? (
                <StaggerContainer className="flex flex-col gap-4 mt-6">
                    {compData.map((item) => (
                        <StaggerItem key={item.validation_id}>
                            <div className="bento-cell p-6 rounded-2xl hover:bg-white/[0.03] transition-colors group">
                                <div className="flex items-start md:items-center gap-3 mb-5">
                                    <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
                                        <Target className="w-4 h-4 text-primary" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-[15px] font-bold text-white font-display leading-tight">{item.idea}</h3>
                                        <div className="flex gap-2 mt-1.5 flex-wrap">
                                            <GlowBadge color={getSaturationColor(item.market_saturation)}>
                                                Saturation: {item.market_saturation}
                                            </GlowBadge>
                                        </div>
                                    </div>
                                    <div className="text-[10px] text-muted-foreground font-mono flex-shrink-0 mt-1 md:mt-0">
                                        {new Date(item.created_at).toLocaleDateString()}
                                    </div>
                                </div>

                                {item.unfair_advantage !== "N/A" && (
                                    <div className="bg-build/5 border border-build/10 rounded-xl p-4 mb-5">
                                        <div className="text-[10px] text-build uppercase tracking-widest mb-1.5 flex items-center gap-1.5 font-bold">
                                            <Shield className="w-3 h-3" /> Your Unfair Advantage
                                        </div>
                                        <div className="text-[13px] text-white/90 leading-relaxed">{item.unfair_advantage}</div>
                                        {item.moat_strategy !== "N/A" && (
                                            <div className="text-[12px] text-muted-foreground/80 mt-2">Moat: {item.moat_strategy}</div>
                                        )}
                                    </div>
                                )}

                                {Array.isArray(item.direct_competitors) && item.direct_competitors.length > 0 && (
                                    <div className="mb-4">
                                        <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2 font-bold">
                                            Direct Competitors ({item.direct_competitors.length})
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            {item.direct_competitors.map((competitor, index) => (
                                                <div key={index} className="flex gap-3 p-3 bg-white/[0.02] rounded-lg border border-white/5">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-[13px] font-bold text-white mb-0.5">
                                                            {typeof competitor === "string" ? competitor : competitor.name || "Unknown"}
                                                        </div>
                                                        {typeof competitor !== "string" && competitor.weakness && (
                                                            <div className="flex items-start gap-1.5 text-[11px] text-dont/90 mt-1">
                                                                <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                                                <span className="leading-snug">{competitor.weakness}</span>
                                                            </div>
                                                        )}
                                                        {typeof competitor !== "string" && competitor.pricing && (
                                                            <div className="text-[11px] text-muted-foreground/80 mt-1">Pricing: {competitor.pricing}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {Array.isArray(item.indirect_competitors) && item.indirect_competitors.length > 0 && (
                                    <div>
                                        <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2 font-bold">
                                            Indirect Competitors ({item.indirect_competitors.length})
                                        </div>
                                        <div className="flex gap-1.5 flex-wrap">
                                            {item.indirect_competitors.map((competitor, index) => (
                                                <span key={index} className="text-[11px] px-2.5 py-1 rounded-md bg-white/5 text-muted-foreground border border-white/5">
                                                    {typeof competitor === "string" ? competitor : competitor.name || "Unknown"}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </StaggerItem>
                    ))}
                </StaggerContainer>
            ) : (
                <div className="bento-cell p-12 text-center rounded-2xl mt-6 flex flex-col items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-muted-foreground/30 mb-3" />
                    <p className="text-[14px] font-medium text-muted-foreground/80 mb-1">No competitor data yet</p>
                    <p className="text-[12px] text-muted-foreground/60">Run an idea validation - the AI will map the competitive landscape automatically.</p>
                </div>
            )}
        </div>
    );
}
