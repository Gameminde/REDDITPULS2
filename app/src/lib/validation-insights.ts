import { createClient as createAdminClient } from "@supabase/supabase-js";
import { buildCompetitorWeaknessRadar } from "@/lib/competitor-weakness";
import { buildValidationDecisionPack, extractDecisionPackCompetitorNames, type DecisionPack } from "@/lib/decision-pack";
import { buildEvidenceSummary, buildValidationEvidence, type EvidenceItem, type EvidenceSummary } from "@/lib/evidence";
import { buildValidationTrust, normalizeArray, type TrustMetadata } from "@/lib/trust";
import { buildWhyNowFromWeaknessCluster } from "@/lib/why-now";

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export interface ValidationRowLike {
    id: string;
    idea_text: string;
    verdict: string | null;
    confidence: number | null;
    status: string;
    created_at: string | null;
    completed_at: string | null;
    report: unknown;
    [key: string]: unknown;
}

export interface EnrichedValidationView extends ValidationRowLike {
    report: Record<string, unknown>;
    trust: TrustMetadata;
    evidence: EvidenceItem[];
    evidence_summary: EvidenceSummary;
    source_breakdown: EvidenceSummary["source_breakdown"];
    direct_vs_inferred: EvidenceSummary["direct_vs_inferred"];
    decision_pack: DecisionPack | null;
    competitor_weaknesses: Array<ReturnType<typeof buildCompetitorWeaknessRadar>["clusters"][number] & {
        why_now: ReturnType<typeof buildWhyNowFromWeaknessCluster>;
    }>;
}

function parseReport(report: unknown): Record<string, unknown> {
    if (typeof report === "string") {
        try {
            const parsed = JSON.parse(report);
            return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
        } catch {
            return {};
        }
    }

    return report && typeof report === "object" ? report as Record<string, unknown> : {};
}

function normalizeString(value: unknown) {
    return String(value || "").trim();
}

async function loadRelevantCompetitorWeaknesses(parsedReport: Record<string, unknown>, userId?: string | null) {
    const competitorNames = extractDecisionPackCompetitorNames(parsedReport).map((name) => name.toLowerCase());
    if (competitorNames.length === 0) return [];

    const since = new Date(Date.now() - 45 * 86400000).toISOString();
    const [{ data: complaints, error: complaintsError }, alertResult] = await Promise.all([
        supabaseAdmin
            .from("competitor_complaints")
            .select("*")
            .gte("scraped_at", since)
            .order("scraped_at", { ascending: false })
            .limit(400),
        userId
            ? supabaseAdmin
                .from("pain_alerts")
                .select("*")
                .eq("user_id", userId)
                .eq("is_active", true)
            : Promise.resolve({ data: [], error: null }),
    ]);

    if (complaintsError || alertResult.error) return [];

    const relevantComplaints = (complaints || []).filter((complaint) => {
        const mentioned = normalizeArray<string>(complaint.competitors_mentioned)
            .map((value) => value.toLowerCase().trim())
            .filter(Boolean);

        return mentioned.some((value) => competitorNames.includes(value));
    });

    if (relevantComplaints.length === 0) return [];

    const radar = buildCompetitorWeaknessRadar({
        complaints: relevantComplaints,
        alerts: alertResult.data || [],
        limit: 4,
    });

    return radar.clusters.map((cluster) => ({
        ...cluster,
        why_now: buildWhyNowFromWeaknessCluster(cluster),
    }));
}

export async function buildEnrichedValidationView(validation: ValidationRowLike, userId?: string | null): Promise<EnrichedValidationView> {
    const validationStatus = normalizeString(validation.status).toLowerCase();
    const verdictLabel = normalizeString(validation.verdict);
    const parsedReport = parseReport(validation.report);
    const evidence = buildValidationEvidence({
        ...parsedReport,
        completed_at: validation.completed_at,
        generated_at: validation.completed_at || validation.created_at,
    }, validation.id);
    const evidenceSummary = buildEvidenceSummary(evidence);
    const trust = buildValidationTrust({
        confidence: validation.confidence,
        created_at: validation.created_at,
        completed_at: validation.completed_at,
        report: parsedReport,
    });
    const canBuildDecisionPack = validationStatus === "done" && Boolean(verdictLabel);
    const competitorWeaknesses = canBuildDecisionPack
        ? await loadRelevantCompetitorWeaknesses(parsedReport, userId)
        : [];
    const decisionPack = canBuildDecisionPack
        ? buildValidationDecisionPack({
            validation_id: validation.id,
            idea_text: validation.idea_text,
            verdict: verdictLabel,
            model_confidence: typeof validation.confidence === "number" ? validation.confidence : Number(validation.confidence || 0),
            created_at: validation.created_at,
            completed_at: validation.completed_at,
            report: parsedReport,
            trust,
            evidence,
            evidence_summary: evidenceSummary,
            competitor_weaknesses: competitorWeaknesses,
        })
        : null;

    return {
        ...validation,
        report: parsedReport,
        trust,
        evidence,
        evidence_summary: evidenceSummary,
        source_breakdown: evidenceSummary.source_breakdown,
        direct_vs_inferred: evidenceSummary.direct_vs_inferred,
        decision_pack: decisionPack,
        competitor_weaknesses: competitorWeaknesses,
    };
}
