import { requireAdmin } from "@/lib/admin-auth";
import { AdminShell } from "@/app/admin/AdminShell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    const context = await requireAdmin("/admin");

    return (
        <AdminShell
            actor={{
                email: context.user.email || context.profile?.email || "admin",
                role: context.role,
            }}
        >
            {children}
        </AdminShell>
    );
}
