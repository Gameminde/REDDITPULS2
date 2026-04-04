import { AdminPageHeader, AdminPill, AdminSection, AdminStatCard, EmptyAdminState } from "@/app/admin/components";
import { getAdminAiData } from "@/lib/admin-data";

export default async function AdminAiPage() {
    const rows = await getAdminAiData();

    return (
        <div className="space-y-6 pb-16">
            <AdminPageHeader
                eyebrow="AI Configs"
                title="Providers, models, and verification footprint"
                description="Admin-safe view of configured AI providers. Secrets stay encrypted and never appear here."
            />

            <div className="grid gap-4 md:grid-cols-3">
                <AdminStatCard label="Configs" value={rows.length} />
                <AdminStatCard label="Active configs" value={rows.filter((row) => row.is_active).length} tone="healthy" />
                <AdminStatCard label="Users with AI" value={new Set(rows.map((row) => row.user_id)).size} />
            </div>

            <AdminSection title="AI registry" description="Provider metadata only. No API keys are exposed.">
                {rows.length > 0 ? (
                    <div className="space-y-3">
                        {rows.map((row) => (
                            <div key={row.id} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div>
                                        <div className="text-sm font-medium text-white">{row.user_email}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">{row.provider_label} · {row.selected_model}</div>
                                        {row.endpoint_url ? <div className="mt-1 text-xs text-muted-foreground">{row.endpoint_url}</div> : null}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <AdminPill tone={row.is_active ? "healthy" : "neutral"}>{row.is_active ? "active" : "inactive"}</AdminPill>
                                        <AdminPill>priority {row.priority}</AdminPill>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyAdminState title="No AI configs yet" body="Once users save AI providers in settings, they will appear here with provider and model metadata." />
                )}
            </AdminSection>
        </div>
    );
}
