"use client";

import { useEffect, useState } from "react";
import { Brain, Scale, ShieldAlert } from "lucide-react";

type DebateTabKey = "round1" | "round2" | "final";

export interface DebateTranscript {
    models?: Array<{
        id?: string;
        provider?: string;
        model?: string;
        label?: string;
        role?: string;
    }>;
    rounds?: Array<{
        round?: number;
        entries?: Array<{
            model_id?: string;
            role?: string;
            verdict?: string;
            confidence?: number;
            confidence_delta?: number;
            held?: boolean;
            argument_text?: string;
            engagement_score?: number;
            engagement_label?: string;
        }>;
    }>;
    round2_summary?: string;
    final?: {
        verdict?: string;
        confidence?: number;
        weights?: Array<{
            model_id?: string;
            role?: string;
            weight?: number;
            verdict?: string;
            label?: string;
        }>;
        dissent?: {
            exists?: boolean;
            dissenting_model_id?: string | null;
            dissenting_role?: string | null;
            dissenting_verdict?: string | null;
            dissent_reason?: string | null;
        };
    };
}

type NormalizedModel = {
    id: string;
    provider: string;
    model: string;
    label: string;
    role: string;
};

type NormalizedEntry = {
    model_id: string;
    role: string;
    verdict: string;
    confidence: number;
    confidence_delta: number;
    held: boolean;
    argument_text: string;
    engagement_score: number;
    engagement_label: string;
};

type NormalizedWeight = {
    model_id: string;
    role: string;
    weight: number;
    verdict: string;
    label: string;
};

type NormalizedTranscript = {
    models: NormalizedModel[];
    round1: NormalizedEntry[];
    round2: NormalizedEntry[];
    round2Summary: string;
    final: {
        verdict: string;
        confidence: number;
        weights: NormalizedWeight[];
        dissent: {
            exists: boolean;
            dissenting_model_id: string | null;
            dissenting_role: string | null;
            dissenting_verdict: string | null;
            dissent_reason: string | null;
        } | null;
    } | null;
};

interface DebatePanelProps {
    transcript?: DebateTranscript | null;
    contextNote?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
}

function clampConfidence(value: unknown, fallback = 0): number {
    const parsed = asNumber(value, fallback);
    return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeVerdict(value: unknown): string {
    return asString(value, "UNKNOWN").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function deriveEngagementLabel(score: number, roundNumber: number): string {
    if (roundNumber === 1) {
        return "Initial position";
    }
    if (score >= 2) {
        return "Engaged 2/2 models";
    }
    if (score === 1) {
        return "Partial engagement (1/2 models)";
    }
    return "Restated position - no opposing models referenced";
}

function normalizeEntry(value: unknown, roundNumber: number, index: number): NormalizedEntry | null {
    if (!isRecord(value)) {
        return null;
    }
    const confidence = clampConfidence(value.confidence, 0);
    const confidenceDelta = Math.round(asNumber(value.confidence_delta, 0));
    const engagementScore = Math.max(0, Math.min(2, Math.round(asNumber(value.engagement_score, 0))));
    return {
        model_id: asString(value.model_id, `entry-${roundNumber}-${index}`),
        role: asString(value.role, "ANALYST"),
        verdict: normalizeVerdict(value.verdict),
        confidence,
        confidence_delta: confidenceDelta,
        held: typeof value.held === "boolean" ? value.held : roundNumber === 1 ? true : confidenceDelta === 0,
        argument_text: asString(value.argument_text),
        engagement_score: engagementScore,
        engagement_label: asString(value.engagement_label, deriveEngagementLabel(engagementScore, roundNumber)),
    };
}

function normalizeTranscript(raw: DebateTranscript | null | undefined): NormalizedTranscript | null {
    if (!isRecord(raw)) {
        return null;
    }

    const models = Array.isArray(raw.models)
        ? raw.models
            .map((model, index) => {
                if (!isRecord(model)) {
                    return null;
                }
                const provider = asString(model.provider, "unknown");
                const modelName = asString(model.model);
                const id = asString(model.id, `model-${index}`);
                const label = asString(model.label, modelName ? `${provider}/${modelName}` : id);
                return {
                    id,
                    provider,
                    model: modelName,
                    label,
                    role: asString(model.role, "ANALYST"),
                };
            })
            .filter((model): model is NormalizedModel => model !== null)
        : [];

    const rounds = Array.isArray(raw.rounds) ? raw.rounds : [];
    const round1Record = rounds.find((round) => isRecord(round) && asNumber(round.round, 0) === 1);
    const round2Record = rounds.find((round) => isRecord(round) && asNumber(round.round, 0) === 2);

    const round1 = isRecord(round1Record) && Array.isArray(round1Record.entries)
        ? round1Record.entries
            .map((entry, index) => normalizeEntry(entry, 1, index))
            .filter((entry): entry is NormalizedEntry => entry !== null)
        : [];
    const round2 = isRecord(round2Record) && Array.isArray(round2Record.entries)
        ? round2Record.entries
            .map((entry, index) => normalizeEntry(entry, 2, index))
            .filter((entry): entry is NormalizedEntry => entry !== null)
        : [];

    let final: NormalizedTranscript["final"] = null;
    if (isRecord(raw.final)) {
        const weights = Array.isArray(raw.final.weights)
            ? raw.final.weights
                .map((weight, index) => {
                    if (!isRecord(weight)) {
                        return null;
                    }
                    return {
                        model_id: asString(weight.model_id, `weight-${index}`),
                        role: asString(weight.role, "ANALYST"),
                        weight: Math.max(0, asNumber(weight.weight, 0)),
                        verdict: normalizeVerdict(weight.verdict),
                        label: asString(weight.label, asString(weight.model_id, `weight-${index}`)),
                    };
                })
                .filter((weight): weight is NormalizedWeight => weight !== null)
            : [];

        const dissent = isRecord(raw.final.dissent)
            ? {
                exists: Boolean(raw.final.dissent.exists),
                dissenting_model_id: raw.final.dissent.dissenting_model_id ? asString(raw.final.dissent.dissenting_model_id) : null,
                dissenting_role: raw.final.dissent.dissenting_role ? asString(raw.final.dissent.dissenting_role) : null,
                dissenting_verdict: raw.final.dissent.dissenting_verdict ? normalizeVerdict(raw.final.dissent.dissenting_verdict) : null,
                dissent_reason: raw.final.dissent.dissent_reason ? asString(raw.final.dissent.dissent_reason) : null,
            }
            : null;

        final = {
            verdict: normalizeVerdict(raw.final.verdict),
            confidence: clampConfidence(raw.final.confidence, 0),
            weights,
            dissent,
        };
    }

    if (models.length === 0 && round1.length === 0 && round2.length === 0 && !final) {
        return null;
    }

    return {
        models,
        round1,
        round2,
        round2Summary: asString(raw.round2_summary),
        final,
    };
}

function getRoleTone(role: string) {
    const normalized = role.toUpperCase();
    if (normalized === "BULL") {
        return {
            border: "border-build/30",
            stripe: "before:bg-build",
            badge: "bg-build/10 text-build border-build/20",
        };
    }
    if (normalized === "SKEPTIC") {
        return {
            border: "border-dont/30",
            stripe: "before:bg-dont",
            badge: "bg-dont/10 text-dont border-dont/20",
        };
    }
    return {
        border: "border-blue-400/30",
        stripe: "before:bg-blue-400",
        badge: "bg-blue-400/10 text-blue-300 border-blue-400/20",
    };
}

function getVerdictTone(verdict: string) {
    const normalized = verdict.toUpperCase();
    if (normalized.includes("BUILD") && !normalized.includes("DONT")) {
        return "text-build";
    }
    if (normalized.includes("DONT") || normalized.includes("REJECT")) {
        return "text-dont";
    }
    return "text-risky";
}

export function DebatePanel({ transcript, contextNote }: DebatePanelProps) {
    const normalized = normalizeTranscript(transcript);
    const availableTabs: DebateTabKey[] = [];
    if (normalized?.round1.length) {
        availableTabs.push("round1");
    }
    if (normalized?.round2.length) {
        availableTabs.push("round2");
    }
    if (normalized?.final) {
        availableTabs.push("final");
    }

    const defaultTab: DebateTabKey = availableTabs.includes("round2")
        ? "round2"
        : availableTabs.includes("final")
            ? "final"
            : "round1";

    const [activeTab, setActiveTab] = useState<DebateTabKey>(defaultTab);
    const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (availableTabs.length === 0) {
            return;
        }
        if (!availableTabs.includes(activeTab)) {
            setActiveTab(defaultTab);
        }
    }, [activeTab, availableTabs, defaultTab]);

    if (!normalized || availableTabs.length === 0) {
        return null;
    }

    const modelMap = Object.fromEntries(normalized.models.map((model) => [model.id, model]));
    const totalRounds = (normalized.round1.length ? 1 : 0) + (normalized.round2.length ? 1 : 0);

    const renderEntries = (entries: NormalizedEntry[], roundNumber: number) => (
        <div className="mt-5 grid gap-4 xl:grid-cols-3 md:grid-cols-2">
            {entries.map((entry, index) => {
                const roleTone = getRoleTone(entry.role);
                const verdictTone = getVerdictTone(entry.verdict);
                const model = modelMap[entry.model_id];
                const cardKey = `${roundNumber}-${entry.model_id}-${index}`;
                const shouldExpand = entry.argument_text.length > 260 || entry.argument_text.split(/\s+/).length > 45;
                const isExpanded = Boolean(expandedCards[cardKey]);
                return (
                    <div
                        key={cardKey}
                        className={`relative overflow-hidden rounded-2xl border bg-white/[0.03] p-4 before:absolute before:inset-y-0 before:left-0 before:w-1 ${roleTone.border} ${roleTone.stripe}`}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold text-white">
                                    {model?.label || entry.model_id}
                                </div>
                                <div className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-mono uppercase tracking-widest ${roleTone.badge}`}>
                                    {entry.role}
                                </div>
                            </div>
                            <div className={`text-sm font-mono font-bold ${verdictTone}`}>
                                {entry.verdict}
                            </div>
                        </div>

                        <div className="mt-4 flex items-center gap-2 text-sm">
                            <span className="font-mono font-bold text-white">{entry.confidence}%</span>
                            {entry.confidence_delta !== 0 && (
                                <span className={`font-mono text-xs ${entry.confidence_delta > 0 ? "text-build" : "text-dont"}`}>
                                    {entry.confidence_delta > 0 ? "+" : ""}
                                    {entry.confidence_delta}
                                    {entry.confidence_delta > 0 && entry.engagement_score === 0 && (
                                        <span className="ml-1 text-risky">rose without rebuttal</span>
                                    )}
                                </span>
                            )}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">{entry.engagement_label}</div>

                        <div className={`mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-foreground/85 ${isExpanded ? "max-h-none" : "max-h-[120px] overflow-y-auto"}`}>
                            <div className="font-mono whitespace-pre-wrap">
                                {entry.argument_text || "No argument text available for this round."}
                            </div>
                        </div>

                        {shouldExpand && (
                            <button
                                type="button"
                                onClick={() => setExpandedCards((current) => ({ ...current, [cardKey]: !isExpanded }))}
                                className="mt-2 text-[11px] font-mono uppercase tracking-widest text-primary hover:text-white"
                            >
                                {isExpanded ? "Show less" : "Show full"}
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );

    const weightTotal = normalized.final?.weights.reduce((sum, weight) => sum + weight.weight, 0) ?? 0;
    const weightByVerdict = (normalized.final?.weights ?? []).reduce<Record<string, number>>((acc, weight) => {
        acc[weight.verdict] = (acc[weight.verdict] || 0) + weight.weight;
        return acc;
    }, {});

    return (
        <div className="bento-cell mt-6 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4 text-primary" />
                        <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                            AI Debate Room
                        </h3>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {normalized.models.length} models · {totalRounds} rounds · uncertainty-weighted
                    </p>
                </div>

                <div className="flex flex-wrap gap-2">
                    {availableTabs.includes("round1") && (
                        <button
                            type="button"
                            onClick={() => setActiveTab("round1")}
                            className={`rounded-full border px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest ${activeTab === "round1" ? "border-primary/30 bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-muted-foreground"}`}
                        >
                            Round 1
                        </button>
                    )}
                    {availableTabs.includes("round2") && (
                        <button
                            type="button"
                            onClick={() => setActiveTab("round2")}
                            className={`rounded-full border px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest ${activeTab === "round2" ? "border-primary/30 bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-muted-foreground"}`}
                        >
                            Round 2
                        </button>
                    )}
                    {availableTabs.includes("final") && (
                        <button
                            type="button"
                            onClick={() => setActiveTab("final")}
                            className={`rounded-full border px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest ${activeTab === "final" ? "border-primary/30 bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-muted-foreground"}`}
                        >
                            Final
                        </button>
                    )}
                </div>
            </div>

            {contextNote ? (
                <div className="mt-4 rounded-xl border border-zinc-500/20 bg-zinc-500/10 p-3 text-xs leading-relaxed text-zinc-300">
                    {contextNote}
                </div>
            ) : null}

            {activeTab === "round1" && renderEntries(normalized.round1, 1)}
            {activeTab === "round2" && (
                <>
                    {renderEntries(normalized.round2, 2)}
                    {normalized.round2Summary && (
                        <div className="mt-4 rounded-xl bg-white/5 px-3 py-2 text-xs text-muted-foreground">
                            {normalized.round2Summary}
                        </div>
                    )}
                </>
            )}
            {activeTab === "final" && normalized.final && (
                <div className="mt-5 space-y-5">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                        <div className="flex items-center gap-2">
                            <Scale className="h-4 w-4 text-primary" />
                            <div className="text-sm font-semibold text-white">
                                {normalized.final.verdict} · {normalized.final.confidence}%
                            </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                            {normalized.final.weights.map((weight) => (
                                <span
                                    key={`${weight.model_id}-${weight.role}`}
                                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-mono text-muted-foreground"
                                >
                                    {weight.label} {weight.weight.toFixed(1)}
                                </span>
                            ))}
                        </div>
                        {weightTotal > 0 && (
                            <div className="mt-4 overflow-hidden rounded-full border border-white/10 bg-white/5">
                                <div className="flex h-3 w-full">
                                    {Object.entries(weightByVerdict).map(([verdict, weight]) => (
                                        <div
                                            key={verdict}
                                            className={`h-full ${verdict.includes("BUILD") && !verdict.includes("DONT") ? "bg-build" : verdict.includes("DONT") ? "bg-dont" : "bg-risky"}`}
                                            style={{ width: `${(weight / weightTotal) * 100}%` }}
                                            title={`${verdict}: ${weight.toFixed(1)}`}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {normalized.final.dissent?.exists && (
                        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
                                <ShieldAlert className="h-4 w-4" />
                                1 model dissented - [{normalized.final.dissent.dissenting_role}] held {normalized.final.dissent.dissenting_verdict}
                            </div>
                            {normalized.final.dissent.dissent_reason && (
                                <div className="mt-1 text-xs text-amber-100/80">
                                    "{normalized.final.dissent.dissent_reason}"
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
