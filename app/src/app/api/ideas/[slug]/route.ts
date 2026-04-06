import { NextResponse } from "next/server";

import {
    IDEA_DETAIL_SELECT,
    IDEA_DETAIL_SELECT_LEGACY,
    IDEA_HISTORY_SELECT,
    buildIdeaDetailPayload,
    isMissingMarketEditorialColumnError,
} from "@/lib/idea-api";
import { createAdmin } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ slug: string }> },
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const admin = createAdmin();

    let { data: idea, error: ideaError } = await admin
        .from("ideas")
        .select(IDEA_DETAIL_SELECT)
        .eq("slug", slug)
        .single();

    if (ideaError && isMissingMarketEditorialColumnError(ideaError)) {
        const fallbackResponse = await admin
            .from("ideas")
            .select(IDEA_DETAIL_SELECT_LEGACY)
            .eq("slug", slug)
            .single();
        idea = fallbackResponse.data;
        ideaError = fallbackResponse.error;
    }

    if (ideaError || !idea) {
        return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    const ideaRecord = idea as unknown as Record<string, unknown>;

    const { data: history } = await admin
        .from("idea_history")
        .select(IDEA_HISTORY_SELECT)
        .eq("idea_id", String(ideaRecord.id || ""))
        .order("recorded_at", { ascending: true })
        .limit(180);

    return NextResponse.json(buildIdeaDetailPayload(
        ideaRecord,
        (history || []) as unknown as Array<Record<string, unknown>>,
    ));
}
