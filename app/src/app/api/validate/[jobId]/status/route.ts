import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { buildEnrichedValidationView } from "@/lib/validation-insights";
import { getValidationJobStatus } from "@/lib/queue";

const TERMINAL_STATUSES = new Set(["done", "error", "failed"]);

function parseFallbackReport(report: unknown): Record<string, unknown> {
    if (typeof report === "string") {
        try {
            const parsed = JSON.parse(report);
            return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
        } catch {
            return {};
        }
    }

    return report && typeof report === "object" ? report as Record<string, unknown> : {};
}

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ jobId: string }> },
) {
    try {
        const { jobId } = await params;
        const cookieStore = await cookies();
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const publishableKey =
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

        const supabase = createServerClient(supabaseUrl, publishableKey, {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll() {
                    // Read-only in route handlers.
                },
            },
        });

        const { data: { user } } = await supabase.auth.getUser();
        let query = supabase.from("idea_validations").select("*").eq("id", jobId);

        if (user?.id) {
            query = query.eq("user_id", user.id);
        }

        const { data: validation, error } = await query.single();
        if (error || !validation) {
            console.error(`[Validate Status] 404 id=${jobId} user=${user?.id ?? "no-session"}: ${error?.code} ${error?.message}`);
            return NextResponse.json({ error: "Validation not found" }, { status: 404 });
        }

        let queueLookupFailed = false;
        const queueJobPromise = getValidationJobStatus(jobId).catch((queueError) => {
            queueLookupFailed = true;
            console.error(`[Validate Status] Queue lookup failed for ${jobId}:`, queueError);
            return null;
        });

        const enrichedValidation = await buildEnrichedValidationView(validation, user?.id || null).catch((enrichmentError) => {
            console.error(`[Validate Status] Enrichment fallback for ${jobId}:`, enrichmentError);
            return {
                ...validation,
                report: parseFallbackReport(validation.report),
                decision_pack: null,
            };
        });
        const queueJob = await queueJobPromise;
        const validationStatus = String(enrichedValidation.status || "");
        const isTerminal = TERMINAL_STATUSES.has(validationStatus);
        const queueFailed = queueJob?.state === "failed";
        const queueRetrying = queueJob?.state === "retry";
        const ageMs = Date.now() - Date.parse(String(enrichedValidation.created_at || ""));
        const staleQueued = !queueJob && !isTerminal && Number.isFinite(ageMs) && ageMs > 10 * 60_000;
        const derivedReport = parseFallbackReport(
            queueFailed && !isTerminal
                ? {
                    ...enrichedValidation.report,
                    error: enrichedValidation.report?.error || "Validation queue failed before completion",
                    failure_stage: "worker",
                }
                : enrichedValidation.report,
        );

        const derivedValidation = queueFailed && !isTerminal
            ? {
                ...enrichedValidation,
                status: "failed",
                report: derivedReport,
            }
            : enrichedValidation;

        const reportError = typeof derivedReport.error === "string" ? derivedReport.error : null;
        const derivedStatus = String(derivedValidation.status || validationStatus);
        const validationFailed = derivedStatus === "failed" || derivedStatus === "error";
        const persistenceFailed =
            Boolean(derivedReport.persistence_error) ||
            (queueFailed && !isTerminal) ||
            (queueJob?.state === "completed" && !isTerminal);
        const workerFailed = queueFailed || derivedReport.failure_stage === "worker";

        return NextResponse.json({
            job_id: jobId,
            queue: queueJob,
            validation: derivedValidation,
            diagnostics: {
                queue_retrying: queueRetrying,
                stale_queued: staleQueued,
                queue_failed: queueFailed,
                queue_lookup_failed: queueLookupFailed,
                worker_failed: workerFailed,
                validation_failed: validationFailed,
                persistence_failed: persistenceFailed,
                failure_reason: reportError,
            },
        });
    } catch (error) {
        console.error("Validate GET [jobId]/status error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
