import { JobsControlPanel } from "@/app/admin/AdminActions";
import { AdminPageHeader, AdminPill, AdminSection, AdminStatCard, EmptyAdminState } from "@/app/admin/components";
import { getAdminJobsData } from "@/lib/admin-data";

function formatTimestamp(value: string | null) {
    if (!value) return "Unknown";
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function formatAge(value: string | null) {
    if (!value) return "Unknown";
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return value;
    const deltaMs = Date.now() - parsed;
    const minutes = Math.max(0, Math.round(deltaMs / 60000));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
}

function runtimeTone(state: string) {
    if (state === "running" || state === "idle") return "healthy" as const;
    if (state === "stale") return "warning" as const;
    if (state === "failed") return "degraded" as const;
    return "neutral" as const;
}

function unitTone(activeState: string) {
    if (activeState === "active") return "healthy" as const;
    if (activeState === "activating") return "warning" as const;
    if (activeState === "failed") return "degraded" as const;
    return "neutral" as const;
}

export default async function AdminJobsPage() {
    const data = await getAdminJobsData();

    return (
        <div className="space-y-6 pb-16">
            <AdminPageHeader
                eyebrow="Jobs & Operators"
                title="Scraper health, queue backlog, and runtime controls"
                description="Use this page to inspect latest runs, see backlog pressure, and toggle operator-level runtime flags."
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <AdminStatCard label="Run health" value={data.latestRunHealth.run_health} tone={data.latestRunHealth.run_health === "healthy" ? "healthy" : data.latestRunHealth.run_health === "degraded" ? "warning" : "degraded"} />
                <AdminStatCard label="Queued jobs" value={data.queue.queued} tone={data.queue.queued > 10 ? "warning" : "neutral"} />
                <AdminStatCard label="Running jobs" value={data.queue.running} />
                <AdminStatCard label="Failed today" value={data.queue.failedToday} tone={data.queue.failedToday > 0 ? "degraded" : "healthy"} />
            </div>

            <AdminSection
                title="Operator controls"
                description="Pause/resume flags are live. Force-run is capability-based and depends on ADMIN_SCRAPER_COMMAND."
                action={<JobsControlPanel scrapersPaused={data.runtimeSettings.scrapers_paused} validationsPaused={data.runtimeSettings.validations_paused} />}
            >
                <div className="grid gap-4 md:grid-cols-3">
                    {data.operatorNotes.map((item) => (
                        <div key={item.label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                            <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">{item.label}</div>
                            <div className="mt-2 text-lg font-semibold text-white">{item.value}</div>
                            <div className="mt-2">
                                <AdminPill tone={item.status === "healthy" ? "healthy" : item.status === "degraded" ? "warning" : "neutral"}>
                                    {item.status}
                                </AdminPill>
                            </div>
                        </div>
                    ))}
                </div>
            </AdminSection>

            <AdminSection
                title="Live scraper monitor"
                description="Direct runtime telemetry from this host. It reads the scraper log file and, when available, the systemd service/timer state."
                action={<AdminPill tone={runtimeTone(data.scraperRuntime.status.state)}>{data.scraperRuntime.status.label}</AdminPill>}
            >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <AdminStatCard
                        label="Runtime state"
                        value={data.scraperRuntime.status.label}
                        hint={data.scraperRuntime.status.detail}
                        tone={runtimeTone(data.scraperRuntime.status.state)}
                    />
                    <AdminStatCard
                        label="Service unit"
                        value={`${data.scraperRuntime.service.activeState}/${data.scraperRuntime.service.subState}`}
                        hint={data.scraperRuntime.service.error || data.scraperRuntime.service.name}
                        tone={unitTone(data.scraperRuntime.service.activeState)}
                    />
                    <AdminStatCard
                        label="Timer unit"
                        value={`${data.scraperRuntime.timer.activeState}/${data.scraperRuntime.timer.subState}`}
                        hint={data.scraperRuntime.timer.error || data.scraperRuntime.timer.name}
                        tone={unitTone(data.scraperRuntime.timer.activeState)}
                    />
                    <AdminStatCard
                        label="Last heartbeat"
                        value={formatAge(data.scraperRuntime.log.lastHeartbeatAt || data.scraperRuntime.log.updatedAt)}
                        hint={formatTimestamp(data.scraperRuntime.log.lastHeartbeatAt || data.scraperRuntime.log.updatedAt)}
                        tone={data.scraperRuntime.log.lastHeartbeatAt || data.scraperRuntime.log.updatedAt ? "neutral" : "warning"}
                    />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    <AdminPill>host {data.scraperRuntime.host}</AdminPill>
                    <AdminPill>platform {data.scraperRuntime.platform}</AdminPill>
                    <AdminPill tone={data.scraperRuntime.log.exists ? "healthy" : "warning"}>
                        log {data.scraperRuntime.log.exists ? "present" : "missing"}
                    </AdminPill>
                    <AdminPill tone={data.scraperRuntime.log.runInProgress ? "warning" : "neutral"}>
                        {data.scraperRuntime.log.runInProgress ? "run in progress" : "no active run observed"}
                    </AdminPill>
                    <AdminPill>log path {data.scraperRuntime.log.path}</AdminPill>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                        <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Runtime timing</div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <AdminStatCard
                                label="Last start"
                                value={formatTimestamp(data.scraperRuntime.log.lastStartedAt)}
                                hint={data.scraperRuntime.log.lastStartedAt ? formatAge(data.scraperRuntime.log.lastStartedAt) : "No start marker found in the current tail."}
                            />
                            <AdminStatCard
                                label="Last finish"
                                value={formatTimestamp(data.scraperRuntime.log.lastFinishedAt)}
                                hint={data.scraperRuntime.log.lastFinishedAt ? formatAge(data.scraperRuntime.log.lastFinishedAt) : "No finish marker found in the current tail."}
                                tone={data.scraperRuntime.log.runInProgress ? "warning" : "neutral"}
                            />
                        </div>
                        <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                            <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Latest progress line</div>
                            <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                                {data.scraperRuntime.log.lastLine || "No recent scraper log line was captured on this host."}
                            </p>
                        </div>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                        <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Runtime highlights</div>
                        {data.scraperRuntime.log.highlights.length > 0 ? (
                            <div className="mt-4 space-y-3 font-mono text-xs">
                                {data.scraperRuntime.log.highlights.slice(-8).reverse().map((entry) => (
                                    <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
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
                            <div className="mt-4">
                                <EmptyAdminState title="No runtime highlights yet" body="Once the scraper writes a tail line, warnings and progress markers will appear here." />
                            </div>
                        )}
                    </div>
                </div>
            </AdminSection>

            <AdminSection
                title="Market funnel"
                description="This shows exactly where scraped posts turn into topics, where they get blocked, and how many end up public."
            >
                <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                        <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Latest scraper run</div>
                        {data.latestRunFunnel ? (
                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                <AdminStatCard label="Scraped posts" value={data.latestRunFunnel.scraped_posts} />
                                <AdminStatCard label="Matched to topics" value={data.latestRunFunnel.matched_posts} />
                                <AdminStatCard label="Unmatched posts" value={data.latestRunFunnel.unmatched_posts} tone={data.latestRunFunnel.unmatched_posts > data.latestRunFunnel.matched_posts ? "warning" : "neutral"} />
                                <AdminStatCard label="Builder/meta blocked" value={data.latestRunFunnel.builder_meta_filtered_posts} tone={data.latestRunFunnel.builder_meta_filtered_posts > 0 ? "warning" : "healthy"} />
                                <AdminStatCard label="Dynamic themes" value={data.latestRunFunnel.dynamic_topics} />
                                <AdminStatCard label="Subreddit buckets" value={data.latestRunFunnel.subreddit_bucket_topics} />
                                <AdminStatCard label="Invalid topic skips" value={data.latestRunFunnel.invalid_topic_skips} tone={data.latestRunFunnel.invalid_topic_skips > 0 ? "warning" : "healthy"} />
                                <AdminStatCard label="Weak topic skips" value={data.latestRunFunnel.weak_topic_skips} tone={data.latestRunFunnel.weak_topic_skips > 0 ? "warning" : "warning"} />
                                <AdminStatCard label="Final ideas" value={data.latestRunFunnel.final_ideas} tone={data.latestRunFunnel.final_ideas > 0 ? "healthy" : "degraded"} />
                            </div>
                        ) : (
                            <div className="mt-4">
                                <EmptyAdminState title="No funnel note yet" body="Run the scraper once after this patch and the latest run will include a structured market funnel note." />
                            </div>
                        )}
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                        <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Current idea inventory</div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            <AdminStatCard label="Ideas in DB" value={data.currentMarketFunnel.totalIdeas} />
                            <AdminStatCard label="Public eligible" value={data.currentMarketFunnel.publicEligible} tone={data.currentMarketFunnel.publicEligible > 0 ? "healthy" : "warning"} />
                            <AdminStatCard label="Public rejected" value={data.currentMarketFunnel.publicRejected} tone={data.currentMarketFunnel.publicRejected > data.currentMarketFunnel.publicEligible ? "warning" : "neutral"} />
                            <AdminStatCard label="User feed visible" value={data.currentMarketFunnel.userFeedVisible} tone={data.currentMarketFunnel.userFeedVisible > 0 ? "healthy" : "degraded"} />
                            <AdminStatCard label="Admin feed visible" value={data.currentMarketFunnel.adminFeedVisible} />
                            <AdminStatCard label="Visible market status" value={data.currentMarketFunnel.visibleMarketStatus} />
                            <AdminStatCard label="Needs focus" value={data.currentMarketFunnel.needsFocus} tone={data.currentMarketFunnel.needsFocus > 0 ? "warning" : "healthy"} />
                            <AdminStatCard label="Suppressed" value={data.currentMarketFunnel.suppressed} tone={data.currentMarketFunnel.suppressed > 0 ? "warning" : "neutral"} />
                        </div>

                        <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
                            <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Public rejection breakdown</div>
                            {data.currentMarketFunnel.rejectionBreakdown.length > 0 ? (
                                <div className="mt-3 space-y-2">
                                    {data.currentMarketFunnel.rejectionBreakdown.map((item) => (
                                        <div key={item.reason} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                                            <span className="text-sm text-white">{item.label}</span>
                                            <AdminPill tone="warning">{item.count}</AdminPill>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-3 text-sm text-muted-foreground">No public rejections are recorded in the current sample.</p>
                            )}
                        </div>
                    </div>
                </div>
            </AdminSection>

            <AdminSection title="Recent scraper runs" description="Latest market intelligence runs observed in scraper_runs.">
                {data.recentRuns.length > 0 ? (
                    <div className="space-y-3">
                        {data.recentRuns.map((run) => (
                            <div key={String(run.id || run.started_at)} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <AdminPill tone={String(run.status || "").toLowerCase() === "healthy" ? "healthy" : String(run.status || "").toLowerCase() === "degraded" ? "warning" : String(run.status || "").toLowerCase() === "failed" ? "degraded" : "neutral"}>
                                        {String(run.status || "unknown")}
                                    </AdminPill>
                                    <span className="text-xs text-muted-foreground">{String(run.started_at || "")}</span>
                                </div>
                                <div className="mt-2 text-sm text-white">{String(run.source || "market run")}</div>
                                <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{String(run.error_text || "No error text attached.")}</p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyAdminState title="No scraper runs yet" body="As soon as the market worker executes, its run metadata will appear here." />
                )}
            </AdminSection>
        </div>
    );
}
