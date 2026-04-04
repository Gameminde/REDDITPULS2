import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { getAdminValidationsData } from "@/lib/admin-data";

export async function GET(request: NextRequest) {
    await requireAdmin("/admin/validations");
    const status = request.nextUrl.searchParams.get("status") || undefined;
    const depth = request.nextUrl.searchParams.get("depth") || undefined;
    const user = request.nextUrl.searchParams.get("user") || undefined;
    const days = request.nextUrl.searchParams.get("days");

    return NextResponse.json(await getAdminValidationsData({
        status,
        depth,
        user,
        days: days ? Number(days) : undefined,
    }));
}
