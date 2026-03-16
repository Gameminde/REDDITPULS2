import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { DashboardLayout } from "./DashboardLayout";

export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: React.ReactNode }) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    return (
        <DashboardLayout
            userEmail={profile?.email || user.email || "user"}
            userPlan={profile?.plan || "free"}
        >
            {children}
        </DashboardLayout>
    );
}
