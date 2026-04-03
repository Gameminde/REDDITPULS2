"use client";

import { createContext, useContext } from "react";

type DashboardViewer = {
    isGuest: boolean;
    userEmail: string;
    userPlan: string;
};

const DashboardViewerContext = createContext<DashboardViewer>({
    isGuest: false,
    userEmail: "user",
    userPlan: "free",
});

export function DashboardViewerProvider({
    value,
    children,
}: {
    value: DashboardViewer;
    children: React.ReactNode;
}) {
    return (
        <DashboardViewerContext.Provider value={value}>
            {children}
        </DashboardViewerContext.Provider>
    );
}

export function useDashboardViewer() {
    return useContext(DashboardViewerContext);
}
