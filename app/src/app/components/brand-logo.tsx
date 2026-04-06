import React from "react";
import Link from "next/link";

import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

type BrandLogoProps = {
    uppercase?: boolean;
    compact?: boolean;
    showSubtitle?: boolean;
    align?: "left" | "center";
    className?: string;
    href?: string;
};

export function BrandLogo({
    uppercase = false,
    compact = false,
    showSubtitle = false,
    align = "left",
    className = "",
    href = "/",
}: BrandLogoProps) {
    const wordmark = uppercase ? APP_NAME.toUpperCase() : APP_NAME;
    const iconSize = compact ? 23 : 36;
    const innerRadius = compact ? 9 : 13;
    const alignItems = align === "center" ? "items-center text-center" : "items-start text-left";

    return (
        <Link href={href} className={`inline-flex items-center gap-3 no-underline ${className}`}>
            <div
                className="relative shrink-0 rounded-[14px] border border-primary/25"
                style={{
                    width: iconSize,
                    height: iconSize,
                    background:
                        "radial-gradient(circle at 28% 24%, rgba(255,220,168,0.96), rgba(251,146,60,0.95) 34%, rgba(249,115,22,0.96) 58%, rgba(124,45,18,0.94) 100%)",
                    boxShadow:
                        "0 0 0 1px rgba(249,115,22,0.18), 0 0 24px rgba(249,115,22,0.28), inset 0 1px 0 rgba(255,255,255,0.24)",
                }}
            >
                <div
                    className="absolute inset-[3px] rounded-[11px] border border-white/10"
                    style={{
                        background:
                            "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.01))",
                    }}
                />
                <div
                    className="absolute rounded-full bg-white/90"
                    style={{
                        width: compact ? 4 : 6,
                        height: compact ? 4 : 6,
                        left: compact ? 6 : 9,
                        top: compact ? 6 : 8,
                        boxShadow: "0 0 16px rgba(255,255,255,0.8)",
                    }}
                />
                <div
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20"
                    style={{
                        width: innerRadius,
                        height: innerRadius,
                        boxShadow: "inset 0 0 12px rgba(255,255,255,0.14)",
                    }}
                />
                <div
                    className="absolute left-1/2 top-1/2 rounded-full bg-white"
                    style={{
                        width: compact ? 3 : 5,
                        height: compact ? 3 : 5,
                        transform: "translate(-50%, -50%)",
                        boxShadow: "0 0 18px rgba(255,255,255,0.95)",
                    }}
                />
                <div
                    className="absolute rounded-full"
                    style={{
                        width: compact ? 14 : 20,
                        height: compact ? 14 : 20,
                        right: compact ? -2 : -4,
                        bottom: compact ? -2 : -4,
                        background: "radial-gradient(circle, rgba(251,146,60,0.5), rgba(251,146,60,0))",
                        filter: "blur(4px)",
                    }}
                />
            </div>

            <div className={`flex min-w-0 flex-col justify-center ${alignItems}`}>
                <span
                    className={`font-display font-extrabold tracking-[-0.035em] text-white ${compact ? "text-[12px]" : "text-[19px]"}`}
                    style={{
                        textShadow: "0 0 24px rgba(249,115,22,0.2)",
                    }}
                >
                    <span
                        style={{
                            background:
                                "linear-gradient(135deg, rgba(255,245,235,0.98), rgba(255,188,120,0.96) 42%, rgba(251,146,60,0.95) 100%)",
                            WebkitBackgroundClip: "text",
                            backgroundClip: "text",
                            color: "transparent",
                        }}
                    >
                        {wordmark}
                    </span>
                </span>
                {showSubtitle ? (
                    <span className="max-w-[240px] text-[10px] uppercase tracking-[0.18em] text-muted-foreground/85">
                        {APP_TAGLINE}
                    </span>
                ) : null}
            </div>
        </Link>
    );
}
