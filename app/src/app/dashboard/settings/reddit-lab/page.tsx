"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, PlugZap, RefreshCcw, Rocket, Shield } from "lucide-react";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { type RedditConnectionSummary, type RedditSourcePack } from "@/lib/reddit-lab";

type RedditLabState = {
    enabled: boolean;
    oauth_configured: boolean;
    connection: RedditConnectionSummary | null;
    source_packs: RedditSourcePack[];
};

type MarketPreview = {
    mode: "my_reddit_universe";
    source_pack: RedditSourcePack | null;
    ideas: Array<{
        id: string;
        slug: string;
        topic: string;
        category: string;
        current_score: number;
        confidence_level: string;
        matched_subreddits: string[];
        source_count: number;
        top_titles: string[];
    }>;
};

function splitSubs(value: string) {
    return value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

export default function RedditLabPage() {
    const searchParams = useSearchParams();
    const [state, setState] = useState<RedditLabState | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string>("");
    const [packName, setPackName] = useState("Custom Research Pack");
    const [packSubs, setPackSubs] = useState("");
    const [selectedPackId, setSelectedPackId] = useState<string>("");
    const [marketMode, setMarketMode] = useState<"global" | "my_reddit_universe">("global");
    const [marketPreview, setMarketPreview] = useState<MarketPreview | null>(null);

    const defaultPack = useMemo(
        () => state?.source_packs?.find((pack) => pack.is_default_for_validation) || state?.source_packs?.[0] || null,
        [state?.source_packs],
    );

    async function loadState() {
        setLoading(true);
        try {
            const res = await fetch("/api/settings/lab/reddit/connection", { cache: "no-store" });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || "Could not load Reddit lab.");
            setState(payload);
            setSelectedPackId((current) => current || payload.source_packs?.find((pack: RedditSourcePack) => pack.is_default_for_validation)?.id || "");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not load Reddit lab.");
        } finally {
            setLoading(false);
        }
    }

    async function loadMarketPreview(packId?: string) {
        if (marketMode !== "my_reddit_universe") return;
        const query = packId ? `?source_pack_id=${encodeURIComponent(packId)}` : "";
        const res = await fetch(`/api/settings/lab/reddit/market-preview${query}`, { cache: "no-store" });
        const payload = await res.json();
        if (res.ok) setMarketPreview(payload);
    }

    useEffect(() => {
        void loadState();
    }, []);

    useEffect(() => {
        const connected = searchParams.get("connected");
        const error = searchParams.get("error");
        if (connected === "1") setMessage("Reddit connected successfully.");
        if (error) setMessage(error);
    }, [searchParams]);

    useEffect(() => {
        if (marketMode === "my_reddit_universe") {
            void loadMarketPreview(selectedPackId || defaultPack?.id || "");
        }
    }, [marketMode, selectedPackId, defaultPack?.id]);

    async function saveSourcePack() {
        setSaving(true);
        try {
            const res = await fetch("/api/settings/lab/reddit/source-packs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: packName,
                    subreddits: splitSubs(packSubs),
                    source_type: "manual",
                    is_default_for_validation: true,
                }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || "Could not save source pack.");
            setPackSubs("");
            setPackName("Custom Research Pack");
            setMessage("Source pack saved.");
            await loadState();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not save source pack.");
        } finally {
            setSaving(false);
        }
    }

    async function syncConnection() {
        setSaving(true);
        try {
            const res = await fetch("/api/settings/lab/reddit/sync", { method: "POST" });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || "Could not sync Reddit connection.");
            setMessage("Reddit connection synced.");
            await loadState();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not sync Reddit connection.");
        } finally {
            setSaving(false);
        }
    }

    if (!FEATURE_FLAGS.REDDIT_CONNECTION_LAB_ENABLED) {
        return <div className="max-w-4xl mx-auto px-6 pt-8 text-sm text-muted-foreground">Reddit Connection Lab is disabled.</div>;
    }

    return (
        <div className="max-w-6xl mx-auto px-6 pt-8 pb-10">
            <Link href="/dashboard/settings" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-white transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Settings
            </Link>

            <div className="mt-4 flex items-start justify-between gap-4">
                <div>
                    <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-mono uppercase tracking-[0.14em] text-primary" style={{ background: "hsl(var(--orange-dim))" }}>
                        <PlugZap className="h-3.5 w-3.5" />
                        Experimental
                    </div>
                    <h1 className="mt-3 text-[30px] font-bold font-display tracking-tight text-white">Reddit Connection Lab</h1>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                        Connect one Reddit account, build subreddit source packs, and shape what your normal validation flow will use automatically.
                    </p>
                </div>
            </div>

            {message && (
                <div className="mt-4 rounded-xl border px-4 py-3 text-sm text-slate-100" style={{ background: "hsl(0 0% 100% / 0.04)", borderColor: "hsl(0 0% 100% / 0.08)" }}>
                    {message}
                </div>
            )}

            {loading ? (
                <div className="mt-6 text-sm text-muted-foreground">Loading Reddit lab...</div>
            ) : (
                <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="space-y-6">
                        <section className="rounded-2xl border p-5" style={{ background: "hsl(0 0% 100% / 0.03)", borderColor: "hsl(0 0% 100% / 0.07)" }}>
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-semibold text-white">Connection</h2>
                                    <p className="text-xs text-muted-foreground">Optional Reddit account for smarter validation targeting.</p>
                                </div>
                                {state?.connection ? (
                                    <div className="inline-flex items-center gap-2 text-xs text-build"><CheckCircle2 className="h-4 w-4" /> Connected</div>
                                ) : null}
                            </div>

                            {!state?.oauth_configured ? (
                                <div
                                    className="mt-4 rounded-xl border px-4 py-3 text-sm text-amber-200"
                                    style={{ background: "hsla(42,96%,56%,0.08)", borderColor: "hsla(42,96%,56%,0.18)" }}
                                >
                                    <div className="flex items-start gap-2">
                                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                        <div>
                                            <div className="font-semibold text-white">Reddit OAuth is not configured locally yet.</div>
                                            <div className="mt-1 text-xs text-amber-100/90">
                                                Add <code>REDDIT_CLIENT_ID</code> and <code>REDDIT_CLIENT_SECRET</code> in <code>app/.env.local</code> or your deployed app environment, or use the explicit <code>REDDIT_OAUTH_*</code> equivalents, then try connect again.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : null}

                            {state?.connection ? (
                                <div className="mt-4 space-y-3 text-sm text-slate-200">
                                    <div>Username: <span className="text-white font-semibold">{state.connection.reddit_username}</span></div>
                                    <div>Scopes: <span className="text-muted-foreground">{state.connection.granted_scopes.join(", ") || "identity, read"}</span></div>
                                    <div className="flex gap-2">
                                        <button onClick={() => void syncConnection()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-primary" style={{ background: "hsl(var(--orange-dim))" }}>
                                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />} Sync
                                        </button>
                                        <button onClick={() => { window.location.href = "/api/settings/lab/reddit/oauth/start"; }} className="rounded-lg px-3 py-2 text-xs font-semibold text-white" style={{ background: "hsl(0 0% 100% / 0.06)" }}>
                                            Reconnect
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-4 flex flex-wrap gap-3">
                                    <a
                                        href={state?.oauth_configured ? "/api/settings/lab/reddit/oauth/start" : "#"}
                                        onClick={(event) => {
                                            if (!state?.oauth_configured) event.preventDefault();
                                        }}
                                        className="rounded-lg px-3 py-2 text-xs font-semibold text-primary"
                                        style={{
                                            background: "hsl(var(--orange-dim))",
                                            opacity: state?.oauth_configured ? 1 : 0.6,
                                            pointerEvents: state?.oauth_configured ? "auto" : "none",
                                        }}
                                    >
                                        Connect Reddit
                                    </a>
                                </div>
                            )}
                        </section>

                        <section className="rounded-2xl border p-5" style={{ background: "hsl(0 0% 100% / 0.03)", borderColor: "hsl(0 0% 100% / 0.07)" }}>
                            <h2 className="text-lg font-semibold text-white">Source packs</h2>
                            <p className="text-xs text-muted-foreground">Curate subreddit sets to steer validation targeting and the Reddit-universe preview.</p>
                            <div className="mt-4 grid gap-3">
                                <input value={packName} onChange={(event) => setPackName(event.target.value)} className="rounded-lg border bg-transparent px-3 py-2 text-sm text-white" style={{ borderColor: "hsl(0 0% 100% / 0.08)" }} placeholder="Pack name" />
                                <textarea value={packSubs} onChange={(event) => setPackSubs(event.target.value)} className="min-h-[88px] rounded-lg border bg-transparent px-3 py-2 text-sm text-white" style={{ borderColor: "hsl(0 0% 100% / 0.08)" }} placeholder="saas, microsaas, customersuccess" />
                                <button onClick={() => void saveSourcePack()} disabled={saving} className="rounded-lg px-3 py-2 text-xs font-semibold text-primary" style={{ background: "hsl(var(--orange-dim))" }}>
                                    Save source pack
                                </button>
                            </div>
                            <div className="mt-4 space-y-3">
                                {(state?.source_packs || []).map((pack) => (
                                    <div key={pack.id} className="rounded-xl border px-4 py-3" style={{ borderColor: "hsl(0 0% 100% / 0.06)", background: "hsl(0 0% 100% / 0.02)" }}>
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-semibold text-white">{pack.name}</div>
                                                <div className="text-xs text-muted-foreground">{pack.subreddits.join(", ") || "No subreddits yet"}</div>
                                            </div>
                                            {pack.is_default_for_validation ? <span className="text-[10px] uppercase tracking-[0.12em] text-build">Default</span> : null}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>

                    <div className="space-y-6">
                        <section className="rounded-2xl border p-5" style={{ background: "hsl(0 0% 100% / 0.03)", borderColor: "hsl(0 0% 100% / 0.07)" }}>
                            <div className="flex items-center justify-between">
                                <h2 className="text-lg font-semibold text-white">Market mode</h2>
                                <div className="flex rounded-lg p-1" style={{ background: "hsl(0 0% 100% / 0.04)" }}>
                                    <button onClick={() => setMarketMode("global")} className={`rounded-md px-3 py-1 text-xs font-semibold ${marketMode === "global" ? "text-primary" : "text-muted-foreground"}`}>Global market</button>
                                    <button onClick={() => setMarketMode("my_reddit_universe")} className={`rounded-md px-3 py-1 text-xs font-semibold ${marketMode === "my_reddit_universe" ? "text-primary" : "text-muted-foreground"}`}>My Reddit universe</button>
                                </div>
                            </div>
                            {marketMode === "global" ? (
                                <p className="mt-4 text-sm text-muted-foreground">The main market board stays unchanged in v1. This lab preview is only for your connected Reddit universe.</p>
                            ) : (
                                <div className="mt-4 space-y-3">
                                    {(marketPreview?.ideas || []).slice(0, 5).map((idea) => (
                                        <div key={idea.id} className="rounded-xl border px-4 py-3" style={{ borderColor: "hsl(0 0% 100% / 0.06)", background: "hsl(0 0% 100% / 0.02)" }}>
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-sm font-semibold text-white">{idea.topic}</div>
                                                    <div className="text-xs text-muted-foreground">{idea.matched_subreddits.join(", ")}</div>
                                                </div>
                                                <div className="text-xs text-primary">{idea.current_score}</div>
                                            </div>
                                        </div>
                                    ))}
                                    {marketPreview && marketPreview.ideas.length === 0 ? <div className="text-sm text-muted-foreground">No market ideas match your current subreddit pack yet.</div> : null}
                                </div>
                            )}
                        </section>

                        <section className="rounded-2xl border p-5" style={{ background: "hsl(0 0% 100% / 0.03)", borderColor: "hsl(0 0% 100% / 0.07)" }}>
                            <div className="flex items-center gap-2 text-white">
                                <Rocket className="h-4 w-4 text-primary" />
                                <h2 className="text-lg font-semibold">How this is used</h2>
                            </div>
                            <div className="mt-4 space-y-3 text-sm text-slate-200">
                                <p>
                                    Once Reddit is connected, your normal validation flow will use the connected Reddit account automatically.
                                </p>
                                <p className="text-muted-foreground">
                                    That means you still validate ideas from the usual <span className="text-white">Validate</span> page. This lab is only for connection, source-pack curation, and testing your Reddit universe.
                                </p>
                                <div className="flex gap-3">
                                    <Link href="/dashboard/validate" className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-primary" style={{ background: "hsl(var(--orange-dim))" }}>
                                        <Shield className="h-4 w-4" />
                                        Go to Validate
                                    </Link>
                                    <Link href="/dashboard" className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: "hsl(0 0% 100% / 0.06)" }}>
                                        Back to Market
                                    </Link>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            )}
        </div>
    );
}
