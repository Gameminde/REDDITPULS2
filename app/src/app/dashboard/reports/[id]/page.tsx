"use client";

import { useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
    AlertCircle, ArrowLeft, Banknote, BarChart3, Bookmark, Brain,
    Calendar, Check, CheckCircle2, ChevronDown, Clipboard, Copy, Crosshair,
    DollarSign, Download, ExternalLink, FileText, Loader2, MessageSquare, Search, Shield, Target,
    TrendingUp, Users, X, Zap, Clock
} from "lucide-react";
import { useUserPlan } from "@/lib/use-user-plan";
import { PremiumGate } from "@/app/components/premium-gate";
import { DebatePanel } from "@/app/components/DebatePanel";
import {
    getClaimSupportMeta,
    getClaimTierMeta,
    normalizeClaimContract,
    type ClaimContractEntry,
} from "@/lib/claim-contract";

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

type ValidationReport = {
    id: string;
    idea_text: string;
    verdict: string;
    confidence: number;
    status: string;
    posts_found?: number;
    posts_analyzed?: number;
    created_at: string;
    depth?: string;
    report: Record<string, any>;
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

type IntelligenceTabKey = "buyers" | "competition" | "strategy" | "evidence" | "financial";
type DebateRoundGroup = { round: number; entries: DebateLogEntry[] };
type EvidenceTier = "DIRECT" | "ADJACENT" | "IRRELEVANT";

const ACTIVE_VALIDATION_ID_KEY = "activeValidationId";
const ACTIVE_VALIDATION_IDEA_KEY = "activeValidationIdea";
const COMPLETED_VALIDATION_ID_KEY = "completedValidationId";
const VALIDATION_STORAGE_EVENT = "validation-storage";

/* ── Helpers ── */

function toNumber(value: unknown, fallback = 0): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

function asString(value: unknown, fallback = ""): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return fallback;
}

function truncateText(value: string, max: number) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

function getFirstSentence(value: string, max = 120) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    const match = normalized.match(/^.*?[.!?](?:\s|$)/);
    return truncateText(match ? match[0].trim() : normalized, max);
}

function getVerdictStyle(value: string) {
    const normalized = (value || "").toUpperCase();
    if (normalized.includes("BUILD") && !normalized.includes("DON")) {
        return { color: "text-build", bg: "bg-build/10", border: "border-build/25", icon: TrendingUp, label: "BUILD IT" };
    }
    if (normalized.includes("INSUFFICIENT")) {
        return { color: "text-zinc-300", bg: "bg-zinc-500/10", border: "border-zinc-500/20", icon: FileText, label: "INSUFFICIENT DATA" };
    }
    if (normalized.includes("DON") || normalized.includes("REJECT")) {
        return { color: "text-dont", bg: "bg-dont/10", border: "border-dont/25", icon: AlertCircle, label: "DON'T BUILD" };
    }
    return { color: "text-risky", bg: "bg-risky/10", border: "border-risky/25", icon: Shield, label: "RISKY" };
}

function getConfidenceDescriptor(confidence: number) {
    if (confidence < 30) return { label: "Very low - exploratory only", tone: "bg-dont/15 text-dont" };
    if (confidence < 60) return { label: "Moderate - directional hypothesis", tone: "bg-risky/15 text-risky" };
    if (confidence < 80) return { label: "Strong - multiple sources agree", tone: "bg-build/15 text-build" };
    return { label: "Robust - convergent evidence", tone: "bg-build/20 text-build" };
}

function normalizeTier(value: unknown): EvidenceTier {
    const normalized = asString(value).toUpperCase();
    if (normalized.includes("DIRECT")) return "DIRECT";
    if (normalized.includes("ADJACENT")) return "ADJACENT";
    return "IRRELEVANT";
}

function getTierClass(tier: EvidenceTier) {
    if (tier === "DIRECT") return "bg-build/10 border-build/20 text-build";
    if (tier === "ADJACENT") return "bg-risky/10 border-risky/20 text-risky";
    return "bg-zinc-500/10 border-zinc-500/20 text-zinc-300";
}

function getEvidenceTitle(item: Record<string, any>) {
    return asString(item.post_title || item.title || item.content || item.quote || "");
}

function getEvidenceSourceLabel(item: Record<string, any>) {
    const source = asString(item.source || item.platform || "unknown");
    const subreddit = asString(item.subreddit);
    return subreddit ? `${source}/${subreddit}` : source;
}

function getCommunityName(item: any) {
    if (!item) return "";
    if (typeof item === "string") {
        const match = item.match(/r\/[A-Za-z0-9_]+/);
        if (match) return match[0];
        return item.split(/[,(]/)[0]?.trim() || item;
    }
    const name = asString(item.name || item.community || item.subreddit || item.label);
    return name ? (name.startsWith("r/") ? name : `r/${name}`) : "";
}

function getCompetitorName(item: any) {
    if (!item) return "";
    if (typeof item === "string") return item;
    return asString(item.name || item.company || item.product || item.title || "");
}

function getMeaningfulKeywords(report: Record<string, any>, ideaText: string) {
    const candidates = [
        ...(Array.isArray(report?.extracted_keywords?.keywords) ? report.extracted_keywords.keywords : []),
        ...(Array.isArray(report?.keywords) ? report.keywords : []),
        ...(Array.isArray(report?.signal_summary?.keywords) ? report.signal_summary.keywords : []),
    ]
        .map((value) => asString(value).trim())
        .filter(Boolean);
    if (candidates.length > 0) return candidates.slice(0, 5);
    return ideaText
        .split(/\s+/)
        .map((word) => word.replace(/[^a-zA-Z0-9-]/g, ""))
        .filter((word) => word.length > 4)
        .slice(0, 5);
}

function buildTierLookup(audit: Record<string, any>) {
    const lookup = new Map<string, EvidenceTier>();
    const breakdown = Array.isArray(audit?.direct_evidence_breakdown) ? audit.direct_evidence_breakdown : [];
    breakdown.forEach((entry: Record<string, any>) => {
        const title = asString(entry.title).trim().toLowerCase();
        if (title) lookup.set(title, normalizeTier(entry.code_tier || entry.ai_tier));
    });
    return lookup;
}

function resolveEvidenceTier(item: Record<string, any>, lookup: Map<string, EvidenceTier>) {
    const key = getEvidenceTitle(item).trim().toLowerCase();
    return key && lookup.has(key) ? (lookup.get(key) as EvidenceTier) : normalizeTier(item.relevance_tier);
}

function sumMatchingSources(sourceMap: Record<string, number>, matchers: string[]) {
    return Object.entries(sourceMap).reduce((total, [key, value]) => {
        const normalized = key.toLowerCase();
        return matchers.some((matcher) => normalized.includes(matcher)) ? total + toNumber(value) : total;
    }, 0);
}

function buildSourceStatus(sourceMap: Record<string, number>) {
    return [
        { label: "Reddit", count: sumMatchingSources(sourceMap, ["reddit"]) },
        { label: "HN", count: sumMatchingSources(sourceMap, ["hackernews", "hn"]) },
        { label: "G2", count: sumMatchingSources(sourceMap, ["g2", "g2_review"]) },
        { label: "Jobs", count: sumMatchingSources(sourceMap, ["job_posting", "jobs", "adzuna"]) },
    ];
}

function normalizePlatformWarning(value: unknown) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") {
        const record = value as Record<string, any>;
        return asString(record.issue || record.error_detail || record.warning || record.platform || JSON.stringify(record));
    }
    return asString(value);
}

function getTrendTone(value: string) {
    const normalized = value.toUpperCase();
    if (normalized.includes("EXPLOD")) return "border-build/25 bg-build/10 text-build";
    if (normalized.includes("GROW")) return "border-emerald-400/25 bg-emerald-500/10 text-emerald-300";
    if (normalized.includes("DECLIN") || normalized.includes("COOL")) return "border-dont/25 bg-dont/10 text-dont";
    return "border-white/10 bg-white/5 text-muted-foreground";
}

function getTrendDirectionCopy(trends: Record<string, any>) {
    const overall = asString(trends.overall_trend || trends.direction || "UNKNOWN").toUpperCase();
    const avgChange = toNumber(trends.avg_change_percent, 0);
    const interest = toNumber(trends.current_interest || trends.avg_interest, 0);
    return {
        overall,
        avgChange,
        interest,
        label: overall || "UNKNOWN",
        summary:
            overall === "EXPLODING"
                ? "Keyword demand is accelerating fast."
                : overall === "GROWING"
                    ? "Keyword demand is moving up."
                    : overall === "DECLINING"
                        ? "Keyword demand is cooling down."
                        : "Timing signal is weak or mixed.",
    };
}

function getKeywordTrendRows(trends: Record<string, any>) {
    const candidates = Array.isArray(trends.keywords)
        ? trends.keywords
        : Array.isArray(trends.keyword_trends)
            ? trends.keyword_trends
            : Array.isArray(trends.items)
                ? trends.items
                : [];
    return candidates
        .map((row: any) => ({
            keyword: asString(row.keyword || row.term || row.name),
            change: toNumber(row.change_percent ?? row.change_pct, 0),
            interest: toNumber(row.current_interest ?? row.interest ?? row.score, 0),
        }))
        .filter((row: { keyword: string }) => row.keyword)
        .slice(0, 4);
}

function getTopSubredditCounts(audit: Record<string, any>) {
    const counts = (audit?.subreddit_post_counts || {}) as Record<string, number>;
    return Object.entries(counts)
        .map(([name, count]) => ({ name, count: toNumber(count) }))
        .filter((row) => row.name && row.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
}

function collectDebateSummary(transcript: Record<string, any> | null, verdict: string, confidence: number) {
    const models = Array.isArray(transcript?.models) ? transcript.models.length : 0;
    const rounds = Array.isArray(transcript?.rounds) ? transcript.rounds.length : 0;
    const finalVerdict = asString(transcript?.final?.verdict || verdict || "Unknown").replace(/_/g, " ");
    const finalConfidence = toNumber(transcript?.final?.confidence, confidence);
    return { models, rounds, summary: `${finalVerdict} at ${finalConfidence}% confidence` };
}

function isReportSystemMessage(value: string) {
    const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized) return false;
    return normalized.includes("posts directly address this idea")
        || normalized.includes("strategy sections")
        || normalized.includes("validate with direct buyer interviews first");
}

function humanizeRole(raw: string): string {
    return raw
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/\bAi\b/gi, "AI");
}

function extractFirstSentence(text: string, maxLen = 100): string {
    const clean = text.replace(/\n/g, " ").trim();
    const dot = clean.indexOf(". ");
    const sentence = dot > 0 && dot < maxLen ? clean.slice(0, dot + 1) : clean.slice(0, maxLen);
    return sentence.length < clean.length ? sentence + "…" : sentence;
}

function buildFallbackRisks(transcript: Record<string, any> | null, debateLog: DebateLogEntry[]) {
    const fallback: Array<{ risk: string; mitigation?: string }> = [];
    const dissentReason = asString(transcript?.final?.dissent?.dissent_reason);
    if (dissentReason) fallback.push({ risk: extractFirstSentence(dissentReason, 120) });
    debateLog
        .filter((entry) => {
            const normalized = entry.verdict?.toUpperCase() || "";
            return normalized.includes("RISKY") || normalized.includes("DONT") || normalized.includes("INSUFFICIENT");
        })
        .slice(0, 3)
        .forEach((entry) => {
            const role = humanizeRole(entry.role || entry.model || "AI");
            const detail = asString(entry.reasoning, "");
            const summary = detail ? extractFirstSentence(detail, 120) : `${role} flagged downside risk.`;
            fallback.push({ risk: summary, mitigation: `Flagged by ${role} (${entry.verdict})` });
        });
    return fallback.slice(0, 3);
}

function buildGuardrailContextNote(directCount: number, transcriptFinalVerdict: string, transcriptFinalConfidence: number) {
    const leanVerdict = transcriptFinalVerdict || "RISKY";
    return `Canonical evidence filter found ${directCount} DIRECT posts for this idea. Any references below to "direct" evidence reflect model interpretation of adjacent/supporting signals. Final report guardrail remains authoritative; the underlying debate only leaned ${leanVerdict} at ${transcriptFinalConfidence}%.`;
}

function buildGuardrailFallbackRisks(
    directCount: number,
    transcriptFinalVerdict: string,
    transcriptFinalConfidence: number,
    platformWarnings: string[],
    betterKeywords: string[],
) {
    const fallback: Array<{ risk: string; mitigation?: string }> = [
        {
            risk: `Only ${directCount} canonical DIRECT posts survived the deterministic evidence filter, so buyer-native proof is too thin to trust strategy recommendations.`,
            mitigation: "Treat this as interview-first research, not a build-ready validation.",
        },
        {
            risk: `The debate leaned ${transcriptFinalVerdict || "RISKY"} at ${transcriptFinalConfidence}%, but that lean came from adjacent/supporting evidence rather than canonical direct matches.`,
            mitigation: "Use the debate as directional context only until direct buyer evidence improves.",
        },
    ];

    if (platformWarnings.length > 0) {
        fallback.push({
            risk: platformWarnings[0],
            mitigation: "Rerun after coverage improves or validate manually with direct outreach.",
        });
    } else {
        fallback.push({
            risk: `The framing may be too narrow or too jargon-heavy for how buyers describe the pain publicly${betterKeywords.length > 0 ? ` (current keywords: ${betterKeywords.join(", ")})` : ""}.`,
            mitigation: "Rerun with buyer-language phrases rather than category language.",
        });
    }

    return fallback.slice(0, 3);
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

function getValidityTone(label: string) {
    const normalized = label.toUpperCase();
    if (normalized === "HIGH") return "border-build/20 bg-build/10 text-build";
    if (normalized === "MODERATE") return "border-blue-400/20 bg-blue-500/10 text-blue-300";
    if (normalized === "LOW") return "border-risky/20 bg-risky/10 text-risky";
    return "border-zinc-500/20 bg-zinc-500/10 text-zinc-300";
}

const SectionHeader = ({ icon: Icon, label, color }: { icon: any; label: string; color: string }) => (
    <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <h3 className={`font-mono text-[11px] uppercase tracking-[0.18em] font-bold ${color}`}>{label}</h3>
    </div>
);

const Badge = ({ text, className }: { text: string; className: string }) => (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-mono uppercase tracking-widest ${className}`}>
        {text}
    </span>
);

const EmptySectionState = ({ text }: { text: string }) => (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-muted-foreground">
        {text}
    </div>
);

const SurfaceCard = ({
    children,
    className = "",
}: {
    children: ReactNode;
    className?: string;
}) => (
    <div className={`rounded-3xl border border-white/10 bg-white/[0.03] ${className}`}>{children}</div>
);

const CollapsibleSection = ({
    title,
    subtitle,
    open,
    onToggle,
    children,
}: {
    title: string;
    subtitle?: string;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
}) => (
    <SurfaceCard>
        <button
            type="button"
            onClick={onToggle}
            className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.02] sm:px-5 sm:py-4"
        >
            <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary">{title}</div>
                {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && <div className="border-t border-white/10 p-4 sm:p-5">{children}</div>}
    </SurfaceCard>
);

/* ── Component ── */

export default function ReportDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const { isPremium } = useUserPlan();
    const [report, setReport] = useState<ValidationReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [savedToWatchlist, setSavedToWatchlist] = useState(false);
    const [watchlistLoading, setWatchlistLoading] = useState(false);
    const [debateOpen, setDebateOpen] = useState(false);
    const [intelOpen, setIntelOpen] = useState(false);
    const [intelTab, setIntelTab] = useState<IntelligenceTabKey>("buyers");
    const [shareToast, setShareToast] = useState(false);

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
            <span className="font-mono text-sm text-muted-foreground uppercase tracking-widest">Loading Decision Report</span>
        </div>
    );

    if (!report) return (
        <div className="flex flex-col items-center justify-center p-20 text-center gap-4">
            <AlertCircle className="w-10 h-10 text-muted-foreground opacity-50" />
            <p className="font-mono text-sm text-foreground">This report could not be found.</p>
            <button onClick={() => router.push("/dashboard/reports")} className="text-primary font-mono text-[11px] uppercase tracking-widest hover:underline">
                Back to Reports
            </button>
        </div>
    );

    const r = report.report;
    const vs = getVerdictStyle(report.verdict);
    const VIcon = vs.icon;
    const trust = report.trust;

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
    const evidenceFunnel = (r.evidence_funnel || {}) as Record<string, any>;

    const dataSources = (r.data_sources || {}) as Record<string, number>;
    const trends = (r.trends_data || {}) as Record<string, any>;
    const competitors = Array.isArray(comp.direct_competitors) ? comp.direct_competitors : [];
    const problemValidity = (r.problem_validity || {}) as Record<string, any>;
    const businessValidity = (r.business_validity || {}) as Record<string, any>;
    const claimContract = normalizeClaimContract(r);
    const claimEntries = claimContract.entries;
    const claimVerification = (r.claim_verification || {}) as Record<string, any>;
    const evidenceQuality = (r.evidence_quality || {}) as Record<string, any>;
    const moderatorSynthesis = (r.moderator_synthesis || {}) as Record<string, any>;

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

    // ── Redesign: Derived values ──
    const audit = (r._audit || {}) as Record<string, any>;
    const qualityFlags = (r._quality_flags || {}) as Record<string, any>;
    const hasAuditDirectCount = audit.direct_evidence_count !== undefined
        && audit.direct_evidence_count !== null
        && audit.direct_evidence_count !== "";
    const directCount = hasAuditDirectCount
        ? toNumber(audit.direct_evidence_count, 0)
        : toNumber(trust?.direct_evidence_count, 0);
    const adjacentCount = toNumber(audit.adjacent_evidence_count, 0);
    const rawCollectedCount = toNumber(
        evidenceFunnel.raw_collected_posts,
        toNumber(audit.raw_collected_posts, toNumber(signalSummary.posts_scraped, postsFound))
    );
    const filteredCorpusCount = toNumber(
        evidenceFunnel.filtered_posts_for_synthesis,
        toNumber(audit.filtered_posts_for_synthesis, toNumber(signalSummary.posts_filtered, postsAnalyzed || rawCollectedCount))
    );
    const filteredAnalyzedCount = toNumber(
        evidenceFunnel.filtered_posts_analyzed,
        toNumber(audit.filtered_posts_analyzed, toNumber(signalSummary.posts_analyzed, postsAnalyzed || filteredCorpusCount))
    );
    const dbHistoryContribution = toNumber(
        evidenceFunnel.db_history_posts,
        toNumber(audit.db_history_posts, toNumber(signalSummary.db_history_posts, 0))
    );
    const explicitPainQuotes = toNumber(
        problemValidity.pain_quotes_found ?? signalSummary.pain_quotes_found ?? audit.raw_pain_quotes?.length,
        0
    );
    const irrelevantCount = Math.max(0, evidencePoints - directCount - adjacentCount);
    const insufficientEvidence = directCount < 5 || Boolean(qualityFlags.insufficient_direct_evidence);
    const showStrategyTabs = directCount >= 10;
    const tierLookup = buildTierLookup(audit);
    const transcriptFinalVerdict = asString(debateTranscript?.final?.verdict).replace(/_/g, " ");
    const transcriptFinalConfidence = toNumber(debateTranscript?.final?.confidence, report.confidence);
    const debateGuardrailOverride = Boolean(qualityFlags.insufficient_direct_evidence)
        && Boolean(transcriptFinalVerdict)
        && transcriptFinalVerdict.toUpperCase() !== asString(report.verdict).replace(/_/g, " ").toUpperCase();
    const debateSummary = debateGuardrailOverride
        ? {
            models: Array.isArray(debateTranscript?.models) ? debateTranscript.models.length : 0,
            rounds: Array.isArray(debateTranscript?.rounds) ? debateTranscript.rounds.length : 0,
            summary: `${asString(report.verdict).replace(/_/g, " ")} at ${toNumber(report.confidence, 0)}% confidence — canonical filter found ${directCount} DIRECT posts; debate leaned ${transcriptFinalVerdict} at ${transcriptFinalConfidence}% on adjacent/supporting evidence`,
        }
        : collectDebateSummary(debateTranscript, report.verdict, report.confidence);
    const directEvidence = evidence.filter((ev: Record<string, any>) => resolveEvidenceTier(ev, tierLookup) === "DIRECT").slice(0, 3);
    const confDesc = getConfidenceDescriptor(report.confidence);
    const sourceStatus = buildSourceStatus(dataSources);
    const normalizedPlatformWarnings = platformWarnings
        .map(normalizePlatformWarning)
        .filter(Boolean)
        .slice(0, 6);
    const trendInfo = getTrendDirectionCopy(trends);
    const keywordTrends = getKeywordTrendRows(trends);
    const topSubredditCounts = getTopSubredditCounts(audit);
    const oneSentence = getFirstSentence(execSummary, 120);
    const totalEvidenceBar = directCount + adjacentCount + irrelevantCount || 1;
    const primaryPersona = asString(icp.primary_persona);
    const betterKeywords = getMeaningfulKeywords(r, report.idea_text).slice(0, 3);
    const verifiedClaims = Array.isArray(claimVerification.verified) ? claimVerification.verified : [];
    const unverifiedClaims = Array.isArray(claimVerification.unverified) ? claimVerification.unverified : [];
    const contradictedClaims = Array.isArray(claimVerification.contradicted) ? claimVerification.contradicted : [];
    const speculativeClaims = Array.isArray(claimVerification.speculative) ? claimVerification.speculative : [];
    const claimVerificationTotal = verifiedClaims.length + unverifiedClaims.length + contradictedClaims.length + speculativeClaims.length;
    const firstMoveRaw = r.first_move ?? moderatorSynthesis.first_move;
    const firstMove = typeof firstMoveRaw === "string"
        ? firstMoveRaw
        : asString(firstMoveRaw?.summary || firstMoveRaw?.action || firstMoveRaw?.title);
    const interviewQuestion = asString(r.interview_question || "");
    const timingAnalysis = ((r.timing_analysis || moderatorSynthesis.timing_analysis || {}) as Record<string, any>);
    const timingHeadline = asString(
        timingAnalysis.summary || timingAnalysis.why_now || timingAnalysis.read || timingAnalysis.note || timingAnalysis.message || market.market_timing
    );
    const timingStatus = asString(timingAnalysis.label || timingAnalysis.status || trends.overall_trend || "");
    const confidenceReasoning = asString(r.confidence_reasoning || moderatorSynthesis.confidence_reasoning || "");
    const debateGuardrailNote = debateGuardrailOverride
        ? buildGuardrailContextNote(directCount, transcriptFinalVerdict, transcriptFinalConfidence)
        : "";
    const evidenceFunnelNote = [
        rawCollectedCount > 0 ? `${rawCollectedCount} raw hits collected` : "",
        filteredCorpusCount > 0 ? `${filteredCorpusCount} passed the synthesis filter` : "",
        filteredAnalyzedCount > 0 ? `${filteredAnalyzedCount} were used in the evidence scan` : "",
        dbHistoryContribution > 0 ? `${dbHistoryContribution} came from recent DB history` : "",
        `${directCount} canonical DIRECT ${directCount === 1 ? "post" : "posts"}`,
    ].filter(Boolean).join(" · ");
    const problemValidityLabel = asString(problemValidity.label || (directCount >= 10 ? "HIGH" : directCount >= 5 ? "MODERATE" : directCount > 0 ? "LOW" : "INSUFFICIENT"));
    const businessValidityLabel = asString(businessValidity.label || (Object.keys(dataSources).length >= 3 ? "MODERATE" : "LOW"));
    const topRisks = risks.length > 0
        ? risks.slice(0, 3)
        : debateGuardrailOverride
            ? buildGuardrailFallbackRisks(
                directCount,
                transcriptFinalVerdict,
                transcriptFinalConfidence,
                normalizedPlatformWarnings,
                betterKeywords,
            )
            : buildFallbackRisks(debateTranscript, debateLogRaw);
    const handleShare = () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            setShareToast(true);
            setTimeout(() => setShareToast(false), 2000);
        }).catch(() => {
            setShareToast(true);
            setTimeout(() => setShareToast(false), 2000);
        });
    };

    const generateMarkdownExport = () => {
        const lines: string[] = [];
        lines.push(`# Validation Report: ${report.idea_text}`);
        lines.push(``);
        lines.push(`**Verdict:** ${vs.label}`);
        lines.push(`**Confidence:** ${report.confidence}%`);
        lines.push(`**Problem Validity:** ${problemValidityLabel} (${toNumber(problemValidity.score, directCount * 10)}%)`);
        lines.push(`**Business Validity:** ${businessValidityLabel} (${toNumber(businessValidity.score, report.confidence)}%)`);
        lines.push(`**Date:** ${new Date(report.created_at).toLocaleDateString()}`);
        lines.push(`**Depth:** ${report.depth || "standard"}`);
        lines.push(``);
        lines.push(`---`);
        lines.push(``);

        if (execSummary) {
            lines.push(`## Executive Summary`);
            lines.push(``);
            lines.push(execSummary);
            lines.push(``);
        }

        if (debateGuardrailOverride && debateGuardrailNote) {
            lines.push(`## Debate Guardrail`);
            lines.push(``);
            lines.push(debateGuardrailNote);
            lines.push(``);
        }

        if (directCount > 0 || adjacentCount > 0) {
            lines.push(`## Evidence Quality`);
            lines.push(``);
            lines.push(`- **Raw collected:** ${rawCollectedCount}`);
            lines.push(`- **Filtered corpus:** ${filteredCorpusCount}`);
            lines.push(`- **Filtered items used in synthesis:** ${filteredAnalyzedCount}`);
            if (dbHistoryContribution > 0) lines.push(`- **Recent DB history contribution:** ${dbHistoryContribution}`);
            lines.push(`- **Direct evidence:** ${directCount}`);
            if (explicitPainQuotes > 0) lines.push(`- **Explicit pain quotes:** ${explicitPainQuotes}`);
            lines.push(`- **Adjacent evidence:** ${adjacentCount}`);
            lines.push(`- **Total points:** ${evidencePoints}`);
            lines.push(``);
        }

        if (claimEntries.length > 0) {
            lines.push(`## Claim Quality`);
            lines.push(``);
            claimEntries.forEach((entry: ClaimContractEntry) => {
                const support = getClaimSupportMeta(entry.support_level).label;
                lines.push(`- **${entry.label}:** ${entry.value || "—"} · ${support} · ${entry.trust_tier}`);
                if (entry.summary) lines.push(`  - ${entry.summary}`);
                if (entry.source_basis.length > 0) lines.push(`  - Basis: ${entry.source_basis.join(", ")}`);
            });
            lines.push(``);
        }

        if (firstMove || timingHeadline || confidenceReasoning) {
            lines.push(`## Founder Readout`);
            lines.push(``);
            if (firstMove) lines.push(`- **First move:** ${firstMove}`);
            if (interviewQuestion) lines.push(`- **Interview question:** ${interviewQuestion}`);
            if (timingStatus || timingHeadline) lines.push(`- **Timing:** ${[timingStatus, timingHeadline].filter(Boolean).join(" — ")}`);
            if (confidenceReasoning) lines.push(`- **Confidence reasoning:** ${confidenceReasoning}`);
            lines.push(``);
        }

        if (claimVerificationTotal > 0 || evidenceQuality.strongest_evidence || evidenceQuality.weakest_point) {
            lines.push(`## Claim Verification`);
            lines.push(``);
            if (claimVerificationTotal > 0) {
                lines.push(`- **Verified:** ${verifiedClaims.length}`);
                lines.push(`- **Unverified:** ${unverifiedClaims.length}`);
                lines.push(`- **Contradicted:** ${contradictedClaims.length}`);
                lines.push(`- **Speculative:** ${speculativeClaims.length}`);
            }
            if (evidenceQuality.strongest_evidence) lines.push(`- **Strongest evidence:** ${String(evidenceQuality.strongest_evidence)}`);
            if (evidenceQuality.weakest_point) lines.push(`- **Weakest point:** ${String(evidenceQuality.weakest_point)}`);
            lines.push(``);
        }

        if (trendInfo.label !== "UNKNOWN" || keywordTrends.length > 0) {
            lines.push(`## Market Timing`);
            lines.push(``);
            lines.push(`- **Overall trend:** ${trendInfo.label}`);
            lines.push(`- **Average change:** ${trendInfo.avgChange >= 0 ? "+" : ""}${trendInfo.avgChange}%`);
            if (trendInfo.interest > 0) lines.push(`- **Current interest:** ${trendInfo.interest}/100`);
            keywordTrends.forEach((row) => {
                lines.push(`- **${row.keyword}:** ${row.change >= 0 ? "+" : ""}${row.change}% · interest ${row.interest}/100`);
            });
            lines.push(``);
        }

        if (normalizedPlatformWarnings.length > 0) {
            lines.push(`## Source Availability Warnings`);
            lines.push(``);
            normalizedPlatformWarnings.forEach((warning: string) => lines.push(`- ${warning}`));
            lines.push(``);
        }

        if (topSubredditCounts.length > 0) {
            lines.push(`## Source Provenance`);
            lines.push(``);
            topSubredditCounts.forEach((row: { name: string; count: number }) => lines.push(`- **r/${row.name.replace(/^r\//i, "")}:** ${row.count} posts`));
            lines.push(``);
        }

        if (topRisks.length > 0) {
            lines.push(`## Top Risks`);
            lines.push(``);
            topRisks.forEach((risk: Record<string, any>, i: number) => {
                lines.push(`${i + 1}. **${asString(risk.risk || risk.title || risk.detail)}**`);
                if (risk.mitigation) lines.push(`   - Mitigation: ${asString(risk.mitigation)}`);
            });
            lines.push(``);
        }

        if (primaryPersona) {
            lines.push(`## Ideal Customer Profile`);
            lines.push(``);
            lines.push(`- **Persona:** ${primaryPersona}`);
            if (icp.defining_pain_point || icp.pain_point) lines.push(`- **Pain Point:** ${String(icp.defining_pain_point || icp.pain_point)}`);
            if (icp.budget_range || icp.budget) lines.push(`- **Budget:** ${String(icp.budget_range || icp.budget)}`);
            lines.push(``);
        }

        const uniqueEv = evidence.filter(
            (ev: any, idx: number, self: any[]) =>
                idx === self.findIndex((e: any) => getEvidenceTitle(e) === getEvidenceTitle(ev))
        );
        if (uniqueEv.length > 0) {
            lines.push(`## Key Evidence`);
            lines.push(``);
            uniqueEv.slice(0, 10).forEach((ev: Record<string, any>) => {
                const title = getEvidenceTitle(ev);
                const source = getEvidenceSourceLabel(ev);
                const score = ev.score ?? ev.upvotes ?? "";
                lines.push(`- **"${title}"** — ${source}${score ? ` (+${score})` : ""}`);
            });
            lines.push(``);
        }

        if (competitors.length > 0) {
            lines.push(`## Competitors`);
            lines.push(``);
            competitors.forEach((c: any) => {
                const name = getCompetitorName(c);
                const gap = c.weakness || c.gap;
                lines.push(`- **${name}**${gap ? ` — Gap: ${String(gap)}` : ""}`);
            });
            lines.push(``);
        }

        if (roadmap.length > 0) {
            lines.push(`## Launch Roadmap`);
            lines.push(``);
            roadmap.forEach((step: any, i: number) => {
                lines.push(`### ${step.week || step.timeline || `Step ${i + 1}`}: ${step.title || step.phase || ""}`  );
                if (step.description) lines.push(String(step.description));
                if (Array.isArray(step.tasks)) step.tasks.forEach((t: string) => lines.push(`- ${t}`));
                lines.push(``);
            });
        }

        lines.push(`---`);
        lines.push(`*Generated by CueIdea on ${new Date().toISOString().split("T")[0]}*`);

        const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `report-${report.id.slice(0, 8)}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const exportAsPDF = () => {
        // ── Dedup evidence ──
        const seen = new Set<string>();
        const uniqueEv = evidence.filter((ev: any) => {
            const key = getEvidenceTitle(ev).trim().toLowerCase().replace(/\s+/g, " ");
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // ── Helpers ──
        const esc = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const listItems = (items: string[]) => items.map(s => `<li>${esc(s)}</li>`).join("");
        const section = (title: string, content: string) => content ? `<h2>${title}</h2>${content}` : "";
        const kv = (label: string, value: any) => value ? `<li><strong>${label}:</strong> ${esc(String(value))}</li>` : "";

        // ── Source line ──
        const sourceLine = sourceStatus.map(s => `${s.label}: ${s.count}`).join(" · ");

        // ── Signal summary metrics ──
        const signalMetrics = [
            signalSummary.pain_signals_count !== undefined ? `Pain signals: ${signalSummary.pain_signals_count}` : "",
            explicitPainQuotes > 0 ? `Explicit pain quotes: ${explicitPainQuotes}` : "",
            signalSummary.willingness_to_pay_count !== undefined ? `WTP signals: ${signalSummary.willingness_to_pay_count}` : "",
            signalSummary.competitor_mention_count !== undefined ? `Competitor mentions: ${signalSummary.competitor_mention_count}` : "",
            signalSummary.feature_request_count !== undefined ? `Feature requests: ${signalSummary.feature_request_count}` : "",
        ].filter(Boolean);
        const sourceWarningsHtml = normalizedPlatformWarnings.length > 0
            ? `<h2>Source Availability Warnings</h2><ul>${normalizedPlatformWarnings.map((warning: string) => `<li>${esc(warning)}</li>`).join("")}</ul>`
            : "";
        const trendHtml = (trendInfo.label !== "UNKNOWN" || keywordTrends.length > 0)
            ? `<h2>Market Timing</h2>
        <p>${esc(trendInfo.summary)} Overall trend: <strong>${esc(trendInfo.label)}</strong> (${trendInfo.avgChange >= 0 ? "+" : ""}${trendInfo.avgChange.toFixed(1)}%).${trendInfo.interest > 0 ? ` Current interest: ${trendInfo.interest}/100.` : ""}</p>
        ${keywordTrends.length > 0 ? `<ul>${keywordTrends.map((row: { keyword: string; change: number; interest: number }) => `<li><strong>${esc(row.keyword)}</strong> — ${row.change >= 0 ? "+" : ""}${row.change.toFixed(1)}%, interest ${row.interest}/100</li>`).join("")}</ul>` : ""}`
            : "";
        const claimContractHtml = claimEntries.length > 0
            ? `<h2>Claim Quality</h2>
        <table class="info-table">
            <tr><th style="text-align:left">Claim</th><th style="text-align:left">Value</th><th style="text-align:left">Support</th><th style="text-align:left">Tier</th></tr>
            ${claimEntries.map((entry: ClaimContractEntry) => {
                const support = getClaimSupportMeta(entry.support_level).label;
                const tier = getClaimTierMeta(entry.trust_tier).label;
                const basis = entry.source_basis.length > 0 ? `<br/><small style="color:#888">${esc(entry.source_basis.join(" · "))}</small>` : "";
                return `<tr>
                    <td>${esc(entry.label)}</td>
                    <td>${esc(entry.value || "—")}${basis}</td>
                    <td>${esc(support)}</td>
                    <td>${esc(tier)}</td>
                </tr>`;
            }).join("")}
        </table>`
            : "";
        const founderReadoutHtml = (firstMove || interviewQuestion || timingHeadline || confidenceReasoning)
            ? `<h2>Founder Readout</h2>
        <ul>
            ${firstMove ? `<li><strong>First move:</strong> ${esc(firstMove)}</li>` : ""}
            ${interviewQuestion ? `<li><strong>Interview question:</strong> ${esc(interviewQuestion)}</li>` : ""}
            ${timingStatus || timingHeadline ? `<li><strong>Timing:</strong> ${esc([timingStatus, timingHeadline].filter(Boolean).join(" — "))}</li>` : ""}
            ${confidenceReasoning ? `<li><strong>Confidence reasoning:</strong> ${esc(confidenceReasoning)}</li>` : ""}
        </ul>`
            : "";
        const claimVerificationHtml = (claimVerificationTotal > 0 || evidenceQuality.strongest_evidence || evidenceQuality.weakest_point)
            ? `<h2>Claim Verification</h2>
        <ul>
            ${claimVerificationTotal > 0 ? `<li><strong>Verified:</strong> ${verifiedClaims.length} · <strong>Unverified:</strong> ${unverifiedClaims.length} · <strong>Contradicted:</strong> ${contradictedClaims.length} · <strong>Speculative:</strong> ${speculativeClaims.length}</li>` : ""}
            ${evidenceQuality.strongest_evidence ? `<li><strong>Strongest evidence:</strong> ${esc(String(evidenceQuality.strongest_evidence))}</li>` : ""}
            ${evidenceQuality.weakest_point ? `<li><strong>Weakest point:</strong> ${esc(String(evidenceQuality.weakest_point))}</li>` : ""}
        </ul>`
            : "";
        const provenanceHtml = topSubredditCounts.length > 0
            ? `<h2>Source Provenance</h2><ul>${topSubredditCounts.map((row: { name: string; count: number }) => `<li><strong>r/${esc(row.name.replace(/^r\//i, ""))}</strong> — ${row.count} posts</li>`).join("")}</ul>`
            : "";

        // ── ICP section ──
        const icpHtml = primaryPersona ? `<h2>Ideal Customer Profile</h2>
        <table class="info-table">
            ${primaryPersona ? `<tr><td class="label">Persona</td><td>${esc(primaryPersona)}</td></tr>` : ""}
            ${icp.defining_pain_point || icp.pain_point ? `<tr><td class="label">Pain Point</td><td>${esc(String(icp.defining_pain_point || icp.pain_point))}</td></tr>` : ""}
            ${icp.where_they_gather || icp.hangout ? `<tr><td class="label">Where They Gather</td><td>${esc(String(icp.where_they_gather || icp.hangout))}</td></tr>` : ""}
            ${icp.budget_range || icp.budget ? `<tr><td class="label">Budget Range</td><td>${esc(String(icp.budget_range || icp.budget))}</td></tr>` : ""}
        </table>
        ${communities.length > 0 ? `<p class="sub"><strong>Communities:</strong> ${communities.map((c: any) => esc(getCommunityName(c))).filter(Boolean).join(", ")}</p>` : ""}
        ${tools.length > 0 ? `<p class="sub"><strong>Tools they use:</strong> ${tools.map((t: any) => esc(String(t.name || t))).join(", ")}</p>` : ""}
        ${objections.length > 0 ? `<p class="sub"><strong>Buying objections:</strong> ${objections.map((o: any) => esc(String(o.objection || o))).join("; ")}</p>` : ""}
        ${prevSolutions.length > 0 ? `<p class="sub"><strong>Previous solutions tried:</strong> ${prevSolutions.map((s: any) => esc(String(s.solution || s))).join(", ")}</p>` : ""}
        ${wtpEvidence.length > 0 ? `<p class="sub"><strong>Willingness to pay:</strong> ${wtpEvidence.map((w: any) => esc(String(w.evidence || w))).join("; ")}</p>` : ""}
        ` : "";

        // ── Competition section ──
        const compHtml = (comp.market_saturation || comp.your_unfair_advantage || competitors.length > 0) ? `<h2>Competition Landscape</h2>
        ${comp.market_saturation ? `<p><strong>Market Saturation:</strong> ${esc(String(comp.market_saturation))}</p>` : ""}
        ${comp.your_unfair_advantage ? `<p><strong>Your Unfair Advantage:</strong> ${esc(String(comp.your_unfair_advantage))}</p>` : ""}
        ${competitors.length > 0 ? `<table class="comp-table">
            <tr><th>Competitor</th><th>Gap</th><th>Threat</th></tr>
            ${competitors.map((c: any) => `<tr><td>${esc(getCompetitorName(c))}</td><td>${esc(String(c.weakness || c.gap || "—"))}</td><td><span class="badge ${(String(c.threat_level || "")).toUpperCase() === "HIGH" ? "badge-high" : "badge-med"}">${esc(String(c.threat_level || "—"))}</span></td></tr>`).join("")}
        </table>` : ""}` : "";

        // ── All risks (with debate fallback) ──
        const effectiveRisks = risks.length > 0 ? risks : topRisks;
        const riskAssessmentSuffix = risks.length === 0
            ? debateGuardrailOverride
                ? " (guardrail fallback)"
                : " (from AI Debate)"
            : "";
        const allRisksHtml = effectiveRisks.length > 0 ? `<h2>Risk Assessment${riskAssessmentSuffix}</h2>
        ${risks.length > 0 ? `<table class="risk-table">
            <tr><th>Risk</th><th>Severity</th><th>Probability</th><th>Mitigation</th></tr>
            ${risks.map((risk: any) => `<tr>
                <td>${esc(String(risk.risk || risk.title || risk.detail || ""))}</td>
                <td><span class="badge ${String(risk.severity || "MEDIUM").toUpperCase() === "HIGH" ? "badge-high" : "badge-med"}">${esc(String(risk.severity || "—"))}</span></td>
                <td><span class="badge">${esc(String(risk.probability || risk.likelihood || "—"))}</span></td>
                <td>${esc(String(risk.mitigation || "—"))}</td>
            </tr>`).join("")}
        </table>` : `<ul>${effectiveRisks.map((risk: any) => {
            const text = esc(String(risk.risk || risk.title || risk.detail || ""));
            const mitigation = risk.mitigation ? `<br/><small style="color:#888">${esc(String(risk.mitigation))}</small>` : "";
            return `<li>${text}${mitigation}</li>`;
        }).join("")}</ul>`}` : "";

        // ── MVP & cut features ──
        const featuresHtml = (mvpFeatures.length > 0 || cutFeatures.length > 0) ? `<h2>Feature Prioritization</h2>
        ${mvpFeatures.length > 0 ? `<h3>✅ Build This (MVP)</h3><ul>${mvpFeatures.map((f: any) => `<li><strong>${esc(String(f.name || f.feature || f.title || f))}</strong>${f.reason || f.why ? ` — ${esc(String(f.reason || f.why))}` : ""}</li>`).join("")}</ul>` : ""}
        ${cutFeatures.length > 0 ? `<h3>❌ Don't Build This</h3><ul>${cutFeatures.map((f: any) => `<li><strong>${esc(String(f.name || f.feature || f.title || f))}</strong>${f.reason || f.why ? ` — ${esc(String(f.reason || f.why))}` : ""}</li>`).join("")}</ul>` : ""}` : "";

        // ── Monetization ──
        const monetizationHtml = monetizationChannels.length > 0 ? `<h2>Monetization Channels</h2>
        <ul>${monetizationChannels.map((ch: any) => `<li><strong>${esc(String(ch.channel || ch.name || "Channel"))}</strong>${ch.expected_revenue || ch.revenue ? ` — ${esc(String(ch.expected_revenue || ch.revenue))}` : ""}</li>`).join("")}</ul>` : "";

        // ── Pricing ──
        const pricingHtml = (pricing.recommended_model || pricing.recommended_price) ? `<h2>Pricing Strategy</h2>
        <table class="info-table">
            ${pricing.recommended_model ? `<tr><td class="label">Model</td><td>${esc(String(pricing.recommended_model))}</td></tr>` : ""}
            ${pricing.recommended_price ? `<tr><td class="label">Price</td><td>${esc(String(pricing.recommended_price))}</td></tr>` : ""}
            ${pricing.pricing_confidence ? `<tr><td class="label">Confidence</td><td>${esc(String(pricing.pricing_confidence))}</td></tr>` : ""}
        </table>` : "";

        // ── Evidence log ──
        const evidenceHtml = uniqueEv.length > 0 ? `<h2>Evidence Log (${uniqueEv.length} posts)</h2>
        <table class="evidence-table">
            <tr><th>#</th><th>Post</th><th>Source</th><th>Score</th><th>Tier</th></tr>
            ${uniqueEv.map((ev: any, i: number) => {
                const tier = resolveEvidenceTier(ev, tierLookup);
                const annotation = String(ev.what_it_proves || ev.relevance || "");
                return `<tr>
                    <td>${i + 1}</td>
                    <td>${esc(getEvidenceTitle(ev))}${annotation ? `<br/><small style="color:#888;font-style:italic">→ ${esc(annotation)}</small>` : ""}</td>
                    <td>${esc(getEvidenceSourceLabel(ev))}</td>
                    <td>${ev.score ?? ev.upvotes ?? "—"}</td>
                    <td><span class="badge ${tier === "DIRECT" ? "badge-direct" : tier === "ADJACENT" ? "badge-adj" : "badge-irr"}">${tier}</span></td>
                </tr>`;
            }).join("")}
        </table>` : "";

        // ── Debate summary ──
        const debateHtml = debateSummary.models > 0 ? `<h2>AI Debate Room</h2>
        <p class="meta">${debateSummary.models} models · ${debateSummary.rounds} rounds — ${esc(debateSummary.summary)}</p>
        ${debateGuardrailOverride && debateGuardrailNote ? `<div style="margin:12px 0;padding:12px;border:1px solid #3f3f46;border-radius:8px;background:#18181b;color:#d4d4d8;font-size:12px;line-height:1.6">${esc(debateGuardrailNote)}</div>` : ""}
        ${debateLogRaw.length > 0 ? debateLogRaw.map((entry: DebateLogEntry) => `<div style="margin:16px 0;padding:12px;border:1px solid #2a2a2a;border-radius:8px;background:#141414">
            <p style="margin:0 0 4px;color:#e0e0e0"><strong>${esc(entry.model)}</strong> <span style="color:#555">/</span> <strong>${esc(humanizeRole(entry.role))}</strong></p>
            <p style="margin:0 0 8px"><span class="badge ${entry.verdict?.toUpperCase().includes("BUILD") ? "badge-direct" : entry.verdict?.toUpperCase().includes("DON") ? "badge-high" : "badge-med"}">${esc(entry.verdict)}</span> <span style="color:#777">${entry.confidence}% confidence</span> ${entry.changed ? `<span class="badge badge-med">Changed</span>` : ""}</p>
            <p style="margin:0;font-size:12px;line-height:1.6;color:#bbb">${esc(entry.reasoning)}</p>
        </div>`).join("") : ""}` : "";

        // ── Roadmap ──
        const roadmapHtml = roadmap.length > 0 ? `<h2>Launch Roadmap</h2>
        ${roadmap.map((step: any, i: number) => `<div class="roadmap-step">
            <h3>${esc(step.week || step.timeline || `Step ${i + 1}`)}: ${esc(step.title || step.phase || "")}</h3>
            ${step.description ? `<p>${esc(String(step.description))}</p>` : ""}
            ${Array.isArray(step.tasks) ? `<ul>${step.tasks.map((t: string) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
            ${step.validation_gate ? `<p class="gate">🚦 Gate: ${esc(String(step.validation_gate))}</p>` : ""}
        </div>`).join("")}` : "";

        // ── First 10 customers ──
        const first10Html = Object.keys(first10).length > 0 ? `<h2>First 10 Customers Strategy</h2>
        <div class="first10">
            ${["customers_1_3", "customers_4_7", "customers_8_10"].map((key, i) => {
                const data = first10[key] || {};
                const label = ["Customers 1-3", "Customers 4-7", "Customers 8-10"][i];
                if (!data.source && !first10[`step_${i + 1}`]) return "";
                const source = data.source || first10[`step_${i + 1}`] || "";
                const tactic = data.tactic || "";
                return `<p><strong>${label}:</strong> ${esc(String(source))}${tactic ? ` (Tactic: ${esc(String(tactic))})` : ""}</p>`;
            }).join("")}
        </div>` : "";

        // ── Research plan (for thin data) ──
        const researchHtml = insufficientEvidence ? `<h2>⚠ Research Plan (Data Is Thin)</h2>
        <p>Only ${directCount} posts directly address this idea. Strategy sections should be validated with buyer interviews first.</p>
        <ol>
            <li><strong>Find Better Keywords:</strong> Current: ${betterKeywords.length > 0 ? betterKeywords.join(", ") : "none detected"}. Use the language your buyers actually use.</li>
            <li><strong>Interview 5 ${primaryPersona ? esc(primaryPersona.split(/[,.(]/)[0].trim()) : "Potential Buyers"}:</strong> ${interviewQuestion ? esc(interviewQuestion) : "Ask about their current workflow and pain."}</li>
            <li><strong>Check Adjacent Communities:</strong> ${communities.length > 0 ? communities.slice(0, 3).map((c: any) => esc(getCommunityName(c))).filter(Boolean).join(", ") : "No target communities identified yet."}</li>
            <li><strong>Rerun Validation:</strong> After gathering more signal, run a deeper validation with refined keywords.</li>
        </ol>` : "";

        // ── Full HTML ──
        const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Report — ${esc(report.idea_text.slice(0, 60))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 28px; color: #e0e0e0; line-height: 1.65; font-size: 13px; background: #0d0d0d; }
  h1 { font-size: 20px; border-bottom: 2px solid #2a2a2a; padding-bottom: 8px; margin-bottom: 4px; color: #f5f5f5; }
  h2 { font-size: 15px; color: #ccc; margin-top: 28px; border-bottom: 1px solid #222; padding-bottom: 4px; }
  h3 { font-size: 13px; color: #aaa; margin: 12px 0 4px; }
  p { margin: 6px 0; }
  .verdict { display: inline-block; padding: 5px 14px; border-radius: 6px; font-weight: bold; font-size: 13px; letter-spacing: 0.5px; }
  .build { background: #14532d; color: #86efac; }
  .risky { background: #78350f; color: #fde68a; }
  .dont { background: #7f1d1d; color: #fca5a5; }
  .meta { color: #888; font-size: 12px; margin: 2px 0; }
  .metrics { display: flex; gap: 16px; margin: 12px 0; flex-wrap: wrap; }
  .metric { background: #161616; border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px 14px; text-align: center; min-width: 100px; }
  .metric-val { font-size: 18px; font-weight: bold; color: #f0f0f0; }
  .metric-lbl { font-size: 10px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; }
  ul { padding-left: 18px; }
  li { margin-bottom: 4px; color: #ccc; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
  th, td { border: 1px solid #2a2a2a; padding: 6px 10px; text-align: left; color: #ccc; }
  th { background: #1a1a1a; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; color: #999; }
  .info-table { width: auto; }
  .info-table .label { font-weight: 600; color: #999; width: 140px; background: #141414; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; background: #1a1a1a; color: #999; }
  .badge-high { background: #450a0a; color: #fca5a5; }
  .badge-med { background: #451a03; color: #fde68a; }
  .badge-direct { background: #052e16; color: #86efac; }
  .badge-adj { background: #451a03; color: #fde68a; }
  .badge-irr { background: #1a1a1a; color: #666; }
  .sub { font-size: 12px; color: #999; margin: 4px 0 4px 8px; }
  .gate { background: #451a03; border: 1px solid #78350f; border-radius: 4px; padding: 4px 10px; font-size: 11px; color: #fde68a; }
  .roadmap-step { margin-bottom: 16px; padding-left: 12px; border-left: 3px solid #333; }
  .footer { margin-top: 40px; padding-top: 10px; border-top: 1px solid #222; font-size: 10px; color: #555; text-align: center; }
  @media print { body { margin: 20px; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<h1>${esc(report.idea_text)}</h1>
<p><span class="verdict ${vs.label.includes("BUILD") ? "build" : vs.label.includes("DON") ? "dont" : "risky"}">${vs.label}</span></p>
<p class="meta">Confidence: ${report.confidence}% · ${new Date(report.created_at).toLocaleDateString()} · Depth: ${report.depth || "standard"} · Sources: ${sourceLine}</p>
<p class="meta">Evidence: ${directCount} direct · ${adjacentCount} adjacent · ${irrelevantCount} irrelevant · ${evidencePoints} total posts</p>
<p class="meta">Raw collected: ${rawCollectedCount} · Filtered corpus: ${filteredCorpusCount} · Used in synthesis: ${filteredAnalyzedCount}</p>
<p class="meta">DB history contribution: ${dbHistoryContribution} · Canonical DIRECT: ${directCount}</p>

${signalMetrics.length > 0 ? `<div class="metrics">${signalMetrics.map(m => { const [label, val] = m.split(": "); return `<div class="metric"><div class="metric-val">${val}</div><div class="metric-lbl">${label}</div></div>`; }).join("")}</div>` : ""}

${execSummary ? `<h2>Executive Summary</h2><p>${esc(execSummary)}</p>` : ""}

${trendHtml}

${claimContractHtml}

${founderReadoutHtml}

${claimVerificationHtml}

${sourceWarningsHtml}

${researchHtml}

${icpHtml}

${compHtml}

${allRisksHtml}

${featuresHtml}

${pricingHtml}

${monetizationHtml}

${evidenceHtml}

${provenanceHtml}

${debateHtml}

${roadmapHtml}

${first10Html}

<div class="footer">Generated by CueIdea · ${new Date().toISOString().split("T")[0]} · Report ID: ${report.id.slice(0, 8)}</div>
</body></html>`;

        const win = window.open("", "_blank");
        if (win) {
            win.document.write(html);
            win.document.close();
            setTimeout(() => win.print(), 400);
        }
    };

    return (
        <div className="mx-auto w-full max-w-6xl px-3 pb-28 pt-4 sm:px-4 sm:pt-6 lg:px-8 lg:pb-8 lg:pl-16">
            {/* Back */}
            <button onClick={() => router.push("/dashboard/reports")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground font-mono text-[11px] uppercase tracking-widest transition-colors mb-6">
                <ArrowLeft className="w-3 h-3" /> Back
            </button>

            {/* ═══════════ SECTION 1 — VERDICT CARD ═══════════ */}
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bento-cell mb-6 p-4 sm:p-6">
                <div className="flex flex-col lg:flex-row gap-6 items-start justify-between">
                    <div className="flex-1 min-w-0">
                        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-base font-mono uppercase font-bold tracking-widest ${vs.bg} ${vs.border} ${vs.color}`}>
                            <VIcon className="w-5 h-5" /> {vs.label}
                        </div>
                        {oneSentence && <p className="mt-4 text-sm text-foreground/90 leading-relaxed max-w-3xl">{oneSentence}</p>}
                        <p className="mt-2 text-xs text-muted-foreground line-clamp-2 max-w-3xl" title={report.idea_text}>{report.idea_text}</p>
                    </div>
                    <div className="flex flex-col items-center min-w-[120px]">
                        <div className="relative w-24 h-24 flex items-center justify-center">
                            <svg className="absolute inset-0 w-full h-full -rotate-90">
                                <circle cx="48" cy="48" r="40" fill="none" className="stroke-white/5" strokeWidth="5" />
                                <motion.circle cx="48" cy="48" r="40" fill="none" className={`stroke-current ${vs.color}`} strokeWidth="5" strokeLinecap="round" strokeDasharray={2 * Math.PI * 40} initial={{ strokeDashoffset: 2 * Math.PI * 40 }} animate={{ strokeDashoffset: (2 * Math.PI * 40) * (1 - report.confidence / 100) }} transition={{ duration: 1.5, ease: "easeOut" }} />
                            </svg>
                            <div className={`font-mono text-xl font-bold ${vs.color}`}>{report.confidence}%</div>
                        </div>
                        <div className={`mt-2 px-2 py-0.5 rounded text-[10px] font-mono text-center ${confDesc.tone}`}>{confDesc.label}</div>
                    </div>
                </div>

                {/* Evidence quality bar */}
                <div className="mt-5 pt-4 border-t border-white/5">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Evidence Quality</div>
                    <div className="flex h-3 w-full rounded-full overflow-hidden bg-white/5 border border-white/10">
                        {directCount > 0 && <div className="h-full bg-build transition-all" style={{ width: `${(directCount / totalEvidenceBar) * 100}%` }} title={`${directCount} direct`} />}
                        {adjacentCount > 0 && <div className="h-full bg-risky transition-all" style={{ width: `${(adjacentCount / totalEvidenceBar) * 100}%` }} title={`${adjacentCount} adjacent`} />}
                        {irrelevantCount > 0 && <div className="h-full bg-zinc-600 transition-all" style={{ width: `${(irrelevantCount / totalEvidenceBar) * 100}%` }} title={`${irrelevantCount} irrelevant`} />}
                    </div>
                    <div className="flex gap-4 mt-2 text-[11px] font-mono text-muted-foreground">
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-build" />{directCount} direct</span>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-risky" />{adjacentCount} adjacent</span>
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-zinc-600" />{irrelevantCount} irrelevant</span>
                    </div>
                    {explicitPainQuotes > 0 && (
                        <div className="mt-2 text-[11px] font-mono text-muted-foreground">
                            Explicit pain quotes: {explicitPainQuotes}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:col-span-2">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="font-mono text-[10px] uppercase tracking-widest text-primary">Evidence Funnel</div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Raw collection, filtered corpus, and canonical proof are different layers. The debate only reasons over the filtered corpus, not every raw hit.
                                </p>
                            </div>
                            <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                                Explainable
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Raw collected</div>
                                <div className="mt-2 text-2xl font-mono font-bold text-white">{rawCollectedCount}</div>
                                <p className="mt-1 text-[11px] text-muted-foreground">All source hits before filtering.</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Filtered corpus</div>
                                <div className="mt-2 text-2xl font-mono font-bold text-white">{filteredCorpusCount}</div>
                                <p className="mt-1 text-[11px] text-muted-foreground">Posts kept for synthesis after deterministic filtering.</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">DB history</div>
                                <div className="mt-2 text-2xl font-mono font-bold text-white">{dbHistoryContribution}</div>
                                <p className="mt-1 text-[11px] text-muted-foreground">Relevant recent posts pulled from CueIdea memory.</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Canonical direct</div>
                                <div className="mt-2 text-2xl font-mono font-bold text-build">{directCount}</div>
                                <p className="mt-1 text-[11px] text-muted-foreground">Buyer-native proof that survived the strict evidence contract.</p>
                            </div>
                        </div>
                        <div className="mt-3 text-[11px] text-muted-foreground">{evidenceFunnelNote}</div>
                    </div>

                    <div className={`rounded-2xl border p-4 ${getValidityTone(problemValidityLabel)}`}>
                        <div className="flex items-center justify-between gap-3">
                            <div className="font-mono text-[10px] uppercase tracking-widest">Problem Validity</div>
                            <Badge text={problemValidityLabel} className={getValidityTone(problemValidityLabel)} />
                        </div>
                        <div className="mt-2 text-2xl font-mono font-bold">{toNumber(problemValidity.score, directCount * 10)}%</div>
                        <p className="mt-2 text-xs leading-relaxed text-foreground/80">
                            {asString(problemValidity.summary || `Pain proof from buyer-native evidence: ${directCount} direct, ${adjacentCount} adjacent.`)}
                        </p>
                    </div>
                    <div className={`rounded-2xl border p-4 ${getValidityTone(businessValidityLabel)}`}>
                        <div className="flex items-center justify-between gap-3">
                            <div className="font-mono text-[10px] uppercase tracking-widest">Business Validity</div>
                            <Badge text={businessValidityLabel} className={getValidityTone(businessValidityLabel)} />
                        </div>
                        <div className="mt-2 text-2xl font-mono font-bold">{toNumber(businessValidity.score, report.confidence)}%</div>
                        <p className="mt-2 text-xs leading-relaxed text-foreground/80">
                            {asString(businessValidity.summary || "Market, monetization, and category support signals separate from direct pain proof.")}
                        </p>
                    </div>
                </div>

                {claimEntries.length > 0 && (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="font-mono text-[10px] uppercase tracking-widest text-primary">Claim Quality</div>
                                <p className="mt-1 text-xs text-muted-foreground">Evidence-backed claims can drive decisions. Supporting claims add context. Hypotheses should guide interviews, not verdicts.</p>
                            </div>
                            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{claimContract.version}</div>
                        </div>
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                            {claimEntries.map((entry: ClaimContractEntry) => {
                                const supportMeta = getClaimSupportMeta(entry.support_level);
                                const tierMeta = getClaimTierMeta(entry.trust_tier);
                                return (
                                    <div key={entry.claim_id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="font-mono text-[10px] uppercase tracking-widest text-foreground/80">{entry.label}</div>
                                            <Badge text={supportMeta.label} className={supportMeta.className} />
                                        </div>
                                        <div className="mt-2 text-sm font-medium text-foreground">{entry.value || "—"}</div>
                                        {entry.summary && <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{entry.summary}</p>}
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{tierMeta.label}</span>
                                            {entry.buyer_native && (
                                                <span className="inline-flex items-center rounded-full border border-build/20 bg-build/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-build">buyer-native</span>
                                            )}
                                            {entry.allowed_for_problem_validity && (
                                                <span className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-cyan-300">problem</span>
                                            )}
                                            {entry.allowed_for_business_validity && (
                                                <span className="inline-flex items-center rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-emerald-300">business</span>
                                            )}
                                        </div>
                                        {entry.source_basis.length > 0 && (
                                            <ul className="mt-3 flex flex-col gap-1">
                                                {entry.source_basis.slice(0, 3).map((basis, index) => (
                                                    <li key={index} className="text-[10px] text-muted-foreground">- {basis}</li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {(firstMove || interviewQuestion || timingHeadline || confidenceReasoning) && (
                    <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
                        {firstMove && (
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-primary">First Move</div>
                                <p className="mt-2 text-sm leading-relaxed text-foreground/90">{firstMove}</p>
                                {interviewQuestion && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Interview ask: {interviewQuestion}</p>}
                            </div>
                        )}
                        {!firstMove && interviewQuestion && (
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-primary">Interview Question</div>
                                <p className="mt-2 text-sm leading-relaxed text-foreground/90">{interviewQuestion}</p>
                            </div>
                        )}
                        {(timingStatus || timingHeadline) && (
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
                                    <Clock className="h-3.5 w-3.5" />
                                    Timing Read
                                </div>
                                {timingStatus && <div className="mt-2 text-xs font-mono uppercase tracking-widest text-build">{timingStatus}</div>}
                                {timingHeadline && <p className="mt-2 text-sm leading-relaxed text-foreground/90">{timingHeadline}</p>}
                            </div>
                        )}
                        {confidenceReasoning && (
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-primary">Confidence Reasoning</div>
                                <p className="mt-2 text-sm leading-relaxed text-foreground/90">{confidenceReasoning}</p>
                            </div>
                        )}
                    </div>
                )}

                {(claimVerificationTotal > 0 || evidenceQuality.strongest_evidence || evidenceQuality.weakest_point) && (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="font-mono text-[10px] uppercase tracking-widest text-primary">Claim Verification</div>
                                <p className="mt-1 text-xs text-muted-foreground">A final verifier checked which report claims are grounded, weak, or contradicted by the evidence board.</p>
                            </div>
                            {claimVerificationTotal > 0 && (
                                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                                    {claimVerificationTotal} claims checked
                                </div>
                            )}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                            {verifiedClaims.length > 0 && <Badge text={`Verified ${verifiedClaims.length}`} className="border-build/20 bg-build/10 text-build" />}
                            {unverifiedClaims.length > 0 && <Badge text={`Unverified ${unverifiedClaims.length}`} className="border-white/10 bg-white/5 text-muted-foreground" />}
                            {contradictedClaims.length > 0 && <Badge text={`Contradicted ${contradictedClaims.length}`} className="border-dont/20 bg-dont/10 text-dont" />}
                            {speculativeClaims.length > 0 && <Badge text={`Speculative ${speculativeClaims.length}`} className="border-risky/20 bg-risky/10 text-risky" />}
                        </div>
                        {(evidenceQuality.strongest_evidence || evidenceQuality.weakest_point) && (
                            <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
                                {evidenceQuality.strongest_evidence && (
                                    <div className="rounded-xl border border-build/15 bg-build/5 p-3">
                                        <div className="font-mono text-[10px] uppercase tracking-widest text-build">Strongest evidence</div>
                                        <p className="mt-2 text-xs leading-relaxed text-foreground/85">{asString(evidenceQuality.strongest_evidence)}</p>
                                    </div>
                                )}
                                {evidenceQuality.weakest_point && (
                                    <div className="rounded-xl border border-risky/15 bg-risky/5 p-3">
                                        <div className="font-mono text-[10px] uppercase tracking-widest text-risky">Weakest point</div>
                                        <p className="mt-2 text-xs leading-relaxed text-foreground/85">{asString(evidenceQuality.weakest_point)}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {report.report?.reddit_lab_context?.enabled && (
                    <div className="mt-4 rounded-2xl border border-primary/15 bg-primary/5 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="font-mono text-[10px] uppercase tracking-widest text-primary">Reddit Lab Context</div>
                                <p className="mt-1 text-xs text-muted-foreground">This validation used optional Reddit lab settings on top of the default app scrape.</p>
                            </div>
                            <Badge text="experimental" className="bg-primary/15 text-primary border-primary/20" />
                        </div>
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Account</div>
                                    <div className="mt-2 text-sm font-medium text-foreground">{asString(report.report.reddit_lab_context.reddit_username || "Connected Reddit")}</div>
                                    <p className="mt-2 text-[11px] text-muted-foreground">Connected Reddit account</p>
                                </div>
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Source Pack</div>
                                <div className="mt-2 text-sm font-medium text-foreground">{asString(report.report.reddit_lab_context.source_pack_name || "None")}</div>
                                <p className="mt-2 text-[11px] text-muted-foreground">{Array.isArray(report.report.reddit_lab_context.source_pack_subreddits) ? report.report.reddit_lab_context.source_pack_subreddits.length : 0} subreddit targets</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Connected API</div>
                                <div className="mt-2 text-sm font-medium text-foreground">{report.report.reddit_lab_context.use_connected_context ? "Enabled" : "Off"}</div>
                                <p className="mt-2 text-[11px] text-muted-foreground">User-authorized Reddit API lane</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Source badges */}
                <div className="flex gap-2 flex-wrap mt-4">
                    {sourceStatus.map(s => (
                        <span key={s.label} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono uppercase tracking-widest ${s.count > 0 ? "border-build/20 bg-build/10 text-build" : "border-white/10 bg-white/5 text-muted-foreground"}`}>
                            {s.count > 0 ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} {s.label} {s.count > 0 ? `(${s.count})` : ""}
                        </span>
                    ))}
                </div>
                {normalizedPlatformWarnings.length > 0 && (
                    <div className="mt-4 flex flex-col gap-2">
                        {normalizedPlatformWarnings.slice(0, 3).map((warning: string, i: number) => (
                            <div key={i} className="rounded-xl border border-risky/20 bg-risky/5 px-3 py-2 text-xs text-risky flex items-start gap-2">
                                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                <span>{warning}</span>
                            </div>
                        ))}
                    </div>
                )}
            </motion.div>

            {/* ═══════════ SECTION 2 — THE THREE THINGS ═══════════ */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {/* Top Signals */}
                <div className="bento-cell p-5">
                    <SectionHeader icon={TrendingUp} label="Top Signals" color="text-build" />
                    <div className="flex flex-col gap-3 mt-3">
                        {directEvidence.length > 0 ? directEvidence.map((ev: Record<string, any>, i: number) => (
                            <div key={i} className="bg-build/5 border border-build/15 rounded-xl p-3">
                                <p className="text-xs text-foreground font-medium line-clamp-2">{truncateText(getEvidenceTitle(ev), 80)}</p>
                                <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-muted-foreground">
                                    <span className="text-build">{getEvidenceSourceLabel(ev)}</span>
                                    {(ev.score ?? ev.upvotes) ? <span>+{ev.score ?? ev.upvotes}</span> : null}
                                </div>
                            </div>
                        )) : <p className="text-xs text-muted-foreground mt-2">No direct signals found</p>}
                    </div>
                </div>

                {/* Top Risks */}
                <div className="bento-cell p-5">
                    <SectionHeader icon={Shield} label="Top Risks" color="text-dont" />
                    <div className="flex flex-col gap-3 mt-3">
                        {topRisks.length > 0 ? topRisks.map((risk: Record<string, any>, i: number) => (
                            <div key={i} className="bg-dont/5 border border-dont/15 rounded-xl p-3">
                                <p className="text-xs text-foreground font-medium line-clamp-2">{asString(risk.risk || risk.title || risk.detail)}</p>
                                {risk.mitigation && <p className="text-[10px] text-dont/70 mt-1 line-clamp-2">→ {asString(risk.mitigation)}</p>}
                            </div>
                        )) : <p className="text-xs text-muted-foreground mt-2">No risk factors identified</p>}
                    </div>
                </div>

                {/* What To Do Next */}
                <div className="bento-cell p-5">
                    <SectionHeader icon={Zap} label="What To Do Next" color="text-blue-400" />
                    <div className="mt-3">
                        {firstMove ? (
                            <div className="bg-blue-500/5 border border-blue-400/15 rounded-xl p-3">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-blue-400 mb-1">First Move</div>
                                <p className="text-xs text-foreground font-medium">{firstMove}</p>
                                {confidenceReasoning && <p className="text-[10px] text-muted-foreground mt-2 line-clamp-3">{confidenceReasoning}</p>}
                            </div>
                        ) : directCount >= 10 && roadmap.length > 0 ? (
                            <div className="bg-blue-500/5 border border-blue-400/15 rounded-xl p-3">
                                <div className="font-mono text-[10px] uppercase tracking-widest text-blue-400 mb-1">First Launch Step</div>
                                <p className="text-xs text-foreground font-medium">{asString(roadmap[0].title || roadmap[0].phase || roadmap[0].step)}</p>
                                {roadmap[0].description && <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{asString(roadmap[0].description)}</p>}
                            </div>
                        ) : (
                            <div className="bg-blue-500/5 border border-blue-400/15 rounded-xl p-3">
                                <p className="text-xs text-foreground font-medium">Talk to 5 {primaryPersona ? truncateText(primaryPersona, 40) : "potential buyers"} before writing code.</p>
                                <p className="text-[10px] text-muted-foreground mt-2">Ask: &quot;How do you handle this pain today? What would you pay to make it disappear?&quot;</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ═══════════ SECTION 3 — RESEARCH PLAN (only if insufficient) ═══════════ */}
            {insufficientEvidence && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bento-cell p-6 mb-6 border-l-4 border-risky/40">
                    <SectionHeader icon={Search} label="Data Is Thin — Research Plan" color="text-risky" />
                    <p className="text-sm text-muted-foreground mt-3">Only {directCount} posts directly address this idea. Strategy sections are hidden because they cannot be trusted. Validate with buyer interviews first.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                        <div className="bg-risky/5 border border-risky/15 rounded-xl p-3">
                            <div className="font-mono text-[10px] uppercase tracking-widest text-risky mb-1">Step 1 — Find Better Keywords</div>
                            <p className="text-xs text-foreground/80">Current top keywords: {betterKeywords.length > 0 ? betterKeywords.join(", ") : "none detected"}. Try the language your buyers actually use.</p>
                        </div>
                        <div className="bg-risky/5 border border-risky/15 rounded-xl p-3">
                            <div className="font-mono text-[10px] uppercase tracking-widest text-risky mb-1">Step 2 — Interview 5 {primaryPersona ? truncateText(primaryPersona.split(/[,.(]/)[0].trim(), 40) : "Potential Buyers"}</div>
                            <p className="text-xs text-foreground/80">
                                {(() => {
                                    if (interviewQuestion) {
                                        return `Ask: "${interviewQuestion}"`;
                                    }
                                    const rawPainDesc = asString(market.pain_description || market.pain_summary || "");
                                    const painDesc = isReportSystemMessage(rawPainDesc) ? "" : rawPainDesc;
                                    const firstPainQuote = directEvidence.length > 0 ? getEvidenceTitle(directEvidence[0]) : "";
                                    const pain = painDesc || firstPainQuote;
                                    if (!pain) {
                                        return "Ask: \"How do you handle this pain today? How many hours per week does it take?\"";
                                    }
                                    const shortPain = truncateText(pain, 60).toLowerCase();
                                    return `Ask: "How do you currently handle ${shortPain}? How many hours per week does it take?"`;
                                })()}
                            </p>
                            {primaryPersona && <p className="text-[10px] text-muted-foreground mt-1">Target persona: {truncateText(primaryPersona, 80)}</p>}
                        </div>
                        <div className="bg-risky/5 border border-risky/15 rounded-xl p-3">
                            <div className="font-mono text-[10px] uppercase tracking-widest text-risky mb-1">Step 3 — Check Adjacent Communities</div>
                            <p className="text-xs text-foreground/80">{communities.length > 0 ? `Try: ${communities.slice(0, 3).map((c: any) => getCommunityName(c)).filter(Boolean).join(", ")}` : "No target communities identified yet."}</p>
                        </div>
                        <div className="bg-risky/5 border border-risky/15 rounded-xl p-3">
                            <div className="font-mono text-[10px] uppercase tracking-widest text-risky mb-1">Step 4 — Rerun Validation</div>
                            <p className="text-xs text-foreground/80">After gathering more signal, run a deeper validation with refined keywords.</p>
                            <button onClick={() => router.push("/dashboard/validate")} className="mt-2 text-[11px] font-mono text-primary hover:text-white transition-colors uppercase tracking-widest">→ Run Again</button>
                        </div>
                    </div>
                </motion.div>
            )}

            {/* ═══════════ SECTION 4 — DEBATE ROOM (collapsed) ═══════════ */}
            <div className="mb-6">
                <CollapsibleSection title="AI Debate Room" subtitle={`${debateSummary.models} models · ${debateSummary.rounds} rounds — ${debateSummary.summary}`} open={debateOpen} onToggle={() => setDebateOpen(o => !o)}>
                    <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-foreground/80">
                        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Evidence used in this debate</div>
                        <p className="mt-2">{evidenceFunnelNote}</p>
                    </div>
                    {debateGuardrailOverride && (
                        <div className="mb-4 rounded-xl border border-zinc-500/20 bg-zinc-500/10 p-3 text-xs text-zinc-300">
                            Thin direct evidence triggered a final guardrail override to <span className="font-semibold text-white">{asString(report.verdict).replace(/_/g, " ")}</span>.
                            <span className="text-muted-foreground"> The debate still leans {transcriptFinalVerdict} at {transcriptFinalConfidence}% based on adjacent/supporting evidence.</span>
                        </div>
                    )}
                    {debateTranscript ? (
                        <DebatePanel transcript={debateTranscript} contextNote={debateGuardrailNote} />
                    ) : debateLog.length > 0 ? (
                        <div className="flex flex-col gap-6">
                            <div className="flex gap-4 border-b border-white/10 pb-4 flex-wrap">
                                {modelsUsed.map((m: string) => (
                                    <div key={m} className="bg-white/5 border border-white/10 px-3 py-2 rounded-lg font-mono text-[11px]">
                                        <span className="text-muted-foreground">Node </span><span className="text-foreground">{m}</span>
                                    </div>
                                ))}
                            </div>
                            {debateLog.map((round: DebateRoundGroup) => (
                                <div key={round.round} className="flex flex-col gap-4">
                                    <div className="font-mono text-[11px] uppercase font-bold tracking-widest text-primary border-l-2 border-primary pl-3 py-1">Sequence {round.round}</div>
                                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 ml-4">
                                        {round.entries.map((entry: DebateLogEntry, i: number) => {
                                            const vStyle = getVerdictStyle(entry.verdict);
                                            return (
                                                <div key={i} className={`p-4 rounded-xl border ${vStyle.bg} ${vStyle.border} relative overflow-hidden`}>
                                                    <div className="flex justify-between items-center mb-3">
                                                        <span className="font-mono flex items-center gap-2 text-[11px] uppercase font-bold tracking-widest text-foreground">
                                                            <span className="text-muted-foreground">{entry.model}</span>
                                                            <span className="opacity-30">/</span>
                                                            <span>{entry.role}</span>
                                                        </span>
                                                        <span className={`px-1.5 py-0.5 rounded font-mono text-[11px] uppercase tracking-widest border ${entry.changed ? "bg-orange-500/20 text-orange-500 border-orange-500/30" : "bg-white/5 text-muted-foreground border-white/10"}`}>
                                                            {entry.changed ? "Changed" : "Held"}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-foreground/90 leading-relaxed mb-4 line-clamp-4">{entry.reasoning}</p>
                                                    <div className="flex justify-between items-center pt-3 border-t border-white/10">
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
                    ) : (
                        <div className="py-10 flex flex-col items-center justify-center text-center opacity-50">
                            <Brain className="w-8 h-8 text-muted-foreground mb-3" />
                            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">No debate logs for this validation.</p>
                        </div>
                    )}
                </CollapsibleSection>
            </div>

            {/* ═══════════ SECTION 5 — FULL INTELLIGENCE (collapsed, tabbed) ═══════════ */}
            <div className="mb-6">
                <CollapsibleSection title="Full Intelligence" subtitle={`${evidencePoints} evidence points · ${risks.length} risks · ${competitors.length} competitors`} open={intelOpen} onToggle={() => setIntelOpen(o => !o)}>
                    {/* Tab bar */}
                    <div className="flex gap-2 flex-wrap mb-5 -mt-1">
                        {([
                            { key: "buyers" as const, label: "Market & Buyers", show: true },
                            { key: "competition" as const, label: "Competition", show: true },
                            { key: "strategy" as const, label: "Strategy", show: showStrategyTabs },
                            { key: "evidence" as const, label: "Evidence Log", show: true },
                            { key: "financial" as const, label: "Financial & GTM", show: showStrategyTabs },
                        ] as const).filter(t => t.show).map(t => (
                            <button key={t.key} type="button" onClick={() => setIntelTab(t.key)} className={`rounded-full border px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest transition-colors ${intelTab === t.key ? "border-primary/30 bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"}`}>
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {/* ── Buyers tab ── */}
                    {intelTab === "buyers" && (
                        <div className="flex flex-col gap-6">
                            {/* Executive Summary */}
                            {execSummary && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={FileText} label="Executive Summary" color="text-primary" />
                                    <p className="text-sm text-foreground/80 leading-relaxed mt-3 whitespace-pre-line">{execSummary}</p>
                                </div>
                            )}

                            {/* ICP */}
                            {Object.keys(icp).length > 0 && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={Users} label="Ideal Customer Profile" color="text-cyan-400" />
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                        {[
                                            { label: "Primary Persona", value: icp.primary_persona || icp.persona, icon: "👤" },
                                            { label: "Pain Point", value: icp.defining_pain_point || icp.pain_point, icon: "🔥" },
                                            { label: "Where They Gather", value: icp.where_they_gather || icp.hangout, icon: "📍" },
                                            { label: "Budget Range", value: icp.budget_range || icp.budget, icon: "💰" },
                                        ].filter(f => f.value).map((f, i) => (
                                            <div key={i} className="bg-cyan-500/5 border border-cyan-400/20 rounded-lg p-3">
                                                <div className="flex items-center gap-1.5 mb-1">
                                                    <span className="text-sm">{f.icon}</span>
                                                    <div className="font-mono text-[10px] uppercase tracking-widest text-cyan-400 font-bold">{f.label}</div>
                                                </div>
                                                <p className="text-xs text-foreground/80 leading-relaxed">{String(f.value)}</p>
                                            </div>
                                        ))}
                                    </div>
                                    {communities.length > 0 && (
                                        <div className="mt-4">
                                            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Communities</div>
                                            <div className="flex flex-wrap gap-2">{communities.map((c: any, i: number) => <Badge key={i} text={getCommunityName(c)} className="bg-cyan-500/10 text-cyan-400 border-cyan-400/20" />)}</div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Signal Summary */}
                            {Object.keys(signalSummary).length > 1 && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={BarChart3} label="Signal Summary" color="text-primary" />
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                                        {[
                                            { label: "Pain signals", value: signalSummary.pain_signals_count, color: "text-dont" },
                                            { label: "Pain quotes", value: explicitPainQuotes, color: "text-build" },
                                            { label: "WTP signals", value: signalSummary.willingness_to_pay_count, color: "text-build" },
                                            { label: "Competitor mentions", value: signalSummary.competitor_mention_count, color: "text-risky" },
                                            { label: "Feature requests", value: signalSummary.feature_request_count, color: "text-blue-400" },
                                        ].filter(f => f.value !== undefined).map((f, i) => (
                                            <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-3 text-center">
                                                <div className={`font-mono text-lg font-bold ${f.color}`}>{f.value}</div>
                                                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-1">{f.label}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {(trendInfo.label !== "UNKNOWN" || keywordTrends.length > 0) && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={TrendingUp} label="Market Timing" color="text-emerald-300" />
                                    <div className="mt-3 space-y-4">
                                        <div className={`rounded-2xl border p-4 ${getTrendTone(trendInfo.label)}`}>
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <div>
                                                    <div className="font-mono text-[10px] uppercase tracking-widest">Overall Trend</div>
                                                    <div className="mt-1 text-xl font-mono font-bold">{trendInfo.label}</div>
                                                    <p className="mt-1 text-xs text-foreground/80">{trendInfo.summary}</p>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3 min-w-[180px]">
                                                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
                                                        <div className="font-mono text-lg font-bold">{trendInfo.avgChange >= 0 ? "+" : ""}{trendInfo.avgChange.toFixed(1)}%</div>
                                                        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-1">Avg change</div>
                                                    </div>
                                                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
                                                        <div className="font-mono text-lg font-bold">{trendInfo.interest || "—"}</div>
                                                        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-1">Interest / 100</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        {keywordTrends.length > 0 && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {keywordTrends.map((row: { keyword: string; change: number; interest: number }, i: number) => (
                                                    <div key={`${row.keyword}-${i}`} className="rounded-xl border border-white/10 bg-white/5 p-3">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div className="font-mono text-[11px] uppercase tracking-widest text-foreground">{row.keyword}</div>
                                                            <Badge
                                                                text={`${row.change >= 0 ? "+" : ""}${row.change.toFixed(1)}%`}
                                                                className={row.change >= 0 ? "border-build/20 bg-build/10 text-build" : "border-dont/20 bg-dont/10 text-dont"}
                                                            />
                                                        </div>
                                                        <div className="mt-2 text-xs text-muted-foreground">Current interest: {row.interest}/100</div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Pricing */}
                            {(pricing.recommended_model || pricing.recommended_price) && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={DollarSign} label="Pricing Strategy" color="text-emerald-400" />
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                                        {[
                                            { label: "Model", value: pricing.recommended_model, icon: "📊" },
                                            { label: "Price", value: pricing.recommended_price, icon: "💵" },
                                            { label: "Confidence", value: pricing.pricing_confidence, icon: "🎯" },
                                        ].filter(f => f.value).map((f, i) => (
                                            <div key={i} className="bg-emerald-500/5 border border-emerald-400/20 rounded-lg p-3">
                                                <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-400 mb-1">{f.icon} {f.label}</div>
                                                <p className="text-xs text-foreground/80">{String(f.value)}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Competition tab ── */}
                    {intelTab === "competition" && (
                        <div className="flex flex-col gap-6">
                            {(comp.market_saturation || comp.your_unfair_advantage) && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={Target} label="Competition Landscape" color="text-dont" />
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                        {comp.market_saturation && (
                                            <div className={`rounded-lg p-3 border ${getThreatColor(comp.market_saturation)}`}>
                                                <div className="font-mono text-[10px] uppercase tracking-widest mb-1">Market Saturation</div>
                                                <p className="text-xs font-bold">{String(comp.market_saturation)}</p>
                                            </div>
                                        )}
                                        {comp.your_unfair_advantage && (
                                            <div className="bg-build/5 border border-build/15 rounded-lg p-3">
                                                <div className="font-mono text-[10px] uppercase tracking-widest text-build mb-1">Your Unfair Advantage</div>
                                                <p className="text-xs text-foreground/80">{String(comp.your_unfair_advantage)}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            {competitors.length > 0 && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={Crosshair} label="Direct Competitors" color="text-dont" />
                                    <div className="flex flex-col gap-3 mt-3">
                                        {competitors.map((c: any, i: number) => (
                                            <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:border-white/20 transition-all">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm text-foreground font-medium">{getCompetitorName(c)}</p>
                                                        {(c.weakness || c.gap) && <p className="text-xs text-dont/70 mt-1">Gap: {String(c.weakness || c.gap)}</p>}
                                                    </div>
                                                    {c.threat_level && <Badge text={c.threat_level} className={getThreatColor(c.threat_level)} />}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Strategy tab ── */}
                    {intelTab === "strategy" && showStrategyTabs && (
                        <div className="flex flex-col gap-6">
                            {/* Build / Don't Build */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={Target} label="Build This" color="text-build" />
                                    <div className="flex flex-col gap-3 mt-3">
                                        {mvpFeatures.length > 0 ? mvpFeatures.map((f: any, i: number) => (
                                            <div key={i} className="bg-build/5 border border-build/15 rounded-xl p-3">
                                                <p className="text-xs text-foreground font-medium">{String(f.name || f.feature || f.title || f)}</p>
                                                {(f.reason || f.why) && <p className="text-[10px] text-build/80 mt-1">{String(f.reason || f.why)}</p>}
                                            </div>
                                        )) : <p className="text-xs text-muted-foreground">No MVP features listed.</p>}
                                    </div>
                                </div>
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={AlertCircle} label="Don&apos;t Build This" color="text-dont" />
                                    <div className="flex flex-col gap-3 mt-3">
                                        {cutFeatures.length > 0 ? cutFeatures.map((f: any, i: number) => (
                                            <div key={i} className="bg-dont/5 border border-dont/15 rounded-xl p-3">
                                                <p className="text-xs text-foreground font-medium">{String(f.name || f.feature || f.title || f)}</p>
                                                {(f.reason || f.why) && <p className="text-[10px] text-dont/80 mt-1">{String(f.reason || f.why)}</p>}
                                            </div>
                                        )) : <p className="text-xs text-muted-foreground">No cut features listed.</p>}
                                    </div>
                                </div>
                            </div>

                            {/* Monetization */}
                            {monetizationChannels.length > 0 && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={Banknote} label="Monetization Channels" color="text-build" />
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                                        {monetizationChannels.map((ch: any, i: number) => (
                                            <div key={i} className="bg-build/5 border border-build/15 rounded-xl p-3">
                                                <div className="font-mono text-[10px] uppercase tracking-widest text-build font-bold mb-1">{String(ch.channel || ch.name || `Channel ${i+1}`)}</div>
                                                {(ch.expected_revenue || ch.revenue) && <p className="text-xs text-foreground/80">{String(ch.expected_revenue || ch.revenue)}</p>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Evidence tab ── */}
                    {intelTab === "evidence" && (
                        <div className="flex flex-col gap-6">
                            {/* Platform Warnings */}
                            {normalizedPlatformWarnings.length > 0 && (
                                <div className="flex flex-col gap-2">
                                    {normalizedPlatformWarnings.map((warning: string, i: number) => (
                                        <div key={i} className="bg-risky/5 border border-risky/20 rounded-lg p-3 text-xs text-risky flex items-center gap-2">
                                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {warning}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {topSubredditCounts.length > 0 && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={Clipboard} label="Source Provenance" color="text-cyan-400" />
                                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                                        {topSubredditCounts.map((row: { name: string; count: number }) => (
                                            <div key={row.name} className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-3">
                                                <div className="font-mono text-[10px] uppercase tracking-widest text-cyan-400">r/{row.name.replace(/^r\//i, "")}</div>
                                                <div className="mt-2 text-xl font-mono font-bold text-foreground">{row.count}</div>
                                                <div className="text-[10px] text-muted-foreground mt-1">scraped posts</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Evidence Log */}
                            <div className="bento-cell p-5">
                                <SectionHeader icon={MessageSquare} label="Raw Evidence" color="text-primary" />
                                {evidence.length > 0 ? (
                                    <div className="flex flex-col gap-3 mt-4">
                                        {evidence.filter(
                                            (ev: any, idx: number, self: any[]) =>
                                                idx === self.findIndex((e: any) => getEvidenceTitle(e) === getEvidenceTitle(ev))
                                        ).map((ev: any, i: number) => {
                                            const tier = resolveEvidenceTier(ev, tierLookup);
                                            const platform = String(ev.source ?? ev.platform ?? "unknown");
                                            const sourceLabel = getEvidenceSourceLabel(ev);
                                            const platformColor = platform.toLowerCase().includes("reddit") ? "text-[#ff4500]" : "text-[#f97316]";
                                            return (
                                                <div key={i} className="border-l-2 border-primary/30 pl-4 py-1.5 flex flex-col gap-1.5">
                                                    <div className="flex items-center gap-3 text-[11px] font-mono">
                                                        <span className={`uppercase font-bold ${platformColor}`}>{platform}</span>
                                                        <span className="text-muted-foreground opacity-50">/</span>
                                                        <span className="text-build">{(ev.score ?? ev.upvotes) ? `+${ev.score ?? ev.upvotes}` : "unscored"}</span>
                                                        <Badge text={tier} className={getTierClass(tier)} />
                                                    </div>
                                                    <p className="text-sm text-foreground/90 font-medium">&quot;{getEvidenceTitle(ev)}&quot;</p>
                                                    {sourceLabel && <p className="text-[11px] font-mono text-cyan-400/80">{sourceLabel}</p>}
                                                    {(ev.what_it_proves || ev.relevance) && <p className="text-xs text-muted-foreground italic">→ {String(ev.what_it_proves || ev.relevance)}</p>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <EmptySectionState text="No evidence entries for this validation." />
                                )}
                            </div>

                            {/* Risk Matrix */}
                            {risks.length > 0 && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={Shield} label="Risk Matrix" color="text-dont" />
                                    <div className="flex flex-col gap-3 mt-3">
                                        {risks.map((risk: any, i: number) => {
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
                                                    {risk.mitigation && <p className="text-xs text-build/70 bg-build/5 border border-build/10 rounded px-3 py-1.5 mt-1"><span className="font-bold">Mitigation:</span> {String(risk.mitigation)}</p>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Financial & GTM tab ── */}
                    {intelTab === "financial" && showStrategyTabs && (
                        <div className="flex flex-col gap-6">
                            {/* Financial Reality */}
                            {Object.keys(financial).length > 0 && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={DollarSign} label="Financial Reality" color="text-emerald-400" />
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
                                        {[
                                            { label: "Break-Even", value: financial.break_even_customers, icon: "📈" },
                                            { label: "Time to $1K MRR", value: financial.time_to_1k_mrr, icon: "🎯" },
                                            { label: "CAC Budget", value: financial.cac_budget, icon: "💸" },
                                            { label: "Gross Margin", value: financial.gross_margin, icon: "📊" },
                                        ].filter(f => f.value).map((f, i) => (
                                            <div key={i} className="bg-emerald-500/5 border border-emerald-400/20 rounded-lg p-3">
                                                <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-400 mb-1">{f.icon} {f.label}</div>
                                                <p className="text-xs text-foreground/80">{String(f.value)}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Launch Roadmap */}
                            {roadmap.length > 0 && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={Calendar} label="Launch Trajectory" color="text-purple-400" />
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                                        {roadmap.map((step: any, i: number) => (
                                            <div key={i} className="flex flex-col gap-2">
                                                <div className="flex items-center gap-2 text-purple-400 font-mono text-[11px] uppercase font-bold tracking-widest">
                                                    <div className="w-5 h-5 rounded border border-purple-400/30 bg-purple-400/10 flex items-center justify-center">{i+1}</div>
                                                    {step.week || step.timeline || `Step ${i+1}`}
                                                </div>
                                                <div className="bg-white/5 rounded-xl p-3 border border-white/5 flex-1 hover:border-purple-400/30 transition-all">
                                                    <h4 className="font-bold text-xs text-foreground mb-1">{step.title || step.phase || `Phase ${i+1}`}</h4>
                                                    {step.description && <p className="text-[10px] text-muted-foreground mb-2">{step.description}</p>}
                                                    {step.tasks && Array.isArray(step.tasks) && (
                                                        <ul className="flex flex-col gap-1 mb-2">
                                                            {step.tasks.map((task: string, j: number) => <li key={j} className="text-[10px] text-muted-foreground"><span className="text-purple-400">-</span> {task}</li>)}
                                                        </ul>
                                                    )}
                                                    {step.validation_gate && (
                                                        <div className="bg-risky/5 border border-risky/20 rounded-md p-2 mt-1">
                                                            <div className="font-mono text-[10px] uppercase tracking-widest text-risky font-bold mb-0.5">🚦 Gate</div>
                                                            <p className="text-[10px] text-risky/80">{step.validation_gate}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* First 10 Customers */}
                            {Object.keys(first10).length > 0 && (
                                <div className="bento-cell p-5">
                                    <SectionHeader icon={Crosshair} label="First 10 Customers" color="text-cyan-400" />
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                                        {[
                                            { key: "customers_1_3", label: "Customers 1-3", emoji: "🎯", fallbackKey: "step_1" },
                                            { key: "customers_4_7", label: "Customers 4-7", emoji: "📈", fallbackKey: "step_2" },
                                            { key: "customers_8_10", label: "Customers 8-10", emoji: "🔄", fallbackKey: "step_3" },
                                        ].map((phase) => {
                                            const data = first10[phase.key] || {};
                                            const fallbackText = first10[phase.fallbackKey];
                                            if (!data.source && !fallbackText) return null;
                                            return (
                                                <div key={phase.key} className="bg-cyan-500/5 border border-cyan-400/20 rounded-xl p-3">
                                                    <div className="font-mono text-[10px] uppercase tracking-widest text-cyan-400 font-bold mb-2">{phase.emoji} {phase.label}</div>
                                                    {typeof data === "object" && data.source ? (
                                                        <>
                                                            <p className="text-[10px] text-muted-foreground uppercase font-bold">Source: <span className="text-foreground/80 normal-case font-normal">{String(data.source)}</span></p>
                                                            {data.tactic && <p className="text-[10px] text-muted-foreground mt-1 uppercase font-bold">Tactic: <span className="text-foreground/80 normal-case font-normal">{String(data.tactic)}</span></p>}
                                                        </>
                                                    ) : (
                                                        <p className="text-xs text-foreground/80">{String(fallbackText || data)}</p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </CollapsibleSection>
            </div>

            {/* ═══════════ SECTION 6 — FLOATING ACTION BAR (left side) ═══════════ */}
            <div className="fixed left-3 top-1/2 z-50 hidden -translate-y-1/2 print:hidden lg:block">
                <div className="flex flex-col items-center gap-1.5 bg-[#0a0a0a]/90 backdrop-blur-md border border-white/10 rounded-2xl px-2 py-3">
                    {/* Verdict indicator */}
                    <div className={`w-10 rounded-xl flex flex-col items-center justify-center py-1.5 text-[10px] font-mono font-bold ${vs.bg} ${vs.border} ${vs.color} border`} title={`${vs.label} — ${report.confidence}%`}>
                        {report.confidence}%
                    </div>
                    <div className="w-8 border-t border-white/10 my-0.5" />
                    {/* Save */}
                    <button type="button" onClick={toggleWatchlist} disabled={watchlistLoading} className={`w-10 rounded-xl border flex flex-col items-center justify-center py-1.5 gap-0.5 transition-colors ${savedToWatchlist ? "border-build/30 bg-build/10 text-build" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10"} disabled:opacity-60`} title={savedToWatchlist ? "Saved to watchlist" : "Save to watchlist"}>
                        <Bookmark className="w-3.5 h-3.5" />
                        <span className="text-[7px] font-mono uppercase leading-none">{savedToWatchlist ? "Saved" : "Save"}</span>
                    </button>
                    {/* Share */}
                    <button type="button" onClick={handleShare} className="w-10 rounded-xl border border-white/10 bg-white/5 flex flex-col items-center justify-center py-1.5 gap-0.5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors relative" title="Copy link">
                        <Clipboard className="w-3.5 h-3.5" />
                        <span className="text-[7px] font-mono uppercase leading-none">Share</span>
                        {shareToast && <span className="absolute left-12 bg-build/90 text-white text-[10px] px-2 py-1 rounded font-mono whitespace-nowrap">Copied!</span>}
                    </button>
                    <div className="w-8 border-t border-white/10 my-0.5" />
                    {/* Export MD */}
                    <button type="button" onClick={generateMarkdownExport} className="w-10 rounded-xl border border-white/10 bg-white/5 flex flex-col items-center justify-center py-1.5 gap-0.5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors" title="Export as Markdown">
                        <Download className="w-3.5 h-3.5" />
                        <span className="text-[7px] font-mono uppercase leading-none">Export MD</span>
                    </button>
                    {/* Export PDF */}
                    <button type="button" onClick={exportAsPDF} className="w-10 rounded-xl border border-white/10 bg-white/5 flex flex-col items-center justify-center py-1.5 gap-0.5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors" title="Export as PDF">
                        <FileText className="w-3.5 h-3.5" />
                        <span className="text-[7px] font-mono uppercase leading-none">Export PDF</span>
                    </button>
                    {/* Run Deep */}
                    {report.depth !== "deep" && (
                        <>
                            <div className="w-8 border-t border-white/10 my-0.5" />
                            <button type="button" onClick={() => router.push(`/dashboard/validate?depth=deep&idea=${encodeURIComponent(report.idea_text)}`)} className="w-10 rounded-xl border border-primary/30 bg-primary/10 flex flex-col items-center justify-center py-1.5 gap-0.5 text-primary hover:bg-primary/20 transition-colors" title="Refine with Deep Validation">
                                <Zap className="w-3.5 h-3.5" />
                                <span className="text-[7px] font-mono uppercase leading-none">Deep</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div
                className="fixed inset-x-3 z-40 print:hidden lg:hidden"
                style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 86px)" }}
            >
                <div className="rounded-[20px] border border-white/10 bg-[#0a0a0a]/90 p-3 backdrop-blur-md">
                    <div className="grid grid-cols-4 gap-2">
                        <button
                            type="button"
                            onClick={toggleWatchlist}
                            disabled={watchlistLoading}
                            className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl border text-[10px] font-mono uppercase tracking-[0.12em] transition-colors ${
                                savedToWatchlist
                                    ? "border-build/30 bg-build/10 text-build"
                                    : "border-white/10 bg-white/[0.03] text-muted-foreground"
                            } disabled:opacity-60`}
                        >
                            <Bookmark className="h-4 w-4" />
                            <span>{savedToWatchlist ? "Saved" : "Save"}</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleShare}
                            className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl border border-white/10 bg-white/[0.03] text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground transition-colors"
                        >
                            <Clipboard className="h-4 w-4" />
                            <span>Share</span>
                        </button>
                        <button
                            type="button"
                            onClick={generateMarkdownExport}
                            className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl border border-white/10 bg-white/[0.03] text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground transition-colors"
                        >
                            <Download className="h-4 w-4" />
                            <span>MD</span>
                        </button>
                        <button
                            type="button"
                            onClick={exportAsPDF}
                            className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl border border-white/10 bg-white/[0.03] text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground transition-colors"
                        >
                            <FileText className="h-4 w-4" />
                            <span>PDF</span>
                        </button>
                    </div>

                    {report.depth !== "deep" && (
                        <button
                            type="button"
                            onClick={() => router.push(`/dashboard/validate?depth=deep&idea=${encodeURIComponent(report.idea_text)}`)}
                            className="mt-2 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 text-[11px] font-mono uppercase tracking-[0.12em] text-primary"
                        >
                            <Zap className="h-4 w-4" />
                            Refine with deep validation
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
