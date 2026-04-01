import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdmin } from "@/lib/supabase-admin";
import {
    buildOpportunityPromotionDefaults,
    hydrateIdeaForMarket,
    type MarketHydratedIdea,
} from "@/lib/market-feed";
import { buildBoardIntelligence } from "@/lib/opportunity-actionability";

function safeParseJson<T = unknown>(value: unknown): T | unknown {
    if (typeof value === "string") {
        try {
            return JSON.parse(value) as T;
        } catch {
            return value;
        }
    }
    return value;
}

function normalizeSlugArray(value: unknown, primaryIdeaSlug: string) {
    const parsed = safeParseJson<string[]>(value);
    const rows = Array.isArray(parsed) ? parsed : [];
    return [...new Set(rows.map(String).filter(Boolean).filter((slug) => slug !== primaryIdeaSlug))];
}

function isMissingOpportunitiesTable(error: { message?: string } | null | undefined) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("opportunities")
        && (
            message.includes("does not exist")
            || message.includes("schema cache")
            || message.includes("relation")
        );
}

function isMissingMonitorsTable(error: { message?: string } | null | undefined) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("monitors")
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

async function loadIdeasBySlug(slugs: string[]) {
    if (slugs.length === 0) return new Map<string, MarketHydratedIdea>();
    const admin = createAdmin();
    const { data } = await admin
        .from("ideas")
        .select("*")
        .in("slug", slugs);

    return new Map(
        (data || []).map((idea) => {
            const hydrated = hydrateIdeaForMarket(idea as Record<string, unknown>);
            return [hydrated.slug, hydrated] as const;
        }),
    );
}

async function loadWatchedOpportunityIds(userId: string, opportunityIds: string[]) {
    if (opportunityIds.length === 0) return new Set<string>();
    const admin = createAdmin();
    const { data, error } = await admin
        .from("monitors")
        .select("legacy_id")
        .eq("user_id", userId)
        .eq("legacy_type", "opportunity")
        .in("legacy_id", opportunityIds);

    if (error) {
        if (isMissingMonitorsTable(error)) {
            return new Set<string>();
        }
        throw error;
    }

    return new Set((data || []).map((row) => String(row.legacy_id || "")).filter(Boolean));
}

export async function GET() {
    const user = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = createAdmin();
    const { data, error } = await admin
        .from("opportunities")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

    if (error) {
        if (isMissingOpportunitiesTable(error)) {
            return NextResponse.json({ opportunities: [], migration_required: true });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = Array.isArray(data) ? data : [];
    const slugs = new Set<string>();
    for (const row of rows) {
        const primaryIdeaSlug = String(row.primary_idea_slug || "");
        if (primaryIdeaSlug) slugs.add(primaryIdeaSlug);
        for (const slug of normalizeSlugArray(row.source_idea_slugs, primaryIdeaSlug)) {
            slugs.add(slug);
        }
    }

    const ideaMap = await loadIdeasBySlug([...slugs]);
    const watchedOpportunityIds = await loadWatchedOpportunityIds(
        user.id,
        rows.map((row) => String(row.id || "")).filter(Boolean),
    ).catch((error) => {
        console.error("Failed to load watched opportunities:", error);
        return new Set<string>();
    });

    const opportunities = rows.map((row) => {
        const primaryIdeaSlug = String(row.primary_idea_slug || "");
        const sourceIdeaSlugs = normalizeSlugArray(row.source_idea_slugs, primaryIdeaSlug);
        const primaryIdea = ideaMap.get(primaryIdeaSlug) || null;
        const defaults = primaryIdea ? buildOpportunityPromotionDefaults(primaryIdea) : { label: primaryIdeaSlug, icp_summary: null };
        const boardIntelligence = primaryIdea ? buildBoardIntelligence(primaryIdea) : null;

        return {
            ...row,
            source_idea_slugs: sourceIdeaSlugs,
            label: String(row.label || defaults.label || primaryIdeaSlug),
            icp_summary: row.icp_summary ? String(row.icp_summary) : defaults.icp_summary,
            notes: row.notes ? String(row.notes) : "",
            primary_idea: primaryIdea,
            source_ideas: sourceIdeaSlugs.map((slug) => ideaMap.get(slug)).filter(Boolean),
            board_active: String(row.status || "board_ready") === "board_ready" && Boolean(primaryIdea?.board_eligible),
            board_stale_reason: primaryIdea?.board_stale_reason || null,
            board_intelligence: boardIntelligence,
            watching: watchedOpportunityIds.has(String(row.id || "")),
        };
    });

    return NextResponse.json({ opportunities, total: opportunities.length });
}

export async function POST(req: NextRequest) {
    const user = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const primaryIdeaSlug = String(body.primary_idea_slug || "").trim();
    if (!primaryIdeaSlug) {
        return NextResponse.json({ error: "primary_idea_slug is required" }, { status: 400 });
    }

    const admin = createAdmin();
    const { data: rawIdea, error: ideaError } = await admin
        .from("ideas")
        .select("*")
        .eq("slug", primaryIdeaSlug)
        .maybeSingle();

    if (ideaError) {
        return NextResponse.json({ error: ideaError.message }, { status: 500 });
    }
    if (!rawIdea) {
        return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }

    const hydratedIdea = hydrateIdeaForMarket(rawIdea as Record<string, unknown>);
    const defaults = buildOpportunityPromotionDefaults(hydratedIdea);
    const sourceIdeaSlugs = normalizeSlugArray(body.source_idea_slugs, primaryIdeaSlug);

    const payload = {
        user_id: user.id,
        primary_idea_slug: primaryIdeaSlug,
        source_idea_slugs: sourceIdeaSlugs,
        label: String(body.label || defaults.label || hydratedIdea.topic).trim(),
        category: String(body.category || hydratedIdea.category || "general").trim() || "general",
        status: ["draft", "board_ready", "archived"].includes(String(body.status || ""))
            ? String(body.status)
            : "board_ready",
        icp_summary: body.icp_summary ? String(body.icp_summary).trim() : defaults.icp_summary,
        notes: body.notes ? String(body.notes).trim() : "",
    };

    const { data, error } = await admin
        .from("opportunities")
        .upsert(payload, { onConflict: "user_id,primary_idea_slug" })
        .select("*")
        .single();

    if (error) {
        if (isMissingOpportunitiesTable(error)) {
            return NextResponse.json({ error: "Opportunities table is missing. Run migration 022_opportunities_board.sql first." }, { status: 503 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        opportunity: {
            ...data,
            source_idea_slugs: sourceIdeaSlugs,
            primary_idea: hydratedIdea,
            board_active: Boolean(hydratedIdea.board_eligible),
            board_stale_reason: hydratedIdea.board_stale_reason,
            board_intelligence: buildBoardIntelligence(hydratedIdea),
            watching: false,
        },
        already_saved: false,
    });
}
