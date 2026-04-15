export type AiVerificationStatus =
    | "valid"
    | "invalid"
    | "quota_exceeded"
    | "billing_inactive"
    | "model_not_found"
    | "error";

export interface AiVerificationResult {
    status: AiVerificationStatus;
    message: string;
    detected_provider?: string | null;
    resolved_model?: string;
}

export interface AiConfigHealth extends AiVerificationResult {
    config_id: string;
    provider: string;
    selected_model: string;
    priority: number;
}

const PROVIDER_LABELS: Record<string, string> = {
    anthropic: "Anthropic",
    cerebras: "Cerebras",
    deepseek: "DeepSeek",
    fireworks: "Fireworks AI",
    gemini: "Gemini",
    grok: "Grok",
    groq: "Groq",
    mistral: "Mistral AI",
    nvidia: "NVIDIA NIM",
    ollama: "Ollama",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    together: "Together AI",
};

export function getProviderLabel(provider: string) {
    return PROVIDER_LABELS[String(provider || "").trim().toLowerCase()] || provider;
}

export function isUsableVerificationStatus(status: AiVerificationStatus) {
    return status === "valid";
}

export function isDefinitiveVerificationFailureStatus(status: AiVerificationStatus) {
    return status === "invalid"
        || status === "quota_exceeded"
        || status === "billing_inactive"
        || status === "model_not_found";
}

export function getAiStatusTone(status: AiVerificationStatus): "success" | "warning" | "error" | "muted" {
    if (status === "valid") return "success";
    if (status === "invalid") return "error";
    if (status === "quota_exceeded" || status === "billing_inactive" || status === "model_not_found") {
        return "warning";
    }
    return "muted";
}

export function getAiStatusLabel(status: AiVerificationStatus) {
    switch (status) {
        case "valid":
            return "Ready";
        case "invalid":
            return "Key rejected";
        case "quota_exceeded":
            return "Quota hit";
        case "billing_inactive":
            return "Billing off";
        case "model_not_found":
            return "Model issue";
        default:
            return "Check failed";
    }
}

export function summarizeAiIssue(result: Pick<AiVerificationResult, "status" | "message">) {
    switch (result.status) {
        case "valid":
            return "ready";
        case "invalid":
            return "API key rejected";
        case "quota_exceeded":
            return "quota exhausted";
        case "billing_inactive":
            return "billing inactive";
        case "model_not_found":
            return "selected model unavailable";
        default:
            return result.message?.trim() || "health check failed";
    }
}

export function buildValidationHealthMessage(results: AiConfigHealth[]) {
    const blockers = results.filter((result) => isDefinitiveVerificationFailureStatus(result.status));
    if (blockers.length === 0) return null;

    const details = blockers
        .slice(0, 3)
        .map((result) => `${getProviderLabel(result.provider)}: ${summarizeAiIssue(result)}`)
        .join(" | ");

    const overflow = blockers.length > 3 ? ` | +${blockers.length - 3} more` : "";
    return `No active AI provider is usable right now. ${details}${overflow}. Open Settings, fix one provider, then retry validation.`;
}
