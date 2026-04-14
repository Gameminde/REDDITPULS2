import { AdminPageHeader, AdminPill, AdminSection, EmptyAdminState } from "@/app/admin/components";
import { getAdminLogsData } from "@/lib/admin-data";

function formatTimestamp(value: string | null) {
    if (!value) return "Unknown";
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function runtimeTone(state: string) {
    if (state === "running" || state === "idle") return "healthy" as const;
    if (state === "stale") return "warning" as const;
    if (state === "failed") return "degraded" as const;
    return "neutral" as const;
}

export default async function AdminLogsPage() {
    const data = await getAdminLogsData();

    return (
        <div className="space-y-6 pb-16">
            <AdminPageHeader
                eyebrow="Diagnostics"
                title="Merged event stream for operators"
                description="Admin events, scraper runs, validation failures, and analytics highlights in one terminal-like stream."
            />

            <AdminSection
                title="Scraper runtime"
                description="Direct scraper telemetry from this host: service/timer state, log path, and the latest tail lines."
                action={<AdminPill tone={runtimeTone(data.scraperRuntime.status.state)}>{data.scraperRuntime.status.label}</AdminPill>}
            >
                <div className="flex flex-wrap gap-2">
                    <AdminPill>host {data.scraperRuntime.host}</AdminPill>
                    <AdminPill>platform {data.scraperRuntime.platform}</AdminPill>
                    <AdminPill tone={data.scraperRuntime.service.activeState === "active" ? "healthy" : data.scraperRuntime.service.activeState === "activating" ? "warning" : "neutral"}>
                        service {data.scraperRuntime.service.activeState}/{data.scraperRuntime.service.subState}
                    </AdminPill>
                    <AdminPill tone={data.scraperRuntime.timer.activeState === "active" ? "healthy" : "neutral"}>
                        timer {data.scraperRuntime.timer.activeState}/{data.scraperRuntime.timer.subState}
                    </AdminPill>
                    <AdminPill tone={data.scraperRuntime.log.exists ? "healthy" : "warning"}>
                        log {data.scraperRuntime.log.exists ? "present" : "missing"}
                    </AdminPill>
                    <AdminPill>{data.scraperRuntime.log.path}</AdminPill>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Latest summary</div>
                        <p className="mt-3 text-sm text-muted-foreground">
                            {data.scraperRuntime.log.summaryLine || data.scraperRuntime.log.lastLine || data.scraperRuntime.status.detail}
                        </p>
                        <div className="mt-4 text-xs text-muted-foreground">
                            Last heartbeat: {formatTimestamp(data.scraperRuntime.log.lastHeartbeatAt || data.scraperRuntime.log.updatedAt)}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Warning highlights</div>
                        {data.scraperRuntime.log.highlights.length > 0 ? (
                            <div className="mt-3 space-y-2 font-mono text-xs">
                                {data.scraperRuntime.log.highlights.slice(-8).reverse().map((entry) => (
                                    <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <AdminPill tone={entry.severity === "error" ? "degraded" : entry.severity === "warning" ? "warning" : "neutral"}>
                                                {entry.severity}
                                            </AdminPill>
                                            <span className="text-muted-foreground">{formatTimestamp(entry.at)}</span>
                                        </div>
                                        <pre className="mt-2 whitespace-pre-wrap text-muted-foreground">{entry.line}</pre>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="mt-3 text-sm text-muted-foreground">No highlight lines were found in the current scraper tail.</p>
                        )}
                    </div>
                </div>
            </AdminSection>

            <AdminSection title="Raw scraper tail" description="Last lines from the VPS scraper log file. This is the fastest way to see where a run is currently stuck or progressing.">
                {data.scraperRuntime.log.tailLines.length > 0 ? (
                    <pre className="max-h-[34rem] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
                        {data.scraperRuntime.log.tailLines.join("\n")}
                    </pre>
                ) : (
                    <EmptyAdminState title="No scraper tail available" body={data.scraperRuntime.log.error || "The scraper log could not be read from this host yet."} />
                )}
            </AdminSection>

            <AdminSection title="Live-ish log stream" description="DB-backed event aggregation plus scraper runtime highlights.">
                {data.entries.length > 0 ? (
                    <div className="space-y-3 font-mono text-xs">
                        {data.entries.map((entry) => (
                            <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <AdminPill tone={entry.severity === "error" ? "degraded" : entry.severity === "warning" ? "warning" : "neutral"}>{entry.source}</AdminPill>
                                    <span className="text-muted-foreground">{new Date(entry.at).toLocaleString()}</span>
                                </div>
                                <div className="mt-2 text-sm text-white">{entry.title}</div>
                                <pre className="mt-2 whitespace-pre-wrap text-muted-foreground">{entry.message}</pre>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyAdminState title="No diagnostic entries yet" body="Once admin events, failures, or scraper runs accumulate, they will appear here." />
                )}
            </AdminSection>
        </div>
    );
}
