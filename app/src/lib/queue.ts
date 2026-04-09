import { PgBoss, type JobWithMetadata } from "pg-boss";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { type ValidationDepth, DEPTH_TIMEOUTS, DEFAULT_DEPTH } from "@/lib/validation-depth";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveRedditLabContextForValidation } from "@/lib/reddit-lab-server";
import { type RedditLabValidationOptions } from "@/lib/reddit-lab";
import { recordAdminEvent } from "@/lib/admin-events";
import { summarizeValidationCoverage } from "@/lib/validation-coverage";

export const VALIDATION_QUEUE = "idea-validation";
const VALIDATION_RETRY_LIMIT = 2;
const DEFAULT_VALIDATION_TIMEOUT_SECONDS = DEPTH_TIMEOUTS[DEFAULT_DEPTH];
const TERMINAL_VALIDATION_STATUSES = new Set(["done", "failed", "error", "cancelled"]);

export interface ValidationJobPayload {
    validationId: string;
    userId: string;
    idea: string;
    depth: ValidationDepth;
    origin?: string;
    redditLab?: RedditLabValidationOptions | null;
}

export interface ValidationJobSnapshot {
    id: string;
    state: JobWithMetadata<ValidationJobPayload>["state"];
    retryCount: number;
    retryLimit: number;
    startedOn: string | null;
    createdOn: string | null;
    completedOn: string | null;
}

type ValidationProgressLine = {
    id: number;
    at: string;
    stream: "stdout" | "stderr";
    message: string;
};

const SUPPRESSED_PROGRESS_PATTERNS: RegExp[] = [
    /pytrends not installed/i,
    /aiohttp not installed/i,
    /no official api credentials/i,
    /apply for commercial access/i,
    /using anonymous scraping/i,
    /using proxy rotation/i,
    /search error:/i,
    /comments error/i,
    /proxyerror/i,
    /connecttimeouterror/i,
    /max retries exceeded/i,
    /connection reset by peer/i,
    /read timed out/i,
    /failed to establish a new connection/i,
];

function parseReportObject(report: unknown) {
    if (typeof report === "string") {
        try {
            const parsed = JSON.parse(report);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : {};
        } catch {
            return {};
        }
    }

    return report && typeof report === "object" && !Array.isArray(report)
        ? report as Record<string, unknown>
        : {};
}

function stripEmbeddedProgressTimestamp(line: string) {
    return line.replace(/^\[\d{2}:\d{2}\]\s*/, "").trim();
}

function sanitizeUserFacingProgressLine(message: string) {
    const normalized = stripEmbeddedProgressTimestamp(message);
    if (!normalized) return null;

    const platformFailures: Array<[RegExp, string]> = [
        [/hacker news failed|hn scrape failed|hacker news scraper unavailable/i, "Hacker News was unavailable for this run. Continuing with the remaining sources."],
        [/product ?hunt failed|product ?hunt scraper unavailable/i, "Product Hunt was unavailable for this run. Continuing with the remaining sources."],
        [/indie ?hackers failed|indie ?hackers scraper unavailable/i, "Indie Hackers was unavailable for this run. Continuing with the remaining sources."],
        [/stack overflow scrape failed|stack overflow: scraper not available/i, "Stack Overflow was unavailable for this run. Continuing with the remaining sources."],
        [/github issues scrape failed|github issues: scraper not available/i, "GitHub Issues was unavailable for this run. Continuing with the remaining sources."],
    ];

    for (const [pattern, safeMessage] of platformFailures) {
        if (pattern.test(normalized)) {
            return safeMessage;
        }
    }

    if (SUPPRESSED_PROGRESS_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return null;
    }

    const dbHistoryMatch = normalized.match(/Recent DB history:\s*(\d+)\s*posts/i);
    if (dbHistoryMatch) {
        return `Recent database history: ${dbHistoryMatch[1]} supporting posts loaded.`;
    }

    const dedupMatch = normalized.match(/Deduplicated evidence:\s*(\d+)\s*raw matches.*?(\d+)\s*unique items/i);
    if (dedupMatch) {
        return `Evidence normalized: ${dedupMatch[1]} raw matches -> ${dedupMatch[2]} unique items.`;
    }

    const sourcePatterns: Array<[RegExp, string]> = [
        [/^Reddit:\s*(\d+)\s*posts/i, "Reddit: $1 posts found."],
        [/^Reddit comments:\s*(\d+)\s*matching discussions/i, "Reddit comments: $1 matching discussions."],
        [/^Connected Reddit:\s*(\d+)\s*posts.*$/i, "Connected Reddit: $1 posts from the authorized API."],
        [/^Hacker News:\s*(\d+)\s*matching threads/i, "Hacker News: $1 matching threads."],
        [/^Product Hunt:\s*(\d+)\s*launches\/discussions found/i, "Product Hunt: $1 launches or discussions found."],
        [/^Indie Hackers:\s*(\d+)\s*founder discussions found/i, "Indie Hackers: $1 founder discussions found."],
        [/^G2:\s*(\d+)\s*review complaints found/i, "G2: $1 review complaints found."],
        [/^Jobs:\s*(\d+)\s*relevant postings found/i, "Jobs: $1 relevant postings found."],
        [/^Vendor blogs:\s*(\d+)\s*supporting articles found/i, "Vendor blogs: $1 supporting articles found."],
    ];

    for (const [pattern, template] of sourcePatterns) {
        const match = normalized.match(pattern);
        if (match) {
            return template.replace("$1", match[1] || "0");
        }
    }

    if (/^keywords:/i.test(normalized) || /^colloquial keywords:/i.test(normalized) || /^target subreddits:/i.test(normalized) || /^competitors:/i.test(normalized) || /^audience:/i.test(normalized)) {
        return null;
    }

    if (/^scan complete:/i.test(normalized)) {
        return normalized.replace(/^scan complete:/i, "Scan complete:");
    }

    if (/^platform warnings/i.test(normalized)) {
        return null;
    }

    if (/^mode/i.test(normalized) || /^config/i.test(normalized) || /^subs/i.test(normalized) || /^subreddits/i.test(normalized) || /^forced subs/i.test(normalized) || /^icp/i.test(normalized) || /^method/i.test(normalized) || /^enrichment/i.test(normalized)) {
        return null;
    }

    return null;
}

async function maybeRecordDegradedCoverageAdminEvent(validationId: string) {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
        .from("idea_validations")
        .select("id, progress_log, report")
        .eq("id", validationId)
        .maybeSingle();

    if (error || !data) {
        return;
    }

    const report = parseReportObject(data.report);
    const coverage = summarizeValidationCoverage({
        platformWarnings: Array.isArray((report.data_quality as Record<string, unknown> | undefined)?.platform_warnings)
            ? ((report.data_quality as Record<string, unknown>).platform_warnings as unknown[])
            : Array.isArray(report.platform_warnings)
                ? (report.platform_warnings as unknown[])
                : [],
        partialCoverage: Boolean((report.data_quality as Record<string, unknown> | undefined)?.partial_coverage),
        progressLog: Array.isArray(data.progress_log) ? data.progress_log as unknown[] : [],
    });

    if (coverage.status !== "degraded") {
        return;
    }

    const { data: existing, error: existingError } = await supabaseAdmin
        .from("admin_events")
        .select("id")
        .eq("action", "validation_source_degraded")
        .eq("target_type", "validation")
        .eq("target_id", validationId)
        .limit(1)
        .maybeSingle();

    if (existingError) {
        const message = String(existingError.message || "").toLowerCase();
        if (!message.includes("relation") && !message.includes("does not exist")) {
            throw existingError;
        }
        return;
    }

    if (existing) return;

    await recordAdminEvent({
        action: "validation_source_degraded",
        targetType: "validation",
        targetId: validationId,
        severity: "warning",
        message: coverage.summary || "Validation completed with degraded source coverage.",
        metadata: {
            warning_platforms: coverage.warningPlatforms,
            warnings: coverage.warnings,
            partial_coverage: coverage.partialCoverage,
            used_database_fallback: coverage.usedDatabaseFallback,
        },
    });
}

let supabaseAdminClient: ReturnType<typeof createAdminClient<any>> | null = null;

let bossPromise: Promise<PgBoss> | null = null;

function getValidationTimeoutSeconds(depth: ValidationDepth = DEFAULT_DEPTH) {
    return DEPTH_TIMEOUTS[depth] || DEPTH_TIMEOUTS[DEFAULT_DEPTH];
}

function getQueueConnectionString() {
    const connectionString =
        process.env.SUPABASE_DB_POOLER_URL ||
        process.env.SUPABASE_POOLER_URL ||
        process.env.SUPABASE_DB_URL ||
        process.env.POSTGRES_URL_NON_POOLING ||
        process.env.DATABASE_URL ||
        process.env.POSTGRES_URL;

    if (!connectionString) {
        throw new Error("Missing Supabase Postgres connection string for pg-boss. Set SUPABASE_DB_URL or DATABASE_URL.");
    }

    return connectionString;
}

function getSupabaseKey() {
    return (
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
}

function getAIEncryptionKey() {
    const encryptionKey = process.env.AI_ENCRYPTION_KEY?.trim();
    if (!encryptionKey) {
        throw new Error(
            "Missing AI_ENCRYPTION_KEY for validation worker. " +
            "Encrypted AI settings are required before queued validations can run.",
        );
    }
    return encryptionKey;
}

async function initQueue() {
    const connectionString = getQueueConnectionString();
    const boss = new PgBoss(connectionString);

    boss.on("error", (error: Error) => {
        console.error("[Queue] pg-boss error:", error);
    });

    try {
        await boss.start();
    } catch (error) {
        if (error instanceof Error && /ENOTFOUND|getaddrinfo/i.test(error.message) && /db\./i.test(connectionString)) {
            throw new Error(
                "Could not reach the direct Supabase database host. " +
                "This environment likely needs the Supabase Session Pooler connection string instead of the IPv6-only direct db host.",
            );
        }

        throw error;
    }

    try {
        await boss.createQueue(VALIDATION_QUEUE, {
            retryLimit: VALIDATION_RETRY_LIMIT,
            expireInSeconds: getValidationTimeoutSeconds(DEFAULT_DEPTH),
        });
    } catch {
        await boss.updateQueue(VALIDATION_QUEUE, {
            retryLimit: VALIDATION_RETRY_LIMIT,
            expireInSeconds: getValidationTimeoutSeconds(DEFAULT_DEPTH),
        }).catch(() => {});
    }

    return boss;
}

export async function getQueue() {
    if (!bossPromise) {
        bossPromise = initQueue().catch((error) => {
            bossPromise = null;
            throw error;
        });
    }

    return bossPromise;
}

export async function stopQueue() {
    if (!bossPromise) return;
    const boss = await bossPromise;
    await boss.stop().catch(() => {});
    bossPromise = null;
}

export async function enqueueValidationJob(payload: ValidationJobPayload) {
    const boss = await getQueue();
    const timeout = getValidationTimeoutSeconds(payload.depth);
    const jobId = await boss.send(VALIDATION_QUEUE, payload, {
        id: payload.validationId,
        retryLimit: VALIDATION_RETRY_LIMIT,
        expireInSeconds: timeout,
    });

    if (!jobId) {
        throw new Error("Queue rejected validation job");
    }

    console.log(`[Queue] Enqueued validation ${payload.validationId} for user ${payload.userId}`);
    return jobId;
}

export async function getValidationJobStatus(jobId: string): Promise<ValidationJobSnapshot | null> {
    const boss = await getQueue();
    const job = await boss.getJobById<ValidationJobPayload>(VALIDATION_QUEUE, jobId);

    if (!job) return null;

    return {
        id: job.id,
        state: job.state,
        retryCount: job.retryCount,
        retryLimit: job.retryLimit,
        startedOn: job.startedOn ? job.startedOn.toISOString() : null,
        createdOn: job.createdOn ? job.createdOn.toISOString() : null,
        completedOn: job.completedOn ? job.completedOn.toISOString() : null,
    };
}

export async function cancelValidationJob(validationId: string) {
    const boss = await getQueue();
    const existing = await getValidationRow(validationId);

    if (!existing) {
        throw new Error("Validation not found");
    }

    const currentStatus = String(existing.status || "");
    if (TERMINAL_VALIDATION_STATUSES.has(currentStatus)) {
        return { status: currentStatus || "cancelled", alreadyTerminal: true };
    }

    await boss.cancel(VALIDATION_QUEUE, validationId).catch(() => null);

    await updateValidation(validationId, {
        status: "cancelled",
        completed_at: new Date().toISOString(),
        report: buildCancelledReport(existing.report),
    });

    return { status: "cancelled", alreadyTerminal: false };
}

async function updateValidation(validationId: string, updates: Record<string, unknown>) {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
        .from("idea_validations")
        .update(updates)
        .eq("id", validationId)
        .select("id")
        .single();

    if (error || !data) {
        throw new Error(
            `Could not persist validation ${validationId}: ${error?.message || "row not found after update"}`,
        );
    }
}

async function getValidationRow(validationId: string) {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
        .from("idea_validations")
        .select("id, status, report")
        .eq("id", validationId)
        .maybeSingle();

    if (error) {
        throw new Error(`Could not load validation ${validationId}: ${error.message}`);
    }

    return data as { id: string; status?: string | null; report?: unknown } | null;
}

function buildCancelledReport(report: unknown, reason = "Validation cancelled by user") {
    const parsed = parseReportObject(report);
    return {
        ...parsed,
        error: reason,
        failure_stage: "cancelled",
        cancelled: true,
        cancelled_at: new Date().toISOString(),
    };
}

async function updateValidationProgress(validationId: string, lines: ValidationProgressLine[]) {
    const supabaseAdmin = getSupabaseAdmin();
    const latest = lines[lines.length - 1];
    const { data: current, error: currentError } = await supabaseAdmin
        .from("idea_validations")
        .select("status, report")
        .eq("id", validationId)
        .single();

    if (currentError) {
        throw new Error(
            `Could not load validation ${validationId} before progress update: ${currentError.message}`,
        );
    }

    if (TERMINAL_VALIDATION_STATUSES.has(String(current?.status || ""))) {
        return;
    }

    const existingReport =
        current?.report && typeof current.report === "object" && !Array.isArray(current.report)
            ? current.report as Record<string, unknown>
            : {};

    const report = {
        ...existingReport,
        live_progress: {
            lines,
            latest_message: latest?.message || "",
            updated_at: new Date().toISOString(),
        },
    };

    const { data, error } = await supabaseAdmin
        .from("idea_validations")
        .update({ report })
        .eq("id", validationId)
        .not("status", "in", "(done,failed,error,cancelled)")
        .select("id")
        .maybeSingle();

    if (error) {
        throw new Error(
            `Could not persist validation progress ${validationId}: ${error.message}`,
        );
    }
}

function getSupabaseAdmin() {
    if (!supabaseAdminClient) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = getSupabaseKey();

        if (!supabaseUrl || !supabaseKey) {
            throw new Error("Missing Supabase API env for queue worker. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.");
        }

        supabaseAdminClient = createAdminClient(supabaseUrl, supabaseKey);
    }

    return supabaseAdminClient;
}

function getPythonEnv() {
    const supabaseKey = getSupabaseKey() || "";
    const encryptionKey = getAIEncryptionKey();

    return {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
        SUPABASE_SERVICE_KEY: supabaseKey,
        SUPABASE_KEY: supabaseKey,
        AI_ENCRYPTION_KEY: encryptionKey,
    };
}

async function runValidationCommand(payload: ValidationJobPayload, signal: AbortSignal) {
    const configPath = path.join(os.tmpdir(), `validate_${payload.validationId}.json`);
    const projectRoot = path.resolve(process.cwd(), "..");
    const timeoutSeconds = getValidationTimeoutSeconds(payload.depth);
    const progressLines: ValidationProgressLine[] = [];
    let progressLineId = 0;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let progressFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let cancellationCheckTimer: ReturnType<typeof setInterval> | null = null;
    let progressWritesEnabled = true;
    const emittedSignals = new Set<string>();

    const normalizeProgressLine = (line: string) => line.replace(/\r/g, "").trim();

    const persistProgressSoon = () => {
        if (!progressWritesEnabled || progressFlushTimer) return;
        progressFlushTimer = setTimeout(() => {
            progressFlushTimer = null;
            if (!progressWritesEnabled || progressLines.length === 0) return;
            const snapshot = progressLines.slice(-80);
            void updateValidationProgress(payload.validationId, snapshot).catch((error) => {
                console.error(`[Queue] Validation ${payload.validationId} progress persistence failed:`, error);
            });
        }, 750);
    };

    const pushProgressLine = (stream: "stdout" | "stderr", rawLine: string) => {
        const message = normalizeProgressLine(rawLine);
        if (!message) return;
        progressLineId += 1;
        progressLines.push({
            id: progressLineId,
            at: new Date().toISOString(),
            stream,
            message,
        });
        if (progressLines.length > 80) {
            progressLines.splice(0, progressLines.length - 80);
        }
        persistProgressSoon();
    };

    const emitSafeSignalOnce = (key: string, message: string) => {
        if (emittedSignals.has(key)) return;
        emittedSignals.add(key);
        pushProgressLine("stdout", message);
    };

    const pushUserFacingProgressLine = (stream: "stdout" | "stderr", rawLine: string) => {
        const safeMessage = sanitizeUserFacingProgressLine(rawLine);
        if (safeMessage) {
            pushProgressLine("stdout", safeMessage);
        }

        if (/Reddit:\s*0\s*posts/i.test(rawLine)) {
            emitSafeSignalOnce(
                "reddit-zero-results",
                "Reddit returned no usable posts for this run. CueIdea is continuing with other sources and recent database history.",
            );
        }

        if (/reddit/i.test(rawLine) && SUPPRESSED_PROGRESS_PATTERNS.some((pattern) => pattern.test(rawLine))) {
            emitSafeSignalOnce(
                "reddit-degraded",
                "Reddit access is limited for this run. Continuing with other sources and recent database history.",
            );
        }

        if (/pytrends not installed/i.test(rawLine)) {
            emitSafeSignalOnce(
                "trends-unavailable",
                "Trend enrichment is unavailable for this run. Continuing with the evidence already collected.",
            );
        }
    };

    const flushBufferedProgress = () => {
        if (stdoutBuffer.trim()) {
            pushProgressLine("stdout", stdoutBuffer);
            stdoutBuffer = "";
        }
        if (stderrBuffer.trim()) {
            pushProgressLine("stderr", stderrBuffer);
            stderrBuffer = "";
        }
    };

    const redditLabResolved = payload.redditLab
        ? await resolveRedditLabContextForValidation(
            payload.userId,
            payload.origin || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
            payload.redditLab,
            true,
        )
        : null;

    await fs.writeFile(configPath, JSON.stringify({
        validation_id: payload.validationId,
        idea: payload.idea,
        user_id: payload.userId,
        depth: payload.depth || DEFAULT_DEPTH,
        reddit_lab: redditLabResolved?.workerContext || null,
    }));

    try {
        await new Promise<void>((resolve, reject) => {
            const child = spawn("python", ["validate_idea.py", "--config-file", configPath], {
                cwd: projectRoot,
                env: getPythonEnv(),
                stdio: ["ignore", "pipe", "pipe"],
                detached: false,
            });

            let settled = false;

            const finish = (callback: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeoutHandle);
                if (cancellationCheckTimer) {
                    clearInterval(cancellationCheckTimer);
                    cancellationCheckTimer = null;
                }
                if (progressFlushTimer) {
                    clearTimeout(progressFlushTimer);
                    progressFlushTimer = null;
                }
                progressWritesEnabled = false;
                signal.removeEventListener("abort", onAbort);
                callback();
            };

            const onAbort = () => {
                child.kill();
                finish(() => reject(new Error(
                    `Validation job aborted by queue (worker shutdown or ${timeoutSeconds}s queue timeout)`,
                )));
            };

            const timeoutHandle = setTimeout(() => {
                child.kill();
                finish(() => reject(new Error(`Validation exceeded ${timeoutSeconds}s timeout`)));
            }, timeoutSeconds * 1000);

            cancellationCheckTimer = setInterval(() => {
                void getValidationRow(payload.validationId)
                    .then((row) => {
                        if (settled) return;
                        if (String(row?.status || "") === "cancelled") {
                            child.kill();
                            finish(() => reject(new Error("Validation cancelled by user")));
                        }
                    })
                    .catch((error) => {
                        console.error(`[Queue] Cancellation check failed for ${payload.validationId}:`, error);
                    });
            }, 2000);

            signal.addEventListener("abort", onAbort, { once: true });

            child.stdout?.on("data", (data: Buffer) => {
                const text = data.toString();
                console.log(`[Queue Validate ${payload.validationId}] ${text.trim()}`);
                stdoutBuffer += text;
                const lines = stdoutBuffer.split(/\r?\n/);
                stdoutBuffer = lines.pop() || "";
                for (const line of lines) {
                    pushUserFacingProgressLine("stdout", line);
                }
            });

            child.stderr?.on("data", (data: Buffer) => {
                const text = data.toString();
                console.error(`[Queue Validate ${payload.validationId} ERR] ${text.trim()}`);
                stderrBuffer += text;
                const lines = stderrBuffer.split(/\r?\n/);
                stderrBuffer = lines.pop() || "";
                for (const line of lines) {
                    pushUserFacingProgressLine("stderr", line);
                }
            });

            child.on("error", (error) => {
                finish(() => reject(error));
            });

            child.on("close", (code) => {
                flushBufferedProgress();
                if (code === 0) {
                    finish(resolve);
                    return;
                }

                finish(() => reject(new Error(`Validation process exited with code ${code}`)));
            });
        });
    } finally {
        await fs.unlink(configPath).catch(() => {});
    }
}

export async function startValidationWorker() {
    const boss = await getQueue();

    const workerId = await boss.work<ValidationJobPayload>(VALIDATION_QUEUE, { includeMetadata: true, batchSize: 1, localConcurrency: 1 }, async (jobs) => {
        const [job] = jobs;
        if (!job) {
            return { ok: true };
        }
        const willRetry = job.retryCount < job.retryLimit;

        console.log(
            `[Queue] Starting validation ${job.data.validationId} ` +
            `(attempt ${job.retryCount + 1} of ${job.retryLimit + 1}, timeout ${getValidationTimeoutSeconds(job.data.depth)}s, depth ${job.data.depth})`,
        );

        const existingValidation = await getValidationRow(job.data.validationId);
        if (String(existingValidation?.status || "") === "cancelled") {
            console.log(`[Queue] Skipping cancelled validation ${job.data.validationId}`);
            return { ok: true };
        }

        try {
            await updateValidation(job.data.validationId, {
                status: "starting",
                completed_at: null,
            });
        } catch (error) {
            console.error(
                `[Queue] Validation ${job.data.validationId} could not enter starting state:`,
                error,
            );
            throw error;
        }

        try {
            await runValidationCommand(job.data, job.signal);
            await maybeRecordDegradedCoverageAdminEvent(job.data.validationId).catch((error) => {
                console.error(`[Queue] Could not record degraded coverage admin event for ${job.data.validationId}:`, error);
            });
            console.log(`[Queue] Validation ${job.data.validationId} completed successfully`);
            return { ok: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Validation worker failed";
            const cancelledByUser = /cancelled by user/i.test(message);

            if (cancelledByUser) {
                console.log(`[Queue] Validation ${job.data.validationId} cancelled by user`);
                return { ok: true };
            }

            const failurePayload = willRetry
                ? {
                    status: "queued",
                    report: JSON.stringify({
                        error: message,
                        retrying: true,
                        failure_stage: "worker",
                    }),
                }
                : {
                    status: "failed",
                    report: JSON.stringify({
                        error: message,
                        failure_stage: "worker",
                    }),
                    completed_at: new Date().toISOString(),
                };

            try {
                await updateValidation(job.data.validationId, failurePayload);
            } catch (persistError) {
                console.error(
                    `[Queue] Validation ${job.data.validationId} status persistence failed after worker error:`,
                    persistError,
                );
            }

            console.error(
                `[Queue] Validation ${job.data.validationId} failed: ${message}` +
                (willRetry ? " — retry scheduled" : " — no retries remaining"),
            );
            throw error;
        }
    });

    return { boss, workerId };
}
