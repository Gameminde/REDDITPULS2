import { createAdmin } from "@/lib/supabase-admin";

export type AdminEventSeverity = "info" | "warning" | "error";

export type AdminEventInput = {
    actorUserId?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    severity?: AdminEventSeverity;
    message?: string | null;
    metadata?: Record<string, unknown> | null;
};

export async function recordAdminEvent(input: AdminEventInput) {
    const admin = createAdmin();
    const { error } = await admin
        .from("admin_events")
        .insert({
            actor_user_id: input.actorUserId || null,
            action: input.action,
            target_type: input.targetType || null,
            target_id: input.targetId || null,
            severity: input.severity || "info",
            message: input.message || null,
            metadata: input.metadata || {},
        });

    if (error) {
        const message = String(error.message || "").toLowerCase();
        if (message.includes("relation") || message.includes("does not exist")) {
            return;
        }
        throw error;
    }
}

