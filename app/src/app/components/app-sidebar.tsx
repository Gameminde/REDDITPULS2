"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
    Search, DollarSign, Radar,
    Bookmark, LogOut, Lock, ArrowRight, FileText,
    TrendingUp, Globe, Mail, Lightbulb, Settings,
    BarChart3, BellRing, Compass, Sparkles, BadgeDollarSign, Waypoints, Shield,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { useUserPlan } from "@/lib/use-user-plan";
import { PRICING } from "@/lib/pricing-plans";
import { BrandLogo } from "@/app/components/brand-logo";

/* ─── Nav Groups ──────────────────────────────────────────── */

const marketItems = [
    { title: "Board", url: "/dashboard", icon: BarChart3 },
    { title: "Opportunities", url: "/dashboard/opportunities", icon: Sparkles },
    { title: "Explore", url: "/dashboard/explore", icon: Compass },
    { title: "Trends", url: "/dashboard/trends", icon: TrendingUp, premium: true },
];

const validateItems = [
    { title: "Validate", url: "/dashboard/validate", icon: Lightbulb },
    { title: "Reports", url: "/dashboard/reports", icon: FileText, premium: true },
];

const monitorItems = [
    { title: "Following", url: "/dashboard/saved", icon: Bookmark, premium: true },
    { title: "Alerts", url: "/dashboard/alerts", icon: BellRing },
    { title: "Digest", url: "/dashboard/digest", icon: Mail, premium: true },
    { title: "Competitors", url: "/dashboard/competitors", icon: Radar, premium: true },
];

const intelligenceItems = [
    { title: "Scans", url: "/dashboard/scans", icon: Search },
    { title: "Sources", url: "/dashboard/sources", icon: Globe, premium: true },
    { title: "WTP Detection", url: "/dashboard/wtp", icon: DollarSign, premium: true },
];

const learnItems = [
    { title: "Pricing", url: "/dashboard/pricing", icon: BadgeDollarSign },
    { title: "How it works", url: "/dashboard/how-it-works", icon: Waypoints },
];

const labelVariants = {
    hidden: { opacity: 0, x: -8 },
    visible: (i: number) => ({
        opacity: 1, x: 0,
        transition: { delay: 0.1 + i * 0.08, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
    }),
};

function NavItem({ item, isActive, isPremium }: {
    item: { title: string; url: string; icon: LucideIcon; premium?: boolean };
    isActive: boolean;
    isPremium: boolean;
}) {
    const Icon = item.icon;
    return (
        <Link
            href={item.url}
            className={`sidebar-link ${isActive ? "active" : ""}`}
        >
            <Icon className="w-4 h-4 relative z-[1]" />
            <span className="relative z-[1] text-[13px]">{item.title}</span>
            {item.premium && !isPremium && (
                <Lock className="w-3 h-3 ml-auto opacity-40 relative z-[1]" />
            )}
        </Link>
    );
}

function NavGroup({ label, items, index, pathname, isPremium }: {
    label: string;
    items: { title: string; url: string; icon: LucideIcon; premium?: boolean }[];
    index: number;
    pathname: string;
    isPremium: boolean;
}) {
    return (
        <>
            <motion.div custom={index} variants={labelVariants} initial="hidden" animate="visible">
                <div style={{
                    fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em",
                    color: "#475569", padding: index === 0 ? "12px 14px 6px" : "20px 14px 6px", fontWeight: 600,
                }}>
                    {label}
                </div>
            </motion.div>
            {items.map((item) => (
                <NavItem
                    key={item.title}
                    item={item}
                    isActive={item.url === "/dashboard" ? pathname === item.url : pathname.startsWith(item.url)}
                    isPremium={isPremium}
                />
            ))}
        </>
    );
}

export function AppSidebar({ userEmail }: { userEmail?: string }) {
    const pathname = usePathname();
    const { isPremium, isAdmin } = useUserPlan();

    const handleLogout = async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        window.location.href = "/login";
    };

    return (
        <div className="sidebar" style={{ width: 216 }}>
            {/* Header */}
            <div style={{ padding: "16px 16px 10px" }}>
                <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
                    <motion.div
                        animate={{
                            y: [0, -1.5, 0],
                            filter: [
                                "drop-shadow(0 0 10px rgba(249,115,22,0.16))",
                                "drop-shadow(0 0 18px rgba(249,115,22,0.28))",
                                "drop-shadow(0 0 10px rgba(249,115,22,0.16))",
                            ],
                        }}
                        transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
                    >
                        <BrandLogo compact href={null} />
                    </motion.div>
                </Link>
            </div>

            {/* Nav Groups */}
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 10px" }}>
                <NavGroup label="Board"        items={marketItems}       index={0} pathname={pathname} isPremium={isPremium} />
                <NavGroup label="Validate"     items={validateItems}     index={1} pathname={pathname} isPremium={isPremium} />
                <NavGroup label="Monitor"      items={monitorItems}      index={2} pathname={pathname} isPremium={isPremium} />
                <NavGroup label="Intelligence" items={intelligenceItems} index={3} pathname={pathname} isPremium={isPremium} />
                <NavGroup label="Learn"        items={learnItems}        index={4} pathname={pathname} isPremium={isPremium} />
                {isAdmin ? (
                    <>
                        <motion.div custom={5} variants={labelVariants} initial="hidden" animate="visible">
                            <div style={{
                                fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em",
                                color: "#475569", padding: "20px 14px 6px", fontWeight: 600,
                            }}>
                                Control
                            </div>
                        </motion.div>
                        <NavItem
                            item={{ title: "Admin", url: "/admin", icon: Shield }}
                            isActive={pathname.startsWith("/admin")}
                            isPremium
                        />
                    </>
                ) : null}

                {/* Upgrade CTA */}
                {!isPremium && (
                    <motion.div
                        className="animated-gradient-border"
                        style={{ borderRadius: 12, margin: "16px 4px 0", overflow: "visible" }}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4, duration: 0.5 }}
                    >
                        <div style={{
                            padding: 14, borderRadius: 12,
                            background: "var(--bg-sidebar)",
                            position: "relative",
                        }}>
                            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: "#f1f5f9" }}>
                                Start free, upgrade when ready
                            </p>
                            <p style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
                                {PRICING.trialDays}-day full-access trial, then ${PRICING.starter.priceMonthly}/mo Starter or ${PRICING.pro.priceMonthly}/mo Pro.
                            </p>
                            <Link href="/dashboard/pricing" className="btn-primary" style={{
                                display: "flex", alignItems: "center", justifyContent: "center",
                                gap: 6, padding: "8px 16px", fontSize: 12, textDecoration: "none",
                                width: "100%", boxSizing: "border-box",
                            }}>
                                See plans <ArrowRight style={{ width: 12, height: 12 }} />
                            </Link>
                        </div>
                    </motion.div>
                )}
            </div>

            {/* Footer — Settings + User + Logout */}
            <div style={{
                padding: "10px 16px 14px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                display: "flex", flexDirection: "column", gap: 8,
            }}>
                {/* Settings link */}
                <Link
                    href="/dashboard/settings"
                    className={`sidebar-link ${pathname.startsWith("/dashboard/settings") ? "active" : ""}`}
                    style={{ margin: 0 }}
                >
                    <Settings className="w-4 h-4 relative z-[1]" />
                    <span className="relative z-[1] text-[13px]">Settings</span>
                </Link>

                {/* User row */}
                <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                    paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.04)",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <div style={{
                            width: 28, height: 28, borderRadius: "50%",
                            background: "rgba(249,115,22,0.1)",
                            border: "1px solid rgba(249,115,22,0.2)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0,
                        }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: "#f97316" }}>
                                {userEmail?.[0]?.toUpperCase() || "U"}
                            </span>
                        </div>
                        <span style={{
                            fontSize: 12, color: "#94a3b8", overflow: "hidden",
                            textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                            {userEmail || "user"}
                        </span>
                    </div>
                    <button
                        onClick={handleLogout}
                        style={{
                            background: "none", border: "none", cursor: "pointer",
                            padding: 6, borderRadius: 6, color: "#64748b",
                        }}
                        title="Log out"
                    >
                        <LogOut style={{ width: 14, height: 14 }} />
                    </button>
                </div>
            </div>
        </div>
    );
}

