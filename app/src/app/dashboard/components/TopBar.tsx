"use client";

import { useEffect, useState } from "react";

export function TopBar({
    postCount,
    modelCount,
    ideaCount,
}: {
    postCount: number;
    modelCount: number;
    ideaCount: number;
}) {
    const [clock, setClock] = useState("");

    useEffect(() => {
        const formatClock = () => new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
        setClock(formatClock());
        const interval = setInterval(() => setClock(formatClock()), 1000);
        return () => clearInterval(interval);
    }, []);

    return (
        <header
            className="sticky top-0 z-50 h-11 flex items-center justify-between px-6"
            style={{
                background: "hsla(0,0%,4%,0.7)",
                borderBottom: "1px solid hsl(0 0% 100% / 0.07)",
                backdropFilter: "blur(20px)",
            }}
        >
            <div className="flex items-center gap-4">
                <span className="font-display text-[15px] font-bold tracking-[0.08em]">
                    <span className="text-muted-foreground">O</span>{" "}
                    <span className="text-foreground">REDDIT</span>
                    <span className="text-primary">PULSE</span>
                </span>

                <div className="h-3 w-px bg-border hidden sm:block" />

                <div
                    className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full"
                    style={{ background: "hsla(134,61%,55%,0.08)", border: "1px solid hsla(134,61%,55%,0.2)" }}
                >
                    <span className="w-[5px] h-[5px] rounded-full bg-build status-live" style={{ animation: "pulse-green 2s ease infinite" }} />
                    <span className="text-[11px] font-mono font-medium text-build">LIVE</span>
                </div>

                <div className="h-3 w-px bg-border hidden md:block" />

                <span className="hidden md:inline text-[11px] font-mono text-muted-foreground">
                    {ideaCount.toLocaleString()} ideas · {postCount.toLocaleString()} posts
                </span>
            </div>

            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                    {Array.from({ length: Math.max(modelCount, 1) }).slice(0, 5).map((_, index) => (
                        <div
                            key={index}
                            className="w-[7px] h-[7px] rounded-full"
                            style={{ background: index === 0 ? "#ff4500" : index === 1 ? "#ff6534" : "hsla(16,100%,50%,0.5)" }}
                        />
                    ))}
                </div>
                <div className="h-3 w-px bg-border" />
                <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{clock}</span>
            </div>
        </header>
    );
}
