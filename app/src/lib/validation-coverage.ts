export type ValidationCoverageWarning = {
    platform: string;
    issue: string;
    status?: string | null;
    error_code?: string | null;
    error_detail?: string | null;
    posts?: number | null;
};

export type ValidationCoverageSummary = {
    status: "healthy" | "degraded";
    summary: string | null;
    warnings: ValidationCoverageWarning[];
    warningPlatforms: string[];
    partialCoverage: boolean;
    usedDatabaseFallback: boolean;
    redditDegraded: boolean;
};

export function sanitizeValidationProgressMessage(message: string, source?: string | null) {
    const normalized = String(message || "").trim();
    if (!normalized) return "";

    const safeSource = normalizePlatformName(source);
    const clean = normalized.replace(/^\[\d{2}:\d{2}\]\s*/, "");
    const lower = clean.toLowerCase();

    if (safeSource === "db_history" || lower.includes("recent db history") || lower.includes("recent database history")) {
        const match = clean.match(/(\d+)/);
        return `Recent database history: ${match ? match[1] : "0"} supporting posts loaded.`;
    }

    if (
        lower.includes("failed:")
        || lower.includes("scraper unavailable")
        || lower.includes("scrape failed")
        || lower.includes("scrape error")
        || lower.includes("scraper not available")
    ) {
        return toUserSafeIssue(safeSource || "source", clean);
    }

    return clean;
}

function normalizePlatformName(value: unknown) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
}

function labelPlatform(platform: string) {
    switch (platform) {
        case "reddit":
            return "Reddit";
        case "reddit_comment":
            return "Reddit comments";
        case "reddit_connected":
            return "Connected Reddit";
        case "hackernews":
            return "Hacker News";
        case "producthunt":
            return "Product Hunt";
        case "indiehackers":
            return "Indie Hackers";
        case "stackoverflow":
            return "Stack Overflow";
        case "githubissues":
            return "GitHub Issues";
        case "g2_review":
            return "G2";
        case "job_posting":
            return "Jobs";
        case "vendor_blog":
            return "Vendor blogs";
        default:
            return platform
                .split("_")
                .filter(Boolean)
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(" ");
    }
}

function toUserSafeIssue(platform: string, issue: string) {
    const normalized = issue.toLowerCase();
    const label = labelPlatform(platform || "source");

    if (!normalized) {
        return `${label} coverage was limited for this run. CueIdea continued with the remaining sources.`;
    }

    if (platform === "reddit" || platform === "reddit_connected" || platform === "reddit_comment") {
        return "Reddit coverage was limited for this run. CueIdea continued with other sources and recent database history.";
    }

    if (normalized.includes("0 posts") || normalized.includes("0 results") || normalized.includes("no clear supporting evidence")) {
        return `${label} returned no clear supporting evidence for this run.`;
    }

    if (
        normalized.includes("scrape failed")
        || normalized.includes("scraper not available")
        || normalized.includes("scrape error")
        || normalized.includes("unavailable")
        || normalized.includes("coverage may be reduced")
    ) {
        return `${label} was unavailable for this run. CueIdea continued with the remaining sources.`;
    }

    return issue;
}

function normalizeWarningEntry(value: unknown): ValidationCoverageWarning | null {
    if (typeof value === "string") {
        const issue = value.trim();
        if (!issue) return null;
        const issueLower = issue.toLowerCase();
        const platform =
            issueLower.includes("reddit") ? "reddit"
                : issueLower.includes("hacker news") || issueLower.includes("hn") ? "hackernews"
                    : issueLower.includes("product hunt") ? "producthunt"
                        : issueLower.includes("indie hackers") ? "indiehackers"
                            : issueLower.includes("stack overflow") ? "stackoverflow"
                                : issueLower.includes("github issues") ? "githubissues"
                                    : issueLower.includes("g2") ? "g2_review"
                                        : issueLower.includes("job") ? "job_posting"
                                            : "source";
        return {
            platform,
            issue: toUserSafeIssue(platform, issue),
        };
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }

    const record = value as Record<string, unknown>;
    const platform = normalizePlatformName(record.platform || record.source || "source");
    const issue = String(record.issue || record.warning || record.error_detail || "").trim();

    if (!platform && !issue) return null;

    return {
        platform: platform || "source",
        issue: toUserSafeIssue(platform || "source", issue || ""),
        status: record.status ? String(record.status) : null,
        error_code: record.error_code ? String(record.error_code) : null,
        error_detail: record.error_detail ? String(record.error_detail) : null,
        posts: record.posts == null ? null : Number(record.posts || 0),
    };
}

function didUseDatabaseFallback(progressLog: unknown[] = []) {
    return progressLog.some((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
        const record = entry as Record<string, unknown>;
        const source = normalizePlatformName(record.source);
        const message = String(record.message || "").toLowerCase();
        return source === "db_history" || message.includes("recent db history") || message.includes("recent database history");
    });
}

export function summarizeValidationCoverage(input: {
    platformWarnings?: unknown[] | null;
    partialCoverage?: boolean | null;
    progressLog?: unknown[] | null;
}): ValidationCoverageSummary {
    const warnings = Array.isArray(input.platformWarnings)
        ? input.platformWarnings.map(normalizeWarningEntry).filter((item): item is ValidationCoverageWarning => Boolean(item))
        : [];
    const warningPlatforms = [...new Set(warnings.map((warning) => warning.platform).filter(Boolean))];
    const partialCoverage = Boolean(input.partialCoverage);
    const usedDatabaseFallback = didUseDatabaseFallback(Array.isArray(input.progressLog) ? input.progressLog : []);
    const redditDegraded = warningPlatforms.includes("reddit") || warningPlatforms.includes("reddit_comment") || warningPlatforms.includes("reddit_connected");
    const degraded = partialCoverage || warnings.length > 0;

    let summary: string | null = null;
    if (redditDegraded) {
        summary = usedDatabaseFallback
            ? "Reddit coverage was limited for this run. CueIdea continued with other sources and recent database history."
            : "Reddit coverage was limited for this run. CueIdea continued with the remaining sources.";
    } else if (degraded && warningPlatforms.length === 1) {
        summary = `${labelPlatform(warningPlatforms[0] || "source")} coverage was limited for this run. CueIdea continued with the remaining sources.`;
    } else if (degraded && warningPlatforms.length > 1) {
        summary = `Coverage was limited across ${warningPlatforms.length} sources for this run. CueIdea continued with the healthiest available evidence.`;
    } else if (usedDatabaseFallback) {
        summary = "Recent database history supplemented this validation.";
    }

    return {
        status: degraded ? "degraded" : "healthy",
        summary,
        warnings,
        warningPlatforms,
        partialCoverage,
        usedDatabaseFallback,
        redditDegraded,
    };
}
