import { NextRequest, NextResponse } from "next/server";
import { listSourcePacks, upsertSourcePack } from "@/lib/reddit-lab-server";
import { normalizeSubredditList } from "@/lib/reddit-lab";
import { requireRedditLabUser } from "../_helpers";

export async function GET() {
    const auth = await requireRedditLabUser();
    if (auth.error) return auth.error;

    try {
        return NextResponse.json({ source_packs: await listSourcePacks(auth.user.id) });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Could not load source packs." },
            { status: 500 },
        );
    }
}

export async function POST(req: NextRequest) {
    const auth = await requireRedditLabUser();
    if (auth.error) return auth.error;

    try {
        const body = await req.json();
        const pack = await upsertSourcePack({
            userId: auth.user.id,
            connectionId: body?.connection_id || null,
            name: String(body?.name || "Custom Reddit Pack"),
            sourceType: body?.source_type === "synced" || body?.source_type === "mixed" ? body.source_type : "manual",
            subreddits: normalizeSubredditList(Array.isArray(body?.subreddits) ? body.subreddits.map(String) : []),
            savedRefs: Array.isArray(body?.saved_refs) ? body.saved_refs : [],
            multiredditRefs: Array.isArray(body?.multireddit_refs) ? body.multireddit_refs : [],
            isDefaultForValidation: Boolean(body?.is_default_for_validation),
        });
        return NextResponse.json({ source_pack: pack });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Could not save source pack." },
            { status: 500 },
        );
    }
}
