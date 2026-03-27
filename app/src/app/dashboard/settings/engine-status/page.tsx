import Link from "next/link";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type EngineSnapshot = {
    lastRunAt: string | null;
    updatedIdeas24h: number;
    source: "scraper_runs" | "ideas";
    note: string;
};

function getEngineHealth(lastRunAt: string | null) {
    if (!lastRunAt) {
        return {
            label: "Engine Offline",
            tone: "text-dont border-dont/25 bg-dont/10",
            detail: "No recent scraper heartbeat was found.",
        };
    }

    const hoursAgo = (Date.now() - Date.parse(lastRunAt)) / 3_600_000;
    if (hoursAgo <= 6) {
        return {
            label: "Engine Live",
            tone: "text-build border-build/25 bg-build/10",
            detail: "Scraper activity is fresh.",
        };
    }

    if (hoursAgo <= 24) {
        return {
            label: "Engine Stale",
            tone: "text-risky border-risky/25 bg-risky/10",
            detail: "The engine has not reported in the last 6 hours.",
        };
    }

    return {
        label: "Engine Offline",
        tone: "text-dont border-dont/25 bg-dont/10",
        detail: "No scraper activity in the last 24 hours.",
    };
}

async function loadEngineSnapshot(): Promise<EngineSnapshot> {
    const supabase = await createClient();
    const fallbackNote = "Fell back to ideas.last_updated because scraper_runs was unavailable.";
    const ideas24hIso = new Date(Date.now() - 24 * 3_600_000).toISOString();

    let updatedIdeas24h = 0;
    try {
        const { count } = await supabase
            .from("ideas")
            .select("id", { count: "exact", head: true })
            .gte("last_updated", ideas24hIso);
        updatedIdeas24h = count || 0;
    } catch {
        updatedIdeas24h = 0;
    }

    try {
        const { data: run } = await supabase
            .from("scraper_runs")
            .select("started_at, completed_at, status")
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (run) {
            return {
                lastRunAt: String(run.completed_at || run.started_at || ""),
                updatedIdeas24h,
                source: "scraper_runs",
                note: "Using scraper_runs as the primary engine heartbeat.",
            };
        }
    } catch {
        // Fall through to ideas fallback.
    }

    try {
        const { data: latestIdea } = await supabase
            .from("ideas")
            .select("last_updated, updated_at")
            .order("last_updated", { ascending: false })
            .limit(1)
            .maybeSingle();

        return {
            lastRunAt: String(latestIdea?.last_updated || latestIdea?.updated_at || ""),
            updatedIdeas24h,
            source: "ideas",
            note: fallbackNote,
        };
    } catch {
        return {
            lastRunAt: null,
            updatedIdeas24h,
            source: "ideas",
            note: fallbackNote,
        };
    }
}

export default async function EngineStatusPage() {
    const snapshot = await loadEngineSnapshot();
    const health = getEngineHealth(snapshot.lastRunAt);
    const lastRunLabel = snapshot.lastRunAt
        ? new Date(snapshot.lastRunAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
        : "No run detected";

    return (
        <div className="max-w-4xl mx-auto px-6 pt-8 pb-24">
            <div className="mb-6">
                <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Internal</div>
                <h1 className="mt-2 text-[32px] font-bold font-display tracking-tight-custom text-white">Engine Status</h1>
                <p className="text-sm text-muted-foreground mt-1">Builder-only heartbeat for scraper freshness and data coverage.</p>
            </div>

            <div className={`rounded-[16px] border p-5 ${health.tone}`}>
                <div className="text-[11px] font-mono uppercase tracking-[0.12em]">Status</div>
                <div className="mt-2 text-2xl font-semibold text-white">{health.label}</div>
                <p className="mt-2 text-sm text-foreground/80">{health.detail}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="bento-cell p-5 rounded-[16px]">
                    <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Last Scraper Run</div>
                    <div className="mt-3 text-xl font-semibold text-white">{lastRunLabel}</div>
                    <p className="mt-2 text-xs text-muted-foreground">{snapshot.note}</p>
                </div>

                <div className="bento-cell p-5 rounded-[16px]">
                    <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Ideas Updated 24h</div>
                    <div className="mt-3 text-xl font-semibold text-white">{snapshot.updatedIdeas24h.toLocaleString()}</div>
                    <p className="mt-2 text-xs text-muted-foreground">Counts ideas whose `last_updated` moved in the last 24 hours.</p>
                </div>

                <div className="bento-cell p-5 rounded-[16px]">
                    <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">Data Source</div>
                    <div className="mt-3 text-xl font-semibold text-white">{snapshot.source === "scraper_runs" ? "scraper_runs" : "ideas fallback"}</div>
                    <p className="mt-2 text-xs text-muted-foreground">Helps distinguish a healthy engine from a stale public surface.</p>
                </div>
            </div>

            <div className="mt-6">
                <Link
                    href="/dashboard/settings"
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-white hover:border-primary/30 transition-colors"
                >
                    ← Back to Settings
                </Link>
            </div>
        </div>
    );
}
