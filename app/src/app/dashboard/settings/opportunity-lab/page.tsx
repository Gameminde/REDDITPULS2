"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Beaker, ChevronRight, FlaskConical, Layers3, Radar, Sparkles } from "lucide-react";

type LabIdea = {
    id: string;
    slug: string;
    topic: string;
    category: string;
    lane: "candidate_opportunity" | "theme_to_shape" | "market_context" | "ignore";
    lane_label: string;
    action_label: string;
    thesis: string;
    reason: string;
    validation_seed: string | null;
    representative_titles: string[];
    score: number;
    source_count: number;
    post_count_total: number;
    signal_contract: {
        support_level: "evidence_backed" | "supporting_context" | "hypothesis";
        buyer_native_direct_count: number;
        launch_meta_count: number;
    };
    trust: {
        score: number;
        label: string;
    };
};

type LabResponse = {
    generated_at: string;
    total: number;
    lanes: {
        candidate_opportunity: LabIdea[];
        theme_to_shape: LabIdea[];
        market_context: LabIdea[];
        ignore: LabIdea[];
    };
};

const LANE_META = {
    candidate_opportunity: {
        title: "Candidate Opportunities",
        icon: Sparkles,
        tone: "rgba(34,197,94,0.12)",
        border: "rgba(34,197,94,0.18)",
        color: "#86efac",
        blurb: "These already look specific enough to send into validation without more framing.",
    },
    theme_to_shape: {
        title: "Themes To Shape",
        icon: Layers3,
        tone: "rgba(59,130,246,0.12)",
        border: "rgba(59,130,246,0.18)",
        color: "#93c5fd",
        blurb: "Real pain is visible here, but the app should treat these as themes that still need a wedge.",
    },
    market_context: {
        title: "Market Context",
        icon: Radar,
        tone: "rgba(245,158,11,0.12)",
        border: "rgba(245,158,11,0.18)",
        color: "#fcd34d",
        blurb: "Useful market context, but not a real idea yet. Good to watch, bad to overclaim.",
    },
    ignore: {
        title: "Ignore / Noise",
        icon: Beaker,
        tone: "rgba(148,163,184,0.10)",
        border: "rgba(148,163,184,0.16)",
        color: "#cbd5e1",
        blurb: "Mostly launch chatter or weak context. These should stay out of the main market story.",
    },
} as const;

function IdeaCard({ idea }: { idea: LabIdea }) {
    return (
        <div
            className="rounded-xl border p-4"
            style={{ background: "hsl(0 0% 100% / 0.03)", borderColor: "hsl(0 0% 100% / 0.07)" }}
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-white">{idea.topic}</h3>
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground" style={{ background: "hsl(0 0% 100% / 0.04)" }}>
                            {idea.category}
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{idea.thesis}</p>
                </div>
                <div className="text-right">
                    <div className="text-lg font-mono font-semibold text-white">{idea.score}</div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{idea.trust.label}</div>
                </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-lg px-3 py-2" style={{ background: "hsl(0 0% 100% / 0.03)" }}>
                    <div className="text-muted-foreground">Sources</div>
                    <div className="mt-1 text-white">{idea.source_count}</div>
                </div>
                <div className="rounded-lg px-3 py-2" style={{ background: "hsl(0 0% 100% / 0.03)" }}>
                    <div className="text-muted-foreground">Posts</div>
                    <div className="mt-1 text-white">{idea.post_count_total}</div>
                </div>
                <div className="rounded-lg px-3 py-2" style={{ background: "hsl(0 0% 100% / 0.03)" }}>
                    <div className="text-muted-foreground">Buyer direct</div>
                    <div className="mt-1 text-white">{idea.signal_contract.buyer_native_direct_count}</div>
                </div>
            </div>

            <div className="mt-3 rounded-lg px-3 py-3" style={{ background: "hsl(0 0% 100% / 0.02)" }}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Why This Lane</div>
                <p className="mt-2 text-xs leading-5 text-slate-200">{idea.reason}</p>
            </div>

            {idea.validation_seed && (
                <div className="mt-3 rounded-lg border px-3 py-3" style={{ borderColor: "hsl(16 100% 50% / 0.16)", background: "hsl(16 100% 50% / 0.06)" }}>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">Validation Seed</div>
                    <p className="mt-2 text-xs leading-5 text-slate-100">{idea.validation_seed}</p>
                </div>
            )}

            {idea.representative_titles.length > 0 && (
                <div className="mt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Representative Evidence</div>
                    <div className="mt-2 space-y-2">
                        {idea.representative_titles.slice(0, 2).map((title) => (
                            <div
                                key={title}
                                className="rounded-lg px-3 py-2 text-xs text-slate-200"
                                style={{ background: "hsl(0 0% 100% / 0.03)" }}
                            >
                                {title}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-4 flex items-center justify-between">
                <span className="rounded-full px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-primary" style={{ background: "hsl(var(--orange-dim))" }}>
                    {idea.action_label}
                </span>
                <Link
                    href={`/dashboard/idea/${idea.slug}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                >
                    Open detail <ChevronRight className="h-3.5 w-3.5" />
                </Link>
            </div>
        </div>
    );
}

export default function OpportunityLabPage() {
    const [data, setData] = useState<LabResponse | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch("/api/opportunity-lab", { cache: "no-store" });
                const payload = await res.json();
                if (res.ok) {
                    setData(payload);
                }
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const generatedLabel = useMemo(() => {
        if (!data?.generated_at) return "Not generated yet";
        return new Date(data.generated_at).toLocaleString();
    }, [data?.generated_at]);

    return (
        <div className="max-w-7xl mx-auto px-6 pt-8 pb-10">
            <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <Link href="/dashboard/settings" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-white transition-colors">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to Settings
                </Link>
                <div className="mt-4 flex items-start justify-between gap-4">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-mono uppercase tracking-[0.14em] text-primary" style={{ background: "hsl(var(--orange-dim))" }}>
                            <FlaskConical className="h-3.5 w-3.5" />
                            Experimental
                        </div>
                        <h1 className="mt-3 text-[30px] font-bold font-display tracking-tight text-white">Opportunity Operating Model Lab</h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                            This lab does not replace the stock market or validation. It is a parallel test surface that treats market rows as
                            themes first, candidate opportunities second, and noise when the proof is mostly launch chatter.
                        </p>
                    </div>
                    <div className="rounded-xl border px-4 py-3 text-right" style={{ background: "hsl(0 0% 100% / 0.03)", borderColor: "hsl(0 0% 100% / 0.07)" }}>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Snapshot</div>
                        <div className="mt-2 text-sm text-white">{generatedLabel}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{data?.total || 0} market rows reclassified</div>
                    </div>
                </div>
            </motion.div>

            <div className="mb-6 grid gap-4 md:grid-cols-4">
                {(Object.keys(LANE_META) as Array<keyof typeof LANE_META>).map((laneKey) => {
                    const meta = LANE_META[laneKey];
                    const Icon = meta.icon;
                    const count = data?.lanes?.[laneKey]?.length || 0;
                    return (
                        <div
                            key={laneKey}
                            className="rounded-2xl border p-4"
                            style={{ background: meta.tone, borderColor: meta.border }}
                        >
                            <div className="flex items-center gap-2 text-white">
                                <Icon className="h-4 w-4" style={{ color: meta.color }} />
                                <span className="text-sm font-semibold">{meta.title}</span>
                            </div>
                            <div className="mt-3 text-2xl font-mono font-semibold text-white">{count}</div>
                            <p className="mt-2 text-xs leading-5 text-slate-300">{meta.blurb}</p>
                        </div>
                    );
                })}
            </div>

            {loading ? (
                <div className="rounded-2xl border p-8 text-sm text-muted-foreground" style={{ background: "hsl(0 0% 100% / 0.03)", borderColor: "hsl(0 0% 100% / 0.07)" }}>
                    Loading the lab snapshot...
                </div>
            ) : (
                <div className="space-y-8">
                    {(Object.keys(LANE_META) as Array<keyof typeof LANE_META>).map((laneKey) => {
                        const meta = LANE_META[laneKey];
                        const items = data?.lanes?.[laneKey] || [];
                        return (
                            <section key={laneKey}>
                                <div className="mb-3 flex items-center justify-between">
                                    <div>
                                        <h2 className="text-lg font-semibold text-white">{meta.title}</h2>
                                        <p className="text-xs text-muted-foreground">{meta.blurb}</p>
                                    </div>
                                    <div className="text-xs font-mono text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</div>
                                </div>
                                {items.length === 0 ? (
                                    <div className="rounded-xl border px-4 py-5 text-sm text-muted-foreground" style={{ background: "hsl(0 0% 100% / 0.02)", borderColor: "hsl(0 0% 100% / 0.06)" }}>
                                        No items in this lane right now.
                                    </div>
                                ) : (
                                    <div className="grid gap-4 lg:grid-cols-2">
                                        {items.slice(0, 8).map((idea) => (
                                            <IdeaCard key={`${laneKey}-${idea.id}`} idea={idea} />
                                        ))}
                                    </div>
                                )}
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
