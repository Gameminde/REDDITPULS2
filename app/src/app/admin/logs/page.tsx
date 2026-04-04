import { AdminPageHeader, AdminPill, AdminSection, EmptyAdminState } from "@/app/admin/components";
import { getAdminLogsData } from "@/lib/admin-data";

export default async function AdminLogsPage() {
    const logs = await getAdminLogsData();

    return (
        <div className="space-y-6 pb-16">
            <AdminPageHeader
                eyebrow="Diagnostics"
                title="Merged event stream for operators"
                description="Admin events, scraper runs, validation failures, and analytics highlights in one terminal-like stream."
            />

            <AdminSection title="Live-ish log stream" description="DB-backed event aggregation suitable for beta diagnostics.">
                {logs.length > 0 ? (
                    <div className="space-y-3 font-mono text-xs">
                        {logs.map((entry) => (
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
