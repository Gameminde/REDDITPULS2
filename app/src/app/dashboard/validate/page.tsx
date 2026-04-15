"use client";

import { motion } from "framer-motion";
import { Zap, Loader2, Terminal, CheckCircle2, Clock, Settings, Maximize2, Minimize2, Search, FlaskConical, Telescope } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useUserPlan } from "@/lib/use-user-plan";
import { VALIDATION_DEPTHS, type ValidationDepth, DEFAULT_DEPTH, getValidationDepthOption } from "@/lib/validation-depth";
import { ValidationProgressPane, type ValidationProgressEvent } from "./ValidationProgressPane";

/* ── Status pipeline constants ───────────────────────── */

const STATUS_ORDER = [
    "starting", "queued", "decomposing", "decomposed",
    "scraping", "scraped", "analyzing_trends",
    "analyzing_competition", "synthesizing", "done",
];

/*
 * Python writes sub-statuses during Phase 3:
 *   "synthesizing (0/3 batch scan)"
 *   "synthesizing (1/3 market analysis)"
 *   "synthesizing (2/3 strategy)"
 *   "synthesizing (3/3 action plan)"
 *   "debating (final verdict)"
 * Match using prefix so the terminal shows each agent pass.
 */
const STATUS_LOG: Record<string, { msg: string; type: string }> = {
    starting:               { msg: "[INIT] Validation pipeline activated", type: "info" },
    queued:                 { msg: "[QUEUE] Waiting for execution slot…", type: "muted" },
    decomposing:            { msg: "[PHASE 1] Decomposing idea -> keywords, audience, competitors", type: "info" },
    decomposed:             { msg: "[DONE PHASE 1] Keywords and competitors extracted", type: "success" },
    scraping:               { msg: "[PHASE 2] Scraping Reddit, HN, ProductHunt, IndieHackers...", type: "info" },
    scraped:                { msg: "[DONE PHASE 2] Market data collected", type: "success" },
    analyzing_trends:       { msg: "[PHASE 2b] Analyzing Google Trends data…", type: "info" },
    analyzing_competition:  { msg: "[PHASE 2c] Mapping competitive landscape...", type: "info" },
    synthesizing:           { msg: "[PHASE 3] AI synthesis starting…", type: "debate" },
    done:                   { msg: "[DONE] Report generated. Redirecting…", type: "success" },
    error:                  { msg: "[FAILED] Validation failed", type: "error" },
    failed:                 { msg: "[FAILED] Process error", type: "error" },
};

/* Sub-status patterns for Phase 3 agent debate */
const SYNTH_SUBSTATUS: { pattern: string; msg: string; type: string }[] = [
    { pattern: "0/3 batch",     msg: "[SCAN] Batch-scanning all posts for pain quotes, WTP signals, competitors...", type: "debate" },
    { pattern: "1/3 market",    msg: "[AGENT 1 · Market Analyst] Analyzing pain validation, WTP, TAM...", type: "debate" },
    { pattern: "2/3 strategy",  msg: "[AGENT 2 · Strategist] Designing ICP, competition landscape, pricing...", type: "debate" },
    { pattern: "3/3 action",    msg: "[AGENT 3 · GTM Planner] Building roadmap, revenue model, risk matrix...", type: "debate" },
    { pattern: "debating",      msg: "[DEBATE] All models deliberating final verdict...", type: "debate" },
];

function getStatusLog(status: string): { msg: string; type: string } | null {
    /* Exact match first */
    if (STATUS_LOG[status]) return STATUS_LOG[status];
    /* Sub-status pattern match for synthesis phases */
    const lower = status.toLowerCase();
    for (const sub of SYNTH_SUBSTATUS) {
        if (lower.includes(sub.pattern)) return sub;
    }
    /* Catch-all for any synthesizing variant */
    if (lower.startsWith("synthesizing")) return { msg: `[PHASE 3] ${status.replace(/^synthesizing\s*\(?/, "").replace(/\)$/, "")}...`, type: "debate" };
    if (lower.startsWith("debating")) return { msg: `[DEBATE] ${status.replace(/^debating\s*\(?/, "").replace(/\)$/, "")}...`, type: "debate" };
    return null;
}

const BUTTON_STAGES = [
    { label: "DECOMPOSING…", detail: "Extracting keywords, audience, competitors" },
    { label: "SCRAPING…", detail: "Reddit, HN, ProductHunt, IndieHackers" },
    { label: "ANALYZING…", detail: "Trends and competition mapping" },
    { label: "DEBATING…", detail: "Multi-model AI synthesis" },
    { label: "COMPLETE", detail: "Report generated" },
];

/* ── Types ───────────────────────────────────────────── */

const ACTIVE_VALIDATION_ID_KEY = "activeValidationId";
const ACTIVE_VALIDATION_IDEA_KEY = "activeValidationIdea";
const COMPLETED_VALIDATION_ID_KEY = "completedValidationId";
const VALIDATION_STORAGE_EVENT = "validation-storage";

type Validation = {
    id: string;
    idea_text: string;
    status: string;
    verdict: string;
    confidence: number;
    created_at?: string;
    updated_at?: string;
    posts_found?: number;
    progress_log?: ValidationProgressEvent[];
    report: any;
};

type ValidationStatusResponse = {
    validation?: Validation;
    diagnostics?: {
        queue_retrying?: boolean;
        stale_queued?: boolean;
        queue_failed?: boolean;
        queue_lookup_failed?: boolean;
        worker_failed?: boolean;
        validation_failed?: boolean;
        persistence_failed?: boolean;
        failure_reason?: string | null;
    };
};

type LiveProgressLine = {
    id: number;
    at?: string;
    stream?: "stdout" | "stderr";
    message?: string;
};

type LogEntry = { time: string; msg: string; type: string };

type HistoryItem = {
    id: string;
    idea_text: string;
    verdict: string;
    confidence: number;
    status: string;
    created_at: string;
};

function formatElapsedTime(totalSeconds: number) {
    const safe = Math.max(0, totalSeconds);
    const mm = String(Math.floor(safe / 60)).padStart(2, "0");
    const ss = String(safe % 60).padStart(2, "0");
    return `${mm}:${ss}`;
}

function deriveProgressEventsFromLiveProgress(report: any): ValidationProgressEvent[] {
    const lines: LiveProgressLine[] = Array.isArray(report?.live_progress?.lines)
        ? report.live_progress.lines
        : [];

    return lines
        .map((line) => {
            const message = typeof line?.message === "string" ? line.message.trim() : "";
            if (!message) return null;

            const lower = message.toLowerCase();
            const event: ValidationProgressEvent = {
                ts: typeof line.id === "number" ? line.id : undefined,
                message,
            };

            const sourcePatterns: Array<[ValidationProgressEvent["source"], RegExp]> = [
                ["reddit", /reddit:\s*(\d+)/i],
                ["reddit_connected", /connected reddit:\s*(\d+)/i],
                ["reddit_comment", /reddit comments?:\s*(\d+)/i],
                ["hackernews", /(?:hn|hacker news):\s*(\d+)/i],
                ["producthunt", /product ?hunt:\s*(\d+)/i],
                ["indiehackers", /indie ?hackers:\s*(\d+)/i],
                ["g2_review", /g2(?: reviews?)?:\s*(\d+)/i],
                ["job_posting", /jobs?:\s*(\d+)/i],
            ];

            for (const [source, pattern] of sourcePatterns) {
                const match = message.match(pattern);
                if (match) {
                    event.phase = "scraping";
                    event.source = source;
                    event.count = Number(match[1] || 0);
                    return event;
                }
            }

            if (lower.includes("decomposition complete")) {
                event.phase = "decomposing";
                return event;
            }
            if (lower.includes("deduplicated evidence")) {
                event.phase = "dedup";
                return event;
            }
            if (lower.includes("pass 1 of 3") || lower.includes("market analysis")) {
                event.phase = "synthesis";
                return event;
            }
            if (lower.includes("pass 2 of 3") || lower.includes("strategy")) {
                event.phase = "synthesis";
                return event;
            }
            if (lower.includes("pass 3 of 3") || lower.includes("action plan")) {
                event.phase = "synthesis";
                return event;
            }
            const roundMatch = message.match(/round\s+(\d+)/i);
            if (roundMatch) {
                event.phase = "debate";
                event.round = Number(roundMatch[1]);
                event.total_rounds = 2;
                return event;
            }
            if (lower.includes("updated position")) {
                event.phase = "debate";
                event.changed = true;
                return event;
            }

            return event;
        })
        .filter((event): event is ValidationProgressEvent => Boolean(event));
}

/* ── Helpers ─────────────────────────────────────────── */

function getVerdictColor(v: string): string {
    const u = (v || "").toUpperCase();
    if (u.includes("BUILD") && !u.includes("DON")) return "text-build";
    if (u.includes("DON") || u.includes("REJECT")) return "text-dont";
    return "text-risky";
}

function getVerdictBg(v: string): string {
    const u = (v || "").toUpperCase();
    if (u.includes("BUILD") && !u.includes("DON")) return "bg-build/10 border-build/20";
    if (u.includes("DON") || u.includes("REJECT")) return "bg-dont/10 border-dont/20";
    return "bg-risky/10 border-risky/20";
}

function getValidationFailureMessage(payload?: ValidationStatusResponse): string | null {
    const reportError = typeof payload?.validation?.report?.error === "string"
        ? payload.validation.report.error.trim()
        : "";
    if (reportError) return reportError;

    const failureReason = typeof payload?.diagnostics?.failure_reason === "string"
        ? payload.diagnostics.failure_reason.trim()
        : "";
    if (failureReason) return failureReason;

    if (payload?.diagnostics?.persistence_failed) {
        return "Validation failed and the worker could not persist one or more state updates.";
    }
    if (payload?.diagnostics?.worker_failed) {
        return "Validation worker failed before the report completed.";
    }
    if (payload?.diagnostics?.queue_retrying) {
        return "Validation hit an error and is retrying in the queue.";
    }
    return null;
}

/* ── Component ──────────────────────────────────────── */

const ValidatePage = () => {
    const { isPremium } = useUserPlan();
    const router = useRouter();
    const searchParams = useSearchParams();
    const settingsHref = "/dashboard/settings";

    /* form state */
    const [idea, setIdea] = useState("");
    const [target, setTarget] = useState("");
    const [pain, setPain] = useState("");
    const [competitors, setCompetitors] = useState("");
    const [depth, setDepth] = useState<ValidationDepth>(DEFAULT_DEPTH);
    const selectedDepthOption = getValidationDepthOption(depth);
    const selectedDepthLocked = selectedDepthOption.premiumRequired && !isPremium;

    /* validation state */
    const [activeValidation, setActiveValidation] = useState<Validation | null>(null);
    const [isValidating, setIsValidating] = useState(false);
    const [configuredModels, setConfiguredModels] = useState<string[]>([]);
    const [aiConfigChecked, setAiConfigChecked] = useState(false);
    const [aiConfigError, setAiConfigError] = useState<string | null>(null);
    const [aiHealthWarning, setAiHealthWarning] = useState<string | null>(null);
    const [showAiSetupGate, setShowAiSetupGate] = useState(false);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [termExpanded, setTermExpanded] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [activeValidationWarning, setActiveValidationWarning] = useState<string | null>(null);
    const [storedActiveValidationId, setStoredActiveValidationId] = useState<string | null>(null);
    const [isCancelling, setIsCancelling] = useState(false);
    const [terminalTick, setTerminalTick] = useState(0);
    const [logEntries, setLogEntries] = useState<LogEntry[]>([
        { time: "00:00", msg: "[SYS] AI Engine stand-by — enter an idea to begin.", type: "muted" },
    ]);

    /* refs */
    const termRef = useRef<HTMLDivElement>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastStatusRef = useRef<string>("");
    const lastProgressIdRef = useRef(0);
    const scrapingStartedAtRef = useRef<number | null>(null);
    const startTimeRef = useRef<number>(0);
    const pollingFailureRef = useRef(0);
    const resumeCheckedRef = useRef(false);

    const stopPolling = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
    }, []);

    const emitValidationStorageChange = useCallback(() => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(new Event(VALIDATION_STORAGE_EVENT));
    }, []);

    const syncStoredValidationId = useCallback(() => {
        if (typeof window === "undefined") return;
        setStoredActiveValidationId(window.localStorage.getItem(ACTIVE_VALIDATION_ID_KEY));
    }, []);

    const persistActiveValidation = useCallback((validationId: string, ideaText: string) => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(ACTIVE_VALIDATION_ID_KEY, validationId);
        window.localStorage.setItem(ACTIVE_VALIDATION_IDEA_KEY, ideaText);
        window.localStorage.removeItem(COMPLETED_VALIDATION_ID_KEY);
        setStoredActiveValidationId(validationId);
        emitValidationStorageChange();
    }, [emitValidationStorageChange]);

    const clearStoredValidation = useCallback((clearCompleted = false) => {
        if (typeof window === "undefined") return;
        window.localStorage.removeItem(ACTIVE_VALIDATION_ID_KEY);
        window.localStorage.removeItem(ACTIVE_VALIDATION_IDEA_KEY);
        if (clearCompleted) {
            window.localStorage.removeItem(COMPLETED_VALIDATION_ID_KEY);
        }
        setStoredActiveValidationId(null);
        emitValidationStorageChange();
    }, [emitValidationStorageChange]);

    const markValidationCompleted = useCallback((validationId: string) => {
        if (typeof window === "undefined") return;
        window.localStorage.removeItem(ACTIVE_VALIDATION_ID_KEY);
        window.localStorage.removeItem(ACTIVE_VALIDATION_IDEA_KEY);
        window.localStorage.setItem(COMPLETED_VALIDATION_ID_KEY, validationId);
        setStoredActiveValidationId(null);
        emitValidationStorageChange();
    }, [emitValidationStorageChange]);

    /* parsed report (safe) */
    const parsedReport =
        typeof activeValidation?.report === "string"
            ? JSON.parse(activeValidation.report)
            : activeValidation?.report || {};
    const progressEvents = Array.isArray(activeValidation?.progress_log) && activeValidation.progress_log.length > 0
        ? activeValidation.progress_log
        : deriveProgressEventsFromLiveProgress(parsedReport);
    const platformWarnings = Array.isArray(parsedReport?.data_quality?.platform_warnings)
        ? parsedReport.data_quality.platform_warnings
        : Array.isArray(parsedReport?.platform_warnings)
            ? parsedReport.platform_warnings
            : [];

    const appendLiveProgress = useCallback((report: any) => {
        const liveLines: LiveProgressLine[] = Array.isArray(report?.live_progress?.lines)
            ? report.live_progress.lines
            : [];
        if (liveLines.length === 0) return;

        const unseen = liveLines.filter((line) => typeof line?.id === "number" && line.id > lastProgressIdRef.current);
        if (unseen.length === 0) return;

        const mappedEntries: LogEntry[] = unseen
            .map((line) => {
                const message = typeof line?.message === "string" ? line.message.trim() : "";
                if (!message) return null;

                const elapsedSeconds =
                    typeof line?.at === "string" && startTimeRef.current > 0
                        ? Math.max(0, Math.floor((Date.parse(line.at) - startTimeRef.current) / 1000))
                        : Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000));

                return {
                    time: formatElapsedTime(elapsedSeconds),
                    msg: message,
                    type:
                        line?.stream === "stderr" || /traceback|error|failed|exception/i.test(message)
                            ? "error"
                            : "info",
                };
            })
            .filter((entry): entry is LogEntry => Boolean(entry));

        if (mappedEntries.length === 0) return;

        lastProgressIdRef.current = Math.max(...unseen.map((line) => line.id));
        setLogEntries((prev) => {
            const deduped = mappedEntries.filter((entry) => prev[prev.length - 1]?.msg !== entry.msg);
            return deduped.length > 0 ? [...prev, ...deduped] : prev;
        });
    }, []);

    /* ── Fetch AI config ────────────────────────────────── */
    useEffect(() => {
        let cancelled = false;

        fetch("/api/settings/ai")
            .then((r) => {
                if (!r.ok) {
                    throw new Error("Could not load AI settings");
                }
                return r.json();
            })
            .then((d) => {
                if (cancelled) return;
                const active = (d.configs || []).filter((c: any) => c.is_active);
                setConfiguredModels(active.map((c: any) => c.selected_model));
                setAiConfigError(null);
                if (active.length > 0) {
                    void fetch("/api/settings/ai/health")
                        .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
                        .then(({ ok, payload }) => {
                            if (cancelled) return;
                            if (!ok) {
                                setAiHealthWarning(null);
                                return;
                            }
                            setAiHealthWarning(payload?.blocked && typeof payload?.message === "string" ? payload.message : null);
                        })
                        .catch(() => {
                            if (!cancelled) setAiHealthWarning(null);
                        });
                } else {
                    setAiHealthWarning(null);
                }
            })
            .catch(() => {
                if (cancelled) return;
                setConfiguredModels([]);
                setAiConfigError("We could not verify your AI setup. Open Settings and try again.");
                setAiHealthWarning(null);
            })
            .finally(() => {
                if (cancelled) return;
                setAiConfigChecked(true);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    /* ── Fetch validation history ───────────────────────── */
    useEffect(() => {
        fetch("/api/validate")
            .then((r) => r.json())
            .then((d) => {
                const completed = (d.validations || [])
                    .filter((v: any) => v.status === "done" && v.verdict)
                    .slice(0, 5);
                setHistory(completed);
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (configuredModels.length > 0) {
            setShowAiSetupGate(false);
        }
    }, [configuredModels.length]);

    useEffect(() => {
        const prefillIdea = searchParams.get("idea");
        const prefillTarget = searchParams.get("target");
        const prefillPain = searchParams.get("pain");
        const prefillCompetitors = searchParams.get("competitors");
        const prefillDepth = searchParams.get("depth");
        if (prefillIdea && !idea.trim()) {
            setIdea(prefillIdea);
        }
        if (prefillTarget && !target.trim()) {
            setTarget(prefillTarget);
        }
        if (prefillPain && !pain.trim()) {
            setPain(prefillPain);
        }
        if (prefillCompetitors && !competitors.trim()) {
            setCompetitors(prefillCompetitors);
        }
        if (
            prefillDepth
            && depth === DEFAULT_DEPTH
            && VALIDATION_DEPTHS.some((option) => option.mode === prefillDepth)
        ) {
            setDepth(prefillDepth as ValidationDepth);
        }
    }, [searchParams, idea, target, pain, competitors, depth]);

    /* ── Push log entry on status change ─────────────────── */
    const pushLog = useCallback((status: string, validation: Validation) => {
        const label = getStatusLog(status);
        if (!label) return;
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
        const ss = String(elapsed % 60).padStart(2, "0");

        let msg = label.msg;
        if (status === "scraped" && validation.posts_found) {
            msg = `[DONE PHASE 2] Found ${validation.posts_found} posts. Filtering for relevance.`;
        }
        if ((status === "failed" || status === "error") && typeof validation.report?.error === "string" && validation.report.error.trim()) {
            msg = `[FAILED] ${validation.report.error.trim()}`;
        }
        setLogEntries((prev) => [...prev, { time: `${mm}:${ss}`, msg, type: label.type }]);
    }, []);

    /* ── SACRED POLLING CONTRACT ─────────────────────────── */
    const startPolling = useCallback(
        (jobId: string) => {
            stopPolling();
            pollingFailureRef.current = 0;
            const pollStartedAt = Date.now();
            const maxPollMs = 180000;
            const maxFailures = 3;

            pollingRef.current = setInterval(async () => {
                try {
                    const r = await fetch(`/api/validate/${jobId}/status`);
                    if (!r.ok) {
                        let detail = "";
                        try {
                            const body = await r.json();
                            detail = typeof body?.error === "string" ? `: ${body.error}` : "";
                        } catch {
                            detail = "";
                        }
                        throw new Error(`Polling failed with ${r.status}${detail}`);
                    }
                    const d: ValidationStatusResponse = await r.json();
                    if (d.validation) {
                        pollingFailureRef.current = 0;
                        setActiveValidation(d.validation);
                        appendLiveProgress(d.validation.report);

                        /* track status changes → push log entries */
                        const newStatus = d.validation.status;
                        if (newStatus === "scraping" && !scrapingStartedAtRef.current) {
                            scrapingStartedAtRef.current = Date.now();
                        } else if (newStatus !== "scraping") {
                            scrapingStartedAtRef.current = null;
                        }
                        if (newStatus !== lastStatusRef.current) {
                            lastStatusRef.current = newStatus;
                            pushLog(newStatus, d.validation);
                        }

                        if (newStatus === "done" || newStatus === "error" || newStatus === "failed" || newStatus === "cancelled") {
                            stopPolling();
                            setIsValidating(false);
                            setIsCancelling(false);
                            if (newStatus === "done") {
                                markValidationCompleted(d.validation.id || jobId);
                                setActiveValidationWarning(null);
                            } else {
                                clearStoredValidation();
                            }
                            if (newStatus === "done") {
                                setValidationError(null);
                                router.push(`/dashboard/reports/${d.validation.id || jobId}`);
                            } else if (newStatus === "cancelled") {
                                setValidationError(null);
                                setActiveValidationWarning("Validation cancelled. You can start a new one now.");
                                setLogEntries((prev) => [
                                    ...prev,
                                    { time: formatElapsedTime(Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000))), msg: "[SYS] Validation cancelled.", type: "muted" },
                                ]);
                            } else {
                                setValidationError(
                                    getValidationFailureMessage(d) ||
                                    "Validation failed before the report completed.",
                                );
                            }
                        }
                    }
                } catch (error) {
                    pollingFailureRef.current += 1;
                    const elapsed = Date.now() - pollStartedAt;
                    if (pollingFailureRef.current >= maxFailures || elapsed >= maxPollMs) {
                        stopPolling();
                        setIsValidating(false);
                        const reason = error instanceof Error ? error.message : "";
                        const message = elapsed >= maxPollMs
                            ? "Validation stalled — polling timed out. Retry to resume or check Reports."
                            : reason.includes("500")
                                ? "Validation service error — retry polling or check Reports for the latest state."
                                : "Validation status could not be fetched. Retry polling or check Reports.";
                        setValidationError(message);
                        setLogEntries((prev) => [
                            ...prev,
                            { time: "TIMEOUT", msg: `[ERR] ${message}`, type: "error" },
                        ]);
                        console.error("Validation polling stopped:", error);
                    }
                }
                // ✓ POLLING INTACT: polls /api/validate/[jobId]/status every 2000ms, stops when status === 'done' or 'error' (or 'failed')
            }, 2000);
        },
        [appendLiveProgress, clearStoredValidation, markValidationCompleted, router, pushLog, stopPolling],
    );

    useEffect(() => {
        return () => {
            stopPolling();
        };
    }, [stopPolling]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const sync = () => syncStoredValidationId();
        sync();
        window.localStorage.removeItem(COMPLETED_VALIDATION_ID_KEY);
        emitValidationStorageChange();
        window.addEventListener("storage", sync);
        window.addEventListener(VALIDATION_STORAGE_EVENT, sync);
        return () => {
            window.removeEventListener("storage", sync);
            window.removeEventListener(VALIDATION_STORAGE_EVENT, sync);
        };
    }, [emitValidationStorageChange, syncStoredValidationId]);

    useEffect(() => {
        if (typeof window === "undefined" || resumeCheckedRef.current) return;
        resumeCheckedRef.current = true;

        const savedId = window.localStorage.getItem(ACTIVE_VALIDATION_ID_KEY);
        if (!savedId) return;

        const savedIdea = window.localStorage.getItem(ACTIVE_VALIDATION_IDEA_KEY) || "";

        void fetch(`/api/validate/${savedId}/status`)
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error("Could not reconnect to saved validation");
                }
                return response.json() as Promise<ValidationStatusResponse>;
            })
            .then((data) => {
                const validation = data?.validation;
                const status = validation?.status || "";
                if (status && !["done", "failed", "error", "cancelled"].includes(status)) {
                    if (savedIdea) {
                        setIdea((currentIdea) => currentIdea || savedIdea);
                    }
                    setValidationError(null);
                    setActiveValidationWarning("A validation is already running. Wait for it to finish or cancel it first.");
                    setIsValidating(true);
                    if (validation) {
                        setActiveValidation(validation);
                        startTimeRef.current = validation.created_at
                            ? Date.parse(validation.created_at) || Date.now()
                            : Date.now();
                        lastStatusRef.current = validation.status;
                        lastProgressIdRef.current = 0;
                        setLogEntries([
                            { time: "00:00", msg: `[SYS] Reconnected to validation ${savedId.slice(0, 8)}…`, type: "info" },
                        ]);
                        appendLiveProgress(validation.report);
                    }
                    startPolling(savedId);
                    return;
                }

                clearStoredValidation();
                setActiveValidationWarning(null);
            })
            .catch(() => {
                clearStoredValidation();
                setActiveValidationWarning(null);
            });
    }, [appendLiveProgress, clearStoredValidation, startPolling]);

    /* auto-scroll terminal */
    useEffect(() => {
        if (termRef.current) {
            termRef.current.scrollTop = termRef.current.scrollHeight;
        }
    }, [logEntries]);

    useEffect(() => {
        if (!isValidating) return;
        const timer = setInterval(() => {
            setTerminalTick((tick) => tick + 1);
        }, 1000);
        return () => clearInterval(timer);
    }, [isValidating]);

    /* ── Launch validation ──────────────────────────────── */
    const handleCancelCurrentValidation = useCallback(async () => {
        const validationId = activeValidation?.id || storedActiveValidationId;
        if (!validationId || isCancelling) return;

        setIsCancelling(true);
        setValidationError(null);

        try {
            const response = await fetch(`/api/validate/${validationId}`, {
                method: "DELETE",
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(typeof payload?.error === "string" ? payload.error : "Could not cancel validation");
            }

            stopPolling();
            clearStoredValidation();
            setActiveValidation((current) => current ? { ...current, status: "cancelled" } : null);
            setIsValidating(false);
            setActiveValidationWarning("Validation cancelled. You can start a new one now.");
            lastStatusRef.current = "cancelled";
            lastProgressIdRef.current = 0;
            scrapingStartedAtRef.current = null;
            setLogEntries((prev) => [
                ...prev,
                { time: formatElapsedTime(Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000))), msg: "[SYS] Validation cancelled by user.", type: "muted" },
            ]);
        } catch (error) {
            setValidationError(error instanceof Error ? error.message : "Could not cancel validation.");
        } finally {
            setIsCancelling(false);
        }
    }, [activeValidation?.id, clearStoredValidation, isCancelling, stopPolling, storedActiveValidationId]);

    const handleValidate = async () => {
        if (!idea.trim()) return;
        if (!aiConfigChecked) {
            setValidationError("We are still checking your AI setup. Try again in a moment.");
            return;
        }
        if (configuredModels.length === 0) {
            setValidationError(null);
            setShowAiSetupGate(true);
            return;
        }
        if (selectedDepthLocked) {
            router.push("/dashboard/pricing");
            return;
        }
        if (typeof window !== "undefined" && window.localStorage.getItem(ACTIVE_VALIDATION_ID_KEY)) {
            setActiveValidationWarning("A validation is already running. Wait for it to finish or cancel it first.");
            return;
        }
        setIsValidating(true);
        setIsCancelling(false);
        setValidationError(null);
        setActiveValidationWarning(null);
        setActiveValidation(null);
        lastStatusRef.current = "";
        lastProgressIdRef.current = 0;
        scrapingStartedAtRef.current = null;
        startTimeRef.current = Date.now();
        setTerminalTick(0);
        setLogEntries([{ time: "00:00", msg: "[INIT] Validation pipeline activated", type: "info" }]);

        try {
            const r = await fetch("/api/validate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    idea: idea.trim(),
                    depth,
                    target: target.trim(),
                    pain_hypothesis: pain.trim(),
                    known_competitors: competitors.trim(),
                }),
            });
            const d = await r.json();
            if (!r.ok) {
                throw new Error(d.error || "Failed to start validation");
            }
            const jobId = d.job_id || d.validationId;
            if (jobId) {
                const validationId = d.validationId || jobId;
                persistActiveValidation(validationId, idea.trim());
                startPolling(validationId);
                setActiveValidation({
                    id: validationId,
                    idea_text: idea.trim(),
                    status: "starting",
                    verdict: "",
                    confidence: 0,
                    report: {},
                });
                setLogEntries((prev) => [
                    ...prev,
                    { time: "00:00", msg: `[SYS] Validation ${String(jobId).slice(0, 8)} queued`, type: "muted" },
                ]);
            } else {
                setIsValidating(false);
                setValidationError(d.error || "Failed to start validation");
            }
        } catch (error) {
            setIsValidating(false);
            setValidationError(error instanceof Error ? error.message : "Network error. Check your connection.");
        }
    };

    /* ── Derived state ──────────────────────────────────── */
    const currentStatus = activeValidation?.status || "";
    const scrapingElapsedSeconds = scrapingStartedAtRef.current
        ? Math.max(0, Math.floor((Date.now() - scrapingStartedAtRef.current) / 1000))
        : 0;
    const scrapingActivityPulse = Math.max(1, Math.floor(scrapingElapsedSeconds / 2) + 1 + terminalTick % 2);
    const statusIdx = STATUS_ORDER.indexOf(currentStatus);
    const dataSources = parsedReport.data_sources || {};
    const hasActiveAiConfig = configuredModels.length > 0;
    const aiConfigLoading = !aiConfigChecked;
    const aiSetupMessage = aiConfigLoading
        ? "Checking your AI setup..."
        : hasActiveAiConfig
            ? null
            : aiConfigError || "Set at least one active API key for the agent debating room.";

    /* Normalize status for phase matching — sub-statuses like "synthesizing (1/3 market)" */
    const issynth = currentStatus.startsWith("synthesizing") || currentStatus.startsWith("debating");
    const isdone = currentStatus === "done";

    const currentStageIndex = (() => {
        if (["starting", "queued", "decomposing", "decomposed"].includes(currentStatus)) return 0;
        if (["scraping", "scraped"].includes(currentStatus)) return 1;
        if (["analyzing_trends", "analyzing_competition"].includes(currentStatus)) return 2;
        if (issynth) return 3;
        if (isdone) return 4;
        return 0;
    })();

    /* pipeline phases for the status panel */
    const pipelinePhases = [
        { label: "Decompose", done: statusIdx > 3 || issynth || isdone, active: statusIdx >= 2 && statusIdx <= 3 && !issynth },
        { label: "Scrape", done: statusIdx > 5 || issynth || isdone, active: statusIdx >= 4 && statusIdx <= 5 && !issynth },
        { label: "Analyze", done: statusIdx > 7 || issynth || isdone, active: statusIdx >= 6 && statusIdx <= 7 && !issynth },
        { label: "Debate", done: isdone, active: issynth },
        { label: "Report", done: isdone, active: false },
    ];
    const validationDisabled = isValidating
        || !idea.trim()
        || Boolean(storedActiveValidationId)
        || selectedDepthLocked
        || aiConfigLoading;
    const validationCtaLabel = isValidating
        ? BUTTON_STAGES[currentStageIndex]?.label || "Processing..."
        : depth === "quick"
            ? "Run Quick Validation"
            : depth === "deep"
                ? "Run Deep Validation"
                : "Start Market Investigation";

    return (
        <div className="relative z-10 mx-auto max-w-[1120px] px-0 pt-2 pb-[120px] sm:pt-3">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6 sm:mb-8">
                <div className="section-kicker mb-3 sm:mb-4">Validate one idea</div>
                <h1 className="text-[26px] font-bold font-display tracking-tight-custom text-white sm:text-[30px] md:text-[38px]">
                    Decide if the idea deserves to be built.
                </h1>
                <p className="mt-2.5 max-w-[720px] text-[13px] leading-6 text-muted-foreground md:text-[14px] md:leading-7">
                    Describe one startup idea, the buyer, and the pain. CueIdea gathers proof from real discussions and turns it into a build, risky, or do not build decision with timing, competition, and next-step context.
                </p>
            </motion.div>

            {!isPremium && (
                <div className="mb-4 bento-cell rounded-[14px] border border-primary/15 bg-primary/5 p-4">
                    <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-primary">Beta access</div>
                    <p className="mt-2 text-sm text-foreground/85">
                        Quick Validation is available here. Deep Validation and Market Investigation stay premium because they use broader coverage, more sources, and a heavier synthesis pass.
                    </p>
                </div>
            )}

            {aiHealthWarning && (
                <div className="mb-4 bento-cell rounded-[14px] border border-risky/20 bg-risky/5 p-4">
                    <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-risky">Provider check</div>
                    <p className="mt-2 text-sm text-foreground/85">{aiHealthWarning}</p>
                    <div className="mt-3">
                        <Link
                            href={settingsHref}
                            className="inline-flex items-center gap-2 rounded-lg border border-risky/25 bg-risky/10 px-3 py-2 text-[11px] font-mono uppercase tracking-[0.12em] text-risky transition-colors hover:bg-risky/15"
                        >
                            <Settings className="h-3.5 w-3.5" />
                            Open Settings
                        </Link>
                    </div>
                </div>
            )}

            {validationError && (
                <div className="mb-4 bento-cell p-4 rounded-[14px] border border-dont/20 bg-dont/5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-dont mb-1">Validation Stalled</div>
                        <p className="text-sm text-foreground/85">{validationError}</p>
                    </div>
                    <div className="flex gap-2">
                        {activeValidation?.id && (
                            <button
                                onClick={() => {
                                    setValidationError(null);
                                    setIsValidating(true);
                                    startPolling(activeValidation.id);
                                }}
                                className="px-4 py-2 rounded-lg text-xs font-mono bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors"
                            >
                                Retry Polling
                            </button>
                        )}
                        <Link
                            href="/dashboard/reports"
                            className="px-4 py-2 rounded-lg text-xs font-mono bg-white/5 border border-white/10 text-foreground hover:bg-white/10 transition-colors"
                        >
                            Open Reports
                        </Link>
                    </div>
                </div>
            )}

            {showAiSetupGate && (
                <div
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4"
                    onClick={() => setShowAiSetupGate(false)}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 12 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        className="w-full max-w-[460px] rounded-[22px] border border-primary/20 bg-[#0d0a08] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-primary">
                                    Validation locked
                                </div>
                                <h3 className="mt-2 text-xl font-semibold text-white">
                                    Set at least one API key for the agent debating room.
                                </h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowAiSetupGate(false)}
                                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-mono text-muted-foreground transition-colors hover:border-white/20 hover:text-white"
                            >
                                Close
                            </button>
                        </div>

                        <p className="mt-3 text-sm leading-6 text-foreground/80">
                            CueIdea cannot start the debate, synthesis, or report pass until one active AI provider is connected in Settings.
                        </p>

                        <div className="mt-4 rounded-[16px] border border-white/8 bg-white/[0.03] p-4">
                            <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                What to do
                            </div>
                            <div className="mt-3 space-y-2 text-sm text-foreground/80">
                                <p>1. Open Settings</p>
                                <p>2. Add one provider API key</p>
                                <p>3. Mark it active</p>
                                <p>4. Come back here and run validation</p>
                            </div>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center gap-3">
                            <Link
                                href={settingsHref}
                                className="inline-flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/12 px-4 py-2.5 text-[11px] font-mono uppercase tracking-[0.14em] text-primary transition-colors hover:bg-primary/18"
                            >
                                <Settings className="h-4 w-4" />
                                Add API key
                            </Link>
                            <button
                                type="button"
                                onClick={() => setShowAiSetupGate(false)}
                                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-white/20 hover:text-white"
                            >
                                Maybe later
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {(activeValidation || isValidating) && (
                <ValidationProgressPane
                    status={currentStatus || (isValidating ? "starting" : "")}
                    progressEvents={progressEvents}
                    createdAt={activeValidation?.created_at}
                    platformWarnings={platformWarnings}
                    redditLabContext={parsedReport?.reddit_lab_context || null}
                    canCancel={!["done", "failed", "error", "cancelled"].includes(currentStatus || "")}
                    isCancelling={isCancelling}
                    onCancel={handleCancelCurrentValidation}
                />
            )}

            {(activeValidation || isValidating) && !["done", "failed", "error", "cancelled"].includes(currentStatus || "") && (
                <div className="mb-4 flex flex-col gap-3 rounded-[14px] border border-white/10 bg-black/20 p-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <div className="mb-1 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Need to stop?</div>
                        <p className="text-sm text-foreground/85">Cancel this validation if you want to change the idea, switch depth, or start over.</p>
                    </div>
                    {currentStatus !== "cancelled" ? (
                        <button
                            onClick={handleCancelCurrentValidation}
                            disabled={isCancelling}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-mono text-foreground transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isCancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            {isCancelling ? "Cancelling..." : "Cancel validation"}
                        </button>
                    ) : null}
                </div>
            )}

            {activeValidationWarning && (
                <div className="mb-4 bento-cell p-4 rounded-[14px] border border-primary/20 bg-primary/5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-primary mb-1">
                            {currentStatus === "cancelled" ? "Validation Stopped" : "Validation In Progress"}
                        </div>
                        <p className="text-sm text-foreground/85">{activeValidationWarning}</p>
                    </div>
                    <button
                        onClick={handleCancelCurrentValidation}
                        disabled={isCancelling}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-mono text-foreground transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isCancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        {isCancelling ? "Cancelling..." : "Cancel validation"}
                    </button>
                </div>
            )}

            {/* ── Bento Grid ─────────────────────────────────── */}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_332px]">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                    className="surface-panel p-4 sm:p-4 md:p-5"
                >
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-primary">
                                Founder workflow
                            </div>
                            <h2 className="mt-2 text-[22px] font-semibold text-white">Describe the bet you want to test.</h2>
                            <p className="mt-2 max-w-[640px] text-[13px] leading-6 text-muted-foreground">
                                Be concrete about the buyer, the repeated pain, and why this workflow matters. The sharper the setup, the sharper the recommendation.
                            </p>
                        </div>
                        <div className="verdict-badge">
                            <Terminal className="h-3 w-3" />
                            Decision run
                        </div>
                    </div>

                    <div className="surface-panel-soft focus-ring-orange rounded-[18px] p-4">
                        <label className="mb-3 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Describe your idea
                        </label>
                        <textarea
                            value={idea}
                            onChange={(e) => setIdea(e.target.value)}
                            disabled={isValidating}
                            placeholder="e.g. A tool that watches founder complaints across communities, groups repeated workflow pain, and tells me if the idea is strong enough to build."
                            className="min-h-[200px] w-full resize-none bg-transparent text-[14px] leading-6 text-foreground placeholder:text-muted-foreground/40 focus:outline-none font-mono sm:min-h-[232px] md:min-h-[272px] md:text-[15px] md:leading-7"
                        />
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="surface-panel-soft rounded-[16px] p-3.5">
                            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Target buyer
                            </label>
                            <input
                                value={target}
                                onChange={(e) => setTarget(e.target.value)}
                                disabled={isValidating}
                                placeholder="SaaS founders"
                                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none font-mono"
                            />
                        </div>

                        <div className="surface-panel-soft rounded-[16px] p-3.5">
                            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Known competitors
                            </label>
                            <input
                                value={competitors}
                                onChange={(e) => setCompetitors(e.target.value)}
                                disabled={isValidating}
                                placeholder="GummySearch, SparkToro, Exploding Topics"
                                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none font-mono"
                            />
                        </div>

                        <div className="surface-panel-soft rounded-[16px] p-3.5 md:col-span-2">
                            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Pain hypothesis
                            </label>
                            <textarea
                                value={pain}
                                onChange={(e) => setPain(e.target.value)}
                                disabled={isValidating}
                                placeholder="Manual validation is slow, fragmented, and too weak to justify building fast."
                                className="min-h-[110px] w-full resize-none bg-transparent text-sm leading-7 text-foreground placeholder:text-muted-foreground/40 focus:outline-none font-mono"
                            />
                        </div>
                    </div>

                    <div className="mt-4 xl:hidden">
                        <div className="mb-3 text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-primary">
                            Validation depth
                        </div>
                        <div className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1">
                            {VALIDATION_DEPTHS.map((opt) => {
                                const isActive = depth === opt.mode;
                                const Icon = opt.mode === "quick" ? Search : opt.mode === "deep" ? FlaskConical : Telescope;
                                return (
                                    <button
                                        key={`mobile-${opt.mode}`}
                                        onClick={() => setDepth(opt.mode)}
                                        disabled={isValidating}
                                        className={`min-w-[200px] snap-start rounded-[16px] border px-3.5 py-3 text-left transition-all disabled:opacity-40 ${
                                            isActive
                                                ? "border-primary/35 bg-primary/12 text-white shadow-[0_0_22px_rgba(255,69,0,0.12)]"
                                                : "border-white/8 bg-white/[0.03] text-muted-foreground"
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${isActive ? "bg-primary/15 text-primary" : "bg-white/[0.05] text-muted-foreground"}`}>
                                                <Icon className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className={`text-[13px] font-semibold ${isActive ? "text-white" : "text-foreground"}`}>{opt.label}</div>
                                                <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                                    {opt.paceLabel}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        {selectedDepthLocked && (
                            <p className="mt-3 text-xs text-muted-foreground">
                                {selectedDepthOption.label} needs premium. Switch to Quick Validation or upgrade to run the heavier sweep.
                            </p>
                        )}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 xl:hidden">
                        <div className="surface-panel-soft p-3.5 text-center">
                            <div
                                className="font-mono text-[26px] font-extrabold leading-none text-primary tabular-nums"
                                style={{ textShadow: "0 0 24px hsla(16,100%,50%,0.32)" }}
                            >
                                {activeValidation
                                    ? activeValidation.posts_found ||
                                      Object.values(dataSources as Record<string, number>).reduce((a, b) => a + Number(b), 0) ||
                                      "-"
                                    : "-"}
                            </div>
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Posts found</p>
                        </div>
                        <div className="surface-panel-soft p-3.5 text-center">
                            <div
                                className="font-mono text-[26px] font-extrabold leading-none text-primary tabular-nums"
                                style={{ textShadow: "0 0 24px hsla(16,100%,50%,0.32)" }}
                            >
                                {activeValidation ? Object.keys(dataSources).length || "-" : "-"}
                            </div>
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Platforms</p>
                        </div>
                    </div>
                </motion.div>

                <div className="hidden xl:flex xl:flex-col xl:gap-4">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="surface-panel p-4"
                    >
                        <div className="mb-4">
                            <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-primary">
                                Decision
                            </div>
                            <h3 className="mt-2 text-lg font-semibold text-white">{selectedDepthOption.label}</h3>
                            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
                                {selectedDepthOption.uiCopy}
                            </p>
                        </div>

                        <motion.button
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.12 }}
                            onClick={handleValidate}
                            disabled={validationDisabled}
                            whileHover={{ scale: isValidating ? 1 : 1.01, y: isValidating ? 0 : -1 }}
                            whileTap={{ scale: isValidating ? 1 : 0.99 }}
                            className="pulse-button w-full justify-center text-sm disabled:cursor-not-allowed disabled:opacity-50"
                            data-track-event="validate_cta_click"
                            data-track-scope="product"
                            data-track-label="launch validation"
                        >
                            {isValidating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5 fill-white" />}
                            {validationCtaLabel}
                        </motion.button>

                        <p className="mt-3 text-center text-[11px] font-mono text-muted-foreground">
                            {storedActiveValidationId
                                ? "A validation is already running for this account."
                                : aiSetupMessage
                                    ? aiSetupMessage
                                : selectedDepthLocked
                                    ? `${selectedDepthOption.label} needs premium.`
                                    : "You will get a report with evidence, timing, competition, and the next move."}
                        </p>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.14 }}
                        className="surface-panel p-4"
                    >
                        <div className="mb-4">
                            <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-primary">
                                Validation depth
                            </div>
                            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
                                Choose how much coverage and rigor CueIdea should use for this validation.
                            </p>
                        </div>

                        <div className="space-y-2">
                            {VALIDATION_DEPTHS.map((opt) => {
                                const isActive = depth === opt.mode;
                                const Icon = opt.mode === "quick" ? Search : opt.mode === "deep" ? FlaskConical : Telescope;
                                return (
                                    <button
                                        key={opt.mode}
                                        onClick={() => setDepth(opt.mode)}
                                        disabled={isValidating}
                                        className={`w-full rounded-[15px] border px-3.5 py-2.5 text-left transition-all disabled:opacity-40 ${
                                            isActive
                                                ? "border-primary/35 bg-primary/12 text-white shadow-[0_0_22px_rgba(255,69,0,0.12)]"
                                                : "border-white/8 bg-white/[0.03] text-muted-foreground hover:border-white/14 hover:bg-white/[0.05]"
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${isActive ? "bg-primary/15 text-primary" : "bg-white/[0.05] text-muted-foreground"}`}>
                                                <Icon className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className={`text-[13px] font-semibold ${isActive ? "text-white" : "text-foreground"}`}>{opt.label}</div>
                                                <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                                                    {opt.paceLabel}
                                                </div>
                                            </div>
                                        </div>
                                        {opt.premiumRequired && !isPremium ? (
                                            <div className="mt-2 text-[10px] font-mono uppercase tracking-[0.12em] text-risky">
                                                Premium
                                            </div>
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                        {selectedDepthLocked ? (
                            <Link
                                href="/dashboard/pricing"
                                className="mt-3 inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-primary hover:text-primary/80"
                            >
                                Unlock {selectedDepthOption.label}
                            </Link>
                        ) : null}
                    </motion.div>

                    <div className="grid grid-cols-2 gap-3">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.16 }}
                            className="surface-panel-soft p-3.5 text-center"
                        >
                            <div
                                className="font-mono text-[28px] font-extrabold leading-none text-primary tabular-nums"
                                style={{ textShadow: "0 0 24px hsla(16,100%,50%,0.32)" }}
                            >
                                {activeValidation
                                    ? activeValidation.posts_found ||
                                      Object.values(dataSources as Record<string, number>).reduce((a, b) => a + Number(b), 0) ||
                                      "—"
                                    : "—"}
                            </div>
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Posts found</p>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.18 }}
                            className="surface-panel-soft p-3.5 text-center"
                        >
                            <div
                                className="font-mono text-[28px] font-extrabold leading-none text-primary tabular-nums"
                                style={{ textShadow: "0 0 24px hsla(16,100%,50%,0.32)" }}
                            >
                                {activeValidation ? Object.keys(dataSources).length || "—" : "—"}
                            </div>
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Platforms</p>
                        </motion.div>
                    </div>
                </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="surface-panel p-4"
                >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3">Active Agents</p>
                    {configuredModels.length > 0 ? (
                        <div className="space-y-2.5">
                            {configuredModels.slice(0, 3).map((m: string) => {
                                const active = isValidating || activeValidation?.status === "done";
                                return (
                                    <div key={m} className="flex items-center gap-2 rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
                                        <span
                                            className={`h-[6px] w-[6px] rounded-full ${active ? "bg-build" : "bg-muted-foreground/30"}`}
                                            style={active ? { animation: "pulse-green 2s ease infinite" } : {}}
                                        />
                                        <span className="text-sm font-medium text-foreground">{m}</span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="flex min-h-[148px] flex-col items-center justify-center gap-2 text-center">
                            <Settings className="w-4 h-4 text-muted-foreground/40" />
                            <p className="max-w-[220px] text-[11px] font-mono text-muted-foreground">
                                Set one active API key to unlock the agent debating room.
                            </p>
                            <Link
                                href={settingsHref}
                                className="text-[11px] font-mono text-muted-foreground hover:text-primary transition-colors"
                            >
                                Open Settings →
                            </Link>
                        </div>
                    )}
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.24 }}
                    className="surface-panel p-4 overflow-hidden"
                >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3">
                        Recent Validations
                    </p>
                    {history.length > 0 ? (
                        <div className="space-y-2.5">
                            {history.map((h) => (
                                <Link key={h.id} href={`/dashboard/reports/${h.id}`} className="block group">
                                    <div className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex min-w-0 flex-1 items-center gap-2">
                                                <span
                                                    className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-bold uppercase border shrink-0 ${getVerdictBg(h.verdict)} ${getVerdictColor(h.verdict)}`}
                                                >
                                                    {(h.verdict || "?").length > 7
                                                        ? (h.verdict || "?").slice(0, 5)
                                                        : h.verdict}
                                                </span>
                                                <span className="truncate text-[11px] text-foreground/70 group-hover:text-primary transition-colors">
                                                    {h.idea_text.length > 42
                                                        ? h.idea_text.slice(0, 42) + "…"
                                                        : h.idea_text}
                                                </span>
                                            </div>
                                            <span className="text-[11px] font-mono text-muted-foreground/50 whitespace-nowrap">
                                                {h.confidence}%
                                            </span>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <div className="flex min-h-[148px] flex-col items-center justify-center gap-1 opacity-40">
                            <Clock className="w-4 h-4 text-muted-foreground" />
                            <span className="text-[11px] font-mono text-muted-foreground">No validations yet</span>
                        </div>
                    )}
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.28 }}
                    className="surface-panel p-4"
                >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3">Pipeline</p>
                    <div className="space-y-2.5">
                        {pipelinePhases.map((phase, i) => (
                            <div key={i} className="flex items-center gap-2.5 rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
                                <div
                                    className={`h-[8px] w-[8px] rounded-full flex-shrink-0 transition-all duration-300 ${
                                        phase.done
                                            ? "bg-build shadow-[0_0_6px_hsla(142,76%,45%,0.5)]"
                                            : phase.active
                                              ? "bg-primary shadow-[0_0_8px_hsla(16,100%,50%,0.5)] animate-pulse"
                                              : "bg-muted-foreground/20"
                                    }`}
                                />
                                <span
                                    className={`text-[11px] font-mono transition-colors ${
                                        phase.done
                                            ? "text-build"
                                            : phase.active
                                              ? "text-primary font-semibold"
                                              : "text-muted-foreground/40"
                                    }`}
                                >
                                    {phase.label}
                                </span>
                                {phase.done && <CheckCircle2 className="ml-auto h-3 w-3 text-build" />}
                                {phase.active && <Loader2 className="ml-auto h-3 w-3 animate-spin text-primary" />}
                            </div>
                        ))}
                    </div>
                </motion.div>
            </div>

            <div
                className="fixed inset-x-3 z-40 xl:hidden"
                style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 86px)" }}
            >
                <div className="surface-panel flex items-center gap-3 rounded-[18px] px-3 py-2.5 sm:px-3.5">
                    <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-primary">
                            {VALIDATION_DEPTHS.find((option) => option.mode === depth)?.label
                                || VALIDATION_DEPTHS.find((option) => option.mode === DEFAULT_DEPTH)?.label
                                || "Quick Validation"}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            {storedActiveValidationId
                                ? "A validation is already running for this account."
                                : aiSetupMessage
                                    ? aiSetupMessage
                                : selectedDepthLocked
                                    ? `${selectedDepthOption.label} needs premium.`
                                    : "Run this validation with one tap."}
                        </div>
                    </div>
                    <button
                        onClick={handleValidate}
                        disabled={validationDisabled}
                        className="pulse-button min-h-[50px] shrink-0 justify-center px-[18px] text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
                        data-track-event="validate_cta_click_mobile"
                        data-track-scope="product"
                        data-track-label="mobile launch validation"
                    >
                        {isValidating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5 fill-white" />}
                        {validationCtaLabel}
                    </button>
                </div>
            </div>

            {/* Live run log */}
            {(activeValidation || isValidating) && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 terminal-card rounded-[14px] p-4"
                >
                    <div
                        className="flex items-center justify-between mb-3 px-1 cursor-pointer select-none"
                        onClick={() => setTermExpanded(prev => !prev)}
                    >
                        <div className="flex items-center gap-2">
                            <div className="flex gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-dont/60" />
                                <span className="w-2 h-2 rounded-full bg-risky/60" />
                                <span className="w-2 h-2 rounded-full bg-build/60" />
                            </div>
                            <span className="text-[11px] font-mono text-muted-foreground ml-2">Run Log</span>
                            <span className="text-[11px] font-mono text-muted-foreground/50 ml-1">
                                {termExpanded ? "click to collapse" : "click to expand"}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Terminal className="w-3 h-3 text-muted-foreground" />
                            {termExpanded
                                ? <Minimize2 className="w-3 h-3 text-muted-foreground hover:text-primary transition-colors" />
                                : <Maximize2 className="w-3 h-3 text-muted-foreground hover:text-primary transition-colors" />
                            }
                        </div>
                    </div>
                    <div
                        ref={termRef}
                        className={`overflow-y-auto space-y-1 text-[11px] font-mono leading-relaxed transition-all duration-300 ${
                            termExpanded ? "h-[70vh]" : "h-[200px]"
                        }`}
                    >
                        {currentStatus === "scraping" && (
                            <div className="mb-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                                            Searching across Reddit, Hacker News, Product Hunt, Indie Hackers, and deeper repo/review lanes when relevant...
                                        </div>
                                        <div className="mt-1 text-[10px] text-muted-foreground">
                                            Live activity pulse: {scrapingActivityPulse}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[12px] font-semibold text-foreground tabular-nums">
                                            {formatElapsedTime(scrapingElapsedSeconds)}
                                        </div>
                                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                            Phase 2 elapsed
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {logEntries.map((entry, i) => {
                            /* Rich debate card for agent entries */
                            if (entry.type === "debate" && (entry.msg.includes("[AGENT") || entry.msg.includes("[DEBATE]") || entry.msg.includes("[SCAN]"))) {
                                const isAgent = entry.msg.includes("[AGENT");
                                const isDebate = entry.msg.includes("[DEBATE]");
                                const roleMatch = entry.msg.match(/AGENT \d+ · ([^\]]+)/);
                                const roleName = roleMatch ? roleMatch[1] : isDebate ? "Consensus Engine" : "Signal Scanner";

                                const roleColors: Record<string, string> = {
                                    "Market Analyst": "border-l-blue-400 bg-blue-500/5",
                                    "Strategist": "border-l-green-400 bg-green-500/5",
                                    "GTM Planner": "border-l-purple-400 bg-purple-500/5",
                                    "Consensus Engine": "border-l-primary bg-primary/5",
                                    "Signal Scanner": "border-l-amber-400 bg-amber-500/5",
                                };
                                const roleIcons: Record<string, string> = {
                                    "Market Analyst": "AN",
                                    "Strategist": "ST",
                                    "GTM Planner": "GTM",
                                    "Consensus Engine": "AI",
                                    "Signal Scanner": "SC",
                                };
                                const cardStyle = roleColors[roleName] || "border-l-white/20 bg-white/5";
                                const icon = roleIcons[roleName] || "AI";

                                return (
                                    <motion.div
                                        key={i}
                                        initial={{ opacity: 0, x: -12 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ duration: 0.3 }}
                                        className={`border-l-2 rounded-r-lg px-3 py-2.5 my-1.5 ${cardStyle}`}
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm">{icon}</span>
                                            <span className="text-[11px] font-bold uppercase tracking-widest text-foreground">
                                                {roleName}
                                            </span>
                                            <span className="text-muted-foreground/30 text-[11px] ml-auto">{entry.time}</span>
                                        </div>
                                        <p className="text-[11px] text-foreground/70 leading-relaxed">
                                            {entry.msg.replace(/\[AGENT \d+ · [^\]]+\]\s*/, "").replace(/\[DEBATE\]\s*/, "").replace(/\[SCAN\]\s*/, "")}
                                        </p>
                                    </motion.div>
                                );
                            }

                            /* Standard log line */
                            return (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className={
                                        entry.type === "success"
                                            ? "text-build"
                                            : entry.type === "error"
                                              ? "text-dont"
                                              : entry.type === "info"
                                                ? "text-foreground/70"
                                                : "text-muted-foreground"
                                    }
                                >
                                    <span className="text-muted-foreground/40 mr-2">[{entry.time}]</span>
                                    {entry.msg}
                                </motion.div>
                            );
                        })}
                        {isValidating && <span className="inline-block w-1.5 h-3 bg-primary animate-terminal-blink" />}
                    </div>
                </motion.div>
            )}
        </div>
    );
};

export default ValidatePage;
