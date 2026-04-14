import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ScraperRuntimeSeverity = "info" | "warning" | "error";

export type ScraperRuntimeUnitState = {
    name: string;
    available: boolean;
    activeState: string;
    subState: string;
    result: string | null;
    execMainStatus: number | null;
    activeEnterTimestamp: string | null;
    stateChangeTimestamp: string | null;
    error: string | null;
};

export type ScraperRuntimeLogEvent = {
    id: string;
    at: string | null;
    line: string;
    severity: ScraperRuntimeSeverity;
};

export type ScraperRuntimeLogSnapshot = {
    path: string;
    exists: boolean;
    readable: boolean;
    sizeBytes: number;
    updatedAt: string | null;
    lastHeartbeatAt: string | null;
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    runInProgress: boolean;
    lastLine: string | null;
    summaryLine: string | null;
    highlights: ScraperRuntimeLogEvent[];
    tailLines: string[];
    error: string | null;
};

export type ScraperRuntimeStatus = {
    state: "running" | "idle" | "failed" | "stale" | "unavailable";
    label: string;
    detail: string;
};

export type ScraperRuntimeMonitor = {
    available: boolean;
    host: string;
    platform: string;
    service: ScraperRuntimeUnitState;
    timer: ScraperRuntimeUnitState;
    log: ScraperRuntimeLogSnapshot;
    status: ScraperRuntimeStatus;
};

function parseSystemdKeyValue(output: string) {
    const values = new Map<string, string>();
    for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const pivot = line.indexOf("=");
        if (pivot === -1) continue;
        values.set(line.slice(0, pivot), line.slice(pivot + 1));
    }
    return values;
}

async function readSystemdUnitState(name: string): Promise<ScraperRuntimeUnitState> {
    if (process.platform !== "linux") {
        return {
            name,
            available: false,
            activeState: "unavailable",
            subState: "unavailable",
            result: null,
            execMainStatus: null,
            activeEnterTimestamp: null,
            stateChangeTimestamp: null,
            error: "systemd checks only run on Linux",
        };
    }

    try {
        const { stdout } = await execFileAsync("systemctl", [
            "show",
            "-p",
            "ActiveState",
            "-p",
            "SubState",
            "-p",
            "Result",
            "-p",
            "ExecMainStatus",
            "-p",
            "ActiveEnterTimestamp",
            "-p",
            "StateChangeTimestamp",
            name,
        ], { timeout: 5000, windowsHide: true });
        const parsed = parseSystemdKeyValue(String(stdout || ""));
        const execMainStatus = Number(parsed.get("ExecMainStatus") || "");

        return {
            name,
            available: true,
            activeState: parsed.get("ActiveState") || "unknown",
            subState: parsed.get("SubState") || "unknown",
            result: parsed.get("Result") || null,
            execMainStatus: Number.isFinite(execMainStatus) ? execMainStatus : null,
            activeEnterTimestamp: parsed.get("ActiveEnterTimestamp") || null,
            stateChangeTimestamp: parsed.get("StateChangeTimestamp") || null,
            error: null,
        };
    } catch (error) {
        return {
            name,
            available: false,
            activeState: "unknown",
            subState: "unknown",
            result: null,
            execMainStatus: null,
            activeEnterTimestamp: null,
            stateChangeTimestamp: null,
            error: error instanceof Error ? error.message : "Unable to inspect systemd unit",
        };
    }
}

async function readTailLines(path: string, maxLines = 80, maxBytes = 128 * 1024) {
    const handle = await open(path, "r");
    try {
        const stats = await handle.stat();
        const bytesToRead = Math.min(stats.size, maxBytes);
        const buffer = Buffer.alloc(bytesToRead);
        await handle.read(buffer, 0, bytesToRead, Math.max(0, stats.size - bytesToRead));
        return {
            stats,
            lines: buffer.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-maxLines),
        };
    } finally {
        await handle.close();
    }
}

function parseLogTimestamp(line: string) {
    const match = line.match(/^\[([0-9]{4}-[0-9]{2}-[0-9]{2}T[^\\]]+Z)\]/);
    return match?.[1] || null;
}

function classifyLogSeverity(line: string): ScraperRuntimeSeverity {
    const lower = line.toLowerCase();
    if (
        lower.includes("traceback")
        || lower.includes("missing python virtualenv")
        || lower.includes("failed to start")
        || lower.includes(" main process exited")
        || /\berror\b/.test(lower)
    ) {
        return "error";
    }
    if (
        lower.includes("[!]")
        || lower.includes("degraded")
        || lower.includes("rate limited")
        || lower.includes("timed out")
        || lower.includes("connection reset")
        || lower.includes("proxyerror")
        || lower.includes("remote end closed")
        || lower.includes("retrying")
        || lower.includes("skipped")
    ) {
        return "warning";
    }
    return "info";
}

function buildHighlightEvents(lines: string[]) {
    const interesting = lines.filter((line) => {
        const lower = line.toLowerCase();
        return (
            line.startsWith("[")
            || lower.includes("[!]")
            || lower.includes("[ok]")
            || lower.includes("done!")
            || lower.includes("rate limited")
            || lower.includes("error")
            || lower.includes("failed")
            || lower.includes("degraded")
            || lower.includes("starting scraper run")
            || lower.includes("scraper run finished")
        );
    });

    return interesting.slice(-18).map((line, index) => ({
        id: `${parseLogTimestamp(line) || "log"}:${index}:${line.slice(0, 48)}`,
        at: parseLogTimestamp(line),
        line,
        severity: classifyLogSeverity(line),
    }));
}

async function readLogSnapshot(path: string): Promise<ScraperRuntimeLogSnapshot> {
    try {
        const { stats, lines } = await readTailLines(path);
        let lastHeartbeatAt: string | null = null;
        let lastStartedAt: string | null = null;
        let lastFinishedAt: string | null = null;
        let summaryLine: string | null = null;

        for (const line of lines) {
            const timestamp = parseLogTimestamp(line);
            if (timestamp) {
                lastHeartbeatAt = timestamp;
            }
            if (line.includes("starting scraper run")) {
                lastStartedAt = timestamp || lastStartedAt;
            }
            if (line.includes("scraper run finished")) {
                lastFinishedAt = timestamp || lastFinishedAt;
            }
            if (/done!\s+\d+\s+posts\s+->\s+\d+\s+ideas updated/i.test(line)) {
                summaryLine = line;
            }
        }

        const runInProgress = Boolean(
            lastStartedAt
            && (
                !lastFinishedAt
                || Date.parse(lastStartedAt) > Date.parse(lastFinishedAt)
            ),
        );

        return {
            path,
            exists: true,
            readable: true,
            sizeBytes: stats.size,
            updatedAt: stats.mtime.toISOString(),
            lastHeartbeatAt,
            lastStartedAt,
            lastFinishedAt,
            runInProgress,
            lastLine: lines.at(-1) || null,
            summaryLine,
            highlights: buildHighlightEvents(lines),
            tailLines: lines,
            error: null,
        };
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code || "") : "";
        return {
            path,
            exists: code !== "ENOENT" ? true : false,
            readable: false,
            sizeBytes: 0,
            updatedAt: null,
            lastHeartbeatAt: null,
            lastStartedAt: null,
            lastFinishedAt: null,
            runInProgress: false,
            lastLine: null,
            summaryLine: null,
            highlights: [],
            tailLines: [],
            error: error instanceof Error ? error.message : "Unable to read scraper log",
        };
    }
}

function deriveRuntimeStatus(service: ScraperRuntimeUnitState, timer: ScraperRuntimeUnitState, log: ScraperRuntimeLogSnapshot): ScraperRuntimeStatus {
    if (!service.available && !log.exists) {
        return {
            state: "unavailable",
            label: "Telemetry unavailable",
            detail: service.error || log.error || "No scraper runtime signals were available on this host.",
        };
    }

    if (service.activeState === "failed" || service.result === "failed" || service.execMainStatus === 1) {
        return {
            state: "failed",
            label: "Scraper failed",
            detail: service.error || "The scraper service is in a failed state.",
        };
    }

    if (service.activeState === "activating" || service.activeState === "active" || log.runInProgress) {
        return {
            state: "running",
            label: "Scraper running",
            detail: log.lastLine || "The scraper appears to be mid-run.",
        };
    }

    const freshnessSource = log.lastHeartbeatAt || log.updatedAt;
    if (freshnessSource) {
        const ageMs = Date.now() - Date.parse(freshnessSource);
        if (Number.isFinite(ageMs) && ageMs > 12 * 60 * 60 * 1000 && timer.activeState === "active") {
            return {
                state: "stale",
                label: "Heartbeat stale",
                detail: "The timer is active, but the scraper log has not advanced in the last 12 hours.",
            };
        }
    }

    return {
        state: "idle",
        label: "Scraper idle",
        detail: log.lastFinishedAt
            ? `Last completed run finished at ${log.lastFinishedAt}.`
            : "No active scraper run is currently observed.",
    };
}

export async function getScraperRuntimeMonitor(): Promise<ScraperRuntimeMonitor> {
    const logPath = process.env.ADMIN_SCRAPER_LOG_PATH?.trim() || "/var/log/redditpulse/market-scraper.log";
    const serviceName = process.env.ADMIN_SCRAPER_SERVICE?.trim() || "redditpulse-scraper.service";
    const timerName = process.env.ADMIN_SCRAPER_TIMER?.trim() || "redditpulse-scraper.timer";

    const [service, timer, log] = await Promise.all([
        readSystemdUnitState(serviceName),
        readSystemdUnitState(timerName),
        readLogSnapshot(logPath),
    ]);

    const status = deriveRuntimeStatus(service, timer, log);

    return {
        available: service.available || log.exists,
        host: os.hostname(),
        platform: process.platform,
        service,
        timer,
        log,
        status,
    };
}
