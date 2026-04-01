const INVALID_MARKET_TOPIC_EXACT_BLOCKLIST = new Set([
    "don know",
    "few years",
    "first users",
    "hey all",
    "hey everyone",
    "hey guys",
    "https www",
    "long take",
    "lot people",
    "not sure",
    "other people",
    "quarter achieve",
    "years marketing",
]);

const INVALID_MARKET_TOPIC_PREFIXES = [
    "anyone else ",
    "does anyone ",
    "don know",
    "help ",
    "hey ",
    "how do i ",
    "looking for ",
    "manual ",
    "not sure",
];

const INVALID_MARKET_TOPIC_GENERIC_TOKENS = new Set([
    "alternative",
    "alternatives",
    "anyone",
    "does",
    "don",
    "else",
    "everyone",
    "few",
    "first",
    "for",
    "guys",
    "help",
    "how",
    "i",
    "issue",
    "issues",
    "know",
    "long",
    "lot",
    "looking",
    "manual",
    "month",
    "months",
    "not",
    "other",
    "people",
    "problem",
    "problems",
    "quarter",
    "recommendation",
    "recommendations",
    "sure",
    "year",
    "years",
]);

export function normalizeMarketTopicName(value?: string | null) {
    return String(value || "")
        .toLowerCase()
        .replace(/&/g, " ")
        .replace(/[^a-z0-9\s]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function isInvalidMarketTopicName(value?: string | null) {
    const normalized = normalizeMarketTopicName(value);
    if (!normalized) return true;
    if (INVALID_MARKET_TOPIC_EXACT_BLOCKLIST.has(normalized)) return true;
    if (INVALID_MARKET_TOPIC_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
    if (normalized.includes("http") || normalized.includes("www")) return true;

    const meaningfulTokens = normalized
        .split(" ")
        .filter((token) => token && !INVALID_MARKET_TOPIC_GENERIC_TOKENS.has(token) && token.length > 2);

    return meaningfulTokens.length < 2;
}
