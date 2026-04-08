import Link from "next/link";

import { RetryValidationButton } from "@/app/admin/AdminActions";
import { AdminPageHeader, AdminPill, AdminSection, AdminStatCard, EmptyAdminState } from "@/app/admin/components";
import { getAdminValidationsData } from "@/lib/admin-data";

export default async function AdminValidationsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const data = await getAdminValidationsData({
        status: typeof params.status === "string" ? params.status : undefined,
        depth: typeof params.depth === "string" ? params.depth : undefined,
        user: typeof params.user === "string" ? params.user : undefined,
        days: typeof params.days === "string" ? Number(params.days) : undefined,
    });

    return (
        <div className="space-y-6 pb-16">
            <AdminPageHeader
                eyebrow="Validations Monitor"
                title="Queue, outcomes, and per-run pipeline details"
                description="Inspect validation jobs, drill into progress logs, and retry failed or stale analyses from a single operator surface."
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <AdminStatCard label="Total" value={data.counts.total} />
                <AdminStatCard label="Queued" value={data.counts.queued} tone={data.counts.queued > 10 ? "warning" : "neutral"} />
                <AdminStatCard label="Running" value={data.counts.running} />
                <AdminStatCard label="Done" value={data.counts.done} tone="healthy" />
                <AdminStatCard label="Failed" value={data.counts.failed} tone={data.counts.failed > 0 ? "degraded" : "healthy"} />
            </div>

            <AdminSection title="Validation jobs" description="Open detail pages to inspect progress_log and report payloads.">
                {data.items.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                            <thead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                <tr className="border-b border-white/10">
                                    <th className="px-3 py-3">Idea</th>
                                    <th className="px-3 py-3">User</th>
                                    <th className="px-3 py-3">Depth</th>
                                    <th className="px-3 py-3">Status</th>
                                    <th className="px-3 py-3">Coverage</th>
                                    <th className="px-3 py-3">Verdict</th>
                                    <th className="px-3 py-3">Created</th>
                                    <th className="px-3 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.items.map((row) => (
                                    <tr key={row.id} className="border-b border-white/6 align-top">
                                        <td className="px-3 py-4">
                                            <div className="max-w-[360px] text-white">{row.idea_text}</div>
                                        </td>
                                        <td className="px-3 py-4 text-muted-foreground">{row.user_email}</td>
                                        <td className="px-3 py-4"><AdminPill>{row.depth}</AdminPill></td>
                                        <td className="px-3 py-4">
                                            <AdminPill tone={row.status === "done" ? "healthy" : row.status === "failed" ? "degraded" : row.status === "running" || row.status === "starting" ? "warning" : "neutral"}>
                                                {row.status}
                                            </AdminPill>
                                        </td>
                                        <td className="px-3 py-4">
                                            <div className="space-y-2">
                                                <AdminPill tone={row.coverage_status === "degraded" ? "warning" : "healthy"}>
                                                    {row.coverage_status === "degraded" ? "degraded" : "healthy"}
                                                </AdminPill>
                                                {row.coverage_summary ? (
                                                    <div className="max-w-[260px] text-xs leading-5 text-muted-foreground">
                                                        {row.coverage_summary}
                                                    </div>
                                                ) : null}
                                            </div>
                                        </td>
                                        <td className="px-3 py-4 text-muted-foreground">{row.verdict || "-"}</td>
                                        <td className="px-3 py-4 text-muted-foreground">{row.created_at ? new Date(row.created_at).toLocaleString() : "-"}</td>
                                        <td className="px-3 py-4">
                                            <div className="flex justify-end gap-2">
                                                <Link href={`/admin/validations/${row.id}`} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground transition hover:border-primary/20 hover:text-white">
                                                    View
                                                </Link>
                                                <RetryValidationButton validationId={row.id} />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <EmptyAdminState title="No validations found" body="As soon as users enqueue validations, they will appear here with status, verdict, and detail links." />
                )}
            </AdminSection>
        </div>
    );
}
