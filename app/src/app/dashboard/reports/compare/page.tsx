"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
    AlertCircle,
    ArrowLeft,
    Banknote,
    Brain,
    CheckCircle2,
    Loader2,
    MessageSquare,
    SlidersHorizontal,
    Scale,
    Shield,
    Target,
} from "lucide-react";
import { PremiumGate } from "@/app/components/premium-gate";
import { useUserPlan } from "@/lib/use-user-plan";
import type { CompareIdeasResult } from "@/lib/compare-ideas";
import { defaultFounderProfile, normalizeFounderProfile, type FounderProfile } from "@/lib/founder-market-fit";

function verdictTone(verdict: string) {
    const normalized = verdict.toUpperCase();
    if (normalized.includes("BUILD") && !normalized.includes("DON")) {
        return "border-build/20 bg-build/10 text-build";
    }
    if (normalized.includes("DON")) {
        return "border-dont/20 bg-dont/10 text-dont";
    }
    return "border-risky/20 bg-risky/10 text-risky";
}

function trustTone(level: "HIGH" | "MEDIUM" | "LOW") {
    if (level === "HIGH") return "text-build";
    if (level === "MEDIUM") return "text-risky";
    return "text-dont";
}

const PROFILE_STORAGE_KEY = "redditpulse-founder-profile-v1";

export default function CompareIdeasPage() {
    const { isPremium } = useUserPlan();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [comparison, setComparison] = useState<CompareIdeasResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [profile, setProfile] = useState<FounderProfile>(defaultFounderProfile());

    const ids = useMemo(() => {
        return [...new Set(
            String(searchParams.get("ids") || "")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
        )].slice(0, 4);
    }, [searchParams]);

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
            if (!raw) return;
            setProfile(normalizeFounderProfile(JSON.parse(raw)));
        } catch {
            setProfile(defaultFounderProfile());
        }
    }, []);

    useEffect(() => {
        try {
            window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
        } catch {
            // ignore storage failures
        }
    }, [profile]);

    useEffect(() => {
        if (!isPremium) return;
        if (ids.length < 2) {
            setError("Pick at least 2 validations to compare.");
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        setLoading(true);
        setError(null);

        const params = new URLSearchParams({
            ids: ids.join(","),
            technical_level: profile.technical_level,
            domain_familiarity: profile.domain_familiarity,
            sales_gtm_strength: profile.sales_gtm_strength,
            preferred_gtm_motion: profile.preferred_gtm_motion,
            available_time: profile.available_time,
            budget_tolerance: profile.budget_tolerance,
            team_mode: profile.team_mode,
            complexity_appetite: profile.complexity_appetite,
        });

        fetch(`/api/compare-ideas?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
        })
            .then(async (response) => {
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(payload.error || "Could not compare ideas.");
                }
                return payload;
            })
            .then((payload) => {
                setComparison(payload.comparison || null);
            })
            .catch((err) => {
                if (err.name === "AbortError") return;
                setError(err.message || "Could not compare ideas.");
            })
            .finally(() => setLoading(false));

        return () => controller.abort();
    }, [ids, isPremium, profile]);

    if (!isPremium) return <PremiumGate feature="Compare Ideas" />;

    if (loading) {
        return (
            <div className="flex items-center justify-center gap-3 p-20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="font-mono text-sm uppercase tracking-widest text-muted-foreground">Comparing validations</span>
            </div>
        );
    }

    if (error || !comparison) {
        return (
            <div className="mx-auto max-w-4xl px-4 pb-20 pt-8">
                <button
                    onClick={() => router.push("/dashboard/reports")}
                    className="mb-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                >
                    <ArrowLeft className="h-3 w-3" />
                    Back to Reports
                </button>

                <div className="rounded-2xl border border-dont/20 bg-dont/5 p-8 text-center">
                    <AlertCircle className="mx-auto h-10 w-10 text-dont" />
                    <h1 className="mt-4 font-display text-2xl font-bold text-white">Comparison unavailable</h1>
                    <p className="mt-2 text-sm text-muted-foreground">{error || "No comparison data could be created."}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 lg:px-8">
            <button
                onClick={() => router.push("/dashboard/reports")}
                className="mb-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
            >
                <ArrowLeft className="h-3 w-3" />
                Back to Reports
            </button>

            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                <div className="flex items-center gap-3">
                    <Scale className="h-6 w-6 text-primary" />
                    <h1 className="font-display text-4xl font-extrabold tracking-tight-custom text-white">Compare Ideas</h1>
                </div>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                    Side-by-side comparison of validated ideas using the same decision pack axes: proof, buyer clarity, competitor gap, timing, productization posture, next move, and kill risk.
                </p>
            </motion.div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-primary" />
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Founder profile</div>
                </div>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                    Adjust this lightweight profile to see which idea is strongest for you, not only strongest on paper.
                </p>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <label className="text-xs text-muted-foreground">
                        Technical level
                        <select
                            value={profile.technical_level}
                            onChange={(event) => setProfile((current) => ({ ...current, technical_level: event.target.value as FounderProfile["technical_level"] }))}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                        >
                            <option value="LOW">Low</option>
                            <option value="MEDIUM">Medium</option>
                            <option value="HIGH">High</option>
                        </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                        Domain familiarity
                        <select
                            value={profile.domain_familiarity}
                            onChange={(event) => setProfile((current) => ({ ...current, domain_familiarity: event.target.value as FounderProfile["domain_familiarity"] }))}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                        >
                            <option value="LOW">Low</option>
                            <option value="MEDIUM">Medium</option>
                            <option value="HIGH">High</option>
                        </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                        Sales / GTM strength
                        <select
                            value={profile.sales_gtm_strength}
                            onChange={(event) => setProfile((current) => ({ ...current, sales_gtm_strength: event.target.value as FounderProfile["sales_gtm_strength"] }))}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                        >
                            <option value="LOW">Low</option>
                            <option value="MEDIUM">Medium</option>
                            <option value="HIGH">High</option>
                        </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                        Preferred GTM motion
                        <select
                            value={profile.preferred_gtm_motion}
                            onChange={(event) => setProfile((current) => ({ ...current, preferred_gtm_motion: event.target.value as FounderProfile["preferred_gtm_motion"] }))}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                        >
                            <option value="FOUNDER_LED_SALES">Founder-led sales</option>
                            <option value="CONTENT_COMMUNITY">Content / community</option>
                            <option value="PRODUCT_LED">Product-led</option>
                            <option value="OUTBOUND">Outbound</option>
                        </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                        Available time
                        <select
                            value={profile.available_time}
                            onChange={(event) => setProfile((current) => ({ ...current, available_time: event.target.value as FounderProfile["available_time"] }))}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                        >
                            <option value="LOW">Low</option>
                            <option value="MEDIUM">Medium</option>
                            <option value="HIGH">High</option>
                        </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                        Budget tolerance
                        <select
                            value={profile.budget_tolerance}
                            onChange={(event) => setProfile((current) => ({ ...current, budget_tolerance: event.target.value as FounderProfile["budget_tolerance"] }))}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                        >
                            <option value="LOW">Low</option>
                            <option value="MEDIUM">Medium</option>
                            <option value="HIGH">High</option>
                        </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                        Solo or team
                        <select
                            value={profile.team_mode}
                            onChange={(event) => setProfile((current) => ({ ...current, team_mode: event.target.value as FounderProfile["team_mode"] }))}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                        >
                            <option value="SOLO">Solo</option>
                            <option value="TEAM">Team</option>
                        </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                        Complexity appetite
                        <select
                            value={profile.complexity_appetite}
                            onChange={(event) => setProfile((current) => ({ ...current, complexity_appetite: event.target.value as FounderProfile["complexity_appetite"] }))}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
                        >
                            <option value="LOW">Low</option>
                            <option value="MEDIUM">Medium</option>
                            <option value="HIGH">High</option>
                        </select>
                    </label>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {comparison.recommendations.best_overall && (
                    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Best overall</div>
                        <p className="mt-2 text-sm font-semibold text-white">{comparison.recommendations.best_overall.title}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{comparison.recommendations.best_overall.reason}</p>
                    </div>
                )}
                {comparison.recommendations.best_for_founder && (
                    <div className="rounded-2xl border border-violet-400/20 bg-violet-400/5 p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-violet-300">Best for you</div>
                        <p className="mt-2 text-sm font-semibold text-white">{comparison.recommendations.best_for_founder.title}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{comparison.recommendations.best_for_founder.reason}</p>
                    </div>
                )}
                {comparison.recommendations.best_fastest_to_test && (
                    <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300">Best fastest-to-test</div>
                        <p className="mt-2 text-sm font-semibold text-white">{comparison.recommendations.best_fastest_to_test.title}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{comparison.recommendations.best_fastest_to_test.reason}</p>
                    </div>
                )}
                {comparison.recommendations.best_fastest_revenue && (
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-300">Fastest to revenue</div>
                        <p className="mt-2 text-sm font-semibold text-white">{comparison.recommendations.best_fastest_revenue.title}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{comparison.recommendations.best_fastest_revenue.reason}</p>
                    </div>
                )}
                {comparison.recommendations.best_first_customer_path && (
                    <div className="rounded-2xl border border-violet-400/20 bg-violet-400/5 p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-violet-300">Best first-customer path</div>
                        <p className="mt-2 text-sm font-semibold text-white">{comparison.recommendations.best_first_customer_path.title}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{comparison.recommendations.best_first_customer_path.reason}</p>
                    </div>
                )}
                {comparison.recommendations.best_productization_posture && (
                    <div className="rounded-2xl border border-sky-400/20 bg-sky-400/5 p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-sky-300">Best productization posture</div>
                        <p className="mt-2 text-sm font-semibold text-white">{comparison.recommendations.best_productization_posture.title}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{comparison.recommendations.best_productization_posture.reason}</p>
                    </div>
                )}
                {comparison.recommendations.best_low_risk && (
                    <div className="rounded-2xl border border-build/20 bg-build/5 p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-build">Best low-risk</div>
                        <p className="mt-2 text-sm font-semibold text-white">{comparison.recommendations.best_low_risk.title}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{comparison.recommendations.best_low_risk.reason}</p>
                    </div>
                )}
                {comparison.recommendations.most_promising_needs_more_proof && (
                    <div className="rounded-2xl border border-risky/20 bg-risky/5 p-4">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-risky">Promising, needs more proof</div>
                        <p className="mt-2 text-sm font-semibold text-white">{comparison.recommendations.most_promising_needs_more_proof.title}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{comparison.recommendations.most_promising_needs_more_proof.reason}</p>
                    </div>
                )}
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Tradeoff notes</div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {comparison.tradeoff_notes.map((note, index) => (
                        <div key={`${note}-${index}`} className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-foreground/85">
                            {note}
                        </div>
                    ))}
                </div>
            </div>

            <div className={`mt-8 grid gap-4 ${comparison.ideas.length === 2 ? "xl:grid-cols-2" : comparison.ideas.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}>
                {comparison.ideas.map((idea) => (
                    <motion.div
                        key={idea.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"
                    >
                        <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-widest ${verdictTone(idea.verdict)}`}>
                                {idea.verdict}
                            </span>
                            <span className={`text-[11px] font-mono uppercase tracking-widest ${trustTone(idea.trust.level)}`}>
                                {idea.trust.score}/100 trust
                            </span>
                        </div>

                        <h2 className="mt-3 line-clamp-3 text-lg font-bold text-white">{idea.idea_text}</h2>
                        <p className="mt-2 text-xs text-muted-foreground">{idea.tradeoff_note}</p>

                        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Overall</div>
                                <div className="mt-1 text-lg font-semibold text-white">{idea.scores.overall}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Fit for you</div>
                                <div className="mt-1 text-lg font-semibold text-white">{idea.scores.founder_fit}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Fastest to test</div>
                                <div className="mt-1 text-lg font-semibold text-white">{idea.scores.fastest_to_test}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Fastest revenue</div>
                                <div className="mt-1 text-lg font-semibold text-white">{idea.scores.fastest_revenue}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">First customer</div>
                                <div className="mt-1 text-lg font-semibold text-white">{idea.scores.first_customer_access}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Productization</div>
                                <div className="mt-1 text-lg font-semibold text-white">{idea.scores.productization_readiness}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Low risk</div>
                                <div className="mt-1 text-lg font-semibold text-white">{idea.scores.low_risk}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Kill risk</div>
                                <div className="mt-1 text-lg font-semibold text-white">{idea.scores.kill_risk}</div>
                            </div>
                        </div>

                        <div className="mt-4 rounded-2xl border border-violet-400/15 bg-violet-400/5 p-4">
                            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-violet-300">Founder-market fit</div>
                            <p className="mt-2 text-sm text-foreground/90">{idea.founder_fit.fit_summary}</p>
                            <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground">
                                <div>
                                    <span className="text-white">Strongest alignment:</span> {idea.founder_fit.strongest_alignment.label} - {idea.founder_fit.strongest_alignment.summary}
                                </div>
                                <div>
                                    <span className="text-white">Biggest mismatch:</span> {idea.founder_fit.biggest_mismatch.label} - {idea.founder_fit.biggest_mismatch.summary}
                                </div>
                                <div>
                                    <span className="text-white">Founder-specific next move:</span> {idea.founder_fit.founder_specific_next_move_note}
                                </div>
                            </div>
                        </div>

                        <div className="mt-5 space-y-3">
                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center gap-2 text-primary">
                                    <CheckCircle2 className="h-4 w-4" />
                                    <div className="font-mono text-[10px] uppercase tracking-[0.14em]">Demand proof</div>
                                </div>
                                <p className="mt-2 text-sm text-foreground/90">{idea.decision_pack.demand_proof.summary}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{idea.decision_pack.demand_proof.proof_summary}</p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center gap-2 text-cyan-300">
                                    <Brain className="h-4 w-4" />
                                    <div className="font-mono text-[10px] uppercase tracking-[0.14em]">Buyer clarity</div>
                                </div>
                                <p className="mt-2 text-sm text-foreground/90">{idea.decision_pack.buyer_clarity.summary}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{idea.decision_pack.buyer_clarity.wedge_summary}</p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center gap-2 text-dont">
                                    <Target className="h-4 w-4" />
                                    <div className="font-mono text-[10px] uppercase tracking-[0.14em]">Competitor gap</div>
                                </div>
                                <p className="mt-2 text-sm text-foreground/90">{idea.decision_pack.competitor_gap.summary}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{idea.decision_pack.competitor_gap.strongest_gap}</p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center gap-2 text-amber-300">
                                    <AlertCircle className="h-4 w-4" />
                                    <div className="font-mono text-[10px] uppercase tracking-[0.14em]">Why now</div>
                                </div>
                                <p className="mt-2 text-sm text-foreground/90">{idea.decision_pack.why_now.summary}</p>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    {idea.decision_pack.why_now.timing_category} · {idea.decision_pack.why_now.momentum_direction}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center gap-2 text-build">
                                    <CheckCircle2 className="h-4 w-4" />
                                    <div className="font-mono text-[10px] uppercase tracking-[0.14em]">Next move</div>
                                </div>
                                <p className="mt-2 text-sm text-foreground/90">{idea.decision_pack.next_move.recommended_action}</p>
                                <p className="mt-2 text-xs text-muted-foreground">First step: {idea.decision_pack.next_move.first_step}</p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center gap-2 text-emerald-300">
                                    <Banknote className="h-4 w-4" />
                                    <div className="font-mono text-[10px] uppercase tracking-[0.14em]">Revenue path</div>
                                </div>
                                <p className="mt-2 text-sm text-foreground/90">{idea.decision_pack.revenue_path.summary}</p>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    {idea.decision_pack.revenue_path.recommended_entry_mode} · {idea.decision_pack.revenue_path.speed_to_revenue_band}
                                </p>
                                <p className="mt-2 text-xs text-muted-foreground">Offer: {idea.decision_pack.revenue_path.first_offer_suggestion}</p>
                                <p className="mt-2 text-xs text-muted-foreground">Pricing test: {idea.decision_pack.revenue_path.pricing_test_suggestion}</p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center gap-2 text-violet-300">
                                    <MessageSquare className="h-4 w-4" />
                                    <div className="font-mono text-[10px] uppercase tracking-[0.14em]">First customer</div>
                                </div>
                                <p className="mt-2 text-sm text-foreground/90">{idea.decision_pack.first_customer.likely_first_customer_archetype}</p>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    {idea.decision_pack.first_customer.primary_channel} · {idea.decision_pack.first_customer.confidence_score}/100 confidence
                                </p>
                                <p className="mt-2 text-xs text-muted-foreground">Angle: {idea.decision_pack.first_customer.first_outreach_angle}</p>
                                <p className="mt-2 text-xs text-muted-foreground">Proof path: {idea.decision_pack.first_customer.first_proof_path}</p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center gap-2 text-fuchsia-300">
                                    <Scale className="h-4 w-4" />
                                    <div className="font-mono text-[10px] uppercase tracking-[0.14em]">Market attack</div>
                                </div>
                                <p className="mt-2 text-sm text-foreground/90">
                                    {idea.market_attack.best_overall_attack_mode?.mode || "No clear attack mode yet"}
                                </p>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    {idea.market_attack.best_overall_attack_mode?.reason || "Attack strategy is still being inferred from the current signal mix."}
                                </p>
                                <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground">
                                    {idea.market_attack.best_fastest_revenue_mode && (
                                        <div>Fastest revenue: {idea.market_attack.best_fastest_revenue_mode.mode}</div>
                                    )}
                                    {idea.market_attack.best_lowest_risk_mode && (
                                        <div>Lowest risk: {idea.market_attack.best_lowest_risk_mode.mode}</div>
                                    )}
                                    {idea.market_attack.most_scalable_mode && (
                                        <div>Most scalable: {idea.market_attack.most_scalable_mode.mode}</div>
                                    )}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center gap-2 text-sky-300">
                                    <Scale className="h-4 w-4" />
                                    <div className="font-mono text-[10px] uppercase tracking-[0.14em]">Productization posture</div>
                                </div>
                                <p className="mt-2 text-sm text-foreground/90">
                                    {idea.service_first_pathfinder.recommended_productization_posture}
                                </p>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    {idea.service_first_pathfinder.posture_rationale}
                                </p>
                                <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground">
                                    <div>Strongest reason: {idea.service_first_pathfinder.strongest_reason_for_posture}</div>
                                    <div>Main caution: {idea.service_first_pathfinder.strongest_caution}</div>
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    Before productizing: {idea.service_first_pathfinder.what_must_become_true_before_productization.slice(0, 2).join(" / ")}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center gap-2 text-risky">
                                    <AlertCircle className="h-4 w-4" />
                                    <div className="font-mono text-[10px] uppercase tracking-[0.14em]">Anti-idea</div>
                                </div>
                                <p className="mt-2 text-sm text-foreground/90">
                                    {idea.anti_idea.verdict.label.replace(/_/g, " ")}
                                </p>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    {idea.anti_idea.strongest_reason_to_wait_pivot_or_kill}
                                </p>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    Improve: {idea.anti_idea.what_would_need_to_improve.slice(0, 2).join(" / ")}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex items-center gap-2 text-risky">
                                    <Shield className="h-4 w-4" />
                                    <div className="font-mono text-[10px] uppercase tracking-[0.14em]">Kill criteria</div>
                                </div>
                                <div className="mt-2 space-y-2">
                                    {idea.decision_pack.kill_criteria.items.slice(0, 2).map((item, index) => (
                                        <div key={`${item}-${index}`} className="rounded-xl border border-risky/15 bg-risky/5 p-2 text-xs text-foreground/85">
                                            {item}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Inference notes</div>
                            <div className="mt-2 text-xs text-muted-foreground">
                                {[...idea.direct_vs_inferred.inferred_markers, ...idea.founder_fit.direct_vs_inferred.inferred_markers].slice(0, 5).join(" • ")}
                            </div>
                        </div>

                        <Link
                            href={idea.href}
                            className="mt-4 inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-primary transition-colors hover:text-primary/80"
                        >
                            Open full report
                        </Link>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}
