import {
    buildCompetitorComplaintEvidence,
    buildEvidenceBackedTrust,
    buildEvidenceSummary,
    type EvidenceItem,
} from "@/lib/evidence";
import { formatFreshnessLabel, getFreshnessHours, normalizeArray, type TrustMetadata } from "@/lib/trust";

export const WEAKNESS_TAXONOMY = [
    "Pricing",
    "Complexity",
    "Missing Features",
    "Poor UX / Onboarding",
    "Support / Trust",
    "Performance / Reliability",
    "Integration Gaps",
    "Wrong Segment Fit",
    "AI / Automation Gaps",
    "Workflow Friction",
] as const;

export type WeaknessCategory = (typeof WEAKNESS_TAXONOMY)[number];

interface CategoryRule {
    category: WeaknessCategory;
    patterns: RegExp[];
    monitorKeywords: string[];
    wedgeTemplate: (competitor: string, segment: string | null) => string;
}

export interface CompetitorWeaknessEvidence {
    id: string;
    title: string;
    snippet: string | null;
    url: string | null;
    platform: string;
    observed_at: string | null;
    score: number | null;
    directness: "direct_evidence" | "derived_metric" | "ai_inference";
    confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface CompetitorWeaknessCluster {
    id: string;
    competitor: string;
    weakness_category: WeaknessCategory;
    summary: string;
    affected_segment: string | null;
    evidence_count: number;
    source_count: number;
    freshness: {
        latest_observed_at: string | null;
        freshness_hours: number | null;
        freshness_label: string;
    };
    trust: TrustMetadata;
    representative_evidence: CompetitorWeaknessEvidence[];
    wedge_opportunity_note: string;
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
    monitor: {
        is_monitored: boolean;
        alert_id: string | null;
        suggested_keywords: string[];
    };
}

const CATEGORY_RULES: CategoryRule[] = [
    {
        category: "Pricing",
        patterns: [/overpriced/i, /too expensive/i, /price hike/i, /price increase/i, /pricing/i, /paywall/i, /billing/i, /downgrade/i],
        monitorKeywords: ["expensive", "price", "billing"],
        wedgeTemplate: (competitor, segment) =>
            `A wedge against ${competitor} is likely to come from simpler, more transparent pricing${segment ? ` for ${segment}` : ""}.`,
    },
    {
        category: "Support / Trust",
        patterns: [/support/i, /customer service/i, /scam/i, /fraud/i, /rip[\s-]?off/i, /trust/i, /billing/i, /nonexistent/i],
        monitorKeywords: ["support", "trust", "billing"],
        wedgeTemplate: (competitor, segment) =>
            `If ${competitor} keeps eroding trust, a challenger can win with fast support, clear policies, and stronger reliability cues${segment ? ` for ${segment}` : ""}.`,
    },
    {
        category: "Performance / Reliability",
        patterns: [/broken/i, /buggy/i, /crash/i, /crashing/i, /unreliable/i, /slow/i, /downtime/i, /outage/i],
        monitorKeywords: ["broken", "buggy", "reliability"],
        wedgeTemplate: (competitor, segment) =>
            `Repeated reliability complaints make ${competitor} vulnerable to a speed-and-stability wedge${segment ? ` for ${segment}` : ""}.`,
    },
    {
        category: "Missing Features",
        patterns: [/missing/i, /lack/i, /lacking/i, /feature/i, /wish/i, /need.*feature/i, /can't/i, /cannot/i],
        monitorKeywords: ["feature", "missing", "need"],
        wedgeTemplate: (competitor, segment) =>
            `A focused product can attack ${competitor} by shipping the missing workflow customers keep asking for${segment ? ` in ${segment}` : ""}.`,
    },
    {
        category: "Poor UX / Onboarding",
        patterns: [/onboarding/i, /\bux\b/i, /\bui\b/i, /confusing/i, /hard to use/i, /clunky/i, /design/i],
        monitorKeywords: ["onboarding", "confusing", "ux"],
        wedgeTemplate: (competitor, segment) =>
            `A clarity-and-onboarding wedge against ${competitor} becomes stronger when users keep describing the product as hard to adopt${segment ? ` for ${segment}` : ""}.`,
    },
    {
        category: "Integration Gaps",
        patterns: [/integration/i, /api/i, /webhook/i, /zapier/i, /sync/i, /import/i, /export/i, /connect/i],
        monitorKeywords: ["integration", "api", "sync"],
        wedgeTemplate: (competitor, segment) =>
            `Integration gaps make ${competitor} vulnerable to a narrower product that connects cleanly into the existing workflow${segment ? ` for ${segment}` : ""}.`,
    },
    {
        category: "AI / Automation Gaps",
        patterns: [/\bai\b/i, /automation/i, /manual/i, /agent/i, /autopilot/i],
        monitorKeywords: ["ai", "automation", "manual"],
        wedgeTemplate: (competitor, segment) =>
            `If ${competitor} is still leaving manual work behind, an automation-first wedge could win${segment ? ` for ${segment}` : ""}.`,
    },
    {
        category: "Wrong Segment Fit",
        patterns: [/enterprise/i, /small team/i, /small business/i, /\bsmb\b/i, /agency/i, /freelancer/i, /solo/i, /overkill/i, /too basic/i],
        monitorKeywords: ["small team", "overkill", "agency"],
        wedgeTemplate: (competitor, segment) =>
            `The opening against ${competitor} is likely a segment wedge${segment ? ` for ${segment}` : ""} rather than a broad feature war.`,
    },
    {
        category: "Complexity",
        patterns: [/complex/i, /complicated/i, /steep learning curve/i, /setup/i, /configure/i, /bloated/i],
        monitorKeywords: ["complex", "setup", "bloated"],
        wedgeTemplate: (competitor, segment) =>
            `Complexity complaints suggest ${competitor} can be attacked with a narrower, faster-to-value product${segment ? ` for ${segment}` : ""}.`,
    },
    {
        category: "Workflow Friction",
        patterns: [/frustrat/i, /workaround/i, /too many clicks/i, /switching/i, /migrate/i, /manual/i, /friction/i, /abandoned/i, /gave up/i],
        monitorKeywords: ["friction", "manual", "workaround"],
        wedgeTemplate: (competitor, segment) =>
            `Workflow friction around ${competitor} points to a wedge that removes repetitive steps and shortens time-to-result${segment ? ` for ${segment}` : ""}.`,
    },
];

function slugify(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function toIso(value: unknown) {
    if (!value) return null;
    const parsed = Date.parse(String(value));
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toISOString();
}

function joinedComplaintText(row: Record<string, unknown>) {
    const title = String(row.post_title || "");
    const signals = normalizeArray<string>(row.complaint_signals).join(" ");
    return `${title} ${signals}`.trim().toLowerCase();
}

function inferSegment(row: Record<string, unknown>) {
    const text = joinedComplaintText(row);
    const subreddit = String(row.subreddit || "").toLowerCase();

    if (/agency|client/.test(text) || subreddit.includes("freelance")) return "agencies and client-service teams";
    if (/developer|engineer|programmer|devops|api/.test(text) || ["programming", "webdev", "golang", "python"].some((value) => subreddit.includes(value))) {
        return "developers and technical teams";
    }
    if (/sales|crm|pipeline|lead/.test(text)) return "sales teams";
    if (/marketing|seo|ads|content/.test(text)) return "marketing teams";
    if (/founder|startup|saas|indie/.test(text) || ["saas", "startups", "entrepreneur", "indiehackers"].some((value) => subreddit.includes(value))) {
        return "founders and small SaaS teams";
    }
    if (/small business|smb|solo|freelancer/.test(text)) return "small teams and solo operators";

    return null;
}

function classifyWeakness(row: Record<string, unknown>) {
    const text = joinedComplaintText(row);

    let bestRule: CategoryRule | null = null;
    let bestScore = 0;

    for (const rule of CATEGORY_RULES) {
        const score = rule.patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
        if (score > bestScore) {
            bestRule = rule;
            bestScore = score;
        }
    }

    return bestRule || CATEGORY_RULES[CATEGORY_RULES.length - 1];
}

function normalizeCompetitorName(value: unknown) {
    return String(value || "").trim();
}

function buildRadarEvidence(row: Record<string, unknown>, competitor: string) {
    const evidence = buildCompetitorComplaintEvidence(row, competitor);
    return evidence.map((item) => ({
        id: item.id,
        title: item.title,
        snippet: item.snippet,
        url: item.url,
        platform: item.platform,
        observed_at: item.observed_at,
        score: item.score,
        directness: item.directness,
        confidence: item.confidence,
    }));
}

function buildClusterSummary(competitor: string, category: WeaknessCategory, evidenceCount: number, segment: string | null) {
    const segmentNote = segment ? ` with repeated signals from ${segment}` : "";
    return `${competitor} is showing recurring weakness around ${category.toLowerCase()}${segmentNote}. ${evidenceCount} recent complaint signal${evidenceCount === 1 ? "" : "s"} support this cluster.`;
}

function monitoredAlertForCompetitor(alerts: Array<Record<string, unknown>>, competitor: string, suggestedKeywords: string[]) {
    const target = competitor.toLowerCase();
    return alerts.find((alert) => {
        const keywords = normalizeArray<string>(alert.keywords).map((value) => value.toLowerCase());
        if (!keywords.includes(target)) return false;
        return suggestedKeywords.some((keyword) => keywords.includes(keyword.toLowerCase()));
    }) || null;
}

export function monitorKeywordsForWeakness(competitor: string, category: WeaknessCategory) {
    const rule = CATEGORY_RULES.find((entry) => entry.category === category);
    const keywords = [competitor, ...(rule?.monitorKeywords || ["pain", "frustrated"])];
    return [...new Set(keywords.map((value) => value.trim()).filter(Boolean))].slice(0, 5);
}

export function buildCompetitorWeaknessRadar(input: {
    complaints: Array<Record<string, unknown>>;
    alerts?: Array<Record<string, unknown>>;
    competitorFilter?: string;
    categoryFilter?: string;
    limit?: number;
}) {
    const alerts = input.alerts || [];
    const grouped = new Map<string, {
        competitor: string;
        category: WeaknessCategory;
        complaints: Array<Record<string, unknown>>;
        evidenceItems: EvidenceItem[];
        representativeEvidence: CompetitorWeaknessEvidence[];
        segmentVotes: string[];
    }>();

    for (const complaint of input.complaints) {
        const competitors = normalizeArray<string>(complaint.competitors_mentioned)
            .map(normalizeCompetitorName)
            .filter(Boolean);

        if (competitors.length === 0) continue;

        const rule = classifyWeakness(complaint);

        if (input.categoryFilter && rule.category.toLowerCase() !== input.categoryFilter.toLowerCase()) {
            continue;
        }

        for (const competitor of competitors) {
            if (input.competitorFilter && competitor.toLowerCase() !== input.competitorFilter.toLowerCase()) {
                continue;
            }

            const key = `${competitor.toLowerCase()}::${rule.category}`;
            const current = grouped.get(key) || {
                competitor,
                category: rule.category,
                complaints: [],
                evidenceItems: [],
                representativeEvidence: [],
                segmentVotes: [],
            };

            current.complaints.push(complaint);
            current.evidenceItems.push(...buildCompetitorComplaintEvidence(complaint, competitor));
            current.representativeEvidence.push(...buildRadarEvidence(complaint, competitor));

            const segment = inferSegment(complaint);
            if (segment) current.segmentVotes.push(segment);

            grouped.set(key, current);
        }
    }

    const clusters = [...grouped.values()].map((cluster) => {
        const evidenceSummary = buildEvidenceSummary(cluster.evidenceItems);
        const dominantSegment = cluster.segmentVotes.length > 0
            ? cluster.segmentVotes.sort((a, b) =>
                cluster.segmentVotes.filter((value) => value === b).length -
                cluster.segmentVotes.filter((value) => value === a).length,
            )[0]
            : null;
        const rule = CATEGORY_RULES.find((entry) => entry.category === cluster.category)!;
        const suggestedKeywords = monitorKeywordsForWeakness(cluster.competitor, cluster.category);
        const linkedAlert = monitoredAlertForCompetitor(alerts, cluster.competitor, suggestedKeywords);
        const freshnessHours = getFreshnessHours(evidenceSummary.latest_observed_at);
        const trust = buildEvidenceBackedTrust({
            items: cluster.evidenceItems,
            extraWeakSignalReasons: cluster.complaints.length < 2 ? ["Only one complaint pattern captured so far"] : [],
            extraInferenceFlags: ["Wedge opportunity note is inferred from repeated complaints"],
        });

        const representativeEvidence = [...cluster.representativeEvidence]
            .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
            .slice(0, 3);

        return {
            id: `${slugify(cluster.competitor)}-${slugify(cluster.category)}`,
            competitor: cluster.competitor,
            weakness_category: cluster.category,
            summary: buildClusterSummary(cluster.competitor, cluster.category, cluster.complaints.length, dominantSegment),
            affected_segment: dominantSegment,
            evidence_count: cluster.complaints.length,
            source_count: evidenceSummary.source_count,
            freshness: {
                latest_observed_at: evidenceSummary.latest_observed_at,
                freshness_hours: freshnessHours,
                freshness_label: formatFreshnessLabel(freshnessHours),
            },
            trust,
            representative_evidence: representativeEvidence,
            wedge_opportunity_note: rule.wedgeTemplate(cluster.competitor, dominantSegment),
            direct_vs_inferred: {
                direct_evidence_count: evidenceSummary.direct_evidence_count,
                inferred_markers: [
                    dominantSegment ? "Affected segment is inferred from complaint language" : "Affected segment is not confidently inferable yet",
                    "Wedge opportunity note is inferred from complaint clustering",
                ],
            },
            monitor: {
                is_monitored: Boolean(linkedAlert),
                alert_id: linkedAlert ? String(linkedAlert.id) : null,
                suggested_keywords: suggestedKeywords,
            },
        } satisfies CompetitorWeaknessCluster;
    })
        .sort((a, b) =>
            (b.trust.score - a.trust.score) ||
            (b.evidence_count - a.evidence_count) ||
            ((Date.parse(b.freshness.latest_observed_at || "") || 0) - (Date.parse(a.freshness.latest_observed_at || "") || 0)),
        )
        .slice(0, input.limit || 20);

    return {
        clusters,
        competitors: [...new Set(clusters.map((cluster) => cluster.competitor))].sort(),
        categories: [...WEAKNESS_TAXONOMY],
        summary: {
            cluster_count: clusters.length,
            competitors_covered: new Set(clusters.map((cluster) => cluster.competitor)).size,
            monitored_competitors: new Set(clusters.filter((cluster) => cluster.monitor.is_monitored).map((cluster) => cluster.competitor)).size,
            high_confidence_clusters: clusters.filter((cluster) => cluster.trust.level === "HIGH").length,
        },
    };
}
