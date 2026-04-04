import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { getAdminValidationDetail } from "@/lib/admin-data";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    await requireAdmin("/admin/validations");
    const { id } = await params;
    const detail = await getAdminValidationDetail(id);
    if (!detail) {
        return NextResponse.json({ error: "Validation not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
}
