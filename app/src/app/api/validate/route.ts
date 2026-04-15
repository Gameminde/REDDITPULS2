import { NextRequest, NextResponse } from "next/server";

import { trackServerEvent } from "@/lib/analytics";
import { getActiveAiConfigHealth } from "@/lib/ai-config-server";
import { checkPremium } from "@/lib/check-premium";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { enqueueValidationJob } from "@/lib/queue";
import { hasRedditLabOptions, type RedditLabValidationOptions } from "@/lib/reddit-lab";
import { getRedditConnectionSummary, loadSourcePackForUser, resolveRedditLabContextForValidation } from "@/lib/reddit-lab-server";
import { createClient } from "@/lib/supabase-server";
import { getRuntimeSettings } from "@/lib/runtime-settings";
import { DEFAULT_DEPTH, getValidationDepthOption, isValidDepth, type ValidationDepth } from "@/lib/validation-depth";
import { consumeDurableRateLimit } from "@/lib/durable-rate-limit";

const MAX_VALIDATIONS_PER_HOUR = 5;

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { count: activeAiConfigCount, error: aiConfigError } = await supabase
            .from("user_ai_config")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .eq("is_active", true);

        if (aiConfigError) {
            console.error("AI config check error:", aiConfigError);
            await trackServerEvent(req, {
                eventName: "validation_failed",
                scope: "product",
                route: "/dashboard/validate",
                userId: user.id,
                properties: { reason: "ai_config_check_failed" },
            });
            return NextResponse.json({ error: "Could not verify your AI setup right now." }, { status: 500 });
        }

        if (!activeAiConfigCount) {
            await trackServerEvent(req, {
                eventName: "validation_failed",
                scope: "product",
                route: "/dashboard/validate",
                userId: user.id,
                properties: { reason: "missing_ai_config" },
            });
            return NextResponse.json({
                error: "Add at least one active AI API key in Settings before starting a validation.",
            }, { status: 400 });
        }

        try {
            const aiHealth = await getActiveAiConfigHealth(supabase, user.id);
            if (aiHealth.blocked) {
                await trackServerEvent(req, {
                    eventName: "validation_failed",
                    scope: "product",
                    route: "/dashboard/validate",
                    userId: user.id,
                    properties: {
                        reason: "ai_providers_unusable",
                        statuses: aiHealth.health.map((entry) => `${entry.provider}:${entry.status}`).slice(0, 6),
                    },
                });
                return NextResponse.json({
                    error: aiHealth.message || "No active AI provider is usable right now.",
                    issues: aiHealth.health.map((entry) => ({
                        provider: entry.provider,
                        status: entry.status,
                        model: entry.selected_model,
                        message: entry.message,
                    })),
                }, { status: 400 });
            }
        } catch (healthError) {
            console.error("AI provider preflight error:", healthError);
            await trackServerEvent(req, {
                eventName: "validation_failed",
                scope: "product",
                route: "/dashboard/validate",
                userId: user.id,
                properties: { reason: "ai_provider_preflight_failed" },
            });
            return NextResponse.json({
                error: healthError instanceof Error ? healthError.message : "Could not verify your AI setup right now.",
            }, { status: 500 });
        }

        const rateLimit = await consumeDurableRateLimit({
            userId: user.id,
            scope: "validate",
            limit: MAX_VALIDATIONS_PER_HOUR,
        });

        if (!rateLimit.allowed) {
            await trackServerEvent(req, {
                eventName: "validation_failed",
                scope: "product",
                route: "/dashboard/validate",
                userId: user.id,
                properties: { reason: "rate_limited" },
            });
            return NextResponse.json({ error: "Rate limit exceeded - max 5 validations per hour" }, { status: 429 });
        }

        const body = await req.json();
        const depth: ValidationDepth = isValidDepth(body?.depth) ? body.depth : DEFAULT_DEPTH;
        const depthOption = getValidationDepthOption(depth);

        const { isPremium } = await checkPremium(supabase, user.id);
        if (depthOption.premiumRequired && !isPremium) {
            await trackServerEvent(req, {
                eventName: "validation_failed",
                scope: "product",
                route: "/dashboard/validate",
                userId: user.id,
                properties: { reason: "not_premium", depth },
            });
            return NextResponse.json({
                error: `${depthOption.label} requires a premium plan. Use Quick Validation or upgrade.`,
            }, { status: 403 });
        }

        const runtimeSettings = await getRuntimeSettings();
        if (runtimeSettings.validations_paused) {
            await trackServerEvent(req, {
                eventName: "validation_failed",
                scope: "product",
                route: "/dashboard/validate",
                userId: user.id,
                properties: { reason: "validations_paused" },
            });
            return NextResponse.json({
                error: runtimeSettings.maintenance_note || "Validations are temporarily paused by the operator.",
            }, { status: 503 });
        }

        const idea = typeof body?.idea === "string" ? body.idea : "";
        if (idea.trim().length < 10) {
            await trackServerEvent(req, {
                eventName: "validation_failed",
                scope: "product",
                route: "/dashboard/validate",
                userId: user.id,
                properties: { reason: "idea_too_short" },
            });
            return NextResponse.json({ error: "Idea must be at least 10 characters" }, { status: 400 });
        }

        const trimmedIdea = idea.trim().slice(0, 2000);
        let redditLabOptions: RedditLabValidationOptions | null = hasRedditLabOptions(body?.reddit_lab)
            ? body.reddit_lab
            : null;

        if (redditLabOptions && !FEATURE_FLAGS.REDDIT_CONNECTION_LAB_ENABLED) {
            return NextResponse.json({ error: "Reddit Connection Lab is disabled." }, { status: 400 });
        }

        if (!redditLabOptions && FEATURE_FLAGS.REDDIT_CONNECTION_LAB_ENABLED) {
            const [connection, defaultPack] = await Promise.all([
                getRedditConnectionSummary(user.id),
                loadSourcePackForUser(user.id, null),
            ]);
            if (connection?.status === "connected") {
                redditLabOptions = {
                    connection_id: connection.id,
                    source_pack_id: defaultPack?.id || null,
                    use_connected_context: true,
                };
            }
        }

        const redditLabPreview = redditLabOptions
            ? await resolveRedditLabContextForValidation(user.id, req.nextUrl.origin, redditLabOptions, false)
            : null;

        const { data: validation, error } = await supabase
            .from("idea_validations")
            .insert({
                user_id: user.id,
                idea_text: trimmedIdea,
                model: "multi-brain",
                status: "queued",
                depth,
                report: redditLabPreview?.preview ? { reddit_lab_context: redditLabPreview.preview } : null,
            })
            .select()
            .single();

        if (error || !validation) {
            console.error("Validation insert error:", error?.code, error?.message);
            await trackServerEvent(req, {
                eventName: "validation_failed",
                scope: "product",
                route: "/dashboard/validate",
                userId: user.id,
                properties: {
                    reason: error?.message || "insert_failed",
                    code: error?.code || null,
                },
            });
            return NextResponse.json({
                error: error?.code === "42P01"
                    ? "idea_validations table not found - run schema_validations.sql in Supabase SQL Editor first!"
                    : error?.message || "Could not create validation job",
            }, { status: 500 });
        }

        try {
            const jobId = await enqueueValidationJob({
                validationId: validation.id,
                userId: user.id,
                idea: trimmedIdea,
                depth,
                origin: req.nextUrl.origin,
                redditLab: redditLabOptions,
            });

            await trackServerEvent(req, {
                eventName: "validation_queued",
                scope: "product",
                route: "/dashboard/validate",
                userId: user.id,
                properties: {
                    validation_id: validation.id,
                    job_id: jobId,
                    depth,
                    has_reddit_lab: Boolean(redditLabOptions),
                },
            });

            return NextResponse.json({
                job_id: jobId,
                validationId: validation.id,
                status: "queued",
            });
        } catch (queueError) {
            const message = queueError instanceof Error ? queueError.message : "Failed to enqueue validation";

            const { error: persistError } = await supabase
                .from("idea_validations")
                .update({
                    status: "failed",
                    report: JSON.stringify({ error: message, failure_stage: "queue_enqueue" }),
                    completed_at: new Date().toISOString(),
                })
                .eq("id", validation.id);

            if (persistError) {
                console.error("[Validate] Failed to persist enqueue failure:", persistError);
            }

            console.error("[Validate] Queue enqueue error:", message);
            await trackServerEvent(req, {
                eventName: "validation_failed",
                scope: "product",
                route: "/dashboard/validate",
                userId: user.id,
                properties: {
                    reason: "queue_enqueue",
                    message,
                    validation_id: validation.id,
                },
            });
            return NextResponse.json({ error: message }, { status: 500 });
        }
    } catch (error) {
        console.error("Validate POST error:", error);
        await trackServerEvent(req, {
            eventName: "validation_failed",
            scope: "product",
            route: "/dashboard/validate",
            properties: { reason: "internal_server_error" },
        });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { data: validations } = await supabase
            .from("idea_validations")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(20);

        return NextResponse.json({ validations: validations || [] });
    } catch {
        return NextResponse.json({ validations: [] });
    }
}
