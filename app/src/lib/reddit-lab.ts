export type RedditAccountMode = "personal" | "research";
export type RedditConnectionStatus = "connected" | "needs_reauth" | "error" | "disconnected";
export type RedditSourcePackType = "synced" | "manual" | "mixed";
export type ProxyProfileStatus = "pending" | "ready" | "error" | "disabled";

export interface RedditSavedRef {
    id?: string;
    title?: string;
    subreddit?: string;
    permalink?: string;
    created_utc?: number;
}

export interface RedditMultiRef {
    name?: string;
    display_name?: string;
    path?: string;
}

export interface RedditConnectionSummary {
    id: string;
    reddit_user_id?: string | null;
    reddit_username: string;
    account_mode: RedditAccountMode;
    status: RedditConnectionStatus;
    granted_scopes: string[];
    profile_metadata: Record<string, unknown>;
    synced_subreddits: string[];
    saved_refs: RedditSavedRef[];
    multireddit_refs: RedditMultiRef[];
    token_expires_at?: string | null;
    last_synced_at?: string | null;
    last_token_refresh_at?: string | null;
    last_error?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface RedditSourcePack {
    id: string;
    user_id?: string;
    connection_id?: string | null;
    name: string;
    source_type: RedditSourcePackType;
    subreddits: string[];
    saved_refs: RedditSavedRef[];
    multireddit_refs: RedditMultiRef[];
    is_default_for_validation: boolean;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface ProxyProfileSummary {
    id: string;
    label: string;
    status: ProxyProfileStatus;
    proxy_url_masked: string;
    usage_notes?: string | null;
    last_verified_at?: string | null;
    last_error?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface RedditLabValidationOptions {
    connection_id?: string | null;
    source_pack_id?: string | null;
    use_connected_context?: boolean;
}

export interface RedditLabExecutionPreview {
    enabled: boolean;
    connection_id?: string | null;
    reddit_username?: string | null;
    account_mode?: RedditAccountMode | null;
    source_pack_id?: string | null;
    source_pack_name?: string | null;
    source_pack_subreddits: string[];
    use_connected_context: boolean;
}

export interface RedditLabWorkerContext extends RedditLabExecutionPreview {
    connected_access_token?: string | null;
    connected_granted_scopes?: string[];
}

export function normalizeSubreddit(value: string) {
    return String(value || "")
        .trim()
        .replace(/^\/?r\//i, "")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "")
        .toLowerCase();
}

export function normalizeSubredditList(values: Array<string | null | undefined>) {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const value of values || []) {
        const sub = normalizeSubreddit(String(value || ""));
        if (!sub || seen.has(sub)) continue;
        seen.add(sub);
        normalized.push(sub);
    }

    return normalized;
}

export function maskProxyUrl(value: string) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    try {
        const parsed = new URL(raw);
        const host = parsed.hostname || "proxy";
        const port = parsed.port ? `:${parsed.port}` : "";
        return `${parsed.protocol}//••••@${host}${port}`;
    } catch {
        const tail = raw.slice(-18);
        return raw.length > 18 ? `••••${tail}` : "••••";
    }
}

export function hasRedditLabOptions(value: unknown): value is RedditLabValidationOptions {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return Boolean(
        record.connection_id ||
        record.source_pack_id ||
        record.use_connected_context,
    );
}
