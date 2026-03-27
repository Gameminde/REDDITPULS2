"use client";

import React, { useMemo, useState } from "react";

export interface ScoreBreakdown {
    velocity: number | null;
    pain_density: number | null;
    cross_platform: number | null;
    engagement: number | null;
    volume: number | null;
    evidence_quality?: number | null;
    velocity_weight?: number | null;
    pain_density_weight?: number | null;
    cross_platform_weight?: number | null;
    engagement_weight?: number | null;
    volume_weight?: number | null;
    evidence_quality_weight?: number | null;
    raw_weighted_score?: number | null;
}

function clampPercent(value: number | null | undefined) {
    if (typeof value !== "number" || Number.isNaN(value)) return null;
    return Math.max(0, Math.min(100, value));
}

function formatPercent(value: number | null) {
    return value == null ? "—" : `${Math.round(value)}%`;
}

function formatContribution(value: number | null, weight: number) {
    if (value == null) return "—";
    return (value * weight).toFixed(1);
}

function barColor(value: number | null) {
    if (value == null) return "#64748b";
    if (value >= 70) return "#22c55e";
    if (value >= 40) return "#f97316";
    return "#64748b";
}

export default function ScoreBreakdownTooltip({
    score,
    breakdown,
}: {
    score: number;
    breakdown: ScoreBreakdown | null;
}) {
    const [open, setOpen] = useState(false);

    const normalized = useMemo(() => {
        const base = breakdown || {
            velocity: null,
            pain_density: null,
            cross_platform: null,
            engagement: null,
            volume: null,
            evidence_quality: null,
        };
        const velocityWeight = Number(base.velocity_weight ?? 0.20);
        const painWeight = Number(base.pain_density_weight ?? 0.20);
        const crossWeight = Number(base.cross_platform_weight ?? 0.15);
        const engagementWeight = Number(base.engagement_weight ?? 0.15);
        const volumeWeight = Number(base.volume_weight ?? 0.10);
        const evidenceQualityWeight = Number(base.evidence_quality_weight ?? 0.20);

        const rows = [
            { label: "Velocity", value: clampPercent(base.velocity), weight: velocityWeight, emoji: "R" },
            { label: "Pain Density", value: clampPercent(base.pain_density), weight: painWeight, emoji: "P" },
            { label: "Cross-Platform", value: clampPercent(base.cross_platform), weight: crossWeight, emoji: "X" },
            { label: "Engagement", value: clampPercent(base.engagement), weight: engagementWeight, emoji: "E" },
            { label: "Volume", value: clampPercent(base.volume), weight: volumeWeight, emoji: "V" },
            { label: "Evidence Quality", value: clampPercent(base.evidence_quality), weight: evidenceQualityWeight, emoji: "Q" },
        ];

        const weightedTotal = rows.reduce((sum, row) => sum + ((row.value ?? 0) * row.weight), 0);
        const warnings: string[] = [];
        const velocity = rows[0].value;
        const painDensity = rows[1].value;
        const crossPlatform = rows[2].value;
        const volume = rows[4].value;
        const evidenceQuality = rows[5].value;

        if (velocity != null && painDensity != null && velocity > 70 && painDensity < 30) {
            warnings.push("High velocity but low pain. This could be hype, not durable demand.");
        }
        if (crossPlatform != null && crossPlatform < 20) {
            warnings.push("Signal is concentrated on one platform. Confidence is limited.");
        }
        if (volume != null && volume < 20) {
            warnings.push("Very low volume. Treat this as an early signal, not a settled opportunity.");
        }
        if (evidenceQuality != null && evidenceQuality < 30) {
            warnings.push("Evidence quality is weak. The topic may be active, but buyer-proof is still thin.");
        }
        if (rows.some((row) => row.value == null)) {
            warnings.push("Some score inputs are missing on older rows. A fresh market scan will fill them in.");
        }

        return { rows, weightedTotal, warnings };
    }, [breakdown]);

    return (
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button
                type="button"
                aria-label="Show score breakdown"
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen((value) => !value);
                }}
                style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: open ? "rgba(249,115,22,0.14)" : "rgba(255,255,255,0.05)",
                    color: open ? "#fb923c" : "#94a3b8",
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: "var(--font-mono)",
                    cursor: "pointer",
                    lineHeight: 1,
                }}
            >
                ?
            </button>

            {open && (
                <div
                    onClick={(event) => event.stopPropagation()}
                    style={{
                        position: "absolute",
                        top: 24,
                        right: -12,
                        zIndex: 40,
                        width: 320,
                        padding: 14,
                        borderRadius: 12,
                        background: "rgba(2,6,23,0.96)",
                        border: "1px solid rgba(249,115,22,0.18)",
                        boxShadow: "0 18px 40px rgba(2,6,23,0.45)",
                        backdropFilter: "blur(18px)",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <div>
                            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8", fontFamily: "var(--font-mono)" }}>
                                Score Breakdown
                            </div>
                            <div style={{ marginTop: 3, fontSize: 20, fontWeight: 800, color: "#f1f5f9", fontFamily: "var(--font-mono)" }}>
                                {Math.round(score)}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setOpen(false);
                            }}
                            style={{
                                border: "none",
                                background: "transparent",
                                color: "#64748b",
                                cursor: "pointer",
                                fontSize: 16,
                                lineHeight: 1,
                            }}
                        >
                            ×
                        </button>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {normalized.rows.map((row) => (
                            <div key={row.label}>
                                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 56px 78px", gap: 8, alignItems: "center", marginBottom: 4 }}>
                                    <div style={{ fontSize: 12, color: "#e2e8f0" }}>
                                        <span style={{ display: "inline-block", width: 16, color: "#94a3b8", fontFamily: "var(--font-mono)" }}>{row.emoji}</span>
                                        {row.label}
                                    </div>
                                    <div style={{ fontSize: 11, color: "#cbd5e1", fontFamily: "var(--font-mono)", textAlign: "right" }}>
                                        {formatPercent(row.value)}
                                    </div>
                                    <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "var(--font-mono)", textAlign: "right" }}>
                                        × {Math.round(row.weight * 100)}% = {formatContribution(row.value, row.weight)}
                                    </div>
                                </div>
                                <div style={{ width: "100%", height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                                    <div
                                        style={{
                                            width: `${row.value ?? 0}%`,
                                            height: "100%",
                                            borderRadius: 999,
                                            background: `linear-gradient(90deg, ${barColor(row.value)}88, ${barColor(row.value)})`,
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    <div style={{
                        marginTop: 12,
                        paddingTop: 10,
                        borderTop: "1px solid rgba(255,255,255,0.08)",
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "#94a3b8",
                        fontFamily: "var(--font-mono)",
                    }}>
                        <span>Weighted total</span>
                        <span>{normalized.weightedTotal.toFixed(1)} / 100</span>
                    </div>

                    {normalized.warnings.length > 0 && (
                        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                            {normalized.warnings.map((warning) => (
                                <div
                                    key={warning}
                                    style={{
                                        padding: "8px 10px",
                                        borderRadius: 8,
                                        background: "rgba(245,158,11,0.08)",
                                        border: "1px solid rgba(245,158,11,0.16)",
                                        color: "#fbbf24",
                                        fontSize: 11,
                                        lineHeight: 1.45,
                                    }}
                                >
                                    {warning}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
