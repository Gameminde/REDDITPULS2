import type { AntiIdeaAnalysis } from "@/lib/anti-idea";
import { buildAntiIdeaAnalysis } from "@/lib/anti-idea";
import type { EvidenceItem, EvidenceSummary } from "@/lib/evidence";
import type { FirstCustomerPlan } from "@/lib/first-customer";
import { buildFirstCustomerPlan } from "@/lib/first-customer";
import type { MarketAttackSimulation } from "@/lib/market-attack-simulator";
import { buildMarketAttackSimulation } from "@/lib/market-attack-simulator";
import type { OpportunityRevenuePath } from "@/lib/opportunity-to-revenue";
import { buildOpportunityToRevenuePath } from "@/lib/opportunity-to-revenue";
import type { ProductizationPosture, ServiceFirstSaasPathfinder } from "@/lib/service-first-saas-pathfinder";
import { buildServiceFirstSaasPathfinder } from "@/lib/service-first-saas-pathfinder";
import type { TrustMetadata } from "@/lib/trust";
import { normalizeArray, type NormalizedSource } from "@/lib/trust";
import type { WhyNowSignal } from "@/lib/why-now";
import { buildWhyNowFromOpportunity } from "@/lib/why-now";

interface OpportunityEvidenceReference {
    id: string;
    title: string;
    snippet: string | null;
    url: string | null;
    platform: string;
    observed_at: string | null;
    directness: "direct_evidence" | "derived_metric" | "ai_inference";
}

interface OpportunityDirectVsInferred {
    direct_evidence_count: number;
    inferred_markers: string[];
}

interface OpportunityDemandProof {
    summary: string;
    direct_evidence_summary: string;
    proof_summary: string;
    evidence_count: number;
    direct_quote_count: number;
    source_count: number;
    freshness_label: string;
    representative_evidence: OpportunityEvidenceReference[];
    direct_vs_inferred: OpportunityDirectVsInferred;
}

interface OpportunityBuyerClarity {
    summary: string;
    icp_summary: string;
    wedge_summary: string;
    budget_summary: string | null;
    buying_triggers: string[];
    direct_vs_inferred: OpportunityDirectVsInferred;
}

interface OpportunityCompetitorGap {
    summary: string;
    strongest_gap: string;
    live_weakness: null;
    direct_vs_inferred: OpportunityDirectVsInferred;
}

interface OpportunityKillCriteria {
    summary: string;
    items: string[];
    direct_vs_inferred: OpportunityDirectVsInferred;
}

interface OpportunityNextMove {
    summary: string;
    recommended_action: string;
    first_step: string;
    monitor_note: string;
    direct_vs_inferred: OpportunityDirectVsInferred;
}

export interface OpportunityStrategySnapshot {
    version: "v1";
    entity_type: "opportunity";
    entity_id: string;
    generated_at: string | null;
    demand_proof: OpportunityDemandProof;
    buyer_clarity: OpportunityBuyerClarity;
    competitor_gap: OpportunityCompetitorGap;
    why_now: WhyNowSignal;
    revenue_path: OpportunityRevenuePath;
    first_customer: FirstCustomerPlan;
    market_attack: MarketAttackSimulation;
    anti_idea: AntiIdeaAnalysis;
    service_first_pathfinder: ServiceFirstSaasPathfinder;
    next_move: OpportunityNextMove;
}

export interface OpportunityStrategyPreview {
    posture: ProductizationPosture;
    posture_rationale: string;
    strongest_reason: string;
    strongest_caution: string;
    readiness_score: number;
    why_now_category: string;
    why_now_momentum: WhyNowSignal["momentum_direction"];
    next_move_summary: string;
    next_move_recommended_action: string;
    anti_idea_verdict: AntiIdeaAnalysis["verdict"]["label"];
    anti_idea_summary: string;
}

interface OpportunityStrategyInput {
    id: string;
    slug: string;
    topic: string;
    category?: string | null;
    current_score?: number | null;
    change_24h?: number | null;
    change_7d?: number | null;
    post_count_total?: number | null;
    post_count_24h?: number | null;
    post_count_7d?: number | null;
    source_count?: number | null;
    sources?: NormalizedSource[] | unknown;
    pain_summary?: string | null;
    top_posts?: Array<Record<string, unknown>> | unknown;
    keywords?: string[] | unknown;
    icp_data?: Record<string, unknown> | null;
    competition_data?: Record<string, unknown> | null;
    last_updated?: string | null;
    trust: TrustMetadata;
    evidence: EvidenceItem[];
    evidence_summary: EvidenceSummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown) {
    return String(value || "").trim();
}

function truncate(text: string, limit = 180) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= limit) return normalized;
    return `${normalized.slice(0, limit - 1).trim()}...`;
}

function opportunityVerdict(score: number) {
    if (score >= 65) return "BUILD IT";
    if (score >= 35) return "RISKY";
    return "DON'T BUILD";
}

function topicWords(topic: string, keywords: string[]) {
    const words = [...new Set([
        ...topic.split(/\s+/),
        ...keywords.flatMap((keyword) => keyword.split(/\s+/)),
    ])]
        .map((word) => word.trim())
        .filter((word) => word.length > 2);

    return words.slice(0, 5);
}

function extractCompetitorNames(competitionData: Record<string, unknown> | null | undefined) {
    if (!competitionData) return [] as string[];

    const sources = [
        competitionData.direct_competitors,
        competitionData.competitors,
        competitionData.indirect_competitors,
        competitionData.alternatives,
    ];

    const names = sources.flatMap((entry) =>
        normalizeArray<Record<string, unknown> | string>(entry).map((item) =>
            typeof item === "string" ? item : normalizeString(item.name),
        ),
    );

    return [...new Set(names.map(normalizeString).filter(Boolean))].slice(0, 5);
}

function inferPersona(icpData: Record<string, unknown> | null | undefined, topic: string, category: string) {
    const direct = [
        icpData?.primary_persona,
        icpData?.ideal_customer,
        icpData?.target_user,
        icpData?.user_segment,
    ]
        .map(normalizeString)
        .find(Boolean);

    if (direct) return direct;

    const text = `${topic} ${category}`.toLowerCase();
    if (/developer|dev|api|engineering|code/.test(text)) return "Developers and technical teams";
    if (/marketing|seo|content|ads/.test(text)) return "Marketing teams";
    if (/sales|crm|lead/.test(text)) return "Sales teams";
    if (/finance|invoice|account|accounting/.test(text)) return "Finance and operations teams";
    if (/hr|recruit|talent/.test(text)) return "HR and recruiting teams";

    return "Small B2B SaaS teams with repeated workflow pain";
}

function inferCommunities(icpData: Record<string, unknown> | null | undefined, category: string, sources: NormalizedSource[]) {
    const explicit = normalizeArray<string>(icpData?.specific_communities || icpData?.communities)
        .map(normalizeString)
        .filter(Boolean);

    if (explicit.length > 0) return explicit.slice(0, 4);

    const sourcePlatforms = sources.map((source) => source.platform.toLowerCase());
    const guesses: string[] = [];

    if (sourcePlatforms.includes("reddit")) guesses.push("targeted Reddit communities");
    if (sourcePlatforms.includes("hackernews")) guesses.push("Hacker News and maker communities");
    if (/developer|dev-tools|engineering/.test(category.toLowerCase())) guesses.push("developer communities");
    if (/marketing/.test(category.toLowerCase())) guesses.push("operator and marketing communities");
    if (/productivity|general|operations/.test(category.toLowerCase())) guesses.push("niche operator communities");

    return [...new Set(guesses)].slice(0, 3);
}

function inferBudget(icpData: Record<string, unknown> | null | undefined) {
    const direct = [
        icpData?.budget_range,
        icpData?.budget,
        icpData?.pricing_tolerance,
    ]
        .map(normalizeString)
        .find(Boolean);

    return direct || null;
}

function inferBuyingTriggers(icpData: Record<string, unknown> | null | undefined, painSummary: string, topPosts: Array<Record<string, unknown>>) {
    const explicit = normalizeArray<string>(icpData?.buying_triggers || icpData?.triggers)
        .map(normalizeString)
        .filter(Boolean);

    if (explicit.length > 0) return explicit.slice(0, 3);

    const fallback: string[] = [];
    const pain = painSummary.toLowerCase();
    const topTitle = normalizeString(topPosts[0]?.title);

    if (/manual|repetitive|time-consuming|slow/.test(pain)) fallback.push("Manual work becomes too expensive to keep tolerating");
    if (/integration|sync|handoff/.test(pain)) fallback.push("Teams hit tool sprawl or sync failures");
    if (/expensive|cost|budget/.test(pain)) fallback.push("Current tools feel too expensive for the value delivered");
    if (!fallback.length && topTitle) fallback.push(`A repeated workflow pain similar to "${truncate(topTitle, 60)}" surfaces again`);

    return fallback.slice(0, 3);
}

function buildDemandProof(input: OpportunityStrategyInput): OpportunityDemandProof {
    const representativeEvidence = input.evidence
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

    const summary = input.trust.weak_signal
        ? `This opportunity is interesting, but proof is still early: ${input.evidence_summary.evidence_count} evidence points across ${input.evidence_summary.source_count} sources.`
        : `This opportunity has repeated proof: ${input.evidence_summary.evidence_count} evidence points across ${input.evidence_summary.source_count} sources with ${input.trust.direct_quote_count} direct pain quote${input.trust.direct_quote_count === 1 ? "" : "s"}.`;

    return {
        summary,
        direct_evidence_summary: representativeEvidence.length > 0
            ? representativeEvidence.map((item) => item.title).join(" | ")
            : "No representative direct evidence post is attached yet.",
        proof_summary: `${input.evidence_summary.source_count} sources, ${input.trust.freshness_label.toLowerCase()}, ${input.trust.direct_quote_count} direct quote${input.trust.direct_quote_count === 1 ? "" : "s"}.`,
        evidence_count: input.evidence_summary.evidence_count,
        direct_quote_count: input.trust.direct_quote_count,
        source_count: input.evidence_summary.source_count,
        freshness_label: input.trust.freshness_label,
        representative_evidence: representativeEvidence,
        direct_vs_inferred: {
            direct_evidence_count: input.evidence_summary.direct_evidence_count,
            inferred_markers: input.trust.direct_quote_count === 0
                ? ["Pain and demand are partly inferred from clustered conversation, not direct quotes alone"]
                : ["Demand proof still synthesizes several evidence points into one opportunity thesis"],
        },
    };
}

function buildBuyerClarity(input: OpportunityStrategyInput): OpportunityBuyerClarity {
    const icpData = isRecord(input.icp_data) ? input.icp_data : null;
    const category = normalizeString(input.category || "general").replace(/-/g, " ");
    const persona = inferPersona(icpData, input.topic, category);
    const communities = inferCommunities(icpData, category, normalizeArray<NormalizedSource>(input.sources));
    const budget = inferBudget(icpData);
    const topPosts = normalizeArray<Record<string, unknown>>(input.top_posts);
    const buyingTriggers = inferBuyingTriggers(icpData, normalizeString(input.pain_summary), topPosts);
    const wedgeSummary = `${persona}${communities.length > 0 ? ` reached through ${communities.slice(0, 2).join(" and ")}` : ""}${budget ? ` with a likely budget band around ${budget}` : ""}.`;

    return {
        summary: `The clearest early buyer for this opportunity is ${persona}.`,
        icp_summary: persona,
        wedge_summary: wedgeSummary,
        budget_summary: budget,
        buying_triggers: buyingTriggers,
        direct_vs_inferred: {
            direct_evidence_count: Math.min(input.trust.direct_quote_count, 2),
            inferred_markers: [
                input.trust.direct_quote_count > 0
                    ? "ICP is partly anchored in observed pain language but still synthesized into one buyer wedge"
                    : "ICP is inferred from the opportunity theme, source mix, and clustered pain",
            ],
        },
    };
}

function buildCompetitorGap(input: OpportunityStrategyInput, buyerClarity: OpportunityBuyerClarity): OpportunityCompetitorGap {
    const competitionData = isRecord(input.competition_data) ? input.competition_data : null;
    const competitors = extractCompetitorNames(competitionData);
    const strongestGap = [
        competitionData?.your_unfair_advantage,
        competitionData?.easiest_win,
        competitionData?.narrative,
        competitionData?.market_gap,
    ]
        .map(normalizeString)
        .find(Boolean)
        || `Focus on a narrower ${normalizeString(input.category || "workflow").replace(/-/g, " ")} wedge for ${buyerClarity.icp_summary.toLowerCase()} instead of competing broadly.`;

    const summary = competitors.length > 0
        ? `The clearest opening is against ${competitors.slice(0, 2).join(" and ")} by staying narrower and more outcome-focused.`
        : strongestGap;

    return {
        summary: truncate(summary, 220),
        strongest_gap: truncate(strongestGap, 220),
        live_weakness: null,
        direct_vs_inferred: {
            direct_evidence_count: 0,
            inferred_markers: competitors.length > 0
                ? ["Competitor gap is inferred from stored competition context, not live weakness clusters on this surface"]
                : ["Competitive gap is inferred from the opportunity theme because no direct competitor mapping is attached yet"],
        },
    };
}

function dominantSourceLabel(sources: NormalizedSource[]) {
    if (sources.length === 0) return "targeted buyer communities";
    const top = [...sources].sort((a, b) => b.count - a.count)[0];
    if (top.platform === "reddit") return "Reddit communities where the pain is already surfacing";
    if (top.platform === "hackernews") return "Hacker News and technical founder circles";
    return `${top.platform} communities around this workflow`;
}

function buildSyntheticReport(
    input: OpportunityStrategyInput,
    buyerClarity: OpportunityBuyerClarity,
    competitorGap: OpportunityCompetitorGap,
    whyNow: WhyNowSignal,
) {
    const sources = normalizeArray<NormalizedSource>(input.sources);
    const communities = inferCommunities(isRecord(input.icp_data) ? input.icp_data : null, normalizeString(input.category || ""), sources);
    const competitors = extractCompetitorNames(isRecord(input.competition_data) ? input.competition_data : null);
    const keywords = normalizeArray<string>(input.keywords).map(normalizeString).filter(Boolean);
    const dominantSource = dominantSourceLabel(sources);
    const entryTasks = [
        `Talk to 3 to 5 ${buyerClarity.icp_summary.toLowerCase()} prospects about the narrowest version of ${input.topic}.`,
        "Offer the smallest outcome-focused pilot before expanding the scope.",
        "Track whether the same pain and urgency keep repeating over the next scrape cycles.",
    ];

    return {
        summary: normalizeString(input.pain_summary) || `${input.topic} is showing enough repeated pain to deserve a focused market test.`,
        executive_summary: normalizeString(input.pain_summary) || `${input.topic} is a promising wedge, but it should stay narrow until proof and delivery repeatability are clearer.`,
        willingness_to_pay: buyerClarity.budget_summary
            ? `Budget context exists around ${buyerClarity.budget_summary}, but pricing still needs live testing.`
            : "Willingness to pay is not fully proven yet, so the first offer should test price sensitivity directly.",
        ideal_customer_profile: {
            primary_persona: buyerClarity.icp_summary,
            day_in_the_life: `${buyerClarity.icp_summary} is dealing with repeated friction around ${input.topic.toLowerCase()}.`,
            budget_range: buyerClarity.budget_summary,
            buying_triggers: buyerClarity.buying_triggers,
            specific_communities: communities,
        },
        competition_landscape: {
            direct_competitors: competitors,
            easiest_win: competitorGap.strongest_gap,
            your_unfair_advantage: competitorGap.strongest_gap,
        },
        pricing_strategy: {
            summary: buyerClarity.budget_summary
                ? `Start with a narrow paid test anchored below or around ${buyerClarity.budget_summary}.`
                : "Start with a lightweight paid pilot or narrow recurring offer before assuming a full SaaS price point.",
            reasoning: `The first offer should stay narrow because ${whyNow.inferred_why_now_note.toLowerCase()}`,
            tiers: buyerClarity.budget_summary
                ? [{ name: "Starter", price: buyerClarity.budget_summary }]
                : [],
        },
        first_10_customers_strategy: {
            customers_1_3: {
                source: communities[0] || dominantSource,
                tactic: `Reach out where the pain already clusters: ${dominantSource}.`,
                script: `Lead with the concrete pain around ${topicWords(input.topic, keywords).slice(0, 3).join(", ")} and offer a narrow proof-of-value conversation.`,
            },
        },
        launch_roadmap: [
            {
                title: "Run the first wedge validation sprint",
                tasks: entryTasks,
                validation_gate: "At least 3 target buyers confirm the pain is urgent enough to pay for a narrower first offer.",
                channel: communities[0] || dominantSource,
            },
        ],
        mvp_features: topicWords(input.topic, keywords),
    } satisfies Record<string, unknown>;
}

function buildKillCriteria(
    input: OpportunityStrategyInput,
    demandProof: OpportunityDemandProof,
    buyerClarity: OpportunityBuyerClarity,
    competitorGap: OpportunityCompetitorGap,
    whyNow: WhyNowSignal,
): OpportunityKillCriteria {
    const items: string[] = [];

    if (demandProof.direct_quote_count === 0) {
        items.push("Do not productize yet if you still have no direct buyer-language proof after the next validation cycle.");
    }
    if (demandProof.source_count < 2) {
        items.push("Pause if the opportunity stays single-source and does not broaden into a healthier source mix.");
    }
    if ((input.post_count_24h || 0) < 3 && (input.change_24h || 0) <= 0) {
        items.push("Wait if fresh activity stays weak and the next scrape does not show stronger recent momentum.");
    }
    if (/small B2B SaaS teams/i.test(buyerClarity.icp_summary) && /narrower/i.test(competitorGap.strongest_gap)) {
        items.push("Narrow the buyer wedge further if early customer conversations still feel too broad or generic.");
    }
    if (whyNow.timing_category === "Unknown / weak signal") {
        items.push("Keep monitoring until the timing case is stronger than a generic weak-signal pattern.");
    }

    const uniqueItems = [...new Set(items)].slice(0, 4);

    return {
        summary: "These are the stop conditions that should keep this opportunity disciplined before you overbuild.",
        items: uniqueItems.length > 0
            ? uniqueItems
            : ["Keep the wedge narrow and avoid broad productization until proof, reachability, and timing strengthen further."],
        direct_vs_inferred: {
            direct_evidence_count: Math.min(demandProof.direct_vs_inferred.direct_evidence_count, 2),
            inferred_markers: ["Kill criteria are inferred from trust gaps, timing weakness, and wedge ambiguity on the opportunity surface"],
        },
    };
}

function buildNextMove(
    pathfinder: ServiceFirstSaasPathfinder,
    antiIdea: AntiIdeaAnalysis,
    revenuePath: OpportunityRevenuePath,
    whyNow: WhyNowSignal,
): OpportunityNextMove {
    let recommendedAction = revenuePath.first_offer_suggestion;
    let firstStep = revenuePath.first_customer_path;
    let summary = "Turn this opportunity into one concrete test before you do more analysis.";

    if (pathfinder.recommended_productization_posture === "Productize now") {
        recommendedAction = "Run the smallest paid product test around this wedge.";
        firstStep = revenuePath.first_offer_suggestion;
        summary = "This looks ready for a narrow product test, not just more observation.";
    } else if (pathfinder.recommended_productization_posture === "Start hybrid service + software") {
        recommendedAction = "Sell the outcome with light software support before broad productization.";
        firstStep = revenuePath.first_offer_suggestion;
        summary = "Use a hybrid move to get to proof and revenue faster than a pure SaaS jump.";
    } else if (pathfinder.recommended_productization_posture === "Stay service-first") {
        recommendedAction = "Sell the result manually first and learn the workflow through delivery.";
        firstStep = revenuePath.first_customer_path;
        summary = "The market may be real, but delivery-led learning is still safer than productizing too early.";
    } else if (pathfinder.recommended_productization_posture === "Concierge MVP first") {
        recommendedAction = "Run a concierge version of the outcome before you decide what to automate.";
        firstStep = revenuePath.first_offer_suggestion;
        summary = "Use manual proof to learn the narrowest repeatable wedge before you build more software.";
    } else if (antiIdea.verdict.label !== "LOW_CONCERN") {
        recommendedAction = "Wait, monitor, and gather stronger proof before you act.";
        firstStep = antiIdea.what_would_need_to_improve[0] || antiIdea.strongest_reason_to_wait_pivot_or_kill;
        summary = "The opportunity is interesting, but the next move should reduce risk rather than expand scope.";
    }

    return {
        summary,
        recommended_action: recommendedAction,
        first_step: firstStep,
        monitor_note: whyNow.monitorable_change_note,
        direct_vs_inferred: {
            direct_evidence_count: 0,
            inferred_markers: ["Next move is synthesized from the productization posture, revenue path, and anti-idea layers"],
        },
    };
}

export function buildOpportunityStrategySnapshot(input: OpportunityStrategyInput): OpportunityStrategySnapshot {
    const whyNow = buildWhyNowFromOpportunity({
        id: input.id,
        slug: input.slug,
        topic: input.topic,
        category: normalizeString(input.category || ""),
        current_score: Number(input.current_score || 0),
        change_24h: Number(input.change_24h || 0),
        change_7d: Number(input.change_7d || 0),
        post_count_24h: Number(input.post_count_24h || 0),
        post_count_7d: Number(input.post_count_7d || 0),
        source_count: Number(input.source_count || input.evidence_summary.source_count || 0),
        pain_summary: normalizeString(input.pain_summary || ""),
        top_posts: normalizeArray<Record<string, unknown>>(input.top_posts),
        keywords: normalizeArray<string>(input.keywords),
        last_updated: input.last_updated || undefined,
        trust: input.trust,
    }, false);
    const demandProof = buildDemandProof(input);
    const buyerClarity = buildBuyerClarity(input);
    const competitorGap = buildCompetitorGap(input, buyerClarity);
    const syntheticReport = buildSyntheticReport(input, buyerClarity, competitorGap, whyNow);
    const killCriteria = buildKillCriteria(input, demandProof, buyerClarity, competitorGap, whyNow);
    const verdict = opportunityVerdict(Number(input.current_score || 0));
    const revenuePath = buildOpportunityToRevenuePath({
        idea_text: input.topic,
        verdict,
        report: syntheticReport,
        trust: input.trust,
        demand_proof: demandProof,
        buyer_clarity: buyerClarity,
        competitor_gap: competitorGap,
        why_now: {
            timing_category: whyNow.timing_category,
            summary: whyNow.summary,
            freshness_label: whyNow.freshness.freshness_label,
            confidence_level: whyNow.confidence.level,
            momentum_direction: whyNow.momentum_direction,
        },
        kill_criteria: killCriteria,
    });
    const firstCustomer = buildFirstCustomerPlan({
        idea_text: input.topic,
        report: syntheticReport,
        trust: input.trust,
        demand_proof: demandProof,
        buyer_clarity: buyerClarity,
        why_now: {
            momentum_direction: whyNow.momentum_direction,
            summary: whyNow.summary,
        },
        revenue_path: revenuePath,
    });
    const marketAttack = buildMarketAttackSimulation({
        idea_text: input.topic,
        verdict,
        trust: input.trust,
        competitor_gap: competitorGap,
        why_now: {
            summary: whyNow.summary,
            timing_category: whyNow.timing_category,
            momentum_direction: whyNow.momentum_direction,
        },
        revenue_path: revenuePath,
        first_customer: firstCustomer,
    });
    const antiIdea = buildAntiIdeaAnalysis({
        trust: input.trust,
        demand_proof: demandProof,
        buyer_clarity: buyerClarity,
        competitor_gap: competitorGap,
        why_now: {
            timing_category: whyNow.timing_category,
            confidence_level: whyNow.confidence.level,
            momentum_direction: whyNow.momentum_direction,
        },
        revenue_path: revenuePath,
        first_customer: firstCustomer,
        market_attack: marketAttack,
    });
    const serviceFirstPathfinder = buildServiceFirstSaasPathfinder({
        trust: input.trust,
        demand_proof: demandProof,
        buyer_clarity: buyerClarity,
        competitor_gap: competitorGap,
        why_now: {
            timing_category: whyNow.timing_category,
            confidence_level: whyNow.confidence.level,
            momentum_direction: whyNow.momentum_direction,
        },
        revenue_path: revenuePath,
        first_customer: firstCustomer,
        market_attack: marketAttack,
        anti_idea: antiIdea,
    });
    const nextMove = buildNextMove(serviceFirstPathfinder, antiIdea, revenuePath, whyNow);

    return {
        version: "v1",
        entity_type: "opportunity",
        entity_id: input.id,
        generated_at: input.last_updated || null,
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
    };
}

export function buildOpportunityStrategyPreview(strategy: OpportunityStrategySnapshot): OpportunityStrategyPreview {
    return {
        posture: strategy.service_first_pathfinder.recommended_productization_posture,
        posture_rationale: strategy.service_first_pathfinder.posture_rationale,
        strongest_reason: strategy.service_first_pathfinder.strongest_reason_for_posture,
        strongest_caution: strategy.service_first_pathfinder.strongest_caution,
        readiness_score: strategy.service_first_pathfinder.productization_readiness_score,
        why_now_category: strategy.why_now.timing_category,
        why_now_momentum: strategy.why_now.momentum_direction,
        next_move_summary: strategy.next_move.summary,
        next_move_recommended_action: strategy.next_move.recommended_action,
        anti_idea_verdict: strategy.anti_idea.verdict.label,
        anti_idea_summary: strategy.anti_idea.verdict.summary,
    };
}
