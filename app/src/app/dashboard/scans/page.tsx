"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Search, Clock, Radio, Target, Loader2, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";

interface Scan {
    id: string;
    keywords: string[];
    duration: string;
    status: string;
    posts_found: number;
    posts_analyzed: number;
    created_at: string;
}

export default function ScansPage() {
    const router = useRouter();
    const [keywordInput, setKeywordInput] = useState("");
    const [duration, setDuration] = useState("1h");
    const [launching, setLaunching] = useState(false);
    const [scans, setScans] = useState<Scan[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadScans = useCallback(async () => {
        setLoading(true);
        const supabase = createClient();
        const { data, error: queryError } = await supabase.from("scans").select("*").order("created_at", { ascending: false });
        if (queryError) {
            console.error(queryError);
            setError("Could not load data");
            setScans([]);
        } else {
            setScans((data || []) as Scan[]);
            setError(null);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        loadScans();
        const interval = setInterval(loadScans, 5000);
        return () => clearInterval(interval);
    }, [loadScans]);

    const launchScan = async () => {
        const kw = keywordInput.trim();
        if (!kw || launching) return;
        setLaunching(true);
        try {
            const res = await fetch("/api/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keywords: kw, duration }),
            });
            if (res.ok) {
                setKeywordInput("");
                loadScans();
            }
        } finally {
            setLaunching(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto pt-6 px-4 pb-20">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                <h1 className="text-[32px] font-bold font-display tracking-tight-custom text-white">Keyword Scans</h1>
                <p className="text-muted-foreground mt-1 text-sm font-mono">Deep-scan Reddit for any keyword or niche</p>
            </motion.div>

            {/* Targeting system */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bento-cell rounded-[14px] p-5 mb-5"
            >
                <div className="flex items-center gap-2 mb-3">
                    <Target className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[11px] font-mono font-bold text-primary uppercase tracking-[0.12em]">Targeting System</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                        <input
                            value={keywordInput}
                            onChange={(e) => setKeywordInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && launchScan()}
                            placeholder="Enter keyword to scan (e.g. AI tools, SEO)..."
                            className="w-full bg-surface-0 border border-white/10 rounded-lg pl-9 pr-4 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30 font-mono transition-all"
                        />
                    </div>
                    <select 
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        className="bg-surface-0 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 font-mono"
                    >
                        <option value="10min">10 min</option>
                        <option value="1h">1 hour</option>
                        <option value="10h">10 hours</option>
                        <option value="48h">48 hours</option>
                    </select>
                    <button
                        onClick={launchScan}
                        disabled={!keywordInput.trim() || launching}
                        className="inline-flex items-center gap-2 px-5 h-10 rounded-lg text-[13px] font-bold cursor-pointer transition-all text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                            background: "hsl(var(--primary))",
                            boxShadow: "0 0 24px hsla(16,100%,50%,0.3)",
                        }}
                        onMouseEnter={(e) => {
                            if (!keywordInput.trim() || launching) return;
                            e.currentTarget.style.transform = "translateY(-1px)";
                            e.currentTarget.style.boxShadow = "0 4px 32px hsla(16,100%,50%,0.45)";
                        }}
                        onMouseLeave={(e) => {
                            if (!keywordInput.trim() || launching) return;
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.boxShadow = "0 0 24px hsla(16,100%,50%,0.3)";
                        }}
                    >
                        {launching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
                        {launching ? "Launching..." : "Start Scan"}
                    </button>
                </div>
            </motion.div>

            {/* Scan History */}
            <div className="space-y-2">
                {loading ? (
                    <div className="flex justify-center p-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground/50" />
                    </div>
                ) : error ? (
                    <div className="bento-cell p-12 text-center rounded-[14px] flex flex-col items-center justify-center">
                        <AlertCircle className="w-8 h-8 text-dont/70 mb-3" />
                        <p className="text-[14px] font-medium text-foreground mb-1">Could not load data</p>
                        <button
                            onClick={loadScans}
                            className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-mono uppercase tracking-widest text-foreground hover:bg-white/10"
                        >
                            Retry
                        </button>
                    </div>
                ) : scans.length > 0 ? (
                    scans.map((scan, i) => {
                        const isRunning = ["starting", "scraping", "analyzing"].includes(scan.status);
                        const isDone = scan.status === "done";
                        const isFailed = scan.status === "failed";
                        
                        return (
                            <motion.div
                                key={scan.id}
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: Math.min(i * 0.05, 0.5) }}
                                onClick={() => isDone && router.push(`/dashboard/explore?scan=${scan.id}`)}
                                className={`bento-cell rounded-[14px] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 ${isDone ? "cursor-pointer hover:bg-white/[0.03] transition-colors" : ""}`}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isRunning ? "bg-build shadow-[0_0_10px_rgba(16,185,129,0.5)]" : isFailed ? "bg-dont" : isDone ? "bg-primary" : "bg-muted-foreground/30"}`}
                                        style={isRunning ? { animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" } : {}}
                                    />
                                    <div>
                                        <h3 className="text-sm font-bold font-mono text-white">"{scan.keywords?.join(", ")}"</h3>
                                        <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                                            {new Date(scan.created_at).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-6 justify-between md:justify-end">
                                    <div className="text-right hidden sm:block">
                                        <p className="text-2xl font-extrabold font-mono tracking-tight-custom text-white tabular-nums">{scan.posts_found || 0}</p>
                                        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.12em]">posts</p>
                                    </div>
                                    <div className="text-right hidden sm:block">
                                        <p className="text-2xl font-extrabold font-mono tracking-tight-custom text-white tabular-nums">{scan.posts_analyzed || 0}</p>
                                        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.12em]">analyzed</p>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
                                        <Clock className="w-3 h-3" />
                                        {scan.duration}
                                    </div>
                                    <span className={`text-[11px] font-bold uppercase px-2.5 py-1 rounded-md font-mono ${
                                        isDone ? "bg-primary/10 text-primary border border-primary/20" :
                                        isFailed ? "bg-dont/10 text-dont border border-dont/20" :
                                        isRunning ? "bg-build/10 text-build border border-build/20" :
                                        "bg-white/5 text-muted-foreground border border-white/10"
                                    }`}>
                                        {scan.status}
                                    </span>
                                </div>
                            </motion.div>
                        );
                    })
                ) : (
                    <div className="bento-cell p-12 text-center rounded-[14px] flex flex-col items-center justify-center">
                        <Search className="w-8 h-8 text-muted-foreground/30 mb-3" />
                        <p className="text-[14px] font-medium text-muted-foreground/80 mb-1">No scans yet</p>
                        <p className="text-[12px] text-muted-foreground/60">Launch your first scan to find Reddit opportunities.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
