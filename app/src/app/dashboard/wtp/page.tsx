"use client";

import React, { useState, useEffect, useCallback } from "react";
import { PremiumGate } from "@/app/components/premium-gate";
import { motion } from "framer-motion";
import { GlowBadge, StaggerContainer, StaggerItem } from "@/app/components/motion";
import { DollarSign, AlertCircle, Tag, TrendingUp } from "lucide-react";
import { useUserPlan } from "@/lib/use-user-plan";

interface WtpEvidence {
    post_title?: string;
    subreddit?: string;
    what_it_proves?: string;
    score?: number;
}

interface WtpItem {
    idea: string;
    validation_id: string;
    created_at: string;
    willingness_to_pay: string;
    price_signals: string | null;
    pricing_strategy: Record<string, unknown>;
    evidence: WtpEvidence[];
}

export default function WtpPage() {
    const { isPremium } = useUserPlan();
    const [wtpData, setWtpData] = useState<WtpItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadWtp = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/intelligence?section=wtp");
            const payload = await response.json();
            if (!response.ok || payload?.error) {
                throw new Error(payload?.error || "Could not load data");
            }
            setWtpData(payload.data || []);
            setError(null);
        } catch (err) {
            console.error(err);
            setWtpData([]);
            setError("Could not load data");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isPremium) return;
        loadWtp();
    }, [isPremium, loadWtp]);

    if (!isPremium) return <PremiumGate feature="WTP Detection" />;

    return (
        <div className="max-w-4xl mx-auto p-6 md:p-8">
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <h1 className="text-[20px] font-bold font-display text-white flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-build" /> WTP Detection
                </h1>
                <p className="text-[13px] text-muted-foreground mt-1">Willingness-to-pay signals extracted from your validations</p>
            </motion.div>

            {loading ? (
                <div className="mt-6 flex flex-col gap-2.5">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="bento-cell p-5 rounded-2xl">
                            <div className="h-3.5 w-40 bg-white/5 rounded-[4px] mb-2.5" />
                            <div className="h-3 w-[70%] bg-white/[0.03] rounded-[4px]" />
                        </div>
                    ))}
                </div>
            ) : error ? (
                <div className="bento-cell p-12 text-center rounded-2xl mt-6 flex flex-col items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-dont/70 mb-3" />
                    <p className="text-[14px] font-medium text-foreground mb-1">Could not load data</p>
                    <button
                        onClick={loadWtp}
                        className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-foreground hover:bg-white/10"
                    >
                        Retry
                    </button>
                </div>
            ) : wtpData.length > 0 ? (
                <>
                    {/* Per-validation WTP summary */}
                    <StaggerContainer className="flex flex-col gap-3 mt-6">
                        {wtpData.map(w => {
                            const pricing = w.pricing_strategy || {};
                            const model = (pricing.recommended_model || pricing.model || "N/A") as string;
                            const priceRange = (pricing.price_range || pricing.range || "") as string;
                            const pricingSummary = (pricing.summary || "") as string;

                            return (
                                <StaggerItem key={w.validation_id}>
                                    <div className="bento-cell p-5 rounded-xl hover:bg-white/[0.03] transition-colors group">
                                        <div className="flex items-start gap-3 mb-3">
                                            <div className="w-9 h-9 rounded-lg bg-build/10 border border-build/20 flex items-center justify-center flex-shrink-0">
                                                <DollarSign className="w-4 h-4 text-build" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="text-[14px] font-bold text-white font-display mb-1">{w.idea}</h3>
                                                <div className="flex gap-2 flex-wrap items-center">
                                                    <GlowBadge color="emerald">
                                                        <DollarSign className="w-2.5 h-2.5" /> {w.willingness_to_pay}
                                                    </GlowBadge>
                                                    {model !== "N/A" && (
                                                        <GlowBadge color="amber">
                                                            <Tag className="w-2.5 h-2.5" /> {model}
                                                        </GlowBadge>
                                                    )}
                                                    {priceRange && (
                                                        <span className="text-[11px] text-build font-mono">
                                                            {priceRange}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-[10px] text-muted-foreground font-mono flex-shrink-0">
                                                {new Date(w.created_at).toLocaleDateString()}
                                            </div>
                                        </div>

                                        {/* Pricing summary from pricing_strategy — replaces phantom price_signals */}
                                        {pricingSummary && (
                                            <div className="text-[12px] text-muted-foreground/90 leading-relaxed mb-3 bg-white/[0.02] p-3 rounded-lg border border-white/5">
                                                {pricingSummary}
                                            </div>
                                        )}

                                        {/* WTP evidence posts */}
                                        {w.evidence.length > 0 && (
                                            <div className="border-t border-white/5 pt-3 mt-2">
                                                <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2 font-bold">
                                                    Evidence Posts ({w.evidence.length})
                                                </div>
                                                {w.evidence.slice(0, 5).map((e, i) => (
                                                    <div key={i} className={`text-[12px] text-muted-foreground/80 py-1.5 ${i < w.evidence.length - 1 ? "border-b border-white/[0.03]" : ""}`}>
                                                        <div className="flex gap-2 items-center">
                                                            {e.subreddit && <span className="text-[10px] text-indigo-400 font-mono">r/{e.subreddit}</span>}
                                                            {e.score && <span className="text-[10px] text-muted-foreground">{e.score} pts</span>}
                                                        </div>
                                                        <div className="font-medium text-white/90 mt-0.5">{e.post_title || "Untitled"}</div>
                                                        {e.what_it_proves && <div className="text-[11px] text-muted-foreground mt-0.5">{e.what_it_proves}</div>}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </StaggerItem>
                            );
                        })}
                    </StaggerContainer>
                </>
            ) : (
                <div className="bento-cell p-12 text-center rounded-2xl mt-6 flex flex-col items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-muted-foreground/30 mb-3" />
                    <p className="text-[14px] font-medium text-muted-foreground/80 mb-1">No WTP signals detected yet</p>
                    <p className="text-[12px] text-muted-foreground/60">Run an idea validation — the AI will detect willingness-to-pay signals automatically.</p>
                </div>
            )}
        </div>
    );
}
