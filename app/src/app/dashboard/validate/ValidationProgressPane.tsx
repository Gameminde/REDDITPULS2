"use client";

import { CheckCircle2, Circle, Clock3, Loader2, MessageSquare, Rocket, Search, ShieldAlert } from "lucide-react";

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
};

type SourceKey =
    | "reddit"
    | "reddit_connected"
    | "reddit_comment"
    | "hackernews"
    | "producthunt"
    | "indiehackers"
    | "g2_review"
    | "job_posting";

const SOURCE_ORDER: Array<{ key: SourceKey; label: string; color: string }> = [
    { key: "reddit", label: "Reddit", color: "text-orange-300" },
    { key: "reddit_connected", label: "Connected Reddit", color: "text-orange-200" },
    { key: "reddit_comment", label: "Comments", color: "text-orange-200" },
    { key: "hackernews", label: "Hacker News", color: "text-amber-300" },
    { key: "producthunt", label: "Product Hunt", color: "text-rose-300" },
    { key: "indiehackers", label: "Indie Hackers", color: "text-sky-300" },
    { key: "g2_review", label: "G2", color: "text-orange-300" },
    { key: "job_posting", label: "Jobs", color: "text-emerald-300" },
];

function normalizeWarning(value: string | Record<string, unknown>) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        return String(record.issue || record.error_detail || record.warning || record.platform || "");
    }
    return "";
}

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
    if (normalized === "failed" || normalized === "error") return "Validation failed";
    return "Processing";
}

function inferEta(status: string, events: ValidationProgressEvent[], createdAt?: string) {
    const normalized = (status || "").toLowerCase();
    const latestRound = [...events]
        .reverse()
        .find((event) => typeof event.round === "number");
    if (latestRound && normalized.startsWith("debating")) {
        const totalRounds = latestRound.total_rounds || 2;
        return `Round ${latestRound.round} of ${totalRounds}`;
    }

    const startedAt = createdAt ? Date.parse(createdAt) : NaN;
    const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;

    if (normalized.startsWith("scrap")) {
        const completedSources = events.filter((event) => event.phase === "scraping" && event.source).length;
        const remaining = Math.max(15, 60 - elapsedSeconds, (SOURCE_ORDER.length - completedSources) * 8);
        return `Estimated wait: ~${remaining} more seconds`;
    }
    if (normalized.startsWith("synthesizing")) return "Estimated wait: ~30 more seconds";
    if (normalized.startsWith("analyzing")) return "Estimated wait: ~20 more seconds";
    if (normalized === "queued" || normalized === "starting" || normalized.startsWith("decompos")) {
        return "Estimated wait: ~60 more seconds";
    }
    if (normalized === "done") return "Redirecting to report…";
    if (normalized === "failed" || normalized === "error") return "Check details below and retry";
    return "Working…";
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
    return event.message || "updated";
}

export function ValidationProgressPane({
    status,
    progressEvents,
    createdAt,
    platformWarnings = [],
    redditLabContext = null,
}: ValidationProgressPaneProps) {
    const sourceEvents = new Map<SourceKey, ValidationProgressEvent>();
    for (const event of progressEvents) {
        if (event.source && SOURCE_ORDER.some((item) => item.key === event.source)) {
            sourceEvents.set(event.source as SourceKey, event);
        }
    }

    const warningText = platformWarnings.map(normalizeWarning).filter(Boolean);
    const latestEvents = [...progressEvents]
        .filter((event) => event.message)
        .slice(-4)
        .reverse();

    const phaseLabel = inferPhaseLabel(status);
    const etaLabel = inferEta(status, progressEvents, createdAt);
    const scrapingActive = (status || "").toLowerCase().startsWith("scrap");
    let activeAssigned = false;

    return (
        <div className="bento-cell rounded-[16px] p-5 mb-6 border border-primary/15 bg-primary/5">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                    <div className="flex items-center gap-2 text-primary">
                        <Search className="w-4 h-4" />
                        <span className="text-[11px] font-mono uppercase tracking-[0.12em]">Validating your idea</span>
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-white">Live source progress</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{phaseLabel}</p>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono text-muted-foreground">
                    <Clock3 className="w-3.5 h-3.5" />
                    <span>{etaLabel}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-5">
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
                                        <ShieldAlert className="w-4 h-4 text-dont" />
                                    ) : isDone ? (
                                        <CheckCircle2 className="w-4 h-4 text-build" />
                                    ) : isActive ? (
                                        <Loader2 className="w-4 h-4 text-primary animate-spin" />
                                    ) : (
                                        <Circle className="w-4 h-4 text-muted-foreground/50" />
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span className="text-[11px] font-mono uppercase tracking-[0.12em]">Recent events</span>
                    </div>
                    <div className="mt-3 space-y-2">
                        {latestEvents.length > 0 ? latestEvents.map((event, index) => (
                            <div key={`${event.ts || index}-${index}`} className="text-xs text-foreground/80">
                                {event.message}
                            </div>
                        )) : (
                            <div className="text-xs text-muted-foreground">Waiting for the first platform update…</div>
                        )}
                    </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Rocket className="w-3.5 h-3.5" />
                        <span className="text-[11px] font-mono uppercase tracking-[0.12em]">Current phase</span>
                    </div>
                    <div className="mt-3 text-sm text-white">{phaseLabel}</div>
                    <p className="mt-2 text-xs text-muted-foreground">{etaLabel}</p>
                </div>
            </div>

            {redditLabContext?.enabled ? (
                <div className="mt-4 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-primary">
                        <Rocket className="w-3.5 h-3.5" />
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
