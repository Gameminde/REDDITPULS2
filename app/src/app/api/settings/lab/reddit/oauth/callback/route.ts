import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
    exchangeRedditCode,
    syncRedditSnapshot,
    upsertEncryptedRedditConnection,
    upsertSourcePack,
} from "@/lib/reddit-lab-server";
import { getRequestOrigin, requireRedditLabUser } from "../../_helpers";

export async function GET(req: NextRequest) {
    const auth = await requireRedditLabUser();
    if (auth.error) return auth.error;

    const origin = getRequestOrigin(req);
    const cookieStore = await cookies();
    const stateCookie = cookieStore.get("reddit_oauth_state")?.value || "";
    const accountMode = "personal";
    const code = req.nextUrl.searchParams.get("code") || "";
    const state = req.nextUrl.searchParams.get("state") || "";
    const oauthError = req.nextUrl.searchParams.get("error") || "";

    cookieStore.delete("reddit_oauth_state");

    if (oauthError) {
        return NextResponse.redirect(`${origin}/dashboard/settings/reddit-lab?error=${encodeURIComponent(oauthError)}`);
    }

    if (!code || !state || state !== stateCookie) {
        return NextResponse.redirect(`${origin}/dashboard/settings/reddit-lab?error=${encodeURIComponent("Invalid Reddit OAuth state.")}`);
    }

    try {
        const token = await exchangeRedditCode(origin, code);
        const snapshot = await syncRedditSnapshot(token.access_token, token.scope);
        const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000).toISOString();

        const connectionId = await upsertEncryptedRedditConnection({
            userId: auth.user.id,
            redditUserId: snapshot.reddit_user_id || null,
            redditUsername: snapshot.reddit_username,
            accountMode,
            status: "connected",
            accessToken: token.access_token,
            refreshToken: token.refresh_token || null,
            grantedScopes: snapshot.granted_scopes,
            tokenExpiresAt: expiresAt,
            profileMetadata: snapshot.profile_metadata,
            syncedSubreddits: snapshot.synced_subreddits,
            savedRefs: snapshot.saved_refs,
            multiredditRefs: snapshot.multireddit_refs,
            lastSyncedAt: new Date().toISOString(),
            lastTokenRefreshAt: new Date().toISOString(),
            lastError: null,
        });

        await upsertSourcePack({
            userId: auth.user.id,
            connectionId,
            name: "Synced Reddit Universe",
            sourceType: "synced",
            subreddits: snapshot.synced_subreddits,
            savedRefs: snapshot.saved_refs,
            multiredditRefs: snapshot.multireddit_refs,
            isDefaultForValidation: true,
        });

        return NextResponse.redirect(`${origin}/dashboard/settings/reddit-lab?connected=1`);
    } catch (error) {
        return NextResponse.redirect(
            `${origin}/dashboard/settings/reddit-lab?error=${encodeURIComponent(
                error instanceof Error ? error.message : "Reddit connect failed.",
            )}`,
        );
    }
}
