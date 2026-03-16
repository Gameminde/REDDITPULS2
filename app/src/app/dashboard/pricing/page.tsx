"use client";
import React from "react";
import { motion } from "framer-motion";
import { GlassCard, StaggerContainer, StaggerItem } from "@/app/components/motion";
import { CheckCircle2, Sparkles, ArrowRight, Shield, Zap, Globe, Mail, FileText, TrendingUp, DollarSign, Radar, Bookmark, Activity, Search } from "lucide-react";

const FEATURES = [
    { name: "Unlimited scans", free: false, pro: true, icon: Activity },
    { name: "Post explorer", free: true, pro: true, icon: Search },
    { name: "Validation reports", free: false, pro: true, icon: FileText },
    { name: "Trend velocity", free: false, pro: true, icon: TrendingUp },
    { name: "WTP detection", free: false, pro: true, icon: DollarSign },
    { name: "Competitor tracking", free: false, pro: true, icon: Radar },
    { name: "Multi-source (HN, IH)", free: false, pro: true, icon: Globe },
    { name: "Daily digest email", free: false, pro: true, icon: Mail },
    { name: "Saved opportunities", free: false, pro: true, icon: Bookmark },
    { name: "CSV export", free: false, pro: true, icon: Zap },
];

export default function PricingPage() {
    return (
        <div className="max-w-4xl mx-auto p-6 md:p-8">
            <motion.div className="text-center mb-10"
                initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
                <h1 className="text-[28px] md:text-[32px] font-extrabold font-display text-white mb-2 tracking-tight">
                    One price. Lifetime access.
                </h1>
                <p className="text-sm md:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
                    No subscriptions, no tiers, no upsells. Pay once and unlock every feature forever.
                </p>
            </motion.div>

            <motion.div
                className="max-w-[480px] mx-auto z-10 relative"
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 20 }}
            >
                {/* Glow behind the card */}
                <div className="absolute inset-0 bg-primary/20 blur-[50px] -z-10 rounded-full mix-blend-screen opacity-50" />
                
                <div className="bento-cell p-8 rounded-2xl border-primary/20 relative overflow-hidden">
                    <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                    <div className="flex justify-between items-start mb-6">
                        <div className="flex items-baseline gap-2">
                            <span className="text-[48px] font-extrabold text-primary font-display leading-none">$49</span>
                            <span className="text-sm text-muted-foreground font-mono">one-time</span>
                        </div>
                        <div className="px-2.5 py-1 rounded bg-build/10 border border-build/20 text-build text-[10px] font-bold font-mono uppercase tracking-widest">
                            Lifetime
                        </div>
                    </div>
                    
                    <p className="text-xs text-muted-foreground mb-6 font-mono">
                        Includes future updates · No recurring fees
                    </p>

                    <button className="w-full py-4 px-6 rounded-xl flex items-center justify-center gap-2 font-bold text-sm tracking-wide transition-all group relative overflow-hidden"
                            style={{
                                background: "linear-gradient(135deg, hsla(16,100%,50%,0.9), hsla(16,80%,55%,0.8))",
                                color: "#fff",
                                boxShadow: "0 0 40px hsla(16,100%,50%,0.3), inset 0 0 20px hsla(16,100%,50%,0.1)",
                            }}>
                        <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                        <Sparkles className="w-4 h-4 relative z-10" />
                        <span className="relative z-10 uppercase tracking-widest text-[11px] font-mono">Get Pro Access</span>
                        <ArrowRight className="w-4 h-4 relative z-10 group-hover:translate-x-1 transition-transform" />
                    </button>

                    <div className="flex items-center gap-2 justify-center mt-4">
                        <Shield className="w-3.5 h-3.5 text-muted-foreground/60" />
                        <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Secure payment via Stripe</span>
                    </div>
                </div>
            </motion.div>

            {/* Feature Comparison */}
            <motion.div className="mt-16"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <h2 className="text-sm font-bold font-mono text-white text-center mb-6 uppercase tracking-widest">
                    Everything included
                </h2>
                
                <div className="bento-cell overflow-hidden max-w-3xl mx-auto rounded-[14px]">
                    <div className="grid grid-cols-[1fr_80px_80px] p-4 border-b border-white/5 bg-black/20">
                        <span className="text-[10px] font-bold text-muted-foreground font-mono uppercase tracking-widest">Feature</span>
                        <span className="text-[10px] font-bold text-muted-foreground font-mono uppercase tracking-widest text-center">Free</span>
                        <span className="text-[10px] font-bold text-primary font-mono uppercase tracking-widest text-center">Pro</span>
                    </div>
                    
                    <StaggerContainer delay={0.4} className="flex flex-col">
                        {FEATURES.map((f, i) => (
                            <StaggerItem key={f.name}>
                                <div className={`grid grid-cols-[1fr_80px_80px] p-4 items-center ${i !== FEATURES.length - 1 ? "border-b border-white/5" : ""} hover:bg-white/[0.02] transition-colors`}>
                                    <div className="flex items-center gap-3">
                                        <div className="w-6 h-6 rounded flex items-center justify-center bg-white/5 border border-white/10">
                                            <f.icon className="w-3.5 h-3.5 text-muted-foreground" />
                                        </div>
                                        <span className="text-xs text-foreground/90 font-medium">{f.name}</span>
                                    </div>
                                    <div className="flex justify-center">
                                        {f.free ? <CheckCircle2 className="w-4 h-4 text-build" /> :
                                            <span className="text-sm text-muted-foreground/40 font-mono">—</span>}
                                    </div>
                                    <div className="flex justify-center">
                                        <CheckCircle2 className="w-4 h-4 text-build drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]" />
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
