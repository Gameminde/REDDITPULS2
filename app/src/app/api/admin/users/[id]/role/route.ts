import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { updateUserRoleAsAdmin } from "@/lib/admin-data";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const context = await requireAdmin("/admin/users");
    const body = await request.json().catch(() => ({}));
    const role = String(body?.role || "user").trim().toLowerCase();
    if (role !== "user" && role !== "moderator" && role !== "admin") {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    const { id } = await params;
    await updateUserRoleAsAdmin(id, role, {
        id: context.user.id,
        email: context.user.email || context.profile?.email || "admin",
        role: context.role,
    });
    return NextResponse.json({ ok: true });
}
