import { readFileSync } from "fs";
import path from "path";

export type ModelTier = "free" | "paid" | "free-tier";

export interface RegistryModelEntry {
    id: string;
    display_label: string;
    runtime_model_id: string;
    verification_model_id?: string;
    aliases?: string[];
    tier: ModelTier;
    context_window: number;
}

export interface RegistryProviderEntry {
    name: string;
    endpoint: string;
    default_model: string;
    models: RegistryModelEntry[];
}

type RegistryShape = {
    providers: Record<string, RegistryProviderEntry>;
};

const registryPath = path.resolve(process.cwd(), "..", "config", "ai-model-registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as RegistryShape;

export const AI_MODEL_REGISTRY = registry;
export const PROVIDER_REGISTRY = registry.providers;

export const MODEL_CATALOG: Record<string, { name: string; models: { id: string; label: string }[]; endpoint: string }> =
    Object.fromEntries(
        Object.entries(PROVIDER_REGISTRY).map(([provider, entry]) => [
            provider,
            {
                name: entry.name,
                endpoint: entry.endpoint,
                models: entry.models.map((model) => ({
                    id: model.runtime_model_id,
                    label: model.display_label,
                })),
            },
        ]),
    );

export const STATIC_MODELS: Record<string, Array<{
    id: string;
    label: string;
    contextWindow: number;
    tier: ModelTier;
}>> = Object.fromEntries(
    Object.entries(PROVIDER_REGISTRY).map(([provider, entry]) => [
        provider,
        entry.models.map((model) => ({
            id: model.runtime_model_id,
            label: model.display_label,
            contextWindow: model.context_window,
            tier: model.tier,
        })),
    ]),
);

const modelAliasIndex = new Map<string, string>();
const providerRuntimeIndex = new Map<string, RegistryModelEntry>();

for (const [provider, entry] of Object.entries(PROVIDER_REGISTRY)) {
    for (const model of entry.models) {
        providerRuntimeIndex.set(`${provider}:${model.runtime_model_id}`, model);
        modelAliasIndex.set(model.runtime_model_id, model.runtime_model_id);
        for (const alias of model.aliases || []) {
            modelAliasIndex.set(alias, model.runtime_model_id);
        }
    }
}

export function getProviderRegistryEntry(provider: string) {
    return PROVIDER_REGISTRY[String(provider || "").trim().toLowerCase()] || null;
}

export function getDefaultModel(provider: string) {
    return getProviderRegistryEntry(provider)?.default_model || null;
}

export function resolveRegisteredModel(model: string) {
    return modelAliasIndex.get(String(model || "").trim()) || String(model || "").trim();
}

export function getProviderModelEntry(provider: string, model: string) {
    const normalizedProvider = String(provider || "").trim().toLowerCase();
    const resolvedModel = resolveRegisteredModel(model);
    return providerRuntimeIndex.get(`${normalizedProvider}:${resolvedModel}`) || null;
}

export function getVerificationModel(provider: string, model: string) {
    const entry = getProviderModelEntry(provider, model);
    if (!entry) {
        return resolveRegisteredModel(model);
    }
    return entry.verification_model_id || entry.runtime_model_id;
}
