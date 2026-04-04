import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { getAdminAnalyticsData } from "@/lib/admin-data";

export async function GET(request: NextRequest) {
    await requireAdmin("/admin/analytics");
    const days = Math.max(1, Math.min(Number(request.nextUrl.searchParams.get("days") || 30), 90));
    return NextResponse.json(await getAdminAnalyticsData(days));
}
