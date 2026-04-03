"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Zap, ArrowRight, Activity, Search, TrendingUp, Shield } from "lucide-react";

import { BrandLogo } from "@/app/components/brand-logo";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

const features = [
  { icon: Search, title: "Live market feed", desc: "Raw signal stays inspectable so you can judge the evidence yourself." },
  { icon: Activity, title: "Idea validation", desc: "Pressure-test one wedge with deeper evidence gathering and structured reports." },
  { icon: TrendingUp, title: "Trend and why-now", desc: "Track momentum, timing, and what is accelerating before it becomes obvious." },
  { icon: Shield, title: "Competitor pressure", desc: "Watch weakness clusters, complaints, and room for a sharper angle." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="noise-overlay" />

      <div
        className="fixed pointer-events-none rounded-full"
        style={{ top: -200, left: -150, width: 700, height: 700, filter: "blur(140px)", background: "hsla(16,100%,50%,0.07)", animation: "drift 18s ease-in-out infinite alternate", zIndex: 0 }}
      />
      <div
        className="fixed pointer-events-none rounded-full"
        style={{ bottom: -250, right: -100, width: 600, height: 600, filter: "blur(120px)", background: "hsla(16,70%,50%,0.05)", animation: "drift 24s ease-in-out infinite alternate-reverse", zIndex: 0 }}
      />

      <motion.nav
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed top-0 left-0 right-0 z-50"
        style={{ borderBottom: "1px solid hsl(0 0% 100% / 0.07)", background: "hsla(0,0%,4%,0.7)", backdropFilter: "blur(20px)" }}
      >
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <BrandLogo compact uppercase />
          <div className="flex items-center gap-5">
            <Link href="/how-it-works" className="text-xs font-semibold text-muted-foreground hover:text-white transition-colors">
              How it works
            </Link>
            <Link href="/pricing" className="text-xs font-semibold text-muted-foreground hover:text-white transition-colors">
              Pricing
            </Link>
            <Link
              href="/dashboard/validate"
              className="inline-flex items-center gap-2 px-4 h-8 rounded-lg text-xs font-semibold text-white transition-all hover:-translate-y-0.5"
              style={{ background: "hsl(16 100% 50%)", boxShadow: "0 0 24px hsla(16,100%,50%,0.3)" }}
            >
              Open Dashboard <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </motion.nav>

      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-32 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-20"
        >
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-8"
            style={{ background: "hsl(16 100% 50% / 0.12)", border: "1px solid hsl(16 100% 50% / 0.2)" }}
          >
            <span className="w-[5px] h-[5px] rounded-full bg-build status-live" style={{ animation: "pulse-green 2s ease infinite" }} />
            <span className="text-[11px] font-mono text-primary tracking-wider uppercase font-semibold">{APP_NAME} terminal</span>
          </div>

          <h1 className="font-display text-7xl md:text-9xl font-extrabold tracking-tight-custom leading-[0.85] mb-6">
            <span className="text-gradient-steel">Cue.</span>
            <br />
            <span className="text-gradient-steel">Validate.</span>
            <br />
            <span className="text-gradient-orange">Build.</span>
          </h1>

          <p className="text-muted-foreground max-w-xl mx-auto text-sm md:text-base leading-relaxed mb-10 font-mono">
            {APP_TAGLINE} Live market signal, deep validation, and recurring
            opportunity memory in one founder workflow.
          </p>

          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/dashboard/validate"
              className="inline-flex items-center gap-2 px-8 h-11 rounded-lg text-sm font-semibold text-white transition-all hover:scale-105"
              style={{ background: "hsl(16 100% 50%)", boxShadow: "0 0 24px hsla(16,100%,50%,0.3)" }}
            >
              <Zap className="w-4 h-4 fill-white" />
              Start validating
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-2 px-6 h-11 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              How it works <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 px-6 h-11 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Pricing <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-16">
          {features.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              className="bento-cell rounded-[14px] p-5"
            >
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center mb-3"
                style={{ background: "hsl(16 100% 50% / 0.12)", border: "1px solid hsl(16 100% 50% / 0.2)" }}
              >
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-xs font-bold mb-1.5 text-foreground">{title}</h3>
              <p className="text-[11px] text-muted-foreground leading-relaxed font-mono">{desc}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3"
        >
          {[
            { label: "Core sources", value: "4" },
            { label: "Validation passes", value: "3+1" },
            { label: "Debate models", value: "6" },
            { label: "Paid trial", value: "7d" },
          ].map((s) => (
            <div key={s.label} className="bento-cell rounded-[14px] p-5 text-center">
              <p className="font-mono text-4xl font-extrabold tracking-tight-custom orange-text tabular-nums">{s.value}</p>
              <p className="text-[11px] text-muted-foreground mt-2 uppercase tracking-[0.12em] font-mono font-semibold">{s.label}</p>
            </div>
          ))}
        </motion.div>
      </main>
    </div>
  );
}
