import React from "react";
import Link from "next/link";
import Image from "next/image";

import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

type BrandLogoProps = {
    uppercase?: boolean;
    compact?: boolean;
    showSubtitle?: boolean;
    align?: "left" | "center";
    className?: string;
    href?: string | null;
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
    const iconSize = compact ? 24 : 38;
    const alignItems = align === "center" ? "items-center text-center" : "items-start text-left";
    const destinationLabel = href === "/dashboard" ? "Go to dashboard" : "Go to home";
    const content = (
        <>
            <div
                className="relative shrink-0"
                style={{
                    width: iconSize,
                    height: iconSize,
                    filter: "drop-shadow(0 0 18px rgba(249,115,22,0.28))",
                }}
            >
                <Image
                    src="/brand/cueidea-logo-512.png"
                    alt=""
                    fill
                    sizes={`${iconSize}px`}
                    className="object-contain"
                    aria-hidden="true"
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
        </>
    );

    if (!href) {
        return (
            <div
                className={`inline-flex items-center gap-3 no-underline ${className}`}
                aria-label={wordmark}
            >
                {content}
            </div>
        );
    }

    return (
        <Link
            href={href}
            aria-label={destinationLabel}
            title={destinationLabel}
            className={`inline-flex items-center gap-3 no-underline transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${className}`}
        >
            {content}
        </Link>
    );
}
