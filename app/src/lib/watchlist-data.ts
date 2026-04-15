import { buildOpportunityTrust, buildValidationTrust, normalizeSources } from "@/lib/trust";

export function watchlistErrorMessage(error: { message?: string } | null | undefined) {
    return String(error?.message || "").toLowerCase();
}

export function safeParseJson<T = unknown>(value: unknown): T | unknown {
    if (typeof value === "string") {
        try {
            return JSON.parse(value) as T;
        } catch {
            return value;
        }
    }
    return value;
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
    supabaseAdmin: any,
    userId: string,
    validationId: string | null | undefined,
    watchlistId: string | null | undefined,
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

    if (watchlistId) {
        query = query.eq("id", watchlistId);
    }
    if (validationId && opts.includeValidationId) {
        query = query.eq("validation_id", validationId);
    }

    return await query;
}

async function loadWatchlistInternal(
    supabaseAdmin: any,
    userId: string,
    options?: {
        validationId?: string | null;
        watchlistId?: string | null;
    },
) {
    const validationId = options?.validationId;
    const watchlistId = options?.watchlistId;
    let schemaSupportsValidations = true;
    let includeValidationId = true;
    let includeMeta = true;
    let includeIdeasJoin = true;
    let queryResult: Awaited<ReturnType<typeof queryWatchlistRows>> | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
        queryResult = await queryWatchlistRows(supabaseAdmin, userId, validationId, watchlistId, {
            includeValidationId,
            includeMeta,
            includeIdeasJoin,
        });

        if (!queryResult.error) {
            break;
        }

        const message = watchlistErrorMessage(queryResult.error);
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
        ideas: includeIdeasJoin && row.ideas
            ? {
                ...row.ideas,
                sources: normalizeSources(row.ideas.sources),
                trust: buildOpportunityTrust({
                    ...row.ideas,
                    sources: normalizeSources(row.ideas.sources),
                    top_posts: row.ideas.top_posts,
                }),
            }
            : null,
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
                ideas: (() => {
                    const ideaRow = row.idea_id ? ideaMap.get(row.idea_id) as Record<string, unknown> | undefined : undefined;
                    if (!ideaRow) return null;
                    return {
                        ...ideaRow,
                        sources: normalizeSources(ideaRow.sources),
                        trust: buildOpportunityTrust({
                            ...ideaRow,
                            sources: normalizeSources(ideaRow.sources),
                            top_posts: ideaRow.top_posts,
                        }),
                    };
                })(),
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
        idea_validations: (() => {
            const validationRow = row.validation_id ? validationMap.get(row.validation_id) as Record<string, unknown> | undefined : undefined;
            if (!validationRow) return null;
            return {
                ...validationRow,
                trust: buildValidationTrust({
                    confidence: validationRow.confidence as number | null | undefined,
                    created_at: validationRow.created_at as string | null | undefined,
                    completed_at: validationRow.completed_at as string | null | undefined,
                    report: safeParseJson(validationRow.report || {}) as Record<string, unknown>,
                }),
            };
        })(),
    }));

    return { data: hydratedRows, schemaSupportsValidations };
}

export async function loadWatchlist(
    supabaseAdmin: any,
    userId: string,
    validationId?: string | null,
) {
    return loadWatchlistInternal(supabaseAdmin, userId, { validationId });
}

export async function loadWatchlistById(
    supabaseAdmin: any,
    userId: string,
    watchlistId: string,
) {
    return loadWatchlistInternal(supabaseAdmin, userId, { watchlistId });
}
