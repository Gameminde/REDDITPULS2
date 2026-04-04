import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { getAdminSettingsData } from "@/lib/admin-data";
import { updateRuntimeSettings } from "@/lib/runtime-settings";

export async function GET() {
    await requireAdmin("/admin/settings");
    return NextResponse.json(await getAdminSettingsData());
}

export async function POST(request: NextRequest) {
    const context = await requireAdmin("/admin/settings");
    const body = await request.json().catch(() => ({}));
    const runtimeSettings = await updateRuntimeSettings({
        scrapers_paused: typeof body?.scrapers_paused === "boolean" ? body.scrapers_paused : undefined,
        validations_paused: typeof body?.validations_paused === "boolean" ? body.validations_paused : undefined,
        default_validation_depth: typeof body?.default_validation_depth === "string" ? body.default_validation_depth : undefined,
        maintenance_note: typeof body?.maintenance_note === "string" ? body.maintenance_note : undefined,
    }, context.user.id);
    return NextResponse.json({ ok: true, runtimeSettings });
}
