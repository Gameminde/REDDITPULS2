"use client";

import Link from "next/link";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
    TrendingUp, TrendingDown, Minus, Plus,
    ArrowUpRight, ArrowDownRight, Activity, BarChart3,
    Eye, Zap, Clock, ExternalLink, Flame, Skull, Sparkles, AlertTriangle,
    Target, Lightbulb, Radar, ShieldAlert,
} from "lucide-react";
import ScoreBreakdownTooltip, { type ScoreBreakdown } from "./ScoreBreakdownTooltip";
import { ValidationDepthChooser } from "./components/ValidationDepthChooser";
import {
    getOpportunityPostSupportLevel,
    rankOpportunityRepresentativePosts,
    type OpportunitySignalContract,
    type OpportunityTopPost,
} from "@/lib/opportunity-signal";
import {
    formatCountLabel,
    getReadinessLabel,
    getSupportLevelLabel,
    summarizeIdeaForBrowse,
    summarizeReasonForUser,
} from "@/lib/user-facing-copy";
import { useDashboardViewer } from "./viewer-context";
import { getJoinBetaHref } from "@/lib/beta-access";
import type { ValidationPrefill } from "@/lib/validation-entry";

export interface Idea {
    id: string;
    topic: string;
    public_title?: string;
    public_summary?: string;
    public_verdict?: string;
    public_next_step?: string;
    public_product_angle?: string;
    slug: string;
    current_score: number;
    change_24h: number;
    change_7d: number;
    change_30d: number;
    trend_direction: string;
    confidence_level: string;
    post_count_total: number;
    post_count_7d: number;
    source_count: number;
    sources: Array<{ platform: string; count: number }>;
    category: string;
    reddit_velocity: number;
    google_trend_score: number;
    competition_score: number;
    competition_data?: Record<string, unknown> | null;
    cross_platform_multiplier: number;
    pain_count?: number;
    keywords?: string[];
    score_breakdown?: Partial<ScoreBreakdown> | null;
    signal_contract?: OpportunitySignalContract | null;
    top_posts: OpportunityTopPost[];
    first_seen: string;
    last_updated: string;
    suggested_wedge_label?: string | null;
    market_hint?: {
        suggested_wedge_label: string | null;
        why_it_matters_now: string;
        missing_proof: string;
        promotion_readiness: "ready" | "needs_wedge" | "needs_more_proof";
        recommended_board_action: string;
    } | null;
    market_kind?: "tracked_theme" | "dynamic_theme" | "subreddit_bucket" | "entity" | "malformed";
    market_status?: "visible" | "needs_wedge" | "suppressed";
    suppression_reason?: string | null;
    fresh_candidate?: boolean;
    board_eligible?: boolean;
    board_stale_reason?: string | null;
}

interface MarketIntelligenceSummary {
    generated_at: string;
    run_health: "healthy" | "degraded" | "failed";
    healthy_sources: string[];
    degraded_sources: string[];
    raw_idea_count: number;
    feed_visible_count: number;
    new_72h_count: number;
    emerging_wedge_count: number;
}

interface EmergingWedgeCard {
    topic: string;
    slug: string;
    category: string;
    current_score: number;
    source_count: number;
    post_count_total: number;
    post_count_7d: number;
    freshness_hours: number | null;
    suggested_wedge_label: string | null;
    why_it_matters_now: string;
    missing_proof: string;
    promotion_readiness: "ready" | "needs_wedge" | "needs_more_proof";
    buyer_native_direct_count: number;
    supporting_signal_count: number;
    board_eligible: boolean;
    board_stale_reason: string | null;
    validation_bias: "positive" | "neutral" | "caution";
    validation_note: string;
}

interface ThemeToShapeCard {
    topic: string;
    slug: string;
    category: string;
    current_score: number;
    source_count: number;
    post_count_total: number;
    direct_buyer_count: number;
    supporting_signal_count: number;
    suggested_wedge_label: string | null;
    missing_proof: string;
    recommended_shape_direction: string;
    recommended_shape_mode: "suggested_wedge" | "direct_buyer_language" | "cross_source_pattern" | "theme_watch";
    observed_pattern: string;
}

interface CompetitorPressureCard {
    competitor: string;
    weakness_category: string;
    complaint_count: number;
    source_count: number;
    latest_seen_at: string | null;
    freshness_label: string;
    confidence: {
        level: "HIGH" | "MEDIUM" | "LOW";
        score: number;
        label: string;
    };
    summary: string;
    affected_segment: string | null;
    direct_evidence_count: number;
    why_now: string;
    recommended_angle: string;
    recommendation_mode: "evidence_led" | "heuristic";
    inference_note: string;
}

export interface MarketIntelligencePayload {
    summary: MarketIntelligenceSummary;
    emerging_wedges: EmergingWedgeCard[];
    themes_to_shape: ThemeToShapeCard[];
    competitor_pressure: CompetitorPressureCard[];
}

interface ScanStatusSnapshot {
    latestRun: any;
    ideaCount: number;
    trackedPostCount: number;
    archiveIdeaCount: number;
    archivePostCount: number;
    evidenceAttachedCount?: number;
    lastObservedAt?: string | null;
    funnel?: {
        rawPostsAnalyzed: number;
        candidateOpportunities: number;
        visibleOnBoard: number;
        evidenceAttached: number;
    } | null;
    executionMode?: "local" | "external";
    healthy_sources: string[];
    degraded_sources: string[];
    run_health: "healthy" | "degraded" | "failed";
    runner_label?: string | null;
    reddit_access_mode?: "provider_api" | "authenticated_app" | "anonymous_public" | "connected_user" | "unknown";
    reddit_post_count?: number;
    reddit_successful_requests?: number;
    reddit_failed_requests?: number;
    reddit_degraded_reason?: string | null;
}

function decodeHtml(str?: string | null) {
    return String(str || "")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function cleanText(value?: string | null) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function getIdeaDisplayTopic(idea: Pick<Idea, "topic" | "public_title">) {
    return decodeHtml(idea.public_title || idea.topic);
}

function getIdeaSuggestedWedge(idea: Pick<Idea, "public_product_angle" | "suggested_wedge_label" | "topic" | "public_title">) {
    const suggestion = decodeHtml(idea.public_product_angle || idea.suggested_wedge_label || "");
    const displayTopic = decodeHtml(idea.public_title || idea.topic);
    return suggestion && suggestion !== displayTopic ? suggestion : "";
}

function getBoardPrimaryTitle(displayTopic: string, suggestedWedge: string) {
    const cleanTopic = cleanText(displayTopic);
    const cleanWedge = cleanText(suggestedWedge);

    if (!cleanWedge) return cleanTopic;

    const soundsLikePainStatement = /\b(frustrat|burnout|distrust|gaps?|manual|delay|problem|struggle|complain|access control|mocking)\b/i.test(cleanTopic);
    if (cleanTopic.length > 76 || soundsLikePainStatement) {
        return cleanWedge;
    }

    return cleanTopic;
}

function getOpportunityHeadline(
    observedTopic: string,
    displayTopic: string,
    suggestedWedge: string,
    directBuyerCount: number,
) {
    const cleanObservedTopic = cleanText(observedTopic) || cleanText(displayTopic);
    const cleanDisplayTopic = cleanText(displayTopic) || cleanObservedTopic;
    const cleanWedge = cleanText(suggestedWedge);
    const useConservativeObservedTitle = directBuyerCount < 2;
    const baseTitle = useConservativeObservedTitle ? cleanObservedTopic : cleanDisplayTopic;
    const primaryTitle = getBoardPrimaryTitle(baseTitle, useConservativeObservedTitle ? "" : cleanWedge);
    const secondaryAngle = cleanWedge && cleanText(primaryTitle) !== cleanWedge ? cleanWedge : "";

    return {
        primaryTitle,
        secondaryAngle,
        secondaryLabel: useConservativeObservedTitle ? "Suggested wedge" : "Product angle",
    };
}

function buildIdeaHref(slug: string) {
    return `/dashboard/idea/${encodeURIComponent(slug)}`;
}

async function promoteIdeaToBoard(payload: {
    primary_idea_slug: string;
    label?: string;
    category?: string;
}) {
    const res = await fetch("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(String(data.error || "Could not save this opportunity to the radar."));
    }

    return data;
}

function formatFreshnessHours(hours: number | null | undefined) {
    if (hours == null || !Number.isFinite(hours)) return "Freshness unknown";
    if (hours < 1) return "seen within the last hour";
    if (hours < 24) return `seen ${Math.round(hours)}h ago`;
    return `seen ${Math.round(hours / 24)}d ago`;
}

function formatRelativeTimestamp(value?: string | null) {
    if (!value) return "";
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return "";

    const diffMs = Date.now() - timestamp;
    if (diffMs < 60_000) return "just now";

    const diffMinutes = Math.round(diffMs / 60_000);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;

    const diffHours = Math.round(diffMs / 3_600_000);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.round(diffMs / 86_400_000);
    return `${diffDays}d ago`;
}

type TabType = "top" | "trending" | "dying" | "new";

const TABS: { key: TabType; label: string; icon: LucideIcon; color: string }[] = [
    { key: "top", label: "Top", icon: BarChart3, color: "#f97316" },
    { key: "trending", label: "Rising", icon: Flame, color: "#22c55e" },
    { key: "dying", label: "Cooling", icon: Skull, color: "#ef4444" },
    { key: "new", label: "New", icon: Sparkles, color: "#8b5cf6" },
];

const TAB_EXPLANATIONS: Record<TabType, string> = {
    top: "Sorted by overall opportunity score.",
    trending: "Sorted by 24h momentum first, then score.",
    dying: "Sorted by 24h decline first, then score.",
    new: "Sorted by the most recently observed opportunities.",
};

const CATEGORIES = [
    { key: "", label: "All" },
    { key: "fintech", label: "Fintech" },
    { key: "productivity", label: "Productivity" },
    { key: "marketing", label: "Marketing" },
    { key: "dev-tools", label: "Dev Tools" },
    { key: "ai", label: "AI" },
    { key: "saas", label: "SaaS" },
    { key: "ecommerce", label: "E-commerce" },
    { key: "hr", label: "HR" },
    { key: "security", label: "Security" },
    { key: "data", label: "Data" },
];

const BETA_AUTH_HREF = getJoinBetaHref("/dashboard");

const CONFIDENCE_MAP: Record<string, { label: string; color: string; icon: string }> = {
    INSUFFICIENT: { label: "Needs data", color: "#6b7280", icon: "🔍" },
    LOW: { label: "Early proof", color: "#f59e0b", icon: "📡" },
    MEDIUM: { label: "Cross-source proof", color: "#3b82f6", icon: "📊" },
    HIGH: { label: "Strong proof", color: "#22c55e", icon: "✅" },
    STRONG: { label: "Very strong proof", color: "#10b981", icon: "🔥" },
};

function TrendIcon({ direction, size = 14 }: { direction: string; size?: number }) {
    if (direction === "rising") return <TrendingUp style={{ width: size, height: size, color: "#22c55e" }} />;
    if (direction === "falling") return <TrendingDown style={{ width: size, height: size, color: "#ef4444" }} />;
    if (direction === "new") return <Sparkles style={{ width: size, height: size, color: "#8b5cf6" }} />;
    return <Minus style={{ width: size, height: size, color: "#64748b" }} />;
}

function formatTrendLabel(direction?: string | null) {
    if (direction === "rising") return "Gaining traction";
    if (direction === "falling") return "Cooling off";
    if (direction === "new") return "Newly tracked";
    return "Holding steady";
}

const SIGNAL_LEVEL_MAP: Record<OpportunitySignalContract["support_level"], { label: string; color: string; background: string }> = {
    evidence_backed: {
        label: "Buyer proof",
        color: "#22c55e",
        background: "rgba(34,197,94,0.12)",
    },
    supporting_context: {
        label: "Cross-source proof",
        color: "#3b82f6",
        background: "rgba(59,130,246,0.12)",
    },
    hypothesis: {
        label: "Early proof",
        color: "#f59e0b",
        background: "rgba(245,158,11,0.12)",
    },
};

function formatSourceName(platform?: string | null) {
    const value = String(platform || "").toLowerCase();
    if (value === "reddit") return "Reddit";
    if (value === "hackernews") return "Hacker News";
    if (value === "producthunt") return "Product Hunt";
    if (value === "indiehackers") return "Indie Hackers";
    if (value === "githubissues") return "GitHub Issues";
    if (value === "g2_review") return "G2 Reviews";
    if (value === "job_posting") return "Job Signals";
    return platform || "Unknown";
}

function formatSourceShort(platform?: string | null) {
    const value = String(platform || "").toLowerCase();
    if (value === "reddit") return "R";
    if (value === "hackernews") return "HN";
    if (value === "producthunt") return "PH";
    if (value === "indiehackers") return "IH";
    if (value === "githubissues") return "GH";
    if (value === "g2_review") return "G2";
    if (value === "job_posting") return "JB";
    return String(platform || "?").slice(0, 2).toUpperCase();
}

type MarketLeader = {
    name: string;
    mention_count: number;
    source_count: number;
    buyer_signal_count: number;
    evidence_mode: string;
    known_weakness: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeMarketLeaders(competitionData: Record<string, unknown> | null | undefined): MarketLeader[] {
    if (!isRecord(competitionData)) return [];

    const rawRows = Array.isArray(competitionData.direct_competitors)
        ? competitionData.direct_competitors
        : Array.isArray(competitionData.competitors)
            ? competitionData.competitors
            : [];

    const normalizedRows = rawRows.reduce<MarketLeader[]>((acc, row) => {
            if (typeof row === "string") {
                acc.push({
                    name: row,
                    mention_count: 0,
                    source_count: 0,
                    buyer_signal_count: 0,
                    evidence_mode: "known_market_map",
                    known_weakness: null,
                } satisfies MarketLeader);
                return acc;
            }
            if (!isRecord(row)) return acc;
            const name = decodeHtml(String(row.name || "")).trim();
            if (!name) return acc;
            acc.push({
                name,
                mention_count: Number(row.mention_count || 0),
                source_count: Number(row.source_count || 0),
                buyer_signal_count: Number(row.buyer_signal_count || 0),
                evidence_mode: String(row.evidence_mode || "known_market_map"),
                known_weakness: row.known_weakness ? String(row.known_weakness) : null,
            } satisfies MarketLeader);
            return acc;
        }, []);

    return normalizedRows.slice(0, 4);
}

function leaderEvidenceLabel(leader: MarketLeader) {
    if (leader.mention_count > 0) {
        const sourceText = leader.source_count > 0 ? ` across ${leader.source_count} ${leader.source_count === 1 ? "source" : "sources"}` : "";
        return `Mentioned in ${leader.mention_count} post${leader.mention_count === 1 ? "" : "s"}${sourceText}`;
    }
    return "Known incumbent for this workflow";
}

function ChangeDisplay({ value, prefix = "" }: { value: number; prefix?: string }) {
    const color = value > 0 ? "#22c55e" : value < 0 ? "#ef4444" : "#64748b";
    const bg = value > 0 ? "rgba(34,197,94,0.1)" : value < 0 ? "rgba(239,68,68,0.1)" : "rgba(100,116,139,0.1)";
    const icon = value > 0 ? <ArrowUpRight style={{ width: 11, height: 11 }} /> : value < 0 ? <ArrowDownRight style={{ width: 11, height: 11 }} /> : null;

    return (
        <span style={{
            display: "inline-flex", alignItems: "center", gap: 2,
            fontSize: 12, fontWeight: 600, color,
            background: bg, padding: "2px 7px", borderRadius: 6,
            fontFamily: "var(--font-mono)",
        }}>
            {icon}{prefix}{value > 0 ? "+" : ""}{value.toFixed(1)}
        </span>
    );
}

const CLAMP_ONE = {
    overflow: "hidden",
    display: "-webkit-box",
    WebkitBoxOrient: "vertical" as const,
    WebkitLineClamp: 1,
};

const CLAMP_TWO = {
    overflow: "hidden",
    display: "-webkit-box",
    WebkitBoxOrient: "vertical" as const,
    WebkitLineClamp: 2,
};

function getTrendTone(direction?: string | null) {
    if (direction === "rising") {
        return { label: "Gaining traction", color: "#22c55e", background: "rgba(34,197,94,0.12)" };
    }
    if (direction === "falling") {
        return { label: "Cooling off", color: "#ef4444", background: "rgba(239,68,68,0.12)" };
    }
    if (direction === "new") {
        return { label: "Newly tracked", color: "#a855f7", background: "rgba(168,85,247,0.12)" };
    }
    return { label: "Holding steady", color: "#94a3b8", background: "rgba(148,163,184,0.12)" };
}

function getOpportunityTypeLabel(idea: Pick<Idea, "category" | "public_title" | "public_product_angle" | "public_summary" | "topic">) {
    const haystack = decodeHtml([
        idea.public_product_angle,
        idea.public_title,
        idea.public_summary,
        idea.topic,
    ].filter(Boolean).join(" ")).toLowerCase();

    if (/\btax\b|\blegal\b|\bbookkeep|\bcompliance\b|\bllc\b|\bsetup\b|\bonboard/i.test(haystack)) return "Setup pain";
    if (/\balternative\b|\breplace\b|\bswitch\b|\bmigration\b/i.test(haystack)) return "Replacement";
    if (/\btrust\b|\bdistrust\b|\bauthentic\b|\bburnout\b|\bapproval\b/i.test(haystack)) return "Trust gap";
    if (/\bapi\b|\bmock\b|\bdev\b|\bintegration\b|\btest\b|\bdeploy\b|\bengineer/i.test(haystack)) return "Dev workflow";
    if (/\baccess control\b|\bpermission\b|\bmanual\b|\badmin\b|\bops\b|\boperation/i.test(haystack)) return "Manual ops";
    if (/\bcontent\b|\bsocial media\b|\bcalendar\b|\bfeedback\b|\bhandoff\b|\bworkflow\b|\bmanager/i.test(haystack)) return "Workflow gap";

    switch (idea.category) {
        case "marketing":
            return "Go-to-market";
        case "dev-tools":
            return "Dev workflow";
        case "productivity":
            return "Workflow gap";
        case "security":
            return "Security ops";
        case "hr":
            return "People ops";
        case "ecommerce":
            return "Commerce ops";
        case "ai":
            return "AI workflow";
        default:
            return "Opportunity";
    }
}

function ScoreBar({ score, color = "#f97316" }: { score: number; color?: string }) {
    return (
        <div style={{
            width: "100%", height: 6, borderRadius: 3,
            background: "rgba(255,255,255,0.05)", position: "relative", overflow: "hidden",
        }}>
            <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(score, 100)}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                style={{
                    height: "100%", borderRadius: 3,
                    background: `linear-gradient(90deg, ${color}88, ${color})`,
                    boxShadow: `0 0 8px ${color}44`,
                }}
            />
        </div>
    );
}

function normalizeScoreBreakdown(idea: Idea): ScoreBreakdown | null {
    const raw = idea.score_breakdown && typeof idea.score_breakdown === "object"
        ? idea.score_breakdown
        : {};
    const postCount = Number(idea.post_count_total || 0);
    const painCount = Number(idea.pain_count || 0);
    const painDensityFallback = postCount > 0 ? Math.min(100, (painCount / postCount) * 100) : null;
    const volumeFallback = postCount > 0 ? Math.min(100, (Math.log(postCount + 1) / Math.log(500)) * 100) : null;
    const hasAnyRaw = Object.keys(raw || {}).length > 0;

    const breakdown: ScoreBreakdown = {
        velocity: typeof raw.velocity === "number" ? raw.velocity : Number.isFinite(idea.reddit_velocity) ? idea.reddit_velocity : null,
        pain_density: typeof raw.pain_density === "number"
            ? raw.pain_density
            : typeof (raw as Record<string, unknown>).pain_signal === "number"
                ? Number((raw as Record<string, unknown>).pain_signal)
                : painDensityFallback,
        cross_platform: typeof raw.cross_platform === "number" ? raw.cross_platform : Number.isFinite(idea.cross_platform_multiplier) ? idea.cross_platform_multiplier : null,
        engagement: typeof raw.engagement === "number" ? raw.engagement : null,
        volume: typeof raw.volume === "number"
            ? raw.volume
            : typeof (raw as Record<string, unknown>).volume_bonus === "number"
                ? Math.min(100, (Number((raw as Record<string, unknown>).volume_bonus) / 15) * 100)
                : volumeFallback,
        evidence_quality: typeof raw.evidence_quality === "number" ? raw.evidence_quality : null,
        velocity_weight: typeof raw.velocity_weight === "number" ? raw.velocity_weight : 0.20,
        pain_density_weight: typeof raw.pain_density_weight === "number" ? raw.pain_density_weight : 0.20,
        cross_platform_weight: typeof raw.cross_platform_weight === "number" ? raw.cross_platform_weight : 0.15,
        engagement_weight: typeof raw.engagement_weight === "number" ? raw.engagement_weight : 0.15,
        volume_weight: typeof raw.volume_weight === "number" ? raw.volume_weight : 0.10,
        evidence_quality_weight: typeof raw.evidence_quality_weight === "number" ? raw.evidence_quality_weight : 0.20,
        raw_weighted_score: typeof raw.raw_weighted_score === "number" ? raw.raw_weighted_score : null,
    };

    const hasVisibleSignal = Object.values(breakdown).some((value) => typeof value === "number" && Number.isFinite(value));
    return hasAnyRaw || hasVisibleSignal ? breakdown : null;
}

function buildMarketValidationPrefill(
    idea: Idea,
    representativePosts: OpportunityTopPost[],
    signalSummary?: string | null,
    dominantPlatform?: string | null,
): ValidationPrefill {
    const cleanTopic = getIdeaDisplayTopic(idea).trim();
    const uniqueCommunities = Array.from(new Set(
        representativePosts
            .map((post) => {
                const subreddit = decodeHtml(post.subreddit);
                return subreddit ? `r/${subreddit}` : formatSourceName(post.source);
            })
            .filter(Boolean),
    )).slice(0, 3);

    const target = uniqueCommunities.length > 0
        ? `People active in ${uniqueCommunities.join(", ")}`
        : dominantPlatform
            ? `${formatSourceName(dominantPlatform)} users discussing ${cleanTopic}`
            : `${decodeHtml(idea.category)} buyers evaluating ${cleanTopic}`;

    const pain = signalSummary && signalSummary.trim()
        ? signalSummary.trim()
        : `People are discussing ${cleanTopic}, but the exact buyer pain still needs direct validation.`;

    return {
        idea: cleanTopic,
        target,
        pain,
    };
}

function getTransformationRawPainPost(representativePosts: OpportunityTopPost[]) {
    return representativePosts.find((post) => cleanText(post.title)) || representativePosts[0] || null;
}

function getTransformationSourceLabel(post: OpportunityTopPost | null) {
    if (!post) return "Representative source";
    const subreddit = cleanText(post.subreddit);
    if (subreddit) return `From r/${decodeHtml(subreddit)}`;
    return `From ${formatSourceName(post.source)}`;
}

function getTransformationPatternSummary(
    browseSummary: string,
    signalSummary?: string | null,
    displayTopic?: string,
) {
    return summarizeReasonForUser(
        signalSummary,
        browseSummary || `${displayTopic || "This idea"} is clustering often enough to deserve a closer look.`,
    );
}

function TransformationStep({
    label,
    value,
    hint,
    tone = "rgba(255,255,255,0.03)",
    border = "rgba(255,255,255,0.08)",
    labelColor = "#94a3b8",
}: {
    label: string;
    value: string;
    hint?: string;
    tone?: string;
    border?: string;
    labelColor?: string;
}) {
    return (
        <div style={{
            padding: "14px 16px",
            borderRadius: 14,
            background: tone,
            border: `1px solid ${border}`,
            display: "flex",
            flexDirection: "column",
            gap: 8,
        }}>
            <div style={{ fontSize: 10, color: labelColor, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                {label}
            </div>
            <div style={{ fontSize: 12, color: "#f8fafc", lineHeight: 1.65, fontWeight: 600 }}>
                {value}
            </div>
            {hint && (
                <div style={{ fontSize: 10.5, color: "#94a3b8", lineHeight: 1.55 }}>
                    {hint}
                </div>
            )}
        </div>
    );
}

function DetailMetric({
    label,
    value,
    hint,
    accent = "#94a3b8",
}: {
    label: string;
    value: string | number;
    hint?: string;
    accent?: string;
}) {
    return (
        <div style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
        }}>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {label}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: accent, fontFamily: "var(--font-mono)", lineHeight: 1.1 }}>
                {value}
            </div>
            {hint && (
                <div style={{ marginTop: 6, fontSize: 10, color: "#94a3b8", lineHeight: 1.45 }}>
                    {hint}
                </div>
            )}
        </div>
    );
}

function BreakdownMeter({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10 }}>
                <span style={{ color: "#94a3b8" }}>{label}</span>
                <span style={{ color: "#e2e8f0", fontFamily: "var(--font-mono)" }}>{Math.round(value)}</span>
            </div>
            <div style={{
                width: "100%",
                height: 6,
                borderRadius: 999,
                background: "rgba(255,255,255,0.05)",
                overflow: "hidden",
            }}>
                <div style={{
                    width: `${Math.max(0, Math.min(100, value))}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: color,
                }} />
            </div>
        </div>
    );
}

function IdeaRow({ idea, rank, isGuest }: { idea: Idea; rank: number; isGuest: boolean }) {
    const displayTopic = getIdeaDisplayTopic(idea);
    const observedTopic = decodeHtml(idea.topic);
    const suggestedWedge = getIdeaSuggestedWedge(idea);
    const marketHint = idea.market_hint || null;
    const conf = CONFIDENCE_MAP[idea.confidence_level] || CONFIDENCE_MAP.LOW;
    const scoreColor = idea.current_score >= 70 ? "#22c55e" : idea.current_score >= 40 ? "#f97316" : "#64748b";
    const [expanded, setExpanded] = useState(false);
    const [showFullAnalysis, setShowFullAnalysis] = useState(false);
    const [promoteState, setPromoteState] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [promoteMessage, setPromoteMessage] = useState("");
    const signalContract = idea.signal_contract || null;
    const signalTone = signalContract
        ? SIGNAL_LEVEL_MAP[signalContract.support_level]
        : {
            label: conf.label,
            color: conf.color,
            background: "rgba(148,163,184,0.12)",
        };
    const signalBadgeLabel = signalContract ? getSupportLevelLabel(signalContract.support_level) : conf.label;
    const representativePosts = rankOpportunityRepresentativePosts(idea.top_posts || []).slice(0, 3);
    const signalPanelTitle =
        signalContract?.support_level === "evidence_backed"
            ? "Why this looks real"
            : signalContract?.support_level === "supporting_context"
                ? "Why this is promising but not proven yet"
                : signalContract?.hn_launch_heavy
                    ? "Why this is mostly builder chatter"
                    : "Why this is still early";
    const scoreBreakdown = normalizeScoreBreakdown(idea);
    const hasThinDataWarning =
        ["LOW", "INSUFFICIENT"].includes(String(idea.confidence_level || "").toUpperCase())
        || signalContract?.support_level === "hypothesis";
    const hasStructuredEvidence = representativePosts.some((post) => (
        Boolean(post.market_support_level)
        || Boolean(post.signal_kind)
        || Boolean(post.voice_type)
        || Boolean(post.directness_tier)
    ));
    const directBuyerCount = Number(signalContract?.buyer_native_direct_count || 0);
    const supportingCount = Number(signalContract?.supporting_signal_count || 0);
    const launchMetaCount = Number(signalContract?.launch_meta_count || 0);
    const dominantPlatform = signalContract?.dominant_platform ? formatSourceName(signalContract.dominant_platform) : null;
    const sourceSummary = (idea.sources || [])
        .map((source) => `${formatSourceName(source.platform)} ${source.count}`)
        .join(" · ");
    const marketLeaders = normalizeMarketLeaders(idea.competition_data);
    const marketLeadersSummary = isRecord(idea.competition_data) && typeof idea.competition_data.market_leaders_summary === "string"
        ? idea.competition_data.market_leaders_summary
        : "";
    const validationPrefill = buildMarketValidationPrefill(
        idea,
        representativePosts,
        signalContract?.summary || null,
        signalContract?.dominant_platform || null,
    );
    const scoreMeters = scoreBreakdown ? [
        { label: "Velocity", value: Number(scoreBreakdown.velocity ?? 0), color: "#22c55e" },
        { label: "Pain density", value: Number(scoreBreakdown.pain_density ?? 0), color: "#f97316" },
        { label: "Cross-platform", value: Number(scoreBreakdown.cross_platform ?? 0), color: "#3b82f6" },
        { label: "Engagement", value: Number(scoreBreakdown.engagement ?? 0), color: "#a855f7" },
        { label: "Volume", value: Number(scoreBreakdown.volume ?? 0), color: "#eab308" },
        { label: "Evidence quality", value: Number(scoreBreakdown.evidence_quality ?? 0), color: "#14b8a6" },
    ].filter((item) => Number.isFinite(item.value)) : [];
    const browseSummary = idea.public_summary || summarizeIdeaForBrowse(idea);
    const verdictSummary = summarizeReasonForUser(
        idea.public_verdict || signalContract?.summary,
        hasThinDataWarning
            ? `${displayTopic} is still early and needs stronger proof before you treat it as a real bet`
            : `${displayTopic} has enough repeated proof to deserve a closer look`,
    );
    const evidenceSummary = directBuyerCount > 0
        ? `${formatCountLabel(directBuyerCount, "buyer quote")} and ${formatCountLabel(idea.source_count, "source")} support this idea.`
        : `${formatCountLabel(idea.post_count_total, "post")} and ${formatCountLabel(idea.source_count, "source")} are visible, but stronger buyer proof is still missing.`;
    const nextStepSummary = summarizeReasonForUser(
        idea.public_next_step || marketHint?.recommended_board_action || "",
        isGuest ? "Sign in to validate this idea or save it for later." : "Validate this idea next to see whether the proof still holds up under a deeper review.",
    );
    const { primaryTitle, secondaryAngle, secondaryLabel } = getOpportunityHeadline(
        observedTopic,
        displayTopic,
        suggestedWedge,
        directBuyerCount,
    );
    const rawPainPost = getTransformationRawPainPost(representativePosts);
    const rawPainTitle = rawPainPost ? decodeHtml(rawPainPost.title) : `People are repeatedly describing friction around ${displayTopic}.`;
    const rawPainSourceLabel = getTransformationSourceLabel(rawPainPost);
    const repeatedPattern = getTransformationPatternSummary(
        browseSummary,
        signalContract?.summary || null,
        displayTopic,
    );
    const transformationAngle = secondaryAngle || primaryTitle;
    const whyNowSummary = summarizeReasonForUser(
        marketHint?.why_it_matters_now || idea.public_verdict || signalContract?.summary,
        `${displayTopic} is moving enough right now to justify a tighter validation pass.`,
    );

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        setExpanded((current) => !current);
        setShowFullAnalysis(false);
    };

    const handlePromote = async (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (promoteState === "saving" || promoteState === "saved") return;
        if (isGuest) {
            if (typeof window !== "undefined") {
                window.location.href = BETA_AUTH_HREF;
                return;
            }
            setPromoteState("error");
            setPromoteMessage("Join the beta to save this idea to Opportunities.");
            return;
        }

        setPromoteState("saving");
        setPromoteMessage("");
        try {
            await promoteIdeaToBoard({
                primary_idea_slug: idea.slug,
            });
            setPromoteState("saved");
            setPromoteMessage("Saved to Opportunities.");
        } catch (error) {
            setPromoteState("error");
            setPromoteMessage(error instanceof Error ? error.message : "Could not save this idea to the radar.");
        }
    };

    return (
        <div>
            <motion.div
                className="glass-card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: rank * 0.04, duration: 0.3 }}
                whileHover={{ scale: 1.005, borderColor: "rgba(249,115,22,0.25)" }}
                onClick={handleClick}
                style={{
                    display: "grid", gridTemplateColumns: "40px minmax(0,1.5fr) 100px 100px 100px 84px 96px",
                    alignItems: "center", gap: 12, padding: "14px 18px",
                    cursor: "pointer", borderRadius: 10,
                    borderBottom: expanded ? "none" : "1px solid rgba(255,255,255,0.03)",
                    transition: "all 0.2s ease",
                    background: expanded ? "rgba(249,115,22,0.04)" : "transparent",
                }}
            >
                <div style={{
                    fontSize: 14, fontWeight: 700, color: rank <= 3 ? "#f97316" : "#475569",
                    fontFamily: "var(--font-mono)", textAlign: "center",
                }}>
                    #{rank}
                </div>

                <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                        <TrendIcon direction={idea.trend_direction} />
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", lineHeight: 1.35, ...CLAMP_TWO }}>
                            {primaryTitle}
                        </span>
                        <span style={{
                            fontSize: 10, padding: "1px 6px", borderRadius: 4,
                            background: "rgba(249,115,22,0.1)", color: "#f97316",
                            textTransform: "uppercase", fontWeight: 600,
                            whiteSpace: "nowrap",
                        }}>
                            {idea.category}
                        </span>
                        {idea.market_status === "needs_wedge" && (
                            <span style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 10,
                                padding: "2px 7px",
                                borderRadius: 999,
                                background: "rgba(59,130,246,0.12)",
                                border: "1px solid rgba(59,130,246,0.18)",
                                color: "#93c5fd",
                                fontWeight: 700,
                            }}>
                                Needs focus
                            </span>
                        )}
                        {idea.fresh_candidate && (
                            <span style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 10,
                                padding: "2px 7px",
                                borderRadius: 999,
                                background: "rgba(34,197,94,0.12)",
                                border: "1px solid rgba(34,197,94,0.18)",
                                color: "#86efac",
                                fontWeight: 700,
                            }}>
                                New
                            </span>
                        )}
                    </div>
                    {secondaryAngle && (
                        <div style={{ fontSize: 11, color: "#cbd5e1", lineHeight: 1.55, marginBottom: 6, ...CLAMP_ONE }}>
                            {secondaryLabel}: {secondaryAngle}
                        </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "#64748b", flexWrap: "wrap" }}>
                        <span>{formatCountLabel(idea.post_count_total, "post")}</span>
                        <span>{formatCountLabel(idea.source_count, "source")}</span>
                        <span style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            color: signalTone.color,
                            background: signalTone.background,
                            padding: "2px 7px",
                            borderRadius: 999,
                            fontWeight: 700,
                        }}>
                            {signalBadgeLabel}
                        </span>
                        {expanded && (
                            <span style={{ fontSize: 9, color: "#64748b" }}>Open details</span>
                        )}
                    </div>
                </div>

                <div style={{ textAlign: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <div style={{
                            fontSize: 20, fontWeight: 800, color: scoreColor,
                            fontFamily: "var(--font-mono)", lineHeight: 1,
                        }}>
                            {idea.current_score.toFixed(0)}
                        </div>
                        <ScoreBreakdownTooltip
                            score={idea.current_score}
                            breakdown={scoreBreakdown}
                        />
                    </div>
                    <div style={{ marginTop: 4, padding: "0 8px" }}>
                        <ScoreBar score={idea.current_score} color={scoreColor} />
                    </div>
                    <div style={{ marginTop: 5, fontSize: 9, color: "#64748b", lineHeight: 1.3 }}>
                        opportunity score
                    </div>
                </div>

                <div style={{ textAlign: "center" }}>
                    <ChangeDisplay value={idea.change_24h} prefix="24h " />
                </div>

                <div style={{ textAlign: "center" }}>
                    <ChangeDisplay value={idea.change_7d} prefix="7d " />
                </div>

                <div style={{ textAlign: "center", fontSize: 12, color: "#94a3b8", fontFamily: "var(--font-mono)" }}>
                    {idea.post_count_7d}
                    <div style={{ fontSize: 9, color: "#475569" }}>7d vol</div>
                </div>

                <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                    {(idea.sources || []).map((source) => {
                        const s = source.platform;
                        return (
                            <span key={`${idea.id}-${s}`} style={{
                                fontSize: 9, padding: "2px 5px", borderRadius: 3,
                                background: s === "reddit" ? "rgba(255,69,0,0.15)" :
                                    s === "hackernews" ? "rgba(255,102,0,0.15)" :
                                        s === "producthunt" ? "rgba(218,85,47,0.15)" :
                                            "rgba(79,70,229,0.15)",
                                color: s === "reddit" ? "#ff4500" :
                                    s === "hackernews" ? "#ff6600" :
                                        s === "producthunt" ? "#da552f" :
                                            "#4f46e5",
                                fontWeight: 600, textTransform: "uppercase",
                            }} title={`${formatSourceName(s)}: ${source.count} posts`}>
                                {formatSourceShort(s)}{Math.max(0, Number(source.count || 0))}
                            </span>
                        );
                    })}
                </div>
            </motion.div>

            
            {/* Expanded Detail Panel */}
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        style={{ overflow: "hidden" }}
                    >
                        <div style={{
                            margin: "0 8px 8px",
                            padding: 20,
                            borderRadius: "0 0 12px 12px",
                            background: "rgba(15,23,42,0.6)",
                            border: "1px solid rgba(249,115,22,0.1)",
                            borderTop: "1px solid rgba(249,115,22,0.15)",
                        }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                                <div style={{
                                    padding: "14px 16px",
                                    borderRadius: 14,
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(255,255,255,0.08)",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 12,
                                }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                        <div>
                                            <div style={{ fontSize: 10, color: "#f97316", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                                                Why this opportunity?
                                            </div>
                                            <div style={{ marginTop: 4, fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
                                                Raw pain becomes a repeated pattern, then a suggested wedge you can test.
                                            </div>
                                        </div>
                                        <span style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 6,
                                            padding: "3px 8px",
                                            borderRadius: 999,
                                            background: "rgba(249,115,22,0.08)",
                                            border: "1px solid rgba(249,115,22,0.16)",
                                            fontSize: 10,
                                            color: "#fdba74",
                                            fontWeight: 700,
                                        }}>
                                            Explainable signal
                                        </span>
                                    </div>
                                    <div style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                                        gap: 12,
                                    }}>
                                        <TransformationStep
                                            label="Core pain observed"
                                            value={rawPainTitle}
                                            hint={rawPainSourceLabel}
                                            tone="rgba(249,115,22,0.06)"
                                            border="rgba(249,115,22,0.14)"
                                            labelColor="#fdba74"
                                        />
                                        <TransformationStep
                                            label="Repeated pattern"
                                            value={repeatedPattern}
                                            hint={evidenceSummary}
                                        />
                                        <TransformationStep
                                            label={secondaryLabel}
                                            value={transformationAngle}
                                            hint={browseSummary}
                                            tone="rgba(59,130,246,0.08)"
                                            border="rgba(59,130,246,0.16)"
                                            labelColor="#93c5fd"
                                        />
                                        <TransformationStep
                                            label="Why now"
                                            value={whyNowSummary}
                                            hint={nextStepSummary}
                                            tone="rgba(34,197,94,0.08)"
                                            border="rgba(34,197,94,0.16)"
                                            labelColor="#86efac"
                                        />
                                    </div>
                                </div>

                                <div style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                    gap: 12,
                                }}>
                                    <div style={{
                                        padding: "14px 16px",
                                        borderRadius: 14,
                                        background: "rgba(249,115,22,0.06)",
                                        border: "1px solid rgba(249,115,22,0.14)",
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                                            <span style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 4,
                                                color: signalTone.color,
                                                background: signalTone.background,
                                                padding: "3px 8px",
                                                borderRadius: 999,
                                                fontSize: 10,
                                                fontWeight: 700,
                                            }}>
                                                {signalBadgeLabel}
                                            </span>
                                            <span style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 4,
                                                color: conf.color,
                                                background: `${conf.color}15`,
                                                padding: "3px 8px",
                                                borderRadius: 999,
                                                fontSize: 10,
                                                fontWeight: 700,
                                            }}>
                                                {conf.label}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 13, color: "#f8fafc", fontWeight: 700, marginBottom: 8 }}>
                                            Verdict
                                        </div>
                                        <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.6 }}>
                                            {verdictSummary}
                                        </div>
                                    </div>

                                    <div style={{
                                        padding: "14px 16px",
                                        borderRadius: 14,
                                        background: "rgba(255,255,255,0.03)",
                                        border: "1px solid rgba(255,255,255,0.08)",
                                    }}>
                                        <div style={{ fontSize: 13, color: "#f8fafc", fontWeight: 700, marginBottom: 8 }}>
                                            Evidence
                                        </div>
                                        <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.6 }}>
                                            {evidenceSummary}
                                        </div>
                                        <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
                                            {browseSummary}
                                        </div>
                                    </div>

                                    <div style={{
                                        padding: "14px 16px",
                                        borderRadius: 14,
                                        background: "rgba(59,130,246,0.08)",
                                        border: "1px solid rgba(59,130,246,0.16)",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 12,
                                    }}>
                                        <div>
                                            <div style={{ fontSize: 13, color: "#f8fafc", fontWeight: 700, marginBottom: 8 }}>
                                                Next step
                                            </div>
                                            <div style={{ fontSize: 12, color: "#dbeafe", lineHeight: 1.6 }}>
                                                {nextStepSummary}
                                            </div>
                                        </div>
                                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                            <ValidationDepthChooser
                                                prefill={validationPrefill}
                                                isGuest={isGuest}
                                                nextPath="/dashboard"
                                            >
                                                <span style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    gap: 8,
                                                    padding: "10px 14px",
                                                    borderRadius: 10,
                                                    background: "linear-gradient(135deg, rgba(249,115,22,0.18), rgba(234,88,12,0.08))",
                                                    border: "1px solid rgba(249,115,22,0.22)",
                                                    color: "#f8fafc",
                                                    fontSize: 12,
                                                    fontWeight: 700,
                                                }}>
                                                    Validate this idea
                                                </span>
                                            </ValidationDepthChooser>
                                            <button
                                                onClick={handlePromote}
                                                style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    gap: 8,
                                                    padding: "10px 14px",
                                                    borderRadius: 10,
                                                    textAlign: "left",
                                                    background: promoteState === "saved"
                                                        ? "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(22,163,74,0.08))"
                                                        : "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(37,99,235,0.06))",
                                                    border: promoteState === "saved"
                                                        ? "1px solid rgba(34,197,94,0.18)"
                                                        : "1px solid rgba(59,130,246,0.18)",
                                                    color: "#f8fafc",
                                                    cursor: promoteState === "saving" ? "wait" : "pointer",
                                                    fontSize: 12,
                                                    fontWeight: 700,
                                                }}
                                            >
                                                {promoteState === "saved" ? "Saved to radar" : promoteState === "saving" ? "Promoting..." : isGuest ? "Join beta to save" : "Save to radar"}
                                            </button>
                                        </div>
                                        {promoteMessage && (
                                            <div style={{ fontSize: 11, color: promoteState === "error" ? "#fca5a5" : "#dbeafe", lineHeight: 1.5 }}>
                                                {promoteMessage}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                                    <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>
                                        Open the deeper breakdown only when you want the full homework.
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setShowFullAnalysis((current) => !current);
                                        }}
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 8,
                                            padding: "8px 12px",
                                            borderRadius: 999,
                                            border: "1px solid rgba(255,255,255,0.12)",
                                            background: "rgba(255,255,255,0.03)",
                                            color: "#e2e8f0",
                                            fontSize: 11,
                                            fontWeight: 700,
                                            cursor: "pointer",
                                        }}
                                    >
                                        {showFullAnalysis ? "Hide full analysis" : "Show full analysis"}
                                    </button>
                                </div>

                                <div style={{ display: showFullAnalysis ? "flex" : "none", flexDirection: "column", gap: 16 }}>
                                <div style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                                    gap: 10,
                                }}>
                                    <div style={{
                                        padding: "12px 14px",
                                        borderRadius: 12,
                                        background: "rgba(249,115,22,0.06)",
                                        border: "1px solid rgba(249,115,22,0.14)",
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                                            <span style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 4,
                                                color: signalTone.color,
                                                background: signalTone.background,
                                                padding: "3px 8px",
                                                borderRadius: 999,
                                                fontSize: 10,
                                                fontWeight: 700,
                                            }}>
                                                {signalBadgeLabel}
                                            </span>
                                            <span style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 4,
                                                color: conf.color,
                                                background: `${conf.color}15`,
                                                padding: "3px 8px",
                                                borderRadius: 999,
                                                fontSize: 10,
                                                fontWeight: 700,
                                            }}>
                                                {conf.label}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.5 }}>
                                            {signalContract?.summary || "Representative evidence ranked by buyer-native proof first."}
                                        </div>
                                    </div>

                                    <DetailMetric
                                        label="Direct buyer proof"
                                        value={directBuyerCount}
                                        hint={directBuyerCount > 0 ? "Direct buyer-native evidence is present." : "No direct buyer-native proof in the current card."}
                                        accent={directBuyerCount > 0 ? "#22c55e" : "#94a3b8"}
                                    />
                                    <DetailMetric
                                        label="Source diversity"
                                        value={idea.source_count}
                                        hint={dominantPlatform ? `Dominant source: ${dominantPlatform}` : "Mixed source pool"}
                                        accent={idea.source_count > 1 ? "#3b82f6" : "#f59e0b"}
                                    />
                                    <DetailMetric
                                        label="Data quality"
                                        value={hasStructuredEvidence ? "Structured" : "Needs refresh"}
                                        hint={hasStructuredEvidence ? "Posts include structured evidence metadata." : "Representative posts still use older scrape metadata."}
                                        accent={hasStructuredEvidence ? "#22c55e" : "#f59e0b"}
                                    />
                                    <ValidationDepthChooser
                                        prefill={validationPrefill}
                                        isGuest={isGuest}
                                        nextPath="/dashboard"
                                    >
                                        <span style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            justifyContent: "space-between",
                                            gap: 8,
                                            padding: "12px 14px",
                                            borderRadius: 10,
                                            background: "linear-gradient(135deg, rgba(249,115,22,0.14), rgba(234,88,12,0.06))",
                                            border: "1px solid rgba(249,115,22,0.18)",
                                            textAlign: "left",
                                        }}>
                                            <span>
                                                <span style={{ display: "block", fontSize: 10, color: "#fdba74", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                                    Next move
                                                </span>
                                                <span style={{ display: "block", fontSize: 17, fontWeight: 800, color: "#f8fafc", lineHeight: 1.1 }}>
                                                    Validate this idea
                                                </span>
                                            </span>
                                            <span style={{ fontSize: 10, color: "#fed7aa", lineHeight: 1.5 }}>
                                                Send this opportunity into Validate with the topic, buyer hint, and pain context prefilled.
                                            </span>
                                        </span>
                                    </ValidationDepthChooser>
                                    <button
                                        onClick={handlePromote}
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            justifyContent: "space-between",
                                            gap: 8,
                                            padding: "12px 14px",
                                            borderRadius: 10,
                                            textAlign: "left",
                                            background: promoteState === "saved"
                                                ? "linear-gradient(135deg, rgba(34,197,94,0.14), rgba(22,163,74,0.08))"
                                                : "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(37,99,235,0.06))",
                                            border: promoteState === "saved"
                                                ? "1px solid rgba(34,197,94,0.18)"
                                                : "1px solid rgba(59,130,246,0.18)",
                                            color: "#f8fafc",
                                            cursor: promoteState === "saving" ? "wait" : "pointer",
                                        }}
                                    >
                                        <div>
                                            <div style={{ fontSize: 10, color: promoteState === "saved" ? "#bbf7d0" : "#bfdbfe", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                                Opportunity radar
                                            </div>
                                            <div style={{ fontSize: 17, fontWeight: 800, color: "#f8fafc", lineHeight: 1.1 }}>
                                                {promoteState === "saved" ? "Saved to radar" : promoteState === "saving" ? "Promoting..." : isGuest ? "Join beta to save" : "Promote to radar"}
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 10, color: promoteState === "saved" ? "#dcfce7" : "#dbeafe", lineHeight: 1.5 }}>
                                            {promoteMessage || (isGuest
                                                ? "Guest beta is read-only. Join the beta with Google to save ideas into your radar."
                                                : "Create a curated opportunity row without rewriting the live radar.")}
                                        </div>
                                    </button>
                                </div>

                                {marketHint && (
                                    <div style={{
                                        padding: "12px 14px",
                                        borderRadius: 12,
                                        background: "rgba(59,130,246,0.06)",
                                        border: "1px solid rgba(59,130,246,0.12)",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 10,
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#93c5fd" }}>
                                                How ready it looks
                                            </div>
                                            <span style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 4,
                                                padding: "3px 8px",
                                                borderRadius: 999,
                                                fontSize: 10,
                                                fontWeight: 700,
                                                color: marketHint.promotion_readiness === "ready" ? "#86efac" : marketHint.promotion_readiness === "needs_wedge" ? "#93c5fd" : "#fbbf24",
                                                background: marketHint.promotion_readiness === "ready"
                                                    ? "rgba(34,197,94,0.12)"
                                                    : marketHint.promotion_readiness === "needs_wedge"
                                                        ? "rgba(59,130,246,0.12)"
                                                        : "rgba(245,158,11,0.12)",
                                                border: marketHint.promotion_readiness === "ready"
                                                    ? "1px solid rgba(34,197,94,0.18)"
                                                    : marketHint.promotion_readiness === "needs_wedge"
                                                        ? "1px solid rgba(59,130,246,0.18)"
                                                        : "1px solid rgba(245,158,11,0.18)",
                                            }}>
                                                {getReadinessLabel(marketHint.promotion_readiness)}
                                            </span>
                                        </div>
                                        {suggestedWedge && (
                                            <div style={{ fontSize: 12, color: "#dbeafe", lineHeight: 1.55 }}>
                                                {secondaryLabel}: {suggestedWedge}
                                            </div>
                                        )}
                                        <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.6 }}>
                                            {summarizeReasonForUser(marketHint.why_it_matters_now, `${displayTopic} is moving enough to keep watching.`)}
                                        </div>
                                        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                                        Missing proof: {summarizeReasonForUser(marketHint.missing_proof, "It still needs stronger buyer proof.")}
                                    </div>
                                    <div style={{ fontSize: 11, color: "#bfdbfe", lineHeight: 1.55 }}>
                                        Recommended action: {marketHint.recommended_board_action}
                                    </div>
                                </div>
                            )}

                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                                <div style={{
                                    padding: 14,
                                    borderRadius: 10,
                                    background: "rgba(255,255,255,0.02)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                }}>
                                    <div style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "flex-start",
                                        gap: 3,
                                        marginBottom: 10,
                                    }}>
                                        <span style={{ color: "#f1f5f9", fontSize: 12, fontWeight: 700 }}>
                                            {signalPanelTitle}
                                        </span>
                                        {signalContract?.reasons && signalContract.reasons.length > 0 && (
                                            <div style={{
                                                display: "flex",
                                                flexWrap: "wrap",
                                                gap: 6,
                                                marginTop: 6,
                                            }}>
                                                {signalContract.reasons.slice(0, 3).map((reason) => (
                                                    <span
                                                        key={`${idea.slug}-${reason}`}
                                                        style={{
                                                            fontSize: 9,
                                                            color: "#cbd5e1",
                                                            background: "rgba(255,255,255,0.04)",
                                                            border: "1px solid rgba(255,255,255,0.06)",
                                                            borderRadius: 999,
                                                            padding: "3px 7px",
                                                        }}
                                                    >
                                                        {reason}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    {idea.top_posts && idea.top_posts.length > 0 ? (
                                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                            {representativePosts.map((post, index) => {
                                                const postSupport = getOpportunityPostSupportLevel(post);
                                                const postTone = SIGNAL_LEVEL_MAP[postSupport];
                                                const postLabel =
                                                    postSupport === "hypothesis" && post.signal_kind === "launch_discussion"
                                                        ? "Builder / launch chatter"
                                                        : postTone.label;
                                                return (
                                                <a
                                                    key={`${idea.slug}-post-${index}`}
                                                    href={post.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "flex-start",
                                                        justifyContent: "space-between",
                                                        gap: 12,
                                                        padding: "10px 12px",
                                                        borderRadius: 8,
                                                        textDecoration: "none",
                                                        color: "inherit",
                                                        background: "rgba(249,115,22,0.04)",
                                                        border: "1px solid rgba(249,115,22,0.08)",
                                                    }}
                                                >
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                                                            <span style={{
                                                                display: "inline-flex",
                                                                alignItems: "center",
                                                                gap: 4,
                                                                fontSize: 9,
                                                                padding: "2px 6px",
                                                                borderRadius: 999,
                                                                background: postTone.background,
                                                                color: postTone.color,
                                                                fontWeight: 700,
                                                            }}>
                                                                {postLabel}
                                                            </span>
                                                            {post.signal_kind === "launch_discussion" && (
                                                                <span style={{ fontSize: 9, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                                                    not buyer pain
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{
                                                            fontSize: 12,
                                                            lineHeight: 1.45,
                                                            color: "#e2e8f0",
                                                            marginBottom: 4,
                                                        }}>
                                                            {decodeHtml(post.title)}
                                                        </div>
                                                        <div style={{
                                                            display: "flex",
                                                            gap: 8,
                                                            flexWrap: "wrap",
                                                            fontSize: 10,
                                                            color: "#94a3b8",
                                                        }}>
                                                            <span>
                                                                {post.subreddit ? `r/${decodeHtml(post.subreddit)}` : formatSourceName(post.source)}
                                                            </span>
                                                            <span>{post.score} upvotes</span>
                                                            <span>{post.comments || 0} comments</span>
                                                        </div>
                                                    </div>
                                                    <ExternalLink style={{
                                                        width: 12,
                                                        height: 12,
                                                        color: "#64748b",
                                                        flexShrink: 0,
                                                        marginTop: 2,
                                                    }} />
                                                </a>
                                            )})}
                                        </div>
                                    ) : (
                                        <div style={{ fontSize: 12, color: "#94a3b8" }}>
                                            No representative proof yet. Refresh the radar to gather more evidence.
                                        </div>
                                    )}
                                </div>

                                <div style={{
                                    padding: 14,
                                    borderRadius: 10,
                                    background: "rgba(255,255,255,0.02)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 14,
                                }}>
                                    <div style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        marginBottom: 12,
                                        fontSize: 12,
                                        fontWeight: 700,
                                        color: "#f1f5f9",
                                    }}>
                                        <span style={{ color: "#22c55e" }}>Proof audit</span>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                        <DetailMetric
                                            label="Supporting context"
                                            value={supportingCount}
                                            hint="Indirect or adjacent evidence in top posts."
                                            accent={supportingCount > 0 ? "#3b82f6" : "#94a3b8"}
                                        />
                                        <DetailMetric
                                            label="Launch / meta"
                                            value={launchMetaCount}
                                            hint={launchMetaCount > 0 ? "Builder chatter is mixed into this card." : "Top evidence is not launch-heavy."}
                                            accent={launchMetaCount > 0 ? "#f59e0b" : "#22c55e"}
                                        />
                                    </div>

                                    <div style={{
                                        padding: "12px 14px",
                                        borderRadius: 10,
                                        background: "rgba(255,255,255,0.03)",
                                        border: "1px solid rgba(255,255,255,0.05)",
                                    }}>
                                        <div style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            marginBottom: 10,
                                            fontSize: 12,
                                            fontWeight: 700,
                                            color: "#f1f5f9",
                                        }}>
                                            <span style={{ color: "#38bdf8" }}>Market leaders</span>
                                        </div>
                                        {marketLeaders.length > 0 ? (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                                    {marketLeaders.map((leader) => (
                                                        <div
                                                            key={`${idea.slug}-${leader.name}`}
                                                            style={{
                                                                padding: "8px 10px",
                                                                borderRadius: 10,
                                                                background: "rgba(56,189,248,0.08)",
                                                                border: "1px solid rgba(56,189,248,0.14)",
                                                                minWidth: 120,
                                                            }}
                                                        >
                                                            <div style={{ fontSize: 11, fontWeight: 700, color: "#e0f2fe" }}>
                                                                {leader.name}
                                                            </div>
                                                            <div style={{ marginTop: 3, fontSize: 10, color: "#94a3b8", lineHeight: 1.45 }}>
                                                                {leaderEvidenceLabel(leader)}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                                                    {marketLeadersSummary || "These are the incumbents or alternatives most visible in the evidence attached to this idea."}
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                                                No clear incumbent names have been extracted yet. The next scraper refresh may find them as more posts accumulate.
                                            </div>
                                        )}
                                    </div>

                                    <div style={{
                                        padding: "12px 14px",
                                        borderRadius: 10,
                                        background: "rgba(255,255,255,0.03)",
                                        border: "1px solid rgba(255,255,255,0.05)",
                                    }}>
                                        <div style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            marginBottom: 10,
                                            fontSize: 12,
                                            fontWeight: 700,
                                            color: "#f1f5f9",
                                        }}>
                                            <span style={{ color: "#22c55e" }}>Momentum</span>
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                        <div style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 6,
                                            alignSelf: "flex-start",
                                            padding: "4px 10px",
                                            borderRadius: 999,
                                            background: `${idea.trend_direction === "rising" ? "#22c55e" : idea.trend_direction === "falling" ? "#ef4444" : "#64748b"}15`,
                                            color: idea.trend_direction === "rising" ? "#22c55e" : idea.trend_direction === "falling" ? "#ef4444" : "#94a3b8",
                                            fontSize: 11,
                                            fontWeight: 700,
                                            textTransform: "uppercase",
                                            letterSpacing: "0.06em",
                                        }}>
                                            <TrendIcon direction={idea.trend_direction} size={12} />
                                            {formatTrendLabel(idea.trend_direction)}
                                        </div>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                            <div style={{
                                                padding: "10px 12px",
                                                borderRadius: 8,
                                                background: "rgba(255,255,255,0.03)",
                                                border: "1px solid rgba(255,255,255,0.05)",
                                            }}>
                                                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>24h change</div>
                                                <ChangeDisplay value={idea.change_24h} />
                                            </div>
                                            <div style={{
                                                padding: "10px 12px",
                                                borderRadius: 8,
                                                background: "rgba(255,255,255,0.03)",
                                                border: "1px solid rgba(255,255,255,0.05)",
                                            }}>
                                                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>7d change</div>
                                                <ChangeDisplay value={idea.change_7d} />
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
                                            {idea.post_count_total} total posts across {idea.source_count} {idea.source_count === 1 ? "source" : "sources"}.
                                        </div>
                                        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
                                            Source mix: {sourceSummary || "No source mix yet"}.
                                        </div>
                                        </div>
                                    </div>

                                    <div style={{
                                        padding: "12px 14px",
                                        borderRadius: 10,
                                        background: "rgba(255,255,255,0.03)",
                                        border: "1px solid rgba(255,255,255,0.05)",
                                    }}>
                                        <div style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            marginBottom: 10,
                                            fontSize: 12,
                                            fontWeight: 700,
                                            color: "#f1f5f9",
                                        }}>
                                            <span style={{ color: "#f97316" }}>How the score was built</span>
                                        </div>
                                        {scoreMeters.length > 0 ? (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                                {scoreMeters.map((meter) => (
                                                    <BreakdownMeter
                                                        key={`${idea.slug}-${meter.label}`}
                                                        label={meter.label}
                                                        value={meter.value}
                                                        color={meter.color}
                                                    />
                                                ))}
                                            </div>
                                        ) : (
                                            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
                                                Score breakdown will look better after the latest scraper refresh writes updated breakdown fields.
                                            </div>
                                        )}
                                        <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.55 }}>
                                            These bars are weighted ingredients, not numbers that add directly to the final score.
                                            Final score = velocity 20% + pain density 20% + cross-platform proof 15% + engagement 15% + volume 10% + evidence quality 20%.
                                        </div>
                                    </div>
                                </div>
                                </div>
                            </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function MobileIdeaCard({ idea, rank, isGuest }: { idea: Idea; rank: number; isGuest: boolean }) {
    const [expanded, setExpanded] = useState(false);
    const [showFullAnalysis, setShowFullAnalysis] = useState(false);
    const displayTopic = getIdeaDisplayTopic(idea);
    const observedTopic = decodeHtml(idea.topic);
    const suggestedWedge = getIdeaSuggestedWedge(idea);
    const representativePosts = rankOpportunityRepresentativePosts(idea.top_posts || []).slice(0, 2);
    const signalContract = idea.signal_contract || null;
    const marketHint = idea.market_hint || null;
    const conf = CONFIDENCE_MAP[idea.confidence_level] || CONFIDENCE_MAP.LOW;
    const signalTone = signalContract
        ? SIGNAL_LEVEL_MAP[signalContract.support_level]
        : {
            label: conf.label,
            color: conf.color,
            background: "rgba(148,163,184,0.12)",
        };
    const signalBadgeLabel = signalContract ? getSupportLevelLabel(signalContract.support_level) : conf.label;
    const validationPrefill = buildMarketValidationPrefill(
        idea,
        representativePosts,
        signalContract?.summary || null,
        signalContract?.dominant_platform || null,
    );
    const ideaHref = buildIdeaHref(idea.slug);
    const sourceSummary = (idea.sources || [])
        .map((source) => `${formatSourceName(source.platform)} ${source.count}`)
        .join(" - ");
    const marketLeadersSummary = isRecord(idea.competition_data) && typeof idea.competition_data.market_leaders_summary === "string"
        ? idea.competition_data.market_leaders_summary
        : "";
    const scoreColor = idea.current_score >= 70 ? "#22c55e" : idea.current_score >= 40 ? "#f97316" : "#64748b";
    const directBuyerCount = Number(signalContract?.buyer_native_direct_count || 0);
    const trendTone = getTrendTone(idea.trend_direction);
    const { primaryTitle, secondaryAngle, secondaryLabel } = getOpportunityHeadline(
        observedTopic,
        displayTopic,
        suggestedWedge,
        directBuyerCount,
    );
    const browseSummary = idea.public_summary || summarizeIdeaForBrowse(idea);
    const verdictSummary = summarizeReasonForUser(
        idea.public_verdict || signalContract?.summary,
        `${displayTopic} is getting enough repeated discussion to review, but the idea still needs proof.`,
    );
    const evidenceSummary = directBuyerCount > 0
        ? `${formatCountLabel(directBuyerCount, "buyer quote")} and ${formatCountLabel(idea.source_count, "source")} support this idea.`
        : `${formatCountLabel(idea.post_count_total, "post")} and ${formatCountLabel(idea.source_count, "source")} are visible, but stronger buyer proof is still missing.`;
    const nextStepSummary = summarizeReasonForUser(
        idea.public_next_step || marketHint?.recommended_board_action,
        isGuest ? "Sign in to validate this idea or save it for later." : "Validate this idea next before you commit to it.",
    );
    const rawPainPost = getTransformationRawPainPost(representativePosts);
    const rawPainTitle = rawPainPost ? decodeHtml(rawPainPost.title) : `People are repeatedly describing friction around ${displayTopic}.`;
    const repeatedPattern = getTransformationPatternSummary(
        verdictSummary,
        signalContract?.summary || null,
        displayTopic,
    );
    const whyNowSummary = summarizeReasonForUser(
        marketHint?.why_it_matters_now || idea.public_verdict || signalContract?.summary,
        `${displayTopic} is moving enough right now to justify a tighter validation pass.`,
    );

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: rank * 0.03, duration: 0.24 }}
            className="surface-panel p-4"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                            #{rank}
                        </span>
                        <span className="rounded-full px-2 py-1 text-[10px] font-mono uppercase tracking-[0.14em]" style={{ background: signalTone.background, color: signalTone.color }}>
                            {signalBadgeLabel}
                        </span>
                        {idea.fresh_candidate && (
                            <span className="rounded-full border border-build/20 bg-build/10 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.14em] text-build">
                                Fresh
                            </span>
                        )}
                    </div>

                    <div className="mb-1 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                        {idea.category} · {trendTone.label}
                    </div>

                    <Link href={ideaHref} className="block">
                        <h3 className="text-base font-semibold leading-6 text-white" style={CLAMP_TWO}>{primaryTitle}</h3>
                        {secondaryAngle && (
                            <p className="mt-1 text-sm leading-6 text-orange-200" style={CLAMP_TWO}>{secondaryLabel}: {secondaryAngle}</p>
                        )}
                    </Link>
                </div>

                <div className="shrink-0 text-right">
                    <div className="text-3xl font-display font-black" style={{ color: scoreColor }}>
                        {idea.current_score.toFixed(0)}
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">score</div>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                    <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Proof</div>
                    <div className="mt-1 text-sm font-semibold text-white">
                        {directBuyerCount > 0 ? `${directBuyerCount} quotes` : `${idea.source_count} sources`}
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground">{formatCountLabel(idea.post_count_total, "post")}</div>
                </div>
                <div className="rounded-2xl border border-white/8 p-3" style={{ background: trendTone.background, borderColor: `${trendTone.color}25` }}>
                    <div className="text-[10px] font-mono uppercase tracking-[0.14em]" style={{ color: trendTone.color }}>Momentum</div>
                    <div className="mt-1 text-sm font-semibold text-white" style={CLAMP_ONE}>{trendTone.label}</div>
                    <div className="mt-2 text-xs">
                        <ChangeDisplay value={idea.change_24h} />
                    </div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                    <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Volume</div>
                    <div className="mt-1 text-sm font-semibold text-white">{idea.post_count_7d}</div>
                    <div className="mt-2 text-[10px] text-muted-foreground">7d posts</div>
                </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                {(idea.sources || []).slice(0, 3).map((source) => {
                    const platform = source.platform;
                    return (
                        <span
                            key={`${idea.id}-mobile-${platform}`}
                            className="rounded-full px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.14em]"
                            style={{
                                background: platform === "reddit" ? "rgba(255,69,0,0.15)"
                                    : platform === "hackernews" ? "rgba(255,102,0,0.15)"
                                        : platform === "producthunt" ? "rgba(218,85,47,0.15)"
                                            : "rgba(79,70,229,0.15)",
                                color: platform === "reddit" ? "#ff4500"
                                    : platform === "hackernews" ? "#ff6600"
                                        : platform === "producthunt" ? "#da552f"
                                            : "#818cf8",
                            }}
                        >
                            {formatSourceShort(platform)}{Math.max(0, Number(source.count || 0))}
                        </span>
                    );
                })}
            </div>

            <div className="mt-4 flex gap-2">
                <button
                    type="button"
                    onClick={() => {
                        setExpanded((current) => !current);
                        setShowFullAnalysis(false);
                    }}
                    className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-[11px] font-mono uppercase tracking-[0.12em] text-foreground transition-colors hover:bg-white/[0.05]"
                >
                    {expanded ? <Minus style={{ width: 14, height: 14 }} /> : <Plus style={{ width: 14, height: 14 }} />}
                    {expanded ? "Hide details" : "Why this opportunity?"}
                </button>
                <ValidationDepthChooser
                    prefill={validationPrefill}
                    isGuest={isGuest}
                    className="min-h-[48px] flex-1"
                    nextPath="/dashboard"
                >
                    <span className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-primary/25 bg-primary/10 px-4 text-[11px] font-mono uppercase tracking-[0.12em] text-primary transition-colors hover:bg-primary/15">
                        <Zap style={{ width: 14, height: 14 }} />
                        {isGuest ? "Join beta" : "Validate"}
                    </span>
                </ValidationDepthChooser>
            </div>

            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: "easeInOut" }}
                        style={{ overflow: "hidden" }}
                    >
                        <div className="mt-4 space-y-3 border-t border-white/8 pt-4">
                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-primary">Why this opportunity?</div>
                                <div className="mt-3 grid gap-2">
                                    <TransformationStep
                                        label="Core pain observed"
                                        value={rawPainTitle}
                                        hint={getTransformationSourceLabel(rawPainPost)}
                                        tone="rgba(249,115,22,0.06)"
                                        border="rgba(249,115,22,0.14)"
                                        labelColor="#fdba74"
                                    />
                                    <TransformationStep label="Repeated pattern" value={repeatedPattern} hint={sourceSummary || evidenceSummary} />
                                    <TransformationStep
                                        label={secondaryLabel}
                                        value={secondaryAngle || primaryTitle}
                                        hint={browseSummary}
                                        tone="rgba(59,130,246,0.08)"
                                        border="rgba(59,130,246,0.16)"
                                        labelColor="#93c5fd"
                                    />
                                    <TransformationStep
                                        label="Why now"
                                        value={whyNowSummary}
                                        hint={nextStepSummary}
                                        tone="rgba(34,197,94,0.08)"
                                        border="rgba(34,197,94,0.16)"
                                        labelColor="#86efac"
                                    />
                                </div>
                            </div>

                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-primary">Verdict</div>
                                <p className="mt-2 text-xs leading-6 text-slate-200">{verdictSummary}</p>
                            </div>

                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Evidence</div>
                                <p className="mt-2 text-xs leading-6 text-slate-200">
                                    {directBuyerCount > 0
                                        ? `${formatCountLabel(directBuyerCount, "buyer quote")} across ${formatCountLabel(idea.source_count, "source")}.`
                                        : `${formatCountLabel(idea.post_count_total, "post")} across ${formatCountLabel(idea.source_count, "source")}, but stronger buyer proof is still missing.`}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3">
                                <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-primary">Next step</div>
                                <p className="mt-2 text-xs leading-6 text-slate-100">{nextStepSummary}</p>
                            </div>

                            <button
                                type="button"
                                onClick={() => setShowFullAnalysis((current) => !current)}
                                className="inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-[11px] font-mono uppercase tracking-[0.12em] text-foreground"
                            >
                                {showFullAnalysis ? "Hide full analysis" : "Show full analysis"}
                            </button>

                            {showFullAnalysis && representativePosts.length > 0 && (
                                <div className="space-y-2">
                                    {representativePosts.map((post, index) => (
                                        <a
                                            key={`${idea.id}-mobile-post-${index}`}
                                            href={post.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block rounded-2xl border border-white/8 bg-black/20 p-3"
                                        >
                                            <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                                                {post.subreddit ? `r/${decodeHtml(post.subreddit)}` : formatSourceName(post.source)}
                                            </div>
                                            <p className="mt-2 text-sm leading-6 text-white">{decodeHtml(post.title)}</p>
                                            <div className="mt-2 text-[11px] text-muted-foreground">
                                                {post.score} upvotes - {post.comments || 0} comments
                                            </div>
                                        </a>
                                    ))}
                                </div>
                            )}

                            {showFullAnalysis && (sourceSummary || marketLeadersSummary) && (
                                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                                    <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Proof audit</div>
                                    {sourceSummary && (
                                        <p className="mt-2 text-xs leading-6 text-slate-200">Source mix: {sourceSummary}</p>
                                    )}
                                    {marketLeadersSummary && (
                                        <p className="mt-2 text-xs leading-6 text-muted-foreground">{marketLeadersSummary}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

function StatCard({ label, value, icon: Icon, color, subtitle }: {
    label: string; value: string | number; icon: LucideIcon; color: string; subtitle?: string;
}) {
    return (
        <motion.div
            className="surface-panel-soft"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ padding: 16, borderRadius: 14, minWidth: 154 }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                    {label}
                </span>
                <div style={{
                    width: 32, height: 32, borderRadius: 10,
                    background: `${color}15`, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    border: `1px solid ${color}30`,
                }}>
                    <Icon style={{ width: 15, height: 15, color }} />
                </div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#f8fafc", fontFamily: "var(--font-display)", lineHeight: 1 }}>
                {value}
            </div>
            {subtitle && (
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>{subtitle}</div>
            )}
        </motion.div>
    );
}

type IntelligenceTab = "emerging" | "themes" | "competitors";

function IntelligenceBadge({
    label,
    color,
    background,
}: {
    label: string;
    color: string;
    background: string;
}) {
    return (
        <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 8px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            color,
            background,
            border: `1px solid ${background.replace("0.12", "0.18")}`,
        }}>
            {label}
        </span>
    );
}

function IntelligencePromoteButton({
    slug,
    topic,
    category,
    suggestedLabel,
    isGuest,
}: {
    slug: string;
    topic: string;
    category: string;
    suggestedLabel?: string | null;
    isGuest: boolean;
}) {
    const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [message, setMessage] = useState("");

    const handlePromote = async () => {
        if (state === "saving" || state === "saved") return;
        if (isGuest) {
            if (typeof window !== "undefined") {
                window.location.href = BETA_AUTH_HREF;
                return;
            }
            setState("error");
            setMessage("Join the beta to save this idea to the radar.");
            return;
        }

        let label = cleanText(suggestedLabel || "");
        if (!label && typeof window !== "undefined") {
            const entered = window.prompt("Shape the radar title before saving this idea.", topic);
            label = cleanText(entered || "");
            if (!label) return;
        }

        setState("saving");
        setMessage("");
        try {
            await promoteIdeaToBoard({
                primary_idea_slug: slug,
                label,
                category,
            });
            setState("saved");
            setMessage("Saved to Opportunities.");
        } catch (error) {
            setState("error");
            setMessage(error instanceof Error ? error.message : "Could not save this idea to the radar.");
        }
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
                onClick={handlePromote}
                style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: state === "saved"
                        ? "1px solid rgba(34,197,94,0.2)"
                        : "1px solid rgba(59,130,246,0.18)",
                    background: state === "saved"
                        ? "rgba(34,197,94,0.12)"
                        : "rgba(59,130,246,0.12)",
                    color: "#f8fafc",
                    cursor: state === "saving" ? "wait" : "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                }}
            >
                {state === "saved" ? "Saved to radar" : state === "saving" ? "Promoting..." : isGuest ? "Join beta to save" : "Promote to radar"}
            </button>
            {message && (
                <div style={{ fontSize: 10, color: state === "error" ? "#fca5a5" : "#bfdbfe", lineHeight: 1.5 }}>
                    {message}
                </div>
            )}
        </div>
    );
}

function EmergingWedgeTile({ card, isGuest }: { card: EmergingWedgeCard; isGuest: boolean }) {
    const suggestedLabel = cleanText(card.suggested_wedge_label || "");
    const readinessColor = card.promotion_readiness === "ready"
        ? "#86efac"
        : card.promotion_readiness === "needs_wedge"
            ? "#93c5fd"
            : "#fbbf24";
    const readinessBg = card.promotion_readiness === "ready"
        ? "rgba(34,197,94,0.12)"
        : card.promotion_readiness === "needs_wedge"
            ? "rgba(59,130,246,0.12)"
            : "rgba(245,158,11,0.12)";

    return (
        <div className="glass-card" style={{ padding: 18, borderRadius: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#93c5fd" }}>
                        Core pain observed
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>{card.topic}</span>
                        <span style={{
                            fontSize: 10,
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: "rgba(249,115,22,0.1)",
                            color: "#f97316",
                            fontWeight: 700,
                            textTransform: "uppercase",
                        }}>
                            {card.category}
                        </span>
                        <IntelligenceBadge label={getReadinessLabel(card.promotion_readiness)} color={readinessColor} background={readinessBg} />
                        {card.validation_bias === "positive" && (
                            <IntelligenceBadge label="Validation tailwind" color="#86efac" background="rgba(34,197,94,0.12)" />
                        )}
                        {card.validation_bias === "caution" && (
                            <IntelligenceBadge label="Validation caution" color="#fca5a5" background="rgba(239,68,68,0.12)" />
                        )}
                    </div>
                    {suggestedLabel && (
                        <div style={{ fontSize: 12, color: "#bfdbfe", lineHeight: 1.55 }}>
                            Suggested wedge to test: {suggestedLabel}
                        </div>
                    )}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-mono)", color: "#f97316" }}>
                    {card.current_score.toFixed(0)}
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
                <DetailMetric label="Sources" value={card.source_count} accent={card.source_count > 1 ? "#93c5fd" : "#fbbf24"} />
                <DetailMetric label="Posts" value={card.post_count_total} accent="#e2e8f0" />
                <DetailMetric label="7d Posts" value={card.post_count_7d} accent="#c4b5fd" />
                <DetailMetric label="Freshness" value={formatFreshnessHours(card.freshness_hours)} accent="#86efac" />
            </div>

            <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.65 }}>
                {summarizeReasonForUser(card.why_it_matters_now, `${card.topic} is moving enough to review closely.`)}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                Missing proof: {summarizeReasonForUser(card.missing_proof, "It still needs stronger buyer proof.")}
            </div>
            {card.validation_note && (
                <div style={{ fontSize: 11, color: card.validation_bias === "caution" ? "#fca5a5" : "#86efac", lineHeight: 1.55 }}>
                    {card.validation_note}
                </div>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <Link
                    href={buildIdeaHref(card.slug)}
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.03)",
                        color: "#e2e8f0",
                        textDecoration: "none",
                        fontSize: 12,
                        fontWeight: 700,
                    }}
                >
                    <ExternalLink style={{ width: 13, height: 13 }} />
                    Open idea
                </Link>
                <IntelligencePromoteButton
                    slug={card.slug}
                    topic={card.topic}
                    category={card.category}
                    suggestedLabel={card.suggested_wedge_label}
                    isGuest={isGuest}
                />
            </div>
        </div>
    );
}

function ThemeToShapeTile({ card, isGuest }: { card: ThemeToShapeCard; isGuest: boolean }) {
    const suggestionIsGrounded = card.recommended_shape_mode === "suggested_wedge" || card.recommended_shape_mode === "direct_buyer_language";
    return (
        <div className="glass-card" style={{ padding: 18, borderRadius: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#93c5fd" }}>
                        Core pain observed
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>{card.topic}</span>
                        <span style={{
                            fontSize: 10,
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: "rgba(59,130,246,0.12)",
                            color: "#93c5fd",
                            fontWeight: 700,
                        }}>
                            Needs focus
                        </span>
                        <span style={{
                            fontSize: 10,
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: "rgba(249,115,22,0.1)",
                            color: "#f97316",
                            fontWeight: 700,
                            textTransform: "uppercase",
                        }}>
                            {card.category}
                        </span>
                    </div>
                    {card.suggested_wedge_label && (
                        <div style={{ fontSize: 12, color: "#bfdbfe", lineHeight: 1.55 }}>
                            Suggested wedge to test: {card.suggested_wedge_label}
                        </div>
                    )}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "var(--font-mono)", color: "#3b82f6" }}>
                    {card.current_score.toFixed(0)}
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
                <DetailMetric label="Sources" value={card.source_count} accent={card.source_count > 1 ? "#93c5fd" : "#fbbf24"} />
                <DetailMetric label="Posts" value={card.post_count_total} accent="#e2e8f0" />
                <DetailMetric label="Direct" value={card.direct_buyer_count} accent={card.direct_buyer_count > 0 ? "#4ade80" : "#94a3b8"} />
                <DetailMetric label="Support" value={card.supporting_signal_count} accent={card.supporting_signal_count > 0 ? "#93c5fd" : "#94a3b8"} />
            </div>

            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                Observed pattern: {summarizeReasonForUser(card.observed_pattern, `${card.topic} is repeating, but the wedge is still broad.`)}
            </div>

            <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.6 }}>
                {card.suggested_wedge_label ? "Suggested wedge to test" : "Next focus"}:{" "}
                {summarizeReasonForUser(card.recommended_shape_direction, `${card.topic} needs a more focused angle before it becomes a stronger bet.`)}
            </div>

            <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.55 }}>
                Observed counts come from live market posts. The wedge line is a suggestion, not a validated product yet.
            </div>

            {!suggestionIsGrounded && (
                <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.55 }}>
                    This direction is still heuristic. It is based on repeated signals, not a validated wedge yet.
                </div>
            )}

            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                Still missing: {summarizeReasonForUser(card.missing_proof, "It still needs stronger buyer proof.")}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <Link
                    href={buildIdeaHref(card.slug)}
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.03)",
                        color: "#e2e8f0",
                        textDecoration: "none",
                        fontSize: 12,
                        fontWeight: 700,
                    }}
                >
                    <ExternalLink style={{ width: 13, height: 13 }} />
                    Open idea
                </Link>
                <IntelligencePromoteButton
                    slug={card.slug}
                    topic={card.topic}
                    category={card.category}
                    suggestedLabel={card.suggested_wedge_label}
                    isGuest={isGuest}
                />
            </div>
        </div>
    );
}

function CompetitorPressureTile({ card }: { card: CompetitorPressureCard }) {
    const confidenceColor = card.confidence.level === "HIGH"
        ? "#86efac"
        : card.confidence.level === "MEDIUM"
            ? "#93c5fd"
            : "#fbbf24";
    const confidenceBg = card.confidence.level === "HIGH"
        ? "rgba(34,197,94,0.12)"
        : card.confidence.level === "MEDIUM"
            ? "rgba(59,130,246,0.12)"
            : "rgba(245,158,11,0.12)";

    return (
        <div className="glass-card" style={{ padding: 18, borderRadius: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#fca5a5" }}>
                        Observed weakness
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>{card.competitor}</span>
                        <span style={{
                            fontSize: 10,
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: "rgba(239,68,68,0.12)",
                            color: "#fca5a5",
                            fontWeight: 700,
                        }}>
                            {card.weakness_category}
                        </span>
                        <IntelligenceBadge label={card.confidence.label} color={confidenceColor} background={confidenceBg} />
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                        Observed weakness: {card.summary}
                    </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "var(--font-mono)", color: "#ef4444" }}>
                    {card.complaint_count}
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
                <DetailMetric label="Complaints" value={card.complaint_count} accent="#fca5a5" />
                <DetailMetric label="Sources" value={card.source_count} accent={card.source_count > 1 ? "#93c5fd" : "#94a3b8"} />
                <DetailMetric label="Direct" value={card.direct_evidence_count} accent={card.direct_evidence_count > 0 ? "#4ade80" : "#94a3b8"} />
            </div>

            {card.affected_segment && (
                <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                    Most affected: {card.affected_segment}
                </div>
            )}

            <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.6 }}>
                Why this matters now: {card.why_now}
            </div>

            <div style={{ fontSize: 12, color: "#fca5a5", lineHeight: 1.6 }}>
                Suggested wedge to test: {card.recommended_angle}
            </div>

            <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.55 }}>
                {card.inference_note}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>
                    Latest update: {card.latest_seen_at ? new Date(card.latest_seen_at).toLocaleString() : "Unknown"} · {card.freshness_label}
                </span>
                <Link
                    href="/dashboard/competitors"
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.03)",
                        color: "#e2e8f0",
                        textDecoration: "none",
                        fontSize: 12,
                        fontWeight: 700,
                    }}
                >
                    <ExternalLink style={{ width: 13, height: 13 }} />
                    Open radar
                </Link>
            </div>
        </div>
    );
}

function MarketIntelligenceSection({
    intelligence,
    loading,
    tab,
    onTabChange,
    isGuest,
}: {
    intelligence: MarketIntelligencePayload | null;
    loading: boolean;
    tab: IntelligenceTab;
    onTabChange: (tab: IntelligenceTab) => void;
    isGuest: boolean;
}) {
    const tabs: Array<{ key: IntelligenceTab; label: string; icon: LucideIcon; color: string }> = [
        { key: "emerging", label: "Emerging", icon: Target, color: "#f97316" },
        { key: "themes", label: "Refine", icon: Lightbulb, color: "#3b82f6" },
        { key: "competitors", label: "Competitors", icon: ShieldAlert, color: "#ef4444" },
    ];
    const tabDescriptions: Record<IntelligenceTab, string> = {
        emerging: "Fresh wedges with enough real signal to watch now.",
        themes: "Broad themes from the live feed. Observed counts are real. The wedge line is a suggestion, not a verdict.",
        competitors: "Real complaint clusters around incumbents. Observed weakness is grounded in complaints. The wedge line is inferred.",
    };
    const allRowCount =
        (intelligence?.emerging_wedges?.length || 0) +
        (intelligence?.themes_to_shape?.length || 0) +
        (intelligence?.competitor_pressure?.length || 0);
    const showTabs = allRowCount > 0;

    const currentRows = tab === "emerging"
        ? intelligence?.emerging_wedges || []
        : tab === "themes"
            ? intelligence?.themes_to_shape || []
            : intelligence?.competitor_pressure || [];

    return (
        <div style={{ marginBottom: currentRows.length > 0 ? 20 : 14 }}>
            <div
                className="surface-panel"
                style={{
                    padding: "10px 12px",
                    borderRadius: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 8,
                    flexWrap: "wrap",
                }}
            >
                {tabs.map((entry) => {
                    const Icon = entry.icon;
                    return (
                        <button
                            key={entry.key}
                            onClick={() => onTabChange(entry.key)}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "8px 12px",
                                borderRadius: 999,
                                border: tab === entry.key ? `1px solid ${entry.color}33` : "1px solid rgba(255,255,255,0.08)",
                                background: tab === entry.key ? `${entry.color}18` : "rgba(255,255,255,0.03)",
                                color: tab === entry.key ? entry.color : "#94a3b8",
                                cursor: "pointer",
                                fontSize: 11.5,
                                fontWeight: 700,
                            }}
                        >
                            <Icon style={{ width: 13, height: 13 }} />
                            {entry.label}
                        </button>
                    );
                })}
            </div>

            {!loading && showTabs ? (
                <div style={{ marginTop: 10, fontSize: 11.5, color: "#94a3b8", lineHeight: 1.6 }}>
                    {tabDescriptions[tab]}
                </div>
            ) : null}

            {!loading && currentRows.length > 0 ? (
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                    {tab === "emerging" && (currentRows as EmergingWedgeCard[]).map((card) => (
                        <EmergingWedgeTile key={card.slug} card={card} isGuest={isGuest} />
                    ))}
                    {tab === "themes" && (currentRows as ThemeToShapeCard[]).map((card) => (
                        <ThemeToShapeTile key={card.slug} card={card} isGuest={isGuest} />
                    ))}
                    {tab === "competitors" && (currentRows as CompetitorPressureCard[]).map((card) => (
                        <CompetitorPressureTile key={`${card.competitor}-${card.weakness_category}`} card={card} />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export default function StockMarketDashboard({
    initialIdeas,
    initialMarketIntelligence,
    initialTrendCounts,
}: {
    initialIdeas?: Idea[];
    initialMarketIntelligence?: MarketIntelligencePayload | null;
    initialTrendCounts?: { rising: number; falling: number };
} = {}) {
    const { isGuest } = useDashboardViewer();
    const hasInitialIdeas = Array.isArray(initialIdeas);
    const hasInitialIntelligence = initialMarketIntelligence !== undefined;
    const [ideas, setIdeas] = useState<Idea[]>(initialIdeas || []);
    const [marketIntelligence, setMarketIntelligence] = useState<MarketIntelligencePayload | null>(initialMarketIntelligence ?? null);
    const [intelligenceLoading, setIntelligenceLoading] = useState(!hasInitialIntelligence);
    const [intelligenceTab, setIntelligenceTab] = useState<IntelligenceTab>("emerging");
    const [tab, setTab] = useState<TabType>("top");
    const [category, setCategory] = useState("");
    const [showEarlySignals, setShowEarlySignals] = useState(false);
    const [loading, setLoading] = useState(!hasInitialIdeas);
    const [lastUpdated, setLastUpdated] = useState("");
    const [scanning, setScanning] = useState(false);
    const [scanStatus, setScanStatus] = useState<ScanStatusSnapshot | null>(null);
    const [scanError, setScanError] = useState("");
    const [trendCounts, setTrendCounts] = useState(initialTrendCounts || { rising: 0, falling: 0 });
    const isDocumentVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

    const fetchIdeas = useCallback(async () => {
        setLoading(true);
        try {
            const sortMap: Record<TabType, string> = {
                top: "score", trending: "trending", dying: "dying", new: "new",
            };
            const exploratoryParam = showEarlySignals ? "&include_exploratory=1" : "";
            const res = await fetch(`/api/market?sort=${sortMap[tab]}&category=${category}&limit=120${exploratoryParam}`);
            const data = await res.json();
            setIdeas(data.ideas || []);
        } catch {
            console.error("Failed to fetch ideas");
        } finally {
            setLoading(false);
        }
    }, [tab, category, showEarlySignals]);

    const fetchMarketIntelligence = useCallback(async () => {
        setIntelligenceLoading(true);
        try {
            const categoryParam = category ? `?category=${encodeURIComponent(category)}` : "";
            const res = await fetch(`/api/market/intelligence${categoryParam}`);
            if (!res.ok) {
                throw new Error("Failed to fetch market intelligence");
            }
            const data = await res.json();
            setMarketIntelligence(data);
        } catch {
            console.error("Failed to fetch market intelligence");
        } finally {
            setIntelligenceLoading(false);
        }
    }, [category]);

    const fetchTrendCounts = useCallback(async () => {
        try {
            const exploratoryParam = showEarlySignals ? "&include_exploratory=1" : "";
            const [risingRes, fallingRes] = await Promise.all([
                fetch(`/api/market?sort=trending&category=${category}&limit=200${exploratoryParam}`),
                fetch(`/api/market?sort=dying&category=${category}&limit=200${exploratoryParam}`),
            ]);

            const [risingData, fallingData] = await Promise.all([
                risingRes.ok ? risingRes.json() : Promise.resolve({ ideas: [] }),
                fallingRes.ok ? fallingRes.json() : Promise.resolve({ ideas: [] }),
            ]);

            const risingIdeas = Array.isArray(risingData.ideas) ? risingData.ideas : [];
            const fallingIdeas = Array.isArray(fallingData.ideas) ? fallingData.ideas : [];

            setTrendCounts({
                rising: risingIdeas.length,
                falling: fallingIdeas.length,
            });
        } catch {
            console.error("Failed to fetch trend counts");
        }
    }, [category, showEarlySignals]);

    const fetchScanStatus = useCallback(async () => {
        if (!isDocumentVisible()) return;
        try {
            const res = await fetch("/api/discover");
            if (res.ok) {
                const data = await res.json();
                setScanStatus(data);
                setLastUpdated(formatRelativeTimestamp(data.lastObservedAt));
                // If a scan is running, keep polling
                if (data.latestRun?.status === "running") {
                    setScanning(true);
                } else if (scanning) {
                    // Scan just finished — refresh ideas
                    setScanning(false);
                    fetchIdeas();
                    fetchTrendCounts();
                    fetchMarketIntelligence();
                }
            }
        } catch { /* silent */ }
    }, [scanning, fetchIdeas, fetchTrendCounts, fetchMarketIntelligence]);

    const launchScan = async () => {
        if (scanning) return;
        if (isGuest) {
            if (typeof window !== "undefined") {
                window.location.href = BETA_AUTH_HREF;
            }
            return;
        }
        setScanning(true);
        setScanError("");
        try {
            const res = await fetch("/api/discover", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!res.ok) {
                setScanError(data.error || "Failed to start scan");
                setScanning(false);
                return;
            }
        } catch {
            setScanError("Failed to start scan");
            setScanning(false);
        }
    };

    useEffect(() => {
        fetchIdeas();
        fetchTrendCounts();
        fetchMarketIntelligence();
        if (isDocumentVisible()) {
            fetchScanStatus();
        }
        const interval = setInterval(() => {
            void fetchIdeas();
            void fetchMarketIntelligence();
        }, 60000);
        return () => clearInterval(interval);
    }, [fetchIdeas, fetchScanStatus, fetchTrendCounts, fetchMarketIntelligence]);

    // Poll scan status while scanning
    useEffect(() => {
        if (!scanning) return;
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                void fetchScanStatus();
            }
        };

        document.addEventListener("visibilitychange", onVisibilityChange);
        const poll = setInterval(() => {
            if (!isDocumentVisible()) return;
            void fetchScanStatus();
        }, 60000);

        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
            clearInterval(poll);
        };
    }, [scanning, fetchScanStatus]);

    const filteredIdeas = useMemo(() => ideas, [ideas]);

    const visibleIdeas = filteredIdeas;
    const liveIdeaCount = Math.max(scanStatus?.ideaCount || 0, visibleIdeas.length);
    const postsInFeed = visibleIdeas.reduce((a, b) => a + b.post_count_total, 0);
    const rawPostsAnalyzed = Math.max(scanStatus?.archivePostCount || 0, scanStatus?.trackedPostCount || 0, postsInFeed);
    const newIdeaCount = marketIntelligence?.summary.new_72h_count || 0;
    const executionMode = scanStatus?.executionMode || "local";
    const usingExternalWorker = executionMode === "external";
    const candidateOpportunityCount = Math.max(
        scanStatus?.funnel?.candidateOpportunities || 0,
        scanStatus?.archiveIdeaCount || 0,
    );
    const evidenceAttachedCount = Math.max(
        scanStatus?.funnel?.evidenceAttached || 0,
        scanStatus?.evidenceAttachedCount || 0,
    );
    const freshnessHours = scanStatus?.lastObservedAt
        ? Math.max(0, (Date.now() - new Date(scanStatus.lastObservedAt).getTime()) / 3_600_000)
        : null;
    const staleData = freshnessHours != null && Number.isFinite(freshnessHours) && freshnessHours >= 24;

    return (
        <div style={{ padding: "12px 18px", maxWidth: 1200, margin: "0 auto" }}>
            {/* Header */}
            <div className="surface-panel" style={{ padding: 18, borderRadius: 18, marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 18, flexWrap: "wrap" }}>
                    <div style={{ maxWidth: 620 }}>
                        <div className="section-kicker" style={{ marginBottom: 10 }}>Opportunity radar</div>
                        <h1 style={{
                            fontSize: 26, fontWeight: 650, color: "#f8fafc",
                            fontFamily: "\"Space Grotesk\", var(--font-display)", marginBottom: 7, letterSpacing: "-0.04em", lineHeight: 0.98,
                        }}>
                            See live opportunities.
                        </h1>
                        <p style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.65, maxWidth: 560 }}>
                            Repeated pain, narrowed into wedges you can test.
                        </p>
                        {lastUpdated && (
                            <div style={{ marginTop: 10, fontSize: 10.5, color: "#64748b", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    <Clock style={{ width: 11, height: 11 }} />
                                    Last market run {lastUpdated}
                                </span>
                                {staleData ? (
                                    <span style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 5,
                                        padding: "3px 8px",
                                        borderRadius: 999,
                                        background: "rgba(245,158,11,0.12)",
                                        border: "1px solid rgba(245,158,11,0.18)",
                                        color: "#fbbf24",
                                        fontSize: 10,
                                        fontWeight: 700,
                                        letterSpacing: "0.04em",
                                        textTransform: "uppercase",
                                    }}>
                                        Needs refresh
                                    </span>
                                ) : null}
                            </div>
                        )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
                        <motion.button
                            onClick={launchScan}
                            disabled={scanning || usingExternalWorker}
                            whileHover={scanning || usingExternalWorker ? {} : { scale: 1.02 }}
                            whileTap={scanning || usingExternalWorker ? {} : { scale: 0.98 }}
                            className="pulse-button"
                            style={{
                                border: usingExternalWorker
                                    ? "1px solid rgba(148,163,184,0.24)"
                                    : undefined,
                                background: usingExternalWorker
                                    ? "rgba(148,163,184,0.08)"
                                    : scanning
                                        ? "rgba(249,115,22,0.12)"
                                        : undefined,
                                color: usingExternalWorker ? "#cbd5e1" : undefined,
                                cursor: scanning ? "wait" : usingExternalWorker ? "not-allowed" : "pointer",
                                opacity: scanning || usingExternalWorker ? 0.95 : 1,
                            }}
                        >
                            {usingExternalWorker ? (
                                <>
                                    <ShieldAlert style={{ width: 15, height: 15 }} />
                                    Auto updates
                                </>
                            ) : scanning ? (
                                <>
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                    >
                                        <Activity style={{ width: 15, height: 15 }} />
                                    </motion.div>
                                    Scanning...
                                </>
                            ) : isGuest ? (
                                <>
                                    <Zap style={{ width: 15, height: 15 }} />
                                    Join beta to scan
                                </>
                            ) : (
                                <>
                                    <Zap style={{ width: 15, height: 15 }} />
                                    Refresh
                                </>
                            )}
                        </motion.button>
                    </div>
                </div>
            </div>

            {isGuest && (
                <div style={{
                    padding: "12px 18px",
                    borderRadius: 10,
                    marginBottom: 16,
                    background: "rgba(249,115,22,0.08)",
                    border: "1px solid rgba(249,115,22,0.18)",
                    color: "#fed7aa",
                    fontSize: 12,
                    lineHeight: 1.6,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    alignItems: "center",
                    justifyContent: "space-between",
                }}>
                    <span>
                        Browse now. Join with Google to validate or save.
                    </span>
                    <Link
                        href={BETA_AUTH_HREF}
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "8px 12px",
                            borderRadius: 10,
                            textDecoration: "none",
                            background: "rgba(249,115,22,0.16)",
                            border: "1px solid rgba(249,115,22,0.24)",
                            color: "#fb923c",
                            fontSize: 12,
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                        }}
                    >
                        Join beta with Google
                    </Link>
                </div>
            )}

            {/* Scanning Progress Banner */}
            <AnimatePresence>
                {scanning && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{
                            padding: "12px 18px", borderRadius: 10, marginBottom: 16,
                            background: "linear-gradient(135deg, rgba(249,115,22,0.08), rgba(234,88,12,0.04))",
                            border: "1px solid rgba(249,115,22,0.15)",
                            display: "flex", alignItems: "center", gap: 12,
                        }}
                    >
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        >
                            <Activity style={{ width: 16, height: 16, color: "#f97316" }} />
                        </motion.div>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#f97316" }}>
                                Refreshing sources...
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                                {usingExternalWorker
                                    ? "Updates run automatically."
                                    : "This usually takes a few minutes."}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {scanError && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{
                            padding: "12px 18px", borderRadius: 10, marginBottom: 16,
                            background: "rgba(239,68,68,0.08)",
                            border: "1px solid rgba(239,68,68,0.18)",
                            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                        }}
                    >
                        <div style={{ fontSize: 13, color: "#fca5a5", fontWeight: 600 }}>
                            {scanError}
                        </div>
                        <button
                            onClick={() => setScanError("")}
                            style={{
                                padding: "6px 10px",
                                borderRadius: 8,
                                border: "1px solid rgba(255,255,255,0.12)",
                                background: "rgba(255,255,255,0.04)",
                                color: "#e2e8f0",
                                cursor: "pointer",
                                fontSize: 11,
                                fontWeight: 600,
                            }}
                        >
                            Dismiss
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <MarketIntelligenceSection
                intelligence={marketIntelligence}
                loading={intelligenceLoading}
                tab={intelligenceTab}
                onTabChange={setIntelligenceTab}
                isGuest={isGuest}
            />

            {/* Stats Row */}
            <div className="mb-5 -mx-1 flex gap-3 overflow-x-auto px-1 lg:hidden">
                <div className="min-w-[180px]"><StatCard label="Live now" value={liveIdeaCount} icon={Eye} color="#f97316" subtitle="visible ideas" /></div>
                <div className="min-w-[180px]"><StatCard label="Rising" value={trendCounts.rising} icon={TrendingUp} color="#22c55e" subtitle="up this cycle" /></div>
                <div className="min-w-[180px]"><StatCard label="New" value={newIdeaCount} icon={Sparkles} color="#fbbf24" subtitle="last 72h" /></div>
                <div className="min-w-[180px]"><StatCard label="Signals" value={rawPostsAnalyzed.toLocaleString()} icon={BarChart3} color="#8b5cf6" subtitle="posts scanned" /></div>
            </div>
            <div className="hidden lg:grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
                <StatCard label="Live now" value={liveIdeaCount} icon={Eye} color="#f97316" subtitle="visible ideas" />
                <StatCard label="Rising" value={trendCounts.rising} icon={TrendingUp} color="#22c55e" subtitle="up this cycle" />
                <StatCard label="New" value={newIdeaCount} icon={Sparkles} color="#fbbf24" subtitle="last 72h" />
                <StatCard label="Signals" value={rawPostsAnalyzed.toLocaleString()} icon={BarChart3} color="#8b5cf6" subtitle="posts scanned" />
            </div>

            <div
                className="surface-panel"
                style={{
                    padding: "14px 16px",
                    borderRadius: 16,
                    marginBottom: 18,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                        <div className="section-kicker" style={{ marginBottom: 6 }}>Discovery funnel</div>
                        <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.6, maxWidth: 720 }}>
                            CueIdea filters raw posts into candidate opportunities, then only keeps the strongest ideas with enough attached evidence to show on the board.
                        </div>
                    </div>
                    {scanStatus?.lastObservedAt ? (
                        <div style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>
                            Source run: {lastUpdated || "Unknown"}
                        </div>
                    ) : null}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                    {[
                        {
                            label: "Raw posts analyzed",
                            value: rawPostsAnalyzed.toLocaleString(),
                            tone: "#8b5cf6",
                        },
                        {
                            label: "Candidate opportunities",
                            value: candidateOpportunityCount.toLocaleString(),
                            tone: "#3b82f6",
                        },
                        {
                            label: "Visible on board",
                            value: liveIdeaCount.toLocaleString(),
                            tone: "#f97316",
                        },
                        {
                            label: "Evidence attached",
                            value: evidenceAttachedCount.toLocaleString(),
                            tone: "#22c55e",
                        },
                    ].map((item) => (
                        <div
                            key={item.label}
                            style={{
                                borderRadius: 14,
                                padding: "12px 14px",
                                border: "1px solid rgba(255,255,255,0.08)",
                                background: "rgba(255,255,255,0.03)",
                                minHeight: 86,
                            }}
                        >
                            <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, color: "#64748b", marginBottom: 10 }}>
                                {item.label}
                            </div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: "#f8fafc", lineHeight: 1 }}>
                                {item.value}
                            </div>
                            <div style={{ marginTop: 10, height: 3, borderRadius: 999, background: `${item.tone}22`, overflow: "hidden" }}>
                                <div style={{ width: "100%", height: "100%", background: item.tone, opacity: 0.7 }} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Tabs + Category Filter */}
            <div
                className="mb-4 flex flex-col gap-3 rounded-2xl border p-[10px_12px] lg:flex-row lg:items-center lg:justify-between"
                style={{
                    background: "rgba(255,255,255,0.03)",
                    borderColor: "rgba(255,255,255,0.08)",
                }}
            >
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 lg:mx-0 lg:flex-wrap lg:overflow-visible">
                    {TABS.map((t) => {
                        const Icon = t.icon;
                        return (
                            <button
                                key={t.key}
                                onClick={() => setTab(t.key)}
                                style={{
                                    display: "flex", alignItems: "center", gap: 6,
                                    padding: "8px 14px", borderRadius: 999, border: tab === t.key ? `1px solid ${t.color}33` : "1px solid rgba(255,255,255,0.06)",
                                    background: tab === t.key ? `${t.color}20` : "transparent",
                                    color: tab === t.key ? t.color : "#64748b",
                                    cursor: "pointer", fontSize: 12, fontWeight: 600,
                                    transition: "all 0.2s ease",
                                }}
                            >
                                <Icon style={{ width: 14, height: 14 }} />
                                {t.label}
                            </button>
                        );
                    })}
                </div>

                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 lg:mx-0 lg:flex-wrap lg:overflow-visible">
                    {CATEGORIES.map((c) => (
                        <button
                            key={c.key}
                            onClick={() => setCategory(c.key)}
                            style={{
                                padding: "5px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.06)",
                                background: category === c.key ? "rgba(249,115,22,0.15)" : "transparent",
                                color: category === c.key ? "#f97316" : "#475569",
                                cursor: "pointer", fontSize: 10, fontWeight: 500,
                                transition: "all 0.2s ease",
                            }}
                        >
                            {c.label}
                        </button>
                    ))}
                    <button
                        onClick={() => setShowEarlySignals((value) => !value)}
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 11px",
                            borderRadius: 999,
                            border: `1px solid ${showEarlySignals ? "rgba(245,158,11,0.22)" : "rgba(255,255,255,0.08)"}`,
                            background: showEarlySignals ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.02)",
                            color: showEarlySignals ? "#fbbf24" : "#94a3b8",
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 600,
                            transition: "all 0.2s ease",
                        }}
                        title={showEarlySignals ? "Hide early opportunities" : "Show early opportunities too"}
                    >
                        <AlertTriangle style={{ width: 11, height: 11 }} />
                        {showEarlySignals ? "Hide early ideas" : "Show early ideas"}
                    </button>
                </div>
            </div>

            <div style={{ marginTop: -8, marginBottom: 14, fontSize: 11.5, color: "#94a3b8", lineHeight: 1.6 }}>
                {TAB_EXPLANATIONS[tab]}
            </div>

            <div className="lg:hidden">
                {loading && visibleIdeas.length === 0 ? (
                    <div style={{
                        padding: 40, textAlign: "center", color: "#475569",
                        fontSize: 14,
                    }}>
                        <Activity style={{ width: 24, height: 24, margin: "0 auto 12px", opacity: 0.5 }} />
                        Loading ideas...
                    </div>
                ) : visibleIdeas.length === 0 ? (
                    <div style={{
                        padding: 40, textAlign: "center", color: "#475569",
                        fontSize: 14,
                    }}>
                        {ideas.length === 0 ? (
                            <>
                                <Zap style={{ width: 24, height: 24, margin: "0 auto 12px", opacity: 0.5 }} />
                                <div style={{ marginBottom: 12 }}>No ideas found yet.</div>
                                <motion.button
                                    onClick={launchScan}
                                    disabled={scanning}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    style={{
                                        padding: "10px 24px", borderRadius: 8,
                                        border: "1px solid rgba(249,115,22,0.3)",
                                        background: "linear-gradient(135deg, rgba(249,115,22,0.2), rgba(234,88,12,0.1))",
                                        color: "#fb923c", cursor: "pointer",
                                        fontSize: 14, fontWeight: 600,
                                    }}
                                    >
                                        <Zap style={{ width: 14, height: 14, display: "inline", marginRight: 6, verticalAlign: "middle" }} />
                                    {scanning ? "Scanning..." : isGuest ? "Join beta to run first scan" : "Launch First Scan"}
                                </motion.button>
                                <div style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>
                                    {isGuest
                                        ? "Guest beta is read-only. Join with Google to unlock personal workflows."
                                        : "Scans Reddit, HN, ProductHunt & IndieHackers for opportunities"}
                                </div>
                            </>
                        ) : (
                            <>
                                <Activity style={{ width: 24, height: 24, margin: "0 auto 12px", opacity: 0.5 }} />
                                <div style={{ marginBottom: 8, color: "#94a3b8", fontWeight: 600 }}>
                                    No opportunities match this filter
                                </div>
                                <div style={{ fontSize: 12, color: "#64748b", maxWidth: 420, margin: "0 auto" }}>
                                    Try another filter or show early ideas.
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {visibleIdeas.map((idea, i) => (
                            <MobileIdeaCard key={`${idea.id}-mobile`} idea={idea} rank={i + 1} isGuest={isGuest} />
                        ))}
                    </div>
                )}
            </div>

            <div className="hidden lg:block">
                {/* Table Header */}
                <div style={{
                    display: "grid", gridTemplateColumns: "40px 1.5fr 100px 100px 100px 80px 80px",
                    gap: 12, padding: "12px 18px",
                    fontSize: 10, color: "#64748b", fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.02)",
                    borderTopLeftRadius: 14,
                    borderTopRightRadius: 14,
                }}>
                    <div style={{ textAlign: "center" }}>#</div>
                    <div>Opportunity</div>
                    <div style={{ textAlign: "center" }}>Score</div>
                    <div style={{ textAlign: "center" }}>24h</div>
                    <div style={{ textAlign: "center" }}>7d</div>
                    <div style={{ textAlign: "center" }}>Volume</div>
                    <div style={{ textAlign: "center" }}>Sources</div>
                </div>

                {/* Idea Rows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                    {loading && visibleIdeas.length === 0 ? (
                        <div style={{
                            padding: 60, textAlign: "center", color: "#475569",
                            fontSize: 14,
                        }}>
                            <Activity style={{ width: 24, height: 24, margin: "0 auto 12px", opacity: 0.5 }} />
                            Loading ideas...
                        </div>
                    ) : visibleIdeas.length === 0 ? (
                        <div style={{
                            padding: 60, textAlign: "center", color: "#475569",
                            fontSize: 14,
                        }}>
                            {ideas.length === 0 ? (
                                <>
                                    <Zap style={{ width: 24, height: 24, margin: "0 auto 12px", opacity: 0.5 }} />
                                    <div style={{ marginBottom: 12 }}>No ideas found yet.</div>
                                    <motion.button
                                        onClick={launchScan}
                                        disabled={scanning}
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        style={{
                                            padding: "10px 24px", borderRadius: 8,
                                            border: "1px solid rgba(249,115,22,0.3)",
                                            background: "linear-gradient(135deg, rgba(249,115,22,0.2), rgba(234,88,12,0.1))",
                                            color: "#fb923c", cursor: "pointer",
                                            fontSize: 14, fontWeight: 600,
                                        }}
                                    >
                                        <Zap style={{ width: 14, height: 14, display: "inline", marginRight: 6, verticalAlign: "middle" }} />
                                        {scanning ? "Scanning..." : isGuest ? "Join beta to run first scan" : "Launch First Scan"}
                                    </motion.button>
                                    <div style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>
                                        {isGuest
                                            ? "Guest beta is read-only. Join with Google to unlock personal workflows."
                                            : "Scans Reddit, HN, ProductHunt & IndieHackers for opportunities"}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <Activity style={{ width: 24, height: 24, margin: "0 auto 12px", opacity: 0.5 }} />
                                    <div style={{ marginBottom: 8, color: "#94a3b8", fontWeight: 600 }}>
                                        No opportunities match this filter
                                    </div>
                                    <div style={{ fontSize: 12, color: "#64748b", maxWidth: 420, margin: "0 auto" }}>
                                        Try another filter or show early ideas.
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        <AnimatePresence>
                            {visibleIdeas.map((idea, i) => (
                                <IdeaRow key={idea.id} idea={idea} rank={i + 1} isGuest={isGuest} />
                            ))}
                        </AnimatePresence>
                    )}
                </div>
            </div>
        </div>
    );
}
