import { createAdmin } from "@/lib/supabase-admin";

export type DurableRateLimitScope = "discover" | "settings_ai" | "validate";

export interface DurableRateLimitResult {
    allowed: boolean;
    currentCount: number;
    remainingCount: number;
    windowStartedAt: string | null;
    windowEndsAt: string | null;
}

type RateLimitRpcRow = {
    allowed?: boolean | null;
    current_count?: number | null;
    remaining_count?: number | null;
    window_started_at?: string | null;
    window_ends_at?: string | null;
};

function normalizeRateLimitRow(row: RateLimitRpcRow | null | undefined): DurableRateLimitResult {
    return {
        allowed: Boolean(row?.allowed),
        currentCount: Number(row?.current_count || 0),
        remainingCount: Number(row?.remaining_count || 0),
        windowStartedAt: typeof row?.window_started_at === "string" ? row.window_started_at : null,
        windowEndsAt: typeof row?.window_ends_at === "string" ? row.window_ends_at : null,
    };
}

export async function consumeDurableRateLimit(input: {
    userId: string;
    scope: DurableRateLimitScope;
    limit: number;
    windowSeconds?: number;
}) {
    const admin = createAdmin();
    const { data, error } = await admin.rpc("consume_rate_limit_window", {
        p_user_id: input.userId,
        p_scope: input.scope,
        p_limit: input.limit,
        p_window_seconds: input.windowSeconds || 3600,
    });

    if (error) {
        throw error;
    }

    const row = Array.isArray(data) ? data[0] : data;
    return normalizeRateLimitRow(row as RateLimitRpcRow | null | undefined);
}
