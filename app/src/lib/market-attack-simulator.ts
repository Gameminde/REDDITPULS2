import type { FirstCustomerPlan } from "@/lib/first-customer";
import type { OpportunityRevenuePath } from "@/lib/opportunity-to-revenue";
import type { TrustLevel } from "@/lib/trust";

export type MarketAttackModeName =
    | "Service-first wedge"
    | "SaaS-first wedge"
    | "Concierge MVP"
    | "Hybrid service + software"
    | "Plugin / add-on wedge"
    | "Interview-only / proof-first";

export interface MarketAttackMode {
    mode: MarketAttackModeName;
    fit_score: number;
    speed_to_proof: number;
    speed_to_revenue: number;
    trust_barrier: number;
    complexity: number;
    customer_reachability: number;
    execution_risk: number;
    scalability: number;
    rationale: string;
    recommended_first_move: string;
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

export interface MarketAttackTopPick {
    mode: MarketAttackModeName;
    reason: string;
}

export interface MarketAttackSimulation {
    best_overall_attack_mode: MarketAttackTopPick | null;
    best_lowest_risk_mode: MarketAttackTopPick | null;
    best_fastest_revenue_mode: MarketAttackTopPick | null;
    most_scalable_mode: MarketAttackTopPick | null;
    tradeoff_notes: string[];
    modes: MarketAttackMode[];
}

interface FounderFitLike {
    fit_score: number;
    dimensions: Array<{
        key: string;
        score: number;
    }>;
}

interface MarketAttackInput {
    idea_text: string;
    verdict: string;
    trust: {
        level: TrustLevel;
        score: number;
    };
    competitor_gap: {
        summary: string;
        strongest_gap: string;
        live_weakness: null | {
            weakness_category: string;
            summary: string;
        };
    };
    why_now: {
        summary: string;
        timing_category: string;
        momentum_direction: "accelerating" | "steady" | "cooling" | "new" | "unknown";
    };
    revenue_path: OpportunityRevenuePath;
    first_customer: FirstCustomerPlan;
    founder_fit?: FounderFitLike | null;
}

function clamp(value: number, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(value)));
}

function average(values: number[]) {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dimensionScore<T extends { key: string; score: number }>(dimensions: T[], key: string, fallback = 50) {
    return dimensions.find((dimension) => dimension.key === key)?.score ?? fallback;
}

function joinText(parts: unknown[]) {
    return parts
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

function favorableComplexityScore(input: MarketAttackInput) {
    return dimensionScore(input.revenue_path.dimensions, "implementation_complexity");
}

function favorableTrustScore(input: MarketAttackInput) {
    return average([
        dimensionScore(input.revenue_path.dimensions, "trust_barrier"),
        dimensionScore(input.first_customer.dimensions, "trust_barrier"),
        input.trust.score,
    ]);
}

function favorableReachScore(input: MarketAttackInput) {
    return average([
        dimensionScore(input.revenue_path.dimensions, "customer_reachability"),
        dimensionScore(input.first_customer.dimensions, "buyer_reachability"),
        dimensionScore(input.first_customer.dimensions, "channel_accessibility"),
        dimensionScore(input.first_customer.dimensions, "outreach_friendliness"),
    ]);
}

function favorableProofScore(input: MarketAttackInput) {
    return average([
        dimensionScore(input.revenue_path.dimensions, "speed_to_first_proof"),
        dimensionScore(input.first_customer.dimensions, "proof_requirement"),
        dimensionScore(input.first_customer.dimensions, "clarity_of_pain"),
    ]);
}

function favorableUrgencyScore(input: MarketAttackInput) {
    return average([
        dimensionScore(input.revenue_path.dimensions, "buyer_urgency"),
        dimensionScore(input.first_customer.dimensions, "urgency"),
    ]);
}

function favorableWtpScore(input: MarketAttackInput) {
    return dimensionScore(input.revenue_path.dimensions, "willingness_to_pay_evidence");
}

function favorableSupportScore(input: MarketAttackInput) {
    return dimensionScore(input.revenue_path.dimensions, "support_burden");
}

function founderScore(input: MarketAttackInput, key: string, fallback = 55) {
    return input.founder_fit ? dimensionScore(input.founder_fit.dimensions, key, fallback) : fallback;
}

function founderBoost(input: MarketAttackInput) {
    return input.founder_fit?.fit_score ?? 55;
}

function pluginFriendly(input: MarketAttackInput) {
    const text = joinText([
        input.idea_text,
        input.competitor_gap.summary,
        input.competitor_gap.strongest_gap,
        input.why_now.summary,
        input.revenue_path.first_offer_suggestion,
        input.first_customer.first_proof_path,
    ]);

    return /plugin|add-on|extension|integration|ecosystem|marketplace|slack|shopify|notion|hubspot|figma|chrome|api/.test(text);
}

function serviceFriendly(input: MarketAttackInput) {
    const text = joinText([
        input.revenue_path.recommended_entry_mode,
        input.revenue_path.first_offer_suggestion,
        input.first_customer.best_initial_validation_motion,
    ]);

    return /service-first|hybrid service|concierge|done-for-you|pilot|implementation/.test(text);
}

function modeFirstMove(mode: MarketAttackModeName, input: MarketAttackInput) {
    switch (mode) {
        case "Service-first wedge":
            return "Sell a narrowly scoped service or pilot before building more product.";
        case "SaaS-first wedge":
            return "Launch the smallest recurring product offer and test paid demand with one focused workflow.";
        case "Concierge MVP":
            return "Deliver the result manually first and watch which steps are repeated often enough to automate.";
        case "Hybrid service + software":
            return "Bundle a light product with setup or delivery help so early customers pay for the outcome.";
        case "Plugin / add-on wedge":
            return "Ship the smallest add-on that solves one painful gap in the incumbent stack.";
        default:
            return "Run discovery conversations and proof tests before committing to a productized entry mode.";
    }
}

function modeRationale(mode: MarketAttackModeName, input: MarketAttackInput, fitScore: number, riskScore: number) {
    const wedge = input.competitor_gap.strongest_gap || input.why_now.summary || input.idea_text;

    if (mode === "Service-first wedge") {
        return `Service-first fits when the wedge is clear enough to sell an outcome quickly and the market can tolerate a manual first step around ${wedge}.`;
    }
    if (mode === "SaaS-first wedge") {
        return `SaaS-first fits when trust, proof, and build capacity are strong enough to justify a recurring product from day one around ${wedge}.`;
    }
    if (mode === "Concierge MVP") {
        return `Concierge MVP fits when the pain is clear but proof is still better earned through manual delivery before building a full product.`;
    }
    if (mode === "Hybrid service + software") {
        return `Hybrid works when the market is promising but a blend of delivery and product lowers risk more than a pure SaaS bet.`;
    }
    if (mode === "Plugin / add-on wedge") {
        return `A plugin or add-on wedge fits when incumbent ecosystems leave a focused gap you can exploit faster than building a full standalone product.`;
    }
    return fitScore >= 60 && riskScore <= 35
        ? "Interview-only is still the safest strategy because learning is likely to be more valuable than building right now."
        : "Interview-only is the conservative option when proof, reachability, or trust still need sharpening.";
}

function evaluateMode(mode: MarketAttackModeName, input: MarketAttackInput): MarketAttackMode {
    const complexityFavor = favorableComplexityScore(input);
    const trustFavor = favorableTrustScore(input);
    const reachFavor = favorableReachScore(input);
    const proofFavor = favorableProofScore(input);
    const urgencyFavor = favorableUrgencyScore(input);
    const wtpFavor = favorableWtpScore(input);
    const supportFavor = favorableSupportScore(input);
    const founderTech = founderScore(input, "technical_fit");
    const founderDomain = founderScore(input, "domain_fit");
    const founderGtm = founderScore(input, "gtm_fit");
    const founderSpeed = founderScore(input, "speed_to_execution_fit");
    const founderComplexity = founderScore(input, "complexity_tolerance_fit");
    const founderBudget = founderScore(input, "budget_runway_fit");
    const founderBase = founderBoost(input);
    const integrationSignal = pluginFriendly(input) ? 12 : 0;
    const serviceSignal = serviceFriendly(input) ? 10 : 0;
    const whyNowBonus =
        input.why_now.momentum_direction === "accelerating" ? 8 :
        input.why_now.momentum_direction === "steady" ? 4 :
        input.why_now.momentum_direction === "cooling" ? -8 : 0;

    let speedToProof = 50;
    let speedToRevenue = 50;
    let trustBarrier = 50;
    let complexity = 50;
    let customerReachability = 50;
    let executionRisk = 50;
    let scalability = 50;

    if (mode === "Service-first wedge") {
        speedToProof = clamp(58 + proofFavor * 0.22 + reachFavor * 0.12 + founderGtm * 0.08 + serviceSignal + whyNowBonus);
        speedToRevenue = clamp(64 + wtpFavor * 0.18 + reachFavor * 0.16 + founderGtm * 0.1 + serviceSignal);
        trustBarrier = clamp(44 - trustFavor * 0.18 - founderDomain * 0.08);
        complexity = clamp(34 - complexityFavor * 0.14 - founderComplexity * 0.05 + (100 - supportFavor) * 0.08);
        customerReachability = clamp(58 + reachFavor * 0.22 + founderGtm * 0.1 + founderDomain * 0.06);
        executionRisk = clamp(46 - founderBase * 0.12 - founderGtm * 0.1 + (100 - trustFavor) * 0.12);
        scalability = clamp(36 + complexityFavor * 0.12 + trustFavor * 0.05);
    } else if (mode === "SaaS-first wedge") {
        speedToProof = clamp(26 + proofFavor * 0.16 + founderTech * 0.12 + founderSpeed * 0.08 + whyNowBonus);
        speedToRevenue = clamp(36 + wtpFavor * 0.2 + trustFavor * 0.1 + founderTech * 0.1 + founderBudget * 0.08);
        trustBarrier = clamp(72 - trustFavor * 0.2 - founderDomain * 0.06);
        complexity = clamp(84 - complexityFavor * 0.32 - founderTech * 0.14 - founderComplexity * 0.08);
        customerReachability = clamp(38 + reachFavor * 0.18 + founderGtm * 0.08);
        executionRisk = clamp(70 - founderBase * 0.18 - founderTech * 0.08 + (100 - trustFavor) * 0.1);
        scalability = clamp(88 + complexityFavor * 0.06 + founderTech * 0.04);
    } else if (mode === "Concierge MVP") {
        speedToProof = clamp(70 + proofFavor * 0.2 + reachFavor * 0.1 + founderGtm * 0.08 + whyNowBonus);
        speedToRevenue = clamp(52 + wtpFavor * 0.16 + reachFavor * 0.14 + founderGtm * 0.06);
        trustBarrier = clamp(34 - trustFavor * 0.16 - founderDomain * 0.06);
        complexity = clamp(24 - complexityFavor * 0.1 - founderComplexity * 0.04);
        customerReachability = clamp(64 + reachFavor * 0.2 + founderGtm * 0.08);
        executionRisk = clamp(38 - founderBase * 0.12 - founderGtm * 0.08 + (100 - trustFavor) * 0.08);
        scalability = clamp(40 + complexityFavor * 0.08);
    } else if (mode === "Hybrid service + software") {
        speedToProof = clamp(48 + proofFavor * 0.18 + reachFavor * 0.12 + founderGtm * 0.06 + whyNowBonus);
        speedToRevenue = clamp(56 + wtpFavor * 0.18 + reachFavor * 0.14 + founderGtm * 0.06 + serviceSignal);
        trustBarrier = clamp(52 - trustFavor * 0.18 - founderDomain * 0.04);
        complexity = clamp(58 - complexityFavor * 0.22 - founderTech * 0.06 - founderComplexity * 0.06);
        customerReachability = clamp(56 + reachFavor * 0.2 + founderGtm * 0.08);
        executionRisk = clamp(52 - founderBase * 0.14 - founderSpeed * 0.06 + (100 - trustFavor) * 0.08);
        scalability = clamp(66 + complexityFavor * 0.08 + founderTech * 0.04);
    } else if (mode === "Plugin / add-on wedge") {
        speedToProof = clamp(46 + proofFavor * 0.14 + reachFavor * 0.12 + founderTech * 0.08 + integrationSignal);
        speedToRevenue = clamp(50 + wtpFavor * 0.14 + reachFavor * 0.12 + founderTech * 0.08 + integrationSignal);
        trustBarrier = clamp(40 - trustFavor * 0.18 - integrationSignal * 0.6);
        complexity = clamp(48 - complexityFavor * 0.18 - founderTech * 0.08 - integrationSignal * 0.5);
        customerReachability = clamp(52 + reachFavor * 0.18 + founderGtm * 0.06 + integrationSignal);
        executionRisk = clamp(48 - founderBase * 0.12 - founderTech * 0.06 + (100 - trustFavor) * 0.08);
        scalability = clamp(74 + integrationSignal * 0.8 + complexityFavor * 0.04);
    } else {
        speedToProof = clamp(80 + proofFavor * 0.1 + founderSpeed * 0.04);
        speedToRevenue = clamp(14 + wtpFavor * 0.08 + reachFavor * 0.06);
        trustBarrier = clamp(14 - trustFavor * 0.06);
        complexity = clamp(10 - complexityFavor * 0.03);
        customerReachability = clamp(58 + reachFavor * 0.14 + founderGtm * 0.06);
        executionRisk = clamp(22 - founderBase * 0.06 + (100 - trustFavor) * 0.04);
        scalability = 12;
    }

    const fitScore = clamp(
        speedToProof * 0.16 +
        speedToRevenue * 0.18 +
        customerReachability * 0.16 +
        scalability * 0.12 +
        (100 - trustBarrier) * 0.12 +
        (100 - complexity) * 0.12 +
        (100 - executionRisk) * 0.14,
    );

    return {
        mode,
        fit_score: fitScore,
        speed_to_proof: speedToProof,
        speed_to_revenue: speedToRevenue,
        trust_barrier: trustBarrier,
        complexity,
        customer_reachability: customerReachability,
        execution_risk: executionRisk,
        scalability,
        rationale: modeRationale(mode, input, fitScore, executionRisk),
        recommended_first_move: modeFirstMove(mode, input),
        direct_vs_inferred: {
            direct_evidence_count: input.first_customer.direct_vs_inferred.direct_evidence_count,
            inferred_markers: [
                "Attack mode fit is inferred from the current revenue path, first-customer path, trust, and timing layers",
                input.founder_fit ? "Founder fit was used to personalize the attack-mode ranking" : "This simulator is market-aware but not founder-profile-aware on this surface",
            ],
        },
    };
}

function pickBy<T>(items: T[], selector: (item: T) => number, mode: (item: T) => MarketAttackModeName, reason: (item: T) => string): MarketAttackTopPick | null {
    const best = [...items].sort((a, b) => selector(b) - selector(a))[0];
    return best ? { mode: mode(best), reason: reason(best) } : null;
}

function buildTradeoffNotes(modes: MarketAttackMode[]) {
    const bestOverall = [...modes].sort((a, b) => b.fit_score - a.fit_score)[0];
    const fastestRevenue = [...modes].sort((a, b) => b.speed_to_revenue - a.speed_to_revenue)[0];
    const lowestRisk = [...modes].sort((a, b) => a.execution_risk - b.execution_risk)[0];
    const scalable = [...modes].sort((a, b) => b.scalability - a.scalability)[0];

    const notes = new Set<string>();
    if (bestOverall && fastestRevenue && bestOverall.mode !== fastestRevenue.mode) {
        notes.add(`${bestOverall.mode} is the strongest balance overall, but ${fastestRevenue.mode} gets to revenue faster.`);
    }
    if (bestOverall && lowestRisk && bestOverall.mode !== lowestRisk.mode) {
        notes.add(`${lowestRisk.mode} is safer, while ${bestOverall.mode} offers more upside if executed well.`);
    }
    if (scalable && fastestRevenue && scalable.mode !== fastestRevenue.mode) {
        notes.add(`${scalable.mode} is the most scalable entry, but it is not the same as the fastest first-money path.`);
    }
    if (bestOverall?.mode === "Interview-only / proof-first") {
        notes.add("The current signal still favors proof-gathering over productized entry, which is a sign to stay disciplined.");
    }
    return [...notes].slice(0, 4);
}

export function buildMarketAttackSimulation(input: MarketAttackInput): MarketAttackSimulation {
    const modes = [
        "Service-first wedge",
        "SaaS-first wedge",
        "Concierge MVP",
        "Hybrid service + software",
        "Plugin / add-on wedge",
        "Interview-only / proof-first",
    ].map((mode) => evaluateMode(mode as MarketAttackModeName, input));

    return {
        best_overall_attack_mode: pickBy(
            modes,
            (mode) => mode.fit_score,
            (mode) => mode.mode,
            (mode) => `${mode.mode} best balances proof speed, revenue speed, reachability, and manageable execution friction right now.`,
        ),
        best_lowest_risk_mode: pickBy(
            modes,
            (mode) => 100 - mode.execution_risk,
            (mode) => mode.mode,
            (mode) => `${mode.mode} keeps execution risk lower than the alternatives.`,
        ),
        best_fastest_revenue_mode: pickBy(
            modes,
            (mode) => mode.speed_to_revenue,
            (mode) => mode.mode,
            (mode) => `${mode.mode} is the fastest route to first revenue given the current proof and reachability.`,
        ),
        most_scalable_mode: pickBy(
            modes,
            (mode) => mode.scalability,
            (mode) => mode.mode,
            (mode) => `${mode.mode} has the strongest scale potential if the first proof loop works.`,
        ),
        tradeoff_notes: buildTradeoffNotes(modes),
        modes,
    };
}
