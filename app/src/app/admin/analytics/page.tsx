import { AdminPageHeader, AdminSection, AdminStatCard, EmptyAdminState } from "@/app/admin/components";
import { getAdminAnalyticsData } from "@/lib/admin-data";

export default async function AdminAnalyticsPage() {
    const data = await getAdminAnalyticsData(30);

    return (
        <div className="space-y-6 pb-16">
            <AdminPageHeader
                eyebrow="First-party Analytics"
                title="Traffic, acquisition, funnel, and product usage"
                description="All metrics here come from the internal analytics_events stack. No Plausible or PostHog needed for this beta."
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <AdminStatCard label="Pageviews" value={data.traffic.pageviews} hint="Tracked page_view events in the selected window." />
                <AdminStatCard label="Unique visitors" value={data.traffic.uniqueVisitors} hint="Distinct anonymous IDs from first-party tracking." />
                <AdminStatCard label="Sessions" value={data.traffic.sessions} hint="Distinct session IDs in analytics events." />
                <AdminStatCard label="Anonymous → signup" value={`${data.conversions.anonymousToSignupPct}%`} hint="First acquisition conversion slice." tone={data.conversions.anonymousToSignupPct >= 5 ? "healthy" : "warning"} />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <AdminSection title="Acquisition funnel" description="Simple beta funnel from landing to product entry.">
                    <div className="grid gap-3 md:grid-cols-2">
                        <AdminStatCard label="Landing view" value={data.funnel.landingView} />
                        <AdminStatCard label="Pricing view" value={data.funnel.pricingView} />
                        <AdminStatCard label="Signup start" value={data.funnel.signupStart} />
                        <AdminStatCard label="Signup success" value={data.funnel.signupSuccess} tone={data.funnel.signupSuccess > 0 ? "healthy" : "warning"} />
                        <AdminStatCard label="Login success" value={data.funnel.loginSuccess} />
                        <AdminStatCard label="Dashboard visits" value={data.funnel.dashboardFirstVisit} />
                    </div>
                </AdminSection>

                <AdminSection title="Product usage" description="What people do after entering the app.">
                    <div className="grid gap-3 md:grid-cols-2">
                        <AdminStatCard label="Validation starts" value={data.productUsage.validationStarts} />
                        <AdminStatCard label="Validation completed" value={data.productUsage.validationCompleted} />
                        <AdminStatCard label="Validation failed" value={data.productUsage.validationFailed} tone={data.productUsage.validationFailed > 0 ? "warning" : "healthy"} />
                        <AdminStatCard label="Reports viewed" value={data.productUsage.reportsViewed} />
                        <AdminStatCard label="Watchlist saves" value={data.productUsage.watchlistSaves} />
                        <AdminStatCard label="Alert creations" value={data.productUsage.alertCreations} />
                    </div>
                </AdminSection>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
                <AdminSection title="Top pages" description="Routes getting the most traffic.">
                    {data.traffic.topPages.length > 0 ? (
                        <div className="space-y-3">
                            {data.traffic.topPages.map((row) => (
                                <div key={row.route} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                                    <span className="truncate text-sm text-white">{row.route}</span>
                                    <span className="text-sm font-semibold text-primary">{row.count}</span>
                                </div>
                            ))}
                        </div>
                    ) : <EmptyAdminState title="No tracked pages yet" body="Pageview events will appear as soon as local tracking starts writing to analytics_events." />}
                </AdminSection>

                <AdminSection title="Top referrers" description="Traffic sources reaching the product.">
                    {data.traffic.topReferrers.length > 0 ? (
                        <div className="space-y-3">
                            {data.traffic.topReferrers.map((row) => (
                                <div key={row.referrer} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                                    <span className="truncate text-sm text-white">{row.referrer}</span>
                                    <span className="text-sm font-semibold text-primary">{row.count}</span>
                                </div>
                            ))}
                        </div>
                    ) : <EmptyAdminState title="No referrers yet" body="Direct traffic or early local tests may leave this list empty for now." />}
                </AdminSection>

                <AdminSection title="UTM sources" description="Campaign breakdown from the first-party tracker.">
                    {data.traffic.utmSources.length > 0 ? (
                        <div className="space-y-3">
                            {data.traffic.utmSources.map((row) => (
                                <div key={row.source} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                                    <span className="truncate text-sm text-white">{row.source}</span>
                                    <span className="text-sm font-semibold text-primary">{row.count}</span>
                                </div>
                            ))}
                        </div>
                    ) : <EmptyAdminState title="No UTM data yet" body="Once you share campaign links, this section will show which sources convert." />}
                </AdminSection>
            </div>
        </div>
    );
}
