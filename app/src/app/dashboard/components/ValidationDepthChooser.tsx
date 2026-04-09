"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronDown, FlaskConical, Search, Telescope } from "lucide-react";

import { getJoinBetaHref } from "@/lib/beta-access";
import { buildValidationHref, type ValidationPrefill } from "@/lib/validation-entry";
import { VALIDATION_DEPTHS, type ValidationDepth } from "@/lib/validation-depth";

const DEPTH_ICONS = {
    quick: Search,
    deep: FlaskConical,
    investigation: Telescope,
} as const;

interface ValidationDepthChooserProps {
    prefill: ValidationPrefill;
    isGuest?: boolean;
    className?: string;
    style?: CSSProperties;
    children: ReactNode;
    panelAlign?: "start" | "end";
    stopPropagation?: boolean;
    nextPath?: string;
}

function ValidationDepthOption({
    mode,
    isRecommended = false,
    onSelect,
}: {
    mode: ValidationDepth;
    isRecommended?: boolean;
    onSelect: (depth: ValidationDepth) => void;
}) {
    const option = VALIDATION_DEPTHS.find((item) => item.mode === mode);
    if (!option) return null;
    const Icon = DEPTH_ICONS[mode];

    return (
        <button
            type="button"
            onClick={() => onSelect(mode)}
            className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-left transition-colors hover:border-primary/25 hover:bg-primary/10"
        >
            <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isRecommended ? "bg-primary/15 text-primary" : "bg-white/[0.05] text-muted-foreground"}`}>
                    <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-[13px] font-semibold text-white">{option.label}</div>
                        {isRecommended && (
                            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.12em] text-primary">
                                Recommended
                            </span>
                        )}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{option.description}</div>
                    <div className="mt-2 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                        {option.uiCopy} · {option.paceLabel}
                    </div>
                </div>
            </div>
        </button>
    );
}

export function ValidationDepthChooser({
    prefill,
    isGuest = false,
    className,
    style,
    children,
    panelAlign = "end",
    stopPropagation = true,
    nextPath = "/dashboard",
}: ValidationDepthChooserProps) {
    const router = useRouter();
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        if (typeof window === "undefined") return;

        const updateViewport = () => setIsMobile(window.innerWidth < 768);
        updateViewport();
        window.addEventListener("resize", updateViewport);
        return () => window.removeEventListener("resize", updateViewport);
    }, []);

    useEffect(() => {
        if (!open || isMobile) return;

        const handlePointerDown = (event: MouseEvent) => {
            if (!wrapperRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpen(false);
            }
        };

        document.addEventListener("mousedown", handlePointerDown);
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("mousedown", handlePointerDown);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [open, isMobile]);

    const guestHref = useMemo(() => getJoinBetaHref(nextPath), [nextPath]);

    const openChooser = (event: ReactMouseEvent<HTMLButtonElement>) => {
        if (stopPropagation) {
            event.preventDefault();
            event.stopPropagation();
        }

        if (isGuest) {
            router.push(guestHref);
            return;
        }

        setOpen((current) => !current);
    };

    const chooseDepth = (depth: ValidationDepth) => {
        setOpen(false);
        router.push(buildValidationHref(prefill, depth));
    };

    const chooserBody = (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-primary">Choose validation depth</div>
                    <div className="mt-1 text-sm text-white">Pick how much research this idea should get.</div>
                </div>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground"
                >
                    Close
                </button>
            </div>

            <div className="space-y-2">
                <ValidationDepthOption mode="quick" isRecommended onSelect={chooseDepth} />
                <ValidationDepthOption mode="deep" onSelect={chooseDepth} />
                <ValidationDepthOption mode="investigation" onSelect={chooseDepth} />
            </div>
        </div>
    );

    return (
        <>
            <div
                ref={wrapperRef}
                className={className}
                style={{
                    position: "relative",
                    display: "inline-flex",
                    ...style,
                }}
            >
                <button
                    type="button"
                    onClick={openChooser}
                    className="inline-flex w-full items-center justify-center gap-2"
                    style={{ background: "transparent", border: "none", padding: 0, color: "inherit", cursor: "pointer" }}
                >
                    <span className="inline-flex items-center justify-center gap-2">{children}</span>
                    {!isGuest && <ChevronDown className="h-3.5 w-3.5 opacity-70" />}
                </button>

                {open && !isMobile && (
                    <div
                        className="absolute top-full z-[80] mt-2 w-[320px] rounded-[22px] border border-white/10 bg-[#0b1018]/95 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl"
                        style={{ [panelAlign]: 0 } as CSSProperties}
                        onClick={(event) => {
                            if (stopPropagation) {
                                event.preventDefault();
                                event.stopPropagation();
                            }
                        }}
                    >
                        {chooserBody}
                    </div>
                )}
            </div>

            {open && isMobile && mounted && createPortal(
                <div
                    className="fixed inset-0 z-[120] flex items-end bg-black/60 backdrop-blur-[2px]"
                    onClick={() => setOpen(false)}
                >
                    <div
                        className="w-full rounded-t-[28px] border border-white/10 bg-[#0b1018] p-4 pb-6 shadow-[0_-18px_60px_rgba(0,0,0,0.35)]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/10" />
                        {chooserBody}
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
