"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
    ArrowLeft, Loader2, AlertCircle, Zap, Users, Target,
    DollarSign, MessageSquare, Brain, FileText, Calendar,
    Shield, TrendingUp, Crosshair, BarChart3, Banknote, Clock, Bookmark
} from "lucide-react";
import { useUserPlan } from "@/lib/use-user-plan";
import { PremiumGate } from "@/app/components/premium-gate";
import type { DecisionPack } from "@/lib/decision-pack";
import { DebatePanel } from "@/app/components/DebatePanel";

/* ── Types ── */

type DebateLogEntry = {
    model: string;
    role: string;
    round: number;
    verdict: string;
    confidence: number;
    reasoning: string;
    changed?: boolean;
};

type DebateRoundGroup = {
    round: number;
    entries: DebateLogEntry[];
};

type ValidationReport = {
    id: string;
    idea_text: string;
    verdict: string;
    confidence: number;
    status: string;
    posts_found?: number;
    posts_analyzed?: number;
    created_at: string;
    report: Record<string, any>;
    decision_pack?: DecisionPack | null;
    trust?: {
        level: "HIGH" | "MEDIUM" | "LOW";
        label: string;
        score: number;
        evidence_count: number;
        direct_evidence_count: number;
        direct_quote_count: number;
        source_count: number;
        freshness_hours: number | null;
        freshness_label: string;
        weak_signal: boolean;
        weak_signal_reasons: string[];
        inference_flags: string[];
    };
};

/* ── Helpers ── */

function getVerdictStyle(v: string) {
    const u = (v || "").toUpperCase();
    if (u.includes("BUILD") && !u.includes("DON"))
        return { color: "text-build", bg: "bg-build/10", border: "border-build/20", icon: TrendingUp };
    if (u.includes("DON") || u.includes("REJECT"))
        return { color: "text-dont", bg: "bg-dont/10", border: "border-dont/20", icon: AlertCircle };
    return { color: "text-risky", bg: "bg-risky/10", border: "border-risky/20", icon: Shield };
}

function getThreatColor(level: string) {
    const u = (level || "").toUpperCase();
    if (u === "HIGH") return "bg-dont/15 border-dont/30 text-dont";
    if (u === "MEDIUM") return "bg-risky/15 border-risky/30 text-risky";
    return "bg-build/15 border-build/30 text-build";
}

function getSeverityColor(s: string) {
    const u = (s || "").toUpperCase();
    if (u === "HIGH") return "bg-dont/10 text-dont border-dont/20";
    if (u === "MEDIUM") return "bg-risky/10 text-risky border-risky/20";
    return "bg-build/10 text-build border-build/20";
}

function getTrustTone(level?: NonNullable<ValidationReport["trust"]>["level"]) {
    if (level === "HIGH") return "border-build/20 bg-build/10 text-build";
    if (level === "MEDIUM") return "border-risky/20 bg-risky/10 text-risky";
    return "border-dont/20 bg-dont/10 text-dont";
}

const SectionHeader = ({ icon: Icon, label, color }: { icon: any; label: string; color: string }) => (
    <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <h3 className={`font-mono text-[11px] uppercase tracking-widest font-bold ${color}`}>{label}</h3>
    </div>
);

const PlatformTag = ({ platform, count }: { platform: string; count: number }) => (
    <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded font-mono text-[11px] text-muted-foreground">
        {platform}: <span className="text-foreground font-bold">{count}</span>
    </span>
);

const Badge = ({ text, className }: { text: string; className: string }) => (
    <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold uppercase border ${className}`}>
        {text}
    </span>
);

const EmptySectionState = ({ text }: { text: string }) => (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-muted-foreground">
        {text}
    </div>
);

const DecisionPackCard = ({
    label,
    accent,
    children,
}: {
    label: string;
    accent: string;
    children: ReactNode;
}) => (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className={`font-mono text-[10px] uppercase tracking-[0.14em] ${accent}`}>{label}</div>
        <div className="mt-2">{children}</div>
    </div>
);

function getMomentumLabel(direction?: DecisionPack["why_now"]["momentum_direction"]) {
    if (direction === "accelerating") return "Accelerating";
    if (direction === "steady") return "Steady";
    if (direction === "cooling") return "Cooling";
    if (direction === "new") return "New";
    return "Unclear";
}

/* ── Component ── */

export default function ReportDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const { isPremium } = useUserPlan();
    const [report, setReport] = useState<ValidationReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<"report" | "debate">("report");
    const [savedToWatchlist, setSavedToWatchlist] = useState(false);
    const [watchlistLoading, setWatchlistLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const resp = await fetch(`/api/validate/${id}`, { cache: "no-store" });
            const payload = await resp.json();
            const data = payload?.validation;
            if (data) {
                let parsed: Record<string, any> = {};
                try {
                    parsed = typeof data.report === "string" ? JSON.parse(data.report) : (data.report || {});
                } catch {
                    parsed = {};
                }
                setReport({ ...data, report: parsed } as ValidationReport);
            } else {
                setReport(null);
            }
        } catch {
            setReport(null);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { if (isPremium) load(); }, [isPremium, load]);

    useEffect(() => {
        if (!isPremium || !id) return;
        fetch(`/api/watchlist?validation_id=${id}`)
            .then((resp) => resp.ok ? resp.json() : { saved: false })
            .then((payload) => setSavedToWatchlist(Boolean(payload.saved)))
            .catch(() => setSavedToWatchlist(false));
    }, [id, isPremium]);

    const toggleWatchlist = useCallback(async () => {
        if (!id || watchlistLoading) return;
        setWatchlistLoading(true);
        try {
            const resp = await fetch("/api/watchlist", {
                method: savedToWatchlist ? "DELETE" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ validation_id: id }),
            });
            if (resp.ok) {
                setSavedToWatchlist((prev) => !prev);
                return;
            }
            const payload = await resp.json().catch(() => ({}));
            console.error("Watchlist toggle failed:", payload.error || resp.statusText);
        } finally {
            setWatchlistLoading(false);
        }
    }, [id, savedToWatchlist, watchlistLoading]);

    if (!isPremium) return <PremiumGate feature="Validation Reports" />;

    if (loading) return (
        <div className="flex items-center justify-center p-20 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="font-mono text-sm text-muted-foreground uppercase tracking-widest">Decoding Report Matrix</span>
        </div>
    );

    if (!report) return (
        <div className="flex flex-col items-center justify-center p-20 text-center gap-4">
            <AlertCircle className="w-10 h-10 text-muted-foreground opacity-50" />
            <p className="font-mono text-sm text-foreground">File not found or encrypted.</p>
            <button onClick={() => router.push("/dashboard/reports")} className="text-primary font-mono text-[11px] uppercase tracking-widest hover:underline">
                Return to Directory
            </button>
        </div>
    );

    const r = report.report;
    const vs = getVerdictStyle(report.verdict);
    const VIcon = vs.icon;
    const trust = report.trust;
    const decisionPack = report.decision_pack;

    // ── Data extraction ──
    const execSummary = String(r.executive_summary || r.summary || "");
    const roadmap = (r.launch_roadmap || r.action_plan || []) as Array<Record<string, any>>;
    const icp = (r.ideal_customer_profile || r.audience_validation || {}) as Record<string, any>;
    const comp = (r.competition_landscape || r.competitor_gaps || {}) as Record<string, any>;
    const pricing = (r.pricing_strategy || r.price_signals || {}) as Record<string, any>;
    const market = (r.market_analysis || {}) as Record<string, any>;
    const risks = (r.risk_matrix || r.risk_factors || []) as Array<Record<string, any>>;
    const financial = (r.financial_reality || {}) as Record<string, any>;
    const signalSummary = (r.signal_summary || {}) as Record<string, any>;
    const first10 = (r.first_10_customers_strategy || {}) as Record<string, any>;
    const monetizationChannels = Array.isArray(r.monetization_channels) ? r.monetization_channels : [];
    const mvpFeatures = Array.isArray(r.mvp_features) ? r.mvp_features : [];
    const cutFeatures = Array.isArray(r.cut_features) ? r.cut_features : [];
    const platformWarnings = Array.isArray(r?.data_quality?.platform_warnings)
        ? r.data_quality.platform_warnings
        : (Array.isArray(r.platform_warnings) ? r.platform_warnings : []);

    // Post counts
    const postsFound = r.posts_scraped || report.posts_found || 0;
    const postsAnalyzed = r.posts_analyzed || report.posts_analyzed || 0;

    // Evidence merge
    const marketEvidence = Array.isArray(market.evidence) ? market.evidence : [];
    const debateEvidence = Array.isArray(r.debate_evidence || r.evidence) ? (r.debate_evidence || r.evidence) : [];
    const topPosts = Array.isArray(r.top_posts) ? r.top_posts : [];
    const evidence = debateEvidence.length > 0 ? debateEvidence : (marketEvidence.length > 0 ? marketEvidence : topPosts);
    const evidencePoints = Number(r.evidence_count || debateEvidence.length || marketEvidence.length || topPosts.length || 0);

    const dataSources = (r.data_sources || {}) as Record<string, number>;
    const trends = (r.trends_data || {}) as Record<string, any>;
    const competitors = Array.isArray(comp.direct_competitors) ? comp.direct_competitors : [];

    // ICP arrays
    const communities = Array.isArray(icp.specific_communities) ? icp.specific_communities : [];
    const influencers = Array.isArray(icp.influencers_they_follow) ? icp.influencers_they_follow : [];
    const tools = Array.isArray(icp.tools_they_already_use) ? icp.tools_they_already_use : [];
    const objections = Array.isArray(icp.buying_objections) ? icp.buying_objections : [];
    const prevSolutions = Array.isArray(icp.previous_solutions_tried) ? icp.previous_solutions_tried : [];
    const wtpEvidence = Array.isArray(icp.willingness_to_pay_evidence) ? icp.willingness_to_pay_evidence : [];

    // Debate
    const debateMode = Boolean(r.debate_mode);
    const modelsUsed = (r.models_used || []) as string[];
    const debateTranscript = r.debate_transcript ?? null;
    const debateLogRaw = (r.debate_log || []) as DebateLogEntry[];
    const debateLog = debateLogRaw.reduce<DebateRoundGroup[]>((groups, entry) => {
        const safeRound = Number(entry.round || 1);
        const existing = groups.find(group => group.round === safeRound);
        const normalized = { ...entry, round: safeRound };
        if (existing) {
            existing.entries.push(normalized);
        } else {
            groups.push({ round: safeRound, entries: [normalized] });
        }
        return groups;
    }, []).sort((a, b) => a.round - b.round);

    const tabs = [
        { key: "report" as const, label: "Intelligence", icon: FileText },
        { key: "debate" as const, label: "Debate Room", icon: Brain, badge: debateMode ? modelsUsed.length : 0 },
    ];

    return (
        <div className="w-full max-w-6xl mx-auto pt-6 px-4 lg:px-8 pb-20">
            {/* Header */}
            <button
                onClick={() => router.push("/dashboard/reports")}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground font-mono text-[11px] uppercase tracking-widest transition-colors mb-6"
            >
                <ArrowLeft className="w-3 h-3" /> Back
            </button>

            {/* Top Identity Card */}
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bento-cell p-5 mb-4">
                <div className="flex flex-col lg:flex-row gap-5 justify-between items-start">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 mb-3 flex-wrap">
                            <div className={`px-2.5 py-1 rounded-full flex items-center gap-1.5 border ${vs.bg} ${vs.border} ${vs.color} font-mono text-[11px] uppercase font-bold tracking-widest`}>
                                <VIcon className="w-3 h-3" /> {report.verdict}
                            </div>
                            {debateMode && (
                                <span className="font-mono text-[11px] uppercase tracking-wider text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded">
                                    ⚡ {modelsUsed.length} Model Nexus
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={toggleWatchlist}
                                disabled={watchlistLoading}
                                className={`inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest px-2.5 py-1 rounded-full border transition-colors ${
                                    savedToWatchlist
                                        ? "bg-primary/10 border-primary/20 text-primary"
                                        : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                <Bookmark className="w-3 h-3" />
                                {watchlistLoading ? "Saving" : savedToWatchlist ? "Saved to Watchlist" : "Save to Watchlist"}
                            </button>
                        </div>
                        <p className="text-sm text-foreground/90 leading-relaxed line-clamp-2 mb-3 max-w-3xl" title={report.idea_text}>
                            {report.idea_text}
                        </p>
                        <div className="flex gap-2 flex-wrap">
                            {Object.entries(dataSources).map(([p, c]) => (
                                <PlatformTag key={p} platform={p} count={c} />
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col items-center justify-center min-w-[100px]">
                        <div className="relative w-20 h-20 flex items-center justify-center">
                            <svg className="absolute inset-0 w-full h-full -rotate-90">
                                <circle cx="40" cy="40" r="34" fill="none" className="stroke-white/5" strokeWidth="5" />
                                <motion.circle
                                    cx="40" cy="40" r="34" fill="none"
                                    className={`stroke-current ${vs.color}`} strokeWidth="5" strokeLinecap="round"
                                    strokeDasharray={2 * Math.PI * 34}
                                    initial={{ strokeDashoffset: 2 * Math.PI * 34 }}
                                    animate={{ strokeDashoffset: (2 * Math.PI * 34) * (1 - report.confidence / 100) }}
                                    transition={{ duration: 1.5, ease: "easeOut" }}
                                />
                            </svg>
                            <div className="flex flex-col items-center justify-center">
                                <div className={`font-mono text-lg font-bold ${vs.color}`}>{report.confidence}%</div>
                                <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mt-0.5">Confidence</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* KPI Bar */}
                <div className="mt-5 pt-4 border-t border-white/5 grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Posts Found</div>
                        <div className="font-mono text-xl text-foreground font-bold">{postsFound.toLocaleString()}</div>
                    </div>
                    <div>
                        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Posts Analyzed</div>
                        <div className="font-mono text-xl text-primary font-bold">{postsAnalyzed.toLocaleString()}</div>
                    </div>
                    <div>
                        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Evidence Points</div>
                        <div className="font-mono text-xl text-blue-400 font-bold">{evidencePoints}</div>
                    </div>
                    <div>
                        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Risk Factors</div>
                        <div className="font-mono text-xl text-dont font-bold">{risks.length}</div>
                    </div>
                </div>

                {trust && (
                    <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                            <div>
                                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-[0.12em] ${getTrustTone(trust.level)}`}>
                                    {trust.label}
                                    <span className="text-current/80">{trust.score}/100</span>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 text-sm text-muted-foreground md:grid-cols-3">
                                <div>
                                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Evidence</div>
                                    <div className="mt-1 text-white">{trust.evidence_count} evidence points</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Direct proof</div>
                                    <div className="mt-1 text-white">{trust.direct_quote_count} direct quotes</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Freshness</div>
                                    <div className="mt-1 text-white">{trust.freshness_label}</div>
                                </div>
                            </div>
                        </div>

                        {trust.weak_signal && trust.weak_signal_reasons.length > 0 && (
                            <div className="mt-4 rounded-xl border border-risky/20 bg-risky/8 p-3 text-sm text-risky">
                                Weak signal: {trust.weak_signal_reasons.join(" • ")}
                            </div>
                        )}

                        {trust.inference_flags.length > 0 && (
                            <div className="mt-3 text-xs text-muted-foreground">
                                Inference notes: {trust.inference_flags.join(" • ")}
                            </div>
                        )}
                    </div>
                )}

                {decisionPack && (
                    <div className="mt-5 rounded-2xl border border-primary/15 bg-primary/[0.04] p-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="max-w-3xl">
                                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Decision Pack</div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-[0.12em] ${vs.bg} ${vs.border} ${vs.color}`}>
                                        <VIcon className="h-3.5 w-3.5" />
                                        {decisionPack.verdict.label}
                                    </div>
                                    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-[0.12em] ${getTrustTone(decisionPack.confidence.level)}`}>
                                        {decisionPack.confidence.label}
                                        <span className="text-current/80">{decisionPack.confidence.score}/100</span>
                                    </div>
                                </div>
                                <p className="mt-3 text-sm leading-relaxed text-foreground/90">{decisionPack.verdict.rationale}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{decisionPack.confidence.proof_summary}</p>
                            </div>

                            <div className="grid min-w-[240px] grid-cols-2 gap-3 text-sm text-muted-foreground sm:grid-cols-3">
                                <div>
                                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Proof</div>
                                    <div className="mt-1 text-white">{decisionPack.demand_proof.evidence_count} signals</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Sources</div>
                                    <div className="mt-1 text-white">{decisionPack.demand_proof.source_count} sources</div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">Freshness</div>
                                    <div className="mt-1 text-white">{decisionPack.demand_proof.freshness_label}</div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
                            <DecisionPackCard label="Demand Proof" accent="text-primary">
                                <p className="text-sm text-foreground/90">{decisionPack.demand_proof.summary}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{decisionPack.demand_proof.proof_summary}</p>
                                {decisionPack.demand_proof.representative_evidence.length > 0 && (
                                    <div className="mt-3 space-y-2">
                                        {decisionPack.demand_proof.representative_evidence.slice(0, 2).map((item) => (
                                            <div key={item.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                                                <div className="text-xs font-semibold text-white">{item.title}</div>
                                                {item.snippet && <p className="mt-1 text-xs text-muted-foreground">{item.snippet}</p>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </DecisionPackCard>

                            <DecisionPackCard label="Buyer Clarity" accent="text-cyan-400">
                                <p className="text-sm text-foreground/90">{decisionPack.buyer_clarity.summary}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{decisionPack.buyer_clarity.wedge_summary}</p>
                                {decisionPack.buyer_clarity.buying_triggers.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {decisionPack.buyer_clarity.buying_triggers.map((trigger, index) => (
                                            <span key={`${trigger}-${index}`} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">
                                                {trigger}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </DecisionPackCard>

                            <DecisionPackCard label="Competitor Gap" accent="text-dont">
                                <p className="text-sm text-foreground/90">{decisionPack.competitor_gap.summary}</p>
                                <p className="mt-2 text-xs text-dont/80">{decisionPack.competitor_gap.strongest_gap}</p>
                                {decisionPack.competitor_gap.live_weakness && (
                                    <div className="mt-3 rounded-xl border border-dont/15 bg-dont/5 p-3">
                                        <div className="text-[11px] font-mono uppercase tracking-widest text-dont">
                                            {decisionPack.competitor_gap.live_weakness.competitor} - {decisionPack.competitor_gap.live_weakness.weakness_category}
                                        </div>
                                        <p className="mt-1 text-xs text-foreground/80">{decisionPack.competitor_gap.live_weakness.wedge_opportunity_note}</p>
                                    </div>
                                )}
                            </DecisionPackCard>

                            <DecisionPackCard label="Why Now" accent="text-amber-400">
                                <div className="flex items-center gap-2">
                                    <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-widest text-amber-300">
                                        {decisionPack.why_now.timing_category}
                                    </span>
                                    <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                                        {getMomentumLabel(decisionPack.why_now.momentum_direction)}
                                    </span>
                                </div>
                                <p className="mt-3 text-sm text-foreground/90">{decisionPack.why_now.summary}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{decisionPack.why_now.inferred_why_now_note}</p>
                            </DecisionPackCard>

                            <DecisionPackCard label="Revenue Path" accent="text-emerald-300">
                                <div className="flex items-center gap-2">
                                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-widest text-emerald-300">
                                        {decisionPack.revenue_path.recommended_entry_mode}
                                    </span>
                                    <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                                        {decisionPack.revenue_path.speed_to_revenue_band}
                                    </span>
                                </div>
                                <p className="mt-3 text-sm text-foreground/90">{decisionPack.revenue_path.summary}</p>
                                <div className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3">
                                    <div className="text-[11px] font-mono uppercase tracking-widest text-emerald-300">First offer</div>
                                    <p className="mt-1 text-sm text-white">{decisionPack.revenue_path.first_offer_suggestion}</p>
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">Pricing test: {decisionPack.revenue_path.pricing_test_suggestion}</p>
                                <p className="mt-2 text-xs text-muted-foreground">First customers: {decisionPack.revenue_path.first_customer_path}</p>
                            </DecisionPackCard>

                            <DecisionPackCard label="First Customer Path" accent="text-violet-300">
                                <div className="flex items-center gap-2">
                                    <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-widest text-violet-300">
                                        {decisionPack.first_customer.primary_channel}
                                    </span>
                                    <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                                        {decisionPack.first_customer.confidence_score}/100
                                    </span>
                                </div>
                                <p className="mt-3 text-sm text-foreground/90">{decisionPack.first_customer.likely_first_customer_archetype}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{decisionPack.first_customer.first_outreach_angle}</p>
                                <div className="mt-3 rounded-xl border border-violet-400/15 bg-violet-400/5 p-3">
                                    <div className="text-[11px] font-mono uppercase tracking-widest text-violet-300">First proof path</div>
                                    <p className="mt-1 text-sm text-white">{decisionPack.first_customer.first_proof_path}</p>
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">Validation motion: {decisionPack.first_customer.best_initial_validation_motion}</p>
                            </DecisionPackCard>

                            <DecisionPackCard label="Market Attack" accent="text-fuchsia-300">
                                <div className="flex flex-wrap items-center gap-2">
                                    {decisionPack.market_attack.best_overall_attack_mode && (
                                        <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-400/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-widest text-fuchsia-300">
                                            {decisionPack.market_attack.best_overall_attack_mode.mode}
                                        </span>
                                    )}
                                    {decisionPack.market_attack.best_fastest_revenue_mode && (
                                        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                                            Fastest revenue: {decisionPack.market_attack.best_fastest_revenue_mode.mode}
                                        </span>
                                    )}
                                </div>
                                <p className="mt-3 text-sm text-foreground/90">
                                    {decisionPack.market_attack.best_overall_attack_mode?.reason || "Market attack strategy is still being inferred from the current report."}
                                </p>
                                <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                                    {decisionPack.market_attack.best_lowest_risk_mode && (
                                        <div>Lowest risk: {decisionPack.market_attack.best_lowest_risk_mode.mode}</div>
                                    )}
                                    {decisionPack.market_attack.most_scalable_mode && (
                                        <div>Most scalable: {decisionPack.market_attack.most_scalable_mode.mode}</div>
                                    )}
                                </div>
                                {decisionPack.market_attack.tradeoff_notes.length > 0 && (
                                    <div className="mt-3 space-y-2">
                                        {decisionPack.market_attack.tradeoff_notes.slice(0, 2).map((note, index) => (
                                            <div key={`${note}-${index}`} className="rounded-xl border border-fuchsia-400/15 bg-fuchsia-400/5 p-3 text-xs text-foreground/85">
                                                {note}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </DecisionPackCard>

                            <DecisionPackCard label="Productization Posture" accent="text-sky-300">
                                <div className="flex items-center gap-2">
                                    <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-widest text-sky-300">
                                        {decisionPack.service_first_pathfinder.recommended_productization_posture}
                                    </span>
                                    <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                                        {decisionPack.service_first_pathfinder.productization_readiness_score}/100
                                    </span>
                                </div>
                                <p className="mt-3 text-sm text-foreground/90">{decisionPack.service_first_pathfinder.posture_rationale}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{decisionPack.service_first_pathfinder.strongest_reason_for_posture}</p>
                                <div className="mt-3 rounded-xl border border-sky-400/15 bg-sky-400/5 p-3">
                                    <div className="text-[11px] font-mono uppercase tracking-widest text-sky-300">Main caution</div>
                                    <p className="mt-1 text-sm text-white">{decisionPack.service_first_pathfinder.strongest_caution}</p>
                                </div>
                                <div className="mt-3 space-y-2">
                                    {decisionPack.service_first_pathfinder.what_must_become_true_before_productization.slice(0, 2).map((item, index) => (
                                        <div key={`${item}-${index}`} className="rounded-xl border border-sky-400/15 bg-sky-400/5 p-3 text-xs text-foreground/85">
                                            {item}
                                        </div>
                                    ))}
                                </div>
                            </DecisionPackCard>

                            <DecisionPackCard label="Reasons Not To Act Yet" accent="text-risky">
                                <div className="flex items-center gap-2">
                                    <span className="rounded-full border border-risky/20 bg-risky/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-widest text-risky">
                                        {decisionPack.anti_idea.verdict.label.replace(/_/g, " ")}
                                    </span>
                                    <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                                        {decisionPack.anti_idea.confidence_score}/100
                                    </span>
                                </div>
                                <p className="mt-3 text-sm text-foreground/90">{decisionPack.anti_idea.verdict.summary}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{decisionPack.anti_idea.strongest_reason_to_wait_pivot_or_kill}</p>
                                <div className="mt-3 space-y-2">
                                    {decisionPack.anti_idea.what_would_need_to_improve.slice(0, 2).map((item, index) => (
                                        <div key={`${item}-${index}`} className="rounded-xl border border-risky/15 bg-risky/5 p-3 text-xs text-foreground/85">
                                            {item}
                                        </div>
                                    ))}
                                </div>
                            </DecisionPackCard>

                            <DecisionPackCard label="Next Move" accent="text-build">
                                <p className="text-sm text-foreground/90">{decisionPack.next_move.summary}</p>
                                <div className="mt-3 rounded-xl border border-build/20 bg-build/5 p-3">
                                    <div className="text-[11px] font-mono uppercase tracking-widest text-build">Recommended action</div>
                                    <p className="mt-1 text-sm text-white">{decisionPack.next_move.recommended_action}</p>
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">First step: {decisionPack.next_move.first_step}</p>
                            </DecisionPackCard>

                            <DecisionPackCard label="Kill Criteria" accent="text-risky">
                                <p className="text-sm text-foreground/90">{decisionPack.kill_criteria.summary}</p>
                                <div className="mt-3 space-y-2">
                                    {decisionPack.kill_criteria.items.map((item, index) => (
                                        <div key={`${item}-${index}`} className="rounded-xl border border-risky/15 bg-risky/5 p-3 text-xs text-foreground/85">
                                            {item}
                                        </div>
                                    ))}
                                </div>
                            </DecisionPackCard>
                        </div>
                    </div>
                )}
            </motion.div>

            {/* TAB BAR */}
            <div className="flex gap-3 mb-6">
                {tabs.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setActiveTab(t.key)}
                        className={`px-4 py-2 rounded-xl flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest transition-all ${
                            activeTab === t.key ? "bg-primary/10 border border-primary/30 text-primary shadow-[0_0_15px_rgba(255,69,0,0.1)]" : "bg-white/5 border border-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                        }`}
                    >
                        <t.icon className="w-3.5 h-3.5" />
                        {t.label}
                        {(t.badge ?? 0) > 0 && (
                            <span className="bg-primary text-primary-foreground text-[11px] px-1.5 py-0.5 rounded ml-1 font-bold">
                                {t.badge}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* TAB CONTENT */}
            <AnimatePresence mode="wait">
                {activeTab === "report" ? (
                    <motion.div key="report" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-6">

                        {platformWarnings.length > 0 && (
                            <div className="bento-cell p-5 border border-risky/20 bg-risky/5">
                                <SectionHeader icon={AlertCircle} label="Coverage Warnings" color="text-risky" />
                                <div className="mt-3 space-y-2">
                                    {platformWarnings.map((warning: any, index: number) => (
                                        <p key={`${warning?.platform || "warning"}-${index}`} className="text-sm text-foreground/85">
                                            {String(warning?.issue || warning)}
                                        </p>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ════════ Executive Summary ════════ */}
                        <div className="bento-cell p-6 bg-primary/5 border-primary/20">
                            <SectionHeader icon={Zap} label="Executive Synthesis" color="text-primary" />
                            {execSummary ? (
                                <p className="text-sm text-foreground/90 leading-relaxed max-w-4xl mt-3">{execSummary}</p>
                            ) : (
                                <EmptySectionState text="Executive summary is unavailable for this validation. The report still completed, but the top-line synthesis did not come through." />
                            )}
                        </div>

                        <DebatePanel transcript={debateTranscript} />

                        {/* ════════ Signal Summary ════════ */}
                        <div className="bento-cell p-6">
                            <SectionHeader icon={BarChart3} label="Signal Summary" color="text-cyan-400" />
                            {Object.keys(signalSummary).length > 0 ? (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-4">
                                    {[
                                        { label: "Posts Scraped", value: signalSummary.posts_scraped, color: "text-foreground" },
                                        { label: "Posts Analyzed", value: signalSummary.posts_analyzed, color: "text-primary" },
                                        { label: "Pain Quotes", value: signalSummary.pain_quotes_found, color: "text-dont" },
                                        { label: "WTP Signals", value: signalSummary.wtp_signals_found, color: "text-build" },
                                        { label: "Competitor Mentions", value: signalSummary.competitor_mentions, color: "text-risky" },
                                    ].map((stat, i) => (
                                        <div key={i} className="bg-white/5 border border-white/5 rounded-lg p-3 text-center">
                                            <div className={`font-mono text-lg font-bold ${stat.color}`}>{stat.value ?? 0}</div>
                                            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mt-1">{stat.label}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <EmptySectionState text="Signal summary data is missing for this run, so post coverage and extracted signal counts cannot be shown here." />
                            )}
                        </div>

                        {/* ════════ ICP — Persona Card ════════ */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="bento-cell p-6">
                                <SectionHeader icon={Users} label="Ideal Customer Profile" color="text-blue-400" />
                                {typeof icp === 'object' && Object.keys(icp).length > 0 ? (
                                    <div className="flex flex-col gap-4 mt-4">
                                        {/* Primary Persona */}
                                        {icp.primary_persona && (
                                            <div className="bg-blue-500/5 border border-blue-400/20 rounded-lg p-4">
                                                <div className="font-mono text-[11px] uppercase tracking-widest text-blue-400 mb-2 font-bold">Primary Persona</div>
                                                <p className="text-sm text-foreground/90 leading-relaxed">{String(icp.primary_persona)}</p>
                                            </div>
                                        )}

                                        {/* Day in the Life */}
                                        {icp.day_in_the_life && (
                                            <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                                                <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2 font-bold">📅 Day in the Life</div>
                                                <p className="text-xs text-foreground/80 leading-relaxed italic">{String(icp.day_in_the_life)}</p>
                                            </div>
                                        )}

                                        {/* Demographics + Psychographics */}
                                        {(icp.demographics || icp.psychographics) && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {icp.demographics && (
                                                    <div>
                                                        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5 font-bold">Demographics</div>
                                                        <p className="text-xs text-foreground/80">{String(icp.demographics)}</p>
                                                    </div>
                                                )}
                                                {icp.psychographics && (
                                                    <div>
                                                        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5 font-bold">Psychographics</div>
                                                        <p className="text-xs text-foreground/80">{String(icp.psychographics)}</p>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Communities + Influencers chips */}
                                        {communities.length > 0 && (
                                            <div>
                                                <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2 font-bold">🏘️ Communities</div>
                                                <div className="flex flex-wrap gap-2">
                                                    {communities.map((c: any, i: number) => (
                                                        <span key={i} className="bg-blue-500/10 border border-blue-400/20 text-blue-300 px-2.5 py-1 rounded-lg text-[11px] font-mono">
                                                            {typeof c === 'string' ? c : `${c.name} (${c.subscribers || c.monthly_active || ''})`}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {influencers.length > 0 && (
                                            <div>
                                                <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2 font-bold">📣 Influencers They Follow</div>
                                                <div className="flex flex-col gap-1.5">
                                                    {influencers.map((inf: any, i: number) => (
                                                        <div key={i} className="text-xs text-foreground/70">• {String(inf)}</div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {tools.length > 0 && (
                                            <div>
                                                <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2 font-bold">🛠️ Tools They Use</div>
                                                <div className="flex flex-wrap gap-2">
                                                    {tools.map((t: any, i: number) => (
                                                        <span key={i} className="bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg text-[11px] font-mono text-foreground/70">
                                                            {String(t)}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Buying Objections */}
                                        {objections.length > 0 && (
                                            <div>
                                                <div className="font-mono text-[11px] uppercase tracking-widest text-dont mb-2 font-bold">🚫 Buying Objections</div>
                                                <div className="flex flex-col gap-1.5">
                                                    {objections.map((obj: any, i: number) => (
                                                        <div key={i} className="text-xs text-dont/80 bg-dont/5 border border-dont/10 rounded px-3 py-1.5">
                                                            {String(obj)}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* WTP Evidence */}
                                        {wtpEvidence.length > 0 && (
                                            <div>
                                                <div className="font-mono text-[11px] uppercase tracking-widest text-build mb-2 font-bold">💰 WTP Evidence</div>
                                                <div className="flex flex-col gap-1.5">
                                                    {wtpEvidence.map((w: any, i: number) => (
                                                        <div key={i} className="text-xs text-build/80 bg-build/5 border border-build/10 rounded px-3 py-1.5 italic">
                                                            {String(w)}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Budget + Triggers */}
                                        {(icp.budget_range || icp.buying_triggers) && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/5">
                                                {icp.budget_range && (
                                                    <div>
                                                        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-1 font-bold">Budget</div>
                                                        <div className="text-sm text-build font-mono font-bold">{String(icp.budget_range)}</div>
                                                    </div>
                                                )}
                                                {Array.isArray(icp.buying_triggers) && icp.buying_triggers.length > 0 && (
                                                    <div>
                                                        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-1 font-bold">Buying Triggers</div>
                                                        {icp.buying_triggers.map((tr: any, i: number) => (
                                                            <div key={i} className="text-xs text-foreground/70">→ {String(tr)}</div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <EmptySectionState text="Ideal customer profile data is missing for this validation, so persona, communities, objections, and buying triggers cannot be shown." />
                                )}
                            </div>

                            {/* ════════ Pricing ════════ */}
                            <div className="bento-cell p-6">
                                <SectionHeader icon={DollarSign} label="Price Signals & WTP" color="text-build" />
                                {typeof pricing === 'object' && Object.keys(pricing).length > 0 ? (
                                    pricing.tiers && Array.isArray(pricing.tiers) ? (
                                        <div className="flex flex-col gap-3 mt-4">
                                            {(pricing.tiers as any[]).map((tier, i) => (
                                                <div key={i} className="bg-build/5 border border-build/10 rounded-lg p-3">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className="font-bold text-build text-sm">{tier.name || `Tier ${i+1}`}</span>
                                                        <span className="font-mono text-build bg-build/10 px-2 py-0.5 rounded text-[11px]">{tier.price}</span>
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">{tier.description || tier.target || tier.purpose}</div>
                                                    {tier.features && Array.isArray(tier.features) && (
                                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                                            {tier.features.map((f: string, j: number) => (
                                                                <span key={j} className="text-[11px] font-mono bg-white/5 border border-white/5 px-1.5 py-0.5 rounded text-foreground/60">{f}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                            {pricing.reasoning && (
                                                <p className="text-xs text-muted-foreground italic mt-1">{String(pricing.reasoning)}</p>
                                            )}
                                        </div>
                                    ) : pricing.recommended_model ? (
                                        <div className="text-sm mt-4">
                                            <div className="text-muted-foreground">Model: <span className="text-foreground font-bold">{String(pricing.recommended_model)}</span></div>
                                            {pricing.price_range && <div className="text-muted-foreground mt-1">Range: <span className="text-build font-mono">{String(pricing.price_range)}</span></div>}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-foreground/90 mt-4">{JSON.stringify(pricing)}</p>
                                    )
                                ) : (
                                    <EmptySectionState text="Pricing and willingness-to-pay details are missing for this validation." />
                                )}
                            </div>
                        </div>

                        {/* ════════ Market Timing ════════ */}
                        <div className="bento-cell p-6">
                            <SectionHeader icon={Clock} label="Market Timing Intelligence" color="text-amber-400" />
                            {(market.market_timing || market.tam_estimate || market.pain_validated !== undefined || market.willingness_to_pay) ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                    {market.market_timing && (
                                        <div className="bg-amber-500/5 border border-amber-400/20 rounded-lg p-4">
                                            <div className="font-mono text-[11px] uppercase tracking-widest text-amber-400 mb-2 font-bold">Timing Assessment</div>
                                            <p className="text-sm text-foreground/90 leading-relaxed">{String(market.market_timing)}</p>
                                        </div>
                                    )}
                                    {market.tam_estimate && (
                                        <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                                            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2 font-bold">TAM Estimate</div>
                                            <p className="text-sm text-foreground/90 leading-relaxed">{String(market.tam_estimate)}</p>
                                        </div>
                                    )}
                                    {market.pain_validated !== undefined && (
                                        <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                                            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2 font-bold">Pain Validated</div>
                                            <Badge text={market.pain_validated ? "YES" : "NO"} className={market.pain_validated ? "bg-build/10 border-build/20 text-build" : "bg-dont/10 border-dont/20 text-dont"} />
                                            {market.pain_description && <p className="text-xs text-foreground/70 mt-2">{String(market.pain_description)}</p>}
                                        </div>
                                    )}
                                    {market.willingness_to_pay && (
                                        <div className="bg-white/5 border border-white/5 rounded-lg p-4">
                                            <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-2 font-bold">Willingness to Pay</div>
                                            <p className="text-sm text-foreground/90">{String(market.willingness_to_pay)}</p>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <EmptySectionState text="Market timing data is unavailable for this validation, so timing, TAM, pain validation, and willingness-to-pay cannot be summarized here." />
                            )}
                        </div>

                        {/* ════════ Competition Matrix ════════ */}
                        <div className="bento-cell p-6">
                            {typeof comp === 'object' && Object.keys(comp).length > 0 ? (
                                <>
                                <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                                    <SectionHeader icon={Target} label="Competition Network" color="text-dont" />
                                    <div className="flex gap-2 flex-wrap">
                                        {comp.market_saturation && (
                                            <Badge text={String(comp.market_saturation)} className={
                                                String(comp.market_saturation).toUpperCase().includes("SATURATED") || String(comp.market_saturation).toUpperCase() === "HIGH"
                                                    ? "bg-dont/10 border-dont/30 text-dont"
                                                    : "bg-build/10 border-build/30 text-build"
                                            } />
                                        )}
                                    </div>
                                </div>

                                {/* Biggest threat + Easiest win */}
                                {(comp.biggest_threat || comp.easiest_win) && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                                        {comp.biggest_threat && (
                                            <div className="bg-dont/5 border border-dont/20 rounded-lg p-3">
                                                <div className="font-mono text-[11px] uppercase tracking-widest text-dont mb-1 font-bold">⚠️ Biggest Threat</div>
                                                <p className="text-xs text-foreground/80">{String(comp.biggest_threat)}</p>
                                            </div>
                                        )}
                                        {comp.easiest_win && (
                                            <div className="bg-build/5 border border-build/20 rounded-lg p-3">
                                                <div className="font-mono text-[11px] uppercase tracking-widest text-build mb-1 font-bold">🎯 Easiest Win</div>
                                                <p className="text-xs text-foreground/80">{String(comp.easiest_win)}</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {competitors.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {competitors.map((c: any, i: number) => (
                                            <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-2 relative overflow-hidden group hover:border-white/20 transition-all">
                                                <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-white/5 to-transparent rounded-bl-xl opacity-0 group-hover:opacity-100 transition-opacity" />

                                                <div className="flex justify-between items-start z-10 gap-2">
                                                    <span className="font-bold text-foreground text-sm">{c.name || c.company || "Unknown"}</span>
                                                    <div className="flex gap-1.5 flex-shrink-0">
                                                        {c.threat_level && <Badge text={c.threat_level} className={getThreatColor(c.threat_level)} />}
                                                        {(c.price || c.pricing) && <span className="font-mono text-[11px] text-build">{String(c.price || c.pricing)}</span>}
                                                    </div>
                                                </div>

                                                {/* Meta row */}
                                                <div className="flex gap-3 text-[11px] font-mono text-muted-foreground">
                                                    {c.users && <span>Users: {c.users}</span>}
                                                    {c.founded && <span>Founded: {c.founded}</span>}
                                                    {c.funding && <span>Funding: {c.funding}</span>}
                                                </div>

                                                {(c.weakness || c.gap) && (
                                                    <div className="mt-1 text-xs text-orange-400 bg-orange-400/10 border border-orange-400/20 p-2 rounded-md">
                                                        <span className="font-bold uppercase text-[11px] mb-1 block">Vulnerability</span>
                                                        {String(c.weakness || c.gap)}
                                                    </div>
                                                )}

                                                {c.user_complaints && (
                                                    <div className="text-xs text-dont/80 bg-dont/5 border border-dont/10 p-2 rounded-md">
                                                        <span className="font-bold uppercase text-[11px] mb-1 block text-dont">User Complaints</span>
                                                        {String(c.user_complaints)}
                                                    </div>
                                                )}

                                                {c.your_attack_angle && (
                                                    <div className="text-xs text-build/80 bg-build/5 border border-build/10 p-2 rounded-md">
                                                        <span className="font-bold uppercase text-[11px] mb-1 block text-build">Your Attack</span>
                                                        {String(c.your_attack_angle)}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">{String(comp.narrative || comp.your_unfair_advantage || "No direct competitors mapped.")}</p>
                                )}

                                {comp.moat_strategy && (
                                    <div className="mt-4 pt-3 border-t border-white/5">
                                        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5 font-bold">🏰 Moat Strategy</div>
                                        <p className="text-xs text-foreground/80 leading-relaxed">{String(comp.moat_strategy)}</p>
                                    </div>
                                )}
                                </>
                            ) : (
                                <>
                                    <SectionHeader icon={Target} label="Competition Network" color="text-dont" />
                                    <EmptySectionState text="Competition data is missing for this validation, so direct competitors, vulnerabilities, and attack angles cannot be shown." />
                                </>
                            )}
                        </div>

                        {/* ════════ Financial Reality ════════ */}
                        <div className="bento-cell p-6">
                            <SectionHeader icon={Banknote} label="Financial Reality Check" color="text-emerald-400" />
                            {Object.keys(financial).length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                                    {[
                                        { label: "Break-Even", value: financial.break_even_users, icon: "⚖️" },
                                        { label: "Time to $1K MRR", value: financial.time_to_1k_mrr, icon: "🎯" },
                                        { label: "Time to $10K MRR", value: financial.time_to_10k_mrr, icon: "🚀" },
                                        { label: "CAC Budget", value: financial.cac_budget, icon: "💸" },
                                        { label: "Gross Margin", value: financial.gross_margin, icon: "📊" },
                                    ].filter(f => f.value).map((f, i) => (
                                        <div key={i} className="bg-emerald-500/5 border border-emerald-400/20 rounded-lg p-4">
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <span className="text-sm">{f.icon}</span>
                                                <div className="font-mono text-[11px] uppercase tracking-widest text-emerald-400 font-bold">{f.label}</div>
                                            </div>
                                            <p className="text-xs text-foreground/80 leading-relaxed">{String(f.value)}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <EmptySectionState text="Financial reality inputs are missing for this validation, so break-even, MRR timing, CAC, and margin assumptions cannot be displayed." />
                            )}
                        </div>

                        {/* ════════ Risk Matrix ════════ */}
                        <div className="bento-cell p-6">
                            <SectionHeader icon={Shield} label="Risk Matrix" color="text-dont" />
                            {risks.length > 0 ? (
                                <div className="flex flex-col gap-3 mt-4">
                                    {risks.map((risk, i) => {
                                        const severity = String(risk.severity || "MEDIUM").toUpperCase();
                                        const probability = String(risk.probability || risk.likelihood || "MEDIUM").toUpperCase();
                                        return (
                                            <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:border-white/20 transition-all">
                                                <div className="flex items-start justify-between gap-3 mb-2">
                                                    <p className="text-sm text-foreground/90 font-medium flex-1">{String(risk.risk)}</p>
                                                    <div className="flex gap-1.5 flex-shrink-0">
                                                        <Badge text={`S:${severity}`} className={getSeverityColor(severity)} />
                                                        <Badge text={`P:${probability}`} className={getSeverityColor(probability)} />
                                                    </div>
                                                </div>
                                                {risk.mitigation && (
                                                    <p className="text-xs text-build/70 bg-build/5 border border-build/10 rounded px-3 py-1.5 mt-1">
                                                        <span className="font-bold">Mitigation:</span> {String(risk.mitigation)}
                                                    </p>
                                                )}
                                                {risk.owner && (
                                                    <div className="mt-2">
                                                        <span className="text-[11px] font-mono uppercase text-muted-foreground bg-white/5 px-2 py-0.5 rounded">
                                                            Owner: {String(risk.owner)}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <EmptySectionState text="Risk entries are missing for this validation, so the risk matrix cannot be populated." />
                            )}
                        </div>

                        {/* ════════ Evidence Log ════════ */}
                        <div className="bento-cell p-6 terminal-card">
                            <SectionHeader icon={MessageSquare} label="Raw Evidence Ingestion" color="text-primary" />
                            {evidence.length > 0 ? (
                                <div className="flex flex-col gap-3 mt-4">
                                    {evidence.map((ev: any, i: number) => {
                                        const platform = String(ev.source ?? ev.platform ?? "unknown");
                                        const platformColor = platform.toLowerCase().includes("reddit") ? "text-[#ff4500]" : "text-[#f97316]";
                                        return (
                                            <div key={i} className="border-l-2 border-primary/30 pl-4 py-1.5 flex flex-col gap-1.5">
                                                <div className="flex items-center gap-3 text-[11px] font-mono">
                                                    <span className={`uppercase font-bold ${platformColor}`}>{platform}</span>
                                                    <span className="text-muted-foreground opacity-50">/</span>
                                                    <span className="text-build">{(ev.score ?? ev.upvotes) ? `+${ev.score ?? ev.upvotes}` : "unscored"}</span>
                                                </div>
                                                <p className="text-sm text-foreground/90 font-medium">&quot;{ev.post_title ?? ev.title ?? ev.content}&quot;</p>
                                                {(ev.what_it_proves || ev.relevance) && (
                                                    <p className="text-xs text-muted-foreground italic">→ {String(ev.what_it_proves || ev.relevance)}</p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <EmptySectionState text="No raw evidence entries were persisted for this validation, so the evidence log cannot be reconstructed here." />
                            )}
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div className="bento-cell p-6">
                                    <SectionHeader icon={Target} label="Build This" color="text-build" />
                                    <div className="flex flex-col gap-3 mt-4">
                                        {mvpFeatures.length > 0 ? mvpFeatures.map((feature: any, i: number) => (
                                            <div key={i} className="bg-build/5 border border-build/15 rounded-xl p-4">
                                                <div className="text-sm text-foreground font-medium">
                                                    {String(feature.name || feature.feature || feature.title || feature)}
                                                </div>
                                                {(feature.reason || feature.why) && (
                                                    <p className="text-xs text-build/80 mt-1">{String(feature.reason || feature.why)}</p>
                                                )}
                                            </div>
                                        )) : (
                                            <p className="text-xs text-muted-foreground">No MVP feature shortlist provided.</p>
                                        )}
                                    </div>
                                </div>
                                <div className="bento-cell p-6">
                                    <SectionHeader icon={AlertCircle} label="Don&apos;t Build This" color="text-dont" />
                                    <div className="flex flex-col gap-3 mt-4">
                                        {cutFeatures.length > 0 ? cutFeatures.map((feature: any, i: number) => (
                                            <div key={i} className="bg-dont/5 border border-dont/15 rounded-xl p-4">
                                                <div className="text-sm text-foreground font-medium">
                                                    {String(feature.name || feature.feature || feature.title || feature)}
                                                </div>
                                                {(feature.reason || feature.why) && (
                                                    <p className="text-xs text-dont/80 mt-1">{String(feature.reason || feature.why)}</p>
                                                )}
                                            </div>
                                        )) : (
                                            <p className="text-xs text-muted-foreground">No cut-feature list provided.</p>
                                        )}
                                    </div>
                                </div>
                        </div>

                        <div className="bento-cell p-6">
                            <SectionHeader icon={Banknote} label="Monetization Channels" color="text-build" />
                            {monetizationChannels.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                                    {monetizationChannels.map((channel: any, i: number) => (
                                        <div key={i} className="bg-build/5 border border-build/15 rounded-xl p-4">
                                            <div className="font-mono text-[11px] uppercase tracking-widest text-build font-bold mb-2">
                                                {String(channel.channel || channel.name || `Channel ${i + 1}`)}
                                            </div>
                                            {(channel.timeline || channel.when) && (
                                                <p className="text-xs text-muted-foreground mb-2">
                                                    Timeline: {String(channel.timeline || channel.when)}
                                                </p>
                                            )}
                                            {(channel.expected_revenue || channel.revenue || channel.target) && (
                                                <p className="text-sm text-foreground">
                                                    {String(channel.expected_revenue || channel.revenue || channel.target)}
                                                </p>
                                            )}
                                            {(channel.description || channel.notes) && (
                                                <p className="text-xs text-muted-foreground mt-2">
                                                    {String(channel.description || channel.notes)}
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <EmptySectionState text="No monetization channels were generated for this validation." />
                            )}
                        </div>

                        {/* ════════ Launch Roadmap ════════ */}
                        <div className="bento-cell p-6">
                            <SectionHeader icon={Calendar} label="Launch Trajectory" color="text-purple-400" />
                            {roadmap.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                                    {roadmap.map((step, i) => {
                                        const title = step.title || step.phase || step.step || `Phase ${i+1}`;
                                        return (
                                            <div key={i} className="flex flex-col gap-3">
                                                <div className="flex items-center gap-2 text-purple-400 font-mono text-[11px] uppercase font-bold tracking-widest">
                                                    <div className="w-5 h-5 rounded border border-purple-400/30 bg-purple-400/10 flex items-center justify-center">
                                                        {i + 1}
                                                    </div>
                                                    {step.week || step.timeline || `Step ${i+1}`}
                                                </div>
                                                <div className="bg-white/5 rounded-xl p-4 border border-white/5 flex-1 relative group hover:border-purple-400/30 transition-all">
                                                    <h4 className="font-bold text-sm text-foreground mb-2">{title}</h4>

                                                    {/* Channel + Cost badges */}
                                                    <div className="flex gap-2 flex-wrap mb-3">
                                                        {step.channel && (
                                                            <span className="text-[11px] font-mono bg-purple-500/10 text-purple-300 border border-purple-400/20 px-2 py-0.5 rounded">
                                                                📍 {step.channel}
                                                            </span>
                                                        )}
                                                        {(step.cost_estimate || step.cost) && (
                                                            <span className="text-[11px] font-mono bg-build/10 text-build border border-build/20 px-2 py-0.5 rounded">
                                                                💰 {step.cost_estimate || step.cost}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {step.description && <p className="text-xs text-muted-foreground mb-3">{step.description}</p>}

                                                    {step.tasks && Array.isArray(step.tasks) && (
                                                        <ul className="flex flex-col gap-1.5 mb-3">
                                                            {step.tasks.map((task: string, j: number) => (
                                                                <li key={j} className="text-[11px] flex gap-1.5 text-muted-foreground">
                                                                    <span className="text-purple-400">-</span> {task}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}

                                                    {/* Validation Gate */}
                                                    {step.validation_gate && (
                                                        <div className="bg-risky/5 border border-risky/20 rounded-md p-2.5 mt-2">
                                                            <div className="font-mono text-[11px] uppercase tracking-widest text-risky font-bold mb-1">🚦 Gate</div>
                                                            <p className="text-[11px] text-risky/80">{step.validation_gate}</p>
                                                        </div>
                                                    )}

                                                    {/* Expected outcome */}
                                                    {(step.expected_outcome || step.outcome) && (
                                                        <div className="mt-2 pt-2 border-t border-white/5">
                                                            <div className="font-mono text-[11px] uppercase tracking-widest text-build/70">→ {step.expected_outcome || step.outcome}</div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <EmptySectionState text="Launch roadmap steps are missing for this validation, so the rollout plan cannot be shown." />
                            )}
                        </div>

                        {/* ════════ First 10 Customers ════════ */}
                        <div className="bento-cell p-6">
                            <SectionHeader icon={Crosshair} label="First 10 Customers Strategy" color="text-cyan-400" />
                            {Object.keys(first10).length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                                    {/* Handle both old step_1/step_2 format and new customers_1_3 format */}
                                    {(first10.customers_1_3 || first10.step_1) ? (
                                        <>
                                            {[
                                                { key: "customers_1_3", label: "Customers 1-3", emoji: "🎯", fallbackKey: "step_1" },
                                                { key: "customers_4_7", label: "Customers 4-7", emoji: "📈", fallbackKey: "step_2" },
                                                { key: "customers_8_10", label: "Customers 8-10", emoji: "🔄", fallbackKey: "step_3" },
                                            ].map((phase) => {
                                                const data = first10[phase.key] || {};
                                                const fallbackText = first10[phase.fallbackKey];
                                                if (!data.source && !fallbackText) return null;
                                                return (
                                                    <div key={phase.key} className="bg-cyan-500/5 border border-cyan-400/20 rounded-xl p-4 flex flex-col gap-3">
                                                        <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400 font-bold">
                                                            {phase.emoji} {phase.label}
                                                        </div>
                                                        {typeof data === 'object' && data.source ? (
                                                            <>
                                                                <div>
                                                                    <span className="text-[11px] font-mono uppercase text-muted-foreground font-bold">Source:</span>
                                                                    <p className="text-xs text-foreground/80 mt-0.5">{String(data.source)}</p>
                                                                </div>
                                                                <div>
                                                                    <span className="text-[11px] font-mono uppercase text-muted-foreground font-bold">Tactic:</span>
                                                                    <p className="text-xs text-foreground/80 mt-0.5">{String(data.tactic)}</p>
                                                                </div>
                                                                {data.script && (
                                                                    <div className="bg-white/5 border border-white/5 rounded-md p-2.5 mt-1">
                                                                        <span className="text-[11px] font-mono uppercase text-muted-foreground font-bold">📝 Script:</span>
                                                                        <p className="text-[11px] text-foreground/70 mt-1 font-mono leading-relaxed whitespace-pre-wrap">{String(data.script)}</p>
                                                                    </div>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <p className="text-xs text-foreground/80">{String(fallbackText || data)}</p>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </>
                                    ) : (
                                        /* Old step format — display all steps */
                                        Object.entries(first10).map(([key, val]) => (
                                            <div key={key} className="bg-cyan-500/5 border border-cyan-400/20 rounded-xl p-4">
                                                <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400 font-bold mb-2">{key.replace(/_/g, ' ')}</div>
                                                <p className="text-xs text-foreground/80">{String(val)}</p>
                                            </div>
                                        ))
                                    )}
                                </div>
                            ) : (
                                <EmptySectionState text="Customer acquisition sequencing is missing for this validation, so the first-10-customers plan cannot be displayed." />
                            )}
                        </div>

                        <div className="bento-cell p-6">
                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                    <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Next move</div>
                                    <p className="mt-2 text-sm text-foreground/80">
                                        Save this report, compare it against another idea, or run a deeper follow-up validation.
                                    </p>
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <button
                                        type="button"
                                        onClick={toggleWatchlist}
                                        disabled={watchlistLoading}
                                        className={`rounded-xl border px-4 py-2 text-[11px] font-mono uppercase tracking-widest transition-colors ${
                                            savedToWatchlist
                                                ? "border-build/30 bg-build/10 text-build"
                                                : "border-white/10 bg-white/5 text-foreground hover:bg-white/10"
                                        } disabled:opacity-60`}
                                    >
                                        {watchlistLoading ? "Saving..." : savedToWatchlist ? "Saved to Watchlist" : "Save to Watchlist"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => router.push("/dashboard/reports")}
                                        className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-foreground transition-colors hover:bg-white/10"
                                    >
                                        Compare Ideas
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => router.push("/dashboard/validate")}
                                        className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-primary transition-colors hover:bg-primary/20"
                                    >
                                        Run Deeper Validation
                                    </button>
                                </div>
                            </div>
                        </div>

                    </motion.div>
                ) : (
                    <motion.div key="debate" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                        <div className="bento-cell p-6 terminal-card">
                            <SectionHeader icon={Brain} label="LLM Consensus Trace" color="text-primary" />

                            {debateTranscript ? (
                                <DebatePanel transcript={debateTranscript} />
                            ) : !debateMode || debateLog.length === 0 ? (
                                <div className="py-20 flex flex-col items-center justify-center text-center opacity-50">
                                    <Brain className="w-8 h-8 text-muted-foreground mb-4" />
                                    <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Single Thread Execution.</p>
                                    <p className="font-mono text-[11px] text-muted-foreground mt-2">No multi-agent debate logs found for this validation.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-8 mt-6">
                                    <div className="flex gap-4 border-b border-white/10 pb-6">
                                        {modelsUsed.map(m => (
                                            <div key={m} className="bg-white/5 border border-white/10 px-3 py-2 rounded-lg font-mono text-[11px] flex flex-col gap-1">
                                                <span className="text-muted-foreground">Node</span>
                                                <span className="text-foreground">{m}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {debateLog.map((round) => (
                                        <div key={round.round} className="flex flex-col gap-4">
                                            <div className="font-mono text-[11px] uppercase font-bold tracking-widest text-primary border-l-2 border-primary pl-3 py-1">
                                                Sequence {round.round}
                                            </div>
                                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 ml-4">
                                                {round.entries.map((entry, i) => {
                                                    const vStyle = getVerdictStyle(entry.verdict);
                                                    return (
                                                        <div key={i} className={`p-4 rounded-xl border ${vStyle.bg} ${vStyle.border} bg-opacity-50 relative overflow-hidden`}>
                                                            <div className="flex justify-between items-center mb-3">
                                                                <span className="font-mono flex items-center gap-2 text-[11px] uppercase font-bold tracking-widest text-foreground">
                                                                    <span className="text-muted-foreground">{entry.model}</span>
                                                                    <span className="opacity-30">/</span>
                                                                    <span>{entry.role}</span>
                                                                </span>
                                                                <span className={`px-1.5 py-0.5 rounded font-mono text-[11px] uppercase tracking-widest border ${
                                                                    entry.changed
                                                                        ? "bg-orange-500/20 text-orange-500 border-orange-500/30"
                                                                        : "bg-white/5 text-muted-foreground border-white/10"
                                                                }`}>
                                                                    {entry.changed ? "Changed" : "Held"}
                                                                </span>
                                                            </div>
                                                            <p className="text-sm font-sans text-foreground/90 leading-relaxed mb-4">{entry.reasoning}</p>
                                                            <div className="flex justify-between items-center pt-3 border-t border-white/10 w-full mt-auto">
                                                                <span className={`font-mono text-[11px] font-bold ${vStyle.color}`}>{entry.verdict}</span>
                                                                <span className="font-mono text-[11px] text-muted-foreground">{entry.confidence}% Conf</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
