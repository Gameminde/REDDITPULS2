import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { retryValidationAsAdmin } from "@/lib/admin-data";

export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const context = await requireAdmin("/admin/validations");
    const { id } = await params;
    const result = await retryValidationAsAdmin(id, {
        id: context.user.id,
        email: context.user.email || context.profile?.email || "admin",
        role: context.role,
    });
    return NextResponse.json({ ok: true, ...result });
}
