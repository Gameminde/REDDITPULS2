"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Dock } from "./components/Dock";
import { TopBar } from "./components/TopBar";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { DashboardViewerProvider } from "./viewer-context";

export function DashboardLayout({
    children,
    userEmail,
    userPlan,
    isGuest,
}: {
    children: React.ReactNode;
    userEmail: string;
    userPlan: string;
    isGuest: boolean;
}) {
    const pathname = usePathname();
    const [ideaCount, setIdeaCount] = useState(0);
    const [postCount, setPostCount] = useState(0);
    const [modelCount, setModelCount] = useState(0);
    const [alertCount, setAlertCount] = useState(0);

    useEffect(() => {
        const refreshMarketSummary = () => {
            fetch("/api/discover", { cache: "no-store" })
                .then((r) => r.ok ? r.json() : Promise.reject(new Error("Failed to load market summary")))
                .then((res) => {
                    setIdeaCount(Number(res.archiveIdeaCount || res.ideaCount || 0));
                    setPostCount(Number(res.archivePostCount || res.trackedPostCount || 0));
                })
                .catch(() => {});
        };

        if (isGuest) {
            setModelCount(0);
        } else {
            fetch("/api/settings/ai")
                .then((r) => r.ok ? r.json() : Promise.reject(new Error("Failed to load AI settings")))
                .then((res) => setModelCount((res.configs || []).filter((config: any) => config.is_active).length))
                .catch(() => {});
        }

        const refreshAlerts = () => {
            if (!FEATURE_FLAGS.ALERTS_ENABLED || isGuest) {
                setAlertCount(0);
                return;
            }
            fetch("/api/alerts")
                .then((r) => r.ok ? r.json() : { unread_count: 0 })
                .then((res) => setAlertCount(res.unread_count || 0))
                .catch(() => setAlertCount(0));
        };
        const refreshWhenVisible = () => {
            if (typeof document === "undefined" || document.visibilityState === "visible") {
                refreshMarketSummary();
                refreshAlerts();
            }
        };

        refreshMarketSummary();
        refreshAlerts();
        document.addEventListener("visibilitychange", refreshWhenVisible);
        const marketInterval = setInterval(refreshMarketSummary, 60000);
        const alertInterval = FEATURE_FLAGS.ALERTS_ENABLED && !isGuest ? setInterval(refreshAlerts, 60000) : null;

        return () => {
            document.removeEventListener("visibilitychange", refreshWhenVisible);
            clearInterval(marketInterval);
            if (alertInterval) clearInterval(alertInterval);
        };
    }, [isGuest]);

    return (
        <DashboardViewerProvider value={{ isGuest, userEmail, userPlan }}>
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
                        isGuest={isGuest}
                        postCount={postCount}
                        modelCount={modelCount}
                        ideaCount={ideaCount}
                        userEmail={isGuest ? "" : userEmail}
                    />
                    <main className="relative z-10 flex-1 overflow-y-auto px-2 pb-28 pt-2 sm:px-2.5 sm:pt-2.5 md:px-3.5 md:pt-3.5 lg:px-4 lg:pt-3 lg:pb-24">
                        {children}
                    </main>
                </div>

                <Dock currentPath={pathname} alertCount={alertCount} isGuest={isGuest} />
            </div>
        </DashboardViewerProvider>
    );
}
