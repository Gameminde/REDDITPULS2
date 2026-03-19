import { formatFreshnessLabel, getFreshnessHours, normalizeArray, type TrustMetadata } from "@/lib/trust";

export const WHY_NOW_TAXONOMY = [
    "AI capability shift",
    "Tool complexity increase",
    "Cost pressure / budget pressure",
    "Workflow fragmentation",
    "Regulatory / compliance pressure",
    "Remote / distributed work friction",
    "Integration sprawl",
    "Competitor stagnation",
    "New user expectation shift",
    "Macro category acceleration",
    "Unknown / weak signal",
] as const;

export type WhyNowCategory = (typeof WHY_NOW_TAXONOMY)[number];
export type WhyNowScope = "opportunity" | "competitor";
export type MomentumDirection = "accelerating" | "steady" | "cooling" | "new" | "unknown";

export interface WhyNowEvidencePoint {
    label: string;
    value: string;
    kind: "metric" | "observation";
}

export interface WhyNowSignal {
    id: string;
    scope: WhyNowScope;
    title: string;
    href: string;
    timing_category: WhyNowCategory;
    summary: string;
    direct_timing_evidence: WhyNowEvidencePoint[];
    inferred_why_now_note: string;
    freshness: {
        latest_observed_at: string | null;
        freshness_hours: number | null;
        freshness_label: string;
    };
    confidence: {
        level: "HIGH" | "MEDIUM" | "LOW";
        label: string;
        score: number;
    };
    momentum_direction: MomentumDirection;
    monitorable_change_note: string;
    direct_vs_inferred: {
        direct_evidence_count: number;
        inferred_markers: string[];
    };
}

interface OpportunityLike {
    id?: string;
    slug?: string;
    topic?: string;
    category?: string;
    current_score?: number;
    change_24h?: number;
    change_7d?: number;
    post_count_24h?: number;
    post_count_7d?: number;
    source_count?: number;
    pain_summary?: string;
    top_posts?: Array<{ title?: string; source?: string; subreddit?: string }>;
    keywords?: string[];
    last_updated?: string;
    trust: TrustMetadata;
}

interface WeaknessClusterLike {
    id: string;
    competitor: string;
    weakness_category: string;
    summary: string;
    evidence_count: number;
    freshness: {
        latest_observed_at: string | null;
        freshness_label: string;
    };
    trust: TrustMetadata;
    representative_evidence: Array<{ title?: string; snippet?: string | null; platform?: string }>;
    wedge_opportunity_note: string;
    monitor: {
        is_monitored: boolean;
    };
}

function joinedOpportunityText(opportunity: OpportunityLike) {
    const topic = String(opportunity.topic || "");
    const category = String(opportunity.category || "");
    const pain = String(opportunity.pain_summary || "");
    const keywords = normalizeArray<string>(opportunity.keywords).join(" ");
    const titles = normalizeArray<{ title?: string }>(opportunity.top_posts).map((post) => String(post.title || "")).join(" ");
    return `${topic} ${category} ${pain} ${keywords} ${titles}`.toLowerCase();
}

function classifyOpportunityCategory(opportunity: OpportunityLike): WhyNowCategory {
    const text = joinedOpportunityText(opportunity);
    const topic = String(opportunity.topic || "").toLowerCase();
    const change24h = Number(opportunity.change_24h || 0);
    const sourceCount = Number(opportunity.source_count || 0);
    const posts24h = Number(opportunity.post_count_24h || 0);

    if (/\bai\b|automation|agent|copilot|llm|autopilot/.test(text) || topic.includes("ai")) {
        return "AI capability shift";
    }
    if (/compliance|regulation|regulatory|gdpr|hipaa|soc 2|audit|security review/.test(text)) {
        return "Regulatory / compliance pressure";
    }
    if (/remote|distributed|async|timezone|handoff/.test(text)) {
        return "Remote / distributed work friction";
    }
    if (/integration|api|webhook|sync|zapier|connect/.test(text)) {
        return "Integration sprawl";
    }
    if (/expensive|budget|cost|pricing|overpriced|cheaper/.test(text)) {
        return "Cost pressure / budget pressure";
    }
    if (/workflow|manual|context switch|fragment|too many tools|spreadsheet/.test(text)) {
        return "Workflow fragmentation";
    }
    if (/expectation|instant|self-serve|faster|modern|onboarding|ux/.test(text)) {
        return "New user expectation shift";
    }
    if ((change24h >= 20 && posts24h >= 8) || (change24h >= 10 && sourceCount >= 2)) {
        return "Macro category acceleration";
    }

    return "Unknown / weak signal";
}

function classifyWeaknessCategory(cluster: WeaknessClusterLike): WhyNowCategory {
    const weakness = cluster.weakness_category.toLowerCase();
    const summary = cluster.summary.toLowerCase();

    if (weakness.includes("ai")) return "AI capability shift";
    if (weakness.includes("pricing")) return "Cost pressure / budget pressure";
    if (weakness.includes("complexity")) return "Tool complexity increase";
    if (weakness.includes("integration")) return "Integration sprawl";
    if (weakness.includes("workflow")) return "Workflow fragmentation";
    if (weakness.includes("missing") || weakness.includes("support") || weakness.includes("wrong segment")) {
        return "Competitor stagnation";
    }
    if (weakness.includes("poor ux") || weakness.includes("onboarding")) {
        return "New user expectation shift";
    }
    if (/compliance|security|regulation/.test(summary)) {
        return "Regulatory / compliance pressure";
    }

    return "Unknown / weak signal";
}

function classifyOpportunityMomentum(opportunity: OpportunityLike): MomentumDirection {
    const change24h = Number(opportunity.change_24h || 0);
    const posts24h = Number(opportunity.post_count_24h || 0);

    if (change24h >= 20 || posts24h >= 12) return "accelerating";
    if (change24h > 0) return "steady";
    if (change24h < -5) return "cooling";
    if (posts24h > 0) return "new";
    return "unknown";
}

function classifyWeaknessMomentum(cluster: WeaknessClusterLike): MomentumDirection {
    const freshnessHours = getFreshnessHours(cluster.freshness.latest_observed_at);
    if (cluster.evidence_count >= 3 && freshnessHours != null && freshnessHours <= 72) return "accelerating";
    if (cluster.evidence_count >= 2) return "steady";
    if (freshnessHours != null && freshnessHours > 168) return "cooling";
    return "unknown";
}

function confidenceFromTrust(trust: TrustMetadata, category: WhyNowCategory) {
    const score = Math.max(0, Math.min(100, trust.score - (category === "Unknown / weak signal" ? 10 : 0)));
    const level = score >= 75 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW";
    return {
        level,
        label: level === "HIGH" ? "High confidence" : level === "MEDIUM" ? "Moderate confidence" : "Low confidence",
        score,
    } as const;
}

export function buildWhyNowFromOpportunity(opportunity: OpportunityLike, monitored = false): WhyNowSignal {
    const category = classifyOpportunityCategory(opportunity);
    const momentum = classifyOpportunityMomentum(opportunity);
    const freshnessHours = getFreshnessHours(opportunity.last_updated || null);
    const topPost = normalizeArray<{ title?: string }>(opportunity.top_posts)[0];

    let inferredNote = "Timing is still early, so this theme should be treated as directional rather than fully proven.";
    if (category === "AI capability shift") {
        inferredNote = "AI tooling looks mature enough that users are now expecting automation where manual work was previously tolerated.";
    } else if (category === "Cost pressure / budget pressure") {
        inferredNote = "Budget pressure appears to be sharpening buyer sensitivity, which can create openings for leaner offers.";
    } else if (category === "Integration sprawl") {
        inferredNote = "Teams appear to be hitting the cost of too many disconnected tools, making consolidation and smoother integrations more valuable right now.";
    } else if (category === "Workflow fragmentation") {
        inferredNote = "The workflow is showing signs of fragmentation, so a tighter wedge that removes switching and manual glue work is more timely.";
    } else if (category === "Macro category acceleration") {
        inferredNote = "The category is not just present; it is accelerating quickly enough to deserve attention now instead of later.";
    } else if (category === "New user expectation shift") {
        inferredNote = "Users appear to be raising the bar on speed, onboarding, and product quality, which makes older workflows easier to displace.";
    }

    return {
        id: `why-now-opportunity-${opportunity.id || opportunity.slug || opportunity.topic || "unknown"}`,
        scope: "opportunity",
        title: String(opportunity.topic || "Opportunity"),
        href: opportunity.slug ? `/dashboard/idea/${opportunity.slug}` : "/dashboard/explore",
        timing_category: category,
        summary: `${String(opportunity.topic || "This opportunity")} is surfacing now because recent conversation and activity suggest a timely market shift.`,
        direct_timing_evidence: [
            { label: "24h momentum", value: `${Number(opportunity.change_24h || 0) >= 0 ? "+" : ""}${Number(opportunity.change_24h || 0).toFixed(1)}%`, kind: "metric" as const },
            { label: "Mentions 24h", value: `${Number(opportunity.post_count_24h || 0)}`, kind: "metric" as const },
            { label: "Sources", value: `${Number(opportunity.source_count || 0)}`, kind: "metric" as const },
            ...(topPost?.title ? [{ label: "Representative discussion", value: topPost.title, kind: "observation" as const }] : []),
        ].slice(0, 4),
        inferred_why_now_note: inferredNote,
        freshness: {
            latest_observed_at: opportunity.last_updated || null,
            freshness_hours: freshnessHours,
            freshness_label: formatFreshnessLabel(freshnessHours),
        },
        confidence: confidenceFromTrust(opportunity.trust, category),
        momentum_direction: momentum,
        monitorable_change_note: monitored
            ? "This opportunity is already being monitored, so score and confidence shifts can show up in your Brief."
            : "Save this opportunity to monitor whether the timing keeps strengthening or starts fading.",
        direct_vs_inferred: {
            direct_evidence_count: Math.max(1, Math.min(4, opportunity.trust.direct_evidence_count || 0)),
            inferred_markers: [
                "Timing category is inferred from recent evidence patterns",
                "Why-now note is a synthesis, not a direct quote",
            ],
        },
    };
}

export function buildWhyNowFromWeaknessCluster(cluster: WeaknessClusterLike): WhyNowSignal {
    const category = classifyWeaknessCategory(cluster);
    const freshnessHours = getFreshnessHours(cluster.freshness.latest_observed_at);
    const momentum = classifyWeaknessMomentum(cluster);
    const representative = cluster.representative_evidence[0];

    let inferredNote = "Repeated competitor complaints suggest a timing opening, but the reason is still weakly supported.";
    if (category === "Competitor stagnation") {
        inferredNote = "The incumbent looks slow to adapt to what users now expect, which can make a focused challenger more viable right now.";
    } else if (category === "Tool complexity increase") {
        inferredNote = "Complexity appears to be compounding, which gives a simpler product a better entry window.";
    } else if (category === "Cost pressure / budget pressure") {
        inferredNote = "Pricing pain is becoming visible enough that a lower-friction offer could land better in the current environment.";
    } else if (category === "AI capability shift") {
        inferredNote = "Users appear to be expecting more automation than the incumbent currently delivers, creating a timing edge for an AI-native entrant.";
    } else if (category === "Integration sprawl") {
        inferredNote = "Integration friction is becoming more painful now, which strengthens the case for a product that fits more cleanly into the stack.";
    }

    return {
        id: `why-now-competitor-${cluster.id}`,
        scope: "competitor",
        title: cluster.competitor,
        href: "/dashboard/competitors",
        timing_category: category,
        summary: `${cluster.competitor} is vulnerable now because weakness evidence is clustering into a repeated timing pattern.`,
        direct_timing_evidence: [
            { label: "Weakness category", value: cluster.weakness_category, kind: "observation" as const },
            { label: "Recent complaint signals", value: `${cluster.evidence_count}`, kind: "metric" as const },
            { label: "Freshness", value: cluster.freshness.freshness_label, kind: "metric" as const },
            ...(representative?.title ? [{ label: "Representative complaint", value: representative.title, kind: "observation" as const }] : []),
        ].slice(0, 4),
        inferred_why_now_note: inferredNote,
        freshness: {
            latest_observed_at: cluster.freshness.latest_observed_at,
            freshness_hours: freshnessHours,
            freshness_label: formatFreshnessLabel(freshnessHours),
        },
        confidence: confidenceFromTrust(cluster.trust, category),
        momentum_direction: momentum,
        monitorable_change_note: cluster.monitor.is_monitored
            ? "This competitor weakness is already being monitored through your alert-backed monitor."
            : "Monitor this competitor to see whether this weakness category keeps compounding.",
        direct_vs_inferred: {
            direct_evidence_count: Math.max(1, Math.min(4, cluster.trust.direct_evidence_count || 0)),
            inferred_markers: [
                "Timing category is inferred from clustered competitor complaints",
                "Why-now note is synthesized from weakness patterns",
            ],
        },
    };
}
