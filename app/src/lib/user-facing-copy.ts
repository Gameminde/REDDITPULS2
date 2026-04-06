type SourceCount = {
    platform?: string | null;
    count?: number | null;
};

type TopPostPreview = {
    title?: string | null;
    subreddit?: string | null;
    source?: string | null;
    source_name?: string | null;
};

type BrowseIdeaInput = {
    topic?: string | null;
    category?: string | null;
    pain_summary?: string | null;
    post_count_total?: number | null;
    post_count_7d?: number | null;
    top_posts?: TopPostPreview[] | null;
    sources?: SourceCount[] | null;
};

const BAD_SUMMARY_PATTERNS = [
    /complain about frustrated with/i,
    /people repeatedly complain about/i,
    /pain signals from /i,
    /why this card is here/i,
    /opportunity with \d+ recent posts? feeding this score/i,
    /there are no direct buyer pain quotes anchoring the opportunity yet/i,
    /no direct buyer pain quotes/i,
    /legacy representative-post metadata/i,
    /no representative evidence yet/i,
    /^http status \d+/i,
    /\btrying create\b/i,
    /\bfeatured offer\b/i,
    /\bexplore page\b/i,
    /\bhey guys\b/i,
];

function decodeHtml(value?: string | null) {
    return String(value || "")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

export function cleanUserFacingText(value: unknown) {
    return decodeHtml(String(value || "")).replace(/\s+/g, " ").trim();
}

export function ensureSentence(value: unknown, fallback = "") {
    const text = cleanUserFacingText(value || fallback);
    if (!text) return fallback;
    return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function formatSourceNameForUser(platform?: string | null) {
    const value = cleanUserFacingText(platform).toLowerCase();
    switch (value) {
        case "reddit":
            return "Reddit";
        case "hackernews":
            return "Hacker News";
        case "producthunt":
            return "Product Hunt";
        case "indiehackers":
            return "Indie Hackers";
        case "githubissues":
            return "GitHub Issues";
        case "g2_review":
            return "Reviews";
        case "job_posting":
            return "Hiring signals";
        default:
            return cleanUserFacingText(platform) || "live sources";
    }
}

export function formatCountLabel(count: number | null | undefined, singular: string, plural?: string) {
    const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
    if (safeCount === 1) return `1 ${singular}`;
    return `${safeCount} ${plural || `${singular}s`}`;
}

export function isLowQualityUserFacingCopy(value: unknown) {
    const text = cleanUserFacingText(value).toLowerCase();
    if (!text) return true;
    return BAD_SUMMARY_PATTERNS.some((pattern) => pattern.test(text));
}

function getRepresentativePost(posts?: TopPostPreview[] | null) {
    return (posts || []).find((post) => cleanUserFacingText(post?.title)) || null;
}

function getTopSource(sources?: SourceCount[] | null) {
    if (!Array.isArray(sources) || sources.length === 0) return null;
    return [...sources].sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0] || null;
}

export function summarizeIdeaForBrowse(input: BrowseIdeaInput) {
    if (!isLowQualityUserFacingCopy(input.pain_summary)) {
        return ensureSentence(input.pain_summary);
    }

    const representativePost = getRepresentativePost(input.top_posts);
    if (representativePost?.title) {
        const community = representativePost.subreddit
            ? `r/${cleanUserFacingText(representativePost.subreddit)}`
            : formatSourceNameForUser(representativePost.source_name || representativePost.source);
        return ensureSentence(`"${cleanUserFacingText(representativePost.title)}" keeps coming up in ${community}`);
    }

    const topic = cleanUserFacingText(input.topic) || "This topic";
    const category = cleanUserFacingText(input.category).replace(/-/g, " ");
    const topSource = getTopSource(input.sources);
    const sourceName = topSource ? formatSourceNameForUser(topSource.platform) : "live sources";
    const recentPosts = Number(input.post_count_7d || input.post_count_total || 0);

    if (recentPosts > 0) {
        return ensureSentence(`${topic} is coming up repeatedly in ${category || "real buyer conversations"} across ${sourceName}`);
    }

    return ensureSentence(`${topic} is starting to show up in ${category || "founder conversations"}`);
}

export function summarizeReasonForUser(value: unknown, fallback: string) {
    const text = cleanUserFacingText(value);
    if (!text || isLowQualityUserFacingCopy(text)) {
        return ensureSentence(fallback);
    }

    if (/no direct buyer pain quotes anchoring the opportunity yet/i.test(text)) {
        return "Early signal - needs stronger buyer proof.";
    }

    return ensureSentence(text);
}

export function getSupportLevelLabel(level: string) {
    const normalized = cleanUserFacingText(level).toLowerCase();
    if (normalized === "supporting_context") return "Cross-source proof";
    if (normalized === "hypothesis") return "Early proof";
    return "Buyer proof";
}

export function getReadinessLabel(readiness: string) {
    const normalized = cleanUserFacingText(readiness).toLowerCase();
    if (normalized === "needs_wedge") return "Needs focus";
    if (normalized === "needs_more_proof") return "Needs proof";
    return "Ready";
}
