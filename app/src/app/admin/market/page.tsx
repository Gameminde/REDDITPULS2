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

            <AdminSection title="Top signals" description="Highest-scoring market opportunities right now.">
                {data.topIdeas.length > 0 ? (
                    <div className="space-y-3">
                        {data.topIdeas.map((idea) => (
                            <div key={String(idea.id || idea.slug)} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div>
                                        <div className="text-sm font-medium text-white">{String(idea.topic || "")}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">{String(idea.category || "general")} · {String(idea.market_status || "visible")}</div>
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
        </div>
    );
}
