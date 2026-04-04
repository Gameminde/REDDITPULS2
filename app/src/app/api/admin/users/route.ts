import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { getAdminUsersData } from "@/lib/admin-data";

export async function GET() {
    await requireAdmin("/admin/users");
    return NextResponse.json(await getAdminUsersData());
}
