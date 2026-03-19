import type { DecisionPack } from "@/lib/decision-pack";

export type ProfileLevel = "LOW" | "MEDIUM" | "HIGH";
export type FounderTeamMode = "SOLO" | "TEAM";
export type PreferredGtmMotion = "FOUNDER_LED_SALES" | "CONTENT_COMMUNITY" | "PRODUCT_LED" | "OUTBOUND";

export interface FounderProfile {
    technical_level: ProfileLevel;
    domain_familiarity: ProfileLevel;
    sales_gtm_strength: ProfileLevel;
    preferred_gtm_motion: PreferredGtmMotion;
    available_time: ProfileLevel;
    budget_tolerance: ProfileLevel;
    team_mode: FounderTeamMode;
    complexity_appetite: ProfileLevel;
}

export type FounderFitDimensionKey =
    | "technical_fit"
    | "domain_fit"
    | "gtm_fit"
    | "speed_to_execution_fit"
    | "complexity_tolerance_fit"
    | "budget_runway_fit";

export interface FounderFitDimension {
    key: FounderFitDimensionKey;
    label: string;
    score: number;
    summary: string;
}

export interface FounderMarketFit {
    fit_score: number;
    fit_summary: string;
    strongest_alignment: FounderFitDimension;
    biggest_mismatch: FounderFitDimension;
    founder_specific_next_move_note: string;
    dimensions: FounderFitDimension[];
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

const DEFAULT_PROFILE: FounderProfile = {
    technical_level: "HIGH",
    domain_familiarity: "LOW",
    sales_gtm_strength: "LOW",
    preferred_gtm_motion: "FOUNDER_LED_SALES",
    available_time: "MEDIUM",
    budget_tolerance: "LOW",
    team_mode: "SOLO",
    complexity_appetite: "MEDIUM",
};

function clamp(value: number, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(value)));
}

function levelToNumber(value: ProfileLevel) {
    if (value === "HIGH") return 3;
    if (value === "MEDIUM") return 2;
    return 1;
}

function numberToLevel(value: number): ProfileLevel {
    if (value >= 2.5) return "HIGH";
    if (value >= 1.5) return "MEDIUM";
    return "LOW";
}

function normalizeProfileLevel(value: unknown): ProfileLevel {
    const normalized = String(value || "").toUpperCase();
    if (normalized === "HIGH") return "HIGH";
    if (normalized === "LOW") return "LOW";
    return "MEDIUM";
}

function normalizePreferredGtmMotion(value: unknown): PreferredGtmMotion {
    const normalized = String(value || "").toUpperCase();
    if (normalized === "CONTENT_COMMUNITY") return "CONTENT_COMMUNITY";
    if (normalized === "PRODUCT_LED") return "PRODUCT_LED";
    if (normalized === "OUTBOUND") return "OUTBOUND";
    return "FOUNDER_LED_SALES";
}

function normalizeTeamMode(value: unknown): FounderTeamMode {
    return String(value || "").toUpperCase() === "TEAM" ? "TEAM" : "SOLO";
}

export function normalizeFounderProfile(raw: Record<string, unknown> | null | undefined): FounderProfile {
    return {
        technical_level: normalizeProfileLevel(raw?.technical_level),
        domain_familiarity: normalizeProfileLevel(raw?.domain_familiarity),
        sales_gtm_strength: normalizeProfileLevel(raw?.sales_gtm_strength),
        preferred_gtm_motion: normalizePreferredGtmMotion(raw?.preferred_gtm_motion),
        available_time: normalizeProfileLevel(raw?.available_time),
        budget_tolerance: normalizeProfileLevel(raw?.budget_tolerance),
        team_mode: normalizeTeamMode(raw?.team_mode),
        complexity_appetite: normalizeProfileLevel(raw?.complexity_appetite),
    };
}

export function defaultFounderProfile() {
    return { ...DEFAULT_PROFILE };
}

function absoluteFit(founder: ProfileLevel, requirement: ProfileLevel) {
    const difference = Math.abs(levelToNumber(founder) - levelToNumber(requirement));
    if (difference === 0) return 100;
    if (difference === 1) return 70;
    return 38;
}

function inferRequiredTechnical(pack: DecisionPack): ProfileLevel {
    const text = [
        pack.competitor_gap.summary,
        pack.competitor_gap.strongest_gap,
        pack.why_now.summary,
        pack.next_move.recommended_action,
    ].join(" ").toLowerCase();

    if (/api|integration|compliance|infrastructure|agent|automation|ai-native|webhook/.test(text)) return "HIGH";
    if (/workflow|ops|b2b|dashboard|internal tool|niche tool/.test(text)) return "MEDIUM";
    return "LOW";
}

function inferRequiredDomain(pack: DecisionPack): ProfileLevel {
    const text = [
        pack.buyer_clarity.icp_summary,
        pack.buyer_clarity.wedge_summary,
        pack.why_now.timing_category,
        pack.competitor_gap.summary,
    ].join(" ").toLowerCase();

    if (/compliance|health|finance|security|legal|accounting|enterprise/.test(text)) return "HIGH";
    if (/sales|marketing|hr|ops|support|founder|saas/.test(text)) return "MEDIUM";
    return "LOW";
}

function inferRequiredGtm(pack: DecisionPack): ProfileLevel {
    const text = [
        pack.next_move.recommended_action,
        pack.next_move.first_step,
        pack.buyer_clarity.buying_triggers.join(" "),
    ].join(" ").toLowerCase();

    if (/outreach|demo|call|sales|pilot|enterprise|close/.test(text)) return "HIGH";
    if (/community|content|post|launch|waitlist|self-serve/.test(text)) return "MEDIUM";
    return "LOW";
}

function inferPreferredMotion(pack: DecisionPack): PreferredGtmMotion {
    const text = `${pack.next_move.recommended_action} ${pack.next_move.first_step}`.toLowerCase();

    if (/content|community|reddit|show hn|post|audience/.test(text)) return "CONTENT_COMMUNITY";
    if (/self-serve|product-led|free tier|landing page/.test(text)) return "PRODUCT_LED";
    if (/outbound|cold|prospect/.test(text)) return "OUTBOUND";
    return "FOUNDER_LED_SALES";
}

function inferExecutionSpeed(pack: DecisionPack): ProfileLevel {
    const text = `${pack.next_move.recommended_action} ${pack.kill_criteria.summary}`.toLowerCase();
    const killCount = pack.kill_criteria.items.length;

    if (killCount >= 3 || /compliance|complex|enterprise/.test(text)) return "HIGH";
    if (killCount >= 2 || /validation sprint|talk to|test/.test(text)) return "MEDIUM";
    return "LOW";
}

function inferComplexity(pack: DecisionPack): ProfileLevel {
    const technical = inferRequiredTechnical(pack);
    const domain = inferRequiredDomain(pack);
    const gtm = inferRequiredGtm(pack);
    const average = (levelToNumber(technical) + levelToNumber(domain) + levelToNumber(gtm)) / 3;
    return numberToLevel(average);
}

function inferBudgetRequirement(pack: DecisionPack): ProfileLevel {
    const text = [
        pack.competitor_gap.summary,
        pack.buyer_clarity.budget_summary || "",
        pack.next_move.recommended_action,
        pack.kill_criteria.items.join(" "),
    ].join(" ").toLowerCase();

    if (/enterprise|paid acquisition|compliance|team|api costs|expensive/.test(text)) return "HIGH";
    if (/pilot|outreach|content|community|launch/.test(text)) return "MEDIUM";
    return "LOW";
}

function motionFit(founderMotion: PreferredGtmMotion, requiredMotion: PreferredGtmMotion) {
    if (founderMotion === requiredMotion) return 100;
    if (
        (founderMotion === "FOUNDER_LED_SALES" && requiredMotion === "OUTBOUND") ||
        (founderMotion === "OUTBOUND" && requiredMotion === "FOUNDER_LED_SALES") ||
        (founderMotion === "CONTENT_COMMUNITY" && requiredMotion === "PRODUCT_LED") ||
        (founderMotion === "PRODUCT_LED" && requiredMotion === "CONTENT_COMMUNITY")
    ) {
        return 72;
    }
    return 48;
}

export function buildFounderMarketFit(pack: DecisionPack, founderProfile: FounderProfile): FounderMarketFit {
    const requiredTechnical = inferRequiredTechnical(pack);
    const requiredDomain = inferRequiredDomain(pack);
    const requiredGtm = inferRequiredGtm(pack);
    const requiredMotion = inferPreferredMotion(pack);
    const requiredSpeed = inferExecutionSpeed(pack);
    const requiredComplexity = inferComplexity(pack);
    const requiredBudget = inferBudgetRequirement(pack);

    const technicalFit: FounderFitDimension = {
        key: "technical_fit",
        label: "Technical Fit",
        score: absoluteFit(founderProfile.technical_level, requiredTechnical),
        summary: `This idea appears to require ${requiredTechnical.toLowerCase()} technical leverage and you rated yourself ${founderProfile.technical_level.toLowerCase()}.`,
    };
    const domainFit: FounderFitDimension = {
        key: "domain_fit",
        label: "Domain Fit",
        score: absoluteFit(founderProfile.domain_familiarity, requiredDomain),
        summary: `The buyer and wedge appear to demand ${requiredDomain.toLowerCase()} domain familiarity and your profile is ${founderProfile.domain_familiarity.toLowerCase()}.`,
    };
    const gtmFit: FounderFitDimension = {
        key: "gtm_fit",
        label: "GTM Fit",
        score: clamp((absoluteFit(founderProfile.sales_gtm_strength, requiredGtm) * 0.65) + (motionFit(founderProfile.preferred_gtm_motion, requiredMotion) * 0.35)),
        summary: `This idea seems to favor ${requiredMotion.toLowerCase().replace(/_/g, " ")} with ${requiredGtm.toLowerCase()} GTM strength.`,
    };
    const speedFit: FounderFitDimension = {
        key: "speed_to_execution_fit",
        label: "Speed-to-Execution Fit",
        score: absoluteFit(founderProfile.available_time, requiredSpeed),
        summary: `The execution pressure looks ${requiredSpeed.toLowerCase()} while your available time is ${founderProfile.available_time.toLowerCase()}.`,
    };
    const complexityFit: FounderFitDimension = {
        key: "complexity_tolerance_fit",
        label: "Complexity Tolerance Fit",
        score: clamp((absoluteFit(founderProfile.complexity_appetite, requiredComplexity) * 0.75) + ((founderProfile.team_mode === "TEAM" && requiredComplexity === "HIGH") ? 25 : founderProfile.team_mode === "SOLO" && requiredComplexity === "HIGH" ? -5 : 0)),
        summary: `This opportunity looks ${requiredComplexity.toLowerCase()} in complexity and your appetite is ${founderProfile.complexity_appetite.toLowerCase()} as a ${founderProfile.team_mode.toLowerCase()} founder.`,
    };
    const budgetFit: FounderFitDimension = {
        key: "budget_runway_fit",
        label: "Budget/Runway Fit",
        score: absoluteFit(founderProfile.budget_tolerance, requiredBudget),
        summary: `The likely budget pressure looks ${requiredBudget.toLowerCase()} while your budget tolerance is ${founderProfile.budget_tolerance.toLowerCase()}.`,
    };

    const dimensions = [technicalFit, domainFit, gtmFit, speedFit, complexityFit, budgetFit];
    const strongestAlignment = [...dimensions].sort((a, b) => b.score - a.score)[0];
    const biggestMismatch = [...dimensions].sort((a, b) => a.score - b.score)[0];
    const fitScore = clamp(dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / dimensions.length);

    const fitSummary =
        fitScore >= 75
            ? "Strong founder-market fit. This idea lines up well with your current strengths and constraints."
            : fitScore >= 55
                ? "Decent founder-market fit. You can pursue it, but one or two areas may slow execution."
                : "Weak founder-market fit right now. The market may be interesting, but it does not line up cleanly with your current constraints.";

    const founderSpecificNextMoveNote =
        biggestMismatch.key === "gtm_fit"
            ? "Do not hide behind product work. Pressure-test the GTM motion first, because go-to-market fit looks like the main mismatch."
            : biggestMismatch.key === "domain_fit"
                ? "Reduce domain risk by talking to 3 to 5 target buyers before you commit to a broad build."
                : biggestMismatch.key === "budget_runway_fit"
                    ? "Keep the first test unusually lean and avoid any approach that assumes paid acquisition or a long runway."
                    : biggestMismatch.key === "complexity_tolerance_fit"
                        ? "Narrow the wedge until the build and workflow complexity match what you can realistically sustain."
                        : `Use your strongest alignment in ${strongestAlignment.label.toLowerCase()} to run the next validation step faster.`;

    return {
        fit_score: fitScore,
        fit_summary: fitSummary,
        strongest_alignment: strongestAlignment,
        biggest_mismatch: biggestMismatch,
        founder_specific_next_move_note: founderSpecificNextMoveNote,
        dimensions,
        direct_vs_inferred: {
            direct_evidence_count: pack.demand_proof.direct_vs_inferred.direct_evidence_count,
            inferred_markers: [
                "Founder-market fit is inferred from your profile plus the current decision pack",
                "Required skill and budget levels are heuristic, not directly observed user data",
            ],
        },
    };
}
