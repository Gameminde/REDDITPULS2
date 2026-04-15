import {
    buildValidationHealthMessage,
    isDefinitiveVerificationFailureStatus,
    isUsableVerificationStatus,
    type AiConfigHealth,
} from "@/lib/ai-config-health";
import { verifyKey } from "@/lib/ai-key-verification";
import { resolveRegisteredModel } from "@/lib/ai-model-registry";

export interface DecryptedAiConfig {
    id: string;
    user_id: string;
    provider: string;
    api_key: string;
    selected_model: string;
    is_active: boolean;
    priority: number;
    endpoint_url?: string | null;
    created_at?: string | null;
}

type SupabaseRpcClient = {
    rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> | { data: unknown; error: { code?: string; message?: string } | null };
};

export function requireAiEncryptionKey() {
    const encryptionKey = process.env.AI_ENCRYPTION_KEY?.trim();
    if (!encryptionKey) {
        throw new Error(
            "AI_ENCRYPTION_KEY is missing. Encrypted AI settings are required. " +
            "Set AI_ENCRYPTION_KEY and apply 012_ai_config_encryption_rpcs.sql.",
        );
    }
    return encryptionKey;
}

export function formatEncryptedConfigError(error: { code?: string; message?: string } | null | undefined) {
    if (!error) return "Encrypted AI config request failed";
    if (error.code === "42883") {
        return "Encrypted AI config RPCs are missing. Apply 012_ai_config_encryption_rpcs.sql in Supabase first.";
    }
    return error.message || "Encrypted AI config request failed";
}

export async function getDecryptedAiConfigsForUser(supabase: SupabaseRpcClient, userId: string) {
    const encryptionKey = requireAiEncryptionKey();
    const { data, error } = await supabase.rpc("get_ai_configs_decrypted", {
        p_user_id: userId,
        p_key: encryptionKey,
    });

    if (error) {
        throw new Error(formatEncryptedConfigError(error));
    }

    return (Array.isArray(data) ? data : []) as DecryptedAiConfig[];
}

export async function getActiveAiConfigHealth(supabase: SupabaseRpcClient, userId: string) {
    const configs = await getDecryptedAiConfigsForUser(supabase, userId);
    const activeConfigs = configs.filter((config) => config.is_active && String(config.api_key || "").trim().length > 0);

    const health = await Promise.all(
        activeConfigs.map(async (config) => {
            const verification = await verifyKey(config.provider, config.api_key, config.selected_model);
            const entry: AiConfigHealth = {
                ...verification,
                config_id: config.id,
                provider: config.provider,
                selected_model: resolveRegisteredModel(config.selected_model),
                priority: config.priority,
            };
            return entry;
        }),
    );

    const usableCount = health.filter((entry) => isUsableVerificationStatus(entry.status)).length;
    const blocked = health.length > 0 && health.every((entry) => isDefinitiveVerificationFailureStatus(entry.status));

    return {
        health,
        checked_count: health.length,
        usable_count: usableCount,
        blocked,
        message: blocked ? buildValidationHealthMessage(health) : null,
    };
}
