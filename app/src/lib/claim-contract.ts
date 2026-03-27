export type ClaimTrustTier = "T1" | "T2" | "T3" | "T4" | "T5";
export type ClaimSupportLevel = "evidence_backed" | "supporting_context" | "hypothesis";

export interface ClaimContractEntry {
    claim_id: string;
    label: string;
    value: string;
    trust_tier: ClaimTrustTier;
    support_level: ClaimSupportLevel;
    summary: string;
    source_basis: string[];
    allowed_for_problem_validity: boolean;
    allowed_for_business_validity: boolean;
    buyer_native: boolean;
}

export interface ClaimContract {
    version: string;
    entries: ClaimContractEntry[];
}

function asString(value: unknown, fallback = "") {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return fallback;
}

function normalizeSupportLevel(value: unknown): ClaimSupportLevel {
    const normalized = asString(value).trim().toLowerCase();
    if (normalized === "evidence_backed") return "evidence_backed";
    if (normalized === "supporting_context") return "supporting_context";
    return "hypothesis";
}

function normalizeTrustTier(value: unknown): ClaimTrustTier {
    const normalized = asString(value).trim().toUpperCase();
    if (normalized === "T1" || normalized === "T2" || normalized === "T3" || normalized === "T4" || normalized === "T5") {
        return normalized;
    }
    return "T3";
}

function normalizeClaimEntry(value: unknown): ClaimContractEntry | null {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const claimId = asString(row.claim_id).trim();
    const label = asString(row.label).trim();
    if (!claimId || !label) return null;

    const sourceBasis = Array.isArray(row.source_basis)
        ? row.source_basis.map((item) => asString(item).trim()).filter(Boolean)
        : [];

    return {
        claim_id: claimId,
        label,
        value: asString(row.value).trim(),
        trust_tier: normalizeTrustTier(row.trust_tier),
        support_level: normalizeSupportLevel(row.support_level),
        summary: asString(row.summary).trim(),
        source_basis: sourceBasis,
        allowed_for_problem_validity: Boolean(row.allowed_for_problem_validity),
        allowed_for_business_validity: Boolean(row.allowed_for_business_validity),
        buyer_native: Boolean(row.buyer_native),
    };
}

export function normalizeClaimContract(report: Record<string, unknown>): ClaimContract {
    const raw = report.claim_contract;
    if (!raw || typeof raw !== "object") {
        return { version: "v0", entries: [] };
    }

    const record = raw as Record<string, unknown>;
    const entries = Array.isArray(record.entries)
        ? record.entries.map(normalizeClaimEntry).filter(Boolean) as ClaimContractEntry[]
        : [];

    return {
        version: asString(record.version, "v1"),
        entries,
    };
}

export function getClaimSupportMeta(level: ClaimSupportLevel) {
    if (level === "evidence_backed") {
        return {
            label: "Evidence-backed",
            className: "border-build/20 bg-build/10 text-build",
        };
    }
    if (level === "supporting_context") {
        return {
            label: "Supporting",
            className: "border-risky/20 bg-risky/10 text-risky",
        };
    }
    return {
        label: "Hypothesis",
        className: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
    };
}

export function getClaimTierMeta(tier: ClaimTrustTier) {
    if (tier === "T5") return { label: "T5 · decision" };
    if (tier === "T4") return { label: "T4 · aggregate" };
    if (tier === "T3") return { label: "T3 · inferred" };
    if (tier === "T2") return { label: "T2 · deterministic" };
    return { label: "T1 · raw" };
}
