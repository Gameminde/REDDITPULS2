"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
    Activity,
    ArrowRight,
    CheckCircle2,
    ChevronDown,
    Radar,
    Search,
    Shield,
    Zap,
} from "lucide-react";

import { BrandLogo } from "@/app/components/brand-logo";
import { getBetaLoginHref, getJoinBetaHref } from "@/lib/beta-access";

export type LandingPainExample = {
    topic: string;
    wedge: string;
    pain: string;
    source: string;
    community: string;
    score: number;
    evidenceCount: number;
    sourceCount: number;
    why: string;
};

export type LandingWedgeCard = {
    topic: string;
    wedge: string;
    category: string;
    score: number;
    evidenceCount: number;
    sourceCount: number;
    ageLabel: string;
    why: string;
};

export type LandingStats = {
    visibleSignals: number;
    rawIdeas: number;
    evidencePosts: number;
    shapedWedges: number;
};

const SOURCE_LANES = [
    { key: "reddit", name: "Reddit", detail: "Complaints, workarounds, buyer language." },
    { key: "hackernews", name: "Hacker News", detail: "Launch reaction and dev demand." },
    { key: "producthunt", name: "Product Hunt", detail: "New launches and audience response." },
    { key: "indiehackers", name: "Indie Hackers", detail: "Operator pain and build-in-public signal." },
    { key: "githubissues", name: "GitHub Issues", detail: "Feature requests and tool friction." },
    { key: "g2_review", name: "Review complaints", detail: "Paid-user frustration and competitor weakness." },
    { key: "job_posting", name: "Hiring signals", detail: "Budget and urgency around a workflow." },
];

const FEATURE_CARDS = [
    {
        icon: Search,
        title: "See the complaint",
        desc: "Start from the real pain, not a guess.",
    },
    {
        icon: Activity,
        title: "See the pattern",
        desc: "Repeated pain turns into one opportunity.",
    },
    {
        icon: CheckCircle2,
        title: "Validate fast",
        desc: "Check proof before you commit.",
    },
    {
        icon: Shield,
        title: "See the gap",
        desc: "Find where current tools fail.",
    },
];

const JOIN_BETA_HREF = getJoinBetaHref("/dashboard");
const DASHBOARD_LOGIN_HREF = getBetaLoginHref("/dashboard");

function formatCompact(value: number) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function Marquee() {
    const items = [...SOURCE_LANES.map((item) => item.name), ...SOURCE_LANES.map((item) => item.name)];

    return (
        <div
            className="w-full overflow-hidden"
            style={{ maskImage: "linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)" }}
        >
            <motion.div
                className="flex w-max items-center gap-8 whitespace-nowrap py-1"
                animate={{ x: ["0%", "-50%"] }}
                transition={{ duration: 22, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
            >
                {items.map((source, index) => (
                    <span
                        key={`${source}-${index}`}
                        className="inline-flex shrink-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em]"
                        style={{ color: "rgba(255,255,255,0.26)" }}
                    >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/80" />
                        {source}
                    </span>
                ))}
            </motion.div>
        </div>
    );
}

function HeroBackground() {
    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <motion.div
                className="absolute -left-28 top-10 h-[440px] w-[440px] rounded-full"
                style={{ background: "radial-gradient(circle, rgba(255,90,31,0.18) 0%, transparent 68%)", filter: "blur(36px)" }}
                animate={{ x: [0, 70, 15], y: [0, 40, -20], scale: [1, 1.08, 0.96] }}
                transition={{ duration: 18, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY, repeatType: "mirror" }}
            />
            <motion.div
                className="absolute right-[-120px] top-[18%] h-[380px] w-[380px] rounded-full"
                style={{ background: "radial-gradient(circle, rgba(255,138,66,0.12) 0%, transparent 70%)", filter: "blur(42px)" }}
                animate={{ x: [0, -60, 10], y: [0, 55, -20], scale: [1, 0.9, 1.06] }}
                transition={{ duration: 22, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY, repeatType: "mirror" }}
            />
            <motion.div
                className="absolute bottom-[-140px] left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full"
                style={{ background: "radial-gradient(circle, rgba(255,90,31,0.12) 0%, transparent 70%)", filter: "blur(48px)" }}
                animate={{ y: [0, -80, -30], scale: [1, 1.12, 0.96] }}
                transition={{ duration: 24, ease: "easeInOut", repeat: Number.POSITIVE_INFINITY, repeatType: "mirror" }}
            />
            <div
                className="absolute inset-0 opacity-30"
                style={{
                    backgroundImage:
                        "radial-gradient(circle at center, rgba(255,255,255,0.05) 1px, transparent 1px)",
                    backgroundSize: "26px 26px",
                }}
            />
            <div
                className="absolute inset-0 opacity-[0.05]"
                style={{
                    backgroundImage:
                        "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E\")",
                    backgroundSize: "180px 180px",
                }}
            />
        </div>
    );
}

function TransformShowcase({
    painExamples,
    recentWedges,
}: {
    painExamples: LandingPainExample[];
    recentWedges: LandingWedgeCard[];
}) {
    const items = painExamples
        .map((painExample, index) => ({
            complaint: painExample,
            opportunity: recentWedges[index] || recentWedges[0],
        }))
        .filter((item) => item.opportunity);

    const [activeIndex, setActiveIndex] = useState(0);

    useEffect(() => {
        if (items.length <= 1) return undefined;
        const interval = window.setInterval(() => {
            setActiveIndex((current) => (current + 1) % items.length);
        }, 3600);

        return () => window.clearInterval(interval);
    }, [items.length]);

    const current = items[activeIndex] || {
        complaint: painExamples[0],
        opportunity: recentWedges[0],
    };

    if (!current.complaint || !current.opportunity) return null;

    return (
        <div
            className="relative overflow-hidden rounded-[30px] border"
            style={{ borderColor: "rgba(255,255,255,0.08)", background: "linear-gradient(180deg, rgba(17,13,11,0.95), rgba(11,9,8,0.98))" }}
        >
            <div className="grid md:grid-cols-[1fr_1fr]">
                <div className="relative border-b border-white/6 p-6 md:border-b-0 md:border-r md:border-white/6 md:p-8 lg:p-10">
                    <div className="mb-8 flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary/90">Live complaint</span>
                    </div>
                    <motion.p
                        key={`${activeIndex}-complaint`}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-[30rem] text-2xl font-bold leading-snug text-white md:text-[2rem]"
                    >
                        &quot;{current.complaint.pain}&quot;
                    </motion.p>
                    <motion.p
                        key={`${activeIndex}-source`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="mt-5 text-sm text-white/35"
                    >
                        Spotted in {current.complaint.source}
                        {current.complaint.community ? ` - ${current.complaint.community}` : ""}
                    </motion.p>

                    <div className="mt-10 flex gap-2">
                        {items.map((_, index) => (
                            <button
                                key={index}
                                type="button"
                                onClick={() => setActiveIndex(index)}
                                className="h-1 rounded-full transition-all"
                                style={{
                                    width: activeIndex === index ? 26 : 8,
                                    background: activeIndex === index ? "#FF5A1F" : "rgba(255,255,255,0.12)",
                                }}
                            />
                        ))}
                    </div>
                </div>

                <div
                    className="relative p-6 md:p-8 lg:p-10"
                    style={{ background: "linear-gradient(135deg, rgba(255,90,31,0.08), rgba(255,90,31,0.02))" }}
                >
                    <div className="mb-8 flex items-center justify-between gap-4">
                        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary">CueIdea product angle</span>
                        <span className="rounded-md bg-primary/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                            {current.opportunity.category}
                        </span>
                    </div>

                    <motion.h3
                        key={`${activeIndex}-wedge`}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-[28rem] text-2xl font-bold leading-snug text-white md:text-[2rem]"
                    >
                        {current.opportunity.wedge}
                    </motion.h3>

                    <p className="mt-4 max-w-[30rem] text-sm leading-7 text-white/45">
                        {current.opportunity.why}
                    </p>

                    <div className="mt-8 flex items-end justify-between gap-6">
                        <div className="grid grid-cols-3 gap-5">
                            {[
                                ["Evidence", String(current.opportunity.evidenceCount)],
                                ["Sources", String(current.opportunity.sourceCount)],
                                ["Age", current.opportunity.ageLabel],
                            ].map(([label, value]) => (
                                <div key={label}>
                                    <p className="text-[10px] uppercase tracking-[0.18em] text-white/25">{label}</p>
                                    <p className="mt-1 text-base font-bold text-white">{value}</p>
                                </div>
                            ))}
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-white/25">Score</p>
                            <motion.p
                                key={`${activeIndex}-score`}
                                initial={{ scale: 0.78, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="mt-1 text-6xl font-black leading-none text-primary"
                            >
                                {Math.round(current.opportunity.score)}
                            </motion.p>
                        </div>
                    </div>
                </div>
            </div>

            <div
                className="absolute left-1/2 top-1/2 hidden h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full md:flex"
                style={{ background: "#FF5A1F", boxShadow: "0 0 42px rgba(255,90,31,0.6), 0 0 90px rgba(255,90,31,0.22)" }}
            >
                <Zap className="h-5 w-5 text-white" />
            </div>
        </div>
    );
}

export default function LandingPageClient({
    stats,
    painExamples,
    recentWedges,
}: {
    stats: LandingStats;
    painExamples: LandingPainExample[];
    recentWedges: LandingWedgeCard[];
}) {
    return (
        <div className="relative min-h-screen overflow-hidden bg-[#090705] text-white">
            <HeroBackground />

            <nav
                className="fixed inset-x-0 top-0 z-50 border-b border-white/6"
                style={{ background: "rgba(9,7,5,0.78)", backdropFilter: "blur(18px)" }}
            >
                <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
                    <Link href="/" className="inline-flex items-center">
                        <BrandLogo compact uppercase href={null} />
                    </Link>

                    <div className="hidden items-center gap-8 md:flex">
                        <Link href="/radar" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 transition-colors hover:text-white">
                            Radar
                        </Link>
                        <Link href="/startup-ideas" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 transition-colors hover:text-white">
                            Startup ideas
                        </Link>
                        <Link href="/pricing" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 transition-colors hover:text-white">
                            Pricing
                        </Link>
                    </div>

                    <Link
                        href={JOIN_BETA_HREF}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_0_28px_rgba(255,90,31,0.26)] transition hover:-translate-y-0.5"
                        data-track-event="open_beta_nav_click"
                        data-track-scope="marketing"
                        data-track-label="nav open beta"
                    >
                        Join beta
                        <ChevronDown className="h-3.5 w-3.5" />
                    </Link>
                </div>
            </nav>

            <main className="relative z-10">
                <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 pt-20 text-center sm:px-6">
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <motion.div
                            className="relative h-[68vw] w-[68vw] min-h-[320px] min-w-[320px] max-h-[760px] max-w-[760px] overflow-hidden rounded-full opacity-70 mix-blend-screen"
                            initial={{ scale: 0.85, opacity: 0 }}
                            animate={{ scale: 1, opacity: 0.82 }}
                            transition={{ duration: 1.1, ease: "easeOut" }}
                        >
                            <video
                                src="/videos/cueidea_glass_dome_glow.mp4"
                                autoPlay
                                loop
                                muted
                                playsInline
                                className="h-full w-full object-cover"
                            />
                        </motion.div>
                        <div
                            className="absolute h-[72vw] w-[72vw] min-h-[360px] min-w-[360px] max-h-[820px] max-w-[820px] rounded-full border border-primary/10"
                            style={{ boxShadow: "0 0 140px rgba(255,90,31,0.08)", transform: "translateZ(0)" }}
                        />
                    </div>

                    <motion.div
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.05 }}
                        className="mb-10 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-2"
                    >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary/95">
                            Live - public signals
                        </span>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, ease: "easeOut", delay: 0.12 }}
                        className="relative max-w-5xl"
                    >
                        <h1
                            className="leading-[0.92] tracking-[-0.06em] text-white"
                            style={{ fontFamily: "\"Space Grotesk\", var(--font-display)", fontSize: "clamp(3rem, 8vw, 7.25rem)", fontWeight: 800 }}
                        >
                            <span className="block">See startup demand</span>
                            <span className="block text-primary">before you build.</span>
                        </h1>
                    </motion.div>

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.35 }}
                        className="mt-8 max-w-[760px] text-base leading-8 text-white/45 md:text-lg"
                    >
                        CueIdea turns repeated public pain into startup opportunities you can inspect and validate.
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                        className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
                    >
                        <Link
                            href={JOIN_BETA_HREF}
                            className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-7 text-sm font-bold text-white shadow-[0_0_45px_rgba(255,90,31,0.32)] transition hover:-translate-y-0.5"
                            data-track-event="open_beta_hero_click"
                            data-track-scope="marketing"
                            data-track-label="hero open beta"
                        >
                            + Join the beta
                        </Link>
                        <Link
                            href="/radar"
                            className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 px-6 text-sm font-semibold text-white/65 transition hover:border-white/16 hover:text-white"
                        >
                            See the radar
                            <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.65 }}
                        className="mt-14 w-full max-w-4xl"
                    >
                        <p className="mb-4 text-center text-[10px] uppercase tracking-[0.24em] text-white/18">
                            Watching
                        </p>
                        <Marquee />
                    </motion.div>
                </section>

                <section className="relative z-10 px-4 py-16 sm:px-6 lg:px-8">
                    <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 md:grid-cols-4">
                        {[
                            { label: "Ideas", value: stats.rawIdeas },
                            { label: "Posts", value: stats.evidencePosts },
                            { label: "Examples", value: painExamples.length },
                            { label: "Sources", value: SOURCE_LANES.length },
                        ].map((stat, index) => (
                            <motion.div
                                key={stat.label}
                                initial={{ opacity: 0, y: 18 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true, margin: "-80px" }}
                                transition={{ delay: index * 0.06 }}
                                className="rounded-[26px] border border-white/7 bg-white/[0.025] p-5 md:p-6"
                            >
                                <p className="mb-4 text-[10px] uppercase tracking-[0.22em] text-white/22">{stat.label}</p>
                                <p
                                    className="font-black leading-none text-white"
                                    style={{ fontFamily: "\"Space Grotesk\", var(--font-display)", fontSize: "clamp(2.6rem, 6vw, 4.2rem)" }}
                                >
                                    {formatCompact(stat.value)}
                                </p>
                            </motion.div>
                        ))}
                    </div>
                </section>

                <section id="how" className="relative z-10 px-4 py-16 sm:px-6 lg:px-8">
                    <div className="mx-auto max-w-6xl">
                        <motion.div
                            initial={{ opacity: 0, y: 18 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            className="mb-10"
                        >
                            <p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-primary">How it works</p>
                            <h2
                                className="text-4xl font-black leading-[0.95] tracking-[-0.06em] text-white md:text-6xl"
                                style={{ fontFamily: "\"Space Grotesk\", var(--font-display)" }}
                            >
                                Pain to
                                <br />
                                product angle.
                            </h2>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, y: 22 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: 0.1 }}
                        >
                            <TransformShowcase painExamples={painExamples} recentWedges={recentWedges} />
                        </motion.div>
                    </div>
                </section>

                <section className="relative z-10 px-4 py-16 sm:px-6 lg:px-8">
                    <div className="mx-auto max-w-5xl">
                        <motion.div
                            initial={{ opacity: 0, y: 18 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            className="mb-10"
                        >
                            <p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-primary">What you get</p>
                            <h2
                                className="text-4xl font-black leading-[0.96] tracking-[-0.05em] text-white md:text-6xl"
                                style={{ fontFamily: "\"Space Grotesk\", var(--font-display)" }}
                            >
                                Built for
                                <br />
                                fast conviction.
                            </h2>
                        </motion.div>

                        <div className="grid gap-3 md:grid-cols-3 md:grid-rows-2">
                            <motion.div
                                initial={{ opacity: 0, x: -20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                className="relative overflow-hidden rounded-[28px] border border-primary/16 bg-primary/[0.06] p-7 md:row-span-2"
                            >
                                <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/14 text-primary">
                                    <Radar className="h-5 w-5" />
                                </div>
                                <h3 className="text-[1.35rem] font-bold text-white">Watch live pain</h3>
                                <p className="mt-3 max-w-[20rem] text-sm leading-7 text-white/45">
                                    Track real workflow pain across public sources.
                                </p>

                                <div className="mt-8 flex flex-wrap gap-2">
                                    {["Reddit", "HN", "GitHub", "+4"].map((source) => (
                                        <span key={source} className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-white/35">
                                            {source}
                                        </span>
                                    ))}
                                </div>

                                <div
                                    className="pointer-events-none absolute bottom-[-30px] right-[-10px] h-36 w-36 rounded-full"
                                    style={{ background: "radial-gradient(circle, rgba(255,90,31,0.18) 0%, transparent 72%)" }}
                                />
                            </motion.div>

                            {FEATURE_CARDS.map(({ icon: Icon, title, desc }, index) => (
                                <motion.div
                                    key={title}
                                    initial={{ opacity: 0, y: index < 2 ? -18 : 18 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: 0.08 * (index + 1) }}
                                    className="rounded-[28px] border border-white/6 bg-white/[0.025] p-7"
                                >
                                    <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/16 bg-primary/[0.12] text-primary">
                                        <Icon className="h-5 w-5" />
                                    </div>
                                    <h3 className="text-lg font-bold text-white">{title}</h3>
                                    <p className="mt-2 text-sm leading-7 text-white/38">{desc}</p>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </section>

                <section id="examples" className="relative z-10 px-4 py-16 sm:px-6 lg:px-8">
                    <div className="mx-auto max-w-5xl">
                        <div className="mb-10 flex items-end justify-between gap-4">
                            <div>
                                <p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-primary">Recent opportunities</p>
                                <h2
                                    className="text-4xl font-black leading-[0.96] tracking-[-0.05em] text-white md:text-6xl"
                                    style={{ fontFamily: "\"Space Grotesk\", var(--font-display)" }}
                                >
                                    Recent signals.
                                </h2>
                            </div>
                            <Link href="/radar" className="hidden items-center gap-2 text-sm font-semibold text-white/40 transition-colors hover:text-white md:inline-flex">
                                Open radar
                                <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                        </div>

                        <div className="flex flex-col gap-3">
                            {recentWedges.slice(0, 3).map((idea, index) => (
                                <motion.div
                                    key={`${idea.wedge}-${index}`}
                                    initial={{ opacity: 0, x: -16 }}
                                    whileInView={{ opacity: 1, x: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: index * 0.08 }}
                                    className="group flex items-center gap-5 rounded-[24px] border border-white/6 bg-white/[0.025] px-5 py-5 transition-colors hover:border-primary/18 md:px-7"
                                >
                                    <div className="w-12 shrink-0 text-center">
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-white/20">Score</p>
                                        <p className="mt-1 text-3xl font-black leading-none text-primary">
                                            {Math.round(idea.score)}
                                        </p>
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <span className="inline-flex rounded-md bg-primary/12 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                                            {idea.category}
                                        </span>
                                        <h3 className="mt-2 truncate text-base font-bold text-white md:text-lg">{idea.wedge}</h3>
                                        <p className="mt-1 text-sm text-white/32">
                                            From {idea.topic.toLowerCase()} conversations.
                                        </p>
                                    </div>

                                    <div className="hidden shrink-0 gap-6 md:flex">
                                        {[
                                            ["Evidence", idea.evidenceCount],
                                            ["Sources", idea.sourceCount],
                                            ["Age", idea.ageLabel],
                                        ].map(([label, value]) => (
                                            <div key={String(label)} className="text-center">
                                                <p className="text-[10px] uppercase tracking-[0.18em] text-white/20">{label}</p>
                                                <p className="mt-1 text-sm font-bold text-white">{value}</p>
                                            </div>
                                        ))}
                                    </div>

                                    <ArrowRight className="h-4 w-4 shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="relative z-10 px-4 py-16 sm:px-6 lg:px-8">
                    <div className="mx-auto max-w-5xl">
                        <motion.div
                            initial={{ opacity: 0, y: 18 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            className="mb-10"
                        >
                            <p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-primary">Source coverage</p>
                            <h2
                                className="text-4xl font-black leading-[0.96] tracking-[-0.05em] text-white md:text-6xl"
                                style={{ fontFamily: "\"Space Grotesk\", var(--font-display)" }}
                            >
                                Where the
                                <br />
                                signal comes from.
                            </h2>
                        </motion.div>

                        <div className="grid gap-3 md:grid-cols-2">
                            {SOURCE_LANES.map((source, index) => (
                                <motion.div
                                    key={source.key}
                                    initial={{ opacity: 0, y: 18 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: index * 0.04 }}
                                    className="rounded-[24px] border border-white/6 bg-white/[0.025] p-5"
                                >
                                    <div className="mb-3 flex items-center gap-2">
                                        <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/90">{source.name}</p>
                                    </div>
                                    <p className="text-sm leading-7 text-white/42">{source.detail}</p>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="relative z-10 px-4 pb-10 pt-8 sm:px-6 lg:px-8">
                    <div
                        className="mx-auto max-w-5xl overflow-hidden rounded-[32px] border border-primary/14 px-6 py-10 text-center sm:px-10 md:py-14"
                        style={{ background: "linear-gradient(180deg, rgba(17,13,11,0.96), rgba(9,7,5,0.98))" }}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 18 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                        >
                            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Open beta</p>
                            <h2
                                className="text-4xl font-black leading-[0.94] tracking-[-0.05em] text-white md:text-6xl"
                                style={{ fontFamily: "\"Space Grotesk\", var(--font-display)" }}
                            >
                                Validate before
                                <br />
                                you build.
                            </h2>
                            <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-white/42 md:text-base">
                                Inspect the signal, then validate one idea before you spend time building.
                            </p>

                            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                                <Link
                                    href={JOIN_BETA_HREF}
                                    className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-7 text-sm font-bold text-white shadow-[0_0_45px_rgba(255,90,31,0.32)] transition hover:-translate-y-0.5"
                                    data-track-event="open_beta_footer_click"
                                    data-track-scope="marketing"
                                    data-track-label="footer open beta"
                                >
                                    Join beta
                                    <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                                <Link
                                    href="/how-it-works"
                                    className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 px-6 text-sm font-semibold text-white/65 transition hover:border-white/16 hover:text-white"
                                >
                                    See how it works
                                </Link>
                            </div>
                        </motion.div>
                    </div>
                </section>
            </main>

            <footer className="relative z-10 border-t border-white/6 px-4 py-8 sm:px-6 lg:px-8">
                <div className="mx-auto flex max-w-5xl flex-col gap-4 text-sm text-white/28 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <BrandLogo compact />
                        <span>Startup opportunity intelligence.</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                        <Link href="/radar" className="transition-colors hover:text-white">Radar</Link>
                        <Link href="/startup-ideas" className="transition-colors hover:text-white">Startup ideas</Link>
                        <Link href="/pricing" className="transition-colors hover:text-white">Pricing</Link>
                        <Link href="/how-it-works" className="transition-colors hover:text-white">How it works</Link>
                        <Link href={DASHBOARD_LOGIN_HREF} className="transition-colors hover:text-white">Login</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
