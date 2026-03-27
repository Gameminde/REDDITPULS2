import { NextRequest, NextResponse } from "next/server";
import { deleteSourcePack, upsertSourcePack } from "@/lib/reddit-lab-server";
import { normalizeSubredditList } from "@/lib/reddit-lab";
import { requireRedditLabUser } from "../../_helpers";

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = await requireRedditLabUser();
    if (auth.error) return auth.error;

    try {
        const { id } = await params;
        const body = await req.json();
        const pack = await upsertSourcePack({
            userId: auth.user.id,
            packId: id,
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
            { error: error instanceof Error ? error.message : "Could not update source pack." },
            { status: 500 },
        );
    }
}

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = await requireRedditLabUser();
    if (auth.error) return auth.error;

    try {
        const { id } = await params;
        await deleteSourcePack(auth.user.id, id);
        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Could not delete source pack." },
            { status: 500 },
        );
    }
}
