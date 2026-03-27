import { NextRequest, NextResponse } from "next/server";
import { buildRedditUniverseMarketPreview } from "@/lib/reddit-lab-server";
import { requireRedditLabUser } from "../_helpers";

export async function GET(req: NextRequest) {
    const auth = await requireRedditLabUser();
    if (auth.error) return auth.error;

    try {
        const sourcePackId = req.nextUrl.searchParams.get("source_pack_id");
        const preview = await buildRedditUniverseMarketPreview(auth.user.id, sourcePackId);
        return NextResponse.json(preview);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Could not build market preview." },
            { status: 500 },
        );
    }
}
