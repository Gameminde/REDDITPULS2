"use client";

import React from "react";
import { motion } from "framer-motion";
import { CheckCircle2, ArrowRight, Shield, Activity, Search, FileText, Bookmark, BellRing, TrendingUp, DollarSign, Radar, Mail, Globe, Sparkles } from "lucide-react";

import { StaggerContainer, StaggerItem } from "@/app/components/motion";
import { PRICING } from "@/lib/pricing-plans";

const FEATURES = [
    { name: "Live market feed", free: true, starter: true, pro: true, icon: Activity },
    { name: "Market intelligence add-on", free: false, starter: true, pro: true, icon: Sparkles },
    { name: "Post explorer", free: true, starter: true, pro: true, icon: Search },
    { name: "Idea validation", free: false, starter: true, pro: true, icon: FileText },
    { name: "Validation reports", free: false, starter: true, pro: true, icon: FileText },
    { name: "Saved ideas and alerts", free: false, starter: true, pro: true, icon: Bookmark },
    { name: "Trend velocity and why-now", free: false, starter: false, pro: true, icon: TrendingUp },
    { name: "WTP detection", free: false, starter: false, pro: true, icon: DollarSign },
    { name: "Competitor radar", free: false, starter: false, pro: true, icon: Radar },
    { name: "Source intelligence and digest", free: false, starter: false, pro: true, icon: Globe },
    { name: "Email digest", free: false, starter: false, pro: true, icon: Mail },
];

const starterBullets = [
    "Core workflow for finding and validating opportunities",
    "Good fit if you want the market feed, validations, reports, and saved ideas",
    "Best for solo founders who want the essential loop without every advanced surface",
];

const proBullets = [
    "Everything in Starter",
    "All intelligence surfaces unlocked",
    "Best fit if RedditPulse is becoming part of your weekly operating system",
];

function PlanButton({ label, featured = false }: { label: string; featured?: boolean }) {
    return (
        <button
            className="w-full py-4 px-6 rounded-xl flex items-center justify-center gap-2 font-bold text-sm tracking-wide transition-all group relative overflow-hidden"
            style={{
                background: featured
                    ? "linear-gradient(135deg, hsla(16,100%,50%,0.95), hsla(16,85%,55%,0.82))"
                    : "rgba(255,255,255,0.04)",
                color: "#fff",
                border: featured ? "1px solid rgba(249,115,22,0.25)" : "1px solid rgba(255,255,255,0.08)",
                boxShadow: featured ? "0 0 40px hsla(16,100%,50%,0.25)" : "none",
            }}
        >
            <div className="absolute inset-0 bg-white/15 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            <span className="relative z-10 uppercase tracking-widest text-[11px] font-mono">{label}</span>
            <ArrowRight className="w-4 h-4 relative z-10 group-hover:translate-x-1 transition-transform" />
        </button>
    );
}

export default function PricingPage() {
    return (
        <div className="max-w-6xl mx-auto p-6 md:p-8">
            <motion.div
                className="text-center mb-10"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-build/20 bg-build/10 text-build text-[11px] font-mono uppercase tracking-[0.16em] mb-4">
                    <Sparkles className="w-3.5 h-3.5" />
                    {PRICING.trialDays}-day free trial on every paid plan
                </div>
                <h1 className="text-[30px] md:text-[36px] font-extrabold font-display text-white mb-2 tracking-tight">
                    Pick the plan that matches how deeply you want to run the engine
                </h1>
                <p className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                    Starter is the core workflow. Pro unlocks every intelligence surface. Both begin with a {PRICING.trialDays}-day full-access trial.
                </p>
            </motion.div>

            <div className="grid gap-6 lg:grid-cols-[0.9fr_1fr_1fr] items-stretch">
                <motion.div
                    className="bento-cell p-6 rounded-2xl"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">Free</div>
                    <div className="flex items-baseline gap-2 mb-4">
                        <span className="text-[42px] font-extrabold text-white font-display leading-none">$0</span>
                        <span className="text-sm text-muted-foreground font-mono">forever</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                        Enough to explore the market and understand what RedditPulse is seeing before you commit.
                    </p>

                    <div className="space-y-3 mb-6">
                        {["Live market feed", "Post explorer", "Basic product access"].map((item) => (
                            <div key={item} className="flex items-center gap-3 text-sm text-foreground/90">
                                <CheckCircle2 className="w-4 h-4 text-build" />
                                <span>{item}</span>
                            </div>
                        ))}
                    </div>

                    <div className="text-xs text-muted-foreground leading-relaxed">
                        Best for getting familiar with the market feed before you start serious validation work.
                    </div>
                </motion.div>

                <motion.div
                    className="bento-cell p-8 rounded-2xl border-white/10 relative overflow-hidden"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                >
                    <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                    <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
                        {PRICING.starter.name}
                    </div>
                    <div className="flex items-baseline gap-2 mb-4">
                        <span className="text-[48px] font-extrabold text-white font-display leading-none">${PRICING.starter.priceMonthly}</span>
                        <span className="text-sm text-muted-foreground font-mono">/ month</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                        The core RedditPulse workflow for solo founders who want real market signal, idea validation, and saved follow-up.
                    </p>

                    <div className="space-y-3 mb-6">
                        {starterBullets.map((item) => (
                            <div key={item} className="flex items-start gap-3 text-sm text-foreground/90">
                                <CheckCircle2 className="w-4 h-4 text-build mt-0.5 shrink-0" />
                                <span>{item}</span>
                            </div>
                        ))}
                    </div>

                    <PlanButton label={`Start ${PRICING.trialDays}-day Starter trial`} />

                    <div className="flex items-center gap-2 justify-center mt-4">
                        <Shield className="w-3.5 h-3.5 text-muted-foreground/60" />
                        <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                            Then ${PRICING.starter.priceMonthly}/mo
                        </span>
                    </div>
                </motion.div>

                <motion.div
                    className="bento-cell p-8 rounded-2xl border-primary/20 relative overflow-hidden"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                    <div className="flex items-center justify-between mb-3">
                        <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-primary">
                            {PRICING.pro.name}
                        </div>
                        <div className="px-2.5 py-1 rounded bg-build/10 border border-build/20 text-build text-[10px] font-bold font-mono uppercase tracking-widest">
                            Best value
                        </div>
                    </div>
                    <div className="flex items-baseline gap-2 mb-4">
                        <span className="text-[52px] font-extrabold text-primary font-display leading-none">${PRICING.pro.priceMonthly}</span>
                        <span className="text-sm text-muted-foreground font-mono">/ month</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                        Everything unlocked. This is the full operating layer: market intelligence, validation depth, monitoring, trends, WTP, competitors, and sources.
                    </p>

                    <div className="space-y-3 mb-6">
                        {proBullets.map((item) => (
                            <div key={item} className="flex items-start gap-3 text-sm text-foreground/90">
                                <CheckCircle2 className="w-4 h-4 text-build mt-0.5 shrink-0" />
                                <span>{item}</span>
                            </div>
                        ))}
                    </div>

                    <PlanButton label={`Start ${PRICING.trialDays}-day Pro trial`} featured />

                    <div className="flex items-center gap-2 justify-center mt-4">
                        <Shield className="w-3.5 h-3.5 text-muted-foreground/60" />
                        <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                            Then ${PRICING.pro.priceMonthly}/mo · full access
                        </span>
                    </div>
                </motion.div>
            </div>

            <motion.div
                className="mt-16"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
            >
                <h2 className="text-sm font-bold font-mono text-white text-center mb-6 uppercase tracking-widest">
                    Feature access
                </h2>

                <div className="bento-cell overflow-hidden max-w-5xl mx-auto rounded-[14px]">
                    <div className="grid grid-cols-[1fr_80px_90px_80px] p-4 border-b border-white/5 bg-black/20">
                        <span className="text-[10px] font-bold text-muted-foreground font-mono uppercase tracking-widest">Feature</span>
                        <span className="text-[10px] font-bold text-muted-foreground font-mono uppercase tracking-widest text-center">Free</span>
                        <span className="text-[10px] font-bold text-white font-mono uppercase tracking-widest text-center">Starter</span>
                        <span className="text-[10px] font-bold text-primary font-mono uppercase tracking-widest text-center">Pro</span>
                    </div>

                    <StaggerContainer delay={0.3} className="flex flex-col">
                        {FEATURES.map((feature, index) => (
                            <StaggerItem key={feature.name}>
                                <div className={`grid grid-cols-[1fr_80px_90px_80px] p-4 items-center ${index !== FEATURES.length - 1 ? "border-b border-white/5" : ""} hover:bg-white/[0.02] transition-colors`}>
                                    <div className="flex items-center gap-3">
                                        <div className="w-6 h-6 rounded flex items-center justify-center bg-white/5 border border-white/10">
                                            <feature.icon className="w-3.5 h-3.5 text-muted-foreground" />
                                        </div>
                                        <span className="text-xs text-foreground/90 font-medium">{feature.name}</span>
                                    </div>
                                    <div className="flex justify-center">
                                        {feature.free ? <CheckCircle2 className="w-4 h-4 text-build" /> : <span className="text-sm text-muted-foreground/40 font-mono">—</span>}
                                    </div>
                                    <div className="flex justify-center">
                                        {feature.starter ? <CheckCircle2 className="w-4 h-4 text-build" /> : <span className="text-sm text-muted-foreground/40 font-mono">—</span>}
                                    </div>
                                    <div className="flex justify-center">
                                        {feature.pro ? <CheckCircle2 className="w-4 h-4 text-build drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]" /> : <span className="text-sm text-muted-foreground/40 font-mono">—</span>}
                                    </div>
                                </div>
                            </StaggerItem>
                        ))}
                    </StaggerContainer>
                </div>
            </motion.div>
        </div>
    );
}

