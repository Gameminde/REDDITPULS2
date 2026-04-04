import { JobsControlPanel } from "@/app/admin/AdminActions";
import { AdminPageHeader, AdminPill, AdminSection, AdminStatCard, EmptyAdminState } from "@/app/admin/components";
import { getAdminJobsData } from "@/lib/admin-data";

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
