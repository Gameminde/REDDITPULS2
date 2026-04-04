import { UserPlanForm, UserRoleForm } from "@/app/admin/AdminActions";
import { AdminPageHeader, AdminPill, AdminSection, AdminStatCard, EmptyAdminState } from "@/app/admin/components";
import { getAdminUsersData } from "@/lib/admin-data";

export default async function AdminUsersPage() {
    const data = await getAdminUsersData();

    return (
        <div className="space-y-6 pb-16">
            <AdminPageHeader
                eyebrow="Users & Billing"
                title="Plans, roles, activity, and AI usage"
                description="Admin-facing user management with live plan and role updates. Billing remains UI-truthful while Stripe sync is still pending."
            />

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <AdminStatCard label="Total users" value={data.summary.totalUsers} />
                <AdminStatCard label="Paid users" value={data.summary.paidUsers} tone={data.summary.paidUsers > 0 ? "healthy" : "warning"} />
                <AdminStatCard label="Admins" value={data.summary.admins} />
                <AdminStatCard label="Active 7d" value={data.summary.activeLast7d} />
            </div>

            <AdminSection title="User table" description="Update plan and role directly from the admin surface.">
                {data.items.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                            <thead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                <tr className="border-b border-white/10">
                                    <th className="px-3 py-3">User</th>
                                    <th className="px-3 py-3">Plan</th>
                                    <th className="px-3 py-3">Role</th>
                                    <th className="px-3 py-3">Usage</th>
                                    <th className="px-3 py-3">Last active</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.items.map((row) => (
                                    <tr key={row.id} className="border-b border-white/6 align-top">
                                        <td className="px-3 py-4">
                                            <div className="text-white">{row.email}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">{row.full_name || row.id}</div>
                                        </td>
                                        <td className="px-3 py-4">
                                            <UserPlanForm userId={row.id} currentPlan={row.plan} />
                                        </td>
                                        <td className="px-3 py-4">
                                            <UserRoleForm userId={row.id} currentRole={row.role} />
                                        </td>
                                        <td className="px-3 py-4">
                                            <div className="flex flex-wrap gap-2">
                                                <AdminPill>{row.validations_count} validations</AdminPill>
                                                <AdminPill tone={row.active_ai_configs > 0 ? "healthy" : "neutral"}>{row.active_ai_configs} AI configs</AdminPill>
                                            </div>
                                        </td>
                                        <td className="px-3 py-4 text-muted-foreground">
                                            {row.last_active_at ? new Date(row.last_active_at).toLocaleString() : "No event yet"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <EmptyAdminState title="No users loaded" body="Auth users will appear here once Supabase auth is reachable from the admin service role." />
                )}
            </AdminSection>
        </div>
    );
}
