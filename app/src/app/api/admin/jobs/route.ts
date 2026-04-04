import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { getAdminJobsData } from "@/lib/admin-data";

export async function GET() {
    await requireAdmin("/admin/jobs");
    return NextResponse.json(await getAdminJobsData());
}
