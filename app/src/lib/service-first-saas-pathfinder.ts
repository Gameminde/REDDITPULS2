import type { AntiIdeaAnalysis } from "@/lib/anti-idea";
import type { FirstCustomerPlan } from "@/lib/first-customer";
import type { FounderMarketFit } from "@/lib/founder-market-fit";
import type { MarketAttackSimulation } from "@/lib/market-attack-simulator";
import type { OpportunityRevenuePath } from "@/lib/opportunity-to-revenue";
import type { TrustLevel } from "@/lib/trust";

export type ProductizationPosture =
    | "Stay service-first"
    | "Start hybrid service + software"
    | "Productize now"
    | "Concierge MVP first"
    | "Wait and validate more first";

export type ServiceFirstPathfinderDimensionKey =
    | "buyer_trust_barrier"
    | "implementation_complexity"
    | "first_customer_friction"
    | "revenue_speed"
    | "repeatability"
    | "founder_fit"
    | "market_clarity"
    | "wedge_sharpness";

export interface ServiceFirstPathfinderDimension {
    key: ServiceFirstPathfinderDimensionKey;
    label: string;
    score: number;
    summary: string;
}

export interface ServiceFirstSaasPathfinder {
    recommended_productization_posture: ProductizationPosture;
    posture_rationale: string;
    strongest_reason_for_posture: string;
    strongest_caution: string;
    what_must_become_true_before_productization: string[];
    confidence_level: TrustLevel;
    confidence_score: number;
    productization_readiness_score: number;
    dimensions: ServiceFirstPathfinderDimension[];
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

interface PathfinderDemandProof {
    evidence_count: number;
    direct_quote_count: number;
    source_count: number;
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

interface PathfinderBuyerClarity {
    summary: string;
    wedge_summary: string;
    icp_summary: string;
    budget_summary: string | null;
}

interface PathfinderCompetitorGap {
    strongest_gap: string;
    live_weakness: null | {
        weakness_category: string;
        summary: string;
        trust_level: TrustLevel;
    };
}

interface PathfinderWhyNow {
    timing_category: string;
    confidence_level: TrustLevel;
    momentum_direction: "accelerating" | "steady" | "cooling" | "new" | "unknown";
}

interface ServiceFirstPathfinderInput {
    trust: {
        level: TrustLevel;
        score: number;
        weak_signal?: boolean;
        weak_signal_reasons?: string[];
    };
    demand_proof: PathfinderDemandProof;
    buyer_clarity: PathfinderBuyerClarity;
    competitor_gap: PathfinderCompetitorGap;
    why_now: PathfinderWhyNow;
    revenue_path: OpportunityRevenuePath;
    first_customer: FirstCustomerPlan;
    market_attack: MarketAttackSimulation;
    anti_idea: AntiIdeaAnalysis;
    founder_fit?: FounderMarketFit | null;
}

function clamp(value: number, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(value)));
}

function average(values: number[]) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function confidenceFromScore(score: number): TrustLevel {
    if (score >= 75) return "HIGH";
    if (score >= 50) return "MEDIUM";
    return "LOW";
}

function dimensionScore<T extends { key: string; score: number }>(dimensions: T[], key: string, fallback = 50) {
    return dimensions.find((dimension) => dimension.key === key)?.score ?? fallback;
}

function isBroadWedge(text: string) {
    return /everyone|teams|businesses|companies|founders|users|all /i.test(text);
}

function revenueSpeedBandScore(speedBand: OpportunityRevenuePath["speed_to_revenue_band"]) {
    if (speedBand === "1-2 weeks") return 92;
    if (speedBand === "2-6 weeks") return 74;
    if (speedBand === "1-3 months") return 52;
    return 28;
}

function postureIsServiceFriendly(posture: string) {
    return /service-first|hybrid|concierge/i.test(posture);
}

function buildBuyerTrustBarrier(input: ServiceFirstPathfinderInput): ServiceFirstPathfinderDimension {
    const score = clamp(average([
        dimensionScore(input.revenue_path.dimensions, "trust_barrier"),
        dimensionScore(input.first_customer.dimensions, "trust_barrier"),
        input.trust.score,
    ]));

    return {
        key: "buyer_trust_barrier",
        label: "Buyer trust barrier",
        score,
        summary: score >= 70
            ? "Trust friction is low enough that a productized offer is plausible."
            : score >= 55
                ? "Trust friction is manageable, but some delivery or proof support still helps."
                : "Trust friction is high enough that service or manual proof is safer than pure product right now.",
    };
}

function buildImplementationComplexity(input: ServiceFirstPathfinderInput): ServiceFirstPathfinderDimension {
    const score = clamp(dimensionScore(input.revenue_path.dimensions, "implementation_complexity"));

    return {
        key: "implementation_complexity",
        label: "Implementation complexity",
        score,
        summary: score >= 70
            ? "Implementation looks light enough for a cleaner move toward productization."
            : score >= 55
                ? "Implementation is manageable, but staying narrow still matters."
                : "Implementation still looks too heavy to justify broad productization right away.",
    };
}

function buildFirstCustomerFriction(input: ServiceFirstPathfinderInput): ServiceFirstPathfinderDimension {
    const reachability = dimensionScore(input.first_customer.dimensions, "buyer_reachability");
    const channel = dimensionScore(input.first_customer.dimensions, "channel_accessibility");
    const outreach = dimensionScore(input.first_customer.dimensions, "outreach_friendliness");
    const proof = dimensionScore(input.first_customer.dimensions, "proof_requirement");
    const score = clamp(average([reachability, channel, outreach, proof]));

    return {
        key: "first_customer_friction",
        label: "First-customer friction",
        score,
        summary: score >= 70
            ? "First customers look reachable enough that productization does not depend on heroic acquisition effort."
            : score >= 55
                ? "You can likely reach first customers, but a service or hybrid step may still reduce friction."
                : "First-customer friction is still high, which argues against productizing too early.",
    };
}

function buildRevenueSpeed(input: ServiceFirstPathfinderInput): ServiceFirstPathfinderDimension {
    const score = clamp(average([
        revenueSpeedBandScore(input.revenue_path.speed_to_revenue_band),
        dimensionScore(input.revenue_path.dimensions, "speed_to_first_proof"),
    ]));

    return {
        key: "revenue_speed",
        label: "Revenue speed",
        score,
        summary: score >= 70
            ? "There is a realistic near-term path to first revenue."
            : score >= 55
                ? "Revenue speed is decent, but the first paid path still needs discipline."
                : "Revenue still looks too slow or too uncertain for aggressive productization.",
    };
}

function buildRepeatability(input: ServiceFirstPathfinderInput): ServiceFirstPathfinderDimension {
    const mostScalableMode = input.market_attack.most_scalable_mode?.mode || "";
    const supportBurden = dimensionScore(input.revenue_path.dimensions, "support_burden");
    const scalability = average(input.market_attack.modes.map((mode) => mode.scalability));
    let score = average([supportBurden, scalability]);

    if (input.revenue_path.recommended_entry_mode === "SaaS-first") score += 10;
    if (input.revenue_path.recommended_entry_mode === "Hybrid service + software") score += 6;
    if (input.revenue_path.recommended_entry_mode === "Service-first") score -= 10;
    if (input.revenue_path.recommended_entry_mode === "Concierge MVP") score -= 6;
    if (mostScalableMode === "SaaS-first wedge") score += 8;
    if (mostScalableMode === "Hybrid service + software") score += 5;

    score = clamp(score);

    return {
        key: "repeatability",
        label: "Repeatability",
        score,
        summary: score >= 70
            ? "The workflow looks repeatable enough that productization can carry real leverage."
            : score >= 55
                ? "Some repeatability is present, but service or hybrid delivery may still teach the pattern faster."
                : "Repeatability still looks weak, so fully productizing now risks building too early.",
    };
}

function buildFounderFitDimension(input: ServiceFirstPathfinderInput): ServiceFirstPathfinderDimension {
    const score = clamp(input.founder_fit?.fit_score ?? 55);

    return {
        key: "founder_fit",
        label: "Founder fit",
        score,
        summary: input.founder_fit
            ? input.founder_fit.fit_summary
            : "Founder fit was not explicitly available on this surface, so this dimension stays conservative.",
    };
}

function buildMarketClarity(input: ServiceFirstPathfinderInput): ServiceFirstPathfinderDimension {
    let score = clamp(average([
        clamp(input.demand_proof.evidence_count * 6 + input.demand_proof.source_count * 12 + input.demand_proof.direct_quote_count * 16),
        input.buyer_clarity.summary ? 72 : 42,
        input.why_now.confidence_level === "HIGH" ? 82 : input.why_now.confidence_level === "MEDIUM" ? 64 : 44,
    ]));

    if (input.anti_idea.verdict.label === "WAIT") score -= 10;
    if (input.anti_idea.verdict.label === "KILL_FOR_NOW") score -= 20;
    score = clamp(score);

    return {
        key: "market_clarity",
        label: "Market clarity",
        score,
        summary: score >= 70
            ? "The market is clear enough that productization posture can be chosen with more confidence."
            : score >= 55
                ? "There is a usable market picture, but some ambiguity still argues for phased entry."
                : "Market clarity is still too soft for confident productization.",
    };
}

function buildWedgeSharpness(input: ServiceFirstPathfinderInput): ServiceFirstPathfinderDimension {
    const niche = dimensionScore(input.first_customer.dimensions, "niche_concentration");
    let score = average([
        niche,
        input.competitor_gap.live_weakness ? 74 : 46,
        isBroadWedge(input.buyer_clarity.wedge_summary) ? 40 : 76,
    ]);

    if (input.competitor_gap.live_weakness?.trust_level === "HIGH") score += 8;
    if (/not sharply defined/i.test(input.competitor_gap.strongest_gap)) score -= 10;
    score = clamp(score);

    return {
        key: "wedge_sharpness",
        label: "Wedge sharpness",
        score,
        summary: score >= 70
            ? "The wedge is sharp enough that productization can stay focused instead of drifting broad."
            : score >= 55
                ? "There is a wedge, but it still needs tight discipline."
                : "The wedge is still too broad or fuzzy to justify productizing aggressively.",
    };
}

function buildDimensions(input: ServiceFirstPathfinderInput) {
    return [
        buildBuyerTrustBarrier(input),
        buildImplementationComplexity(input),
        buildFirstCustomerFriction(input),
        buildRevenueSpeed(input),
        buildRepeatability(input),
        buildFounderFitDimension(input),
        buildMarketClarity(input),
        buildWedgeSharpness(input),
    ];
}

function recommendedPosture(input: ServiceFirstPathfinderInput, dimensions: ServiceFirstPathfinderDimension[], readinessScore: number): ProductizationPosture {
    const trustBarrier = dimensionScore(dimensions, "buyer_trust_barrier");
    const complexity = dimensionScore(dimensions, "implementation_complexity");
    const friction = dimensionScore(dimensions, "first_customer_friction");
    const revenueSpeed = dimensionScore(dimensions, "revenue_speed");
    const repeatability = dimensionScore(dimensions, "repeatability");
    const founderFit = dimensionScore(dimensions, "founder_fit");
    const marketClarity = dimensionScore(dimensions, "market_clarity");
    const wedgeSharpness = dimensionScore(dimensions, "wedge_sharpness");
    const bestAttack = input.market_attack.best_overall_attack_mode?.mode || "";
    const revenueEntry = input.revenue_path.recommended_entry_mode;
    const antiVerdict = input.anti_idea.verdict.label;

    if (
        antiVerdict === "KILL_FOR_NOW"
        || readinessScore < 45
        || marketClarity < 50
        || wedgeSharpness < 48
        || bestAttack === "Interview-only / proof-first"
        || revenueEntry === "Test-only / interviews first"
    ) {
        return "Wait and validate more first";
    }

    if (
        revenueEntry === "Concierge MVP"
        || bestAttack === "Concierge MVP"
        || (marketClarity < 64 && friction >= 56 && revenueSpeed >= 58)
    ) {
        return "Concierge MVP first";
    }

    if (
        antiVerdict === "LOW_CONCERN"
        && readinessScore >= 74
        && repeatability >= 68
        && marketClarity >= 70
        && wedgeSharpness >= 66
        && trustBarrier >= 60
        && complexity >= 58
        && founderFit >= 58
        && revenueEntry !== "Service-first"
    ) {
        return "Productize now";
    }

    if (
        revenueEntry === "Hybrid service + software"
        || bestAttack === "Hybrid service + software"
        || (repeatability >= 60 && friction >= 55 && marketClarity >= 60 && complexity >= 52)
    ) {
        return "Start hybrid service + software";
    }

    if (
        revenueSpeed >= 60
        && friction >= 55
        && repeatability < 62
        && postureIsServiceFriendly(revenueEntry)
    ) {
        return "Stay service-first";
    }

    return "Stay service-first";
}

function strongestReason(posture: ProductizationPosture, input: ServiceFirstPathfinderInput, dimensions: ServiceFirstPathfinderDimension[]) {
    const strongest = [...dimensions].sort((a, b) => b.score - a.score)[0];

    if (posture === "Productize now") {
        return `Productization is justified because ${strongest.label.toLowerCase()} and repeatability are strong enough to support a real product wedge now.`;
    }
    if (posture === "Start hybrid service + software") {
        return "A hybrid posture fits because the market looks real, but delivery support still lowers risk better than a pure SaaS jump.";
    }
    if (posture === "Stay service-first") {
        return "You are more likely to earn early revenue by selling the outcome first than by forcing a productized build too early.";
    }
    if (posture === "Concierge MVP first") {
        return "The best next step is to prove the outcome manually before deciding which parts deserve software.";
    }
    return input.anti_idea.strongest_reason_to_wait_pivot_or_kill;
}

function strongestCaution(input: ServiceFirstPathfinderInput, dimensions: ServiceFirstPathfinderDimension[]) {
    const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
    if (input.anti_idea.verdict.label !== "LOW_CONCERN") {
        return input.anti_idea.strongest_reason_to_wait_pivot_or_kill;
    }
    if (!weakest) {
        return "This posture still depends on inferred signals, not guaranteed execution results.";
    }
    return `${weakest.label} is still the main caution in the current productization posture.`;
}

function improvementNotes(dimensions: ServiceFirstPathfinderDimension[], input: ServiceFirstPathfinderInput) {
    const improvements: string[] = [];

    if (dimensionScore(dimensions, "market_clarity") < 65) {
        improvements.push("Get stronger direct proof that the pain is repeated and urgent, not just interesting.");
    }
    if (dimensionScore(dimensions, "wedge_sharpness") < 65) {
        improvements.push("Narrow the wedge until the buyer, workflow, and competitor gap are more precise.");
    }
    if (dimensionScore(dimensions, "repeatability") < 65) {
        improvements.push("See the same delivery pattern repeat across multiple customers before broad productization.");
    }
    if (dimensionScore(dimensions, "first_customer_friction") < 60) {
        improvements.push("Sharpen the first-customer channel and outreach path so productization is not blocked by acquisition friction.");
    }
    if (dimensionScore(dimensions, "buyer_trust_barrier") < 60) {
        improvements.push("Lower trust risk with a narrower offer, stronger proof, or a lighter-commitment pilot.");
    }
    if (input.founder_fit && dimensionScore(dimensions, "founder_fit") < 60) {
        improvements.push(input.founder_fit.founder_specific_next_move_note);
    }

    return [...new Set(improvements)].slice(0, 3);
}

function postureRationale(posture: ProductizationPosture, input: ServiceFirstPathfinderInput, readinessScore: number, dimensions: ServiceFirstPathfinderDimension[]) {
    const revenueSpeed = dimensionScore(dimensions, "revenue_speed");
    const repeatability = dimensionScore(dimensions, "repeatability");
    const marketClarity = dimensionScore(dimensions, "market_clarity");

    if (posture === "Productize now") {
        return `Productize now because market clarity, repeatability, and productization readiness are strong enough to justify a focused software wedge instead of staying delivery-heavy.`;
    }
    if (posture === "Start hybrid service + software") {
        return `Start hybrid because the market looks real and monetizable, but a mix of product and delivery is still the safest path to proof and first revenue.`;
    }
    if (posture === "Stay service-first") {
        return `Stay service-first because revenue can likely arrive faster than full product certainty, while repeatability and wedge sharpness still need more evidence.`;
    }
    if (posture === "Concierge MVP first") {
        return `Use a concierge MVP first because the buyer path is workable, but the product shape still needs to be learned through manual delivery before you automate it.`;
    }
    return `Wait because the current signal is not yet strong enough to justify productization. Readiness is ${readinessScore}/100, with market clarity at ${marketClarity}/100 and revenue speed at ${revenueSpeed}/100 while repeatability sits at ${repeatability}/100.`;
}

export function buildServiceFirstSaasPathfinder(input: ServiceFirstPathfinderInput): ServiceFirstSaasPathfinder {
    const dimensions = buildDimensions(input);
    const readinessScore = clamp(
        dimensionScore(dimensions, "buyer_trust_barrier") * 0.12 +
        dimensionScore(dimensions, "implementation_complexity") * 0.12 +
        dimensionScore(dimensions, "first_customer_friction") * 0.16 +
        dimensionScore(dimensions, "revenue_speed") * 0.15 +
        dimensionScore(dimensions, "repeatability") * 0.17 +
        dimensionScore(dimensions, "founder_fit") * 0.1 +
        dimensionScore(dimensions, "market_clarity") * 0.1 +
        dimensionScore(dimensions, "wedge_sharpness") * 0.08,
    );
    const posture = recommendedPosture(input, dimensions, readinessScore);
    const improvements = improvementNotes(dimensions, input);
    const confidenceScore = clamp(
        input.trust.score * 0.3 +
        readinessScore * 0.3 +
        input.revenue_path.confidence_score * 0.18 +
        input.first_customer.confidence_score * 0.12 +
        (input.anti_idea.confidence_score * 0.1),
    );

    return {
        recommended_productization_posture: posture,
        posture_rationale: postureRationale(posture, input, readinessScore, dimensions),
        strongest_reason_for_posture: strongestReason(posture, input, dimensions),
        strongest_caution: strongestCaution(input, dimensions),
        what_must_become_true_before_productization: improvements.length > 0
            ? improvements
            : ["Keep validating the narrow wedge until the delivery pattern and buyer path are repeatable enough to support productization."],
        confidence_level: confidenceFromScore(confidenceScore),
        confidence_score: confidenceScore,
        productization_readiness_score: readinessScore,
        dimensions,
        direct_vs_inferred: {
            direct_evidence_count: input.demand_proof.direct_vs_inferred.direct_evidence_count,
            inferred_markers: [
                "Productization posture is inferred from the current revenue path, first-customer path, market attack, and anti-idea layers",
                input.founder_fit
                    ? "Founder fit was included to personalize the posture recommendation"
                    : "This posture is market-aware but not founder-profile-aware on this surface",
            ],
        },
    };
}
