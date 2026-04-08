"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Activity, ArrowLeft, ExternalLink, Layers3, Radar, Sparkles } from "lucide-react";
import { ValidationDepthChooser } from "@/app/dashboard/components/ValidationDepthChooser";
import type { ValidationPrefill } from "@/lib/validation-entry";

type OpportunityRow = {
    id: string;
    label: string;
    category: string;
    status: "draft" | "board_ready" | "archived";
    icp_summary?: string | null;
    notes?: string | null;
    primary_idea_slug: string;
    source_idea_slugs: string[];
    board_active: boolean;
    board_stale_reason?: string | null;
    watching?: boolean;
    board_intelligence?: {
        summary_line: string;
        why_now_summary: string;
        strongest_reason: string;
        strongest_caution: string;
        invalidation_summary: string;
        invalidation_items: string[];
        recommended_action: string;
        first_step: string;
        evidence_snapshot: {
            evidence_count: number;
            direct_evidence_count: number;
            source_count: number;
            freshness_label: string;
            representative_evidence: Array<{
                id: string;
                title: string;
                snippet?: string | null;
                url?: string | null;
                platform: string;
            }>;
        };
        readiness: {
            score: number;
            posture: string;
            anti_idea_verdict: string;
        };
    } | null;
    primary_idea?: {
        slug: string;
        topic: string;
        current_score: number;
        source_count: number;
        post_count_total: number;
        suggested_wedge_label?: string | null;
        trust?: {
            label: string;
            score: number;
        };
    } | null;
};

function buildValidationPrefill(opportunity: OpportunityRow): ValidationPrefill {
    return {
        idea: opportunity.label,
        target: opportunity.icp_summary
            || (opportunity.primary_idea?.topic ? `Buyers around ${opportunity.primary_idea.topic}` : `Buyers around ${opportunity.label}`),
        pain: opportunity.board_intelligence?.why_now_summary
            || opportunity.board_intelligence?.summary_line
            || `The recurring workflow pain around ${opportunity.label} still needs deeper validation.`,
    };
}

function SectionCard({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div style={{
            padding: "14px 16px",
            borderRadius: 14,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
        }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>
                {label}
            </div>
            {children}
        </div>
    );
}

export default function OpportunitiesPage() {
    const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [migrationRequired, setMigrationRequired] = useState(false);
    const [watchBusyId, setWatchBusyId] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch("/api/opportunities", { cache: "no-store" });
                const data = await res.json();
                if (res.ok) {
                    setOpportunities(Array.isArray(data.opportunities) ? data.opportunities : []);
                    setMigrationRequired(Boolean(data.migration_required));
                }
            } finally {
                setLoading(false);
            }
        };
        void load();
    }, []);

    const liveCount = useMemo(
        () => opportunities.filter((item) => item.status === "board_ready" && item.board_active).length,
        [opportunities],
    );

    const watchedCount = useMemo(
        () => opportunities.filter((item) => item.watching).length,
        [opportunities],
    );

    const toggleWatch = async (opportunity: OpportunityRow) => {
        if (watchBusyId) return;
        setWatchBusyId(opportunity.id);
        try {
            const res = await fetch(`/api/opportunities/${opportunity.id}/watch`, {
                method: opportunity.watching ? "DELETE" : "POST",
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(String(data.error || "Could not update watch state."));
            }
            setOpportunities((current) => current.map((item) => (
                item.id === opportunity.id
                    ? { ...item, watching: Boolean(data.watching) }
                    : item
            )));
        } catch (error) {
            console.error("Failed to update opportunity watch:", error);
        } finally {
            setWatchBusyId(null);
        }
    };

    return (
        <div style={{ padding: "24px 32px", maxWidth: 1380, margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 24 }}>
                <div>
                    <Link href="/dashboard" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", color: "#94a3b8", fontSize: 12, fontWeight: 600 }}>
                        <ArrowLeft style={{ width: 14, height: 14 }} />
                        Back to Radar
                    </Link>
                    <h1 style={{ fontSize: 24, fontWeight: 800, color: "#f1f5f9", marginTop: 12, marginBottom: 4, letterSpacing: "-0.02em" }}>
                        Opportunity Radar
                    </h1>
                    <p style={{ fontSize: 13, color: "#64748b", maxWidth: 760, lineHeight: 1.6 }}>
                        Saved opportunities live here as the tighter shortlist worth revisiting, validating, and tracking.
                    </p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(160px, 1fr))", gap: 12, minWidth: 360 }}>
                    <div style={{
                        padding: "14px 16px",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                    }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", marginBottom: 8 }}>
                            Active radar
                        </div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", fontFamily: "var(--font-mono)" }}>
                            {liveCount}
                        </div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                            radar-ready and still active
                        </div>
                    </div>
                    <div style={{
                        padding: "14px 16px",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                    }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", marginBottom: 8 }}>
                            Watching
                        </div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", fontFamily: "var(--font-mono)" }}>
                            {watchedCount}
                        </div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                            live opportunity monitors enabled
                        </div>
                    </div>
                </div>
            </div>

            {migrationRequired && (
                <div style={{
                    marginBottom: 18,
                    padding: "12px 16px",
                    borderRadius: 10,
                    background: "rgba(245,158,11,0.08)",
                    border: "1px solid rgba(245,158,11,0.18)",
                    color: "#fde68a",
                    fontSize: 12,
                    lineHeight: 1.55,
                }}>
                    The Opportunities table is not available yet. Run migration <code>022_opportunities_board.sql</code> to enable promotion.
                </div>
            )}

            {loading ? (
                <div style={{
                    padding: 56,
                    borderRadius: 16,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    color: "#94a3b8",
                    textAlign: "center",
                }}>
                    <Activity style={{ width: 22, height: 22, margin: "0 auto 12px", opacity: 0.6 }} />
                    Loading opportunity radar...
                </div>
            ) : opportunities.length === 0 ? (
                <div style={{
                    padding: 56,
                    borderRadius: 16,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    color: "#94a3b8",
                    textAlign: "center",
                }}>
                    <Sparkles style={{ width: 22, height: 22, margin: "0 auto 12px", opacity: 0.6 }} />
                    <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>No promoted opportunities yet</div>
                    <div style={{ fontSize: 12, maxWidth: 460, margin: "0 auto 14px", lineHeight: 1.6 }}>
                        Save the strongest ideas from the live radar when you want a tighter angle, a saved label, and a shortlist of real bets.
                    </div>
                    <Link href="/dashboard" style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "10px 14px",
                        borderRadius: 10,
                        textDecoration: "none",
                        background: "rgba(59,130,246,0.12)",
                        border: "1px solid rgba(59,130,246,0.18)",
                        color: "#bfdbfe",
                        fontSize: 12,
                        fontWeight: 700,
                    }}>
                        Open Opportunity Radar
                    </Link>
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 18 }}>
                    {opportunities.map((opportunity, index) => {
                        const intelligence = opportunity.board_intelligence;
                        const validationPrefill = buildValidationPrefill(opportunity);
                        const watchPending = watchBusyId === opportunity.id;

                        return (
                            <motion.div
                                key={opportunity.id}
                                id={`opportunity-${opportunity.id}`}
                                initial={{ opacity: 0, y: 14 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.04, duration: 0.28 }}
                                style={{
                                    padding: 20,
                                    borderRadius: 18,
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 16,
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                                            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>
                                                {opportunity.category}
                                            </span>
                                            <span style={{
                                                fontSize: 10,
                                                padding: "2px 7px",
                                                borderRadius: 999,
                                                background: opportunity.board_active ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
                                                border: opportunity.board_active ? "1px solid rgba(34,197,94,0.18)" : "1px solid rgba(245,158,11,0.18)",
                                                color: opportunity.board_active ? "#86efac" : "#fcd34d",
                                                fontWeight: 700,
                                            }}>
                                                {opportunity.board_active ? "Active" : "Stale"}
                                            </span>
                                            {opportunity.watching && (
                                                <span style={{
                                                    fontSize: 10,
                                                    padding: "2px 7px",
                                                    borderRadius: 999,
                                                    background: "rgba(59,130,246,0.12)",
                                                    border: "1px solid rgba(59,130,246,0.18)",
                                                    color: "#93c5fd",
                                                    fontWeight: 700,
                                                }}>
                                                    Watching
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: 22, fontWeight: 800, color: "#f8fafc", lineHeight: 1.15 }}>
                                            {opportunity.label}
                                        </div>
                                        {intelligence?.summary_line && (
                                            <div style={{ marginTop: 8, fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>
                                                {intelligence.summary_line}
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 122 }}>
                                        <div style={{
                                            padding: "10px 12px",
                                            borderRadius: 12,
                                            background: "rgba(255,255,255,0.04)",
                                            textAlign: "right",
                                        }}>
                                            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                                Score
                                            </div>
                                            <div style={{ fontSize: 22, fontWeight: 800, color: "#f8fafc", fontFamily: "var(--font-mono)" }}>
                                                {Math.round(Number(opportunity.primary_idea?.current_score || 0))}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => void toggleWatch(opportunity)}
                                            disabled={watchPending}
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: 6,
                                                padding: "10px 12px",
                                                borderRadius: 10,
                                                border: opportunity.watching
                                                    ? "1px solid rgba(34,197,94,0.2)"
                                                    : "1px solid rgba(59,130,246,0.2)",
                                                background: opportunity.watching
                                                    ? "rgba(34,197,94,0.12)"
                                                    : "rgba(59,130,246,0.12)",
                                                color: opportunity.watching ? "#86efac" : "#bfdbfe",
                                                fontSize: 12,
                                                fontWeight: 700,
                                                cursor: watchPending ? "wait" : "pointer",
                                            }}
                                        >
                                            <Radar style={{ width: 14, height: 14 }} />
                                            {opportunity.watching ? "Watching" : "Watch this"}
                                        </button>
                                    </div>
                                </div>

                                <div style={{
                                    padding: "12px 14px",
                                    borderRadius: 14,
                                    background: "rgba(59,130,246,0.06)",
                                    border: "1px solid rgba(59,130,246,0.12)",
                                    color: "#dbeafe",
                                    fontSize: 12,
                                    lineHeight: 1.6,
                                }}>
                                    {opportunity.icp_summary || "This opportunity still needs an explicit ICP summary."}
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                                    <SectionCard label="Why now">
                                        <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.6 }}>
                                            {intelligence?.why_now_summary || "The timing story is still being shaped from the current evidence."}
                                        </div>
                                        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                                            {intelligence?.strongest_reason || "The strongest reason is still being assembled from current proof."}
                                        </div>
                                    </SectionCard>

                                    <SectionCard label="Evidence pulse">
                                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                            <span style={{ fontSize: 11, color: "#f8fafc", fontFamily: "var(--font-mono)" }}>
                                                {intelligence?.evidence_snapshot.direct_evidence_count || 0} direct
                                            </span>
                                            <span style={{ fontSize: 11, color: "#f8fafc", fontFamily: "var(--font-mono)" }}>
                                                {intelligence?.evidence_snapshot.source_count || opportunity.primary_idea?.source_count || 0} sources
                                            </span>
                                            <span style={{ fontSize: 11, color: "#94a3b8" }}>
                                                {intelligence?.evidence_snapshot.freshness_label || "Freshness unknown"}
                                            </span>
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                            {(intelligence?.evidence_snapshot.representative_evidence || []).slice(0, 2).map((item) => (
                                                <div key={item.id} style={{
                                                    padding: "10px 12px",
                                                    borderRadius: 10,
                                                    background: "rgba(255,255,255,0.03)",
                                                    border: "1px solid rgba(255,255,255,0.05)",
                                                }}>
                                                    <div style={{ fontSize: 11, color: "#f8fafc", fontWeight: 700, lineHeight: 1.45 }}>
                                                        {item.title}
                                                    </div>
                                                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                                                        {item.platform}
                                                    </div>
                                                </div>
                                            ))}
                                            {(intelligence?.evidence_snapshot.representative_evidence || []).length === 0 && (
                                                <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                                                    Representative evidence is still thin, so this bet should stay disciplined.
                                                </div>
                                            )}
                                        </div>
                                    </SectionCard>

                                    <SectionCard label="What breaks this">
                                        <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.6 }}>
                                            {intelligence?.invalidation_summary || "Clear stop conditions have not been attached yet."}
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                            {(intelligence?.invalidation_items || []).slice(0, 3).map((item, itemIndex) => (
                                                <div key={`${opportunity.id}-invalidate-${itemIndex}`} style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                                                    {item}
                                                </div>
                                            ))}
                                        </div>
                                    </SectionCard>

                                    <SectionCard label="Recommended next step">
                                        <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.6 }}>
                                            {intelligence?.recommended_action || "The next move is still undefined."}
                                        </div>
                                        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                                            {intelligence?.first_step || "Start with one narrow validation step before you expand this."}
                                        </div>
                                        <ValidationDepthChooser prefill={validationPrefill}>
                                            <span style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 6,
                                                width: "fit-content",
                                                padding: "9px 12px",
                                                borderRadius: 10,
                                                background: "rgba(249,115,22,0.12)",
                                                border: "1px solid rgba(249,115,22,0.18)",
                                                color: "#fdba74",
                                                fontSize: 11,
                                                fontWeight: 700,
                                            }}>
                                                Validate now
                                                <ExternalLink style={{ width: 12, height: 12 }} />
                                            </span>
                                        </ValidationDepthChooser>
                                    </SectionCard>

                                    <SectionCard label="Readiness">
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                                            <div>
                                                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                                                    Readiness
                                                </div>
                                                <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", fontFamily: "var(--font-mono)" }}>
                                                    {Math.round(Number(intelligence?.readiness.score || 0))}
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                                                    Trust
                                                </div>
                                                <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", fontFamily: "var(--font-mono)" }}>
                                                    {opportunity.primary_idea?.trust?.score || 0}
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                                                    Posts
                                                </div>
                                                <div style={{ fontSize: 18, fontWeight: 800, color: "#f8fafc", fontFamily: "var(--font-mono)" }}>
                                                    {opportunity.primary_idea?.post_count_total || 0}
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 11, color: "#e2e8f0", lineHeight: 1.55 }}>
                                            {intelligence?.readiness.posture || "Wait and validate more first"}
                                        </div>
                                        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                                            Anti-idea verdict: {intelligence?.readiness.anti_idea_verdict || "WAIT"}
                                        </div>
                                        {(opportunity.board_stale_reason || intelligence?.strongest_caution) && (
                                            <div style={{ fontSize: 11, color: opportunity.board_stale_reason ? "#fbbf24" : "#94a3b8", lineHeight: 1.55 }}>
                                                {opportunity.board_stale_reason || intelligence?.strongest_caution}
                                            </div>
                                        )}
                                    </SectionCard>
                                </div>

                                <div style={{
                                    padding: "12px 14px",
                                    borderRadius: 12,
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(255,255,255,0.05)",
                                }}>
                                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", marginBottom: 8 }}>
                                        Linked radar idea
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>
                                                {opportunity.primary_idea?.topic || opportunity.primary_idea_slug}
                                            </div>
                                            {opportunity.primary_idea?.suggested_wedge_label && opportunity.primary_idea.suggested_wedge_label !== opportunity.primary_idea.topic && (
                                                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                                                    Product angle: {opportunity.primary_idea.suggested_wedge_label}
                                                </div>
                                            )}
                                        </div>
                                        <Link
                                            href={`/dashboard/idea/${opportunity.primary_idea_slug}`}
                                            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#bfdbfe", textDecoration: "none", fontSize: 12, fontWeight: 700 }}
                                        >
                                            Open idea
                                            <ExternalLink style={{ width: 13, height: 13 }} />
                                        </Link>
                                    </div>
                                </div>

                                {opportunity.notes && (
                                    <div style={{
                                        padding: "12px 14px",
                                        borderRadius: 12,
                                        background: "rgba(249,115,22,0.06)",
                                        border: "1px solid rgba(249,115,22,0.12)",
                                        color: "#fed7aa",
                                        fontSize: 12,
                                        lineHeight: 1.6,
                                    }}>
                                        {opportunity.notes}
                                    </div>
                                )}

                                {opportunity.source_idea_slugs.length > 0 && (
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <Layers3 style={{ width: 14, height: 14, color: "#94a3b8" }} />
                                        {opportunity.source_idea_slugs.map((slug) => (
                                            <span key={`${opportunity.id}-${slug}`} style={{
                                                fontSize: 11,
                                                padding: "4px 8px",
                                                borderRadius: 999,
                                                background: "rgba(255,255,255,0.04)",
                                                color: "#cbd5e1",
                                                border: "1px solid rgba(255,255,255,0.06)",
                                            }}>
                                                {slug}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
