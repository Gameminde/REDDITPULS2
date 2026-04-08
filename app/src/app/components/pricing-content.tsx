"use client";

import Link from "next/link";
import React from "react";
import { motion } from "framer-motion";
import {
    Activity,
    ArrowRight,
    BellRing,
    Bookmark,
    Check,
    Compass,
    DollarSign,
    FileText,
    Globe,
    Mail,
    Radar,
    Shield,
    Sparkles,
    TrendingUp,
    X,
} from "lucide-react";

import { StaggerContainer, StaggerItem } from "@/app/components/motion";
import { APP_NAME } from "@/lib/brand";
import { getBetaLoginHref, getJoinBetaHref } from "@/lib/beta-access";
import { PRICING } from "@/lib/pricing-plans";

type Availability = "free" | "starter" | "pro";

type FeatureRow = {
    name: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    availability: Availability;
};

const FEATURE_ROWS: FeatureRow[] = [
    {
        name: "Opportunity board",
        description: "The live board of startup ideas with evidence-first cards and source counts.",
        icon: Activity,
        availability: "free",
    },
    {
        name: "Opportunity intelligence",
        description: "Sharper product-angle, theme, and competitor summaries above the live board.",
        icon: Sparkles,
        availability: "starter",
    },
    {
        name: "Post explorer",
        description: "Browse and inspect the evidence behind opportunities and scans.",
        icon: Compass,
        availability: "free",
    },
    {
        name: "Idea validation",
        description: "Run a full validation on one startup idea before you build.",
        icon: FileText,
        availability: "starter",
    },
    {
        name: "Validation reports",
        description: "Read the full report archive and report detail pages.",
        icon: FileText,
        availability: "starter",
    },
    {
        name: "Saved ideas and live alerts",
        description: "Track saved opportunities, monitors, and alert matches.",
        icon: Bookmark,
        availability: "starter",
    },
    {
        name: "Trend velocity and why-now",
        description: "Read momentum tiers and timing notes in the trends surface.",
        icon: TrendingUp,
        availability: "pro",
    },
    {
        name: "WTP detection",
        description: "See willingness-to-pay signals extracted from validations.",
        icon: DollarSign,
        availability: "pro",
    },
    {
        name: "Competitor radar",
        description: "Track competitor weakness clusters and recurring complaint proof.",
        icon: Radar,
        availability: "pro",
    },
    {
        name: "Source intelligence",
        description: "Inspect platform mix, models used, and source composition.",
        icon: Globe,
        availability: "pro",
    },
    {
        name: "In-app digest brief",
        description: "Use the digest surface inside the app to review monitor changes.",
        icon: Mail,
        availability: "pro",
    },
];

const FREE_FEATURES = [
    "Opportunity board",
    "Post explorer",
    "Login, signup, and core product access",
];

const STARTER_FEATURES = [
    "Everything in Free",
    "Opportunity intelligence",
    "Idea validation and full reports",
    "Saved ideas and live alerts",
];

const PRO_FEATURES = [
    "Everything in Starter",
    "Trend velocity and why-now",
    "WTP detection and competitor radar",
    "Source intelligence and in-app digest",
];

const LOGIN_TO_APP_HREF = getBetaLoginHref("/dashboard");
const JOIN_BETA_HREF = getJoinBetaHref("/dashboard");

function availabilityFor(plan: "free" | "starter" | "pro", row: FeatureRow) {
    if (plan === "pro") return true;
    if (plan === "starter") return row.availability === "free" || row.availability === "starter";
    return row.availability === "free";
}

function PlanCard({
    title,
    price,
    subtitle,
    points,
    cta,
    href,
    featured = false,
    badge,
    accent = "#f97316",
}: {
    title: string;
    price: string;
    subtitle: string;
    points: string[];
    cta: string;
    href: string;
    featured?: boolean;
    badge?: string;
    accent?: string;
}) {
    return (
        <motion.div
            className="rounded-[22px] border p-6 md:p-7 relative overflow-hidden"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
                background: featured ? "linear-gradient(180deg, rgba(33,14,7,0.98), rgba(14,10,9,0.95))" : "rgba(12,15,20,0.92)",
                borderColor: featured ? `${accent}` : "rgba(255,255,255,0.08)",
                boxShadow: featured ? "0 0 0 1px rgba(249,115,22,0.18), 0 20px 70px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)" : "0 20px 60px rgba(0,0,0,0.2)",
            }}
        >
            {badge ? (
                <div
                    className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full px-4 py-1 text-[11px] font-bold uppercase tracking-[0.16em]"
                    style={{
                        background: accent,
                        color: "#2b0d03",
                        boxShadow: "0 10px 24px rgba(249,115,22,0.24)",
                    }}
                >
                    {badge}
                </div>
            ) : null}

            <div className="mb-4">
                <div className="text-2xl font-bold text-white">{title}</div>
                <div className="mt-2 flex items-end gap-1.5">
                    <span className="text-5xl font-extrabold text-white font-display leading-none">{price}</span>
                    {price !== "$0" ? <span className="pb-1 text-lg text-muted-foreground">/month</span> : <span className="pb-1 text-sm text-muted-foreground">forever</span>}
                </div>
            </div>

            <p className="mb-6 min-h-[52px] text-sm leading-relaxed text-muted-foreground">{subtitle}</p>

            <div className="space-y-3.5 mb-7">
                {points.map((point) => (
                    <div key={point} className="flex items-start gap-3 text-sm text-foreground/90">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-build" />
                        <span>{point}</span>
                    </div>
                ))}
            </div>

            <Link
                href={href}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all"
                data-track-event={title === "Free" ? "pricing_free_cta_click" : "pricing_trial_cta_click"}
                data-track-scope="marketing"
                data-track-label={`${title} ${cta}`}
                style={{
                    background: featured ? "linear-gradient(135deg, rgba(249,115,22,0.22), rgba(234,88,12,0.12))" : "rgba(255,255,255,0.05)",
                    border: `1px solid ${featured ? "rgba(249,115,22,0.28)" : "rgba(255,255,255,0.08)"}`,
                    color: featured ? "#fed7aa" : "#f8fafc",
                }}
            >
                {cta}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
        </motion.div>
    );
}

export function PricingContent() {
    return (
        <div className="max-w-7xl mx-auto px-6 md:px-8">
            <motion.div
                className="text-center mb-10"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <div className="inline-flex items-center gap-2 rounded-full border border-build/20 bg-build/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.16em] text-build mb-4">
                    <Sparkles className="h-3.5 w-3.5" />
                    {PRICING.trialDays}-day free trial on paid plans
                </div>
                <h1 className="mb-3 text-[34px] font-extrabold tracking-tight text-white md:text-[42px]">
                    Pricing for founders who want proof, not fluff
                </h1>
                <p className="mx-auto max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
                    {APP_NAME} has the features shown below today. I removed anything the product does not really ship yet, including email delivery claims for the digest.
                </p>
            </motion.div>

            <div className="grid gap-5 xl:grid-cols-3 items-stretch">
                <PlanCard
                    title="Free"
                    price="$0"
                    subtitle="Use the live feed and post explorer to see what the market is saying before you commit."
                    points={FREE_FEATURES}
                    cta="Open the app"
                    href={LOGIN_TO_APP_HREF}
                />
                <PlanCard
                    title={PRICING.starter.name}
                    price={`$${PRICING.starter.priceMonthly}`}
                    subtitle="The core workflow for a solo founder: market intelligence, validation depth, and saved follow-up."
                    points={STARTER_FEATURES}
                    cta={`Start ${PRICING.trialDays}-day free trial`}
                    href={JOIN_BETA_HREF}
                />
                <PlanCard
                    title={PRICING.pro.name}
                    price={`$${PRICING.pro.priceMonthly}`}
                    subtitle="Everything unlocked. This is the full intelligence layer when you want CueIdea in your weekly operating system."
                    points={PRO_FEATURES}
                    cta={`Start ${PRICING.trialDays}-day free trial`}
                    href={JOIN_BETA_HREF}
                    featured
                    badge="Most Popular"
                    accent="#f97316"
                />
            </div>

            <motion.div
                className="mt-8 grid gap-4 lg:grid-cols-[1.35fr_0.65fr]"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
            >
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-6">
                    <div className="mb-4 flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.16em] text-build">
                        <Shield className="h-3.5 w-3.5" />
                        Product truth
                    </div>
                    <div className="space-y-3 text-sm text-muted-foreground">
                        <p>
                            The pricing matrix below reflects the product that actually exists in the codebase today.
                        </p>
                        <p>
                            The biggest copy correction is digest: it is real, but it is an in-app brief surface, not an outbound email system yet.
                        </p>
                        <p>
                            Starter covers the core founder loop. Pro is everything above that line.
                        </p>
                    </div>
                </div>

                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-6">
                    <div className="mb-4 text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                        Trial policy
                    </div>
                    <div className="space-y-3 text-sm text-foreground/90">
                        <p>Every paid plan starts with a {PRICING.trialDays}-day full-access trial.</p>
                        <p>Starter is ${PRICING.starter.priceMonthly}/month after trial.</p>
                        <p>Pro is ${PRICING.pro.priceMonthly}/month after trial.</p>
                    </div>
                </div>
            </motion.div>

            <motion.div
                className="mt-14"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
            >
                <div className="mb-6 text-center">
                    <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Feature access</div>
                </div>

                <div className="overflow-hidden rounded-[22px] border border-white/8 bg-black/25">
                    <div className="grid grid-cols-[minmax(0,1fr)_70px_90px_70px] gap-2 border-b border-white/8 bg-white/[0.03] px-4 py-4 text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground md:grid-cols-[minmax(0,1.15fr)_90px_110px_90px]">
                        <span>Feature</span>
                        <span className="text-center">Free</span>
                        <span className="text-center text-white">Starter</span>
                        <span className="text-center text-build">Pro</span>
                    </div>

                    <StaggerContainer className="flex flex-col">
                        {FEATURE_ROWS.map((row, index) => {
                            const Icon = row.icon;
                            return (
                                <StaggerItem key={row.name}>
                                    <div
                                        className={`grid grid-cols-[minmax(0,1fr)_70px_90px_70px] gap-2 px-4 py-4 md:grid-cols-[minmax(0,1.15fr)_90px_110px_90px] ${index !== FEATURE_ROWS.length - 1 ? "border-b border-white/6" : ""}`}
                                    >
                                        <div className="flex items-start gap-3 pr-3">
                                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                                                <Icon className="h-4 w-4 text-muted-foreground" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-white">{row.name}</div>
                                                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{row.description}</div>
                                            </div>
                                        </div>

                                        {(["free", "starter", "pro"] as const).map((plan) => {
                                            const enabled = availabilityFor(plan, row);
                                            return (
                                                <div key={plan} className="flex items-center justify-center">
                                                    {enabled ? (
                                                        <Check className={`h-4 w-4 ${plan === "pro" ? "text-build" : "text-emerald-400"}`} />
                                                    ) : (
                                                        <X className="h-4 w-4 text-white/20" />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </StaggerItem>
                            );
                        })}
                    </StaggerContainer>
                </div>
            </motion.div>

            <motion.div
                className="mt-12 grid gap-4 md:grid-cols-3"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
            >
                {[
                    {
                        icon: Activity,
                        title: "Live feed stays raw",
                        body: "The live board is not rewritten into marketing copy. You still inspect the real proof.",
                    },
                    {
                        icon: BellRing,
                        title: "Alerts are live",
                        body: "Saved ideas, monitors, and alert matches already exist in the current app.",
                    },
                    {
                        icon: Mail,
                        title: "Digest is in-app",
                        body: "Today the digest is a dashboard surface. If you want outbound email later, we should build it as a separate feature.",
                    },
                ].map(({ icon: Icon, title, body }) => (
                    <div key={title} className="rounded-[22px] border border-white/8 bg-white/[0.03] p-6">
                        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-build/20 bg-build/10">
                            <Icon className="h-5 w-5 text-build" />
                        </div>
                        <div className="mb-2 text-base font-semibold text-white">{title}</div>
                        <div className="text-sm leading-relaxed text-muted-foreground">{body}</div>
                    </div>
                ))}
            </motion.div>
        </div>
    );
}
