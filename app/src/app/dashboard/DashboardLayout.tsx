"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { Dock } from "./components/Dock";
import { TopBar } from "./components/TopBar";

export function DashboardLayout({
    children,
    userEmail: _userEmail,
    userPlan: _userPlan,
}: {
    children: React.ReactNode;
    userEmail: string;
    userPlan: string;
}) {
    const pathname = usePathname();
    const supabase = useMemo(() => createClient(), []);
    const [ideaCount, setIdeaCount] = useState(0);
    const [postCount, setPostCount] = useState(0);
    const [modelCount, setModelCount] = useState(0);
    const [alertCount, setAlertCount] = useState(0);

    useEffect(() => {
        fetch("/api/ideas?limit=1")
            .then((r) => r.json())
            .then((res) => {
                setIdeaCount(res.total || 0);
            })
            .catch(() => {});

        fetch("/api/settings/ai")
            .then((r) => r.json())
            .then((res) => setModelCount((res.configs || []).filter((config: any) => config.is_active).length))
            .catch(() => {});

        const refreshAlerts = () => {
            fetch("/api/alerts")
                .then((r) => r.ok ? r.json() : { unread_count: 0 })
                .then((res) => setAlertCount(res.unread_count || 0))
                .catch(() => setAlertCount(0));
        };
        refreshAlerts();
        const alertInterval = setInterval(refreshAlerts, 60000);

        supabase.from("posts").select("*", { count: "exact", head: true }).then(({ count }) => {
            setPostCount(count || 0);
        });

        const channel = supabase
            .channel("post-count")
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, () => {
                setPostCount((prev) => prev + 1);
            })
            .subscribe();

        return () => {
            clearInterval(alertInterval);
            supabase.removeChannel(channel);
        };
    }, [supabase]);

    return (
        <div className="flex h-screen w-full relative selection:bg-primary/30 overflow-hidden">
            <div className="noise-overlay" />

            <div
                className="fixed pointer-events-none rounded-full"
                style={{
                    top: -200, left: -150, width: 700, height: 700,
                    filter: "blur(140px)", background: "hsla(16, 100%, 50%, 0.07)",
                    animation: "drift 18s ease-in-out infinite alternate", zIndex: 0,
                }}
            />
            <div
                className="fixed pointer-events-none rounded-full"
                style={{
                    bottom: -250, right: -100, width: 600, height: 600,
                    filter: "blur(120px)", background: "hsla(16, 70%, 50%, 0.05)",
                    animation: "drift 24s ease-in-out infinite alternate-reverse", zIndex: 0,
                }}
            />

            <div className="flex flex-col w-full h-full relative z-10">
                <TopBar
                    postCount={postCount}
                    modelCount={modelCount}
                    ideaCount={ideaCount}
                />
                <main className="flex-1 overflow-y-auto relative z-10 p-6 lg:p-8 pb-32">
                    {children}
                </main>
            </div>

            <Dock currentPath={pathname} alertCount={alertCount} />
        </div>
    );
}
