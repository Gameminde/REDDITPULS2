import { NextRequest, NextResponse } from "next/server";
import {
    disconnectRedditConnection,
    getRedditLabState,
    getRedditConnectionSummary,
    upsertEncryptedRedditConnection,
} from "@/lib/reddit-lab-server";
import { requireRedditLabUser } from "../_helpers";

export async function GET() {
    const auth = await requireRedditLabUser();
    if (auth.error) return auth.error;

    try {
        const state = await getRedditLabState(auth.user.id);
        return NextResponse.json(state);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Could not load Reddit lab state." },
            { status: 500 },
        );
    }
}

export async function PATCH(req: NextRequest) {
    const auth = await requireRedditLabUser();
    if (auth.error) return auth.error;

    try {
        const existing = await getRedditConnectionSummary(auth.user.id);
        if (!existing) {
            return NextResponse.json({ error: "No Reddit connection found." }, { status: 404 });
        }

        const body = await req.json();
        const accountMode = body?.account_mode === "research" ? "research" : "personal";

        await upsertEncryptedRedditConnection({
            userId: auth.user.id,
            connectionId: existing.id,
            redditUserId: existing.reddit_user_id || null,
            redditUsername: existing.reddit_username,
            accountMode,
            status: existing.status,
            grantedScopes: existing.granted_scopes,
            tokenExpiresAt: existing.token_expires_at || null,
            profileMetadata: existing.profile_metadata,
            syncedSubreddits: existing.synced_subreddits,
            savedRefs: existing.saved_refs,
            multiredditRefs: existing.multireddit_refs,
            lastSyncedAt: existing.last_synced_at || null,
            lastTokenRefreshAt: existing.last_token_refresh_at || null,
            lastError: existing.last_error || null,
        });

        return NextResponse.json({ connection: await getRedditConnectionSummary(auth.user.id) });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Could not update Reddit connection." },
            { status: 500 },
        );
    }
}

export async function DELETE() {
    const auth = await requireRedditLabUser();
    if (auth.error) return auth.error;

    try {
        await disconnectRedditConnection(auth.user.id);
        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Could not disconnect Reddit." },
            { status: 500 },
        );
    }
}
