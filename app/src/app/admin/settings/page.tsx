import { RuntimeSettingsForm } from "@/app/admin/AdminActions";
import { AdminPageHeader, AdminPill, AdminSection, EmptyAdminState } from "@/app/admin/components";
import { getAdminSettingsData } from "@/lib/admin-data";

export default async function AdminSettingsPage() {
    const data = await getAdminSettingsData();

    return (
        <div className="space-y-6 pb-16">
            <AdminPageHeader
                eyebrow="System Settings"
                title="Runtime flags and operator defaults"
                description="This page controls first-party runtime settings. Some self-hosted capabilities remain capability-gated by environment variables."
            />

            <AdminSection title="Runtime settings" description="Persisted flags in runtime_settings.">
                <RuntimeSettingsForm initial={data.runtimeSettings} />
            </AdminSection>

            <AdminSection title="Capabilities" description="Environment-backed abilities available to this local environment.">
                <div className="flex flex-wrap gap-2">
                    <AdminPill tone={data.capabilities.scraperControl ? "healthy" : "warning"}>scraper control {data.capabilities.scraperControl ? "enabled" : "disabled"}</AdminPill>
                    <AdminPill tone="healthy">first-party analytics enabled</AdminPill>
                    <AdminPill tone={data.capabilities.aiVisibility ? "healthy" : "warning"}>AI visibility {data.capabilities.aiVisibility ? "enabled" : "disabled"}</AdminPill>
                </div>
            </AdminSection>
        </div>
    );
}
