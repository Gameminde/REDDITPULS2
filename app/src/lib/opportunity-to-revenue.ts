import type { TrustLevel } from "@/lib/trust";

export type RevenueEntryMode =
    | "SaaS-first"
    | "Service-first"
    | "Concierge MVP"
    | "Hybrid service + software"
    | "Internal-tool-to-product"
    | "Template / workflow product"
    | "Plugin / add-on wedge"
    | "Test-only / interviews first";

export type RevenueSpeedBand = "1-2 weeks" | "2-6 weeks" | "1-3 months" | "3+ months";

export type RevenuePathDimensionKey =
    | "buyer_urgency"
    | "willingness_to_pay_evidence"
    | "implementation_complexity"
    | "customer_reachability"
    | "trust_barrier"
    | "speed_to_first_proof"
    | "support_burden";

export interface RevenuePathDimension {
    key: RevenuePathDimensionKey;
    label: string;
    score: number;
    summary: string;
}

export interface OpportunityRevenuePath {
    recommended_entry_mode: RevenueEntryMode;
    summary: string;
    first_offer_suggestion: string;
    pricing_test_suggestion: string;
    first_customer_path: string;
    speed_to_revenue_band: RevenueSpeedBand;
    confidence_level: TrustLevel;
    confidence_score: number;
    main_execution_risk: string;
    rationale: string;
    dimensions: RevenuePathDimension[];
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

interface RevenueDemandProof {
    summary: string;
    evidence_count: number;
    direct_quote_count: number;
    source_count: number;
    freshness_label: string;
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

interface RevenueBuyerClarity {
    summary: string;
    icp_summary: string;
    wedge_summary: string;
    budget_summary: string | null;
    buying_triggers: string[];
}

interface RevenueCompetitorGap {
    summary: string;
    strongest_gap: string;
    live_weakness: null | {
        competitor: string;
        weakness_category: string;
        summary: string;
        trust_level: TrustLevel;
        wedge_opportunity_note: string;
    };
}

interface RevenueWhyNow {
    timing_category: string;
    summary: string;
    freshness_label: string;
    confidence_level: TrustLevel;
    momentum_direction: "accelerating" | "steady" | "cooling" | "new" | "unknown";
}

interface RevenueKillCriteria {
    items: string[];
}

interface OpportunityToRevenueInput {
    idea_text: string;
    verdict: string | null;
    report: Record<string, unknown>;
    trust: {
        level: TrustLevel;
        score: number;
        direct_quote_count: number;
    };
    demand_proof: RevenueDemandProof;
    buyer_clarity: RevenueBuyerClarity;
    competitor_gap: RevenueCompetitorGap;
    why_now: RevenueWhyNow;
    kill_criteria: RevenueKillCriteria;
}

function clamp(value: number, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function extractSection(report: Record<string, unknown>, key: string) {
    const value = report[key];
    return isRecord(value) ? value : {};
}

function normalizeString(value: unknown) {
    return String(value || "").trim();
}

function normalizeArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function truncate(text: string, limit = 180) {
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 1).trim()}...`;
}

function confidenceFromScore(score: number): TrustLevel {
    if (score >= 75) return "HIGH";
    if (score >= 50) return "MEDIUM";
    return "LOW";
}

function joinText(parts: unknown[]) {
    return parts
        .map((part) => normalizeString(part))
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

function firstPaidTier(pricing: Record<string, unknown>) {
    const tiers = normalizeArray<Record<string, unknown>>(pricing.tiers);
    return tiers.find((tier) => {
        const price = normalizeString(tier.price);
        return price && price !== "$0";
    }) || null;
}

function budgetPriceHint(budgetSummary: string | null) {
    if (!budgetSummary) return null;
    const match = budgetSummary.match(/\$[\d,.]+(?:\s*-\s*\$?[\d,.]+)?/);
    return match ? match[0] : null;
}

function buildBuyerUrgency(input: OpportunityToRevenueInput): RevenuePathDimension {
    const verdictUpper = normalizeString(input.verdict).toUpperCase();
    const momentumBase =
        input.why_now.momentum_direction === "accelerating" ? 82 :
        input.why_now.momentum_direction === "steady" ? 70 :
        input.why_now.momentum_direction === "new" ? 62 :
        input.why_now.momentum_direction === "cooling" ? 38 :
        46;
    const score = clamp(
        momentumBase +
        Math.min(input.buyer_clarity.buying_triggers.length, 3) * 6 +
        (verdictUpper.includes("BUILD") ? 6 : 0) -
        (input.kill_criteria.items.length >= 3 ? 6 : 0),
    );

    return {
        key: "buyer_urgency",
        label: "Buyer urgency",
        score,
        summary: score >= 70
            ? "Buyer urgency looks strong enough to test for paid movement quickly."
            : score >= 55
                ? "Buyer urgency is present, but the first revenue test should stay narrow."
                : "Buyer urgency still looks soft, so validate pain before assuming a paid path.",
    };
}

function buildWtpEvidence(input: OpportunityToRevenueInput): RevenuePathDimension {
    const pricing = extractSection(input.report, "pricing_strategy");
    const explicitWtp = normalizeString(input.report.willingness_to_pay).toLowerCase();
    const tier = firstPaidTier(pricing);
    const score = clamp(
        input.demand_proof.direct_quote_count * 18 +
        input.demand_proof.source_count * 8 +
        (input.buyer_clarity.budget_summary ? 18 : 0) +
        (tier ? 16 : 0) +
        (explicitWtp && !/no explicit|not found|none/.test(explicitWtp) ? 22 : 0),
    );

    return {
        key: "willingness_to_pay_evidence",
        label: "WTP evidence",
        score,
        summary: score >= 70
            ? "There is enough pricing and buyer-proof context to test a paid offer immediately."
            : score >= 50
                ? "WTP evidence is partial, so pricing should be tested before committing to a bigger build."
                : "WTP evidence is thin, so use pricing conversations as part of the first validation step.",
    };
}

function buildImplementationComplexity(input: OpportunityToRevenueInput): RevenuePathDimension {
    const reportText = joinText([
        input.idea_text,
        input.competitor_gap.summary,
        input.competitor_gap.strongest_gap,
        input.why_now.summary,
        input.report.summary,
        extractSection(input.report, "competition_landscape").your_unfair_advantage,
    ]);
    const mvpFeatures = normalizeArray<string>(input.report.mvp_features).filter(Boolean);
    let score = 74;

    if (/enterprise|compliance|security|migration|data sync|webhook|api|integration|infrastructure/.test(reportText)) score -= 22;
    if (/agent|automation|ai-native|copilot/.test(reportText)) score -= 10;
    if (mvpFeatures.length >= 5) score -= 12;
    if (input.kill_criteria.items.length >= 3) score -= 8;

    score = clamp(score);

    return {
        key: "implementation_complexity",
        label: "Implementation complexity",
        score,
        summary: score >= 70
            ? "The first revenue path looks light enough to test without a heavy initial build."
            : score >= 50
                ? "Implementation is manageable, but the entry offer should stay narrower than the eventual product."
                : "Implementation looks heavy, so avoid betting on a full product build as the first revenue move.",
    };
}

function buildCustomerReachability(input: OpportunityToRevenueInput): RevenuePathDimension {
    const first10 = extractSection(input.report, "first_10_customers_strategy");
    const first3 = extractSection(first10, "customers_1_3");
    const source = normalizeString(first3.source);
    const tactic = normalizeString(first3.tactic);
    const script = normalizeString(first3.script);
    const communities = normalizeArray<string>(extractSection(input.report, "ideal_customer_profile").specific_communities).filter(Boolean);

    const score = clamp(
        (source ? 28 : 0) +
        (tactic ? 22 : 0) +
        (script ? 20 : 0) +
        Math.min(communities.length, 3) * 8 +
        (input.buyer_clarity.icp_summary ? 10 : 0),
    );

    return {
        key: "customer_reachability",
        label: "Customer reachability",
        score,
        summary: score >= 70
            ? "Early customers look reachable through named channels and concrete outreach tactics."
            : score >= 50
                ? "Customer reachability is decent, but the first customer path still needs sharper channel discipline."
                : "The first customer path is still fuzzy, which slows the route to first revenue.",
    };
}

function buildTrustBarrier(input: OpportunityToRevenueInput): RevenuePathDimension {
    const reportText = joinText([
        input.idea_text,
        input.buyer_clarity.icp_summary,
        input.competitor_gap.summary,
        input.why_now.summary,
    ]);

    let score = input.trust.score;
    if (/enterprise|security|compliance|financial|health|legal/.test(reportText)) score -= 20;
    if (/automation|ai|agent/.test(reportText)) score -= 8;
    if (input.demand_proof.direct_quote_count > 0) score += 6;

    score = clamp(score);

    return {
        key: "trust_barrier",
        label: "Trust barrier",
        score,
        summary: score >= 70
            ? "Trust barriers look manageable for an early paid test."
            : score >= 50
                ? "Some trust-building will be needed before revenue becomes repeatable."
                : "Trust looks like a major constraint, so the first offer should minimize commitment risk for buyers.",
    };
}

function buildSpeedToFirstProof(input: OpportunityToRevenueInput, buyerUrgency: number, reachability: number, complexity: number): RevenuePathDimension {
    const roadmap = normalizeArray<Record<string, unknown>>(input.report.launch_roadmap);
    const firstStep = roadmap[0];
    const validationGate = normalizeString(firstStep?.validation_gate);
    const score = clamp(
        buyerUrgency * 0.3 +
        reachability * 0.35 +
        complexity * 0.2 +
        (validationGate ? 12 : 0) +
        (input.demand_proof.direct_quote_count > 0 ? 8 : 0),
    );

    return {
        key: "speed_to_first_proof",
        label: "Speed to first proof",
        score,
        summary: score >= 72
            ? "You can get meaningful proof quickly if you run the first offer test immediately."
            : score >= 55
                ? "A first proof loop is realistic, but it still needs focused execution."
                : "Proof will likely take longer than expected unless the wedge is narrowed further.",
    };
}

function buildSupportBurden(input: OpportunityToRevenueInput): RevenuePathDimension {
    const reportText = joinText([
        input.idea_text,
        input.buyer_clarity.wedge_summary,
        normalizeArray<Record<string, unknown>>(input.report.launch_roadmap)
            .map((step) => normalizeString(step.title))
            .join(" "),
    ]);

    let score = 70;
    if (/custom|done-for-you|white glove|migration|implementation|setup/.test(reportText)) score -= 16;
    if (/enterprise|team|multi-step|training|onboarding/.test(reportText)) score -= 12;
    if (/template|plugin|workflow/.test(reportText)) score += 8;

    score = clamp(score);

    return {
        key: "support_burden",
        label: "Support burden",
        score,
        summary: score >= 70
            ? "The first revenue offer should be support-light enough to keep momentum."
            : score >= 50
                ? "Support burden is manageable, but the first paid offer should stay tightly scoped."
                : "Support or delivery burden is high, so the first offer must be constrained carefully.",
    };
}

function pickEntryMode(input: OpportunityToRevenueInput, dimensions: RevenuePathDimension[]): RevenueEntryMode {
    const scores = Object.fromEntries(dimensions.map((dimension) => [dimension.key, dimension.score])) as Record<RevenuePathDimensionKey, number>;
    const reportText = joinText([
        input.idea_text,
        input.buyer_clarity.wedge_summary,
        input.competitor_gap.strongest_gap,
        input.why_now.summary,
        extractSection(input.report, "pricing_strategy").reasoning,
    ]);
    const verdictUpper = normalizeString(input.verdict).toUpperCase();

    if (verdictUpper.includes("DON") || (scores.willingness_to_pay_evidence < 40 && scores.buyer_urgency < 50)) {
        return "Test-only / interviews first";
    }
    if (/plugin|extension|add-on|shopify|slack|notion|hubspot|figma|chrome/.test(reportText)) {
        return "Plugin / add-on wedge";
    }
    if (/template|workflow|playbook|checklist|airtable|notion template|prompt pack/.test(reportText)) {
        return "Template / workflow product";
    }
    if (/internal tool|back office|ops automation|internal workflow/.test(reportText) && scores.implementation_complexity >= 45) {
        return "Internal-tool-to-product";
    }
    if (scores.implementation_complexity < 45 && scores.customer_reachability >= 60) {
        return "Service-first";
    }
    if (scores.customer_reachability >= 70 && scores.implementation_complexity < 58) {
        return "Concierge MVP";
    }
    if (scores.customer_reachability >= 68 && scores.implementation_complexity < 70) {
        return "Hybrid service + software";
    }
    if (
        scores.buyer_urgency >= 72 &&
        scores.willingness_to_pay_evidence >= 60 &&
        scores.implementation_complexity >= 60 &&
        scores.trust_barrier >= 52
    ) {
        return "SaaS-first";
    }

    return "Hybrid service + software";
}

function buildFirstOffer(entryMode: RevenueEntryMode, input: OpportunityToRevenueInput) {
    const wedge = truncate(input.buyer_clarity.wedge_summary || input.buyer_clarity.icp_summary || input.idea_text, 140);

    switch (entryMode) {
        case "SaaS-first":
            return `Offer a narrow paid SaaS focused on ${wedge}.`;
        case "Service-first":
            return `Start with a done-for-you service that removes the highest-friction part of ${wedge}.`;
        case "Concierge MVP":
            return `Sell the outcome manually first for ${wedge}, then automate only the repeated steps.`;
        case "Hybrid service + software":
            return `Bundle light software with setup or delivery help so early customers pay for the outcome, not just the tool.`;
        case "Internal-tool-to-product":
            return `Package the workflow as an internal-style operator tool first, then expose the repeatable parts as product.`;
        case "Template / workflow product":
            return `Sell a reusable workflow kit or template pack that helps ${wedge} move faster immediately.`;
        case "Plugin / add-on wedge":
            return `Launch as a focused add-on that fixes one painful gap in the incumbent stack for ${wedge}.`;
        default:
            return `Do not sell the full product yet; sell the conversation and problem discovery before committing to build.`;
    }
}

function buildPricingTest(entryMode: RevenueEntryMode, input: OpportunityToRevenueInput) {
    const pricing = extractSection(input.report, "pricing_strategy");
    const tier = firstPaidTier(pricing);
    const tierPrice = tier ? normalizeString(tier.price) : "";
    const budgetHint = budgetPriceHint(input.buyer_clarity.budget_summary);
    const priceAnchor = tierPrice || budgetHint || "$49-$199";

    switch (entryMode) {
        case "Service-first":
            return `Test a paid pilot first, for example ${budgetHint || "$500-$1.5k"} as a scoped implementation offer.`;
        case "Concierge MVP":
            return `Charge for a manual pilot before productizing, even if it is a small commitment such as ${budgetHint || "$250-$750"}.`;
        case "Hybrid service + software":
            return `Test a setup fee plus recurring fee, for example ${budgetHint || "$500"} setup plus ${tierPrice || "$99/mo"} ongoing.`;
        case "Internal-tool-to-product":
            return `Start with a paid pilot or implementation fee, then convert the repeatable layer into a subscription.`;
        case "Template / workflow product":
            return `Test a low-friction paid offer first, such as ${budgetHint || "$49-$149"} for a workflow pack or template bundle.`;
        case "Plugin / add-on wedge":
            return `Use a simple subscription test around ${tierPrice || "$19-$79/mo"} for the focused add-on.`;
        case "SaaS-first":
            return tierPrice
                ? `Use the current price anchor from the report and test the first paid tier around ${tierPrice}.`
                : `Test a paid SaaS tier around ${priceAnchor} and see whether the buyer accepts recurring pricing quickly.`;
        default:
            return "Do not optimize pricing yet; first test whether buyers will commit time or money to the problem at all.";
    }
}

function buildFirstCustomerPath(input: OpportunityToRevenueInput) {
    const first10 = extractSection(input.report, "first_10_customers_strategy");
    const first3 = extractSection(first10, "customers_1_3");
    const source = normalizeString(first3.source);
    const tactic = normalizeString(first3.tactic);
    const roadmap = normalizeArray<Record<string, unknown>>(input.report.launch_roadmap);
    const firstChannel = normalizeString(roadmap[0]?.channel);
    const communities = normalizeArray<string>(extractSection(input.report, "ideal_customer_profile").specific_communities).filter(Boolean);

    if (source && tactic) return `${source}: ${tactic}`;
    if (source) return `Start with ${source} and run a direct outreach or post-based test.`;
    if (firstChannel) return `Use ${firstChannel} as the first acquisition channel for the revenue test.`;
    if (communities.length > 0) return `Start where the buyer already gathers: ${communities.slice(0, 2).join(" and ")}.`;
    return "First customer path is still inferred. Start with direct buyer conversations before choosing a broader channel.";
}

function buildSpeedBand(dimensions: RevenuePathDimension[]) {
    const average = dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / dimensions.length;
    if (average >= 74) return "1-2 weeks";
    if (average >= 58) return "2-6 weeks";
    if (average >= 45) return "1-3 months";
    return "3+ months";
}

function buildMainExecutionRisk(input: OpportunityToRevenueInput, dimensions: RevenuePathDimension[]) {
    const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
    if (weakest?.key === "willingness_to_pay_evidence") {
        return "Willingness-to-pay proof is still too thin to assume the first offer will convert cleanly.";
    }
    if (weakest?.key === "customer_reachability") {
        return "The first customer path is still fuzzy, which can delay actual revenue even if the market is real.";
    }
    if (weakest?.key === "implementation_complexity") {
        return "Implementation complexity could slow the path to first revenue unless the first offer stays much narrower.";
    }
    if (weakest?.key === "trust_barrier") {
        return "Buyers may need more trust before paying, so reduce commitment risk in the first offer.";
    }
    return input.kill_criteria.items[0] || "The main execution risk is still inferred from current proof and timing gaps.";
}

function buildRationale(entryMode: RevenueEntryMode, input: OpportunityToRevenueInput, speedBand: RevenueSpeedBand, dimensions: RevenuePathDimension[]) {
    const strongest = [...dimensions].sort((a, b) => b.score - a.score).slice(0, 2).map((dimension) => dimension.label.toLowerCase());
    return `This looks like a ${entryMode.toLowerCase()} opportunity because ${strongest.join(" and ")} are stronger than the other revenue-path constraints, making ${speedBand} the most realistic current band to first revenue.`;
}

export function buildOpportunityToRevenuePath(input: OpportunityToRevenueInput): OpportunityRevenuePath {
    const buyerUrgency = buildBuyerUrgency(input);
    const wtp = buildWtpEvidence(input);
    const complexity = buildImplementationComplexity(input);
    const reachability = buildCustomerReachability(input);
    const trustBarrier = buildTrustBarrier(input);
    const speed = buildSpeedToFirstProof(input, buyerUrgency.score, reachability.score, complexity.score);
    const supportBurden = buildSupportBurden(input);
    const dimensions = [buyerUrgency, wtp, complexity, reachability, trustBarrier, speed, supportBurden];
    const entryMode = pickEntryMode(input, dimensions);
    const speedBand = buildSpeedBand(dimensions);
    const confidenceScore = clamp(
        input.trust.score * 0.3 +
        wtp.score * 0.18 +
        reachability.score * 0.17 +
        speed.score * 0.17 +
        complexity.score * 0.1 +
        trustBarrier.score * 0.08,
    );
    const mainExecutionRisk = buildMainExecutionRisk(input, dimensions);
    const rationale = buildRationale(entryMode, input, speedBand, dimensions);

    return {
        recommended_entry_mode: entryMode,
        summary: `Fastest realistic path to first revenue: ${entryMode} with a ${speedBand} proof horizon.`,
        first_offer_suggestion: buildFirstOffer(entryMode, input),
        pricing_test_suggestion: buildPricingTest(entryMode, input),
        first_customer_path: buildFirstCustomerPath(input),
        speed_to_revenue_band: speedBand,
        confidence_level: confidenceFromScore(confidenceScore),
        confidence_score: confidenceScore,
        main_execution_risk: mainExecutionRisk,
        rationale,
        dimensions,
        direct_vs_inferred: {
            direct_evidence_count: input.demand_proof.direct_vs_inferred.direct_evidence_count,
            inferred_markers: [
                "Revenue path is inferred from current demand proof, buyer clarity, pricing clues, and execution complexity",
                "Entry mode is a recommendation, not observed buyer behavior",
            ],
        },
    };
}
