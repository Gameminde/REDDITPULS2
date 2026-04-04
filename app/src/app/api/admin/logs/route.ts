import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { getAdminLogsData } from "@/lib/admin-data";

export async function GET() {
    await requireAdmin("/admin/logs");
    return NextResponse.json(await getAdminLogsData());
}
