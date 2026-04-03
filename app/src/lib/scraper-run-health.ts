export type ScraperRunHealth = {
    healthy_sources: string[];
    degraded_sources: string[];
    run_health: "healthy" | "degraded" | "failed";
    runner_label: string | null;
    reddit_access_mode: "provider_api" | "authenticated_app" | "anonymous_public" | "connected_user" | "unknown";
    reddit_post_count: number;
    reddit_successful_requests: number;
    reddit_failed_requests: number;
    reddit_degraded_reason: string | null;
};

type ScraperRunRow = Record<string, unknown> | null;

function parseSourceList(value: unknown) {
    return String(value || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}

function parseNamedList(value: string) {
    return value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item && item !== "none");
}

function toCount(value: string | undefined) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function extractScraperRunHealth(latestRun: ScraperRunRow): ScraperRunHealth {
    if (!latestRun) {
        return {
            healthy_sources: [],
            degraded_sources: [],
            run_health: "failed",
            runner_label: null,
            reddit_access_mode: "unknown",
            reddit_post_count: 0,
            reddit_successful_requests: 0,
            reddit_failed_requests: 0,
            reddit_degraded_reason: null,
        };
    }

    const rawSources = parseSourceList(latestRun?.source);
    const errorText = String(latestRun?.error_text || "");
    const structuredMatch = errorText.match(/Source health:\s*healthy=([^;|]+);\s*degraded=([^|]+)/i);
    const redditMatch = errorText.match(
        /Reddit health:\s*mode=([^;|]+);\s*posts=(\d+);\s*success=(\d+);\s*failed=(\d+);\s*reason=([^|]+)/i,
    );
    const runnerMatch = errorText.match(/Run metadata:\s*caller=([^|]+)/i);

    let healthySources = structuredMatch ? parseNamedList(structuredMatch[1] || "") : [];
    let degradedSources = structuredMatch ? parseNamedList(structuredMatch[2] || "") : [];

    if (!structuredMatch) {
        const degradedHints = [
            { source: "reddit", pattern: /reddit degraded|layer 1 async degraded|layer 1 async failed|layer 1 authenticated degraded|layer 1 authenticated failed|layer 2b/i },
            { source: "hackernews", pattern: /hacker news skipped/i },
            { source: "producthunt", pattern: /producthunt skipped/i },
            { source: "indiehackers", pattern: /indiehackers skipped/i },
        ];

        degradedSources = degradedHints
            .filter((hint) => hint.pattern.test(errorText))
            .map((hint) => hint.source);
        healthySources = rawSources.filter((source) => !degradedSources.includes(source));
    }

    const runHealth = String(latestRun?.status || "").toLowerCase() === "failed"
        ? "failed"
        : degradedSources.length > 0 || String(latestRun?.status || "").toLowerCase() === "degraded"
            ? "degraded"
            : "healthy";

    const redditAccessModeRaw = String(redditMatch?.[1] || "").trim().toLowerCase();
    const reddit_access_mode = redditAccessModeRaw === "provider_api"
        ? "provider_api"
        : redditAccessModeRaw === "authenticated_app"
        ? "authenticated_app"
        : redditAccessModeRaw === "anonymous_public"
            ? "anonymous_public"
            : redditAccessModeRaw === "connected_user"
                ? "connected_user"
                : "unknown";

    const redditReason = String(redditMatch?.[5] || "").trim();

    return {
        healthy_sources: healthySources,
        degraded_sources: degradedSources,
        run_health: runHealth,
        runner_label: runnerMatch ? String(runnerMatch[1] || "").trim() || null : null,
        reddit_access_mode,
        reddit_post_count: toCount(redditMatch?.[2]),
        reddit_successful_requests: toCount(redditMatch?.[3]),
        reddit_failed_requests: toCount(redditMatch?.[4]),
        reddit_degraded_reason: redditReason && redditReason.toLowerCase() !== "none" ? redditReason : null,
    };
}
