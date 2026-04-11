import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Search, Zap } from "lucide-react";

import { BrandLogo } from "@/app/components/brand-logo";
import { getJoinBetaHref } from "@/lib/beta-access";
import { getPublicSiteData } from "@/lib/public-site-data";

export const revalidate = 300;

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://cueidea.me";
const JOIN_BETA_HREF = getJoinBetaHref("/dashboard");

export const metadata: Metadata = {
    title: "Startup Ideas People Already Want",
    description: "Learn how to find startup ideas with real demand. CueIdea turns public pain points, review complaints, GitHub issues, and hiring signals into startup opportunities you can validate before you build.",
    alternates: {
        canonical: "/startup-ideas",
    },
    openGraph: {
        title: "CueIdea: Startup Ideas People Already Want",
        description: "A public guide to finding startup ideas with real demand instead of guessing from trends.",
        url: `${siteUrl}/startup-ideas`,
        type: "article",
    },
    twitter: {
        card: "summary",
        title: "CueIdea: Startup Ideas People Already Want",
        description: "A public guide to finding startup ideas with real demand instead of guessing from trends.",
    },
};

const FAQS = [
    {
        question: "What makes a startup idea worth building?",
        answer: "A startup idea becomes worth building when repeated buyer pain appears clearly enough that you can explain who has the pain, why current tools fail, and what a tighter product wedge would solve.",
    },
    {
        question: "How do you validate startup ideas before building?",
        answer: "Start with real buyer language, collect repeated pain across multiple sources, look for proof that the problem is recurring, then talk to potential buyers before writing code. Validation is stronger when the pain is direct, not just adjacent.",
    },
    {
        question: "Where does CueIdea get startup ideas from?",
        answer: "CueIdea watches public complaints and operator conversations across places like Reddit, Hacker News, Product Hunt, Indie Hackers, GitHub Issues, review complaints, and hiring signals, then shapes that evidence into startup opportunities.",
    },
    {
        question: "Why are some startup ideas still marked as early or unvalidated?",
        answer: "Because interest alone is not enough. Some ideas show promising adjacent pain but still lack direct buyer proof, clear willingness-to-pay evidence, or a narrow enough wedge to treat them as build-ready.",
    },
];

export default async function StartupIdeasPage() {
    const data = await getPublicSiteData();
    const faqSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQS.map((item) => ({
            "@type": "Question",
            name: item.question,
            acceptedAnswer: {
                "@type": "Answer",
                text: item.answer,
            },
        })),
    };

    return (
        <div className="min-h-screen overflow-hidden bg-[#090705] text-white">
            <div className="noise-overlay" />
            <div
                className="fixed pointer-events-none rounded-full"
                style={{ top: -180, left: -100, width: 620, height: 620, filter: "blur(140px)", background: "hsla(16,100%,50%,0.08)", zIndex: 0 }}
            />
            <div
                className="fixed pointer-events-none rounded-full"
                style={{ bottom: -200, right: -120, width: 540, height: 540, filter: "blur(110px)", background: "hsla(16,70%,50%,0.06)", zIndex: 0 }}
            />

            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
            />

            <nav
                className="sticky top-0 z-50 border-b border-white/6"
                style={{ background: "rgba(9,7,5,0.82)", backdropFilter: "blur(18px)" }}
            >
                <div className="mx-auto flex h-14 max-w-[1180px] items-center justify-between px-4 sm:px-6 lg:px-8">
                    <BrandLogo compact uppercase />
                    <div className="hidden items-center gap-7 md:flex">
                        <Link href="/" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 transition-colors hover:text-white">
                            Home
                        </Link>
                        <Link href="/radar" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 transition-colors hover:text-white">
                            Radar
                        </Link>
                        <Link href="/how-it-works" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 transition-colors hover:text-white">
                            How it works
                        </Link>
                    </div>
                    <Link
                        href={JOIN_BETA_HREF}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_0_28px_rgba(255,90,31,0.26)] transition hover:-translate-y-0.5"
                    >
                        Open beta
                    </Link>
                </div>
            </nav>

            <main className="relative z-10 px-4 pb-16 pt-14 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-[1180px]">
                    <section className="max-w-4xl">
                        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-2">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
                            <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary/95">CueIdea guide</span>
                        </div>
                        <h1
                            className="text-[clamp(2.8rem,7vw,5.8rem)] font-black leading-[0.92] tracking-[-0.06em] text-white"
                            style={{ fontFamily: "\"Space Grotesk\", var(--font-display)" }}
                        >
                            Startup ideas
                            <br />
                            people already want.
                        </h1>
                        <p className="mt-6 max-w-3xl text-base leading-8 text-white/48 md:text-lg">
                            Most startup ideas fail because they start from intuition instead of repeated buyer pain. CueIdea is built around the opposite workflow: watch real complaints, shape the repeated pattern into a tighter wedge, then validate before building.
                        </p>
                    </section>

                    <section className="mt-12 grid gap-4 md:grid-cols-3">
                        {[
                            {
                                icon: Search,
                                title: "Start from pain, not trends",
                                text: "The best startup ideas usually come from repeated frustrations, manual workflows, reliability gaps, or expensive tools people already complain about in public.",
                            },
                            {
                                icon: Zap,
                                title: "Tighten the wedge",
                                text: "A broad theme like marketing automation or dev tools is not enough. The real opportunity appears when the pain is narrowed into a specific buyer and workflow.",
                            },
                            {
                                icon: CheckCircle2,
                                title: "Validate before code",
                                text: "Strong startup ideas still need proof. Direct buyer language, cross-source repetition, and founder interviews matter more than generic excitement.",
                            },
                        ].map(({ icon: Icon, title, text }) => (
                            <div key={title} className="rounded-[28px] border border-white/6 bg-white/[0.03] p-7">
                                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/16 bg-primary/[0.12] text-primary">
                                    <Icon className="h-5 w-5" />
                                </div>
                                <h2 className="text-lg font-bold text-white">{title}</h2>
                                <p className="mt-3 text-sm leading-7 text-white/42">{text}</p>
                            </div>
                        ))}
                    </section>

                    <section className="mt-16 grid gap-10 lg:grid-cols-[0.95fr_1.05fr]">
                        <div>
                            <p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-primary">How CueIdea finds startup ideas</p>
                            <h2
                                className="text-4xl font-black leading-[0.96] tracking-[-0.05em] text-white md:text-5xl"
                                style={{ fontFamily: "\"Space Grotesk\", var(--font-display)" }}
                            >
                                A better way to find
                                <br />
                                startup opportunities.
                            </h2>
                        </div>

                        <div className="space-y-6">
                            {[
                                "CueIdea collects public pain from founder communities, review complaints, GitHub issues, and hiring signals instead of starting from abstract market categories.",
                                "The system filters that evidence, removes broad or weak clusters, and shapes what remains into tighter opportunity wedges that humans can actually inspect.",
                                "Each idea is stronger when the signal repeats across sources or contains direct buyer language, and weaker when the pain is broad, adjacent, or speculative.",
                                "That is why startup ideas in CueIdea are treated like decision inputs, not entertainment. The goal is to help founders decide what deserves interviews, validation, or a build pass.",
                            ].map((paragraph) => (
                                <p key={paragraph} className="text-base leading-8 text-white/48">
                                    {paragraph}
                                </p>
                            ))}
                        </div>
                    </section>

                    <section className="mt-16">
                        <div className="mb-8 flex items-end justify-between gap-4">
                            <div>
                                <p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-primary">Examples</p>
                                <h2
                                    className="text-4xl font-black leading-[0.96] tracking-[-0.05em] text-white md:text-5xl"
                                    style={{ fontFamily: "\"Space Grotesk\", var(--font-display)" }}
                                >
                                    Startup ideas CueIdea
                                    <br />
                                    is tracking now.
                                </h2>
                            </div>
                            <Link href="/radar" className="hidden items-center gap-2 text-sm font-semibold text-white/42 transition-colors hover:text-white md:inline-flex">
                                Open the radar
                                <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            {data.recentWedges.slice(0, 6).map((idea) => (
                                <div key={`${idea.topic}-${idea.wedge}`} className="rounded-[28px] border border-white/6 bg-white/[0.025] p-6">
                                    <div className="mb-3 flex flex-wrap items-center gap-2">
                                        <span className="rounded-md bg-primary/12 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                                            {idea.category}
                                        </span>
                                        <span className="rounded-md bg-white/[0.05] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
                                            {idea.ageLabel}
                                        </span>
                                    </div>
                                    <h3 className="text-xl font-bold leading-snug text-white">{idea.wedge}</h3>
                                    <p className="mt-3 text-sm leading-7 text-white/42">{idea.why}</p>
                                    <div className="mt-5 grid grid-cols-3 gap-4 border-t border-white/6 pt-5 text-center">
                                        {[
                                            ["Score", Math.round(idea.score)],
                                            ["Posts", idea.evidenceCount],
                                            ["Sources", idea.sourceCount],
                                        ].map(([label, value]) => (
                                            <div key={String(label)}>
                                                <div className="text-[10px] uppercase tracking-[0.18em] text-white/24">{label}</div>
                                                <div className="mt-1 text-sm font-bold text-white">{value}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="mt-16 grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
                        <div>
                            <p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-primary">FAQ</p>
                            <h2
                                className="text-4xl font-black leading-[0.96] tracking-[-0.05em] text-white md:text-5xl"
                                style={{ fontFamily: "\"Space Grotesk\", var(--font-display)" }}
                            >
                                Startup ideas,
                                <br />
                                answered clearly.
                            </h2>
                        </div>
                        <div className="space-y-4">
                            {FAQS.map((item) => (
                                <div key={item.question} className="rounded-[24px] border border-white/6 bg-white/[0.025] p-6">
                                    <h3 className="text-lg font-bold text-white">{item.question}</h3>
                                    <p className="mt-3 text-sm leading-7 text-white/46">{item.answer}</p>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="mt-16 rounded-[32px] border border-primary/14 bg-[linear-gradient(180deg,rgba(17,13,11,0.96),rgba(9,7,5,0.98))] px-6 py-10 text-center sm:px-10 md:py-14">
                        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Use CueIdea</p>
                        <h2
                            className="text-4xl font-black leading-[0.94] tracking-[-0.05em] text-white md:text-6xl"
                            style={{ fontFamily: "\"Space Grotesk\", var(--font-display)" }}
                        >
                            See the opportunity,
                            <br />
                            then validate it.
                        </h2>
                        <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-white/42 md:text-base">
                            If you want startup ideas with real buyer language behind them, open the radar first. When one looks promising, move it into Validate before you spend time building.
                        </p>

                        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                            <Link
                                href="/radar"
                                className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-7 text-sm font-bold text-white shadow-[0_0_45px_rgba(255,90,31,0.32)] transition hover:-translate-y-0.5"
                            >
                                Open the radar
                                <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                            <Link
                                href={JOIN_BETA_HREF}
                                className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 px-6 text-sm font-semibold text-white/70 transition hover:border-white/16 hover:text-white"
                            >
                                Join the beta
                            </Link>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}
