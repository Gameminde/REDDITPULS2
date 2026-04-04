import { AdminPageHeader, AdminPill, AdminSection, AdminStatCard, EmptyAdminState } from "@/app/admin/components";
import { getAdminOverviewData } from "@/lib/admin-data";

export default async function AdminOverviewPage() {
    const data = await getAdminOverviewData();

    return (
        <div className="space-y-6 pb-16">
            <AdminPageHeader
                eyebrow="Admin Overview"
                title="System pulse, growth pulse, and runtime truth"
                description="A compact control surface for scraper health, validation flow, market freshness, and first-party analytics."
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <AdminStatCard label="Validations today" value={data.kpis.validationsToday} hint="New validation jobs started in the last 24h." tone="healthy" />
                <AdminStatCard label="Updated ideas 24h" value={data.kpis.updatedIdeas24h} hint="Ideas whose market state moved recently." />
                <AdminStatCard label="Landing pageviews 24h" value={data.kpis.landingPageviews24h} hint="First-party tracked page views for /." />
                <AdminStatCard label="BUILD IT rate" value={`${data.kpis.buildItRate}%`} hint="Share of completed validations landing in BUILD IT." tone={data.kpis.buildItRate >= 35 ? "healthy" : "warning"} />
                <AdminStatCard label="Queued validations" value={data.kpis.queuedValidations} hint="Backlog waiting to run." tone={data.kpis.queuedValidations > 10 ? "warning" : "neutral"} />
                <AdminStatCard label="Running validations" value={data.kpis.runningValidations} hint="Active pipeline executions." />
                <AdminStatCard label="Recent signups" value={data.kpis.recentSignups24h} hint="Auth users created over the last 24h." />
                <AdminStatCard label="Login successes" value={data.kpis.loginSuccess24h} hint="Observed auth successes over the last 24h." />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
                <AdminSection
                    title="Runtime status"
                    description="Health derived from the latest scraper run plus operator runtime flags."
                    action={
                        <div className="flex flex-wrap gap-2">
                            <AdminPill tone={data.systemHealth.run_health === "healthy" ? "healthy" : data.systemHealth.run_health === "degraded" ? "warning" : "degraded"}>
                                {data.systemHealth.run_health}
                            </AdminPill>
                            <AdminPill tone={data.runtimeSettings.scrapers_paused ? "warning" : "neutral"}>
                                scrapers {data.runtimeSettings.scrapers_paused ? "paused" : "live"}
                            </AdminPill>
                            <AdminPill tone={data.runtimeSettings.validations_paused ? "warning" : "neutral"}>
                                validations {data.runtimeSettings.validations_paused ? "paused" : "live"}
                            </AdminPill>
                        </div>
                    }
                >
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                            <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Healthy sources</div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {(data.systemHealth.healthy_sources || []).length > 0 ? data.systemHealth.healthy_sources.map((source) => (
                                    <AdminPill key={source} tone="healthy">{source}</AdminPill>
                                )) : <AdminPill>No source reported</AdminPill>}
                            </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                            <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Degraded sources</div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {(data.systemHealth.degraded_sources || []).length > 0 ? data.systemHealth.degraded_sources.map((source) => (
                                    <AdminPill key={source} tone="warning">{source}</AdminPill>
                                )) : <AdminPill tone="healthy">none</AdminPill>}
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <AdminStatCard label="Reddit mode" value={data.systemHealth.reddit_access_mode} hint={data.systemHealth.reddit_degraded_reason || "Latest observed Reddit access lane."} tone={data.systemHealth.reddit_degraded_reason ? "warning" : "neutral"} />
                        <AdminStatCard label="Reddit posts" value={data.systemHealth.reddit_post_count} hint="Posts attached to the latest run." />
                        <AdminStatCard label="Reddit request failures" value={data.systemHealth.reddit_failed_requests} hint="Failures parsed from latest run metadata." tone={data.systemHealth.reddit_failed_requests > 0 ? "warning" : "healthy"} />
                    </div>
                </AdminSection>

                <AdminSection
                    title="Estimated revenue / cost"
                    description="Explicit placeholders until billing and per-model cost telemetry are wired."
                >
                    <div className="space-y-4">
                        <AdminStatCard label="AI cost today" value={data.estimated.aiCostToday} badge="Estimated" hint="Exact per-model cost tracking is not wired yet." tone="warning" />
                        <AdminStatCard label="Billing summary" value={data.estimated.billingSummary} badge="Mock" hint="Stripe revenue sync will replace this placeholder." tone="warning" />
                        <AdminStatCard label="Users online" value={data.estimated.usersOnlineLive} badge="Estimated" hint="Will derive from session activity later." tone="warning" />
                    </div>
                </AdminSection>
            </div>

            <AdminSection
                title="DB usage"
                description={data.dbUsage.note}
                action={<AdminPill tone={data.dbUsage.pressureTone}>{data.dbUsage.pressureLabel}</AdminPill>}
            >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <AdminStatCard label="Tracked rows" value={data.dbUsage.totalTrackedRows} hint="Combined rows across the main operational tables." />
                    <AdminStatCard label="Posts" value={data.dbUsage.counts.posts} hint="Raw market/source rows stored so far." />
                    <AdminStatCard label="Idea history" value={data.dbUsage.counts.ideaHistory} hint="Historical snapshots powering trend movement." />
                    <AdminStatCard label="Ideas" value={data.dbUsage.counts.ideas} hint="Current market entities in the board/feed." />
                    <AdminStatCard label="Validations" value={data.dbUsage.counts.ideaValidations} hint="Stored validation jobs and reports." />
                    <AdminStatCard label="Scraper runs" value={data.dbUsage.counts.scraperRuns} hint="Operational run history for the market engine." />
                    <AdminStatCard label="Analytics events" value={data.dbUsage.counts.analyticsEvents} hint="First-party events tracked in the new admin stack." />
                </div>
            </AdminSection>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
                <AdminSection title="Recent activity" description="Validation, scraper, admin, and analytics events merged into one stream.">
                    {data.recentActivity.length > 0 ? (
                        <div className="space-y-3">
                            {data.recentActivity.map((entry) => (
                                <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <AdminPill tone={entry.severity === "error" ? "degraded" : entry.severity === "warning" ? "warning" : "neutral"}>{entry.source}</AdminPill>
                                        <span className="text-xs text-muted-foreground">{new Date(entry.at).toLocaleString()}</span>
                                    </div>
                                    <div className="mt-2 text-sm font-medium text-white">{entry.title}</div>
                                    <p className="mt-1 text-sm text-muted-foreground">{entry.message}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <EmptyAdminState title="No recent activity yet" body="Once analytics, validations, or scraper runs land, this stream will fill automatically." />
                    )}
                </AdminSection>

                <AdminSection title="Mini market pulse" description="Top visible opportunities from the live market board.">
                    {data.topIdeas.length > 0 ? (
                        <div className="space-y-3">
                            {data.topIdeas.map((idea) => (
                                <div key={String(idea.id)} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <div className="text-sm font-medium text-white">{String(idea.topic || "")}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">{String(idea.category || "general")} · {String(idea.market_status || "visible")}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xl font-semibold text-white">{Number(idea.current_score || 0)}</div>
                                            <div className="text-xs text-muted-foreground">{Number(idea.change_24h || 0) >= 0 ? "+" : ""}{Number(idea.change_24h || 0).toFixed(1)} 24h</div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <EmptyAdminState title="No market ideas yet" body="Run the market scraper or refresh the connected data source." />
                    )}
                </AdminSection>
            </div>
        </div>
    );
}
