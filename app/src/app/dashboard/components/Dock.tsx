"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
    BarChart3,
    Bell,
    BookOpen,
    CircleHelp,
    Compass,
    CreditCard,
    FileText,
    Lightbulb,
    LogIn,
    Mail,
    Settings,
    Sparkles,
    TrendingUp,
} from "lucide-react";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { BETA_FULL_ACCESS, getBetaLoginHref, getJoinBetaHref } from "@/lib/beta-access";

const DASHBOARD_LOGIN_HREF = getBetaLoginHref("/dashboard");

interface DockNavItem {
    name: string;
    path: string;
    icon: typeof BarChart3;
    exact?: boolean;
}

const marketItems: DockNavItem[] = [
    ...(FEATURE_FLAGS.STOCK_MARKET_ENABLED ? [{ name: "Board", path: "/dashboard", icon: BarChart3, exact: true }] : []),
    ...(FEATURE_FLAGS.EXPLORE_ENABLED ? [{ name: "Explore", path: "/dashboard/explore", icon: Compass }] : []),
    ...(FEATURE_FLAGS.TRENDS_ENABLED ? [{ name: "Trends", path: "/dashboard/trends", icon: TrendingUp }] : []),
];

const validateItems: DockNavItem[] = [
    ...(FEATURE_FLAGS.VALIDATE_ENABLED ? [{ name: "Validate", path: "/dashboard/validate", icon: Lightbulb }] : []),
    ...(FEATURE_FLAGS.REPORTS_ENABLED ? [{ name: "Reports", path: "/dashboard/reports", icon: FileText }] : []),
];

const monitorItems: DockNavItem[] = [
    ...(FEATURE_FLAGS.SAVED_ENABLED ? [{ name: "Following", path: "/dashboard/saved", icon: BookOpen }] : []),
    ...(FEATURE_FLAGS.ALERTS_ENABLED ? [{ name: "Alerts", path: "/dashboard/alerts", icon: Bell }] : []),
    ...(FEATURE_FLAGS.DIGEST_ENABLED ? [{ name: "Digest", path: "/dashboard/digest", icon: Mail }] : []),
];

const infoItems: DockNavItem[] = [
    { name: "Pricing", path: "/dashboard/pricing", icon: CreditCard },
    { name: "How It Works", path: "/dashboard/how-it-works", icon: CircleHelp },
];

const mobileItems: DockNavItem[] = [
    ...(FEATURE_FLAGS.STOCK_MARKET_ENABLED ? [{ name: "Board", path: "/dashboard", icon: BarChart3, exact: true }] : []),
    ...(FEATURE_FLAGS.EXPLORE_ENABLED ? [{ name: "Explore", path: "/dashboard/explore", icon: Compass }] : []),
    ...(FEATURE_FLAGS.VALIDATE_ENABLED ? [{ name: "Validate", path: "/dashboard/validate", icon: Lightbulb }] : []),
    ...(FEATURE_FLAGS.REPORTS_ENABLED ? [{ name: "Reports", path: "/dashboard/reports", icon: FileText }] : []),
    ...(FEATURE_FLAGS.SAVED_ENABLED ? [{ name: "Following", path: "/dashboard/saved", icon: BookOpen }] : []),
];

const ACTIVE_VALIDATION_ID_KEY = "activeValidationId";
const ACTIVE_VALIDATION_IDEA_KEY = "activeValidationIdea";
const COMPLETED_VALIDATION_ID_KEY = "completedValidationId";
const VALIDATION_STORAGE_EVENT = "validation-storage";

function DockDivider() {
    return (
        <div
            style={{
                width: 1,
                height: 22,
                background: "hsl(0 0% 100% / 0.06)",
                margin: "0 2px",
                flexShrink: 0,
            }}
        />
    );
}

export function Dock({
    currentPath,
    alertCount,
    isGuest,
}: {
    currentPath: string;
    alertCount: number;
    isGuest: boolean;
}) {
    const [hasCompletedValidation, setHasCompletedValidation] = useState(false);
    const showBetaBadge = isGuest || BETA_FULL_ACCESS;
    const groups = (isGuest
        ? [marketItems, infoItems]
        : [marketItems, validateItems, monitorItems, infoItems]
    ).filter((group) => group.length > 0);
    const mobileDockItems = mobileItems.map((item) => {
        const guestAllowed = item.path === "/dashboard" || item.path === "/dashboard/explore";
        if (isGuest && !guestAllowed) {
            return { ...item, path: getJoinBetaHref(item.path), exact: false };
        }
        return item;
    });

    const emitValidationStorageChange = useCallback(() => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(new Event(VALIDATION_STORAGE_EVENT));
    }, []);

    const syncValidationBadge = useCallback(() => {
        if (typeof window === "undefined") return;
        setHasCompletedValidation(Boolean(window.localStorage.getItem(COMPLETED_VALIDATION_ID_KEY)));
    }, []);

    useEffect(() => {
        if (isGuest) {
            setHasCompletedValidation(false);
            return;
        }
        if (typeof window === "undefined") return;

        const onStorageChange = () => syncValidationBadge();
        syncValidationBadge();

        window.addEventListener("storage", onStorageChange);
        window.addEventListener(VALIDATION_STORAGE_EVENT, onStorageChange);
        return () => {
            window.removeEventListener("storage", onStorageChange);
            window.removeEventListener(VALIDATION_STORAGE_EVENT, onStorageChange);
        };
    }, [isGuest, syncValidationBadge]);

    useEffect(() => {
        if (isGuest) return;
        if (typeof window === "undefined") return;

        if (currentPath?.startsWith("/dashboard/validate")) {
            window.localStorage.removeItem(COMPLETED_VALIDATION_ID_KEY);
            emitValidationStorageChange();
        }

        const checkValidationStatus = async () => {
            const activeValidationId = window.localStorage.getItem(ACTIVE_VALIDATION_ID_KEY);
            if (!activeValidationId) return;

            try {
                const response = await fetch(`/api/validate/${activeValidationId}/status`, { cache: "no-store" });
                if (!response.ok) return;

                const data = await response.json();
                const status = data?.validation?.status;
                if (status === "done") {
                    window.localStorage.removeItem(ACTIVE_VALIDATION_ID_KEY);
                    window.localStorage.removeItem(ACTIVE_VALIDATION_IDEA_KEY);
                    window.localStorage.setItem(COMPLETED_VALIDATION_ID_KEY, activeValidationId);
                    emitValidationStorageChange();
                } else if (status === "failed" || status === "error" || status === "cancelled") {
                    window.localStorage.removeItem(ACTIVE_VALIDATION_ID_KEY);
                    window.localStorage.removeItem(ACTIVE_VALIDATION_IDEA_KEY);
                    emitValidationStorageChange();
                }
            } catch {
                // Best-effort dock polling only.
            }
        };

        void checkValidationStatus();
        const interval = window.setInterval(checkValidationStatus, 10000);
        return () => window.clearInterval(interval);
    }, [currentPath, emitValidationStorageChange, isGuest]);

    return (
        <>
            <div className="fixed bottom-2 left-1/2 z-[1000] w-[calc(100vw-1.25rem)] max-w-[420px] -translate-x-1/2 pointer-events-auto lg:hidden">
                <nav
                    className="mx-auto flex items-center justify-between gap-1 rounded-[22px] border px-1.5 pb-[calc(env(safe-area-inset-bottom,0px)+8px)] pt-1.5"
                    style={{
                        background: "hsla(0,0%,4%,0.82)",
                        borderColor: "hsl(0 0% 100% / 0.06)",
                        backdropFilter: "blur(28px) saturate(180%)",
                        boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.04), 0 18px 44px rgba(0,0,0,0.5)",
                    }}
                >
                    {mobileDockItems.map((item) => {
                        const isActive = item.exact
                            ? currentPath === item.path
                            : currentPath === item.path || currentPath?.startsWith(item.path + "/");
                        const Icon = item.icon;
                        const isValidate = item.name === "Validate";
                        return (
                            <Link
                                key={`${item.name}-${item.path}-mobile`}
                                href={item.path}
                                className={`relative flex min-h-[50px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[18px] px-2 py-2 text-[10px] tracking-[0.08em] transition-all duration-150 ${
                                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                                }`}
                                style={isActive
                                    ? {
                                        background: "hsl(16 100% 50% / 0.12)",
                                        border: "1px solid hsl(16 100% 50% / 0.18)",
                                    }
                                    : isValidate
                                        ? {
                                            background: "hsl(16 100% 50% / 0.06)",
                                            border: "1px solid hsl(16 100% 50% / 0.1)",
                                            color: "#fdba74",
                                        }
                                        : { border: "1px solid transparent" }}
                            >
                                <div className="relative flex items-center justify-center">
                                    <Icon className="h-4 w-4" />
                                </div>
                                <span className={`truncate font-medium ${isValidate ? "uppercase" : ""}`}>
                                    {item.name}
                                </span>
                                {isActive && (
                                    <span className="absolute bottom-1 h-1 w-1 rounded-full bg-primary" style={{ boxShadow: "0 0 6px hsl(16 100% 50%)" }} />
                                )}
                            </Link>
                        );
                    })}
                </nav>
            </div>

            <div
                className="fixed bottom-2 left-1/2 z-[1000] hidden -translate-x-1/2 overflow-x-auto pointer-events-auto lg:block"
                style={{ scrollbarWidth: "none", maxWidth: "calc(100vw - 1rem)" }}
            >
            <nav
                className="mx-auto inline-flex min-w-max items-center gap-1"
                style={{
                    background: "hsla(0,0%,4%,0.82)",
                    border: "1px solid hsl(0 0% 100% / 0.06)",
                    borderRadius: 12,
                    padding: "4px 6px",
                    backdropFilter: "blur(28px) saturate(180%)",
                    boxShadow: "0 0 0 1px hsl(0 0% 100% / 0.04), 0 18px 44px rgba(0,0,0,0.5)",
                }}
            >
                {groups.map((group, gi) => (
                    <span key={gi} className="contents">
                        {gi > 0 && <DockDivider />}
                        {group.map((item) => {
                            const isActive = item.exact
                                ? currentPath === item.path
                                : currentPath === item.path || currentPath?.startsWith(item.path + "/");
                            const Icon = item.icon;
                            const badgeCount = item.path === "/dashboard/alerts" ? alertCount : 0;
                            const showValidationBadge = item.path === "/dashboard/validate" && hasCompletedValidation;
                            return (
                                <Link
                                    key={item.path}
                                    href={item.path}
                                    onClick={() => {
                                        if (item.path === "/dashboard/validate" && typeof window !== "undefined") {
                                            window.localStorage.removeItem(COMPLETED_VALIDATION_ID_KEY);
                                            emitValidationStorageChange();
                                        }
                                    }}
                                    className={`relative flex flex-col items-center gap-1 rounded-xl px-2 py-1.5 min-w-[44px] transition-all duration-150 text-[9px] tracking-[0.12em] ${
                                        isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                                    }`}
                                    style={isActive
                                        ? { background: "hsl(16 100% 50% / 0.1)", border: "1px solid hsl(16 100% 50% / 0.16)" }
                                        : { border: "1px solid transparent" }}
                                >
                                    <div className="relative">
                                        <Icon className="w-4 h-4" />
                                        {badgeCount > 0 && (
                                            <span className="absolute -top-2 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-mono flex items-center justify-center">
                                                {badgeCount > 99 ? "99+" : badgeCount}
                                            </span>
                                        )}
                                        {showValidationBadge && (
                                            <span className="absolute -top-1.5 -right-1.5 w-[10px] h-[10px] rounded-full bg-primary border border-background shadow-[0_0_8px_hsl(16_100%_50%)]" />
                                        )}
                                    </div>
                                    <span className="font-medium">{item.name}</span>
                                    {isActive && (
                                        <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" style={{ boxShadow: "0 0 6px hsl(16 100% 50%)" }} />
                                    )}
                                </Link>
                            );
                        })}
                    </span>
                ))}

                <DockDivider />
                {showBetaBadge ? (
                    <>
                        <div
                            className="relative flex items-center gap-2 rounded-xl px-2.5 py-1.5 min-w-[50px] text-[10px] tracking-wider text-primary"
                            style={{ background: "hsl(16 100% 50% / 0.1)", border: "1px solid hsl(16 100% 50% / 0.16)" }}
                        >
                            <Sparkles className="w-[16px] h-[16px]" />
                            <div className="flex flex-col leading-none">
                                <span className="font-semibold uppercase tracking-[0.14em]">Beta</span>
                                <span className="text-[9px] text-primary/80">{isGuest ? "Open beta" : "Full access"}</span>
                            </div>
                        </div>
                        <DockDivider />
                    </>
                ) : null}

                {isGuest ? (
                    <Link
                        href={DASHBOARD_LOGIN_HREF}
                        className="relative flex flex-col items-center gap-1 rounded-xl px-2.5 py-1.5 min-w-[50px] transition-all duration-150 text-[10px] tracking-wider text-primary"
                        style={{ background: "hsl(16 100% 50% / 0.1)", border: "1px solid hsl(16 100% 50% / 0.16)" }}
                    >
                        <LogIn className="w-4 h-4" />
                        <span className="font-medium">Log In</span>
                    </Link>
                ) : (
                    <>
                        <Link
                            href="/dashboard/settings"
                            className={`relative flex flex-col items-center gap-1 rounded-xl px-2.5 py-1.5 min-w-[50px] transition-all duration-150 text-[10px] tracking-wider ${
                                currentPath?.startsWith("/dashboard/settings") ? "text-primary" : "text-muted-foreground hover:text-foreground"
                            }`}
                            style={currentPath?.startsWith("/dashboard/settings")
                                ? { background: "hsl(16 100% 50% / 0.1)", border: "1px solid hsl(16 100% 50% / 0.16)" }
                                : { border: "1px solid transparent" }}
                        >
                            <Settings className="w-4 h-4" />
                            <span className="font-medium">Settings</span>
                            {currentPath?.startsWith("/dashboard/settings") && (
                                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" style={{ boxShadow: "0 0 6px hsl(16 100% 50%)" }} />
                            )}
                        </Link>
                    </>
                )}
            </nav>
            </div>
        </>
    );
}
