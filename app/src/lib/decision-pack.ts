import { buildAntiIdeaAnalysis, type AntiIdeaAnalysis } from "@/lib/anti-idea";
import type { CompetitorWeaknessCluster } from "@/lib/competitor-weakness";
import type { EvidenceItem, EvidenceSummary } from "@/lib/evidence";
import { buildFirstCustomerPlan, type FirstCustomerPlan } from "@/lib/first-customer";
import { buildMarketAttackSimulation, type MarketAttackSimulation } from "@/lib/market-attack-simulator";
import { buildOpportunityToRevenuePath, type OpportunityRevenuePath } from "@/lib/opportunity-to-revenue";
import { buildServiceFirstSaasPathfinder, type ServiceFirstSaasPathfinder } from "@/lib/service-first-saas-pathfinder";
import type { TrustLevel, TrustMetadata } from "@/lib/trust";
import type { MomentumDirection, WhyNowSignal } from "@/lib/why-now";

export interface DecisionPackEvidenceReference {
    id: string;
    title: string;
    snippet: string | null;
    url: string | null;
    platform: string;
    observed_at: string | null;
    directness: "direct_evidence" | "derived_metric" | "ai_inference";
}

export interface DecisionPackDirectVsInferred {
    direct_evidence_count: number;
    inferred_markers: string[];
}

export interface DecisionPack {
    version: "v1";
    entity_type: "validation";
    entity_id: string;
    generated_at: string | null;
    verdict: {
        label: string;
        rationale: string;
    };
    confidence: {
        level: TrustLevel;
        label: string;
        score: number;
        model_score: number | null;
        summary: string;
        proof_summary: string;
        direct_vs_inferred: DecisionPackDirectVsInferred;
    };
    demand_proof: {
        summary: string;
        direct_evidence_summary: string;
        proof_summary: string;
        evidence_count: number;
        direct_quote_count: number;
        source_count: number;
        freshness_label: string;
        representative_evidence: DecisionPackEvidenceReference[];
        direct_vs_inferred: DecisionPackDirectVsInferred;
    };
    buyer_clarity: {
        summary: string;
        icp_summary: string;
        wedge_summary: string;
        budget_summary: string | null;
        buying_triggers: string[];
        direct_vs_inferred: DecisionPackDirectVsInferred;
    };
    competitor_gap: {
        summary: string;
        strongest_gap: string;
        live_weakness: null | {
            competitor: string;
            weakness_category: string;
            summary: string;
            trust_level: TrustLevel;
            wedge_opportunity_note: string;
        };
        direct_vs_inferred: DecisionPackDirectVsInferred;
    };
    why_now: {
        timing_category: string;
        summary: string;
        direct_timing_evidence: Array<{ label: string; value: string; kind: "metric" | "observation" }>;
        inferred_why_now_note: string;
        freshness_label: string;
        confidence_level: TrustLevel;
        momentum_direction: MomentumDirection;
        direct_vs_inferred: DecisionPackDirectVsInferred;
    };
    revenue_path: OpportunityRevenuePath;
    first_customer: FirstCustomerPlan;
    market_attack: MarketAttackSimulation;
    anti_idea: AntiIdeaAnalysis;
    service_first_pathfinder: ServiceFirstSaasPathfinder;
    next_move: {
        summary: string;
        recommended_action: string;
        first_step: string;
        monitor_note: string;
        direct_vs_inferred: DecisionPackDirectVsInferred;
    };
    kill_criteria: {
        summary: string;
        items: string[];
        direct_vs_inferred: DecisionPackDirectVsInferred;
    };
}

type DecisionPackWeakness = CompetitorWeaknessCluster & {
    why_now?: Pick<
        WhyNowSignal,
        "timing_category" | "momentum_direction" | "inferred_why_now_note" | "direct_timing_evidence" | "direct_vs_inferred"
    >;
};

interface ValidationDecisionPackInput {
    validation_id: string;
    idea_text: string;
    verdict: string | null;
    model_confidence: number | null;
    created_at?: string | null;
    completed_at?: string | null;
    report: Record<string, unknown>;
    trust: TrustMetadata;
    evidence: EvidenceItem[];
    evidence_summary: EvidenceSummary;
    competitor_weaknesses?: DecisionPackWeakness[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown) {
    return String(value || "").trim();
}

function normalizeArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function firstSentence(text: string) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    const parts = normalized.split(/(?<=[.!?])\s+/);
    return parts[0] || normalized;
}

function truncate(text: string, limit = 160) {
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 1).trim()}...`;
}

function confidenceLevelFromScore(score: number): TrustLevel {
    if (score >= 75) return "HIGH";
    if (score >= 50) return "MEDIUM";
    return "LOW";
}

function confidenceLabel(level: TrustLevel) {
    if (level === "HIGH") return "High confidence";
    if (level === "MEDIUM") return "Moderate confidence";
    return "Low confidence";
}

function extractReportSection(report: Record<string, unknown>, key: string) {
    const section = report[key];
    return isRecord(section) ? section : {};
}

function extractCompetitorNamesFromCompetition(report: Record<string, unknown>) {
    const competition = extractReportSection(report, "competition_landscape");
    return normalizeArray<Record<string, unknown> | string>(competition.direct_competitors)
        .map((item) => {
            if (typeof item === "string") return item;
            return normalizeString(item.name);
        })
        .filter(Boolean);
}

export function extractDecisionPackCompetitorNames(report: Record<string, unknown>) {
    return extractCompetitorNamesFromCompetition(report);
}

function representativeEvidence(items: EvidenceItem[]) {
    return items
        .filter((item) => item.directness === "direct_evidence")
        .slice(0, 3)
        .map((item) => ({
            id: item.id,
            title: item.title,
            snippet: item.snippet,
            url: item.url,
            platform: item.platform,
            observed_at: item.observed_at,
            directness: item.directness,
        }));
}

function buildVerdictRationale(report: Record<string, unknown>, verdict: string | null) {
    const verdictLabel = normalizeString(verdict) || "Pending verdict";
    const executiveSummary = normalizeString(report.executive_summary || report.summary);
    if (executiveSummary) return firstSentence(executiveSummary);

    const marketAnalysis = extractReportSection(report, "market_analysis");
    const painDescription = normalizeString(marketAnalysis.pain_description);
    if (painDescription) {
        return `${verdictLabel} because ${firstSentence(painDescription).replace(/^[A-Z]/, (match) => match.toLowerCase())}`;
    }

    return `${verdictLabel} based on the current balance of demand, competition, and execution risk.`;
}

function buildConfidenceSection(input: ValidationDecisionPackInput) {
    const modelScore = typeof input.model_confidence === "number" && Number.isFinite(input.model_confidence)
        ? Math.max(0, Math.min(100, Math.round(input.model_confidence)))
        : null;
    const combinedScore = modelScore == null
        ? input.trust.score
        : Math.max(0, Math.min(100, Math.round(input.trust.score * 0.6 + modelScore * 0.4)));
    const level = confidenceLevelFromScore(combinedScore);

    return {
        level,
        label: confidenceLabel(level),
        score: combinedScore,
        model_score: modelScore,
        summary: `${confidenceLabel(level)} because this validation has ${input.evidence_summary.evidence_count} evidence points across ${input.evidence_summary.source_count} sources and is ${input.trust.freshness_label.toLowerCase()}.`,
        proof_summary: modelScore == null
            ? `Evidence-backed trust is ${input.trust.score}/100.`
            : `Evidence-backed trust is ${input.trust.score}/100 and model confidence is ${modelScore}%.`,
        direct_vs_inferred: {
            direct_evidence_count: input.evidence_summary.direct_evidence_count,
            inferred_markers: [
                "Combined confidence blends evidence-backed trust with model confidence",
                ...input.trust.inference_flags.slice(0, 2),
            ],
        },
    };
}

function buildDemandProofSection(input: ValidationDecisionPackInput) {
    const signalSummary = extractReportSection(input.report, "signal_summary");
    const painQuotesFound = Number(signalSummary.pain_quotes_found || input.trust.direct_quote_count || 0);
    const wtpSignalsFound = Number(signalSummary.wtp_signals_found || 0);
    const representative = representativeEvidence(input.evidence);

    const summary = input.trust.weak_signal
        ? `Demand proof is still early: ${input.evidence_summary.evidence_count} evidence points across ${input.evidence_summary.source_count} sources, with ${painQuotesFound} direct pain quote${painQuotesFound === 1 ? "" : "s"}.`
        : `Demand proof is supported by ${input.evidence_summary.evidence_count} evidence points across ${input.evidence_summary.source_count} sources, including ${painQuotesFound} direct pain quote${painQuotesFound === 1 ? "" : "s"}.`;

    return {
        summary,
        direct_evidence_summary: representative.length > 0
            ? representative.map((item) => item.title).join(" | ")
            : "No representative direct evidence post is attached yet.",
        proof_summary: `${input.evidence_summary.source_count} sources, ${input.trust.freshness_label.toLowerCase()}, ${wtpSignalsFound} willingness-to-pay signal${wtpSignalsFound === 1 ? "" : "s"} found.`,
        evidence_count: input.evidence_summary.evidence_count,
        direct_quote_count: painQuotesFound,
        source_count: input.evidence_summary.source_count,
        freshness_label: input.trust.freshness_label,
        representative_evidence: representative,
        direct_vs_inferred: {
            direct_evidence_count: input.evidence_summary.direct_evidence_count,
            inferred_markers: [
                painQuotesFound === 0
                    ? "Buyer pain is inferred from clustered evidence, not direct buyer quotes"
                    : "Some demand conclusions still rely on synthesis across evidence",
            ],
        },
    };
}

function buildBuyerClaritySection(input: ValidationDecisionPackInput) {
    const icp = extractReportSection(input.report, "ideal_customer_profile");
    const primaryPersona = normalizeString(icp.primary_persona);
    const dayInTheLife = normalizeString(icp.day_in_the_life);
    const budgetRange = normalizeString(icp.budget_range);
    const buyingTriggers = normalizeArray<string>(icp.buying_triggers).map(normalizeString).filter(Boolean).slice(0, 3);
    const competition = extractReportSection(input.report, "competition_landscape");
    const easiestWin = normalizeString(competition.easiest_win);

    const summary = primaryPersona
        ? `The clearest buyer right now is ${primaryPersona}.`
        : "The buyer is only partly clear, so more direct customer discovery is still needed.";
    const wedgeSummary = primaryPersona
        ? `${primaryPersona}${budgetRange ? ` with a likely budget range of ${budgetRange}` : ""}${easiestWin ? `. The easiest initial wedge is tied to ${easiestWin}.` : "."}`
        : "Start with the narrowest buyer segment that repeatedly surfaced in the evidence before broadening the wedge.";

    return {
        summary,
        icp_summary: primaryPersona || truncate(dayInTheLife || "Primary buyer persona is still loosely inferred from the current evidence.", 180),
        wedge_summary: truncate(wedgeSummary, 200),
        budget_summary: budgetRange || null,
        buying_triggers: buyingTriggers,
        direct_vs_inferred: {
            direct_evidence_count: input.trust.direct_quote_count,
            inferred_markers: [
                input.trust.direct_quote_count === 0
                    ? "ICP and budget are inferred from clustered evidence and competitor context"
                    : "Buyer summary still synthesizes multiple evidence points into one wedge recommendation",
            ],
        },
    };
}

function strongestWeakness(input: ValidationDecisionPackInput) {
    return [...(input.competitor_weaknesses || [])]
        .sort((a, b) => (b.trust.score - a.trust.score) || (b.evidence_count - a.evidence_count))
        [0] || null;
}

function buildCompetitorGapSection(input: ValidationDecisionPackInput) {
    const competition = extractReportSection(input.report, "competition_landscape");
    const liveWeakness = strongestWeakness(input);
    const directCompetitors = extractCompetitorNamesFromCompetition(input.report);
    const strongestGap =
        normalizeString(competition.your_unfair_advantage) ||
        liveWeakness?.wedge_opportunity_note ||
        normalizeString(competition.easiest_win) ||
        (directCompetitors.length > 0 ? `Attack the narrowest wedge against ${directCompetitors[0]}.` : "Competitive gap is not sharply defined yet.");

    const summary = liveWeakness
        ? `${liveWeakness.competitor} is showing repeated weakness around ${liveWeakness.weakness_category.toLowerCase()}. ${liveWeakness.summary}`
        : strongestGap;

    return {
        summary: truncate(summary, 220),
        strongest_gap: truncate(strongestGap, 220),
        live_weakness: liveWeakness ? {
            competitor: liveWeakness.competitor,
            weakness_category: liveWeakness.weakness_category,
            summary: liveWeakness.summary,
            trust_level: liveWeakness.trust.level,
            wedge_opportunity_note: liveWeakness.wedge_opportunity_note,
        } : null,
        direct_vs_inferred: {
            direct_evidence_count: liveWeakness?.direct_vs_inferred.direct_evidence_count || 0,
            inferred_markers: liveWeakness
                ? liveWeakness.direct_vs_inferred.inferred_markers
                : ["Competitor gap is inferred from the report landscape because no live weakness cluster overlapped yet."],
        },
    };
}

function classifyWhyNowCategory(input: ValidationDecisionPackInput, liveWeakness: DecisionPackWeakness | null) {
    const liveCategory = normalizeString(liveWeakness?.why_now?.timing_category);
    if (liveCategory && liveCategory !== "Unknown / weak signal") {
        return liveCategory;
    }

    const market = extractReportSection(input.report, "market_analysis");
    const trends = extractReportSection(input.report, "trends_data");
    const text = [
        normalizeString(market.market_timing),
        normalizeString(market.pain_description),
        normalizeString(input.report.executive_summary),
        normalizeString(input.report.summary),
        normalizeString(extractReportSection(input.report, "pricing_strategy").reasoning),
        normalizeString(extractReportSection(input.report, "competition_landscape").your_unfair_advantage),
    ].join(" ").toLowerCase();

    if (/\bai\b|automation|agent|copilot|llm|autopilot/.test(text)) return "AI capability shift";
    if (/complex|bloated|steep learning curve|hard to use|confusing/.test(text)) return "Tool complexity increase";
    if (/budget|cost|pricing|expensive|cheaper/.test(text)) return "Cost pressure / budget pressure";
    if (/workflow|manual|spreadsheet|context switch|fragment/.test(text)) return "Workflow fragmentation";
    if (/compliance|regulation|regulatory|gdpr|hipaa|audit/.test(text)) return "Regulatory / compliance pressure";
    if (/remote|distributed|async|timezone/.test(text)) return "Remote / distributed work friction";
    if (/integration|api|webhook|sync|connect/.test(text)) return "Integration sprawl";
    if (/stagnat|legacy|outdated|slow to adapt/.test(text)) return "Competitor stagnation";
    if (/expectation|faster|self-serve|modern|onboarding|ux/.test(text)) return "New user expectation shift";

    const overallTrend = normalizeString(trends.overall_trend).toUpperCase();
    const avgChange = Number(trends.avg_change_percent || 0);
    if (overallTrend === "GROWING" || overallTrend === "EXPLODING" || avgChange >= 20) {
        return "Macro category acceleration";
    }

    return "Unknown / weak signal";
}

function classifyWhyNowMomentum(input: ValidationDecisionPackInput, liveWeakness: DecisionPackWeakness | null): MomentumDirection {
    const liveMomentum = normalizeString(liveWeakness?.why_now?.momentum_direction) as MomentumDirection;
    if (liveMomentum && liveMomentum !== "unknown") return liveMomentum;

    const trends = extractReportSection(input.report, "trends_data");
    const avgChange = Number(trends.avg_change_percent || 0);
    const postsAnalyzed = Number(extractReportSection(input.report, "signal_summary").posts_analyzed || 0);

    if (avgChange >= 30 || postsAnalyzed >= 40) return "accelerating";
    if (avgChange > 0 || postsAnalyzed >= 15) return "steady";
    if (avgChange < -10) return "cooling";
    if (postsAnalyzed > 0) return "new";
    return "unknown";
}

function buildWhyNowSection(input: ValidationDecisionPackInput) {
    const market = extractReportSection(input.report, "market_analysis");
    const trends = extractReportSection(input.report, "trends_data");
    const liveWeakness = strongestWeakness(input);
    const timingCategory = classifyWhyNowCategory(input, liveWeakness);
    const momentumDirection = classifyWhyNowMomentum(input, liveWeakness);
    const avgChange = Number(trends.avg_change_percent || 0);
    const timingAssessment = normalizeString(market.market_timing);
    const directTimingEvidence = [
        ...(liveWeakness?.why_now?.direct_timing_evidence || []).slice(0, 2),
        ...(avgChange
            ? [{ label: "Category momentum", value: `${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(1)}%`, kind: "metric" as const }]
            : []),
        ...(timingAssessment
            ? [{ label: "Timing assessment", value: truncate(timingAssessment, 100), kind: "observation" as const }]
            : []),
    ].slice(0, 4);

    let inferredNote = "Timing is still emerging, so keep treating this as a testable wedge rather than a locked-in market truth.";
    if (liveWeakness?.why_now?.inferred_why_now_note) {
        inferredNote = liveWeakness.why_now.inferred_why_now_note;
    } else if (timingCategory === "Macro category acceleration") {
        inferredNote = "The category is moving quickly enough that waiting may reduce the advantage of entering with a narrower wedge.";
    } else if (timingCategory === "AI capability shift") {
        inferredNote = "AI capability has moved enough that users may now expect automation instead of manual workarounds.";
    } else if (timingCategory === "Cost pressure / budget pressure") {
        inferredNote = "Budget pressure appears to be making leaner offers more attractive right now.";
    } else if (timingCategory === "Competitor stagnation") {
        inferredNote = "Competitors look slow to adapt, which creates a better entry window for a focused challenger.";
    }

    const confidenceScore = liveWeakness
        ? Math.round((liveWeakness.trust.score + input.trust.score) / 2)
        : input.trust.score;

    return {
        timing_category: timingCategory,
        summary: timingAssessment
            ? truncate(timingAssessment, 200)
            : `${input.idea_text} looks timely because the current evidence suggests a real shift instead of a one-off spike.`,
        direct_timing_evidence: directTimingEvidence,
        inferred_why_now_note: inferredNote,
        freshness_label: input.trust.freshness_label,
        confidence_level: confidenceLevelFromScore(confidenceScore),
        momentum_direction: momentumDirection,
        direct_vs_inferred: {
            direct_evidence_count: liveWeakness?.why_now?.direct_vs_inferred.direct_evidence_count || Math.min(input.evidence_summary.direct_evidence_count, directTimingEvidence.length),
            inferred_markers: liveWeakness?.why_now?.direct_vs_inferred.inferred_markers || [
                "Why-now reasoning combines timing clues, trend movement, and competitor context",
            ],
        },
    };
}

function buildNextMoveSection(input: ValidationDecisionPackInput, whyNowSummary: string, liveWeakness: DecisionPackWeakness | null) {
    const roadmap = normalizeArray<Record<string, unknown>>(input.report.launch_roadmap);
    const first10 = extractReportSection(input.report, "first_10_customers_strategy");
    const verdictUpper = normalizeString(input.verdict).toUpperCase();
    const firstRoadmapStep = roadmap[0];
    const firstTask = firstRoadmapStep && normalizeArray<string>(firstRoadmapStep.tasks)[0];
    const firstGate = normalizeString(firstRoadmapStep?.validation_gate);
    const firstChannel = normalizeString(firstRoadmapStep?.channel);
    const earlySource = extractReportSection(first10, "customers_1_3");
    const earlyTactic = normalizeString(earlySource.tactic);
    const earlySourceName = normalizeString(earlySource.source);

    let recommendedAction = "Run a narrow validation sprint before you commit to building.";
    let firstStep = firstTask || earlyTactic || "Talk to at least 3 target buyers before you write code.";
    let summary = "The next move should reduce uncertainty, not expand scope.";

    if (verdictUpper.includes("DON")) {
        recommendedAction = "Do not build this as-is; either narrow the wedge or keep monitoring the market.";
        firstStep = firstGate || firstTask || "Pause product work and test whether a narrower buyer wedge changes the signal.";
        summary = "The current evidence does not justify full build commitment yet.";
    } else if (verdictUpper.includes("BUILD") && input.trust.level === "HIGH") {
        recommendedAction = normalizeString(firstRoadmapStep?.title) || "Run the first launch sprint for this wedge.";
        firstStep = firstTask || earlyTactic || "Execute the first launch step with a concrete buyer target this week.";
        summary = `The signal is strong enough to move from analysis into execution. ${whyNowSummary}`;
    } else if (verdictUpper.includes("RISKY") || input.trust.level === "LOW") {
        recommendedAction = "Pressure-test the demand before you build more than the smallest wedge.";
        firstStep = firstGate || earlyTactic || firstTask || "Collect direct buyer proof before expanding scope.";
        summary = "The opportunity may be real, but the next step should be a proof-seeking test rather than a build sprint.";
    }

    const monitorNote = liveWeakness?.monitor.is_monitored
        ? "A related competitor weakness is already being monitored, so watch for new movement before broadening the wedge."
        : firstChannel || earlySourceName
            ? `After the first test, monitor ${firstChannel || earlySourceName} for repeated movement instead of relying on a one-time read.`
            : "Save this validation to monitor whether confidence, evidence, and competitor weakness strengthen over time.";

    return {
        summary,
        recommended_action: recommendedAction,
        first_step: firstStep,
        monitor_note: monitorNote,
        direct_vs_inferred: {
            direct_evidence_count: 0,
            inferred_markers: [
                "Next move is synthesized from the verdict, roadmap, and trust layers",
            ],
        },
    };
}

function buildKillCriteriaSection(input: ValidationDecisionPackInput) {
    const roadmap = normalizeArray<Record<string, unknown>>(input.report.launch_roadmap);
    const risks = normalizeArray<Record<string, unknown>>(input.report.risk_matrix);
    const market = extractReportSection(input.report, "market_analysis");

    const items = [
        ...roadmap
            .map((step) => normalizeString(step.validation_gate))
            .filter(Boolean),
        ...risks
            .filter((risk) => normalizeString(risk.severity).toUpperCase() === "HIGH")
            .map((risk) => {
                const riskLabel = normalizeString(risk.risk);
                const mitigation = normalizeString(risk.mitigation);
                if (!riskLabel) return "";
                return mitigation
                    ? `Pause if ${riskLabel.toLowerCase()} stays unresolved after the first sprint. Mitigation: ${mitigation}`
                    : `Pause if ${riskLabel.toLowerCase()} stays unresolved after the first sprint.`;
            })
            .filter(Boolean),
    ];

    if (!market.pain_validated) {
        items.push("Kill or pause the idea if direct buyer conversations still fail to confirm the core pain.");
    }
    if (input.trust.direct_quote_count === 0) {
        items.push("Do not scale the build until you collect direct buyer proof, not only inferred demand.");
    }
    if (input.evidence_summary.source_count < 2) {
        items.push("Treat the idea as unproven if the signal stays single-source after the next validation cycle.");
    }

    const uniqueItems = [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, 4);

    return {
        summary: uniqueItems.length > 0
            ? "Stop, pause, or narrow the idea if these conditions remain true after the first validation sprint."
            : "No explicit kill criteria were generated yet, so treat this as a gap in the current report.",
        items: uniqueItems.length > 0
            ? uniqueItems
            : ["No explicit kill criteria yet. Add at least one measurable stop condition before you build further."],
        direct_vs_inferred: {
            direct_evidence_count: Math.min(input.evidence_summary.direct_evidence_count, 2),
            inferred_markers: [
                "Kill criteria blend direct report gates with inferred stop conditions from trust gaps",
            ],
        },
    };
}

export function buildValidationDecisionPack(input: ValidationDecisionPackInput): DecisionPack {
    const normalizedVerdict = normalizeString(input.verdict) || "PENDING";
    const liveWeakness = strongestWeakness(input);
    const verdictRationale = buildVerdictRationale(input.report, normalizedVerdict);
    const confidence = buildConfidenceSection(input);
    const demandProof = buildDemandProofSection(input);
    const buyerClarity = buildBuyerClaritySection(input);
    const competitorGap = buildCompetitorGapSection(input);
    const whyNow = buildWhyNowSection(input);
    const killCriteria = buildKillCriteriaSection(input);
    const revenuePath = buildOpportunityToRevenuePath({
        idea_text: input.idea_text,
        verdict: normalizedVerdict,
        report: input.report,
        trust: input.trust,
        demand_proof: demandProof,
        buyer_clarity: buyerClarity,
        competitor_gap: competitorGap,
        why_now: whyNow,
        kill_criteria: killCriteria,
    });
    const firstCustomer = buildFirstCustomerPlan({
        idea_text: input.idea_text,
        report: input.report,
        trust: input.trust,
        demand_proof: demandProof,
        buyer_clarity: buyerClarity,
        why_now: whyNow,
        revenue_path: revenuePath,
    });
    const marketAttack = buildMarketAttackSimulation({
        idea_text: input.idea_text,
        verdict: normalizedVerdict,
        trust: input.trust,
        competitor_gap: competitorGap,
        why_now: whyNow,
        revenue_path: revenuePath,
        first_customer: firstCustomer,
    });
    const antiIdea = buildAntiIdeaAnalysis({
        trust: input.trust,
        demand_proof: demandProof,
        buyer_clarity: buyerClarity,
        competitor_gap: competitorGap,
        why_now: whyNow,
        revenue_path: revenuePath,
        first_customer: firstCustomer,
        market_attack: marketAttack,
    });
    const serviceFirstPathfinder = buildServiceFirstSaasPathfinder({
        trust: input.trust,
        demand_proof: demandProof,
        buyer_clarity: buyerClarity,
        competitor_gap: competitorGap,
        why_now: whyNow,
        revenue_path: revenuePath,
        first_customer: firstCustomer,
        market_attack: marketAttack,
        anti_idea: antiIdea,
    });
    const nextMove = buildNextMoveSection(input, whyNow.summary, liveWeakness);

    return {
        version: "v1",
        entity_type: "validation",
        entity_id: input.validation_id,
        generated_at: input.completed_at || input.created_at || null,
        verdict: {
            label: normalizedVerdict,
            rationale: verdictRationale,
        },
        confidence,
        demand_proof: demandProof,
        buyer_clarity: buyerClarity,
        competitor_gap: competitorGap,
        why_now: whyNow,
        revenue_path: revenuePath,
        first_customer: firstCustomer,
        market_attack: marketAttack,
        anti_idea: antiIdea,
        service_first_pathfinder: serviceFirstPathfinder,
        next_move: nextMove,
        kill_criteria: killCriteria,
    };
}
