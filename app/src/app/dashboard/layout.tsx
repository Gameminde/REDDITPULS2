import { createClient } from "@/lib/supabase-server";
import { BETA_FULL_ACCESS, BETA_OPEN } from "@/lib/beta-access";
import { redirect } from "next/navigation";
import { DashboardLayout } from "./DashboardLayout";

export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: React.ReactNode }) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const isGuest = !user;
    if (isGuest && !BETA_OPEN) redirect("/login");

    const profile = user ? (
        await supabase
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .single()
    ).data : null;

    return (
        <DashboardLayout
            isGuest={isGuest}
            userEmail={profile?.email || user?.email || "beta guest"}
            userPlan={user ? (BETA_FULL_ACCESS ? "beta" : profile?.plan || "free") : "free"}
        >
            {children}
        </DashboardLayout>
    );
}
