import {
    rankOpportunityRepresentativePosts,
    type OpportunitySignalContract,
    type OpportunityTopPost,
} from "@/lib/opportunity-signal";

export interface MarketOpportunityPresentationInput {
    topic: string;
    slug: string;
    category: string;
    keywords?: string[] | null;
    topPosts?: OpportunityTopPost[] | null;
    signalContract?: OpportunitySignalContract | null;
}

export interface MarketOpportunityPresentation {
    display_topic: string;
    shape_status: "verbatim" | "derived";
    suppress_from_market: boolean;
    suppress_reason: string | null;
}

const SHARE_THREAD_PATTERNS = [
    /\bshare your project\b/i,
    /\blet'?s share\b/i,
    /\bshow us what you(?:'|’)re building\b/i,
    /\bfriday share\b/i,
];

const MALFORMED_TOPIC_PATTERNS = [
    /\bcan'?t in\b/i,
    /\bissue\b.*\bin\b/i,
    /\bproblem\b.*\bin\b/i,
    /\bhelp\b.*\bin\b/i,
];

const GENERIC_THEME_WORDS = new Set([
    "ai",
    "automation",
    "business",
    "content",
    "creator",
    "creators",
    "data",
    "developer",
    "developers",
    "ecommerce",
    "marketing",
    "media",
    "productivity",
    "saas",
    "side",
    "small",
    "social",
    "tools",
]);

function decodeHtml(value?: string | null) {
    return String(value || "")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function normalizeText(value?: string | null) {
    return decodeHtml(value)
        .toLowerCase()
        .replace(/[^\w\s]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanText(value?: string | null) {
    return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function titleCase(value: string) {
    return value
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => {
            if (/^[A-Z0-9]{2,}$/.test(part)) return part;
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join(" ");
}

function uniqueValues(values: Array<string | null | undefined>) {
    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function isBroadTheme(topic: string, keywords: string[]) {
    const words = cleanText(topic).split(/\s+/).filter(Boolean);
    if (words.length <= 2) return true;
    return keywords.filter(Boolean).length >= 8;
}

function isRecurringShareThread(posts: OpportunityTopPost[]) {
    const normalizedTitles = uniqueValues(posts.slice(0, 4).map((post) => normalizeText(post.title)));
    if (normalizedTitles.length !== 1) return false;
    const onlyTitle = normalizedTitles[0] || "";
    return SHARE_THREAD_PATTERNS.some((pattern) => pattern.test(onlyTitle));
}

function isMalformedTopic(topic: string) {
    return MALFORMED_TOPIC_PATTERNS.some((pattern) => pattern.test(cleanText(topic)));
}

function detectAlternativeAudience(titleBlob: string) {
    const audienceParts: string[] = [];
    if (/\bmac(os)?\b/.test(titleBlob)) audienceParts.push("macOS");
    if (/\bwindows?\b/.test(titleBlob)) audienceParts.push("Windows");
    if (/\blinux\b/.test(titleBlob)) audienceParts.push("Linux");
    if (/\biphone\b|\bios\b/.test(titleBlob)) audienceParts.push("iOS");
    if (/\bandroid\b/.test(titleBlob)) audienceParts.push("Android");
    if (/\bmanager(s)?\b/.test(titleBlob)) audienceParts.push("managers");
    if (/\bagenc(y|ies)\b/.test(titleBlob)) audienceParts.push("agencies");
    if (/\bcreator(s)?\b/.test(titleBlob)) audienceParts.push("creators");
    return audienceParts;
}

function detectWorkflowPersona(titleBlob: string) {
    if (/\bsocial media manager(s)?\b/.test(titleBlob)) return "social media managers";
    if (/\bagenc(y|ies)\b/.test(titleBlob)) return "agencies";
    if (/\bsmall business(es)?\b|\bsmallbusiness\b/.test(titleBlob)) return "small businesses";
    if (/\bdeveloper(s)?\b|\bengineering teams?\b/.test(titleBlob)) return "engineering teams";
    return null;
}

function buildAudienceSuffix(parts: string[]) {
    if (parts.length === 0) return "";
    if (parts.length === 1) return ` for ${parts[0]}`;
    if (parts.length === 2) return ` for ${parts[0]} and ${parts[1]}`;
    return ` for ${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function deriveFromSocialMedia(topic: string, titleBlob: string) {
    if (!/\bsocial media\b/.test(`${normalizeText(topic)} ${titleBlob}`)) return null;
    if (/\bvideo\b|\bseries\b|\bburnout\b/.test(titleBlob)) {
        return "Social media content workflow for managers";
    }
    const persona = detectWorkflowPersona(titleBlob);
    if (persona) {
        return `Social media workflow for ${persona}`;
    }
    return "Social media content workflow for marketing teams";
}

function deriveFromSmallBusiness(topic: string, titleBlob: string) {
    if (!/\bsmall business\b|\bsmallbusiness\b/.test(`${normalizeText(topic)} ${titleBlob}`)) return null;
    if (/\btax\b|\bbookkeeping\b|\bbookkeeper\b|\baccounting\b/.test(titleBlob)) {
        return "Small-business tax and bookkeeping workflow";
    }
    if (/\binsurance\b|\bbenefits\b/.test(titleBlob)) {
        return "Small-business benefits and admin workflow";
    }
    if (/\bsetup\b|\bset up\b|\bget started\b/.test(titleBlob)) {
        return "Small-business setup workflow";
    }
    return null;
}

function deriveFromIfttt(topic: string, titleBlob: string) {
    if (!/\bifttt\b/.test(`${normalizeText(topic)} ${titleBlob}`)) return null;
    if (/\bapplet\b|\bfail(ed|ing)?\b|\bintegration\b|\bcompatible\b|\breplace\b/.test(titleBlob)) {
        return "IFTTT applet debugging and reliability";
    }
    return "IFTTT automation reliability workflow";
}

function deriveFromScreenStudio(topic: string, titleBlob: string) {
    if (!/\bscreen studio\b/.test(`${normalizeText(topic)} ${titleBlob}`)) return null;
    const audience = detectAlternativeAudience(titleBlob);
    const platformAudience = audience.filter((item) => ["macOS", "Windows", "Linux", "iOS", "Android"].includes(item));
    if (/\balternative\b|\breplace\b|\bfree\b/.test(titleBlob)) {
        const suffix = buildAudienceSuffix(platformAudience.length > 0 ? platformAudience : ["creators"]);
        return `Screen recording alternative${suffix}`;
    }
    return "Screen recording workflow for creators";
}

function deriveFromEntityAlternatives(topic: string, titleBlob: string) {
    if (!/\balternative\b|\breplace\b|\bfailing\b|\bfailed\b/.test(titleBlob)) return null;
    const words = cleanText(topic).split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 3) return null;
    const genericWords = words.filter((word) => GENERIC_THEME_WORDS.has(word.toLowerCase()));
    if (genericWords.length === words.length) return null;

    const displayTopic = titleCase(cleanText(topic));
    const audience = detectAlternativeAudience(titleBlob);
    return `Alternative to ${displayTopic}${buildAudienceSuffix(audience)}`;
}

function deriveOpportunityLabel(input: MarketOpportunityPresentationInput, rankedPosts: OpportunityTopPost[]) {
    const topic = cleanText(input.topic);
    const titleBlob = normalizeText(rankedPosts.map((post) => post.title).join(" || "));

    return (
        deriveFromSocialMedia(topic, titleBlob)
        || deriveFromSmallBusiness(topic, titleBlob)
        || deriveFromIfttt(topic, titleBlob)
        || deriveFromScreenStudio(topic, titleBlob)
        || deriveFromEntityAlternatives(topic, titleBlob)
        || null
    );
}

export function buildMarketOpportunityPresentation(input: MarketOpportunityPresentationInput): MarketOpportunityPresentation {
    const topic = cleanText(input.topic);
    const rankedPosts = rankOpportunityRepresentativePosts(input.topPosts || []).slice(0, 4);
    const keywords = Array.isArray(input.keywords) ? input.keywords.filter(Boolean) : [];
    const derivedLabel = deriveOpportunityLabel(input, rankedPosts);

    if (isRecurringShareThread(rankedPosts)) {
        return {
            display_topic: topic,
            shape_status: "verbatim",
            suppress_from_market: true,
            suppress_reason: "Recurring share thread, not an opportunity",
        };
    }

    if (derivedLabel) {
        return {
            display_topic: derivedLabel,
            shape_status: "derived",
            suppress_from_market: false,
            suppress_reason: null,
        };
    }

    if (isMalformedTopic(topic)) {
        return {
            display_topic: topic,
            shape_status: "verbatim",
            suppress_from_market: true,
            suppress_reason: "Malformed cluster title",
        };
    }

    if (isBroadTheme(topic, keywords)) {
        return {
            display_topic: topic,
            shape_status: "verbatim",
            suppress_from_market: true,
            suppress_reason: "Broad theme still needs a wedge",
        };
    }

    return {
        display_topic: topic,
        shape_status: "verbatim",
        suppress_from_market: false,
        suppress_reason: null,
    };
}
