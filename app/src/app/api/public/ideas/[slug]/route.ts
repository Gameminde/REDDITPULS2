import { NextResponse } from "next/server";

import { IDEA_DETAIL_SELECT, IDEA_HISTORY_SELECT, buildIdeaDetailPayload } from "@/lib/idea-api";
import { createAdmin } from "@/lib/supabase-admin";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ slug: string }> },
) {
    const { slug } = await params;
    const admin = createAdmin();

    const { data: idea, error: ideaError } = await admin
        .from("ideas")
        .select(IDEA_DETAIL_SELECT)
        .eq("slug", slug)
        .single();

    if (ideaError || !idea) {
        return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    const ideaRecord = idea as unknown as Record<string, unknown>;

    const { data: history } = await admin
        .from("idea_history")
        .select(IDEA_HISTORY_SELECT)
        .eq("idea_id", String(ideaRecord.id || ""))
        .order("recorded_at", { ascending: true })
        .limit(90);

    return NextResponse.json(buildIdeaDetailPayload(
        ideaRecord,
        (history || []) as unknown as Array<Record<string, unknown>>,
    ));
}
