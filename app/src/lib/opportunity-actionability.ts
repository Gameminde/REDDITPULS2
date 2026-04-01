import type { EvidenceDirectness } from "@/lib/evidence";
import { buildOpportunityStrategySnapshot } from "@/lib/opportunity-strategy";
import type { MarketHydratedIdea } from "@/lib/market-feed";

export interface BoardIntelligenceEvidenceReference {
    id: string;
    title: string;
    snippet: string | null;
    url: string | null;
    platform: string;
    observed_at: string | null;
    directness: EvidenceDirectness;
}

export interface BoardIntelligence {
    summary_line: string;
    why_now_summary: string;
    strongest_reason: string;
    strongest_caution: string;
    invalidation_summary: string;
    invalidation_items: string[];
    recommended_action: string;
    first_step: string;
    evidence_snapshot: {
        evidence_count: number;
        direct_evidence_count: number;
        source_count: number;
        freshness_label: string;
        representative_evidence: BoardIntelligenceEvidenceReference[];
    };
    readiness: {
        score: number;
        posture: string;
        anti_idea_verdict: string;
    };
}

export interface MarketHint {
    suggested_wedge_label: string | null;
    why_it_matters_now: string;
    missing_proof: string;
    promotion_readiness: "ready" | "needs_wedge" | "needs_more_proof";
    recommended_board_action: string;
}

interface MarketHintIdea {
    topic: string;
    source_count: number;
    signal_contract?: {
        buyer_native_direct_count?: number;
        supporting_signal_count?: number;
        summary?: string;
    } | null;
    strategy_preview?: {
        strongest_reason?: string;
    } | null;
    market_status?: "visible" | "needs_wedge" | "suppressed";
    suggested_wedge_label?: string | null;
    board_eligible?: boolean;
    board_stale_reason?: string | null;
}

function normalizeText(value: unknown) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function stripTrailingPunctuation(value: string) {
    return value.replace(/[.!\s]+$/g, "").trim();
}

function ensureSentence(value: string, fallback: string) {
    const text = normalizeText(value || fallback);
    if (!text) return fallback;
    return /[.!?]$/.test(text) ? text : `${text}.`;
}

function lowerFirst(value: string) {
    const text = value.trim();
    if (!text) return text;
    return text.charAt(0).toLowerCase() + text.slice(1);
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
    return count === 1 ? singular : plural;
}

function buildProofLead(evidenceCount: number, directEvidenceCount: number, sourceCount: number) {
    if (directEvidenceCount > 0) {
        return `Repeated buyer pain is showing up across ${sourceCount} ${pluralize(sourceCount, "source")} with ${directEvidenceCount} direct ${pluralize(directEvidenceCount, "signal")}`;
    }
    return `${evidenceCount} evidence ${pluralize(evidenceCount, "point")} across ${sourceCount} ${pluralize(sourceCount, "source")} support this opportunity`;
}

export function buildOpportunityStrategySnapshotForIdea(idea: MarketHydratedIdea) {
    return buildOpportunityStrategySnapshot({
        ...(idea as Record<string, unknown>),
        id: String(idea.id || ""),
        slug: String(idea.slug || ""),
        topic: String(idea.topic || ""),
        category: String(idea.category || ""),
        current_score: Number(idea.current_score || 0),
        change_24h: Number(idea.change_24h || 0),
        change_7d: Number(idea.change_7d || 0),
        post_count_total: Number(idea.post_count_total || 0),
        post_count_24h: Number(idea.post_count_24h || 0),
        post_count_7d: Number(idea.post_count_7d || 0),
        source_count: Number(idea.source_count || idea.evidence_summary?.source_count || 0),
        sources: idea.sources || [],
        pain_summary: normalizeText(idea.pain_summary || ""),
        top_posts: idea.top_posts || [],
        keywords: idea.keywords || [],
        icp_data: (idea.icp_data || null) as Record<string, unknown> | null,
        competition_data: (idea.competition_data || null) as Record<string, unknown> | null,
        last_updated: normalizeText(idea.last_updated || ""),
        trust: idea.trust,
        evidence: idea.evidence,
        evidence_summary: idea.evidence_summary,
    });
}

export function buildBoardIntelligence(idea: MarketHydratedIdea): BoardIntelligence {
    const strategySnapshot = buildOpportunityStrategySnapshotForIdea(idea);
    const representativeEvidence = strategySnapshot.demand_proof.representative_evidence.slice(0, 3).map((item) => ({
        id: item.id,
        title: item.title,
        snippet: item.snippet,
        url: item.url,
        platform: item.platform,
        observed_at: item.observed_at,
        directness: item.directness,
    }));
    const strongestCaution = ensureSentence(
        idea.strategy_preview?.strongest_caution || strategySnapshot.anti_idea.strongest_reason_to_wait_pivot_or_kill,
        "Proof is still early enough that this should stay disciplined before it expands.",
    );
    const proofLead = buildProofLead(
        Number(strategySnapshot.demand_proof.evidence_count || idea.evidence_summary?.evidence_count || 0),
        Number(strategySnapshot.demand_proof.direct_vs_inferred.direct_evidence_count || idea.evidence_summary?.direct_evidence_count || 0),
        Number(strategySnapshot.demand_proof.source_count || idea.evidence_summary?.source_count || 0),
    );
    const cautionLead = stripTrailingPunctuation(strongestCaution);
    const summaryLine = ensureSentence(
        `${proofLead}, but ${lowerFirst(cautionLead)}`,
        `${proofLead}.`,
    );

    return {
        summary_line: summaryLine,
        why_now_summary: ensureSentence(strategySnapshot.why_now.summary, "The timing case is still weak and needs more proof."),
        strongest_reason: ensureSentence(
            idea.strategy_preview?.strongest_reason || strategySnapshot.demand_proof.summary,
            "Repeated proof is surfacing, but the wedge should stay narrow.",
        ),
        strongest_caution: strongestCaution,
        invalidation_summary: ensureSentence(
            strategySnapshot.anti_idea.strongest_reason_to_wait_pivot_or_kill,
            "This opportunity needs explicit stop conditions before it is treated as durable.",
        ),
        invalidation_items: strategySnapshot.anti_idea.what_would_need_to_improve.slice(0, 4),
        recommended_action: ensureSentence(
            strategySnapshot.next_move.recommended_action,
            "Run a narrow validation step before you expand this idea.",
        ),
        first_step: ensureSentence(
            strategySnapshot.next_move.first_step,
            "Talk to a few target buyers before you build more.",
        ),
        evidence_snapshot: {
            evidence_count: Number(strategySnapshot.demand_proof.evidence_count || idea.evidence_summary?.evidence_count || 0),
            direct_evidence_count: Number(strategySnapshot.demand_proof.direct_vs_inferred.direct_evidence_count || idea.evidence_summary?.direct_evidence_count || 0),
            source_count: Number(strategySnapshot.demand_proof.source_count || idea.evidence_summary?.source_count || 0),
            freshness_label: normalizeText(strategySnapshot.demand_proof.freshness_label || idea.evidence_summary?.freshness_label || "Freshness unknown"),
            representative_evidence: representativeEvidence,
        },
        readiness: {
            score: Number(idea.strategy_preview?.readiness_score || 0),
            posture: normalizeText(idea.strategy_preview?.posture || "Wait and validate more first"),
            anti_idea_verdict: normalizeText(idea.strategy_preview?.anti_idea_verdict || "WAIT"),
        },
    };
}

export function buildMarketHint(idea: MarketHintIdea): MarketHint {
    const directBuyerCount = Number(idea.signal_contract?.buyer_native_direct_count || 0);
    const supportingSignalCount = Number(idea.signal_contract?.supporting_signal_count || 0);
    const strongestReason = ensureSentence(
        normalizeText(idea.strategy_preview?.strongest_reason || idea.signal_contract?.summary || ""),
        `Repeated discussion keeps clustering around ${idea.topic}.`,
    );

    let missingProof = "Keep monitoring for another cycle before you promote this broadly.";
    if (idea.market_status === "needs_wedge" && idea.suggested_wedge_label) {
        missingProof = `The proof is interesting, but the wedge "${idea.suggested_wedge_label}" still needs confirming evidence.`;
    } else if (idea.market_status === "needs_wedge") {
        missingProof = "This still needs a narrower wedge before it belongs on the board.";
    } else if (directBuyerCount <= 0) {
        missingProof = "This still needs direct buyer-language proof before it becomes a confident board bet.";
    } else if (idea.source_count < 2) {
        missingProof = "This still needs cross-source confirmation before the board thesis feels durable.";
    } else if (idea.board_stale_reason) {
        missingProof = ensureSentence(idea.board_stale_reason, idea.board_stale_reason);
    }

    let promotionReadiness: MarketHint["promotion_readiness"] = "needs_more_proof";
    if (idea.board_eligible) {
        promotionReadiness = "ready";
    } else if (idea.market_status === "needs_wedge") {
        promotionReadiness = "needs_wedge";
    }

    let recommendedBoardAction = "Keep monitoring until the proof is stronger.";
    if (promotionReadiness === "ready") {
        recommendedBoardAction = "Promote this to the board and validate the wedge.";
    } else if (promotionReadiness === "needs_wedge" && idea.suggested_wedge_label) {
        recommendedBoardAction = `Shape it around "${idea.suggested_wedge_label}" before promotion.`;
    } else if (promotionReadiness === "needs_wedge") {
        recommendedBoardAction = "Refine the wedge before promotion.";
    } else if (directBuyerCount <= 0 && supportingSignalCount > 0) {
        recommendedBoardAction = "Wait for direct buyer proof before promotion.";
    } else if (idea.source_count < 2) {
        recommendedBoardAction = "Wait for a second source before promotion.";
    }

    return {
        suggested_wedge_label: idea.suggested_wedge_label || null,
        why_it_matters_now: strongestReason,
        missing_proof: ensureSentence(missingProof, missingProof),
        promotion_readiness: promotionReadiness,
        recommended_board_action: ensureSentence(recommendedBoardAction, recommendedBoardAction),
    };
}
