import { buildAntiIdeaAnalysis, type AntiIdeaAnalysis } from "@/lib/anti-idea";
import type { DecisionPack } from "@/lib/decision-pack";
import { buildFounderMarketFit, defaultFounderProfile, normalizeFounderProfile, type FounderMarketFit, type FounderProfile } from "@/lib/founder-market-fit";
import { buildMarketAttackSimulation, type MarketAttackSimulation } from "@/lib/market-attack-simulator";
import { buildServiceFirstSaasPathfinder, type ServiceFirstSaasPathfinder } from "@/lib/service-first-saas-pathfinder";
import type { EnrichedValidationView } from "@/lib/validation-insights";

export interface ComparedIdea {
    id: string;
    idea_text: string;
    href: string;
    created_at: string | null;
    verdict: string;
    trust: {
        level: "HIGH" | "MEDIUM" | "LOW";
        score: number;
        freshness_label: string;
    };
    decision_pack: DecisionPack;
    founder_fit: FounderMarketFit;
    market_attack: MarketAttackSimulation;
    anti_idea: AntiIdeaAnalysis;
    service_first_pathfinder: ServiceFirstSaasPathfinder;
    scores: {
        overall: number;
        founder_fit: number;
        fastest_to_test: number;
        fastest_revenue: number;
        first_customer_access: number;
        productization_readiness: number;
        low_risk: number;
        demand_strength: number;
        buyer_clarity: number;
        competitor_opening: number;
        why_now_strength: number;
        kill_risk: number;
    };
    tradeoff_note: string;
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

export interface CompareIdeasResult {
    compared_at: string;
    compared_count: number;
    founder_profile: FounderProfile;
    ideas: ComparedIdea[];
    recommendations: {
        best_overall: { id: string; title: string; reason: string } | null;
        best_for_founder: { id: string; title: string; reason: string } | null;
        best_fastest_to_test: { id: string; title: string; reason: string } | null;
        best_fastest_revenue: { id: string; title: string; reason: string } | null;
        best_first_customer_path: { id: string; title: string; reason: string } | null;
        best_productization_posture: { id: string; title: string; reason: string } | null;
        best_low_risk: { id: string; title: string; reason: string } | null;
        most_promising_needs_more_proof: { id: string; title: string; reason: string } | null;
    };
    tradeoff_notes: string[];
}

type ComparableValidation = EnrichedValidationView & {
    verdict: string;
    decision_pack: DecisionPack;
};

function clamp(value: number, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(value)));
}

function demandStrength(pack: DecisionPack) {
    return clamp(
        pack.demand_proof.evidence_count * 4 +
        pack.demand_proof.source_count * 10 +
        pack.demand_proof.direct_quote_count * 10,
    );
}

function buyerClarity(pack: DecisionPack) {
    return clamp(
        (pack.buyer_clarity.icp_summary ? 35 : 0) +
        (pack.buyer_clarity.budget_summary ? 20 : 0) +
        Math.min(pack.buyer_clarity.buying_triggers.length, 3) * 12 +
        (pack.buyer_clarity.wedge_summary ? 15 : 0),
    );
}

function competitorOpening(pack: DecisionPack) {
    return clamp(
        (pack.competitor_gap.live_weakness ? 45 : 15) +
        (pack.competitor_gap.live_weakness?.trust_level === "HIGH" ? 25 : pack.competitor_gap.live_weakness?.trust_level === "MEDIUM" ? 15 : 5) +
        (pack.competitor_gap.strongest_gap ? 20 : 0),
    );
}

function whyNowStrength(pack: DecisionPack) {
    const momentumScore =
        pack.why_now.momentum_direction === "accelerating" ? 35 :
        pack.why_now.momentum_direction === "steady" ? 24 :
        pack.why_now.momentum_direction === "new" ? 18 :
        pack.why_now.momentum_direction === "cooling" ? 8 : 10;

    const categoryScore = pack.why_now.timing_category === "Unknown / weak signal" ? 8 : 24;
    const confidenceScore =
        pack.why_now.confidence_level === "HIGH" ? 30 :
        pack.why_now.confidence_level === "MEDIUM" ? 20 : 10;

    return clamp(momentumScore + categoryScore + confidenceScore);
}

function killRisk(pack: DecisionPack, verdict: string, trustScore: number) {
    const verdictUpper = verdict.toUpperCase();
    const verdictPenalty =
        verdictUpper.includes("DON") ? 45 :
        verdictUpper.includes("RISKY") ? 28 :
        10;

    return clamp(
        verdictPenalty +
        pack.kill_criteria.items.length * 10 +
        (100 - trustScore) * 0.25,
    );
}

function fastestToTest(pack: DecisionPack, trustScore: number) {
    return clamp(
        trustScore * 0.22 +
        demandStrength(pack) * 0.28 +
        whyNowStrength(pack) * 0.14 +
        (100 - killRisk(pack, pack.verdict.label, trustScore)) * 0.18 +
        (pack.next_move.first_step ? 12 : 0) +
        (pack.next_move.recommended_action ? 8 : 0),
    );
}

function fastestRevenue(pack: DecisionPack, trustScore: number) {
    const speedBandScore =
        pack.revenue_path.speed_to_revenue_band === "1-2 weeks" ? 88 :
        pack.revenue_path.speed_to_revenue_band === "2-6 weeks" ? 72 :
        pack.revenue_path.speed_to_revenue_band === "1-3 months" ? 52 :
        30;

    const entryModeBonus =
        pack.revenue_path.recommended_entry_mode === "Service-first" ? 12 :
        pack.revenue_path.recommended_entry_mode === "Concierge MVP" ? 10 :
        pack.revenue_path.recommended_entry_mode === "Template / workflow product" ? 10 :
        pack.revenue_path.recommended_entry_mode === "Plugin / add-on wedge" ? 8 :
        pack.revenue_path.recommended_entry_mode === "Hybrid service + software" ? 6 :
        pack.revenue_path.recommended_entry_mode === "SaaS-first" ? 3 :
        0;

    return clamp(
        speedBandScore * 0.35 +
        pack.revenue_path.confidence_score * 0.25 +
        pack.revenue_path.dimensions.find((dimension) => dimension.key === "customer_reachability")!.score * 0.15 +
        pack.revenue_path.dimensions.find((dimension) => dimension.key === "willingness_to_pay_evidence")!.score * 0.15 +
        (100 - killRisk(pack, pack.verdict.label, trustScore)) * 0.1 +
        entryModeBonus,
    );
}

function firstCustomerAccess(pack: DecisionPack, founderFit: FounderMarketFit) {
    const gtmFit = founderFit.dimensions.find((dimension) => dimension.key === "gtm_fit")?.score || 50;
    const domainFit = founderFit.dimensions.find((dimension) => dimension.key === "domain_fit")?.score || 50;
    const channelAccessibility = pack.first_customer.dimensions.find((dimension) => dimension.key === "channel_accessibility")?.score || 50;
    const buyerReachability = pack.first_customer.dimensions.find((dimension) => dimension.key === "buyer_reachability")?.score || 50;

    return clamp(
        pack.first_customer.confidence_score * 0.34 +
        buyerReachability * 0.18 +
        channelAccessibility * 0.16 +
        gtmFit * 0.2 +
        domainFit * 0.12,
    );
}

function productizationReadiness(pathfinder: ServiceFirstSaasPathfinder) {
    return pathfinder.productization_readiness_score;
}

function lowRisk(pack: DecisionPack, trustScore: number) {
    return clamp(
        trustScore * 0.45 +
        demandStrength(pack) * 0.15 +
        (100 - killRisk(pack, pack.verdict.label, trustScore)) * 0.4,
    );
}

function overall(pack: DecisionPack, trustScore: number) {
    return clamp(
        trustScore * 0.24 +
        demandStrength(pack) * 0.18 +
        buyerClarity(pack) * 0.1 +
        competitorOpening(pack) * 0.14 +
        whyNowStrength(pack) * 0.12 +
        fastestToTest(pack, trustScore) * 0.1 +
        lowRisk(pack, trustScore) * 0.12,
    );
}

function unique<T>(values: T[]) {
    return [...new Set(values)];
}

function buildTradeoffNote(idea: ComparedIdea) {
    if (idea.anti_idea.verdict.label === "KILL_FOR_NOW") {
        return "The anti-idea case is too strong right now; this needs a real signal change before it deserves more time.";
    }
    if (idea.anti_idea.verdict.label === "PIVOT") {
        return "There may be something here, but the current wedge or founder fit likely needs a pivot before acting.";
    }
    if (idea.founder_fit.fit_score >= 78 && idea.scores.overall < 72) {
        return "This may not be the strongest market on paper, but it matches your profile unusually well.";
    }
    if (idea.scores.fastest_revenue >= 76 && idea.scores.overall < 72) {
        return "Not the strongest overall market, but it may be the quickest route to first revenue.";
    }
    if (idea.service_first_pathfinder.recommended_productization_posture === "Wait and validate more first") {
        return "Interesting signal, but the productization posture still says to validate more before committing.";
    }
    if (idea.service_first_pathfinder.recommended_productization_posture === "Stay service-first") {
        return "The best move may be to sell the outcome first and delay productization until the workflow repeats more clearly.";
    }
    if (idea.service_first_pathfinder.recommended_productization_posture === "Start hybrid service + software") {
        return "There is real promise here, but a hybrid posture looks safer than a pure product bet right now.";
    }
    if (idea.scores.first_customer_access >= 76 && idea.scores.fastest_revenue < 70) {
        return "Customer access looks unusually good here, even if the broader revenue path still needs shaping.";
    }
    if (idea.founder_fit.fit_score <= 55 && idea.scores.overall >= 72) {
        return "Strong market case, but it asks more from you than your current profile cleanly supports.";
    }
    if (idea.scores.why_now_strength >= 70 && idea.scores.demand_strength < 55) {
        return "Strong timing signal, but it still needs stronger direct demand proof.";
    }
    if (idea.scores.low_risk >= 70 && idea.scores.overall < 70) {
        return "Safer option to pursue, but the upside looks more measured than the strongest alternatives.";
    }
    if (idea.scores.competitor_opening >= 70 && idea.trust.score < 65) {
        return "Clear competitor wedge, but the current proof is not strong enough to overcommit yet.";
    }
    if (idea.scores.fastest_to_test >= 72) {
        return "This is the easiest option to pressure-test quickly without a long build cycle.";
    }
    return "Balanced opportunity, but the final choice depends on whether you optimize for certainty, speed, or wedge strength.";
}

function pickBest(ideas: ComparedIdea[], key: keyof ComparedIdea["scores"]) {
    return [...ideas].sort((a, b) => b.scores[key] - a.scores[key])[0] || null;
}

export function buildIdeasComparison(validations: EnrichedValidationView[]): CompareIdeasResult {
    return buildIdeasComparisonForFounder(validations, defaultFounderProfile());
}

function isComparableValidation(validation: EnrichedValidationView): validation is ComparableValidation {
    return Boolean(validation.decision_pack && typeof validation.verdict === "string" && validation.verdict.trim());
}

export function buildIdeasComparisonForFounder(validations: EnrichedValidationView[], founderProfileInput: FounderProfile | Record<string, unknown>) {
    const founderProfile = normalizeFounderProfile(founderProfileInput as Record<string, unknown>);
    const ideas = validations.filter(isComparableValidation).map((validation) => {
        const pack = validation.decision_pack;
        const trustScore = validation.trust.score;
        const founderFit = buildFounderMarketFit(pack, founderProfile);
        const marketAttack = buildMarketAttackSimulation({
            idea_text: validation.idea_text,
            verdict: validation.verdict,
            trust: validation.trust,
            competitor_gap: pack.competitor_gap,
            why_now: pack.why_now,
            revenue_path: pack.revenue_path,
            first_customer: pack.first_customer,
            founder_fit: founderFit,
        });
        const antiIdea = buildAntiIdeaAnalysis({
            trust: validation.trust,
            demand_proof: pack.demand_proof,
            buyer_clarity: pack.buyer_clarity,
            competitor_gap: pack.competitor_gap,
            why_now: pack.why_now,
            revenue_path: pack.revenue_path,
            first_customer: pack.first_customer,
            market_attack: marketAttack,
            founder_fit: founderFit,
        });
        const serviceFirstPathfinder = buildServiceFirstSaasPathfinder({
            trust: validation.trust,
            demand_proof: pack.demand_proof,
            buyer_clarity: pack.buyer_clarity,
            competitor_gap: pack.competitor_gap,
            why_now: pack.why_now,
            revenue_path: pack.revenue_path,
            first_customer: pack.first_customer,
            market_attack: marketAttack,
            anti_idea: antiIdea,
            founder_fit: founderFit,
        });
        const compared: ComparedIdea = {
            id: validation.id,
            idea_text: validation.idea_text,
            href: `/dashboard/reports/${validation.id}`,
            created_at: validation.created_at,
            verdict: validation.verdict,
            trust: {
                level: validation.trust.level,
                score: validation.trust.score,
                freshness_label: validation.trust.freshness_label,
            },
            decision_pack: pack,
            founder_fit: founderFit,
            market_attack: marketAttack,
            anti_idea: antiIdea,
            service_first_pathfinder: serviceFirstPathfinder,
            scores: {
                overall: overall(pack, trustScore),
                founder_fit: founderFit.fit_score,
                fastest_to_test: fastestToTest(pack, trustScore),
                fastest_revenue: fastestRevenue(pack, trustScore),
                first_customer_access: firstCustomerAccess(pack, founderFit),
                productization_readiness: productizationReadiness(serviceFirstPathfinder),
                low_risk: lowRisk(pack, trustScore),
                demand_strength: demandStrength(pack),
                buyer_clarity: buyerClarity(pack),
                competitor_opening: competitorOpening(pack),
                why_now_strength: whyNowStrength(pack),
                kill_risk: killRisk(pack, validation.verdict, trustScore),
            },
            tradeoff_note: "",
            direct_vs_inferred: {
                direct_evidence_count: pack.demand_proof.direct_vs_inferred.direct_evidence_count,
                inferred_markers: unique([
                    ...pack.confidence.direct_vs_inferred.inferred_markers,
                    ...pack.demand_proof.direct_vs_inferred.inferred_markers,
                    ...pack.competitor_gap.direct_vs_inferred.inferred_markers,
                    ...pack.why_now.direct_vs_inferred.inferred_markers,
                    ...pack.revenue_path.direct_vs_inferred.inferred_markers,
                    ...pack.first_customer.direct_vs_inferred.inferred_markers,
                    ...(marketAttack.modes[0]?.direct_vs_inferred.inferred_markers || []),
                    ...antiIdea.direct_vs_inferred.inferred_markers,
                    ...serviceFirstPathfinder.direct_vs_inferred.inferred_markers,
                ]).slice(0, 4),
            },
        };

        compared.tradeoff_note = buildTradeoffNote(compared);
        return compared;
    });

    const bestOverall = pickBest(ideas, "overall");
    const bestForFounder = pickBest(ideas, "founder_fit");
    const bestFastest = pickBest(ideas, "fastest_to_test");
    const bestFastestRevenue = pickBest(ideas, "fastest_revenue");
    const bestFirstCustomerPath = pickBest(ideas, "first_customer_access");
    const bestProductizationPosture = pickBest(ideas, "productization_readiness");
    const bestLowRisk = pickBest(ideas, "low_risk");
    const mostPromisingNeedsMoreProof = [...ideas]
        .filter((idea) => idea.scores.why_now_strength >= 60 && idea.scores.demand_strength < 60)
        .sort((a, b) => (b.scores.why_now_strength - a.scores.why_now_strength) || (a.scores.demand_strength - b.scores.demand_strength))[0] || null;

    return {
        compared_at: new Date().toISOString(),
        compared_count: ideas.length,
        founder_profile: founderProfile,
        ideas,
        recommendations: {
            best_overall: bestOverall ? {
                id: bestOverall.id,
                title: bestOverall.idea_text,
                reason: `Best overall because it balances confidence, demand proof, and a usable next move better than the others.`,
            } : null,
            best_for_founder: bestForFounder ? {
                id: bestForFounder.id,
                title: bestForFounder.idea_text,
                reason: `Best for you because it aligns most cleanly with your current strengths, constraints, and preferred go-to-market motion.`,
            } : null,
            best_fastest_to_test: bestFastest ? {
                id: bestFastest.id,
                title: bestFastest.idea_text,
                reason: `Best fastest-to-test because the proof is actionable enough to run a validation sprint quickly.`,
            } : null,
            best_fastest_revenue: bestFastestRevenue ? {
                id: bestFastestRevenue.id,
                title: bestFastestRevenue.idea_text,
                reason: `Fastest route to first revenue because the entry mode, customer path, and proof level line up better than the alternatives.`,
            } : null,
            best_first_customer_path: bestFirstCustomerPath ? {
                id: bestFirstCustomerPath.id,
                title: bestFirstCustomerPath.idea_text,
                reason: `Best first-customer path because the channel, outreach angle, and founder-channel fit are the clearest here.`,
            } : null,
            best_productization_posture: bestProductizationPosture ? {
                id: bestProductizationPosture.id,
                title: bestProductizationPosture.idea_text,
                reason: `${bestProductizationPosture.service_first_pathfinder.recommended_productization_posture} looks best here because the current market, founder, and entry conditions support that posture more cleanly than the alternatives.`,
            } : null,
            best_low_risk: bestLowRisk ? {
                id: bestLowRisk.id,
                title: bestLowRisk.idea_text,
                reason: `Best low-risk because the confidence is steadier and the kill risk is lower than the alternatives.`,
            } : null,
            most_promising_needs_more_proof: mostPromisingNeedsMoreProof ? {
                id: mostPromisingNeedsMoreProof.id,
                title: mostPromisingNeedsMoreProof.idea_text,
                reason: `Most promising but still proof-sensitive because timing looks strong while direct demand proof is still catching up.`,
            } : null,
        },
        tradeoff_notes: unique(ideas.map((idea) => idea.tradeoff_note)),
    };
}
