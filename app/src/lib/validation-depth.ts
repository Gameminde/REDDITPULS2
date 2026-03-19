export type ValidationDepth = "quick" | "deep" | "investigation";

export interface ValidationDepthOption {
    mode: ValidationDepth;
    label: string;
    description: string;
    targetDurationMinutes: number;
    premiumRequired: boolean;
    uiCopy: string;
}

export const VALIDATION_DEPTHS: ValidationDepthOption[] = [
    {
        mode: "quick",
        label: "Quick Validation",
        description: "Fast first-pass screening",
        targetDurationMinutes: 5,
        premiumRequired: false,
        uiCopy: "Compare ideas fast — lower depth, quick results",
    },
    {
        mode: "deep",
        label: "Deep Validation",
        description: "Broader market scan with stronger evidence",
        targetDurationMinutes: 35,
        premiumRequired: false,
        uiCopy: "Wider source sweep — 30–45 min queued investigation",
    },
    {
        mode: "investigation",
        label: "Market Investigation",
        description: "Exhaustive premium research for serious decisions",
        targetDurationMinutes: 100,
        premiumRequired: false,
        uiCopy: "Deepest sweep — 90–120 min premium market research",
    },
];

export const VALID_DEPTHS: ValidationDepth[] = VALIDATION_DEPTHS.map((d) => d.mode);

export const DEFAULT_DEPTH: ValidationDepth = "quick";

export function isValidDepth(value: unknown): value is ValidationDepth {
    return typeof value === "string" && VALID_DEPTHS.includes(value as ValidationDepth);
}

/** Queue timeout in seconds for each depth mode */
export const DEPTH_TIMEOUTS: Record<ValidationDepth, number> = {
    quick: 20 * 60,
    deep: 40 * 60,
    investigation: 90 * 60,
};
