import type { ValidationDepth } from "@/lib/validation-depth";

export interface ValidationPrefill {
    idea: string;
    target?: string | null;
    pain?: string | null;
    competitors?: string | null;
}

function cleanText(value: unknown) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeValidationPrefill(prefill: ValidationPrefill): ValidationPrefill {
    return {
        idea: cleanText(prefill.idea),
        target: cleanText(prefill.target),
        pain: cleanText(prefill.pain),
        competitors: cleanText(prefill.competitors),
    };
}

export function buildValidationHref(prefill: ValidationPrefill, depth?: ValidationDepth) {
    const normalized = normalizeValidationPrefill(prefill);
    const params = new URLSearchParams();

    if (normalized.idea) params.set("idea", normalized.idea);
    if (normalized.target) params.set("target", normalized.target);
    if (normalized.pain) params.set("pain", normalized.pain);
    if (normalized.competitors) params.set("competitors", normalized.competitors);
    if (depth) params.set("depth", depth);

    return `/dashboard/validate?${params.toString()}`;
}
