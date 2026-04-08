"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase-browser";
import { useUserPlan } from "@/lib/use-user-plan";
import { PremiumGate } from "@/app/components/premium-gate";
import { useRouter } from "next/navigation";
import {
    CheckCircle2, AlertTriangle, XCircle, FileText, Loader2,
    Calendar, Search, Scale
} from "lucide-react";
import Link from "next/link";

/* ── Types ────────────────────────────────────────────────────── */
interface ValidationReport {
    id: string;
    idea_text: string;
    verdict: string;
    confidence: number;
    status: string;
    posts_analyzed: number;
    created_at: string;
    completed_at: string;
    report: Record<string, any>;
}

/* ── Helpers ──────────────────────────────────────────────────── */
function getVerdictStyle(v: string) {
    const u = (v || "").toUpperCase();
    if (u.includes("BUILD") && !u.includes("DON")) return { color: "text-build", border: "border-build/30", bg: "bg-build/10", icon: CheckCircle2 };
    if (u.includes("DON") || u.includes("REJECT")) return { color: "text-dont", border: "border-dont/30", bg: "bg-dont/10", icon: XCircle };
    return { color: "text-risky", border: "border-risky/30", bg: "bg-risky/10", icon: AlertTriangle };
}

/* ── Main Page ────────────────────────────────────────────────── */
export default function ReportsDirectoryPage() {
    const { isPremium } = useUserPlan();
    const router = useRouter();
    const [reports, setReports] = useState<ValidationReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    useEffect(() => {
        if (!isPremium) return;
        const load = async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { setLoading(false); return; }

            const { data } = await supabase
                .from("idea_validations")
                .select("id, idea_text, verdict, confidence, status, posts_analyzed, created_at, completed_at, report")
                .eq("user_id", user.id)
                .in("status", ["done", "failed", "error"]) 
                .order("created_at", { ascending: false });

            if (data) setReports(data as ValidationReport[]);
            setLoading(false);
        };
        load();
    }, [isPremium]);

    if (!isPremium) return <PremiumGate feature="Validation Reports" />;

    const filteredReports = reports.filter(r => 
        r.idea_text?.toLowerCase().includes(search.toLowerCase()) || 
        r.verdict?.toLowerCase().includes(search.toLowerCase())
    );

    function toggleSelected(id: string) {
        setSelectedIds((current) => {
            if (current.includes(id)) {
                return current.filter((value) => value !== id);
            }
            if (current.length >= 4) {
                return current;
            }
            return [...current, id];
        });
    }

    function compareSelected() {
        if (selectedIds.length < 2) return;
        router.push(`/dashboard/reports/compare?ids=${selectedIds.join(",")}`);
    }

    return (
        <div className="w-full max-w-7xl mx-auto pt-6 px-4 lg:px-8 pb-32">
            {/* Header */}
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <FileText className="w-6 h-6 text-primary" />
                        <h1 className="font-display text-4xl font-extrabold text-white tracking-tight-custom">
                            Validation Reports
                        </h1>
                    </div>
                    <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                        Finished decision reports with evidence, verdict, and next steps.
                    </p>
                </div>
                
                {/* Search Bar */}
                <div className="relative w-full md:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input 
                        type="text" 
                        placeholder="SEARCH REPORTS..." 
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-surface-1 border border-white/10 rounded-lg pl-10 pr-4 py-2 font-mono text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                    />
                </div>
            </motion.div>

            <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Compare Ideas</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Select 2 to 4 completed validations to compare their decision packs side by side.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                        {selectedIds.length}/4 selected
                    </div>
                    <button
                        type="button"
                        onClick={compareSelected}
                        disabled={selectedIds.length < 2}
                        className="inline-flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-muted-foreground"
                    >
                        <Scale className="h-3.5 w-3.5" />
                        Compare selected
                    </button>
                </div>
            </div>

            {/* Grid */}
            {loading ? (
                <div className="flex flex-col items-center justify-center p-20 gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Accessing Records</span>
                </div>
            ) : filteredReports.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <AnimatePresence>
                        {filteredReports.map((report, i) => {
                            const vs = getVerdictStyle(report.verdict);
                            const isFailed = report.status === "error" || report.status === "failed";
                            
                            return (
                                <motion.div 
                                    key={report.id}
                                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{ delay: i * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                                >
                                    <div className="bento-cell group h-full flex flex-col p-6 hover:border-primary/30 transition-all duration-300">
                                        {/* Top Row: Date & Status */}
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                                                <Calendar className="w-3 h-3" />
                                                {new Date(report.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSelected(report.id)}
                                                    disabled={isFailed}
                                                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest transition-colors ${
                                                        selectedIds.includes(report.id)
                                                            ? "border-primary/30 bg-primary/10 text-primary"
                                                            : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
                                                    } ${isFailed ? "cursor-not-allowed opacity-50" : ""}`}
                                                >
                                                    <Scale className="h-3 w-3" />
                                                    {selectedIds.includes(report.id) ? "Selected" : "Compare"}
                                                </button>
                                                {isFailed ? (
                                                    <div className="px-2 py-0.5 rounded border border-dont/30 bg-dont/10 text-dont font-mono text-[9px] uppercase tracking-widest font-bold">
                                                        FAILED
                                                    </div>
                                                ) : (
                                                    <div className={`px-2 py-0.5 rounded border ${vs.border} ${vs.bg} ${vs.color} font-mono text-[9px] uppercase tracking-widest font-bold flex items-center gap-1.5`}>
                                                        {report.verdict}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <Link href={`/dashboard/reports/${report.id}`} className="flex h-full flex-col">
                                            {/* Idea Text */}
                                            <h3 className="font-display text-lg font-bold text-foreground mb-4 line-clamp-3 leading-snug group-hover:text-primary transition-colors">
                                                {report.idea_text}
                                            </h3>

                                            {/* Bottom Metrics */}
                                            <div className="mt-auto pt-4 border-t border-white/5 grid grid-cols-2 gap-4">
                                                <div>
                                                    <div className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground mb-1">Posts Analyzed</div>
                                                    <div className="font-mono text-sm text-foreground">{report.posts_analyzed?.toLocaleString() || 0}</div>
                                                </div>
                                                {!isFailed && (
                                                    <div>
                                                        <div className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground mb-1">Confidence</div>
                                                        <div className={`font-mono text-sm font-bold ${vs.color}`}>{report.confidence}%</div>
                                                    </div>
                                                )}
                                            </div>
                                        </Link>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
            ) : (
                <div className="bento-cell flex flex-col items-center justify-center p-20 text-center border-dashed border-white/10">
                    <FileText className="w-12 h-12 text-muted-foreground opacity-20 mb-4" />
                    <h3 className="font-display text-xl text-foreground mb-2">No records found</h3>
                    <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest max-w-sm">
                        {search ? "No reports match your search query." : "Your validation directory is empty. Run your first validation to populate it."}
                    </p>
                    {!search && (
                        <p className="mt-3 max-w-md text-sm text-muted-foreground">
                            Each validation produces a full market intelligence report with verdict, evidence, and action plan.
                        </p>
                    )}
                    {!search && (
                        <Link href="/dashboard/validate" className="mt-6 px-6 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary font-mono text-[10px] uppercase font-bold tracking-widest hover:bg-primary/20 transition-colors">
                            Initialize New Validation
                        </Link>
                    )}
                </div>
            )}
        </div>
    );
}
