import type { FirstCustomerPlan } from "@/lib/first-customer";
import type { MarketAttackSimulation } from "@/lib/market-attack-simulator";
import type { OpportunityRevenuePath } from "@/lib/opportunity-to-revenue";
import type { TrustLevel } from "@/lib/trust";

export type AntiIdeaVerdictLabel = "LOW_CONCERN" | "WAIT" | "PIVOT" | "KILL_FOR_NOW";

export type AntiIdeaCategory =
    | "Pain is weak or too noisy"
    | "Buyer willingness is unclear"
    | "Customer access is too hard"
    | "Competition is stronger than it looks"
    | "Timing is weak or hype-driven"
    | "Entry modes are unattractive"
    | "Build complexity is too high"
    | "Founder fit is poor"
    | "Proof is insufficient"
    | "Better wedge needed before acting";

export interface AntiIdeaWeakPoint {
    category: AntiIdeaCategory;
    severity_score: number;
    summary: string;
    strongest_reason: string;
    what_would_need_to_improve: string;
}

export interface AntiIdeaAnalysis {
    verdict: {
        label: AntiIdeaVerdictLabel;
        summary: string;
    };
    top_disqualifying_risks: string[];
    weak_points: AntiIdeaWeakPoint[];
    strongest_reason_to_wait_pivot_or_kill: string;
    missing_evidence_note: string;
    what_would_need_to_improve: string[];
    confidence_level: TrustLevel;
    confidence_score: number;
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

interface FounderFitLike {
    fit_score: number;
    biggest_mismatch?: {
        label: string;
        summary: string;
    };
    dimensions: Array<{
        key: string;
        score: number;
    }>;
}

interface AntiIdeaInput {
    trust: {
        level: TrustLevel;
        score: number;
        weak_signal?: boolean;
        weak_signal_reasons?: string[];
        direct_quote_count?: number;
    };
    demand_proof: {
        evidence_count: number;
        direct_quote_count: number;
        source_count: number;
        direct_vs_inferred: {
            direct_evidence_count: number;
            inferred_markers: string[];
        };
    };
    buyer_clarity: {
        icp_summary: string;
        wedge_summary: string;
        budget_summary: string | null;
        buying_triggers: string[];
    };
    competitor_gap: {
        summary: string;
        strongest_gap: string;
        live_weakness: null | {
            weakness_category: string;
            summary: string;
            trust_level: TrustLevel;
        };
    };
    why_now: {
        timing_category: string;
        confidence_level: TrustLevel;
        momentum_direction: "accelerating" | "steady" | "cooling" | "new" | "unknown";
    };
    revenue_path: OpportunityRevenuePath;
    first_customer: FirstCustomerPlan;
    market_attack: MarketAttackSimulation;
    founder_fit?: FounderFitLike | null;
}

function clamp(value: number, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(value)));
}

function confidenceFromScore(score: number): TrustLevel {
    if (score >= 75) return "HIGH";
    if (score >= 50) return "MEDIUM";
    return "LOW";
}

function dimensionScore<T extends { key: string; score: number }>(dimensions: T[], key: string, fallback = 50) {
    return dimensions.find((dimension) => dimension.key === key)?.score ?? fallback;
}

function unique(values: string[]) {
    return [...new Set(values.filter(Boolean))];
}

function genericWedge(text: string) {
    return /everyone|teams|businesses|founders|companies|users|general/i.test(text);
}

function weakPoints(input: AntiIdeaInput): AntiIdeaWeakPoint[] {
    const points: AntiIdeaWeakPoint[] = [];
    const proofSeverity = clamp(
        (input.demand_proof.evidence_count < 6 ? 25 : 0) +
        (input.demand_proof.direct_quote_count === 0 ? 28 : 0) +
        (input.demand_proof.source_count < 2 ? 20 : 0) +
        (100 - input.trust.score) * 0.25,
    );

    if (proofSeverity >= 48) {
        points.push({
            category: "Proof is insufficient",
            severity_score: proofSeverity,
            summary: "The idea still lacks enough direct, repeated proof to justify strong conviction.",
            strongest_reason: input.demand_proof.direct_quote_count === 0
                ? "There are no direct buyer pain quotes anchoring the opportunity yet."
                : "The signal is still too thin across sources to count as robust proof.",
            what_would_need_to_improve: "Collect stronger direct quotes, more repeated evidence, and broader source support before committing.",
        });
    }

    const painSeverity = clamp(
        (input.trust.weak_signal ? 32 : 0) +
        (input.demand_proof.direct_quote_count === 0 ? 18 : 0) +
        (input.demand_proof.evidence_count < 8 ? 18 : 0) +
        (input.demand_proof.source_count < 2 ? 12 : 0),
    );
    if (painSeverity >= 45) {
        points.push({
            category: "Pain is weak or too noisy",
            severity_score: painSeverity,
            summary: "The pain signal is still noisy enough that it may be more interesting than urgent.",
            strongest_reason: input.trust.weak_signal
                ? input.trust.weak_signal_reasons?.[0] || "The current signal is explicitly weak."
                : "The pain does not yet look concentrated enough across direct evidence.",
            what_would_need_to_improve: "Find more repeated buyer-language pain, not just broad discussion or inferred frustration.",
        });
    }

    const wtpScore = dimensionScore(input.revenue_path.dimensions, "willingness_to_pay_evidence");
    const buyerWillingnessSeverity = clamp(
        (100 - wtpScore) * 0.7 +
        (!input.buyer_clarity.budget_summary ? 18 : 0),
    );
    if (buyerWillingnessSeverity >= 48) {
        points.push({
            category: "Buyer willingness is unclear",
            severity_score: buyerWillingnessSeverity,
            summary: "The market may care, but buyer willingness still looks under-proven.",
            strongest_reason: !input.buyer_clarity.budget_summary
                ? "There is no clear budget anchor yet."
                : "Willingness-to-pay evidence is still too soft for a confident revenue path.",
            what_would_need_to_improve: "Get stronger pricing conversations, paid pilot interest, or cleaner willingness-to-pay signals.",
        });
    }

    const accessSeverity = clamp(
        (100 - dimensionScore(input.first_customer.dimensions, "buyer_reachability")) * 0.35 +
        (100 - dimensionScore(input.first_customer.dimensions, "channel_accessibility")) * 0.35 +
        (100 - dimensionScore(input.first_customer.dimensions, "outreach_friendliness")) * 0.3,
    );
    if (accessSeverity >= 52) {
        points.push({
            category: "Customer access is too hard",
            severity_score: accessSeverity,
            summary: "The first-customer path is still too hard or too fuzzy for fast progress.",
            strongest_reason: input.first_customer.main_acquisition_friction,
            what_would_need_to_improve: "Tighten the first channel, message angle, and buyer concentration before investing more build effort.",
        });
    }

    const competitionSeverity = clamp(
        (!input.competitor_gap.live_weakness ? 28 : 0) +
        (/not sharply defined|not clearly defined/i.test(input.competitor_gap.strongest_gap) ? 22 : 0) +
        (input.competitor_gap.live_weakness?.trust_level === "LOW" ? 12 : 0),
    );
    if (competitionSeverity >= 42) {
        points.push({
            category: "Competition is stronger than it looks",
            severity_score: competitionSeverity,
            summary: "The competitive opening may be weaker than the current optimism suggests.",
            strongest_reason: input.competitor_gap.live_weakness
                ? "The live competitor weakness signal exists, but it is not strong enough yet to assume an easy wedge."
                : "There is no strong live weakness cluster overlapping the current competitor picture.",
            what_would_need_to_improve: "Find a sharper and better-supported competitor weakness before assuming you can wedge in cleanly.",
        });
    }

    const timingSeverity = clamp(
        (input.why_now.timing_category === "Unknown / weak signal" ? 34 : 0) +
        (input.why_now.momentum_direction === "cooling" ? 24 : 0) +
        (input.why_now.momentum_direction === "unknown" ? 18 : 0) +
        (input.why_now.timing_category === "AI capability shift" && input.why_now.confidence_level === "LOW" ? 20 : 0),
    );
    if (timingSeverity >= 42) {
        points.push({
            category: "Timing is weak or hype-driven",
            severity_score: timingSeverity,
            summary: "The timing case is not strong enough yet to treat this as a real entry window.",
            strongest_reason: input.why_now.timing_category === "AI capability shift" && input.why_now.confidence_level === "LOW"
                ? "The timing story may be driven more by hype than by durable market shift."
                : "Timing momentum and confidence are still too soft.",
            what_would_need_to_improve: "Wait for cleaner momentum, stronger timing evidence, or repeated movement over time.",
        });
    }

    const bestAttack = input.market_attack.best_overall_attack_mode?.mode;
    const bestAttackScore = [...input.market_attack.modes].sort((a, b) => b.fit_score - a.fit_score)[0]?.fit_score || 0;
    const entrySeverity = clamp(
        (bestAttack === "Interview-only / proof-first" ? 38 : 0) +
        (input.revenue_path.recommended_entry_mode === "Test-only / interviews first" ? 28 : 0) +
        (bestAttackScore < 62 ? 22 : 0),
    );
    if (entrySeverity >= 45) {
        points.push({
            category: "Entry modes are unattractive",
            severity_score: entrySeverity,
            summary: "The current set of entry options is not attractive enough yet for decisive action.",
            strongest_reason: bestAttack === "Interview-only / proof-first"
                ? "Even the best current attack mode still leans toward proof gathering rather than confident entry."
                : "No attack mode currently clears a strong-enough threshold.",
            what_would_need_to_improve: "Improve proof, sharpen the wedge, or reduce complexity until a cleaner entry mode emerges.",
        });
    }

    const complexitySeverity = clamp(
        (100 - dimensionScore(input.revenue_path.dimensions, "implementation_complexity")) * 0.7 +
        (100 - [...input.market_attack.modes].sort((a, b) => a.complexity - b.complexity)[0]?.complexity || 50) * 0.1,
    );
    if (complexitySeverity >= 48) {
        points.push({
            category: "Build complexity is too high",
            severity_score: complexitySeverity,
            summary: "The build or delivery burden still looks too high for a clean first move.",
            strongest_reason: input.revenue_path.main_execution_risk,
            what_would_need_to_improve: "Narrow the offer or choose a lighter entry mode before committing to a larger build.",
        });
    }

    if (input.founder_fit) {
        const founderSeverity = clamp(
            (100 - input.founder_fit.fit_score) * 0.75 +
            (100 - dimensionScore(input.founder_fit.dimensions, "gtm_fit", 50)) * 0.1,
        );
        if (founderSeverity >= 48) {
            points.push({
                category: "Founder fit is poor",
                severity_score: founderSeverity,
                summary: "The opportunity may be real, but it does not fit this founder cleanly right now.",
                strongest_reason: input.founder_fit.biggest_mismatch
                    ? `${input.founder_fit.biggest_mismatch.label}: ${input.founder_fit.biggest_mismatch.summary}`
                    : "Founder-market fit is weaker than the rest of the opportunity picture.",
                what_would_need_to_improve: "Change the wedge, entry mode, or founder constraints before treating this as the best move.",
            });
        }
    }

    const wedgeSeverity = clamp(
        (genericWedge(input.buyer_clarity.wedge_summary) ? 28 : 0) +
        (dimensionScore(input.first_customer.dimensions, "niche_concentration") < 55 ? 20 : 0) +
        (/not sharply defined/i.test(input.competitor_gap.strongest_gap) ? 18 : 0),
    );
    if (wedgeSeverity >= 42) {
        points.push({
            category: "Better wedge needed before acting",
            severity_score: wedgeSeverity,
            summary: "The opportunity may need a narrower wedge before it becomes truly attackable.",
            strongest_reason: genericWedge(input.buyer_clarity.wedge_summary)
                ? "The current wedge still reads too broad."
                : "The niche concentration is still not high enough to support focused action.",
            what_would_need_to_improve: "Tighten the ICP, sharpen the wedge, and anchor it to a clearer competitor or workflow gap.",
        });
    }

    return points.sort((a, b) => b.severity_score - a.severity_score);
}

function verdictFromWeakPoints(points: AntiIdeaWeakPoint[]) {
    const severe = points.filter((point) => point.severity_score >= 70);
    const medium = points.filter((point) => point.severity_score >= 50);
    const top = points[0];

    if (!top || top.severity_score < 45) {
        return {
            label: "LOW_CONCERN" as const,
            summary: "There are reasons to stay disciplined, but none currently disqualify the idea strongly on this surface.",
        };
    }

    if (top.category === "Founder fit is poor" || top.category === "Better wedge needed before acting") {
        return {
            label: "PIVOT" as const,
            summary: "The opportunity may still be real, but the current wedge or founder-fit picture suggests a pivot before acting.",
        };
    }

    if (severe.length >= 2 || top.severity_score >= 84) {
        return {
            label: "KILL_FOR_NOW" as const,
            summary: "The current disqualifying risks are strong enough that this should be treated as a no-go for now unless the signal changes materially.",
        };
    }

    if (medium.length >= 2) {
        return {
            label: "WAIT" as const,
            summary: "There is still too much unresolved risk to move decisively right now.",
        };
    }

    return {
        label: "WAIT" as const,
        summary: "This may still become viable, but one major blocker needs to improve before acting.",
    };
}

export function buildAntiIdeaAnalysis(input: AntiIdeaInput): AntiIdeaAnalysis {
    const points = weakPoints(input);
    const verdict = verdictFromWeakPoints(points);
    const confidenceScore = clamp(
        input.trust.score * 0.55 +
        (input.demand_proof.direct_vs_inferred.direct_evidence_count * 12) +
        (points.length > 0 ? 10 : 0),
    );

    const topRisks = points.slice(0, 3).map((point) => point.summary);
    const topPoint = points[0];
    const missingEvidenceNote =
        input.demand_proof.direct_quote_count === 0
            ? "Direct buyer quotes are still missing, which makes the negative case harder to dismiss."
            : input.demand_proof.source_count < 2
                ? "The signal still leans too heavily on a narrow evidence base."
                : "More direct buyer proof would make the go / no-go decision materially stronger.";

    return {
        verdict,
        top_disqualifying_risks: topRisks,
        weak_points: points,
        strongest_reason_to_wait_pivot_or_kill: topPoint?.strongest_reason || "No strong anti-idea blocker surfaced from the current signal mix.",
        missing_evidence_note: missingEvidenceNote,
        what_would_need_to_improve: unique(points.slice(0, 3).map((point) => point.what_would_need_to_improve)),
        confidence_level: confidenceFromScore(confidenceScore),
        confidence_score: confidenceScore,
        direct_vs_inferred: {
            direct_evidence_count: input.demand_proof.direct_vs_inferred.direct_evidence_count,
            inferred_markers: unique([
                "Anti-idea analysis converts weak dimensions into explicit reasons not to act yet",
                input.founder_fit ? "Founder-fit was included on this surface" : "Founder-fit was not available on this surface",
            ]),
        },
    };
}
