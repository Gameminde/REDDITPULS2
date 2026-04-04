import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { getAdminAiData } from "@/lib/admin-data";

export async function GET() {
    await requireAdmin("/admin/ai");
    return NextResponse.json(await getAdminAiData());
}
