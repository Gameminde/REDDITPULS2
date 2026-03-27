import { NextRequest, NextResponse } from "next/server";
import { syncAndPersistRedditConnection } from "@/lib/reddit-lab-server";
import { getRequestOrigin, requireRedditLabUser } from "../_helpers";

export async function POST(req: NextRequest) {
    const auth = await requireRedditLabUser();
    if (auth.error) return auth.error;

    try {
        const body = await req.json().catch(() => ({}));
        const connection = await syncAndPersistRedditConnection({
            userId: auth.user.id,
            origin: getRequestOrigin(req),
            connectionId: body?.connection_id || null,
            accountMode: body?.account_mode === "research" ? "research" : body?.account_mode === "personal" ? "personal" : null,
        });
        return NextResponse.json({ connection });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Could not sync Reddit connection." },
            { status: 500 },
        );
    }
}
