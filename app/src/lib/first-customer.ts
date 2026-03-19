import type { OpportunityRevenuePath } from "@/lib/opportunity-to-revenue";
import type { TrustLevel } from "@/lib/trust";

export type FirstCustomerChannel =
    | "Founder communities"
    | "Niche professional communities"
    | "LinkedIn outbound"
    | "Warm network / referrals"
    | "Service-led outreach"
    | "Integration ecosystem / marketplace"
    | "Content-led inbound"
    | "Interview-first / discovery-first";

export type FirstCustomerDimensionKey =
    | "buyer_reachability"
    | "niche_concentration"
    | "trust_barrier"
    | "urgency"
    | "clarity_of_pain"
    | "outreach_friendliness"
    | "proof_requirement"
    | "channel_accessibility";

export interface FirstCustomerDimension {
    key: FirstCustomerDimensionKey;
    label: string;
    score: number;
    summary: string;
}

export interface FirstCustomerChannelRecommendation {
    channel: FirstCustomerChannel;
    label: string;
    reason: string;
}

export interface FirstCustomerPlan {
    likely_first_customer_archetype: string;
    primary_channel: FirstCustomerChannel;
    first_customer_channels: FirstCustomerChannelRecommendation[];
    first_outreach_angle: string;
    first_proof_path: string;
    best_initial_validation_motion: string;
    confidence_level: TrustLevel;
    confidence_score: number;
    main_acquisition_friction: string;
    rationale: string;
    dimensions: FirstCustomerDimension[];
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

interface FirstCustomerDemandProof {
    evidence_count: number;
    direct_quote_count: number;
    source_count: number;
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

interface FirstCustomerBuyerClarity {
    summary: string;
    icp_summary: string;
    wedge_summary: string;
    buying_triggers: string[];
}

interface FirstCustomerWhyNow {
    momentum_direction: "accelerating" | "steady" | "cooling" | "new" | "unknown";
    summary: string;
}

interface FirstCustomerInput {
    idea_text: string;
    report: Record<string, unknown>;
    trust: {
        level: TrustLevel;
        score: number;
        direct_quote_count: number;
    };
    demand_proof: FirstCustomerDemandProof;
    buyer_clarity: FirstCustomerBuyerClarity;
    why_now: FirstCustomerWhyNow;
    revenue_path: OpportunityRevenuePath;
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

function buildBuyerReachability(input: FirstCustomerInput, source: string, tactic: string): FirstCustomerDimension {
    const communities = normalizeArray<string>(extractSection(input.report, "ideal_customer_profile").specific_communities).filter(Boolean);
    const score = clamp(
        (source ? 28 : 0) +
        (tactic ? 22 : 0) +
        Math.min(communities.length, 3) * 8 +
        (input.revenue_path.first_customer_path ? 18 : 0) +
        (input.buyer_clarity.icp_summary ? 10 : 0),
    );

    return {
        key: "buyer_reachability",
        label: "Buyer reachability",
        score,
        summary: score >= 70
            ? "The first buyers look reachable through named communities or explicit outreach paths."
            : score >= 50
                ? "Reachability is decent, but the initial buyer path still needs tighter focus."
                : "The first buyers are not easy to reach yet, so the channel choice needs more discipline.",
    };
}

function buildNicheConcentration(input: FirstCustomerInput, source: string): FirstCustomerDimension {
    const communities = normalizeArray<string>(extractSection(input.report, "ideal_customer_profile").specific_communities).filter(Boolean);
    const wedgeText = `${input.buyer_clarity.wedge_summary} ${source}`.toLowerCase();
    let score = 44 + Math.min(communities.length, 3) * 12;

    if (/niche|specific|clinic|agency|firm|team|accountant|ops|hr|security|compliance/.test(wedgeText)) score += 18;
    if (/founder|startup|everyone|businesses|teams/.test(wedgeText)) score -= 10;

    score = clamp(score);

    return {
        key: "niche_concentration",
        label: "Niche concentration",
        score,
        summary: score >= 70
            ? "The niche looks concentrated enough that a few focused channels can surface the first customers."
            : score >= 50
                ? "The niche is somewhat concentrated, but not enough to rely on one broad channel."
                : "The niche still looks too diffuse, so the first-customer path risks being scattered.",
    };
}

function buildTrustBarrier(input: FirstCustomerInput): FirstCustomerDimension {
    const text = joinText([
        input.idea_text,
        input.buyer_clarity.icp_summary,
        input.buyer_clarity.wedge_summary,
        input.revenue_path.first_offer_suggestion,
    ]);

    let score = input.trust.score;
    if (/enterprise|security|compliance|finance|health|legal/.test(text)) score -= 22;
    if (/ai|agent|automation/.test(text)) score -= 8;
    if (input.demand_proof.direct_quote_count > 0) score += 6;

    score = clamp(score);

    return {
        key: "trust_barrier",
        label: "Trust barrier",
        score,
        summary: score >= 70
            ? "Trust should not block the first conversation or pilot too heavily."
            : score >= 50
                ? "Some extra trust-building will be needed before buyers commit."
                : "Trust is a real acquisition barrier, so the first contact path must lower commitment risk.",
    };
}

function buildUrgency(input: FirstCustomerInput): FirstCustomerDimension {
    const score = clamp(
        (input.why_now.momentum_direction === "accelerating" ? 80 :
            input.why_now.momentum_direction === "steady" ? 68 :
            input.why_now.momentum_direction === "new" ? 58 :
            input.why_now.momentum_direction === "cooling" ? 35 : 45) +
        Math.min(input.buyer_clarity.buying_triggers.length, 3) * 6,
    );

    return {
        key: "urgency",
        label: "Urgency",
        score,
        summary: score >= 70
            ? "Buyer urgency is high enough that a direct first-contact test makes sense now."
            : score >= 50
                ? "Urgency exists, but the first contact path should still emphasize discovery."
                : "Urgency is weak, so first contacts should focus on learning before pitching.",
    };
}

function buildClarityOfPain(input: FirstCustomerInput): FirstCustomerDimension {
    const score = clamp(
        input.demand_proof.evidence_count * 4 +
        input.demand_proof.direct_quote_count * 18 +
        input.demand_proof.source_count * 8 +
        (input.buyer_clarity.summary ? 10 : 0),
    );

    return {
        key: "clarity_of_pain",
        label: "Clarity of pain",
        score,
        summary: score >= 70
            ? "The pain is clear enough to anchor a concrete first-contact message."
            : score >= 50
                ? "The pain is visible, but the outreach angle still needs tighter language."
                : "Pain clarity is still weak, so first contact should prioritize problem discovery.",
    };
}

function buildOutreachFriendliness(input: FirstCustomerInput, source: string, script: string): FirstCustomerDimension {
    const text = joinText([source, script, input.revenue_path.first_customer_path]);
    let score = 46;

    if (source) score += 20;
    if (script) score += 18;
    if (/community|reddit|show hn|linkedin|warm|referral|outbound/.test(text)) score += 10;
    if (/marketplace|ecosystem|app store/.test(text)) score += 8;
    if (/enterprise procurement|compliance review/.test(text)) score -= 12;

    score = clamp(score);

    return {
        key: "outreach_friendliness",
        label: "Outreach friendliness",
        score,
        summary: score >= 70
            ? "The first outreach motion looks practical enough to run immediately."
            : score >= 50
                ? "Outreach is plausible, but the first message still needs refinement."
                : "Outreach friction is high, so the first motion should stay lightweight and discovery-led.",
    };
}

function buildProofRequirement(input: FirstCustomerInput): FirstCustomerDimension {
    const text = joinText([
        input.revenue_path.recommended_entry_mode,
        input.revenue_path.main_execution_risk,
        input.revenue_path.first_offer_suggestion,
    ]);
    let score = 72;

    if (/service-first|concierge|interviews/.test(text)) score += 10;
    if (/saas-first/.test(text)) score -= 10;
    if (/enterprise|security|compliance|migration/.test(text)) score -= 18;

    score = clamp(score);

    return {
        key: "proof_requirement",
        label: "Proof requirement",
        score,
        summary: score >= 70
            ? "You can approach first customers with a lightweight proof burden."
            : score >= 50
                ? "Some proof will be needed before buyers engage seriously."
                : "The first customers will likely require more proof than a simple early outreach test can provide.",
    };
}

function buildChannelAccessibility(input: FirstCustomerInput, source: string): FirstCustomerDimension {
    const text = joinText([source, input.revenue_path.first_customer_path, input.idea_text]);
    let score = 42;

    if (source) score += 18;
    if (/reddit|show hn|indie hackers|community|linkedin|warm|referral/.test(text)) score += 20;
    if (/marketplace|app store|ecosystem|integration/.test(text)) score += 12;
    if (/paid acquisition|ads|seo/.test(text)) score -= 10;

    score = clamp(score);

    return {
        key: "channel_accessibility",
        label: "Channel accessibility",
        score,
        summary: score >= 70
            ? "The initial channel is accessible enough to test without major setup."
            : score >= 50
                ? "The initial channel is usable, but still needs some founder effort to unlock."
                : "Channel accessibility is weak, so the first-customer path may stall without a simpler channel.",
    };
}

function classifyChannel(source: string, tactic: string, script: string, input: FirstCustomerInput): FirstCustomerChannel {
    const text = joinText([source, tactic, script, input.revenue_path.first_customer_path, input.revenue_path.recommended_entry_mode]);

    if (/warm|referral|friend|network|intro/.test(text)) return "Warm network / referrals";
    if (/linkedin|cold|outbound|prospect|dm/.test(text)) return "LinkedIn outbound";
    if (/marketplace|ecosystem|shopify|slack|notion|hubspot|app store|integration/.test(text)) return "Integration ecosystem / marketplace";
    if (/service|done-for-you|pilot|implementation/.test(text)) return "Service-led outreach";
    if (/content|post|show hn|newsletter|blog|inbound/.test(text)) return "Content-led inbound";
    if (/interview|discovery|talk to|calls/.test(text) && input.demand_proof.direct_quote_count === 0) return "Interview-first / discovery-first";
    if (/founder|indie hackers|saas|show hn|maker/.test(text)) return "Founder communities";
    if (/community|forum|slack|discord|association|professional|operators|accounting|clinic|agency/.test(text)) return "Niche professional communities";

    return "Interview-first / discovery-first";
}

function likelyArchetype(input: FirstCustomerInput) {
    return input.buyer_clarity.icp_summary || input.buyer_clarity.wedge_summary || input.idea_text;
}

function outreachAngle(input: FirstCustomerInput, tactic: string, script: string) {
    if (tactic) return tactic;
    if (script) return script;
    if (input.demand_proof.direct_quote_count > 0) {
        return `Lead with the sharpest recurring pain from ${input.buyer_clarity.wedge_summary || input.idea_text}, then ask for a short validation call or pilot.`;
    }
    return `Lead with problem discovery for ${input.buyer_clarity.wedge_summary || input.idea_text}, not a broad product pitch.`;
}

function proofPath(input: FirstCustomerInput, validationGate: string, source: string) {
    if (validationGate) return validationGate;
    if (input.revenue_path.first_customer_path) return input.revenue_path.first_customer_path;
    if (source) return `Use ${source} to get 3 to 5 conversations before you broaden the offer.`;
    return "Run discovery conversations first, then test whether the first offer earns real intent or a paid pilot.";
}

function validationMotion(primaryChannel: FirstCustomerChannel, input: FirstCustomerInput) {
    if (primaryChannel === "Interview-first / discovery-first") {
        return "Start with discovery calls before you sell or build more.";
    }
    if (primaryChannel === "Service-led outreach") {
        return "Offer a narrow pilot or done-for-you result before productizing the workflow.";
    }
    if (primaryChannel === "LinkedIn outbound" || primaryChannel === "Warm network / referrals") {
        return "Run direct founder-led outreach with a clear pain angle and a small ask.";
    }
    if (primaryChannel === "Integration ecosystem / marketplace") {
        return "Validate through the ecosystem entry point first, then widen distribution only if response is real.";
    }
    if (input.revenue_path.recommended_entry_mode === "Concierge MVP") {
        return "Sell the result manually first, then automate only the repeated parts.";
    }
    return "Use a focused channel test to get first conversations or pilot commitments before a bigger launch.";
}

function channelRecommendations(primaryChannel: FirstCustomerChannel, source: string, input: FirstCustomerInput): FirstCustomerChannelRecommendation[] {
    const recommendations: FirstCustomerChannelRecommendation[] = [];
    const push = (channel: FirstCustomerChannel, label: string, reason: string) => {
        if (recommendations.some((entry) => entry.channel === channel)) return;
        recommendations.push({ channel, label, reason });
    };

    push(primaryChannel, source || primaryChannel, "Best current first-contact path based on the report's earliest customer route.");

    if (primaryChannel !== "Interview-first / discovery-first" && input.demand_proof.direct_quote_count === 0) {
        push("Interview-first / discovery-first", "Discovery calls", "Demand proof is still thin, so direct discovery should run alongside any other channel.");
    }

    const pathText = joinText([input.revenue_path.first_customer_path, input.revenue_path.first_offer_suggestion]);
    if (/linkedin|outbound|prospect/.test(pathText)) {
        push("LinkedIn outbound", "LinkedIn outbound", "The current first-customer path reads like direct founder-led outreach.");
    }
    if (/community|reddit|show hn|indie hackers|forum/.test(pathText)) {
        push("Founder communities", "Founder communities", "The current plan points toward visible founder channels for early proof.");
    }
    if (/professional|operators|association|slack|discord|accounting|clinic|agency/.test(pathText)) {
        push("Niche professional communities", "Niche communities", "The wedge appears concentrated enough for professional communities to matter.");
    }
    if (/marketplace|ecosystem|app store|integration/.test(pathText)) {
        push("Integration ecosystem / marketplace", "Integration ecosystem", "The entry wedge appears tied to an existing product ecosystem.");
    }

    return recommendations.slice(0, 3);
}

function mainAcquisitionFriction(dimensions: FirstCustomerDimension[]) {
    const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
    if (!weakest) return "The first-customer path still depends on inferred channel fit.";
    if (weakest.key === "trust_barrier") return "Trust friction is high, so buyers may need proof or lower-risk offers before responding.";
    if (weakest.key === "channel_accessibility") return "The current channel is not easy enough to access repeatedly.";
    if (weakest.key === "niche_concentration") return "The niche still looks too broad, which makes first-customer acquisition scattered.";
    if (weakest.key === "outreach_friendliness") return "The first outreach angle is still not specific enough to cut through.";
    if (weakest.key === "proof_requirement") return "Buyers likely need more proof before they engage seriously.";
    return `${weakest.label} is the main friction in the current first-customer path.`;
}

export function buildFirstCustomerPlan(input: FirstCustomerInput): FirstCustomerPlan {
    const first10 = extractSection(input.report, "first_10_customers_strategy");
    const first3 = extractSection(first10, "customers_1_3");
    const source = normalizeString(first3.source);
    const tactic = normalizeString(first3.tactic);
    const script = normalizeString(first3.script);
    const roadmap = normalizeArray<Record<string, unknown>>(input.report.launch_roadmap);
    const validationGate = normalizeString(roadmap[0]?.validation_gate);
    const primaryChannel = classifyChannel(source, tactic, script, input);

    const dimensions = [
        buildBuyerReachability(input, source, tactic),
        buildNicheConcentration(input, source),
        buildTrustBarrier(input),
        buildUrgency(input),
        buildClarityOfPain(input),
        buildOutreachFriendliness(input, source, script),
        buildProofRequirement(input),
        buildChannelAccessibility(input, source),
    ];

    const confidenceScore = clamp(
        dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / dimensions.length * 0.7 +
        input.revenue_path.confidence_score * 0.3,
    );

    const rationale = `The first-customer path leans toward ${primaryChannel.toLowerCase()} because buyer reachability, channel accessibility, and proof requirements line up better there than in broader channels right now.`;

    return {
        likely_first_customer_archetype: likelyArchetype(input),
        primary_channel: primaryChannel,
        first_customer_channels: channelRecommendations(primaryChannel, source, input),
        first_outreach_angle: outreachAngle(input, tactic, script),
        first_proof_path: proofPath(input, validationGate, source),
        best_initial_validation_motion: validationMotion(primaryChannel, input),
        confidence_level: confidenceFromScore(confidenceScore),
        confidence_score: confidenceScore,
        main_acquisition_friction: mainAcquisitionFriction(dimensions),
        rationale,
        dimensions,
        direct_vs_inferred: {
            direct_evidence_count: input.demand_proof.direct_vs_inferred.direct_evidence_count,
            inferred_markers: [
                "First-customer planning is inferred from report channels, buyer clarity, and current revenue-path recommendations",
                "Channel recommendations are not observed conversion data",
            ],
        },
    };
}
