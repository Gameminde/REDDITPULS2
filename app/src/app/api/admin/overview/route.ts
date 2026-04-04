import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { getAdminOverviewData } from "@/lib/admin-data";

export async function GET() {
    await requireAdmin("/admin");
    return NextResponse.json(await getAdminOverviewData());
}
