import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { setValidationPauseState } from "@/lib/admin-data";

export async function POST(request: NextRequest) {
    const context = await requireAdmin("/admin/jobs");
    const body = await request.json().catch(() => ({}));
    const paused = Boolean(body?.paused);
    const runtimeSettings = await setValidationPauseState(paused, {
        id: context.user.id,
        email: context.user.email || context.profile?.email || "admin",
        role: context.role,
    });
    return NextResponse.json({ ok: true, runtimeSettings });
}
