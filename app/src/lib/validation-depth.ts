export type ValidationDepth = "quick" | "deep" | "investigation";

export interface ValidationDepthOption {
    mode: ValidationDepth;
    label: string;
    description: string;
    paceLabel: string;
    premiumRequired: boolean;
    uiCopy: string;
}

export const VALIDATION_DEPTHS: ValidationDepthOption[] = [
    {
        mode: "quick",
        label: "Quick Validation",
        description: "Fast first-pass screening",
        paceLabel: "Short pass",
        premiumRequired: false,
        uiCopy: "Screen the idea fast with a lighter evidence pass.",
    },
    {
        mode: "deep",
        label: "Deep Validation",
        description: "Broader market scan with stronger evidence",
        paceLabel: "Longer sweep",
        premiumRequired: true,
        uiCopy: "Run a wider source sweep with stronger proof and sharper competition context.",
    },
    {
        mode: "investigation",
        label: "Market Investigation",
        description: "Exhaustive premium research for serious decisions",
        paceLabel: "Full investigation",
        premiumRequired: true,
        uiCopy: "Use the deepest sweep for high-stakes market research and strategy decisions.",
    },
];

export const VALID_DEPTHS: ValidationDepth[] = VALIDATION_DEPTHS.map((d) => d.mode);

export const DEFAULT_DEPTH: ValidationDepth = "quick";

export function isValidDepth(value: unknown): value is ValidationDepth {
    return typeof value === "string" && VALID_DEPTHS.includes(value as ValidationDepth);
}

export function getValidationDepthOption(depth: ValidationDepth): ValidationDepthOption {
    return VALIDATION_DEPTHS.find((option) => option.mode === depth) || VALIDATION_DEPTHS[0];
}

/** Queue timeout in seconds for each depth mode */
export const DEPTH_TIMEOUTS: Record<ValidationDepth, number> = {
    quick: 20 * 60,
    deep: 40 * 60,
    investigation: 90 * 60,
};
