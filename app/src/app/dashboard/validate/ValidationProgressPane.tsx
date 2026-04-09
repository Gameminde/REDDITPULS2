"use client";

import { CheckCircle2, Circle, Clock3, Loader2, MessageSquare, Rocket, Search, ShieldAlert } from "lucide-react";
import { sanitizeValidationProgressMessage, summarizeValidationCoverage } from "@/lib/validation-coverage";

export type ValidationProgressEvent = {
    ts?: number;
    phase?: string;
    source?: string;
    count?: number;
    pain_count?: number;
    message?: string;
    round?: number;
    total_rounds?: number;
    changed?: boolean;
    role?: string;
};

type ValidationProgressPaneProps = {
    status: string;
    progressEvents: ValidationProgressEvent[];
    createdAt?: string;
    platformWarnings?: Array<string | Record<string, unknown>>;
    redditLabContext?: Record<string, unknown> | null;
    canCancel?: boolean;
    isCancelling?: boolean;
    onCancel?: (() => void) | null;
};

type SourceKey =
    | "reddit"
    | "reddit_connected"
    | "reddit_comment"
    | "hackernews"
    | "producthunt"
    | "indiehackers"
    | "g2_review"
    | "job_posting"
    | "db_history";

const SOURCE_ORDER: Array<{ key: SourceKey; label: string; color: string }> = [
    { key: "reddit", label: "Reddit", color: "text-orange-300" },
    { key: "reddit_connected", label: "Connected Reddit", color: "text-orange-200" },
    { key: "reddit_comment", label: "Comments", color: "text-orange-200" },
    { key: "hackernews", label: "Hacker News", color: "text-amber-300" },
    { key: "producthunt", label: "Product Hunt", color: "text-rose-300" },
    { key: "indiehackers", label: "Indie Hackers", color: "text-sky-300" },
    { key: "g2_review", label: "G2", color: "text-orange-300" },
    { key: "job_posting", label: "Jobs", color: "text-emerald-300" },
    { key: "db_history", label: "DB history", color: "text-violet-300" },
];

function inferPhaseLabel(status: string) {
    const normalized = (status || "").toLowerCase();
    if (normalized === "queued" || normalized === "starting") return "Waiting for execution slot";
    if (normalized.startsWith("decompos")) return "Decomposing idea";
    if (normalized.startsWith("scrap")) return "Scraping platforms";
    if (normalized.startsWith("analyzing_trends")) return "Analyzing market timing";
    if (normalized.startsWith("analyzing_competition")) return "Analyzing competition";
    if (normalized.startsWith("synthesizing")) return "Synthesizing report";
    if (normalized.startsWith("debating")) return "AI debate in progress";
    if (normalized === "done") return "Validation complete";
    if (normalized === "cancelled") return "Validation cancelled";
    if (normalized === "failed" || normalized === "error") return "Validation failed";
    return "Processing";
}

function inferProgressHint(status: string, events: ValidationProgressEvent[]) {
    const normalized = (status || "").toLowerCase();
    const latestRound = [...events]
        .reverse()
        .find((event) => typeof event.round === "number");

    if (latestRound && normalized.startsWith("debating")) {
        const totalRounds = latestRound.total_rounds || 2;
        return `Round ${latestRound.round} of ${totalRounds}`;
    }

    if (normalized.startsWith("scrap")) {
        const completedSources = events.filter((event) => event.phase === "scraping" && event.source).length;
        return completedSources > 0
            ? `Scanning source lanes · ${completedSources} updated`
            : "Scanning live sources now";
    }
    if (normalized.startsWith("synthesizing")) return "Turning the evidence into a report";
    if (normalized.startsWith("analyzing")) return "Pressure-testing the market signal";
    if (normalized === "queued" || normalized === "starting" || normalized.startsWith("decompos")) {
        return "Framing the validation run";
    }
    if (normalized === "done") return "Redirecting to report...";
    if (normalized === "cancelled") return "Stopped by you";
    if (normalized === "failed" || normalized === "error") return "Check details below and retry";
    return "Working...";
}

function formatSourceDetail(event?: ValidationProgressEvent) {
    if (!event) return "waiting";
    const count = typeof event.count === "number" ? event.count : null;
    const painCount = typeof event.pain_count === "number" ? event.pain_count : null;

    if (count != null && painCount != null && painCount > 0) {
        return `${count} items · ${painCount} with pain`;
    }
    if (count != null) {
        return `${count} items`;
    }
    return sanitizeValidationProgressMessage(event.message || "", event.source) || "updated";
}

export function ValidationProgressPane({
    status,
    progressEvents,
    createdAt: _createdAt,
    platformWarnings = [],
    redditLabContext = null,
    canCancel = false,
    isCancelling = false,
    onCancel = null,
}: ValidationProgressPaneProps) {
    const sourceEvents = new Map<SourceKey, ValidationProgressEvent>();
    for (const event of progressEvents) {
        if (event.source && SOURCE_ORDER.some((item) => item.key === event.source)) {
            sourceEvents.set(event.source as SourceKey, event);
            continue;
        }
        const message = String(event.message || "").toLowerCase();
        if (message.includes("recent db history") || message.includes("recent database history")) {
            sourceEvents.set("db_history", { ...event, source: "db_history" });
        }
    }

    const coverage = summarizeValidationCoverage({
        platformWarnings,
        progressLog: progressEvents as unknown[],
    });
    const warningText = coverage.warnings.map((warning) => warning.issue).filter(Boolean);
    const latestEvents = [...progressEvents]
        .filter((event) => sanitizeValidationProgressMessage(event.message || "", event.source))
        .slice(-4)
        .reverse();

    const phaseLabel = inferPhaseLabel(status);
    const progressHint = inferProgressHint(status, progressEvents);
    const scrapingActive = (status || "").toLowerCase().startsWith("scrap");
    let activeAssigned = false;

    return (
        <div className="bento-cell mb-6 rounded-[16px] border border-primary/15 bg-primary/5 p-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                    <div className="flex items-center gap-2 text-primary">
                        <Search className="h-4 w-4" />
                        <span className="text-[11px] font-mono uppercase tracking-[0.12em]">Validation run</span>
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-white">Evidence scan</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{phaseLabel}</p>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    <span>{progressHint}</span>
                </div>
            </div>

            {canCancel && onCancel ? (
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Need to stop?</div>
                        <p className="mt-1 text-sm text-foreground/85">Cancel this validation if you want to change the idea, switch depth, or start over.</p>
                    </div>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isCancelling}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-mono text-foreground transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isCancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        {isCancelling ? "Cancelling..." : "Cancel validation"}
                    </button>
                </div>
            ) : null}

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {SOURCE_ORDER.map((source) => {
                    const event = sourceEvents.get(source.key);
                    const warning = warningText.find((item) => item.toLowerCase().includes(source.label.toLowerCase()) || item.toLowerCase().includes(source.key.replace("_", "")));
                    const isFailed = Boolean(warning);
                    const isDone = Boolean(event) && !isFailed;
                    const isActive = scrapingActive && !isDone && !isFailed && !activeAssigned;
                    if (isActive) activeAssigned = true;

                    return (
                        <div key={source.key} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className={`text-[11px] font-mono uppercase tracking-[0.12em] ${source.color}`}>{source.label}</div>
                                    <div className="mt-2 text-sm text-foreground/85">
                                        {isFailed ? warning : formatSourceDetail(event)}
                                    </div>
                                </div>
                                <div className="shrink-0">
                                    {isFailed ? (
                                        <ShieldAlert className="h-4 w-4 text-dont" />
                                    ) : isDone ? (
                                        <CheckCircle2 className="h-4 w-4 text-build" />
                                    ) : isActive ? (
                                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                    ) : (
                                        <Circle className="h-4 w-4 text-muted-foreground/50" />
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {coverage.summary ? (
                <div className={`mt-4 rounded-xl border px-4 py-3 ${coverage.status === "degraded" ? "border-amber-500/20 bg-amber-500/8" : "border-white/10 bg-black/20"}`}>
                    <div className={`text-[11px] font-mono uppercase tracking-[0.12em] ${coverage.status === "degraded" ? "text-amber-300" : "text-muted-foreground"}`}>
                        {coverage.status === "degraded" ? "Coverage update" : "Supporting context"}
                    </div>
                    <p className="mt-2 text-sm text-foreground/85">{coverage.summary}</p>
                </div>
            ) : null}

            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span className="text-[11px] font-mono uppercase tracking-[0.12em]">Recent events</span>
                    </div>
                    <div className="mt-3 space-y-2">
                        {latestEvents.length > 0 ? latestEvents.map((event, index) => (
                            <div key={`${event.ts || index}-${index}`} className="text-xs text-foreground/80">
                                {sanitizeValidationProgressMessage(event.message || "", event.source)}
                            </div>
                        )) : (
                            <div className="text-xs text-muted-foreground">Waiting for the first platform update...</div>
                        )}
                    </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Rocket className="h-3.5 w-3.5" />
                        <span className="text-[11px] font-mono uppercase tracking-[0.12em]">Current phase</span>
                    </div>
                    <div className="mt-3 text-sm text-white">{phaseLabel}</div>
                    <p className="mt-2 text-xs text-muted-foreground">{progressHint}</p>
                </div>
            </div>

            {redditLabContext?.enabled ? (
                <div className="mt-4 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-primary">
                        <Rocket className="h-3.5 w-3.5" />
                        <span className="text-[11px] font-mono uppercase tracking-[0.12em]">Reddit lab context</span>
                    </div>
                    <div className="mt-2 text-xs text-foreground/80">
                        {String(redditLabContext.reddit_username || "Connected Reddit")}
                        {redditLabContext.source_pack_name ? ` using ${String(redditLabContext.source_pack_name)}` : ""}
                        {redditLabContext.use_connected_context ? " · connected API lane" : ""}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
