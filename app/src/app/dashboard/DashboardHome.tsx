"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
    AnimatedCounter, StaggerContainer, StaggerItem, GlassCard, GlowBadge,
} from "@/app/components/motion";
import type { LucideIcon } from "lucide-react";
import {
    BarChart3, TrendingUp, TrendingDown, Target, DollarSign, ArrowRight,
    Flame, ExternalLink, Activity, Search, FileText, Minus, Globe, Mail,
    Zap, Crown, Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { PRICING } from "@/lib/pricing-plans";

function StatCard({ title, value, numericValue, accent, icon: Icon, sub }: {
    title: string; value: string | number; numericValue?: number;
    accent?: boolean; icon?: LucideIcon; sub?: string;
}) {
    return (
        <GlassCard className="" style={{ padding: 20 }} glow={accent ? "orange" : undefined}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>{title}</span>
                {Icon && (
                    <div style={{
                        padding: 6, borderRadius: 8,
                        background: accent ? "rgba(249,115,22,0.1)" : "rgba(255,255,255,0.04)",
                    }}>
                        <Icon style={{ width: 12, height: 12, color: accent ? "#f97316" : "#64748b" }} />
                    </div>
                )}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: accent ? "#f97316" : "#f1f5f9" }}>
                {numericValue !== undefined ? (
                    <AnimatedCounter value={numericValue} className={accent ? "" : ""} />
                ) : (
                    <motion.span initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
                        {value}
                    </motion.span>
                )}
            </div>
            {sub && (
                <motion.div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
                    {sub}
                </motion.div>
            )}
        </GlassCard>
    );
}

export default function DashboardHome() {
    const router = useRouter();
    const [stats, setStats] = useState({ totalPosts: 0, totalScans: 0, totalAnalyzed: 0 });
    const [recentPosts, setRecentPosts] = useState<Array<{
        id: string; title: string; subreddit: string; score: number;
        num_comments: number; permalink: string; full_text: string;
    }>>([]);
    const [trendingData, setTrendingData] = useState<Array<{
        topic: string;
        change24h: number;
        status: "accelerating" | "growing" | "fading";
        postCount7d: number;
        sourceCount: number;
    }>>([]);

    useEffect(() => {
        const load = async () => {
            const supabase = createClient();
            const { data: scans } = await supabase.from("scans").select("id, posts_found, posts_analyzed, status");
            const totalScans = scans?.length || 0;
            const totalPosts = scans?.reduce((s, sc) => s + (sc.posts_found || 0), 0) || 0;
            const totalAnalyzed = scans?.reduce((s, sc) => s + (sc.posts_analyzed || 0), 0) || 0;
            setStats({ totalPosts, totalScans, totalAnalyzed });

            const { data: posts } = await supabase
                .from("posts")
                .select("id,title,subreddit,score,num_comments,permalink,full_text")
                .order("score", { ascending: false })
                .limit(8);
            if (posts) setRecentPosts(posts as typeof recentPosts);

            const { data: validations } = await supabase
                .from("ideas")
                .select("topic, change_24h, confidence_level, post_count_7d, source_count")
                .neq("confidence_level", "INSUFFICIENT")
                .order("last_updated", { ascending: false })
                .limit(4);

            if (validations && validations.length > 0) {
                const trending = validations.map((v: Record<string, unknown>) => {
                    const conf = Number(v.change_24h || 0);
                    const verdict = String(v.confidence_level || "").toUpperCase();
                    const status: "accelerating" | "growing" | "fading" =
                        conf >= 8 ? "accelerating" :
                        conf >= 0 ? "growing" : "fading";
                    return {
                        topic: ((v.topic as string) || "").substring(0, 30),
                        change24h: conf,
                        status,
                        postCount7d: Number(v.post_count_7d || 0),
                        sourceCount: Number(v.source_count || 0),
                    };
                }).sort((a, b) => b.change24h - a.change24h);
                setTrendingData(trending);
            }
        };
        load();
    }, []);

    return (
        <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
            {/* Header */}
            <motion.div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 24 }}
                initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            >
                <div>
                    <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", fontFamily: "var(--font-display)", color: "#f1f5f9" }}>
                        Dashboard
                    </h1>
                    <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
                        Your intelligence overview
                    </p>
                </div>
            </motion.div>

            {/* Stat Cards */}
            <StaggerContainer className="" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
                <StaggerItem>
                    <StatCard title="Posts" value={stats.totalPosts} numericValue={stats.totalPosts} icon={BarChart3} />
                </StaggerItem>
                <StaggerItem>
                    <StatCard title="Analyzed" value={stats.totalAnalyzed} numericValue={stats.totalAnalyzed} accent icon={Target} />
                </StaggerItem>
                <StaggerItem>
                    <StatCard title="Scans" value={stats.totalScans} numericValue={stats.totalScans} icon={Activity} />
                </StaggerItem>
                <StaggerItem>
                    <StatCard title="Plan" value="Free" sub="3 scans included" icon={Zap} />
                </StaggerItem>
            </StaggerContainer>

            {/* Main Content Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
                {/* Posts Panel */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
                    <GlassCard hover={false} style={{ overflow: "visible" }}>
                        <div style={{
                            padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                        }}>
                            <h3 style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, color: "#f1f5f9", fontFamily: "var(--font-display)" }}>
                                <div style={{ padding: 4, borderRadius: 6, background: "rgba(239,68,68,0.1)" }}>
                                    <Flame style={{ width: 14, height: 14, color: "#ef4444" }} />
                                </div>
                                Top scoring posts
                            </h3>
                            <button className="btn-ghost" onClick={() => router.push("/dashboard/explore")}
                                style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                                View all <ArrowRight style={{ width: 12, height: 12 }} />
                            </button>
                        </div>
                        <div style={{ maxHeight: 460, overflowY: "auto" }}>
                            {recentPosts.length > 0 ? (
                                <StaggerContainer delay={0.3}>
                                    {recentPosts.map((post) => (
                                        <StaggerItem key={post.id}>
                                            <motion.div
                                                style={{
                                                    padding: "14px 20px",
                                                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                                                    cursor: "pointer",
                                                }}
                                                whileHover={{ backgroundColor: "rgba(255,255,255,0.03)" }}
                                            >
                                                <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12 }}>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                                                            <span style={{ fontSize: 11, fontWeight: 500, color: "#64748b" }}>r/{post.subreddit}</span>
                                                            <GlowBadge color="orange">{post.score} pts</GlowBadge>
                                                        </div>
                                                        <h4 style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: "#f1f5f9", marginBottom: 4 }}>
                                                            {post.title}
                                                        </h4>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "#475569" }}>
                                                            <span>💬 {post.num_comments} comments</span>
                                                        </div>
                                                    </div>
                                                    {post.permalink && (
                                                        <a href={`https://reddit.com${post.permalink}`} target="_blank" rel="noopener noreferrer"
                                                            style={{ flexShrink: 0, padding: 8, color: "#64748b" }}>
                                                            <ExternalLink style={{ width: 14, height: 14 }} />
                                                        </a>
                                                    )}
                                                </div>
                                            </motion.div>
                                        </StaggerItem>
                                    ))}
                                </StaggerContainer>
                            ) : (
                                <motion.div style={{ padding: 40, textAlign: "center", color: "#475569" }}
                                    initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
                                    <Target style={{ width: 32, height: 32, margin: "0 auto 12px", opacity: 0.3 }} />
                                    <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>No posts yet</p>
                                    <p style={{ fontSize: 12 }}>Run a scan to start finding opportunities.</p>
                                </motion.div>
                            )}
                        </div>
                    </GlassCard>
                </motion.div>

                {/* Right Sidebar */}
                <StaggerContainer style={{ display: "flex", flexDirection: "column", gap: 12 }} delay={0.3}>
                    {/* Trending */}
                    <StaggerItem>
                        <GlassCard hover={false} style={{ padding: 20 }}>
                            <h3 style={{
                                fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
                                color: "#64748b", marginBottom: 14, display: "flex", alignItems: "center", gap: 8,
                            }}>
                                <div style={{ padding: 4, borderRadius: 6, background: "rgba(249,115,22,0.1)" }}>
                                    <TrendingUp style={{ width: 12, height: 12, color: "#f97316" }} />
                                </div>
                                Trending now
                            </h3>
                            <StaggerContainer style={{ display: "flex", flexDirection: "column", gap: 12 }} delay={0.4}>
                                {trendingData.map((t) => (
                                    <StaggerItem key={t.topic}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            {t.status === "accelerating" ? <Flame style={{ width: 12, height: 12, color: "#ef4444", flexShrink: 0 }} /> :
                                                t.status === "growing" ? <TrendingUp style={{ width: 12, height: 12, color: "#10b981", flexShrink: 0 }} /> :
                                                    <TrendingDown style={{ width: 12, height: 12, color: "#f87171", flexShrink: 0 }} />}
                                            <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#e2e8f0" }}>
                                                {t.topic}
                                            </span>
                                            <span style={{ fontSize: 10, color: "#64748b", whiteSpace: "nowrap" }}>
                                                {t.postCount7d} posts | {t.sourceCount} src
                                            </span>
                                            <span style={{
                                                fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700,
                                                fontVariantNumeric: "tabular-nums",
                                                color: t.change24h > 8 ? "#ef4444" : t.change24h >= 0 ? "#10b981" : "#f87171",
                                            }}>
                                                {t.change24h > 0 ? "+" : ""}{t.change24h}%
                                            </span>
                                        </div>
                                    </StaggerItem>
                                ))}
                            </StaggerContainer>
                            <button className="btn-ghost" style={{ width: "100%", marginTop: 12, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
                                onClick={() => router.push("/dashboard/trends")}>
                                View all trends <ArrowRight style={{ width: 12, height: 12 }} />
                            </button>
                        </GlassCard>
                    </StaggerItem>

                    {/* Quick Actions */}
                    <StaggerItem>
                        <GlassCard hover={false} style={{ padding: 20 }}>
                            <h3 style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", marginBottom: 16 }}>
                                Quick actions
                            </h3>
                            <StaggerContainer style={{ display: "flex", flexDirection: "column", gap: 6 }} delay={0.5}>
                                <StaggerItem>
                                    <button className="btn-secondary" style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
                                        onClick={() => router.push("/dashboard/scans")}>
                                        <Activity style={{ width: 14, height: 14 }} /> New scan
                                    </button>
                                </StaggerItem>
                                <StaggerItem>
                                    <button className="btn-secondary" style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
                                        onClick={() => router.push("/dashboard/explore")}>
                                        <Search style={{ width: 14, height: 14 }} /> Explore posts
                                    </button>
                                </StaggerItem>
                                <StaggerItem>
                                    <button className="btn-secondary" style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
                                        onClick={() => router.push("/dashboard/reports")}>
                                        <FileText style={{ width: 14, height: 14 }} /> Validation reports
                                    </button>
                                </StaggerItem>
                            </StaggerContainer>
                        </GlassCard>
                    </StaggerItem>

                    {/* Upgrade Card */}
                    <StaggerItem>
                        <motion.div
                            className="animated-gradient-border"
                            style={{ borderRadius: 12 }}
                            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.6, type: "spring", stiffness: 200, damping: 20 }}
                        >
                            <div style={{
                                padding: 20, borderRadius: 12,
                                background: "var(--bg-deep)", position: "relative",
                            }}>
                                <div style={{
                                    position: "absolute", inset: 0, borderRadius: 12,
                                    background: "linear-gradient(135deg, rgba(249,115,22,0.05), transparent)",
                                    pointerEvents: "none",
                                }} />
                                <div style={{ position: "relative" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                        <div className="pulse-glow" style={{ padding: 6, borderRadius: 8, background: "rgba(249,115,22,0.1)" }}>
                                            <Sparkles style={{ width: 14, height: 14, color: "#f97316" }} />
                                        </div>
                                        <p style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9" }}>Choose your plan</p>
                                    </div>
                                    <p style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
                                        Start with a {PRICING.trialDays}-day free trial, then pick Starter at ${PRICING.starter.priceMonthly}/mo or Pro at ${PRICING.pro.priceMonthly}/mo.
                                    </p>
                                    <button className="btn-primary" style={{ width: "100%", fontSize: 13 }}
                                        onClick={() => router.push("/dashboard/pricing")}>
                                        See plans
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </StaggerItem>
                </StaggerContainer>
            </div>
        </div>
    );
}
