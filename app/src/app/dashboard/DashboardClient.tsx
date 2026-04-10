"use client";

import { useState, useEffect, useCallback } from "react";

/* ═══════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════ */
interface Scan {
    id: string;
    keywords: string[];
    duration: string;
    status: string;
    posts_found: number;
    posts_analyzed: number;
    created_at: string;
    completed_at: string | null;
}

interface AIResult {
    id: string;
    post_id: string;
    problem_description: string;
    urgency_score: number;
    willingness_to_pay: boolean;
    wtp_evidence: string;
    opportunity_type: string;
    market_size: string;
    solution_idea: string;
    ai_model_used: string;
}

interface ScanPost {
    id: string;
    title: string;
    subreddit: string;
    score: number;
    num_comments: number;
    full_text: string;
    matched_phrases: string[];
}

/* ═══════════════════════════════════════════════════════
   VISUAL COMPONENTS
   ═══════════════════════════════════════════════════════ */
function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
    const color = score >= 85 ? "#f97316" : score >= 70 ? "#eab308" : "#64748b";
    const r = 20, cx = 26, cy = 26;
    const circ = 2 * Math.PI * r;
    const dash = (score / 100) * circ;
    return (
        <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
            <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth="4" />
                <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="4"
                    strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                    style={{ transition: "stroke-dasharray 0.8s ease" }} />
            </svg>
            <div style={{
                position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "12px", fontWeight: 700, color, fontFamily: "var(--font-mono)"
            }}>{score}</div>
        </div>
    );
}

function UrgencyBar({ value }: { value: number }) {
    const colors = ["", "#334155", "#334155", "#475569", "#64748b", "#6b7280", "#ca8a04", "#d97706", "#ea580c", "#f97316", "#ef4444"];
    return (
        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
            {Array.from({ length: 10 }, (_, i) => (
                <div key={i} style={{
                    width: 6, height: 14, borderRadius: 2,
                    background: i < value ? colors[value] || "#475569" : "#1e293b",
                    transition: "background 0.3s"
                }} />
            ))}
        </div>
    );
}

const SCAN_PHASES = [
    { id: "starting", label: "Starting", icon: "🔌" },
    { id: "scraping", label: "Scraping", icon: "🔍" },
    { id: "uploading", label: "Uploading", icon: "☁️" },
    { id: "analyzing", label: "Analyzing", icon: "🧠" },
    { id: "done", label: "Complete", icon: "✅" },
];

function StatusBadge({ status }: { status: string }) {
    const colors: Record<string, [string, string]> = {
        starting: ["#3b82f6", "rgba(59,130,246,0.1)"],
        scraping: ["#f97316", "rgba(249,115,22,0.1)"],
        uploading: ["#a855f7", "rgba(168,85,247,0.1)"],
        analyzing: ["#f97316", "rgba(249,115,22,0.1)"],
        done: ["#22c55e", "rgba(34,197,94,0.1)"],
        complete: ["#22c55e", "rgba(34,197,94,0.1)"],
        failed: ["#ef4444", "rgba(239,68,68,0.1)"],
    };
    const [c, bg] = colors[status] || colors.starting;
    return <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: c, background: bg, padding: "4px 10px", borderRadius: 20 }}>{status}</span>;
}

function ScanMonitor({ scan, onViewResults }: { scan: Scan; onViewResults: (id: string) => void }) {
    const currentPhaseIdx = SCAN_PHASES.findIndex(p => p.id === scan.status);
    const isRunning = ["starting", "scraping", "uploading", "analyzing"].includes(scan.status);
    const isFailed = scan.status === "failed";
    const isDone = scan.status === "done" || scan.status === "complete";
    const progress = scan.posts_found > 0 && scan.posts_analyzed > 0
        ? Math.round((scan.posts_analyzed / scan.posts_found) * 100) : 0;

    return (
        <div style={{
            background: "linear-gradient(135deg, #0c1220, #0f172a)",
            border: `1px solid ${isFailed ? "rgba(239,68,68,0.3)" : isDone ? "rgba(34,197,94,0.3)" : "rgba(249,115,22,0.2)"}`,
            borderRadius: 16, padding: 28, marginBottom: 24,
        }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", fontFamily: "var(--font-display)", marginBottom: 4 }}>
                        {isRunning ? "🔴 Scan In Progress" : isDone ? "✅ Scan Complete" : "❌ Scan Failed"}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", fontFamily: "var(--font-mono)" }}>
                        {scan.keywords.join(", ")} · {scan.duration}
                    </div>
                </div>
                <StatusBadge status={scan.status} />
            </div>

            {/* Phase Timeline */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 24 }}>
                {SCAN_PHASES.map((phase, i) => {
                    const isActive = phase.id === scan.status;
                    const isPast = i < currentPhaseIdx;
                    const isFuture = i > currentPhaseIdx;
                    return (
                        <div key={phase.id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                            <div style={{
                                width: 36, height: 36, borderRadius: "50%",
                                background: isPast ? "rgba(34,197,94,0.15)" : isActive ? "rgba(249,115,22,0.15)" : "rgba(255,255,255,0.03)",
                                border: `2px solid ${isPast ? "#22c55e" : isActive ? "#f97316" : "rgba(255,255,255,0.06)"}`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 14, transition: "all 0.3s",
                                animation: isActive ? "pulse-glow 2s ease-in-out infinite" : "none",
                            }}>
                                {isPast ? "✓" : phase.icon}
                            </div>
                            <span style={{
                                fontSize: 9, fontFamily: "var(--font-mono)", letterSpacing: "0.05em",
                                color: isPast ? "#22c55e" : isActive ? "#f97316" : "#334155",
                                fontWeight: isActive ? 700 : 400,
                            }}>{phase.label}</span>
                            {i < SCAN_PHASES.length - 1 && (
                                <div style={{
                                    position: "absolute", width: "calc(100% / 5 - 16px)", height: 2,
                                    background: isPast ? "#22c55e" : "rgba(255,255,255,0.06)",
                                    display: "none",
                                }} />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Live Counters */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
                <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "14px 16px", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ fontSize: 9, color: "#64748b", fontFamily: "var(--font-mono)", letterSpacing: "0.1em", marginBottom: 4 }}>POSTS FOUND</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: "#f97316", fontFamily: "var(--font-display)", lineHeight: 1 }}>
                        {scan.posts_found || 0}
                    </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "14px 16px", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ fontSize: 9, color: "#64748b", fontFamily: "var(--font-mono)", letterSpacing: "0.1em", marginBottom: 4 }}>ANALYZED</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: "#818cf8", fontFamily: "var(--font-display)", lineHeight: 1 }}>
                        {scan.posts_analyzed || 0}
                    </div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "14px 16px", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ fontSize: 9, color: "#64748b", fontFamily: "var(--font-mono)", letterSpacing: "0.1em", marginBottom: 4 }}>STATUS</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: isRunning ? "#f97316" : isDone ? "#22c55e" : "#ef4444", fontFamily: "var(--font-display)", lineHeight: 1.5 }}>
                        {scan.status === "scraping" ? "Scanning Reddit & HN..."
                            : scan.status === "uploading" ? "Saving posts..."
                                : scan.status === "analyzing" ? "AI analyzing..."
                                    : scan.status === "done" ? "Complete!"
                                        : scan.status === "failed" ? "Failed"
                                            : "Starting..."}
                    </div>
                </div>
            </div>

            {/* Progress Bar (during analysis) */}
            {scan.status === "analyzing" && scan.posts_found > 0 && (
                <div style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: "#64748b", fontFamily: "var(--font-mono)" }}>Analysis progress</span>
                        <span style={{ fontSize: 11, color: "#f97316", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{progress}%</span>
                    </div>
                    <div style={{ height: 6, background: "rgba(255,255,255,0.04)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{
                            height: "100%", borderRadius: 3,
                            background: "linear-gradient(90deg, #f97316, #fbbf24)",
                            width: `${progress}%`, transition: "width 0.5s ease",
                        }} />
                    </div>
                </div>
            )}

            {/* Action buttons */}
            {isDone && (
                <button className="btn-primary" style={{ width: "100%", padding: "12px 0", fontSize: 14 }}
                    onClick={() => onViewResults(scan.id)}>View Results →</button>
            )}
            {isRunning && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#64748b", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                    <div style={{ display: "flex", gap: 3 }}>
                        {[0, 1, 2].map(i => (
                            <div key={i} style={{
                                width: 4, height: 14, background: "#f97316", borderRadius: 2,
                                animation: `pulse 1s ease-in-out ${i * 0.2}s infinite alternate`
                            }} />
                        ))}
                    </div>
                    Polling every 3s for updates...
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════
   NAV CONFIG
   ═══════════════════════════════════════════════════════ */
const NAV_ITEMS = [
    { id: "opportunities", icon: "🎯", label: "Opportunities" },
    { id: "scan", icon: "🔍", label: "New Scan" },
    { id: "history", icon: "📋", label: "History" },
    { id: "wtp", icon: "💰", label: "Will Pay" },
    { id: "saved", icon: "🔖", label: "Following" },
    { id: "settings", icon: "⚙️", label: "Settings" },
];

const AI_MODELS = [
    {
        id: "gemini",
        name: "Google Gemini",
        model: "Gemini 2.0 Flash",
        icon: "✨",
        color: "#4285f4",
        bg: "rgba(66,133,244,0.08)",
        border: "rgba(66,133,244,0.2)",
        field: "gemini_api_key",
        cost: "Free",
        speed: "15 req/min",
        desc: "Primary model — handles 90% of analysis. Completely free.",
        getUrl: "https://aistudio.google.com/apikey",
    },
    {
        id: "groq",
        name: "Groq (Llama 3.3)",
        model: "Llama 3.3 70B",
        icon: "⚡",
        color: "#f55036",
        bg: "rgba(245,80,54,0.08)",
        border: "rgba(245,80,54,0.2)",
        field: "groq_api_key",
        cost: "Free",
        speed: "30 req/min",
        desc: "Fallback when Gemini is rate limited. Ultra-fast inference.",
        getUrl: "https://console.groq.com/keys",
    },
    {
        id: "openai",
        name: "OpenAI",
        model: "GPT-4o-mini",
        icon: "🧠",
        color: "#10a37f",
        bg: "rgba(16,163,127,0.08)",
        border: "rgba(16,163,127,0.2)",
        field: "openai_api_key",
        cost: "$0.15/1M tokens",
        speed: "500 req/min",
        desc: "Deep analysis on high-score posts. Optional premium model.",
        getUrl: "https://platform.openai.com/api-keys",
    },
];

const KEYWORD_SUGGESTIONS = [
    "invoice tool alternative", "CRM too expensive", "Notion workflow",
    "email automation cheap", "freelance contract template", "shopify app missing feature",
    "time tracking tool", "PDF generator SaaS",
];

const DURATIONS = [
    { v: "10min", l: "Quick Scan", d: "~200 posts" },
    { v: "1h", l: "Standard", d: "~800 posts" },
    { v: "10h", l: "Deep Scan", d: "~5K posts" },
    { v: "48h", l: "Full Sweep", d: "~12K posts" },
];

/* ═══════════════════════════════════════════════════════
   OPPORTUNITY CARD
   ═══════════════════════════════════════════════════════ */
function OpportunityCard({
    result, post, saved, onSave
}: {
    result: AIResult; post?: ScanPost; saved: boolean; onSave: (id: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const redditUrl = post ? `https://reddit.com/r/${post.subreddit}/comments/${post.id}` : "#";

    return (
        <div
            className={`opp-card ${expanded ? "expanded" : ""} ${result.willingness_to_pay ? "wtp" : ""}`}
            onClick={() => setExpanded(!expanded)}
        >
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <ScoreRing score={result.urgency_score * 10} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Meta row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                        {post && <span style={{
                            fontSize: 11, fontFamily: "var(--font-mono)", color: "#f97316",
                            background: "rgba(249,115,22,0.1)", padding: "2px 8px", borderRadius: 4
                        }}>r/{post.subreddit}</span>}
                        {result.willingness_to_pay && <span style={{
                            fontSize: 11, fontFamily: "var(--font-mono)", color: "#22c55e",
                            background: "rgba(34,197,94,0.1)", padding: "2px 8px", borderRadius: 4
                        }}>💰 WILL PAY</span>}
                        {post && <span style={{ fontSize: 11, color: "#475569" }}>↑ {post.score} · 💬 {post.num_comments}</span>}
                    </div>
                    {/* Problem title */}
                    <div style={{
                        fontSize: 14, fontWeight: 600, color: "#f1f5f9", lineHeight: 1.5, marginBottom: 8,
                        fontFamily: "var(--font-display)"
                    }}>{result.problem_description || post?.title || "—"}</div>
                    {/* Pain phrases */}
                    {post?.matched_phrases && post.matched_phrases.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {post.matched_phrases.slice(0, 4).map(p => (
                                <span key={p} className="pain-chip">&quot;{p}&quot;</span>
                            ))}
                        </div>
                    )}
                </div>
                {/* Right side */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, flexShrink: 0 }}>
                    <button onClick={e => { e.stopPropagation(); onSave(result.id); }} style={{
                        background: saved ? "rgba(249,115,22,0.15)" : "transparent",
                        border: `1px solid ${saved ? "rgba(249,115,22,0.4)" : "rgba(255,255,255,0.1)"}`,
                        color: saved ? "#f97316" : "#475569", borderRadius: 8, padding: "6px 10px",
                        cursor: "pointer", fontSize: 13, transition: "all 0.2s"
                    }}>
                        {saved ? "🔖" : "＋ Save"}
                    </button>
                    <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, color: "#475569", fontFamily: "var(--font-mono)", marginBottom: 4 }}>URGENCY</div>
                        <UrgencyBar value={result.urgency_score} />
                    </div>
                </div>
            </div>

            {/* Expanded detail */}
            {expanded && (
                <div style={{
                    marginTop: 20, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.06)",
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16
                }}>
                    <div className="detail-panel">
                        <div className="detail-label">🔥 PROBLEM IDENTIFIED</div>
                        <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>{result.problem_description}</div>
                    </div>
                    <div className="detail-panel">
                        <div className="detail-label">💡 SOLUTION DIRECTION</div>
                        <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>{result.solution_idea || "—"}</div>
                    </div>
                    <div className="detail-panel">
                        <div className="detail-label">📊 METADATA</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                            {[["Type", result.opportunity_type], ["Market", result.market_size],
                            ["Model", result.ai_model_used], ["Confidence", `${result.urgency_score}/10`]].map(([k, v]) => (
                                <div key={k}><span style={{ fontSize: 11, color: "#475569" }}>{k}: </span>
                                    <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "var(--font-mono)" }}>{v}</span></div>
                            ))}
                        </div>
                    </div>
                    {result.willingness_to_pay && (
                        <div style={{
                            background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)",
                            borderRadius: 8, padding: 16
                        }}>
                            <div style={{ fontSize: 10, color: "#22c55e", fontFamily: "var(--font-mono)", marginBottom: 6 }}>💰 WTP EVIDENCE</div>
                            <div style={{ fontSize: 13, color: "#86efac" }}>{result.wtp_evidence}</div>
                        </div>
                    )}
                    <div style={{ gridColumn: "1/-1", display: "flex", gap: 10 }}>
                        <a href={redditUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ flex: 1 }}>→ View on Reddit</a>
                        <button className="btn-secondary" style={{
                            flex: 1, background: "rgba(129,140,248,0.1)",
                            border: "1px solid rgba(129,140,248,0.3)", color: "#818cf8"
                        }}
                            onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(`Problem: ${result.problem_description}\nSolution: ${result.solution_idea}\nUrgency: ${result.urgency_score}/10\nReddit: ${redditUrl}`);
                            }}>📋 Copy Insight</button>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════
   MAIN DASHBOARD
   ═══════════════════════════════════════════════════════ */
export default function DashboardClient({
    userPlan, userEmail,
}: {
    userPlan: string; userEmail: string;
}) {
    const [activeTab, setActiveTab] = useState("scan");
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState("");

    // Scan state
    const [keywords, setKeywords] = useState("");
    const [duration, setDuration] = useState("1h");
    const [launching, setLaunching] = useState(false);
    const [launched, setLaunched] = useState(false);
    const [monitorScanId, setMonitorScanId] = useState<string | null>(null);

    // Settings state (localStorage-based — keys never leave your browser)
    const [modelStatus, setModelStatus] = useState<Record<string, { connected: boolean; masked: string; key: string }>>({});
    const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [settingsMsg, setSettingsMsg] = useState("");

    // Data state
    const [scans, setScans] = useState<Scan[]>([]);
    const [activeScanId, setActiveScanId] = useState<string | null>(null);
    const [scanResults, setScanResults] = useState<AIResult[]>([]);
    const [scanPosts, setScanPosts] = useState<ScanPost[]>([]);

    // ── Save/unsave ──
    const toggleSave = (id: string) => {
        setSavedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            localStorage.setItem("rp_saved", JSON.stringify([...next]));
            return next;
        });
    };

    // Load saved + settings from localStorage
    useEffect(() => {
        try {
            const stored = localStorage.getItem("rp_saved");
            if (stored) setSavedIds(new Set(JSON.parse(stored)));
        } catch { }
        loadKeysFromStorage();
    }, []);

    // ── Load API keys from localStorage ──
    function loadKeysFromStorage() {
        try {
            const stored = localStorage.getItem("rp_keys");
            const keys = stored ? JSON.parse(stored) : {};
            const status: Record<string, { connected: boolean; masked: string; key: string }> = {};
            for (const model of ["gemini", "groq", "openai"]) {
                const k = keys[model] || "";
                status[model] = {
                    connected: !!k,
                    masked: k ? "•••••" + k.slice(-4) : "",
                    key: k,
                };
            }
            setModelStatus(status);
        } catch { }
    }

    // ── Save API key to localStorage ──
    function saveApiKey(field: string, modelId: string) {
        const key = keyInputs[modelId];
        if (!key?.trim()) return;
        setSavingKey(modelId);
        try {
            const stored = localStorage.getItem("rp_keys");
            const keys = stored ? JSON.parse(stored) : {};
            keys[modelId] = key.trim();
            localStorage.setItem("rp_keys", JSON.stringify(keys));
            setSettingsMsg(`✅ ${modelId} connected!`);
            setKeyInputs(prev => ({ ...prev, [modelId]: "" }));
            loadKeysFromStorage();
        } catch {
            setSettingsMsg(`❌ Failed to save ${modelId} key`);
        }
        setSavingKey(null);
    }

    // ── Disconnect model ──
    function disconnectModel(field: string, modelId: string) {
        try {
            const stored = localStorage.getItem("rp_keys");
            const keys = stored ? JSON.parse(stored) : {};
            delete keys[modelId];
            localStorage.setItem("rp_keys", JSON.stringify(keys));
            setSettingsMsg(`Disconnected ${modelId}`);
            loadKeysFromStorage();
        } catch { }
    }

    const connectedModels = Object.values(modelStatus).filter(m => m.connected).length;


    // ── Load scans ──
    const loadScans = useCallback(async () => {
        try {
            const resp = await fetch("/api/scan");
            if (resp.ok) {
                const data = await resp.json();
                setScans(data.scans || []);
            }
        } catch { }
    }, []);

    useEffect(() => { loadScans(); }, [loadScans]);

    // ── Poll running scans ──
    useEffect(() => {
        const running = scans.some(s => ["starting", "scraping", "uploading", "analyzing"].includes(s.status));
        if (!running) return;
        const iv = setInterval(loadScans, 5000);
        return () => clearInterval(iv);
    }, [scans, loadScans]);

    // ── Launch scan ──
    async function launchScan() {
        if (!keywords.trim()) return;
        setLaunching(true);
        const kwList = keywords.split(",").map(k => k.trim()).filter(Boolean);
        const resp = await fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keywords: kwList, duration }),
        });
        if (resp.ok) {
            const data = await resp.json();
            setLaunched(true);
            setMonitorScanId(data.scanId);
            setKeywords("");
            loadScans();
        }
        setLaunching(false);
    }

    // ── Poll active scan for monitor ──
    useEffect(() => {
        if (!monitorScanId) return;
        const iv = setInterval(async () => {
            await loadScans();
        }, 3000);
        return () => clearInterval(iv);
    }, [monitorScanId, loadScans]);

    // ── Auto-clear monitor when scan finishes ──
    const monitorScan = scans.find(s => s.id === monitorScanId);
    // Also find any running scan to show monitor for
    const runningScan = scans.find(s => ["starting", "scraping", "uploading", "analyzing"].includes(s.status));
    const activeScanToMonitor = monitorScan || runningScan;

    // ── View scan results ──
    async function viewResults(scanId: string) {
        setActiveScanId(scanId);
        setActiveTab("opportunities");
        const resp = await fetch(`/api/scan/${scanId}`);
        if (resp.ok) {
            const data = await resp.json();
            setScanResults(data.results || []);
            setScanPosts(data.posts || []);
        }
    }

    // ── Derived data ──
    const wtpResults = scanResults.filter(r => r.willingness_to_pay);
    const savedResults = scanResults.filter(r => savedIds.has(r.id));
    const filteredResults = scanResults.filter(r =>
        !search || r.problem_description?.toLowerCase().includes(search.toLowerCase())
        || r.solution_idea?.toLowerCase().includes(search.toLowerCase())
    );
    const activeScan = scans.find(s => s.id === activeScanId);

    // ── Stats ──
    const stats = [
        { label: "OPPORTUNITIES", value: scanResults.length.toString(), sub: activeScan ? `from "${activeScan.keywords[0]}"` : "select a scan", color: "#f97316" },
        { label: "WILL PAY", value: wtpResults.length.toString(), sub: scanResults.length ? `${Math.round(wtpResults.length / scanResults.length * 100)}% of finds` : "—", color: "#22c55e" },
        { label: "AVG URGENCY", value: scanResults.length ? (scanResults.reduce((a, r) => a + r.urgency_score, 0) / scanResults.length).toFixed(1) : "—", sub: "out of 10", color: "#818cf8" },
        { label: "SCANS RUN", value: scans.length.toString(), sub: "total", color: "#38bdf8" },
    ];

    return (
        <div style={{ display: "flex", height: "100vh", fontFamily: "var(--font-mono)", overflow: "hidden" }}>

            {/* ══════════ SIDEBAR ══════════ */}
            <div className="sidebar" style={{ width: sidebarOpen ? 220 : 64 }}>
                {/* Logo */}
                <div style={{
                    padding: "20px 16px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)",
                    display: "flex", alignItems: "center", gap: 10, cursor: "pointer"
                }}
                    onClick={() => setSidebarOpen(!sidebarOpen)}>
                    <div style={{
                        width: 32, height: 32, background: "linear-gradient(135deg, #f97316, #ea580c)",
                        borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 16, flexShrink: 0
                    }}>⚡</div>
                    {sidebarOpen && <div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#f1f5f9", fontFamily: "var(--font-display)", letterSpacing: "-0.3px" }}>CueIdea</div>
                        <div style={{ fontSize: 9, color: "#475569" }}>INTELLIGENCE TOOL</div>
                    </div>}
                </div>

                {/* Nav Items */}
                <nav style={{ flex: 1, padding: "12px 8px" }}>
                    {NAV_ITEMS.map(item => {
                        const badge = item.id === "opportunities" ? scanResults.length :
                            item.id === "wtp" ? wtpResults.length :
                                item.id === "history" ? scans.length :
                                    item.id === "saved" ? savedIds.size : null;
                        return (
                            <button key={item.id} onClick={() => setActiveTab(item.id)}
                                className={`sidebar-nav-btn ${activeTab === item.id ? "active" : ""}`}>
                                {activeTab === item.id && <div className="indicator" />}
                                <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                                {sidebarOpen && <>
                                    <span style={{
                                        fontSize: 13, color: activeTab === item.id ? "#f97316" : "#64748b",
                                        fontWeight: activeTab === item.id ? 600 : 400, flex: 1
                                    }}>{item.label}</span>
                                    {badge !== null && badge > 0 && <span style={{
                                        fontSize: 10,
                                        background: activeTab === item.id ? "#f97316" : "#1e293b",
                                        color: activeTab === item.id ? "#fff" : "#64748b",
                                        borderRadius: 10, padding: "2px 6px", minWidth: 20, textAlign: "center"
                                    }}>{badge}</span>}
                                </>}
                            </button>
                        );
                    })}
                </nav>

                {/* User Card */}
                {sidebarOpen && <div style={{ padding: 12, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ background: "#0f172a", borderRadius: 8, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                            width: 28, height: 28, background: "linear-gradient(135deg, #f97316, #7c3aed)",
                            borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 11, color: "#fff", fontWeight: 700, flexShrink: 0
                        }}>
                            {userEmail.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "capitalize" }}>{userPlan} Plan</div>
                            <div style={{ fontSize: 9, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userEmail}</div>
                        </div>
                    </div>
                </div>}
            </div>

            {/* ══════════ MAIN CONTENT ══════════ */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

                {/* Topbar */}
                <div style={{
                    padding: "16px 28px", borderBottom: "1px solid rgba(255,255,255,0.05)",
                    display: "flex", alignItems: "center", gap: 16, background: "#080d18", flexShrink: 0
                }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", fontFamily: "var(--font-display)" }}>
                            {NAV_ITEMS.find(n => n.id === activeTab)?.icon} {NAV_ITEMS.find(n => n.id === activeTab)?.label}
                        </div>
                    </div>
                    <div style={{ position: "relative" }}>
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search opportunities..."
                            style={{
                                background: "#0f172a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8,
                                padding: "8px 14px 8px 34px", color: "#94a3b8", fontSize: 12, outline: "none", width: 220,
                                fontFamily: "var(--font-mono)"
                            }} />
                        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#475569" }}>🔍</span>
                    </div>
                    <button className="btn-primary" style={{ padding: "8px 16px", fontSize: 12, borderRadius: 8 }}
                        onClick={() => setActiveTab("scan")}>+ New Scan</button>
                </div>

                {/* Stats bar (only on opportunities tab) */}
                {activeTab === "opportunities" && (
                    <div style={{
                        padding: "16px 28px", borderBottom: "1px solid rgba(255,255,255,0.04)",
                        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, flexShrink: 0
                    }}>
                        {stats.map(s => (
                            <div key={s.label} className="stat-card">
                                <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.08em", marginBottom: 4, fontFamily: "var(--font-mono)" }}>{s.label}</div>
                                <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "var(--font-display)", lineHeight: 1 }}>{s.value}</div>
                                <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>{s.sub}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* ══════════ CONTENT AREA ══════════ */}
                <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>

                    {/* OPPORTUNITIES */}
                    {activeTab === "opportunities" && (
                        <div className="animate-fade-in">
                            {scanResults.length === 0 && scanPosts.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "80px 20px" }}>
                                    <div style={{ fontSize: 40, marginBottom: 16 }}>🎯</div>
                                    <div style={{ fontSize: 16, fontWeight: 600, color: "#475569", fontFamily: "var(--font-display)", marginBottom: 8 }}>
                                        No opportunities yet
                                    </div>
                                    <div style={{ fontSize: 13, color: "#334155", marginBottom: 20 }}>
                                        {scans.length === 0 ? "Launch your first scan to find business opportunities!" : "Select a completed scan from History to view results"}
                                    </div>
                                    <button className="btn-primary" style={{ padding: "10px 24px", fontSize: 13 }}
                                        onClick={() => setActiveTab(scans.length === 0 ? "scan" : "history")}>
                                        {scans.length === 0 ? "🔍 Launch a Scan" : "📋 View History"}
                                    </button>
                                </div>
                            ) : scanResults.length === 0 && scanPosts.length > 0 ? (
                                <>
                                    {/* Posts found but not analyzed — show raw posts */}
                                    <div style={{
                                        background: "linear-gradient(135deg, rgba(249,115,22,0.06), rgba(249,115,22,0.02))",
                                        border: "1px solid rgba(249,115,22,0.2)", borderRadius: 12, padding: "20px 24px", marginBottom: 24
                                    }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: "#f97316", fontFamily: "var(--font-display)", marginBottom: 6 }}>
                                            ⚠️ Posts Found — AI Analysis Missing
                                        </div>
                                        <div style={{ fontSize: 12, color: "#64748b" }}>
                                            {scanPosts.length} posts were scraped but the AI couldn&apos;t analyze them. Set your <strong style={{ color: "#f97316" }}>GEMINI_API_KEY</strong> in Settings → AI Models to enable analysis. Below are the raw posts found.
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 11, color: "#475569", marginBottom: 16, fontFamily: "var(--font-mono)" }}>
                                        {scanPosts.length} raw posts found {activeScan ? `for "${activeScan.keywords.join(", ")}"` : ""}
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        {scanPosts
                                            .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
                                            .map((p: { id: string; title: string; subreddit: string; score: number; num_comments: number; full_text: string }) => (
                                                <div key={p.id} style={{
                                                    background: "#0f172a", border: "1px solid rgba(255,255,255,0.07)",
                                                    borderRadius: 12, padding: "16px 20px",
                                                    transition: "border-color 0.2s",
                                                }}>
                                                    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                                                        <div style={{
                                                            minWidth: 48, textAlign: "center", padding: "6px 0",
                                                            background: "rgba(249,115,22,0.08)", borderRadius: 8,
                                                            border: "1px solid rgba(249,115,22,0.15)"
                                                        }}>
                                                            <div style={{ fontSize: 16, fontWeight: 800, color: "#f97316", fontFamily: "var(--font-display)" }}>
                                                                {p.score}
                                                            </div>
                                                            <div style={{ fontSize: 8, color: "#64748b", letterSpacing: "0.05em" }}>⬆</div>
                                                        </div>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", fontFamily: "var(--font-display)", marginBottom: 4, lineHeight: 1.4 }}>
                                                                {p.title}
                                                            </div>
                                                            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                                                <span style={{
                                                                    fontSize: 10, fontFamily: "var(--font-mono)", color: "#818cf8",
                                                                    background: "rgba(129,140,248,0.08)", padding: "2px 8px", borderRadius: 4
                                                                }}>r/{p.subreddit}</span>
                                                                <span style={{ fontSize: 10, color: "#475569", fontFamily: "var(--font-mono)" }}>
                                                                    💬 {p.num_comments} comments
                                                                </span>
                                                            </div>
                                                            {p.full_text && (
                                                                <div style={{
                                                                    fontSize: 12, color: "#64748b", marginTop: 8, lineHeight: 1.6,
                                                                    display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden"
                                                                }}>
                                                                    {p.full_text.substring(0, 300)}{p.full_text.length > 300 ? "..." : ""}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ fontSize: 11, color: "#475569", marginBottom: 16, fontFamily: "var(--font-mono)" }}>
                                        {filteredResults.length} results {search && `for "${search}"`}
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                        {filteredResults
                                            .sort((a, b) => b.urgency_score - a.urgency_score)
                                            .map(r => (
                                                <OpportunityCard key={r.id} result={r}
                                                    post={scanPosts.find(p => p.id === r.post_id)}
                                                    saved={savedIds.has(r.id)} onSave={toggleSave} />
                                            ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* NEW SCAN */}
                    {activeTab === "scan" && (
                        <div className="animate-fade-in" style={{ maxWidth: 680, margin: "0 auto" }}>
                            <div style={{ marginBottom: 32 }}>
                                <h2 style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", fontFamily: "var(--font-display)", marginBottom: 6 }}>
                                    Start a New Scan
                                </h2>
                                <p style={{ color: "#64748b", fontSize: 14 }}>Enter keywords describing the pain point or product category you want to find opportunities in.</p>
                            </div>

                            {launched && activeScanToMonitor ? (
                                <>
                                    <ScanMonitor scan={activeScanToMonitor} onViewResults={(id) => { viewResults(id); setLaunched(false); setMonitorScanId(null); }} />
                                    {(activeScanToMonitor.status === "done" || activeScanToMonitor.status === "failed") && (
                                        <button onClick={() => { setLaunched(false); setMonitorScanId(null); }} className="btn-secondary" style={{
                                            marginTop: 12, width: "100%", color: "#22c55e",
                                            background: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)"
                                        }}>Launch Another Scan</button>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 24, marginBottom: 16 }}>
                                        <label style={{ fontSize: 11, color: "#64748b", fontFamily: "var(--font-mono)", display: "block", marginBottom: 10, letterSpacing: "0.08em" }}>
                                            KEYWORDS TO SCAN FOR
                                        </label>
                                        <textarea value={keywords} onChange={e => setKeywords(e.target.value)}
                                            placeholder="e.g. invoice automation, client reporting tool, PDF generator"
                                            style={{
                                                width: "100%", background: "#1e293b", border: "1px solid rgba(255,255,255,0.08)",
                                                borderRadius: 8, padding: "14px 16px", color: "#f1f5f9", fontSize: 14, resize: "none",
                                                height: 80, fontFamily: "var(--font-mono)", outline: "none", boxSizing: "border-box",
                                                lineHeight: 1.6
                                            }} />
                                        <div style={{ marginTop: 12 }}>
                                            <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>Popular searches:</div>
                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                                {KEYWORD_SUGGESTIONS.map(s => (
                                                    <button key={s} onClick={() => setKeywords(prev => prev ? prev + ", " + s : s)}
                                                        className="kw-pill">+ {s}</button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: 24, marginBottom: 20 }}>
                                        <label style={{ fontSize: 11, color: "#64748b", fontFamily: "var(--font-mono)", display: "block", marginBottom: 14, letterSpacing: "0.08em" }}>
                                            SCAN DURATION
                                        </label>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                                            {DURATIONS.map(d => (
                                                <button key={d.v} onClick={() => setDuration(d.v)} style={{
                                                    background: duration === d.v ? "rgba(249,115,22,0.1)" : "#1e293b",
                                                    border: `1px solid ${duration === d.v ? "rgba(249,115,22,0.4)" : "rgba(255,255,255,0.08)"}`,
                                                    borderRadius: 8, padding: "12px 8px", cursor: "pointer", textAlign: "center", transition: "all 0.2s"
                                                }}>
                                                    <div style={{
                                                        fontSize: 13, fontWeight: 600, color: duration === d.v ? "#f97316" : "#94a3b8",
                                                        fontFamily: "var(--font-display)"
                                                    }}>{d.l}</div>
                                                    <div style={{ fontSize: 10, color: "#475569", fontFamily: "var(--font-mono)", marginTop: 2 }}>{d.d}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <button onClick={launchScan} disabled={!keywords.trim() || launching}
                                        className="btn-primary" style={{ width: "100%" }}>
                                        {launching ? "⚡ Launching scan..." : "🔍 Launch Scan"}
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* SCAN HISTORY */}
                    {activeTab === "history" && (
                        <div className="animate-fade-in">
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                                <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9", fontFamily: "var(--font-display)" }}>Scan History</h2>
                                <span style={{ fontSize: 12, color: "#475569", fontFamily: "var(--font-mono)" }}>{scans.length} scans total</span>
                            </div>
                            {scans.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "80px 20px" }}>
                                    <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
                                    <div style={{ fontSize: 16, fontWeight: 600, color: "#475569", fontFamily: "var(--font-display)" }}>No scans yet</div>
                                    <button className="btn-primary" style={{ marginTop: 20, padding: "10px 24px", fontSize: 13 }}
                                        onClick={() => setActiveTab("scan")}>Launch your first scan</button>
                                </div>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                    {scans.map(scan => (
                                        <div key={scan.id} style={{
                                            background: "#0f172a", border: "1px solid rgba(255,255,255,0.07)",
                                            borderRadius: 12, padding: "18px 22px", display: "flex", alignItems: "center", gap: 20,
                                            cursor: scan.status === "done" ? "pointer" : "default"
                                        }}
                                            onClick={() => scan.status === "done" && viewResults(scan.id)}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", fontFamily: "var(--font-display)", marginBottom: 4 }}>
                                                    {scan.keywords.join(", ")}
                                                </div>
                                                <div style={{ fontSize: 12, color: "#475569", fontFamily: "var(--font-mono)" }}>
                                                    {scan.duration} · {scan.posts_found} posts · {scan.posts_analyzed} analyzed · {new Date(scan.created_at).toLocaleDateString()}
                                                </div>
                                            </div>
                                            {["starting", "scraping", "analyzing"].includes(scan.status) && (
                                                <div style={{ display: "flex", gap: 3 }}>
                                                    {[0, 1, 2].map(i => (
                                                        <div key={i} style={{
                                                            width: 4, height: 18, background: "#f97316", borderRadius: 2,
                                                            animation: `pulse 1s ease-in-out ${i * 0.2}s infinite alternate`
                                                        }} />
                                                    ))}
                                                </div>
                                            )}
                                            <div style={{ textAlign: "right" }}>
                                                <div style={{ fontSize: 20, fontWeight: 700, color: "#f97316", fontFamily: "var(--font-mono)" }}>
                                                    {scan.posts_analyzed}
                                                </div>
                                                <div style={{ fontSize: 10, color: "#475569" }}>analyzed</div>
                                            </div>
                                            <StatusBadge status={scan.status} />
                                            {scan.status === "done" && (
                                                <button className="btn-secondary" style={{ padding: "8px 16px", fontSize: 12 }}>View →</button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* WILL PAY TAB */}
                    {activeTab === "wtp" && (
                        <div className="animate-fade-in">
                            <div style={{
                                background: "linear-gradient(135deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02))",
                                border: "1px solid rgba(34,197,94,0.2)", borderRadius: 12, padding: "20px 24px", marginBottom: 24
                            }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: "#22c55e", fontFamily: "var(--font-display)", marginBottom: 6 }}>
                                    💰 Willingness to Pay Signals
                                </div>
                                <div style={{ fontSize: 12, color: "#64748b" }}>Posts where users explicitly mentioned budgets, costs, or said &quot;I&apos;d pay for this&quot;. Your warmest leads.</div>
                            </div>
                            {wtpResults.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "60px 20px" }}>
                                    <div style={{ fontSize: 40, marginBottom: 16 }}>💰</div>
                                    <div style={{ fontSize: 14, color: "#475569" }}>No WTP signals found yet. Run a scan first!</div>
                                </div>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                    {wtpResults.map(r => (
                                        <OpportunityCard key={r.id} result={r}
                                            post={scanPosts.find(p => p.id === r.post_id)}
                                            saved={savedIds.has(r.id)} onSave={toggleSave} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* SAVED TAB */}
                    {activeTab === "saved" && (
                        <div className="animate-fade-in">
                            {savedIds.size === 0 || savedResults.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "80px 20px" }}>
                                    <div style={{ fontSize: 40, marginBottom: 16 }}>🔖</div>
                                    <div style={{ fontSize: 16, fontWeight: 600, color: "#475569", fontFamily: "var(--font-display)", marginBottom: 8 }}>No saved opportunities yet</div>
                                    <div style={{ fontSize: 13, color: "#334155" }}>Hit &quot;+ Save&quot; on any opportunity to bookmark it here</div>
                                </div>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                    {savedResults.map(r => (
                                        <OpportunityCard key={r.id} result={r}
                                            post={scanPosts.find(p => p.id === r.post_id)}
                                            saved={true} onSave={toggleSave} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* SETTINGS TAB */}
                    {activeTab === "settings" && (
                        <div className="animate-fade-in" style={{ maxWidth: 720, margin: "0 auto" }}>
                            <div style={{ marginBottom: 32 }}>
                                <h2 style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", fontFamily: "var(--font-display)", marginBottom: 6 }}>
                                    Settings
                                </h2>
                                <p style={{ color: "#64748b", fontSize: 14 }}>Connect your AI models and manage your account.</p>
                            </div>

                            {settingsMsg && (
                                <div style={{
                                    background: settingsMsg.startsWith("✅") ? "rgba(34,197,94,0.08)" : settingsMsg.startsWith("❌") ? "rgba(239,68,68,0.08)" : "rgba(249,115,22,0.08)",
                                    border: `1px solid ${settingsMsg.startsWith("✅") ? "rgba(34,197,94,0.3)" : settingsMsg.startsWith("❌") ? "rgba(239,68,68,0.3)" : "rgba(249,115,22,0.3)"}`,
                                    borderRadius: 8, padding: "10px 16px", marginBottom: 20, fontSize: 13, color: "#f1f5f9"
                                }}>
                                    {settingsMsg}
                                </div>
                            )}

                            {/* AI Models Section */}
                            <div style={{ marginBottom: 32 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                                    <h3 style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", fontFamily: "var(--font-display)" }}>AI Models</h3>
                                    <span style={{
                                        fontSize: 10, fontFamily: "var(--font-mono)", color: connectedModels > 0 ? "#22c55e" : "#ef4444",
                                        background: connectedModels > 0 ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                                        padding: "2px 8px", borderRadius: 20
                                    }}>
                                        {connectedModels}/3 connected
                                    </span>
                                </div>

                                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                    {AI_MODELS.map(model => {
                                        const status = modelStatus[model.id];
                                        const isConnected = status?.connected || false;
                                        return (
                                            <div key={model.id} style={{
                                                background: "#0f172a",
                                                border: `1px solid ${isConnected ? model.border : "rgba(255,255,255,0.07)"}`,
                                                borderRadius: 12, padding: 20,
                                                transition: "border-color 0.3s",
                                            }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
                                                    <div style={{
                                                        width: 40, height: 40, borderRadius: 10,
                                                        background: model.bg, border: `1px solid ${model.border}`,
                                                        display: "flex", alignItems: "center", justifyContent: "center",
                                                        fontSize: 20, flexShrink: 0
                                                    }}>{model.icon}</div>
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                            <span style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", fontFamily: "var(--font-display)" }}>{model.name}</span>
                                                            <span style={{
                                                                fontSize: 10, fontFamily: "var(--font-mono)", color: "#475569",
                                                                background: "#1e293b", padding: "2px 6px", borderRadius: 4
                                                            }}>{model.model}</span>
                                                            {isConnected && <span style={{
                                                                fontSize: 10, fontFamily: "var(--font-mono)", color: "#22c55e",
                                                                background: "rgba(34,197,94,0.1)", padding: "2px 8px", borderRadius: 20
                                                            }}>● Connected</span>}
                                                        </div>
                                                        <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{model.desc}</div>
                                                    </div>
                                                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                                                        <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: model.cost === "Free" ? "#22c55e" : "#f97316" }}>{model.cost}</div>
                                                        <div style={{ fontSize: 10, color: "#475569", fontFamily: "var(--font-mono)" }}>{model.speed}</div>
                                                    </div>
                                                </div>

                                                {isConnected ? (
                                                    <div style={{
                                                        display: "flex", alignItems: "center", gap: 10, background: "#1e293b",
                                                        borderRadius: 8, padding: "10px 14px"
                                                    }}>
                                                        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "#64748b", flex: 1 }}>{status?.masked}</span>
                                                        <button onClick={() => disconnectModel(model.field, model.id)}
                                                            style={{
                                                                fontSize: 11, color: "#ef4444", background: "rgba(239,68,68,0.1)",
                                                                border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, padding: "4px 12px",
                                                                cursor: "pointer", fontFamily: "var(--font-mono)"
                                                            }}>Disconnect</button>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: "flex", gap: 8 }}>
                                                        <input
                                                            type="password"
                                                            placeholder={`Paste your ${model.name} API key`}
                                                            value={keyInputs[model.id] || ""}
                                                            onChange={e => setKeyInputs(prev => ({ ...prev, [model.id]: e.target.value }))}
                                                            style={{
                                                                flex: 1, background: "#1e293b", border: "1px solid rgba(255,255,255,0.08)",
                                                                borderRadius: 8, padding: "10px 14px", color: "#f1f5f9", fontSize: 12,
                                                                fontFamily: "var(--font-mono)", outline: "none"
                                                            }}
                                                        />
                                                        <button onClick={() => saveApiKey(model.field, model.id)}
                                                            disabled={!keyInputs[model.id]?.trim() || savingKey === model.id}
                                                            style={{
                                                                background: model.bg, border: `1px solid ${model.border}`,
                                                                color: model.color, borderRadius: 8, padding: "10px 16px",
                                                                cursor: keyInputs[model.id]?.trim() ? "pointer" : "not-allowed",
                                                                fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)",
                                                                opacity: keyInputs[model.id]?.trim() ? 1 : 0.5, transition: "all 0.2s"
                                                            }}>
                                                            {savingKey === model.id ? "Saving..." : "Connect"}
                                                        </button>
                                                        <a href={model.getUrl} target="_blank" rel="noopener noreferrer"
                                                            style={{
                                                                display: "flex", alignItems: "center", justifyContent: "center",
                                                                background: "#1e293b", border: "1px solid rgba(255,255,255,0.08)",
                                                                borderRadius: 8, padding: "10px 12px", color: "#64748b",
                                                                fontSize: 12, textDecoration: "none", transition: "all 0.2s",
                                                                whiteSpace: "nowrap"
                                                            }}>
                                                            Get Key →
                                                        </a>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Account Section */}
                            <div style={{ marginBottom: 32 }}>
                                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", fontFamily: "var(--font-display)", marginBottom: 16 }}>Account</h3>
                                <div style={{
                                    background: "#0f172a", border: "1px solid rgba(255,255,255,0.07)",
                                    borderRadius: 12, padding: 20
                                }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                                        <div style={{
                                            width: 48, height: 48, background: "linear-gradient(135deg, #f97316, #7c3aed)",
                                            borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                                            fontSize: 18, color: "#fff", fontWeight: 700
                                        }}>
                                            {userEmail.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>{userEmail}</div>
                                            <div style={{ fontSize: 12, color: "#475569", textTransform: "capitalize" }}>{userPlan} Plan</div>
                                        </div>
                                    </div>
                                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 16, display: "flex", gap: 10 }}>
                                        <a href="/auth/logout" style={{
                                            flex: 1, background: "rgba(239,68,68,0.08)",
                                            border: "1px solid rgba(239,68,68,0.2)", color: "#f87171",
                                            borderRadius: 8, padding: "10px 0", textAlign: "center",
                                            fontSize: 13, textDecoration: "none", fontWeight: 600, fontFamily: "var(--font-mono)"
                                        }}>
                                            Log Out
                                        </a>
                                    </div>
                                </div>
                            </div>

                            {/* Plan Info */}
                            <div style={{
                                background: "linear-gradient(135deg, rgba(249,115,22,0.06), rgba(249,115,22,0.02))",
                                border: "1px solid rgba(249,115,22,0.2)", borderRadius: 12, padding: 20
                            }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                                    <span style={{ fontSize: 16 }}>⚡</span>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: "#f97316", fontFamily: "var(--font-display)" }}>CueIdea Intelligence</span>
                                </div>
                                <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
                                    Connect at least one AI model to start analyzing Reddit opportunities. Gemini is free and recommended as your primary model.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
