function cleanText(value: unknown) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function safeParseJson<T = unknown>(value: unknown): T | unknown {
    if (typeof value === "string") {
        try {
            return JSON.parse(value) as T;
        } catch {
            return value;
        }
    }
    return value;
}

export type MarketEditorialVisibility = "public" | "internal" | "duplicate" | "needs_more_proof";
export type MarketEditorialPublishMode = "shadow" | "publish";

export interface MarketEditorialPayload {
    status?: string | null;
    version?: string | null;
    provider?: string | null;
    model?: string | null;
    input_hash?: string | null;
    edited_title?: string | null;
    edited_summary?: string | null;
    pain_statement?: string | null;
    ideal_buyer?: string | null;
    product_angle?: string | null;
    verdict?: string | null;
    next_step?: string | null;
    visibility_decision?: MarketEditorialVisibility | null;
    duplicate_of_slug?: string | null;
    critic_reasons?: string[] | null;
    quality_score?: number | null;
    grounding_confidence?: number | null;
    updated_at?: string | null;
}

export interface ApprovedMarketEditorial {
    edited_title: string;
    edited_summary: string;
    verdict: string;
    next_step: string;
    visibility_decision: "public";
    quality_score: number;
    product_angle: string;
    ideal_buyer: string;
    pain_statement: string;
}

export function getMarketEditorialPublishMode(): MarketEditorialPublishMode {
    const raw = cleanText(process.env.MARKET_AGENT_PUBLISH_MODE).toLowerCase();
    return raw === "publish" ? "publish" : "shadow";
}

export function parseMarketEditorial(value: unknown): MarketEditorialPayload | null {
    const parsed = safeParseJson<MarketEditorialPayload>(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
    }
    return parsed as MarketEditorialPayload;
}

export function getApprovedMarketEditorial(value: unknown): ApprovedMarketEditorial | null {
    const editorial = parseMarketEditorial(value);
    if (!editorial) return null;
    if (cleanText(editorial.status).toLowerCase() !== "success") return null;
    if (cleanText(editorial.visibility_decision).toLowerCase() !== "public") return null;

    const editedTitle = cleanText(editorial.edited_title);
    const editedSummary = cleanText(editorial.edited_summary);
    if (!editedTitle || !editedSummary) return null;

    return {
        edited_title: editedTitle,
        edited_summary: editedSummary,
        verdict: cleanText(editorial.verdict),
        next_step: cleanText(editorial.next_step),
        visibility_decision: "public",
        quality_score: Number(editorial.quality_score || 0),
        product_angle: cleanText(editorial.product_angle),
        ideal_buyer: cleanText(editorial.ideal_buyer),
        pain_statement: cleanText(editorial.pain_statement),
    };
}

export function getMarketEditorialVisibility(value: unknown): MarketEditorialVisibility | "" {
    const editorial = parseMarketEditorial(value);
    const visibility = cleanText(editorial?.visibility_decision).toLowerCase();
    if (
        visibility === "public"
        || visibility === "internal"
        || visibility === "duplicate"
        || visibility === "needs_more_proof"
    ) {
        return visibility;
    }
    return "";
}

export function getVisibleMarketEditorial(value: unknown): ApprovedMarketEditorial | null {
    if (getMarketEditorialPublishMode() !== "publish") {
        return null;
    }
    return getApprovedMarketEditorial(value);
}

export function getPublicMarketEditorialVisibility(value: unknown): MarketEditorialVisibility | "" {
    if (getMarketEditorialPublishMode() !== "publish") {
        return "";
    }
    return getMarketEditorialVisibility(value);
}
