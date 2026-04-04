import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { getAdminMarketData } from "@/lib/admin-data";

export async function GET() {
    await requireAdmin("/admin/market");
    return NextResponse.json(await getAdminMarketData());
}
