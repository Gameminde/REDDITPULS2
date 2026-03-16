import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function getUser() {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll: () => cookieStore.getAll() } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function errorMessage(error: { message?: string } | null | undefined) {
    return String(error?.message || "").toLowerCase();
}

function buildWatchlistSelect(opts: {
    includeValidationId: boolean;
    includeMeta: boolean;
    includeIdeasJoin: boolean;
}) {
    const fields = [
        "id",
        "user_id",
        "idea_id",
        "added_at",
    ];

    if (opts.includeValidationId) {
        fields.splice(3, 0, "validation_id");
    }
    if (opts.includeMeta) {
        fields.push("notes", "alert_threshold");
    }
    if (opts.includeIdeasJoin) {
        fields.push("ideas(*)");
    }

    return fields.join(",\n            ");
}

async function queryWatchlistRows(
    userId: string,
    validationId: string | null | undefined,
    opts: {
        includeValidationId: boolean;
        includeMeta: boolean;
        includeIdeasJoin: boolean;
    },
) {
    if (validationId && !opts.includeValidationId) {
        return { data: [], error: null };
    }

    let query = (supabaseAdmin
        .from("watchlists")
        .select(buildWatchlistSelect(opts)) as any)
        .eq("user_id", userId)
        .order("added_at", { ascending: false });

    if (validationId && opts.includeValidationId) {
        query = query.eq("validation_id", validationId);
    }

    return await query;
}

async function loadWatchlist(userId: string, validationId?: string | null) {
    let schemaSupportsValidations = true;
    let includeValidationId = true;
    let includeMeta = true;
    let includeIdeasJoin = true;
    let queryResult: Awaited<ReturnType<typeof queryWatchlistRows>> | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
        queryResult = await queryWatchlistRows(userId, validationId, {
            includeValidationId,
            includeMeta,
            includeIdeasJoin,
        });

        if (!queryResult.error) {
            break;
        }

        const message = errorMessage(queryResult.error);
        if (includeValidationId && message.includes("validation_id")) {
            includeValidationId = false;
            schemaSupportsValidations = false;
            continue;
        }
        if (includeMeta && (message.includes("notes") || message.includes("alert_threshold"))) {
            includeMeta = false;
            continue;
        }
        if (includeIdeasJoin && (message.includes("ideas") || message.includes("relationship") || message.includes("embed"))) {
            includeIdeasJoin = false;
            continue;
        }
        return { data: [], schemaSupportsValidations, error: queryResult.error };
    }

    if (!queryResult || queryResult.error) {
        return { data: [], schemaSupportsValidations, error: queryResult?.error || new Error("Failed to load watchlist") };
    }

    if (validationId && !includeValidationId) {
        return { data: [], schemaSupportsValidations };
    }

    let rows = (queryResult.data || []).map((row: any) => ({
        ...row,
        validation_id: includeValidationId ? row.validation_id ?? null : null,
        notes: includeMeta ? row.notes ?? "" : "",
        alert_threshold: includeMeta ? row.alert_threshold ?? null : null,
        ideas: includeIdeasJoin ? row.ideas ?? null : null,
        idea_validations: null,
    }));

    if (!includeIdeasJoin) {
        const ideaIds = rows
            .map((row: any) => row.idea_id)
            .filter((id: any): id is string => typeof id === "string" && id.length > 0);

        if (ideaIds.length > 0) {
            const { data: ideas, error: ideasError } = await supabaseAdmin
                .from("ideas")
                .select("*")
                .in("id", ideaIds);

            if (ideasError) {
                return { data: rows, schemaSupportsValidations, error: ideasError };
            }

            const ideaMap = new Map((ideas || []).map((row: any) => [row.id, row]));
            rows = rows.map((row: any) => ({
                ...row,
                ideas: row.idea_id ? ideaMap.get(row.idea_id) || null : null,
            }));
        }
    }

    if (!schemaSupportsValidations || !includeValidationId) {
        return { data: rows, schemaSupportsValidations };
    }

    const validationIds = rows
        .map((row: any) => row.validation_id)
        .filter((id: any): id is string => typeof id === "string" && id.length > 0);

    if (validationIds.length === 0) {
        return { data: rows, schemaSupportsValidations };
    }

    const { data: validations, error: validationError } = await supabaseAdmin
        .from("idea_validations")
        .select(`
            id,
            idea_text,
            verdict,
            confidence,
            status,
            created_at,
            completed_at,
            report
        `)
        .in("id", validationIds);

    if (validationError) {
        return { data: rows, schemaSupportsValidations, error: validationError };
    }

    const validationMap = new Map((validations || []).map((row: any) => [row.id, row]));
    const hydratedRows = rows.map((row: any) => ({
        ...row,
        idea_validations: row.validation_id ? validationMap.get(row.validation_id) || null : null,
    }));

    return { data: hydratedRows, schemaSupportsValidations };
}

export async function GET(req: NextRequest) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const validationId = req.nextUrl.searchParams.get("validation_id");
    const result = await loadWatchlist(user.id, validationId);

    if (result.error) {
        return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({
        watchlist: result.data,
        saved: validationId ? result.data.length > 0 : undefined,
        schemaSupportsValidations: result.schemaSupportsValidations,
    });
}

export async function POST(request: Request) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const ideaId = body.idea_id || null;
    const validationId = body.validation_id || null;

    if (!ideaId && !validationId) {
        return NextResponse.json({ error: "idea_id or validation_id required" }, { status: 400 });
    }

    if (validationId) {
        const existing = await supabaseAdmin
            .from("watchlists")
            .select("id")
            .eq("user_id", user.id)
            .eq("validation_id", validationId)
            .maybeSingle();

        if (existing.error && !String(existing.error.message || "").toLowerCase().includes("validation_id")) {
            return NextResponse.json({ error: existing.error.message }, { status: 500 });
        }
        if (existing.data) {
            return NextResponse.json({ watchlist: existing.data, already_saved: true });
        }
    }

    if (ideaId) {
        const existing = await supabaseAdmin
            .from("watchlists")
            .select("id")
            .eq("user_id", user.id)
            .eq("idea_id", ideaId)
            .maybeSingle();

        if (existing.error) {
            return NextResponse.json({ error: existing.error.message }, { status: 500 });
        }
        if (existing.data) {
            return NextResponse.json({ watchlist: existing.data, already_saved: true });
        }
    }

    const { data, error } = await supabaseAdmin
        .from("watchlists")
        .insert({
            user_id: user.id,
            idea_id: ideaId,
            validation_id: validationId,
            alert_threshold: body.alert_threshold || null,
            notes: body.notes || "",
        })
        .select()
        .single();

    if (error) {
        const status = String(error.message || "").toLowerCase().includes("validation_id") ? 409 : 500;
        return NextResponse.json({
            error: error.message,
            schema_hint: status === 409
                ? "watchlists.validation_id is missing in Supabase. Run the latest watchlist migration."
                : undefined,
        }, { status });
    }

    return NextResponse.json({ watchlist: data });
}

export async function DELETE(request: Request) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const ideaId = body.idea_id || null;
    const validationId = body.validation_id || null;

    if (!ideaId && !validationId) {
        return NextResponse.json({ error: "idea_id or validation_id required" }, { status: 400 });
    }

    let query = supabaseAdmin
        .from("watchlists")
        .delete()
        .eq("user_id", user.id);

    query = validationId ? query.eq("validation_id", validationId) : query.eq("idea_id", ideaId);

    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
