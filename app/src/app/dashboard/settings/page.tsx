"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, CheckCircle, XCircle, AlertTriangle, User, Mail, Key, Loader2, Wand2 } from "lucide-react";
import {
    getAiStatusLabel,
    getAiStatusTone,
    type AiConfigHealth,
    type AiVerificationStatus,
} from "@/lib/ai-config-health";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import { FEATURE_FLAGS } from "@/lib/feature-flags";

type ProviderConfig = {
    id?: string;
    provider: string;
    api_key: string;
    selected_model: string;
    is_active: boolean;
    priority: number;
};

type ModelInfo = {
    id: string;
    label: string;
    contextWindow: number;
    tier: "free" | "paid" | "free-tier";
};

type CatalogModelInfo = {
    id: string;
    label: string;
};

type ProviderCatalogEntry = {
    name: string;
    endpoint: string;
    models: CatalogModelInfo[];
};

type ProfileData = {
    email: string;
    full_name: string;
    plan: string;
    created_at: string;
};

type ConfigMessageTone = "error" | "success" | "warning";

const providerCatalog = [
    { id: "gemini", name: "Google Gemini", color: "text-teal" },
    { id: "openai", name: "OpenAI", color: "text-build" },
    { id: "anthropic", name: "Anthropic", color: "text-risky" },
    { id: "groq", name: "Groq", color: "text-primary" },
    { id: "deepseek", name: "DeepSeek", color: "text-teal" },
    { id: "together", name: "Together AI", color: "text-pink-400" },
    { id: "openrouter", name: "OpenRouter", color: "text-violet-400" },
    { id: "grok", name: "xAI (Grok)", color: "text-build" },
    { id: "nvidia", name: "NVIDIA NIM", color: "text-build" },
    { id: "fireworks", name: "Fireworks AI", color: "text-primary" },
    { id: "mistral", name: "Mistral AI", color: "text-risky" },
    { id: "cerebras", name: "Cerebras", color: "text-teal" },
    { id: "ollama", name: "Ollama (local)", color: "text-muted-foreground" },
];

const providerNameIndex = Object.fromEntries(providerCatalog.map((provider) => [provider.id, provider.name]));

const MAX_ACTIVE_AGENTS = 6;

const statusIcons: Record<string, React.ReactNode> = {
    verified: <CheckCircle className="w-3.5 h-3.5 text-build" />,
    error: <XCircle className="w-3.5 h-3.5 text-dont" />,
    pending: <AlertTriangle className="w-3.5 h-3.5 text-risky" />,
};

function getConfigMessageTone(status?: AiVerificationStatus): ConfigMessageTone {
    if (!status || status === "valid") return "success";
    if (status === "invalid" || status === "error") return "error";
    return "warning";
}

function getHealthIcon(status?: AiVerificationStatus, loading = false) {
    if (loading) return <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />;
    if (!status) return statusIcons.pending;
    const tone = getAiStatusTone(status);
    if (tone === "success") return statusIcons.verified;
    if (tone === "error") return statusIcons.error;
    return statusIcons.pending;
}

export default function SettingsPage() {
    const [configs, setConfigs] = useState<ProviderConfig[]>([]);
    const [modelCatalog, setModelCatalog] = useState<Record<string, ProviderCatalogEntry>>({});
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [validationCount, setValidationCount] = useState(0);

    // Add model form
    const [showAddForm, setShowAddForm] = useState(false);
    const [newKey, setNewKey] = useState("");
    const [detectedProvider, setDetectedProvider] = useState<string | null>(null);
    const [detectHint, setDetectHint] = useState("");
    const [selectedProvider, setSelectedProvider] = useState("");
    const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
    const [selectedModel, setSelectedModel] = useState("");
    const [detecting, setDetecting] = useState(false);
    const [loadingModels, setLoadingModels] = useState(false);
    const [loadingHealth, setLoadingHealth] = useState(false);
    const [saving, setSaving] = useState(false);
    const [configMessage, setConfigMessage] = useState<{ type: ConfigMessageTone; text: string } | null>(null);
    const [configHealth, setConfigHealth] = useState<Record<string, AiConfigHealth>>({});
    const [healthSummary, setHealthSummary] = useState<{ blocked: boolean; message: string | null } | null>(null);
    const sortedConfigs = [...configs].sort((left, right) => {
        const leftPriority = Number(left.priority || 9999);
        const rightPriority = Number(right.priority || 9999);
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return String(left.id || "").localeCompare(String(right.id || ""));
    });

    const fetchConfigs = useCallback(async () => {
        try {
            const r = await fetch("/api/settings/ai");
            const d = await r.json();
            if (!r.ok) {
                setConfigMessage({ type: "error", text: d.error || "Could not load AI settings." });
                setConfigs([]);
                return;
            }
            setModelCatalog((d.catalog && typeof d.catalog === "object") ? d.catalog as Record<string, ProviderCatalogEntry> : {});
            const nextConfigs: ProviderConfig[] = Array.isArray(d.configs) ? d.configs : [];
            nextConfigs.sort((left, right) => {
                const leftPriority = Number(left.priority || 9999);
                const rightPriority = Number(right.priority || 9999);
                if (leftPriority !== rightPriority) return leftPriority - rightPriority;
                return String(left.id || "").localeCompare(String(right.id || ""));
            });
            setConfigs(nextConfigs);
            setConfigMessage((prev) => (prev?.type === "error" ? null : prev));
        } catch {
            setConfigMessage({ type: "error", text: "Could not load AI settings." });
        }
    }, []);

    const getProviderDisplayName = useCallback((providerId: string) => {
        return modelCatalog[providerId]?.name || providerNameIndex[providerId] || providerId;
    }, [modelCatalog]);

    const getModelDisplayName = useCallback((providerId: string, modelId: string) => {
        const match = modelCatalog[providerId]?.models?.find((model) => model.id === modelId);
        return match?.label || modelId.split("/").pop() || modelId;
    }, [modelCatalog]);

    const fetchConfigHealth = useCallback(async () => {
        setLoadingHealth(true);
        try {
            const response = await fetch("/api/settings/ai/health");
            const payload = await response.json();
            if (!response.ok) {
                setConfigHealth({});
                setHealthSummary(null);
                return;
            }

            const nextHealth = Object.fromEntries(
                ((payload.health || []) as AiConfigHealth[]).map((entry) => [entry.config_id, entry]),
            );
            setConfigHealth(nextHealth);
            setHealthSummary({
                blocked: Boolean(payload.blocked),
                message: typeof payload.message === "string" ? payload.message : null,
            });
        } catch {
            setConfigHealth({});
            setHealthSummary(null);
        } finally {
            setLoadingHealth(false);
        }
    }, []);

    // Load real profile from Supabase
    const fetchProfile = useCallback(async () => {
        try {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data: profileRow } = await supabase
                    .from("profiles")
                    .select("email, full_name, plan, created_at")
                    .eq("id", user.id)
                    .single();
                if (profileRow) {
                    setProfile(profileRow as ProfileData);
                } else {
                    setProfile({
                        email: user.email || "—",
                        full_name: user.user_metadata?.full_name || "User",
                        plan: "free",
                        created_at: user.created_at || new Date().toISOString(),
                    });
                }
            }
        } catch { }
    }, []);

    // Load real validation count
    const fetchValidationCount = useCallback(async () => {
        try {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { count } = await supabase
                .from("idea_validations")
                .select("id", { count: "exact", head: true })
                .eq("user_id", user.id);
            setValidationCount(count || 0);
        } catch { }
    }, []);

    useEffect(() => {
        fetchConfigs();
        fetchConfigHealth();
        fetchProfile();
        fetchValidationCount();
    }, [fetchConfigHealth, fetchConfigs, fetchProfile, fetchValidationCount]);

    // Auto-detect provider when user pastes a key
    const handleKeyChange = async (key: string) => {
        setNewKey(key);
        setDetectedProvider(null);
        setDetectHint("");
        setConfigMessage(null);
        setAvailableModels([]);
        setSelectedModel("");

        if (key.trim().length < 8) return;

        setDetecting(true);
        try {
            const r = await fetch("/api/settings/detect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ api_key: key.trim() }),
            });
            const d = await r.json();
            if (d.provider && d.provider !== "unknown") {
                setDetectedProvider(d.provider);
                setSelectedProvider(d.provider);
                setDetectHint(d.hint || "");
                // Auto-fetch models for detected provider
                fetchModels(d.provider, key.trim());
            }
        } catch { }
        setDetecting(false);
    };

    // Fetch available models for a provider
    const fetchModels = async (provider: string, apiKey: string) => {
        setLoadingModels(true);
        try {
            const r = await fetch(`/api/settings/models?provider=${provider}&api_key=${encodeURIComponent(apiKey)}`);
            const d = await r.json();
            if (d.models) {
                setAvailableModels(d.models);
                // Auto-select first model
                if (d.models.length > 0) setSelectedModel(d.models[0].id);
            }
        } catch { }
        setLoadingModels(false);
    };

    // Save new config
    const handleSave = async () => {
        if (!selectedProvider || !selectedModel || !newKey.trim()) return;
        setSaving(true);
        setConfigMessage(null);
        try {
            const nextPriority = sortedConfigs.reduce((highest, config) => {
                const priority = Number(config.priority || 0);
                return Math.max(highest, Number.isFinite(priority) ? priority : 0);
            }, 0) + 1;
            const response = await fetch("/api/settings/ai", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider: selectedProvider,
                    api_key: newKey.trim(),
                    selected_model: selectedModel,
                    is_active: true,
                    priority: nextPriority,
                }),
            });
            const payload = await response.json();
            if (!response.ok) {
                setConfigMessage({ type: "error", text: payload.error || "Could not save this AI configuration." });
                return;
            }
            await Promise.all([fetchConfigs(), fetchConfigHealth()]);
            setShowAddForm(false);
            setNewKey("");
            setDetectedProvider(null);
            setSelectedProvider("");
            setAvailableModels([]);
            setSelectedModel("");
            setConfigMessage({
                type: getConfigMessageTone(payload.verification?.status),
                text: payload.verification?.message
                    ? `AI configuration saved. ${payload.verification.message}`
                    : "AI configuration saved.",
            });
        } catch {
            setConfigMessage({ type: "error", text: "Could not save this AI configuration." });
        }
        setSaving(false);
    };

    const handleDelete = async (configId?: string) => {
        if (!configId) return;
        try {
            await fetch(`/api/settings/ai?id=${configId}`, { method: "DELETE" });
            await Promise.all([fetchConfigs(), fetchConfigHealth()]);
        } catch { }
    };

    const memberSince = profile?.created_at
        ? new Date(profile.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })
        : "—";

    return (
        <div className="mx-auto max-w-6xl px-0 pt-2 pb-6 sm:pt-4">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-5 sm:mb-6">
                <h1 className="text-[28px] font-bold font-display tracking-tight-custom text-white sm:text-[32px]">Settings</h1>
                <p className="text-muted-foreground mt-1 text-sm font-mono">AI agents · Account · Configuration</p>
            </motion.div>

            <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
                {/* LEFT — AI Config */}
                <div className="space-y-3 sm:space-y-4">
                    {/* Active models */}
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bento-cell rounded-[14px] p-4 sm:p-5">
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Active Agents ({sortedConfigs.length}/{MAX_ACTIVE_AGENTS})
                            </p>
                            <button
                                onClick={() => setShowAddForm(!showAddForm)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold text-primary transition-all"
                                style={{ background: "hsl(var(--orange-dim))", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                            >
                                <Plus className="w-3 h-3" /> Add Agent
                            </button>
                        </div>

                        {healthSummary?.message && (
                            <div className="mb-4 rounded-lg border border-risky/20 bg-risky/5 px-3 py-2 text-[11px] font-mono text-risky">
                                {healthSummary.message}
                            </div>
                        )}

                        <p className="mb-4 text-[11px] leading-5 text-muted-foreground">
                            Each saved key becomes its own agent slot. You can stack the same provider more than once, even on the same model, if each agent uses a different API key.
                        </p>

                        {sortedConfigs.length === 0 ? (
                            <div className="text-center py-6">
                                <p className="text-[13px] text-muted-foreground/60">No AI agents configured</p>
                                <p className="text-[11px] text-muted-foreground/40 mt-1">Click "Add Agent" to paste your first API key</p>
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {sortedConfigs.map((config, i) => {
                                    const health = config.id ? configHealth[config.id] : null;
                                    const healthTone = health ? getAiStatusTone(health.status) : "muted";
                                    const badgeClasses = healthTone === "success"
                                        ? "border border-build/20 bg-build/5 text-build"
                                        : healthTone === "error"
                                            ? "border border-dont/20 bg-dont/5 text-dont"
                                            : healthTone === "warning"
                                                ? "border border-risky/20 bg-risky/5 text-risky"
                                                : "border border-white/10 bg-white/[0.03] text-muted-foreground";

                                    return (
                                    <motion.div
                                        key={config.id || i}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: i * 0.05 }}
                                        className="flex items-center justify-between p-3.5 rounded-lg group hover:bg-white/5 transition-colors"
                                        style={{ background: "hsl(0 0% 100% / 0.02)", border: "1px solid hsl(0 0% 100% / 0.05)" }}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="min-w-[70px] rounded-md px-2 py-1 text-center text-[10px] font-bold font-mono"
                                                style={{ background: "hsl(var(--orange-dim))", color: "hsl(16 100% 50%)", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                                            >
                                                Agent {i + 1}
                                            </span>
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <p className="text-xs font-bold text-white">
                                                        {getProviderDisplayName(config.provider)}{" "}
                                                        <span className="text-muted-foreground font-mono text-[10px]">
                                                            / {getModelDisplayName(config.provider, config.selected_model)}
                                                        </span>
                                                    </p>
                                                    {config.is_active && (
                                                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${badgeClasses}`}>
                                                            {health ? getAiStatusLabel(health.status) : loadingHealth ? "Checking" : "Saved"}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-[10px] text-muted-foreground font-mono">
                                                    •••••••{config.api_key.slice(-4)}
                                                </p>
                                                {config.is_active && (
                                                    <p className={`mt-1 text-[10px] font-mono ${
                                                        healthTone === "success"
                                                            ? "text-build"
                                                            : healthTone === "error"
                                                                ? "text-dont"
                                                                : healthTone === "warning"
                                                                    ? "text-risky"
                                                                    : "text-muted-foreground"
                                                    }`}>
                                                        {health?.message || (loadingHealth ? "Checking live provider status..." : "Provider health has not been checked yet.")}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2.5">
                                            {config.is_active ? getHealthIcon(health?.status, loadingHealth && !health) : statusIcons.pending}
                                            <button
                                                onClick={() => handleDelete(config.id)}
                                                className="text-muted-foreground hover:text-dont transition-colors opacity-0 group-hover:opacity-100"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </motion.div>
                                    );
                                })}
                            </div>
                        )}
                    </motion.div>

                    {/* Add Agent Form */}
                    <AnimatePresence>
                        {showAddForm && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="bento-cell rounded-[14px] p-4 sm:p-5 overflow-hidden"
                            >
                                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-4">
                                    Add New Agent
                                </p>

                                {configMessage && (
                                    <div
                                        className={`mb-4 rounded-lg px-3 py-2 text-[11px] font-mono ${
                                            configMessage.type === "error"
                                                ? "border border-dont/20 bg-dont/5 text-dont"
                                                : configMessage.type === "warning"
                                                    ? "border border-risky/20 bg-risky/5 text-risky"
                                                    : "border border-build/20 bg-build/5 text-build"
                                        }`}
                                    >
                                        {configMessage.text}
                                    </div>
                                )}

                                {/* API Key input with auto-detect */}
                                <div className="mb-4">
                                    <label className="text-[10px] text-muted-foreground mb-1.5 block">API Key</label>
                                    <div className="relative">
                                        <input
                                            type="password"
                                            value={newKey}
                                            onChange={(e) => handleKeyChange(e.target.value)}
                                            placeholder="Paste your API key — provider auto-detected"
                                            className="w-full px-3 py-2.5 rounded-lg text-xs font-mono bg-white/[0.03] border border-white/[0.07] text-foreground outline-none focus:border-primary/30 transition-colors"
                                        />
                                        {detecting && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary animate-spin" />}
                                        {detectedProvider && !detecting && <Wand2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-build" />}
                                    </div>
                                    {detectHint && (
                                        <p className="text-[10px] text-build mt-1.5 font-mono">{detectHint}</p>
                                    )}
                                </div>

                                {/* Provider selector (auto-filled or manual) */}
                                <div className="mb-4">
                                    <label className="text-[10px] text-muted-foreground mb-1.5 block">Provider</label>
                                    <select
                                        value={selectedProvider}
                                        onChange={(e) => {
                                            setSelectedProvider(e.target.value);
                                            if (newKey.trim()) fetchModels(e.target.value, newKey.trim());
                                        }}
                                        className="w-full px-3 py-2.5 rounded-lg text-xs font-mono bg-white/[0.03] border border-white/[0.07] text-foreground outline-none"
                                    >
                                        <option value="">Select provider...</option>
                                        {providerCatalog.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Model selector (populated from /api/settings/models) */}
                                <div className="mb-4">
                                    <label className="text-[10px] text-muted-foreground mb-1.5 block">Model</label>
                                    {loadingModels ? (
                                        <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching available models...
                                        </div>
                                    ) : availableModels.length > 0 ? (
                                        <select
                                            value={selectedModel}
                                            onChange={(e) => setSelectedModel(e.target.value)}
                                            className="w-full px-3 py-2.5 rounded-lg text-xs font-mono bg-white/[0.03] border border-white/[0.07] text-foreground outline-none"
                                        >
                                            {availableModels.map(m => (
                                                <option key={m.id} value={m.id}>
                                                    {m.label} ({Math.round(m.contextWindow / 1024)}k ctx) {m.tier === "free" || m.tier === "free-tier" ? "✦ free" : ""}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            value={selectedModel}
                                            onChange={(e) => setSelectedModel(e.target.value)}
                                            placeholder="Enter model ID manually"
                                            className="w-full px-3 py-2.5 rounded-lg text-xs font-mono bg-white/[0.03] border border-white/[0.07] text-foreground outline-none"
                                        />
                                    )}
                                </div>

                                {/* Save button */}
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleSave}
                                        disabled={saving || !selectedProvider || !selectedModel || !newKey.trim()}
                                        className="flex-1 py-2.5 rounded-lg text-[11px] font-semibold text-white disabled:opacity-40 transition-all"
                                        style={{ background: "hsl(16 100% 50% / 0.2)", border: "1px solid hsl(16 100% 50% / 0.3)" }}
                                    >
                                        {saving ? "Saving..." : "Save Configuration"}
                                    </button>
                                    <button
                                        onClick={() => setShowAddForm(false)}
                                        className="px-4 py-2.5 rounded-lg text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                        style={{ border: "1px solid hsl(0 0% 100% / 0.07)" }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Available providers catalog */}
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bento-cell rounded-[14px] p-4 sm:p-5">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-4">
                            Supported Providers ({providerCatalog.length})
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {providerCatalog.map((p, i) => {
                                const isConfigured = configs.some(c => c.provider === p.id);
                                return (
                                    <motion.div
                                        key={p.id}
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: 0.2 + i * 0.03 }}
                                        whileHover={{ scale: 1.02, y: -1 }}
                                        className="p-3.5 rounded-lg cursor-pointer transition-all hover:bg-white/5"
                                        style={{ background: "hsl(0 0% 100% / 0.02)", border: "1px solid hsl(0 0% 100% / 0.05)" }}
                                        onClick={() => {
                                            setShowAddForm(true);
                                            setSelectedProvider(p.id);
                                        }}
                                    >
                                        <div className="flex items-center justify-between">
                                            <p className={`text-xs font-bold ${p.color}`}>{p.name}</p>
                                            {isConfigured && <CheckCircle className="w-3 h-3 text-build" />}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </motion.div>
                </div>

                {/* RIGHT — Real Profile */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bento-cell rounded-[14px] p-4 sm:p-5 h-fit">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-5">Profile</p>

                    <div className="flex items-center gap-4 mb-6">
                        <div className="w-14 h-14 rounded-full flex items-center justify-center"
                            style={{ background: "hsl(var(--orange-dim))", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                        >
                            <User className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-white">{profile?.full_name || "Loading…"}</p>
                            <p className="text-[11px] text-muted-foreground font-mono capitalize">
                                {profile?.plan || "—"} Plan · Member since {memberSince}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2 block">Email</label>
                            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg font-mono text-xs"
                                style={{ background: "hsl(0 0% 100% / 0.02)", border: "1px solid hsl(0 0% 100% / 0.05)" }}
                            >
                                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                                <span className="text-foreground text-white">{profile?.email || "Loading…"}</span>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 pt-5" style={{ borderTop: "1px solid hsl(0 0% 100% / 0.05)" }}>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3">Usage</p>
                        <div className="space-y-3">
                            <div>
                                <div className="flex justify-between text-[11px] mb-1.5">
                                    <span className="text-muted-foreground">Validations run</span>
                                    <span className="font-mono text-white">{validationCount}</span>
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between text-[11px] mb-1.5">
                                    <span className="text-muted-foreground">AI agents configured</span>
                                    <span className="font-mono text-white">{configs.length}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 pt-5" style={{ borderTop: "1px solid hsl(0 0% 100% / 0.05)" }}>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3">Internal</p>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-3" style={{ background: "hsl(0 0% 100% / 0.02)", border: "1px solid hsl(0 0% 100% / 0.05)" }}>
                                <div>
                                    <p className="text-xs text-white">Engine status</p>
                                    <p className="text-[11px] text-muted-foreground">Check scraper freshness before enabling cron-dependent pages.</p>
                                </div>
                                <Link
                                    href="/dashboard/settings/engine-status"
                                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold text-primary transition-all"
                                    style={{ background: "hsl(var(--orange-dim))", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                                >
                                    Open
                                </Link>
                            </div>
                            {FEATURE_FLAGS.OPPORTUNITY_LAB_ENABLED && (
                                <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-3" style={{ background: "hsl(0 0% 100% / 0.02)", border: "1px solid hsl(0 0% 100% / 0.05)" }}>
                                    <div>
                                        <p className="text-xs text-white">Opportunity operating model lab</p>
                                        <p className="text-[11px] text-muted-foreground">Experimental lane that separates themes, candidate opportunities, context, and noise without changing the main product.</p>
                                    </div>
                                    <Link
                                        href="/dashboard/settings/opportunity-lab"
                                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold text-primary transition-all"
                                        style={{ background: "hsl(var(--orange-dim))", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                                    >
                                        Test lab
                                    </Link>
                                </div>
                            )}
                            {FEATURE_FLAGS.REDDIT_CONNECTION_LAB_ENABLED && (
                                <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-3" style={{ background: "hsl(0 0% 100% / 0.02)", border: "1px solid hsl(0 0% 100% / 0.05)" }}>
                                    <div>
                                        <p className="text-xs text-white">Reddit connection lab</p>
                                        <p className="text-[11px] text-muted-foreground">Optional Reddit connect and source packs. Your normal validation flow uses this context automatically once connected.</p>
                                    </div>
                                    <Link
                                        href="/dashboard/settings/reddit-lab"
                                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold text-primary transition-all"
                                        style={{ background: "hsl(var(--orange-dim))", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                                    >
                                        Open lab
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
