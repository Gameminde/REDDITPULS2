"use client";

import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
    TrendingUp, TrendingDown, Minus, Plus,
    ArrowUpRight, ArrowDownRight, Activity, BarChart3,
    Eye, Zap, Clock, ExternalLink, Flame, Skull, Sparkles,
} from "lucide-react";

interface Idea {
    id: string;
    topic: string;
    slug: string;
    current_score: number;
    change_24h: number;
    change_7d: number;
    change_30d: number;
    trend_direction: string;
    confidence_level: string;
    post_count_total: number;
    post_count_7d: number;
    source_count: number;
    sources: string[];
    category: string;
    reddit_velocity: number;
    google_trend_score: number;
    competition_score: number;
    cross_platform_multiplier: number;
    top_posts: { title: string; source: string; subreddit: string; score: number; comments: number; url: string }[];
    first_seen: string;
    last_updated: string;
}

type IdeaTopPost = Idea["top_posts"][number];

const PAIN_SIGNAL_KEYWORDS = [
    "hate", "frustrated", "struggling", "help", "issue",
    "problem", "broken", "slow", "expensive", "annoying",
    "anyone else", "does anyone", "how do i", "why does",
    "can't", "cannot", "won't", "doesn't work", "need help",
    "looking for", "recommendations", "alternative",
];

const THIRD_PARTY_PROBLEM_PATTERNS = [
    "my mom", "my friend", "my neighbor", "my ex",
];

function decodeHtml(str: string) {
    return str
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function painSignalMatches(title: string) {
    const normalized = decodeHtml(title).toLowerCase();
    return PAIN_SIGNAL_KEYWORDS.filter((keyword) => normalized.includes(keyword));
}

function isThirdPartyProblemTitle(title: string) {
    const normalized = decodeHtml(title).toLowerCase();
    return THIRD_PARTY_PROBLEM_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function isLikelyMemeTitle(post: IdeaTopPost) {
    const normalized = decodeHtml(post.title || "").toLowerCase();
    const hasQuestion = normalized.includes("?");
    const painMatches = painSignalMatches(normalized).length;
    return !hasQuestion && painMatches === 0 && Number(post.score || 0) > 500;
}

function getPainSignalPosts(posts: IdeaTopPost[]) {
    const filtered = posts.filter((post) => !isThirdPartyProblemTitle(post.title || "") && !isLikelyMemeTitle(post));
    const sorted = [...filtered].sort((left, right) => {
        const leftPainCount = painSignalMatches(left.title || "").length;
        const rightPainCount = painSignalMatches(right.title || "").length;
        const leftHasPain = leftPainCount > 0 ? 1 : 0;
        const rightHasPain = rightPainCount > 0 ? 1 : 0;

        if (leftHasPain !== rightHasPain) {
            return rightHasPain - leftHasPain;
        }

        if (leftPainCount !== rightPainCount) {
            return rightPainCount - leftPainCount;
        }

        return Number(right.score || 0) - Number(left.score || 0);
    });

    if (sorted.length < 2) {
        return {
            posts: posts.slice(0, 3),
            usedFallback: true,
        };
    }

    return {
        posts: sorted.slice(0, 3),
        usedFallback: false,
    };
}

type TabType = "top" | "trending" | "dying" | "new";

const TABS: { key: TabType; label: string; icon: LucideIcon; color: string }[] = [
    { key: "top", label: "Top Scores", icon: BarChart3, color: "#f97316" },
    { key: "trending", label: "Rising", icon: Flame, color: "#22c55e" },
    { key: "dying", label: "Falling", icon: Skull, color: "#ef4444" },
    { key: "new", label: "New", icon: Sparkles, color: "#8b5cf6" },
];

const CATEGORIES = [
    { key: "", label: "All" },
    { key: "fintech", label: "Fintech" },
    { key: "productivity", label: "Productivity" },
    { key: "marketing", label: "Marketing" },
    { key: "dev-tools", label: "Dev Tools" },
    { key: "ai", label: "AI" },
    { key: "saas", label: "SaaS" },
    { key: "ecommerce", label: "E-commerce" },
    { key: "hr", label: "HR" },
    { key: "security", label: "Security" },
    { key: "data", label: "Data" },
];

const CONFIDENCE_MAP: Record<string, { label: string; color: string; icon: string }> = {
    LOW: { label: "Weak signal", color: "#f59e0b", icon: "⚠️" },
    MEDIUM: { label: "Moderate", color: "#3b82f6", icon: "📊" },
    HIGH: { label: "Strong", color: "#22c55e", icon: "✅" },
    STRONG: { label: "Very Strong", color: "#10b981", icon: "🔥" },
};

function TrendIcon({ direction, size = 14 }: { direction: string; size?: number }) {
    if (direction === "rising") return <TrendingUp style={{ width: size, height: size, color: "#22c55e" }} />;
    if (direction === "falling") return <TrendingDown style={{ width: size, height: size, color: "#ef4444" }} />;
    if (direction === "new") return <Sparkles style={{ width: size, height: size, color: "#8b5cf6" }} />;
    return <Minus style={{ width: size, height: size, color: "#64748b" }} />;
}

function ChangeDisplay({ value, prefix = "" }: { value: number; prefix?: string }) {
    const color = value > 0 ? "#22c55e" : value < 0 ? "#ef4444" : "#64748b";
    const bg = value > 0 ? "rgba(34,197,94,0.1)" : value < 0 ? "rgba(239,68,68,0.1)" : "rgba(100,116,139,0.1)";
    const icon = value > 0 ? <ArrowUpRight style={{ width: 11, height: 11 }} /> : value < 0 ? <ArrowDownRight style={{ width: 11, height: 11 }} /> : null;

    return (
        <span style={{
            display: "inline-flex", alignItems: "center", gap: 2,
            fontSize: 12, fontWeight: 600, color,
            background: bg, padding: "2px 7px", borderRadius: 6,
            fontFamily: "var(--font-mono)",
        }}>
            {icon}{prefix}{value > 0 ? "+" : ""}{value.toFixed(1)}
        </span>
    );
}

function ScoreBar({ score, color = "#f97316" }: { score: number; color?: string }) {
    return (
        <div style={{
            width: "100%", height: 6, borderRadius: 3,
            background: "rgba(255,255,255,0.05)", position: "relative", overflow: "hidden",
        }}>
            <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(score, 100)}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                style={{
                    height: "100%", borderRadius: 3,
                    background: `linear-gradient(90deg, ${color}88, ${color})`,
                    boxShadow: `0 0 8px ${color}44`,
                }}
            />
        </div>
    );
}

function IdeaRow({ idea, rank }: { idea: Idea; rank: number }) {
    const conf = CONFIDENCE_MAP[idea.confidence_level] || CONFIDENCE_MAP.LOW;
    const scoreColor = idea.current_score >= 70 ? "#22c55e" : idea.current_score >= 40 ? "#f97316" : "#64748b";
    const [expanded, setExpanded] = useState(false);
    const painSignalSelection = getPainSignalPosts(idea.top_posts || []);

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        setExpanded((current) => !current);
    };

    return (
        <div>
            <motion.div
                className="glass-card"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: rank * 0.04, duration: 0.3 }}
                whileHover={{ scale: 1.005, borderColor: "rgba(249,115,22,0.25)" }}
                onClick={handleClick}
                style={{
                    display: "grid", gridTemplateColumns: "40px 1.5fr 100px 100px 100px 80px 80px",
                    alignItems: "center", gap: 12, padding: "14px 18px",
                    cursor: "pointer", borderRadius: 10,
                    borderBottom: expanded ? "none" : "1px solid rgba(255,255,255,0.03)",
                    transition: "all 0.2s ease",
                    background: expanded ? "rgba(249,115,22,0.04)" : "transparent",
                }}
            >
                {/* Rank */}
                <div style={{
                    fontSize: 14, fontWeight: 700, color: rank <= 3 ? "#f97316" : "#475569",
                    fontFamily: "var(--font-mono)", textAlign: "center",
                }}>
                    #{rank}
                </div>

                {/* Topic + meta */}
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <TrendIcon direction={idea.trend_direction} />
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>
                            {decodeHtml(idea.topic)}
                        </span>
                        <span style={{
                            fontSize: 10, padding: "1px 6px", borderRadius: 4,
                            background: "rgba(249,115,22,0.1)", color: "#f97316",
                            textTransform: "uppercase", fontWeight: 600,
                        }}>
                            {idea.category}
                        </span>
                        {expanded && (
                            <span style={{ fontSize: 9, color: "#64748b" }}>Open details</span>
                        )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "#64748b" }}>
                        <span>{idea.post_count_total} posts</span>
                        <span>{idea.source_count} {idea.source_count === 1 ? "source" : "sources"}</span>
                        <span style={{ color: conf.color }}>{conf.icon} {conf.label}</span>
                    </div>
                </div>

                {/* Score */}
                <div style={{ textAlign: "center" }}>
                    <div style={{
                        fontSize: 20, fontWeight: 800, color: scoreColor,
                        fontFamily: "var(--font-mono)", lineHeight: 1,
                    }}>
                        {idea.current_score.toFixed(0)}
                    </div>
                    <div style={{ marginTop: 4, padding: "0 8px" }}>
                        <ScoreBar score={idea.current_score} color={scoreColor} />
                    </div>
                </div>

                {/* 24h */}
                <div style={{ textAlign: "center" }}>
                    <ChangeDisplay value={idea.change_24h} prefix="24h " />
                </div>

                {/* 7d */}
                <div style={{ textAlign: "center" }}>
                    <ChangeDisplay value={idea.change_7d} prefix="7d " />
                </div>

                {/* Volume 7d */}
                <div style={{ textAlign: "center", fontSize: 12, color: "#94a3b8", fontFamily: "var(--font-mono)" }}>
                    {idea.post_count_7d}
                    <div style={{ fontSize: 9, color: "#475569" }}>7d vol</div>
                </div>

                {/* Sources */}
                <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                    {(idea.sources || []).map((s) => (
                        <span key={s} style={{
                            fontSize: 9, padding: "2px 5px", borderRadius: 3,
                            background: s === "reddit" ? "rgba(255,69,0,0.15)" :
                                s === "hackernews" ? "rgba(255,102,0,0.15)" :
                                    s === "producthunt" ? "rgba(218,85,47,0.15)" :
                                        "rgba(79,70,229,0.15)",
                            color: s === "reddit" ? "#ff4500" :
                                s === "hackernews" ? "#ff6600" :
                                    s === "producthunt" ? "#da552f" :
                                        "#4f46e5",
                            fontWeight: 600, textTransform: "uppercase",
                        }}>
                            {s === "reddit" ? "R" : s === "hackernews" ? "HN" : s === "producthunt" ? "PH" : "IH"}
                        </span>
                    ))}
                </div>
            </motion.div>

            
            {/* Expanded Detail Panel */}
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        style={{ overflow: "hidden" }}
                    >
                        <div style={{
                            margin: "0 8px 8px",
                            padding: 20,
                            borderRadius: "0 0 12px 12px",
                            background: "rgba(15,23,42,0.6)",
                            border: "1px solid rgba(249,115,22,0.1)",
                            borderTop: "1px solid rgba(249,115,22,0.15)",
                        }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 16 }}>
                                <div style={{
                                    padding: 14,
                                    borderRadius: 10,
                                    background: "rgba(255,255,255,0.02)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                }}>
                                    <div style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "flex-start",
                                        gap: 3,
                                        marginBottom: 10,
                                    }}>
                                        <span style={{ color: "#f1f5f9", fontSize: 12, fontWeight: 700 }}>
                                            Pain signals
                                        </span>
                                        <span style={{ color: "#94a3b8", fontSize: 10 }}>
                                            {painSignalSelection.usedFallback
                                                ? "Top posts (pain signals not yet available for this topic)"
                                                : "Pain-keyword posts first, then upvotes"}
                                        </span>
                                    </div>
                                    {idea.top_posts && idea.top_posts.length > 0 ? (
                                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                            {painSignalSelection.posts.map((post, index) => (
                                                <a
                                                    key={`${idea.slug}-post-${index}`}
                                                    href={post.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "flex-start",
                                                        justifyContent: "space-between",
                                                        gap: 12,
                                                        padding: "10px 12px",
                                                        borderRadius: 8,
                                                        textDecoration: "none",
                                                        color: "inherit",
                                                        background: "rgba(249,115,22,0.04)",
                                                        border: "1px solid rgba(249,115,22,0.08)",
                                                    }}
                                                >
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <div style={{
                                                            fontSize: 12,
                                                            lineHeight: 1.45,
                                                            color: "#e2e8f0",
                                                            marginBottom: 4,
                                                        }}>
                                                            {decodeHtml(post.title)}
                                                        </div>
                                                        <div style={{
                                                            display: "flex",
                                                            gap: 8,
                                                            flexWrap: "wrap",
                                                            fontSize: 10,
                                                            color: "#94a3b8",
                                                        }}>
                                                            <span>
                                                                {post.subreddit ? `r/${decodeHtml(post.subreddit)}` : decodeHtml(post.source || "Unknown source")}
                                                            </span>
                                                            <span>{post.score} upvotes</span>
                                                        </div>
                                                    </div>
                                                    <ExternalLink style={{
                                                        width: 12,
                                                        height: 12,
                                                        color: "#64748b",
                                                        flexShrink: 0,
                                                        marginTop: 2,
                                                    }} />
                                                </a>
                                            ))}
                                        </div>
                                    ) : (
                                        <div style={{ fontSize: 12, color: "#94a3b8" }}>
                                            No pain signals yet - run a scan to populate
                                        </div>
                                    )}
                                </div>

                                <div style={{
                                    padding: 14,
                                    borderRadius: 10,
                                    background: "rgba(255,255,255,0.02)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                }}>
                                    <div style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        marginBottom: 12,
                                        fontSize: 12,
                                        fontWeight: 700,
                                        color: "#f1f5f9",
                                    }}>
                                        <span style={{ color: "#22c55e" }}>Market momentum</span>
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                        <div style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 6,
                                            alignSelf: "flex-start",
                                            padding: "4px 10px",
                                            borderRadius: 999,
                                            background: `${idea.trend_direction === "rising" ? "#22c55e" : idea.trend_direction === "falling" ? "#ef4444" : "#64748b"}15`,
                                            color: idea.trend_direction === "rising" ? "#22c55e" : idea.trend_direction === "falling" ? "#ef4444" : "#94a3b8",
                                            fontSize: 11,
                                            fontWeight: 700,
                                            textTransform: "uppercase",
                                            letterSpacing: "0.06em",
                                        }}>
                                            <TrendIcon direction={idea.trend_direction} size={12} />
                                            {idea.trend_direction || "stable"}
                                        </div>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                            <div style={{
                                                padding: "10px 12px",
                                                borderRadius: 8,
                                                background: "rgba(255,255,255,0.03)",
                                                border: "1px solid rgba(255,255,255,0.05)",
                                            }}>
                                                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>24h change</div>
                                                <ChangeDisplay value={idea.change_24h} />
                                            </div>
                                            <div style={{
                                                padding: "10px 12px",
                                                borderRadius: 8,
                                                background: "rgba(255,255,255,0.03)",
                                                border: "1px solid rgba(255,255,255,0.05)",
                                            }}>
                                                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6 }}>7d change</div>
                                                <ChangeDisplay value={idea.change_7d} />
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
                                            {idea.post_count_total} total posts across {idea.source_count} {idea.source_count === 1 ? "source" : "sources"}.
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function StatCard({ label, value, icon: Icon, color, subtitle }: {
    label: string; value: string | number; icon: LucideIcon; color: string; subtitle?: string;
}) {
    return (
        <motion.div
            className="glass-card"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ padding: 20, borderRadius: 12, flex: 1, minWidth: 160 }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: `${color}15`, display: "flex",
                    alignItems: "center", justifyContent: "center",
                }}>
                    <Icon style={{ width: 16, height: 16, color }} />
                </div>
                <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {label}
                </span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#f1f5f9", fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                {value}
            </div>
            {subtitle && (
                <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{subtitle}</div>
            )}
        </motion.div>
    );
}

export default function StockMarketDashboard() {
    const [ideas, setIdeas] = useState<Idea[]>([]);
    const [tab, setTab] = useState<TabType>("top");
    const [category, setCategory] = useState("");
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState("");
    const [scanning, setScanning] = useState(false);
    const [scanStatus, setScanStatus] = useState<{ latestRun: any; ideaCount: number } | null>(null);
    const [scanError, setScanError] = useState("");
    const [trendCounts, setTrendCounts] = useState({ rising: 0, falling: 0 });
    const isDocumentVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

    const fetchIdeas = useCallback(async () => {
        setLoading(true);
        try {
            const sortMap: Record<TabType, string> = {
                top: "score", trending: "trending", dying: "dying", new: "new",
            };
            const res = await fetch(`/api/ideas?sort=${sortMap[tab]}&category=${category}&limit=50`);
            const data = await res.json();
            setIdeas(data.ideas || []);
            setLastUpdated(new Date().toLocaleTimeString());
        } catch {
            console.error("Failed to fetch ideas");
        } finally {
            setLoading(false);
        }
    }, [tab, category]);

    const fetchTrendCounts = useCallback(async () => {
        try {
            const [risingRes, fallingRes] = await Promise.all([
                fetch(`/api/ideas?sort=trending&category=${category}&limit=100`),
                fetch(`/api/ideas?sort=dying&category=${category}&limit=100`),
            ]);

            const [risingData, fallingData] = await Promise.all([
                risingRes.ok ? risingRes.json() : Promise.resolve({ ideas: [] }),
                fallingRes.ok ? fallingRes.json() : Promise.resolve({ ideas: [] }),
            ]);

            setTrendCounts({
                rising: Array.isArray(risingData.ideas) ? risingData.ideas.length : 0,
                falling: Array.isArray(fallingData.ideas) ? fallingData.ideas.length : 0,
            });
        } catch {
            console.error("Failed to fetch trend counts");
        }
    }, [category]);

    const fetchScanStatus = useCallback(async () => {
        if (!isDocumentVisible()) return;
        try {
            const res = await fetch("/api/discover");
            if (res.ok) {
                const data = await res.json();
                setScanStatus(data);
                // If a scan is running, keep polling
                if (data.latestRun?.status === "running") {
                    setScanning(true);
                } else if (scanning) {
                    // Scan just finished — refresh ideas
                    setScanning(false);
                    fetchIdeas();
                    fetchTrendCounts();
                }
            }
        } catch { /* silent */ }
    }, [scanning, fetchIdeas, fetchTrendCounts]);

    const launchScan = async () => {
        if (scanning) return;
        setScanning(true);
        setScanError("");
        try {
            const res = await fetch("/api/discover", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (!res.ok) {
                setScanError(data.error || "Failed to start scan");
                setScanning(false);
                return;
            }
        } catch {
            setScanError("Failed to start scan");
            setScanning(false);
        }
    };

    useEffect(() => {
        fetchIdeas();
        fetchTrendCounts();
        if (isDocumentVisible()) {
            fetchScanStatus();
        }
        const interval = setInterval(fetchIdeas, 60000);
        return () => clearInterval(interval);
    }, [fetchIdeas, fetchScanStatus, fetchTrendCounts]);

    // Poll scan status while scanning
    useEffect(() => {
        if (!scanning) return;
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                void fetchScanStatus();
            }
        };

        document.addEventListener("visibilitychange", onVisibilityChange);
        const poll = setInterval(() => {
            if (!isDocumentVisible()) return;
            void fetchScanStatus();
        }, 60000);

        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
            clearInterval(poll);
        };
    }, [scanning, fetchScanStatus]);

    const avgScore = ideas.length > 0 ? ideas.reduce((a, b) => a + b.current_score, 0) / ideas.length : 0;
    const totalPosts = ideas.reduce((a, b) => a + b.post_count_total, 0);

    return (
        <div style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
                <div>
                    <h1 style={{
                        fontSize: 24, fontWeight: 800, color: "#f1f5f9",
                        fontFamily: "var(--font-display)", marginBottom: 4, letterSpacing: "-0.02em",
                    }}>
                        Idea Stock Market
                    </h1>
                    <p style={{ fontSize: 13, color: "#64748b" }}>
                        Live opportunity scores from Reddit, HN, ProductHunt & IndieHackers
                    </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {/* Scan Status Badge */}
                    {scanStatus && scanStatus.ideaCount > 0 && (
                        <span style={{
                            fontSize: 11, color: "#64748b", display: "flex",
                            alignItems: "center", gap: 4, background: "rgba(255,255,255,0.03)",
                            padding: "4px 10px", borderRadius: 6,
                        }}>
                            <Activity style={{ width: 11, height: 11 }} />
                            {scanStatus.ideaCount} ideas tracked
                        </span>
                    )}

                    {/* Scan Button */}
                    <motion.button
                        onClick={launchScan}
                        disabled={scanning}
                        whileHover={scanning ? {} : { scale: 1.03 }}
                        whileTap={scanning ? {} : { scale: 0.97 }}
                        style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "8px 16px", borderRadius: 8,
                            border: "1px solid rgba(249,115,22,0.3)",
                            background: scanning
                                ? "rgba(249,115,22,0.08)"
                                : "linear-gradient(135deg, rgba(249,115,22,0.15), rgba(234,88,12,0.1))",
                            color: scanning ? "#f97316" : "#fb923c",
                            cursor: scanning ? "wait" : "pointer",
                            fontSize: 13, fontWeight: 600,
                            transition: "all 0.2s ease",
                        }}
                    >
                        {scanning ? (
                            <>
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                >
                                    <Activity style={{ width: 14, height: 14 }} />
                                </motion.div>
                                Scanning...
                            </>
                        ) : (
                            <>
                                <Zap style={{ width: 14, height: 14 }} />
                                Scan for Opportunities
                            </>
                        )}
                    </motion.button>

                    {lastUpdated && (
                        <span style={{ fontSize: 11, color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
                            <Clock style={{ width: 11, height: 11 }} /> {lastUpdated}
                        </span>
                    )}
                    <motion.div
                        animate={{ opacity: [1, 0.4, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        style={{
                            width: 8, height: 8, borderRadius: "50%",
                            background: scanning ? "#f97316" : "#22c55e",
                            boxShadow: scanning ? "0 0 8px rgba(249,115,22,0.5)" : "0 0 8px rgba(34,197,94,0.5)",
                        }}
                    />
                    <span style={{ fontSize: 11, color: scanning ? "#f97316" : "#22c55e", fontWeight: 600 }}>
                        {scanning ? "SCANNING" : "LIVE"}
                    </span>
                </div>
            </div>

            {/* Scanning Progress Banner */}
            <AnimatePresence>
                {scanning && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{
                            padding: "12px 18px", borderRadius: 10, marginBottom: 16,
                            background: "linear-gradient(135deg, rgba(249,115,22,0.08), rgba(234,88,12,0.04))",
                            border: "1px solid rgba(249,115,22,0.15)",
                            display: "flex", alignItems: "center", gap: 12,
                        }}
                    >
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        >
                            <Activity style={{ width: 16, height: 16, color: "#f97316" }} />
                        </motion.div>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#f97316" }}>
                                Scanning 4 platforms for opportunities...
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                                Reddit (42 subreddits) • Hacker News • ProductHunt • IndieHackers — this takes 3-8 minutes
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {scanError && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{
                            padding: "12px 18px", borderRadius: 10, marginBottom: 16,
                            background: "rgba(239,68,68,0.08)",
                            border: "1px solid rgba(239,68,68,0.18)",
                            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                        }}
                    >
                        <div style={{ fontSize: 13, color: "#fca5a5", fontWeight: 600 }}>
                            {scanError}
                        </div>
                        <button
                            onClick={() => setScanError("")}
                            style={{
                                padding: "6px 10px",
                                borderRadius: 8,
                                border: "1px solid rgba(255,255,255,0.12)",
                                background: "rgba(255,255,255,0.04)",
                                color: "#e2e8f0",
                                cursor: "pointer",
                                fontSize: 11,
                                fontWeight: 600,
                            }}
                        >
                            Dismiss
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Stats Row */}
            <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
                <StatCard label="Ideas Tracked" value={ideas.length} icon={Eye} color="#f97316" />
                <StatCard label="Rising" value={trendCounts.rising} icon={TrendingUp} color="#22c55e" subtitle="ideas trending up" />
                <StatCard label="Falling" value={trendCounts.falling} icon={TrendingDown} color="#ef4444" subtitle="ideas losing steam" />
                <StatCard label="Avg Score" value={avgScore.toFixed(0)} icon={Activity} color="#3b82f6" />
                <StatCard label="Total Posts" value={totalPosts.toLocaleString()} icon={BarChart3} color="#8b5cf6" />
            </div>

            {/* Tabs + Category Filter */}
            <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 16, flexWrap: "wrap", gap: 12,
            }}>
                <div style={{ display: "flex", gap: 4 }}>
                    {TABS.map((t) => {
                        const Icon = t.icon;
                        return (
                            <button
                                key={t.key}
                                onClick={() => setTab(t.key)}
                                style={{
                                    display: "flex", alignItems: "center", gap: 6,
                                    padding: "8px 16px", borderRadius: 8, border: "none",
                                    background: tab === t.key ? `${t.color}20` : "transparent",
                                    color: tab === t.key ? t.color : "#64748b",
                                    cursor: "pointer", fontSize: 13, fontWeight: 600,
                                    transition: "all 0.2s ease",
                                }}
                            >
                                <Icon style={{ width: 14, height: 14 }} />
                                {t.label}
                            </button>
                        );
                    })}
                </div>

                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {CATEGORIES.map((c) => (
                        <button
                            key={c.key}
                            onClick={() => setCategory(c.key)}
                            style={{
                                padding: "4px 10px", borderRadius: 6, border: "none",
                                background: category === c.key ? "rgba(249,115,22,0.15)" : "transparent",
                                color: category === c.key ? "#f97316" : "#475569",
                                cursor: "pointer", fontSize: 11, fontWeight: 500,
                                transition: "all 0.2s ease",
                            }}
                        >
                            {c.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table Header */}
            <div style={{
                display: "grid", gridTemplateColumns: "40px 1.5fr 100px 100px 100px 80px 80px",
                gap: 12, padding: "8px 18px",
                fontSize: 10, color: "#475569", fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.08em",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}>
                <div style={{ textAlign: "center" }}>#</div>
                <div>Opportunity</div>
                <div style={{ textAlign: "center" }}>Score</div>
                <div style={{ textAlign: "center" }}>24h</div>
                <div style={{ textAlign: "center" }}>7d</div>
                <div style={{ textAlign: "center" }}>Volume</div>
                <div style={{ textAlign: "center" }}>Sources</div>
            </div>

            {/* Idea Rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                {loading && ideas.length === 0 ? (
                    <div style={{
                        padding: 60, textAlign: "center", color: "#475569",
                        fontSize: 14,
                    }}>
                        <Activity style={{ width: 24, height: 24, margin: "0 auto 12px", opacity: 0.5 }} />
                        Loading ideas...
                    </div>
                ) : ideas.length === 0 ? (
                    <div style={{
                        padding: 60, textAlign: "center", color: "#475569",
                        fontSize: 14,
                    }}>
                        <Zap style={{ width: 24, height: 24, margin: "0 auto 12px", opacity: 0.5 }} />
                        <div style={{ marginBottom: 12 }}>No ideas found yet.</div>
                        <motion.button
                            onClick={launchScan}
                            disabled={scanning}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            style={{
                                padding: "10px 24px", borderRadius: 8,
                                border: "1px solid rgba(249,115,22,0.3)",
                                background: "linear-gradient(135deg, rgba(249,115,22,0.2), rgba(234,88,12,0.1))",
                                color: "#fb923c", cursor: "pointer",
                                fontSize: 14, fontWeight: 600,
                            }}
                        >
                            <Zap style={{ width: 14, height: 14, display: "inline", marginRight: 6, verticalAlign: "middle" }} />
                            {scanning ? "Scanning..." : "Launch First Scan"}
                        </motion.button>
                        <div style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>
                            Scans Reddit, HN, ProductHunt & IndieHackers for opportunities
                        </div>
                    </div>
                ) : (
                    <AnimatePresence>
                        {ideas.map((idea, i) => (
                            <IdeaRow key={idea.id} idea={idea} rank={i + 1} />
                        ))}
                    </AnimatePresence>
                )}
            </div>
        </div>
    );
}
