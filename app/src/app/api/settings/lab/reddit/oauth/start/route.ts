import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildRedditAuthorizeUrl, generateOauthState, hasRedditOauthConfig } from "@/lib/reddit-lab-server";
import { getRequestOrigin, requireRedditLabUser } from "../../_helpers";

export async function GET(req: NextRequest) {
    const auth = await requireRedditLabUser();
    if (auth.error) return auth.error;

    if (!hasRedditOauthConfig()) {
        return NextResponse.json({ error: "Reddit OAuth is not configured." }, { status: 400 });
    }

    const state = generateOauthState();
    const origin = getRequestOrigin(req);
    const cookieStore = await cookies();
    cookieStore.set("reddit_oauth_state", state, {
        httpOnly: true,
        sameSite: "lax",
        secure: req.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 10 * 60,
    });

    return NextResponse.redirect(buildRedditAuthorizeUrl(origin, state));
}
