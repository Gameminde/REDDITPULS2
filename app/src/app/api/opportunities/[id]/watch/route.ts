import { NextRequest, NextResponse } from "next/server";
import { trackServerEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase-server";
import { createAdmin } from "@/lib/supabase-admin";
import { hydrateIdeaForMarket } from "@/lib/market-feed";
import { buildOpportunityWatchMonitor, toNativeMonitorRow } from "@/lib/monitors";

function isMissingTable(error: { message?: string } | null | undefined, table: string) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes(table)
        && (
            message.includes("does not exist")
            || message.includes("schema cache")
            || message.includes("relation")
        );
}

async function getAuthedUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

async function loadOpportunityWithIdea(userId: string, opportunityId: string) {
    const admin = createAdmin();
    const { data: opportunity, error: opportunityError } = await admin
        .from("opportunities")
        .select("*")
        .eq("user_id", userId)
        .eq("id", opportunityId)
        .maybeSingle();

    if (opportunityError) {
        return { opportunity: null, primaryIdea: null, error: opportunityError };
    }
    if (!opportunity) {
        return { opportunity: null, primaryIdea: null, error: null };
    }

    const { data: idea, error: ideaError } = await admin
        .from("ideas")
        .select("*")
        .eq("slug", String(opportunity.primary_idea_slug || ""))
        .maybeSingle();

    if (ideaError) {
        return { opportunity, primaryIdea: null, error: ideaError };
    }

    return {
        opportunity,
        primaryIdea: idea ? hydrateIdeaForMarket(idea as Record<string, unknown>) : null,
        error: null,
    };
}

export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const request = _req;
    const user = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    const opportunityId = String(id || "").trim();
    if (!opportunityId) {
        return NextResponse.json({ error: "Opportunity id is required" }, { status: 400 });
    }

    const { opportunity, primaryIdea, error } = await loadOpportunityWithIdea(user.id, opportunityId);
    if (error) {
        if (isMissingTable(error, "opportunities")) {
            return NextResponse.json({ error: "Opportunities table is missing. Run migration 022_opportunities_board.sql first." }, { status: 503 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!opportunity || !primaryIdea) {
        return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }

    const monitor = buildOpportunityWatchMonitor({
        opportunity: {
            ...opportunity,
            source_idea_slugs: Array.isArray(opportunity.source_idea_slugs) ? opportunity.source_idea_slugs : [],
        },
        primaryIdea,
    });

    const admin = createAdmin();
    const { data, error: upsertError } = await admin
        .from("monitors")
        .upsert(toNativeMonitorRow(user.id, monitor), { onConflict: "user_id,legacy_type,legacy_id" })
        .select("id, legacy_id, monitor_type, status")
        .single();

    if (upsertError) {
        if (isMissingTable(upsertError, "monitors")) {
            return NextResponse.json({ error: "Native monitors table is missing. Run the monitor migrations first." }, { status: 503 });
        }
        return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    await trackServerEvent(request, {
        eventName: "opportunity_watch_added",
        scope: "product",
        userId: user.id,
        route: `/api/opportunities/${opportunityId}/watch`,
        properties: {
            opportunity_id: opportunityId,
            source_slug: String(opportunity.primary_idea_slug || ""),
        },
    });

    return NextResponse.json({
        watching: true,
        monitor: data,
    });
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const user = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    const opportunityId = String(id || "").trim();
    if (!opportunityId) {
        return NextResponse.json({ error: "Opportunity id is required" }, { status: 400 });
    }

    const admin = createAdmin();
    const { error } = await admin
        .from("monitors")
        .delete()
        .eq("user_id", user.id)
        .eq("legacy_type", "opportunity")
        .eq("legacy_id", opportunityId);

    if (error) {
        if (isMissingTable(error, "monitors")) {
            return NextResponse.json({ error: "Native monitors table is missing. Run the monitor migrations first." }, { status: 503 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ watching: false });
}
