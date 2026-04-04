import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { runScraperAsAdmin } from "@/lib/admin-data";

export async function POST() {
    const context = await requireAdmin("/admin/jobs");
    const result = await runScraperAsAdmin({
        id: context.user.id,
        email: context.user.email || context.profile?.email || "admin",
        role: context.role,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : result.supported === false ? 501 : 200 });
}
