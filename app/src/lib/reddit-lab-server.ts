import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAdmin } from "@/lib/supabase-admin";
import {
    normalizeSubredditList,
    type ProxyProfileSummary,
    type RedditAccountMode,
    type RedditConnectionSummary,
    type RedditLabExecutionPreview,
    type RedditLabValidationOptions,
    type RedditLabWorkerContext,
    type RedditMultiRef,
    type RedditSavedRef,
    type RedditSourcePack,
} from "@/lib/reddit-lab";

const execFileAsync = promisify(execFile);

const REDDIT_AUTHORIZE_URL = "https://www.reddit.com/api/v1/authorize";
const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REDDIT_API_BASE = "https://oauth.reddit.com";
const REDDIT_REQUIRED_SCOPES = ["identity", "read"];
const REDDIT_PREFERRED_SCOPES = ["history", "save", "mysubreddits"];
const REDDIT_USER_AGENT = "CueIdea/1.0 (experimental reddit connection lab)";

type RedditTokenResponse = {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope?: string;
    refresh_token?: string;
};

type DecryptedRedditConnectionRow = Omit<RedditConnectionSummary, "synced_subreddits" | "saved_refs" | "multireddit_refs"> & {
    user_id: string;
    synced_subreddits: string[];
    saved_refs: RedditSavedRef[];
    multireddit_refs: RedditMultiRef[];
    access_token?: string | null;
    refresh_token?: string | null;
};

type DecryptedProxyProfileRow = {
    id: string;
    user_id: string;
    label: string;
    status: ProxyProfileSummary["status"];
    proxy_url: string;
    usage_notes?: string | null;
    last_verified_at?: string | null;
    last_error?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
};

type RedditUniverseMarketIdea = {
    id: string;
    slug: string;
    topic: string;
    category: string;
    current_score: number;
    confidence_level: string;
    matched_subreddits: string[];
    source_count: number;
    top_titles: string[];
};

type RedditLabState = {
    enabled: boolean;
    oauth_configured: boolean;
    connection: RedditConnectionSummary | null;
    source_packs: RedditSourcePack[];
};

function safeParseJson<T>(value: unknown, fallback: T): T {
    if (Array.isArray(fallback)) {
        if (Array.isArray(value)) return value as T;
        if (typeof value === "string") {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed as T : fallback;
            } catch {
                return fallback;
            }
        }
        return fallback;
    }

    if (value && typeof value === "object") return value as T;
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" ? parsed as T : fallback;
        } catch {
            return fallback;
        }
    }

    return fallback;
}

function normalizeScopes(scopeValue: string | string[] | undefined | null) {
    if (Array.isArray(scopeValue)) {
        return Array.from(new Set(scopeValue.map((scope) => String(scope || "").trim()).filter(Boolean)));
    }

    return Array.from(
        new Set(
            String(scopeValue || "")
                .split(/[,\s]+/)
                .map((scope) => scope.trim())
                .filter(Boolean),
        ),
    );
}

function requireEncryptionKey() {
    const key = process.env.AI_ENCRYPTION_KEY?.trim();
    if (!key) {
        throw new Error("AI_ENCRYPTION_KEY is required for Reddit Connection Lab secrets.");
    }
    return key;
}

function toIsoOrNull(value?: string | number | Date | null) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function parseIsoDate(value?: string | null) {
    if (!value) return NaN;
    return Date.parse(String(value));
}

function normalizePackName(value: unknown, fallback = "Custom Reddit Pack") {
    const name = String(value || "").trim();
    return name.slice(0, 120) || fallback;
}

function parseTopPosts(value: unknown): Array<Record<string, unknown>> {
    return safeParseJson<Array<Record<string, unknown>>>(value, []);
}

export function isRedditConnectionLabEnabled() {
    return process.env.NEXT_PUBLIC_REDDIT_CONNECTION_LAB_ENABLED !== "false";
}

function resolveRedditOauthCredentials() {
    const clientId =
        process.env.REDDIT_OAUTH_CLIENT_ID?.trim() ||
        process.env.REDDIT_CLIENT_ID?.trim() ||
        "";
    const clientSecret =
        process.env.REDDIT_OAUTH_CLIENT_SECRET?.trim() ||
        process.env.REDDIT_CLIENT_SECRET?.trim() ||
        "";

    return { clientId, clientSecret };
}

export function hasRedditOauthConfig() {
    const { clientId, clientSecret } = resolveRedditOauthCredentials();
    return Boolean(clientId && clientSecret);
}

function requireRedditOauthConfig(origin: string) {
    const { clientId, clientSecret } = resolveRedditOauthCredentials();
    if (!clientId || !clientSecret) {
        throw new Error("Reddit OAuth is not configured. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET, or the REDDIT_OAUTH_* equivalents.");
    }

    const redirectUri =
        process.env.REDDIT_OAUTH_REDIRECT_URI?.trim() ||
        `${origin}/api/settings/lab/reddit/oauth/callback`;

    return { clientId, clientSecret, redirectUri };
}

export function buildRedditAuthorizeUrl(origin: string, state: string) {
    const { clientId, redirectUri } = requireRedditOauthConfig(origin);
    const scope = [...REDDIT_REQUIRED_SCOPES, ...REDDIT_PREFERRED_SCOPES].join(" ");
    const url = new URL(REDDIT_AUTHORIZE_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("duration", "permanent");
    url.searchParams.set("scope", scope);
    return url.toString();
}

export function generateOauthState() {
    return crypto.randomBytes(24).toString("hex");
}

async function redditTokenRequest(origin: string, body: Record<string, string>): Promise<RedditTokenResponse> {
    const { clientId, clientSecret, redirectUri } = requireRedditOauthConfig(origin);
    const form = new URLSearchParams({ redirect_uri: redirectUri, ...body });
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch(REDDIT_TOKEN_URL, {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": REDDIT_USER_AGENT,
        },
        body: form.toString(),
        cache: "no-store",
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Reddit token request failed (${response.status}): ${text.slice(0, 160)}`);
    }

    return await response.json() as RedditTokenResponse;
}

export async function exchangeRedditCode(origin: string, code: string) {
    return redditTokenRequest(origin, {
        grant_type: "authorization_code",
        code,
    });
}

async function refreshRedditToken(origin: string, refreshToken: string) {
    return redditTokenRequest(origin, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
    });
}

async function redditApiJson<T>(
    accessToken: string,
    path: string,
    params?: Record<string, string | number | undefined>,
) {
    const url = new URL(path.startsWith("http") ? path : `${REDDIT_API_BASE}${path}`);
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        url.searchParams.set(key, String(value));
    });

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": REDDIT_USER_AGENT,
        },
        cache: "no-store",
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Reddit API ${url.pathname} failed (${response.status}): ${text.slice(0, 160)}`);
    }

    return await response.json() as T;
}

function listingChildren(payload: any) {
    return Array.isArray(payload?.data?.children) ? payload.data.children : [];
}

async function fetchSubscribedSubreddits(accessToken: string, scopes: string[]) {
    if (!scopes.includes("mysubreddits")) return [];

    const subreddits: string[] = [];
    let after = "";

    for (let page = 0; page < 3; page += 1) {
        const payload = await redditApiJson<any>(accessToken, "/subreddits/mine/subscriber", {
            limit: 100,
            after: after || undefined,
        });
        const children = listingChildren(payload);
        for (const child of children) {
            const name = String(child?.data?.display_name || child?.data?.display_name_prefixed || "").trim();
            if (name) subreddits.push(name.replace(/^r\//i, ""));
        }
        after = String(payload?.data?.after || "");
        if (!after) break;
    }

    return normalizeSubredditList(subreddits);
}

async function fetchSavedRefs(accessToken: string, username: string, scopes: string[]) {
    if (!username || (!scopes.includes("history") && !scopes.includes("save"))) return [];

    const payload = await redditApiJson<any>(accessToken, `/user/${username}/saved`, { limit: 25 });
    return listingChildren(payload)
        .map((child: any) => ({
            id: String(child?.data?.name || child?.data?.id || ""),
            title: String(child?.data?.title || child?.data?.link_title || ""),
            subreddit: String(child?.data?.subreddit || ""),
            permalink: child?.data?.permalink ? `https://reddit.com${child.data.permalink}` : "",
            created_utc: Number(child?.data?.created_utc || 0),
        }))
        .filter((row: RedditSavedRef) => row.id || row.title);
}

async function fetchMultiredditRefs(accessToken: string) {
    try {
        const payload = await redditApiJson<any[]>(accessToken, "/api/multi/mine");
        return (Array.isArray(payload) ? payload : [])
            .map((row) => ({
                name: String(row?.data?.name || ""),
                display_name: String(row?.data?.display_name || row?.data?.name || ""),
                path: String(row?.data?.path || ""),
            }))
            .filter((row: RedditMultiRef) => row.name || row.display_name);
    } catch {
        return [];
    }
}

export async function syncRedditSnapshot(accessToken: string, scopesInput: string[] | string | undefined) {
    const me = await redditApiJson<any>(accessToken, "/api/v1/me");
    const scopes = normalizeScopes(scopesInput);
    const username = String(me?.name || "").trim();
    const [subreddits, savedRefs, multiredditRefs] = await Promise.all([
        fetchSubscribedSubreddits(accessToken, scopes),
        fetchSavedRefs(accessToken, username, scopes),
        fetchMultiredditRefs(accessToken),
    ]);

    return {
        reddit_user_id: String(me?.id || "").trim(),
        reddit_username: username,
        granted_scopes: scopes,
        profile_metadata: {
            icon_img: String(me?.icon_img || ""),
            total_karma: Number(me?.total_karma || 0),
            verified: Boolean(me?.verified),
            has_mail: Boolean(me?.has_mail),
            created_utc: Number(me?.created_utc || 0),
        },
        synced_subreddits: subreddits,
        saved_refs: savedRefs,
        multireddit_refs: multiredditRefs,
    };
}

export async function getRedditConnectionSummary(userId: string) {
    const admin = createAdmin();
    const { data, error } = await admin
        .from("user_reddit_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) {
        throw new Error(`Could not load Reddit connection: ${error.message}`);
    }
    if (!data) return null;

    return {
        id: String(data.id),
        reddit_user_id: data.reddit_user_id ? String(data.reddit_user_id) : null,
        reddit_username: String(data.reddit_username || ""),
        account_mode: String(data.account_mode || "personal") as RedditAccountMode,
        status: String(data.status || "connected") as RedditConnectionSummary["status"],
        granted_scopes: Array.isArray(data.granted_scopes) ? data.granted_scopes.map(String) : [],
        profile_metadata: safeParseJson<Record<string, unknown>>(data.profile_metadata, {}),
        synced_subreddits: normalizeSubredditList(
            safeParseJson<Array<string | { name?: string; subreddit?: string }>>(data.synced_subreddits, [])
                .map((entry) => typeof entry === "string" ? entry : String(entry?.name || entry?.subreddit || "")),
        ),
        saved_refs: safeParseJson<RedditSavedRef[]>(data.saved_refs, []),
        multireddit_refs: safeParseJson<RedditMultiRef[]>(data.multireddit_refs, []),
        token_expires_at: data.token_expires_at ? String(data.token_expires_at) : null,
        last_synced_at: data.last_synced_at ? String(data.last_synced_at) : null,
        last_token_refresh_at: data.last_token_refresh_at ? String(data.last_token_refresh_at) : null,
        last_error: data.last_error ? String(data.last_error) : null,
        created_at: data.created_at ? String(data.created_at) : null,
        updated_at: data.updated_at ? String(data.updated_at) : null,
    } satisfies RedditConnectionSummary;
}

export async function listSourcePacks(userId: string) {
    const admin = createAdmin();
    const { data, error } = await admin
        .from("user_reddit_source_packs")
        .select("*")
        .eq("user_id", userId)
        .order("is_default_for_validation", { ascending: false })
        .order("updated_at", { ascending: false });

    if (error) {
        throw new Error(`Could not load Reddit source packs: ${error.message}`);
    }

    return (data || []).map((row) => ({
        id: String(row.id),
        user_id: String(row.user_id),
        connection_id: row.connection_id ? String(row.connection_id) : null,
        name: String(row.name || ""),
        source_type: String(row.source_type || "manual") as RedditSourcePack["source_type"],
        subreddits: normalizeSubredditList(Array.isArray(row.subreddits) ? row.subreddits.map(String) : []),
        saved_refs: safeParseJson<RedditSavedRef[]>(row.saved_refs, []),
        multireddit_refs: safeParseJson<RedditMultiRef[]>(row.multireddit_refs, []),
        is_default_for_validation: Boolean(row.is_default_for_validation),
        created_at: row.created_at ? String(row.created_at) : null,
        updated_at: row.updated_at ? String(row.updated_at) : null,
    })) satisfies RedditSourcePack[];
}

export async function listProxyProfiles(userId: string) {
    const admin = createAdmin();
    const { data, error } = await admin
        .from("user_proxy_profiles")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

    if (error) {
        throw new Error(`Could not load proxy profiles: ${error.message}`);
    }

    return (data || []).map((row) => ({
        id: String(row.id),
        label: String(row.label || ""),
        status: String(row.status || "pending") as ProxyProfileSummary["status"],
        proxy_url_masked: "********",
        usage_notes: row.usage_notes ? String(row.usage_notes) : null,
        last_verified_at: row.last_verified_at ? String(row.last_verified_at) : null,
        last_error: row.last_error ? String(row.last_error) : null,
        created_at: row.created_at ? String(row.created_at) : null,
        updated_at: row.updated_at ? String(row.updated_at) : null,
    })) satisfies ProxyProfileSummary[];
}

export async function upsertEncryptedRedditConnection(input: {
    userId: string;
    connectionId?: string | null;
    redditUserId?: string | null;
    redditUsername: string;
    accountMode: RedditAccountMode;
    status: RedditConnectionSummary["status"];
    accessToken?: string | null;
    refreshToken?: string | null;
    grantedScopes: string[];
    tokenExpiresAt?: string | null;
    profileMetadata?: Record<string, unknown>;
    syncedSubreddits?: string[];
    savedRefs?: RedditSavedRef[];
    multiredditRefs?: RedditMultiRef[];
    lastSyncedAt?: string | null;
    lastTokenRefreshAt?: string | null;
    lastError?: string | null;
}) {
    const admin = createAdmin();
    const encryptionKey = requireEncryptionKey();
    const { data, error } = await admin.rpc("upsert_reddit_connection_encrypted", {
        p_connection_id: input.connectionId || null,
        p_user_id: input.userId,
        p_reddit_user_id: input.redditUserId || null,
        p_reddit_username: input.redditUsername,
        p_account_mode: input.accountMode,
        p_status: input.status,
        p_access_token: input.accessToken || null,
        p_refresh_token: input.refreshToken || null,
        p_granted_scopes: input.grantedScopes || [],
        p_token_expires_at: input.tokenExpiresAt || null,
        p_profile_metadata: input.profileMetadata || {},
        p_synced_subreddits: input.syncedSubreddits || [],
        p_saved_refs: input.savedRefs || [],
        p_multireddit_refs: input.multiredditRefs || [],
        p_last_synced_at: input.lastSyncedAt || null,
        p_last_token_refresh_at: input.lastTokenRefreshAt || null,
        p_last_error: input.lastError || null,
        p_key: encryptionKey,
    });

    if (error) {
        throw new Error(`Could not save Reddit connection: ${error.message}`);
    }

    return String(data);
}

async function getDecryptedRedditConnection(userId: string, connectionId?: string | null) {
    const admin = createAdmin();
    const encryptionKey = requireEncryptionKey();
    const { data, error } = await admin.rpc("get_reddit_connection_decrypted", {
        p_user_id: userId,
        p_connection_id: connectionId || null,
        p_key: encryptionKey,
    });

    if (error) {
        throw new Error(`Could not decrypt Reddit connection: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    return {
        id: String(row.id),
        user_id: String(row.user_id),
        reddit_user_id: row.reddit_user_id ? String(row.reddit_user_id) : null,
        reddit_username: String(row.reddit_username || ""),
        account_mode: String(row.account_mode || "personal") as RedditAccountMode,
        status: String(row.status || "connected") as RedditConnectionSummary["status"],
        access_token: row.access_token ? String(row.access_token) : null,
        refresh_token: row.refresh_token ? String(row.refresh_token) : null,
        granted_scopes: normalizeScopes(row.granted_scopes),
        token_expires_at: row.token_expires_at ? String(row.token_expires_at) : null,
        profile_metadata: safeParseJson<Record<string, unknown>>(row.profile_metadata, {}),
        synced_subreddits: normalizeSubredditList(
            safeParseJson<Array<string | { name?: string; subreddit?: string }>>(row.synced_subreddits, [])
                .map((entry) => typeof entry === "string" ? entry : String(entry?.name || entry?.subreddit || "")),
        ),
        saved_refs: safeParseJson<RedditSavedRef[]>(row.saved_refs, []),
        multireddit_refs: safeParseJson<RedditMultiRef[]>(row.multireddit_refs, []),
        last_synced_at: row.last_synced_at ? String(row.last_synced_at) : null,
        last_token_refresh_at: row.last_token_refresh_at ? String(row.last_token_refresh_at) : null,
        last_error: row.last_error ? String(row.last_error) : null,
        created_at: row.created_at ? String(row.created_at) : null,
        updated_at: row.updated_at ? String(row.updated_at) : null,
    } satisfies DecryptedRedditConnectionRow;
}

export async function upsertEncryptedProxyProfile(input: {
    userId: string;
    profileId?: string | null;
    label: string;
    status: ProxyProfileSummary["status"];
    proxyUrl?: string | null;
    usageNotes?: string | null;
    lastVerifiedAt?: string | null;
    lastError?: string | null;
}) {
    const admin = createAdmin();
    const encryptionKey = requireEncryptionKey();
    const { data, error } = await admin.rpc("upsert_proxy_profile_encrypted", {
        p_profile_id: input.profileId || null,
        p_user_id: input.userId,
        p_label: input.label,
        p_status: input.status,
        p_proxy_url: input.proxyUrl || null,
        p_usage_notes: input.usageNotes || null,
        p_last_verified_at: input.lastVerifiedAt || null,
        p_last_error: input.lastError || null,
        p_key: encryptionKey,
    });

    if (error) {
        throw new Error(`Could not save proxy profile: ${error.message}`);
    }

    return String(data);
}

export async function getDecryptedProxyProfile(userId: string, profileId: string) {
    const admin = createAdmin();
    const encryptionKey = requireEncryptionKey();
    const { data, error } = await admin.rpc("get_proxy_profile_decrypted", {
        p_user_id: userId,
        p_profile_id: profileId,
        p_key: encryptionKey,
    });

    if (error) {
        throw new Error(`Could not decrypt proxy profile: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    return {
        id: String(row.id),
        user_id: String(row.user_id),
        label: String(row.label || ""),
        status: String(row.status || "pending") as ProxyProfileSummary["status"],
        proxy_url: String(row.proxy_url || ""),
        usage_notes: row.usage_notes ? String(row.usage_notes) : null,
        last_verified_at: row.last_verified_at ? String(row.last_verified_at) : null,
        last_error: row.last_error ? String(row.last_error) : null,
        created_at: row.created_at ? String(row.created_at) : null,
        updated_at: row.updated_at ? String(row.updated_at) : null,
    } satisfies DecryptedProxyProfileRow;
}

export async function disconnectRedditConnection(userId: string) {
    const admin = createAdmin();
    const { error } = await admin
        .from("user_reddit_connections")
        .delete()
        .eq("user_id", userId);

    if (error) {
        throw new Error(`Could not disconnect Reddit: ${error.message}`);
    }
}

export async function upsertSourcePack(input: {
    userId: string;
    packId?: string | null;
    connectionId?: string | null;
    name: string;
    sourceType: RedditSourcePack["source_type"];
    subreddits: string[];
    savedRefs?: RedditSavedRef[];
    multiredditRefs?: RedditMultiRef[];
    isDefaultForValidation?: boolean;
}) {
    const admin = createAdmin();
    const isDefault = Boolean(input.isDefaultForValidation);
    const normalizedSubs = normalizeSubredditList(input.subreddits || []);

    if (isDefault) {
        await admin
            .from("user_reddit_source_packs")
            .update({ is_default_for_validation: false })
            .eq("user_id", input.userId)
            .neq("id", input.packId || "00000000-0000-0000-0000-000000000000");
    }

    const payload = {
        user_id: input.userId,
        connection_id: input.connectionId || null,
        name: normalizePackName(input.name),
        source_type: input.sourceType,
        subreddits: normalizedSubs,
        saved_refs: input.savedRefs || [],
        multireddit_refs: input.multiredditRefs || [],
        is_default_for_validation: isDefault,
    };

    let error: { message?: string } | null = null;
    if (input.packId) {
        const result = await admin
            .from("user_reddit_source_packs")
            .update(payload)
            .eq("id", input.packId)
            .eq("user_id", input.userId);
        error = result.error;
    } else {
        const result = await admin
            .from("user_reddit_source_packs")
            .insert(payload);
        error = result.error;
    }

    if (error) {
        throw new Error(`Could not save Reddit source pack: ${error.message}`);
    }

    const packs = await listSourcePacks(input.userId);
    if (input.packId) {
        return packs.find((pack) => pack.id === input.packId) || packs[0] || null;
    }
    return packs.find((pack) => pack.name === payload.name && pack.source_type === payload.source_type) || packs[0] || null;
}

export async function deleteSourcePack(userId: string, packId: string) {
    const admin = createAdmin();
    const { error } = await admin
        .from("user_reddit_source_packs")
        .delete()
        .eq("id", packId)
        .eq("user_id", userId);

    if (error) {
        throw new Error(`Could not delete Reddit source pack: ${error.message}`);
    }
}

export async function deleteProxyProfile(userId: string, profileId: string) {
    const admin = createAdmin();
    const { error } = await admin
        .from("user_proxy_profiles")
        .delete()
        .eq("id", profileId)
        .eq("user_id", userId);

    if (error) {
        throw new Error(`Could not delete proxy profile: ${error.message}`);
    }
}

export async function ensureFreshRedditConnection(userId: string, origin: string, connectionId?: string | null) {
    const decrypted = await getDecryptedRedditConnection(userId, connectionId);
    if (!decrypted) return null;

    const expiresAt = parseIsoDate(decrypted.token_expires_at || null);
    const shouldRefresh =
        !decrypted.access_token ||
        (Number.isFinite(expiresAt) && expiresAt - Date.now() < 5 * 60_000);

    if (!shouldRefresh) {
        return decrypted;
    }

    if (!decrypted.refresh_token) {
        await upsertEncryptedRedditConnection({
            userId,
            connectionId: decrypted.id,
            redditUserId: decrypted.reddit_user_id || null,
            redditUsername: decrypted.reddit_username,
            accountMode: decrypted.account_mode,
            status: "needs_reauth",
            accessToken: null,
            refreshToken: null,
            grantedScopes: decrypted.granted_scopes,
            tokenExpiresAt: decrypted.token_expires_at || null,
            profileMetadata: decrypted.profile_metadata,
            syncedSubreddits: decrypted.synced_subreddits,
            savedRefs: decrypted.saved_refs,
            multiredditRefs: decrypted.multireddit_refs,
            lastSyncedAt: decrypted.last_synced_at || null,
            lastTokenRefreshAt: toIsoOrNull(new Date()),
            lastError: "Refresh token missing; reconnect Reddit.",
        });
        return await getDecryptedRedditConnection(userId, decrypted.id);
    }

    try {
        const refreshed = await refreshRedditToken(origin, decrypted.refresh_token);
        const nextScopes = normalizeScopes(refreshed.scope || decrypted.granted_scopes);
        const expiresAtIso = new Date(Date.now() + Math.max(60, Number(refreshed.expires_in || 3600)) * 1000).toISOString();
        await upsertEncryptedRedditConnection({
            userId,
            connectionId: decrypted.id,
            redditUserId: decrypted.reddit_user_id || null,
            redditUsername: decrypted.reddit_username,
            accountMode: decrypted.account_mode,
            status: "connected",
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token || decrypted.refresh_token,
            grantedScopes: nextScopes,
            tokenExpiresAt: expiresAtIso,
            profileMetadata: decrypted.profile_metadata,
            syncedSubreddits: decrypted.synced_subreddits,
            savedRefs: decrypted.saved_refs,
            multiredditRefs: decrypted.multireddit_refs,
            lastSyncedAt: decrypted.last_synced_at || null,
            lastTokenRefreshAt: new Date().toISOString(),
            lastError: null,
        });
        return await getDecryptedRedditConnection(userId, decrypted.id);
    } catch (error) {
        await upsertEncryptedRedditConnection({
            userId,
            connectionId: decrypted.id,
            redditUserId: decrypted.reddit_user_id || null,
            redditUsername: decrypted.reddit_username,
            accountMode: decrypted.account_mode,
            status: "needs_reauth",
            accessToken: null,
            refreshToken: decrypted.refresh_token,
            grantedScopes: decrypted.granted_scopes,
            tokenExpiresAt: decrypted.token_expires_at || null,
            profileMetadata: decrypted.profile_metadata,
            syncedSubreddits: decrypted.synced_subreddits,
            savedRefs: decrypted.saved_refs,
            multiredditRefs: decrypted.multireddit_refs,
            lastSyncedAt: decrypted.last_synced_at || null,
            lastTokenRefreshAt: toIsoOrNull(new Date()),
            lastError: error instanceof Error ? error.message : "Could not refresh Reddit token.",
        });
        return await getDecryptedRedditConnection(userId, decrypted.id);
    }
}

export async function syncAndPersistRedditConnection(input: {
    userId: string;
    origin: string;
    connectionId?: string | null;
    accountMode?: RedditAccountMode | null;
}) {
    const existing = await ensureFreshRedditConnection(input.userId, input.origin, input.connectionId);
    if (!existing || !existing.access_token) {
        throw new Error("No active Reddit connection available to sync.");
    }

    const snapshot = await syncRedditSnapshot(existing.access_token, existing.granted_scopes);
    const connectionId = await upsertEncryptedRedditConnection({
        userId: input.userId,
        connectionId: existing.id,
        redditUserId: snapshot.reddit_user_id || existing.reddit_user_id || null,
        redditUsername: snapshot.reddit_username || existing.reddit_username,
        accountMode: input.accountMode || existing.account_mode,
        status: "connected",
        accessToken: existing.access_token,
        refreshToken: existing.refresh_token || null,
        grantedScopes: snapshot.granted_scopes,
        tokenExpiresAt: existing.token_expires_at || null,
        profileMetadata: snapshot.profile_metadata,
        syncedSubreddits: snapshot.synced_subreddits,
        savedRefs: snapshot.saved_refs,
        multiredditRefs: snapshot.multireddit_refs,
        lastSyncedAt: new Date().toISOString(),
        lastTokenRefreshAt: existing.last_token_refresh_at || null,
        lastError: null,
    });

    await upsertSourcePack({
        userId: input.userId,
        connectionId,
        name: "Synced Reddit Universe",
        sourceType: "synced",
        subreddits: snapshot.synced_subreddits,
        savedRefs: snapshot.saved_refs,
        multiredditRefs: snapshot.multireddit_refs,
        isDefaultForValidation: true,
    });

    return getRedditConnectionSummary(input.userId);
}

export async function getRedditLabState(userId: string): Promise<RedditLabState> {
    const [connection, sourcePacks] = await Promise.all([
        getRedditConnectionSummary(userId),
        listSourcePacks(userId),
    ]);

    return {
        enabled: isRedditConnectionLabEnabled(),
        oauth_configured: hasRedditOauthConfig(),
        connection,
        source_packs: sourcePacks,
    };
}

export async function loadSourcePackForUser(userId: string, packId?: string | null) {
    const packs = await listSourcePacks(userId);
    if (packs.length === 0) return null;
    if (packId) {
        return packs.find((pack) => pack.id === packId) || null;
    }
    return packs.find((pack) => pack.is_default_for_validation) || packs[0] || null;
}

export async function resolveRedditLabContextForValidation(
    userId: string,
    origin: string,
    options?: RedditLabValidationOptions | null,
    includeSecrets = false,
): Promise<{ preview: RedditLabExecutionPreview; workerContext?: RedditLabWorkerContext } | null> {
    if (!options || (
        !options.connection_id &&
        !options.source_pack_id &&
        !options.use_connected_context
    )) {
        return null;
    }

    const pack = await loadSourcePackForUser(userId, options.source_pack_id || null);
    const connection = options.connection_id || options.use_connected_context
        ? await ensureFreshRedditConnection(userId, origin, options.connection_id || null)
        : null;

    if (options.use_connected_context && (!connection || !connection.access_token)) {
        throw new Error("Connected Reddit context was requested, but no usable Reddit connection is available.");
    }

    const preview: RedditLabExecutionPreview = {
        enabled: true,
        connection_id: connection?.id || null,
        reddit_username: connection?.reddit_username || null,
        account_mode: connection?.account_mode || null,
        source_pack_id: pack?.id || null,
        source_pack_name: pack?.name || null,
        source_pack_subreddits: pack?.subreddits || [],
        use_connected_context: Boolean(options.use_connected_context && connection?.access_token),
    };

    if (!includeSecrets) {
        return { preview };
    }

    const workerContext: RedditLabWorkerContext = {
        ...preview,
        connected_access_token: preview.use_connected_context ? connection?.access_token || null : null,
        connected_granted_scopes: preview.use_connected_context ? connection?.granted_scopes || [] : [],
    };

    return { preview, workerContext };
}

export async function verifyProxyUrl(proxyUrl: string) {
    const python = process.env.PYTHON || "python";
    const script = [
        "import json, requests, sys",
        "proxy = sys.argv[1]",
        "proxies = {'http': proxy, 'https': proxy}",
        "resp = requests.get('https://www.reddit.com/.json', proxies=proxies, timeout=12, headers={'User-Agent': 'CueIdea/1.0 proxy verify'})",
        "print(json.dumps({'status_code': resp.status_code, 'ok': bool(resp.ok)}))",
    ].join("; ");

    try {
        const { stdout } = await execFileAsync(python, ["-c", script, proxyUrl], { timeout: 20_000 });
        const payload = safeParseJson<{ status_code?: number; ok?: boolean }>(stdout.trim(), {});
        if (payload.ok && Number(payload.status_code) >= 200 && Number(payload.status_code) < 400) {
            return { ok: true, status: "ready" as const, detail: `Verified via Reddit (${payload.status_code})` };
        }
        return {
            ok: false,
            status: "error" as const,
            detail: `Proxy responded with status ${Number(payload.status_code || 0) || "unknown"}`,
        };
    } catch (error) {
        return {
            ok: false,
            status: "error" as const,
            detail: error instanceof Error ? error.message : "Proxy verification failed.",
        };
    }
}

export function extractIdeaSubreddits(idea: Record<string, unknown>) {
    const topPosts = parseTopPosts(idea.top_posts);
    return normalizeSubredditList(
        topPosts
            .map((post) => String(post.subreddit || ""))
            .filter(Boolean),
    );
}

export async function buildRedditUniverseMarketPreview(userId: string, sourcePackId?: string | null) {
    const pack = await loadSourcePackForUser(userId, sourcePackId || null);
    const packSubs = normalizeSubredditList(pack?.subreddits || []);
    if (!pack || packSubs.length === 0) {
        return {
            mode: "my_reddit_universe" as const,
            source_pack: pack,
            ideas: [] as RedditUniverseMarketIdea[],
        };
    }

    const admin = createAdmin();
    const { data, error } = await admin
        .from("ideas")
        .select("id, slug, topic, category, current_score, confidence_level, source_count, top_posts")
        .limit(50)
        .order("current_score", { ascending: false });

    if (error) {
        throw new Error(`Could not build Reddit universe preview: ${error.message}`);
    }

    const ideas = (data || [])
        .map((row) => {
            const ideaSubs = extractIdeaSubreddits(row as Record<string, unknown>);
            const matched = ideaSubs.filter((sub) => packSubs.includes(sub));
            if (matched.length === 0) return null;
            const topPosts = parseTopPosts(row.top_posts);
            return {
                id: String(row.id || ""),
                slug: String(row.slug || ""),
                topic: String(row.topic || ""),
                category: String(row.category || ""),
                current_score: Number(row.current_score || 0),
                confidence_level: String(row.confidence_level || ""),
                matched_subreddits: matched,
                source_count: Number(row.source_count || 0),
                top_titles: topPosts.map((post) => String(post.title || "")).filter(Boolean).slice(0, 3),
            } satisfies RedditUniverseMarketIdea;
        })
        .filter((idea): idea is RedditUniverseMarketIdea => Boolean(idea))
        .sort((left, right) => {
            if (right.matched_subreddits.length !== left.matched_subreddits.length) {
                return right.matched_subreddits.length - left.matched_subreddits.length;
            }
            return right.current_score - left.current_score;
        })
        .slice(0, 20);

    return {
        mode: "my_reddit_universe" as const,
        source_pack: pack,
        ideas,
    };
}
