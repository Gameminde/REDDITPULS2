import { createAdmin } from "@/lib/supabase-admin";

export type RuntimeSettings = {
    scrapers_paused: boolean;
    validations_paused: boolean;
    default_validation_depth: "quick" | "deep" | "investigation";
    maintenance_note: string | null;
    updated_at: string | null;
    updated_by: string | null;
};

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
    scrapers_paused: false,
    validations_paused: false,
    default_validation_depth: "quick",
    maintenance_note: null,
    updated_at: null,
    updated_by: null,
};

function normalizeDepth(value: unknown): RuntimeSettings["default_validation_depth"] {
    const depth = String(value || "").toLowerCase();
    if (depth === "deep" || depth === "investigation") return depth;
    return "quick";
}

function normalizeRuntimeSettings(row: Record<string, unknown> | null | undefined): RuntimeSettings {
    return {
        scrapers_paused: Boolean(row?.scrapers_paused),
        validations_paused: Boolean(row?.validations_paused),
        default_validation_depth: normalizeDepth(row?.default_validation_depth),
        maintenance_note: row?.maintenance_note ? String(row.maintenance_note) : null,
        updated_at: row?.updated_at ? String(row.updated_at) : null,
        updated_by: row?.updated_by ? String(row.updated_by) : null,
    };
}

export async function getRuntimeSettings() {
    const admin = createAdmin();
    const { data, error } = await admin
        .from("runtime_settings")
        .select("*")
        .eq("singleton_key", "default")
        .maybeSingle();

    if (error) {
        const message = String(error.message || "").toLowerCase();
        if (message.includes("relation") || message.includes("does not exist")) {
            return DEFAULT_RUNTIME_SETTINGS;
        }
        throw error;
    }

    return normalizeRuntimeSettings((data || null) as Record<string, unknown> | null);
}

export async function updateRuntimeSettings(
    patch: Partial<Pick<RuntimeSettings, "scrapers_paused" | "validations_paused" | "default_validation_depth" | "maintenance_note">>,
    actorUserId?: string | null,
) {
    const admin = createAdmin();
    const payload = {
        singleton_key: "default",
        scrapers_paused: patch.scrapers_paused,
        validations_paused: patch.validations_paused,
        default_validation_depth: patch.default_validation_depth,
        maintenance_note: patch.maintenance_note,
        updated_by: actorUserId || null,
    };

    const { error } = await admin
        .from("runtime_settings")
        .upsert(payload, { onConflict: "singleton_key" });

    if (error) {
        throw error;
    }

    return getRuntimeSettings();
}

