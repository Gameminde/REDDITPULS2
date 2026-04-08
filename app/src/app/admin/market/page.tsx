import { AdminPageHeader, AdminPill, AdminSection, AdminStatCard, EmptyAdminState } from "@/app/admin/components";
import { getAdminMarketData } from "@/lib/admin-data";

export default async function AdminMarketPage() {
    const data = await getAdminMarketData();

    return (
        <div className="space-y-6 pb-16">
            <AdminPageHeader
                eyebrow="Market Admin"
                title="Signal inventory, market status, and source health"
                description="A more raw operator-facing view of the market layer than the public board."
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <AdminStatCard label="Visible ideas" value={data.summary.visibleIdeas} />
                <AdminStatCard label="Rising" value={data.summary.risingIdeas} tone="healthy" />
                <AdminStatCard label="Falling" value={data.summary.fallingIdeas} tone={data.summary.fallingIdeas > 0 ? "warning" : "neutral"} />
                <AdminStatCard label="Needs wedge" value={data.summary.needsWedge} tone="warning" />
                <AdminStatCard label="Suppressed" value={data.summary.suppressedIdeas} />
            </div>

            <AdminSection
                title="Editorial shadow mode"
                description="AI output is stored for internal comparison first. Public cards still use heuristic copy until publish mode is enabled."
                action={<AdminPill tone={data.summary.publishMode === "publish" ? "warning" : "healthy"}>{data.summary.publishMode}</AdminPill>}
            >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <AdminStatCard label="Editorial reviewed" value={data.summary.editorialReviewed} />
                    <AdminStatCard label="Visible ideas" value={data.summary.visibleIdeas} />
                    <AdminStatCard label="Rising ideas" value={data.summary.risingIdeas} tone="healthy" />
                    <AdminStatCard label="Suppressed ideas" value={data.summary.suppressedIdeas} tone={data.summary.suppressedIdeas > 0 ? "warning" : "neutral"} />
                </div>
            </AdminSection>

            <AdminSection
                title="Source health"
                description="Derived from the most recent scraper run."
                action={
                    <AdminPill tone={data.sourceHealth.run_health === "healthy" ? "healthy" : data.sourceHealth.run_health === "degraded" ? "warning" : "degraded"}>
                        {data.sourceHealth.run_health}
                    </AdminPill>
                }
            >
                <div className="flex flex-wrap gap-2">
                    {(data.sourceHealth.healthy_sources || []).map((source) => <AdminPill key={source} tone="healthy">{source}</AdminPill>)}
                    {(data.sourceHealth.degraded_sources || []).map((source) => <AdminPill key={source} tone="warning">{source}</AdminPill>)}
                </div>
            </AdminSection>

            <AdminSection title="Visibility reasons" description="Why ideas are currently hidden from the user-facing radar.">
                {data.visibilityBreakdown.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {data.visibilityBreakdown.map((item) => (
                            <AdminPill key={item.reason} tone={item.reason === "duplicate" || item.reason === "editorial_hidden" ? "warning" : "neutral"}>
                                {item.label}: {item.count}
                            </AdminPill>
                        ))}
                    </div>
                ) : (
                    <EmptyAdminState title="Nothing hidden right now" body="All currently hydrated ideas are visible, or the hidden pool is empty in this sample." />
                )}
            </AdminSection>

            <AdminSection title="Top signals" description="Highest-scoring market opportunities right now.">
                {data.topIdeas.length > 0 ? (
                    <div className="space-y-3">
                        {data.topIdeas.map((idea) => (
                            <div key={String(idea.id || idea.slug)} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div>
                                        <div className="text-sm font-medium text-white">{String(idea.topic || "")}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                            {String(idea.category || "general")} · {String(idea.market_status || "visible")} · {String(idea.visibility_decision?.reason || "visible")}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <AdminPill>{Number(idea.current_score || 0)} score</AdminPill>
                                        <AdminPill tone={Number(idea.change_24h || 0) >= 0 ? "healthy" : "warning"}>
                                            {Number(idea.change_24h || 0) >= 0 ? "+" : ""}{Number(idea.change_24h || 0).toFixed(1)} 24h
                                        </AdminPill>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyAdminState title="No market signals yet" body="Once ideas are available in the ideas table, the admin market view will populate automatically." />
                )}
            </AdminSection>

            <AdminSection title="Heuristic vs AI" description="Review AI editorial output before allowing it to replace public market copy.">
                {data.editorialComparisons.length > 0 ? (
                    <div className="space-y-3">
                        {data.editorialComparisons.map((item) => (
                            <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-medium text-white">{item.heuristic_title}</div>
                                    <AdminPill tone={item.status === "success" ? "healthy" : "warning"}>{item.status}</AdminPill>
                                    <AdminPill tone={item.critic_visibility_decision === "public" ? "healthy" : item.critic_visibility_decision === "duplicate" ? "warning" : "neutral"}>
                                        {item.critic_visibility_decision}
                                    </AdminPill>
                                    <AdminPill>{item.quality_score} quality</AdminPill>
                                </div>

                                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                        <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Heuristic</div>
                                        <div className="mt-2 text-sm font-medium text-white">{item.heuristic_title}</div>
                                        <p className="mt-2 text-sm text-muted-foreground">{item.heuristic_summary || "No heuristic summary."}</p>
                                        <p className="mt-3 text-xs text-muted-foreground">Verdict: {item.heuristic_verdict || "No heuristic verdict."}</p>
                                    </div>

                                    <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-3">
                                        <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-orange-200/80">AI shadow output</div>
                                        <div className="mt-2 text-sm font-medium text-white">{item.ai_title || "No AI title yet."}</div>
                                        <p className="mt-2 text-sm text-muted-foreground">{item.ai_summary || "No AI summary yet."}</p>
                                        <p className="mt-3 text-xs text-muted-foreground">Verdict: {item.ai_verdict || "No AI verdict."}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">Next step: {item.ai_next_step || "No AI next step."}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyAdminState title="No editorial comparisons yet" body="Once shadow-mode runs complete, this page will show heuristic vs AI copy for review." />
                )}
            </AdminSection>
        </div>
    );
}
