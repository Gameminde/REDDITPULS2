import Link from "next/link";

import { RetryValidationButton } from "@/app/admin/AdminActions";
import { AdminPageHeader, AdminPill, AdminSection, AdminStatCard, EmptyAdminState } from "@/app/admin/components";
import { getAdminValidationDetail } from "@/lib/admin-data";

export default async function AdminValidationDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const detail = await getAdminValidationDetail(id);

    if (!detail) {
        return <EmptyAdminState title="Validation not found" body="The requested validation either does not exist or is no longer available." />;
    }

    return (
        <div className="space-y-6 pb-16">
            <div className="flex items-center justify-between gap-4">
                <AdminPageHeader
                    eyebrow="Validation Detail"
                    title="Pipeline detail and report payload"
                    description={`Inspection surface for validation ${detail.id}.`}
                />
                <div className="flex gap-2">
                    <Link href="/admin/validations" className="rounded-xl border border-white/10 px-3 py-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground transition hover:border-primary/20 hover:text-white">
                        Back
                    </Link>
                    <RetryValidationButton validationId={detail.id} />
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <AdminStatCard label="Status" value={detail.status} tone={detail.status === "done" ? "healthy" : detail.status === "failed" ? "degraded" : "warning"} />
                <AdminStatCard label="Depth" value={detail.depth} />
                <AdminStatCard label="Verdict" value={detail.verdict || "-"} />
                <AdminStatCard label="Confidence" value={detail.confidence ?? "-"} />
            </div>

            <AdminSection title="Core metadata" description="Idea, owner, and timestamps.">
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Idea</div>
                        <div className="mt-2 text-sm text-white">{detail.idea_text}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-2 text-sm text-muted-foreground">
                        <div><span className="text-white">User:</span> {detail.user_email}</div>
                        <div><span className="text-white">Model:</span> {detail.model || "-"}</div>
                        <div><span className="text-white">Created:</span> {detail.created_at ? new Date(detail.created_at).toLocaleString() : "-"}</div>
                        <div><span className="text-white">Completed:</span> {detail.completed_at ? new Date(detail.completed_at).toLocaleString() : "-"}</div>
                    </div>
                </div>
            </AdminSection>

            <AdminSection title="Progress log" description="Timeline emitted by the validation worker.">
                {detail.progress_log.length > 0 ? (
                    <div className="space-y-2 font-mono text-xs">
                        {detail.progress_log.map((entry, index) => {
                            const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
                            return (
                                <div key={index} className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-muted-foreground">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <AdminPill>{String(row.stream || "log")}</AdminPill>
                                        <span>{String(row.at || "")}</span>
                                    </div>
                                    <div className="mt-2 whitespace-pre-wrap text-white/90">{String(row.message || JSON.stringify(entry))}</div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <EmptyAdminState title="No progress log attached" body="Older validations or failed inserts may not have worker progress yet." />
                )}
            </AdminSection>

            <AdminSection title="Report JSON" description="Raw report payload stored on the validation row.">
                <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-muted-foreground">
                    {JSON.stringify(detail.report, null, 2)}
                </pre>
            </AdminSection>
        </div>
    );
}
