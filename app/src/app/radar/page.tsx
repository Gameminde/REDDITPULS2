import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Compass, Radar, Sparkles } from "lucide-react";

import { BrandLogo } from "@/app/components/brand-logo";
import { getBetaLoginHref, getJoinBetaHref } from "@/lib/beta-access";
import { getPublicSiteData } from "@/lib/public-site-data";

export const revalidate = 300;

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://cueidea.me";
const JOIN_BETA_HREF = getJoinBetaHref("/dashboard");
const DASHBOARD_LOGIN_HREF = getBetaLoginHref("/dashboard");

export const metadata: Metadata = {
    title: "CueIdea Opportunity Radar",
    description: "Browse live startup opportunities shaped from repeated public pain. CueIdea turns complaints, reviews, launch reactions, and hiring signals into radar-ready opportunities.",
    alternates: {
        canonical: "/radar",
    },
    openGraph: {
        title: "CueIdea Opportunity Radar",
        description: "Browse live startup opportunities shaped from repeated public pain before you build.",
        url: `${siteUrl}/radar`,
        type: "website",
    },
    twitter: {
        card: "summary",
        title: "CueIdea Opportunity Radar",
        description: "Browse live startup opportunities shaped from repeated public pain before you build.",
    },
};

function formatCompact(value: number) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export default async function RadarPage() {
    const data = await getPublicSiteData();
    const featuredIdeas = data.radarIdeas.slice(0, 6);
    const collectionSchema = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "CueIdea Opportunity Radar",
        url: `${siteUrl}/radar`,
        description: "Live startup opportunities shaped from repeated public pain across public communities, review complaints, and hiring signals.",
        mainEntity: {
            "@type": "ItemList",
            itemListElement: featuredIdeas.map((idea, index) => ({
                "@type": "ListItem",
                position: index + 1,
                name: idea.title,
                url: `${siteUrl}${idea.href}`,
            })),
        },
    };

    return (
        <div className="min-h-screen overflow-hidden bg-[#090705] text-white">
            <div className="noise-overlay" />
            <div
                className="fixed pointer-events-none rounded-full"
                style={{ top: -160, left: -120, width: 620, height: 620, filter: "blur(140px)", background: "hsla(16,100%,50%,0.08)", zIndex: 0 }}
            />
            <div
                className="fixed pointer-events-none rounded-full"
                style={{ bottom: -220, right: -120, width: 560, height: 560, filter: "blur(120px)", background: "hsla(16,70%,50%,0.06)", zIndex: 0 }}
            />

            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema) }}
            />

            <nav
                className="sticky top-0 z-50 border-b border-white/6"
                style={{ background: "rgba(9,7,5,0.82)", backdropFilter: "blur(18px)" }}
            >
                <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-4 sm:px-6 lg:px-8">
                    <BrandLogo compact uppercase />
                    <div className="hidden items-center gap-7 md:flex">
                        <Link href="/" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 transition-colors hover:text-white">
                            Home
                        </Link>
                        <Link href="/startup-ideas" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 transition-colors hover:text-white">
                            Startup ideas
                        </Link>
                        <Link href="/how-it-works" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 transition-colors hover:text-white">
                            How it works
                        </Link>
                    </div>
                    <div className="flex items-center gap-3">
                        <Link href={DASHBOARD_LOGIN_HREF} className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55 transition-colors hover:text-white sm:inline-flex">
                            Sign in
                        </Link>
                        <Link
                            href={JOIN_BETA_HREF}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_0_28px_rgba(255,90,31,0.26)] transition hover:-translate-y-0.5"
                        >
                            Open beta
                        </Link>
                    </div>
                </div>
            </nav>

            <main className="relative z-10">
                <section className="px-4 pb-10 pt-16 sm:px-6 lg:px-8 lg:pb-14 lg:pt-20">
                    <div className="mx-auto grid max-w-[1280px] gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
                        <div>
                            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-2">
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
                                <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary/95">CueIdea public radar</span>
                            </div>
                            <h1
                                className="max-w-4xl text-[clamp(2.7rem,7vw,6rem)] font-black leading-[0.92] tracking-[-0.06em] text-white"
                                style={{ fontFamily: "\"Space Grotesk\", var(--font-display)" }}
                            >
                                Startup opportunities
                                <br />
                                shaped from real pain.
                            </h1>
                            <p className="mt-6 max-w-2xl text-base leading-8 text-white/48 md:text-lg">
                                CueIdea watches repeated public pain across founder communities, review complaints, GitHub issues, and hiring signals, then turns that noise into a radar you can actually scan.
                            </p>

                            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                                <Link
                                    href="/dashboard"
                                    className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-7 text-sm font-bold text-white shadow-[0_0_45px_rgba(255,90,31,0.32)] transition hover:-translate-y-0.5"
                                >
                                    Open full dashboard
                                    <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                                <Link
                                    href="/startup-ideas"
                                    className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/10 px-6 text-sm font-semibold text-white/70 transition hover:border-white/16 hover:text-white"
                                >
                                    Read the startup ideas guide
                                </Link>
                            </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            {[
                                ["Live opportunities", formatCompact(data.stats.visibleSignals)],
                                ["Evidence posts", formatCompact(data.stats.evidencePosts)],
                                ["Shaped wedges", formatCompact(data.stats.shapedWedges)],
                                ["Top categories", String(data.categories.length)],
                            ].map(([label, value]) => (
                                <div
                                    key={label}
                                    className="rounded-[24px] border border-white/6 bg-white/[0.03] p-5"
                                >
                                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/28">{label}</div>
                                    <div className="mt-2 text-3xl font-black text-primary">{value}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="px-4 py-8 sm:px-6 lg:px-8">
                    <div className="mx-auto flex max-w-[1280px] flex-wrap gap-2">
                        {data.categories.map((category) => (
                            <span
                                key={category.name}
                                className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-white/56"
                            >
                                {category.name} · {category.count}
                            </span>
                        ))}
                    </div>
                </section>

                <section className="px-4 py-10 sm:px-6 lg:px-8">
                    <div className="mx-auto max-w-[1280px]">
                        <div className="mb-8 flex items-end justify-between gap-4">
                            <div>
                                <p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-primary">Live radar</p>
                                <h2
                                    className="text-4xl font-black leading-[0.96] tracking-[-0.05em] text-white md:text-6xl"
                                    style={{ fontFamily: "\"Space Grotesk\", var(--font-display)" }}
                                >
                                    What is moving
                                    <br />
                                    right now.
                                </h2>
                            </div>
                            <p className="hidden max-w-sm text-sm leading-7 text-white/38 md:block">
                                Each row starts from repeated public pain, then keeps only enough context to help you decide whether it deserves a deeper validation pass.
                            </p>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            {data.radarIdeas.map((idea, index) => (
                                <Link
                                    key={`${idea.slug}-${index}`}
                                    href={idea.href}
                                    className="group rounded-[28px] border border-white/6 bg-white/[0.025] p-6 transition hover:border-primary/18 hover:bg-white/[0.035]"
                                >
                                    <div className="flex items-start justify-between gap-5">
                                        <div className="min-w-0">
                                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                                <span className="rounded-md bg-primary/12 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                                                    {idea.category}
                                                </span>
                                                <span className="rounded-md bg-white/[0.05] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
                                                    {idea.trendLabel}
                                                </span>
                                                {idea.directBuyerCount > 0 ? (
                                                    <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
                                                        {idea.directBuyerCount} direct
                                                    </span>
                                                ) : null}
                                            </div>
                                            <h3 className="text-xl font-bold leading-snug text-white">{idea.title}</h3>
                                            <p className="mt-3 text-sm leading-7 text-white/40">{idea.summary}</p>
                                        </div>

                                        <div className="shrink-0 text-right">
                                            <div className="text-[10px] uppercase tracking-[0.18em] text-white/24">Score</div>
                                            <div className="mt-1 text-4xl font-black leading-none text-primary">{Math.round(idea.score)}</div>
                                        </div>
                                    </div>

                                    <div className="mt-6 grid gap-3 border-t border-white/6 pt-5 md:grid-cols-[1fr_auto] md:items-end">
                                        <div>
                                            <div className="text-[10px] uppercase tracking-[0.18em] text-white/24">Why now</div>
                                            <p className="mt-2 text-sm leading-7 text-white/48">{idea.why}</p>
                                        </div>
                                        <div className="grid grid-cols-3 gap-5 text-center">
                                            {[
                                                ["Posts", idea.evidenceCount],
                                                ["Sources", idea.sourceCount],
                                                ["Age", idea.ageLabel],
                                            ].map(([label, value]) => (
                                                <div key={String(label)}>
                                                    <div className="text-[10px] uppercase tracking-[0.18em] text-white/24">{label}</div>
                                                    <div className="mt-1 text-sm font-bold text-white">{value}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/6 pt-5 text-sm text-white/42">
                                        <span className="min-w-0 truncate">{idea.sourceMix || "Public source mix"}</span>
                                        <span className="inline-flex items-center gap-2 font-semibold text-primary transition group-hover:translate-x-0.5">
                                            Open details
                                            <ArrowRight className="h-3.5 w-3.5" />
                                        </span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="px-4 py-16 sm:px-6 lg:px-8">
                    <div className="mx-auto grid max-w-[1280px] gap-4 md:grid-cols-3">
                        {[
                            {
                                icon: Compass,
                                title: "Scan for movement",
                                text: "Use the radar to see which workflows are gaining repeated public pain, not just one-off chatter.",
                            },
                            {
                                icon: Radar,
                                title: "Open the wedge",
                                text: "Each opportunity is already shaped into a tighter product angle so you do not start from a vague theme.",
                            },
                            {
                                icon: Sparkles,
                                title: "Validate before building",
                                text: "Once something looks promising, move it into Validate and decide whether the proof is strong enough to act on.",
                            },
                        ].map(({ icon: Icon, title, text }) => (
                            <div key={title} className="rounded-[28px] border border-white/6 bg-white/[0.025] p-7">
                                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/16 bg-primary/[0.12] text-primary">
                                    <Icon className="h-5 w-5" />
                                </div>
                                <h3 className="text-lg font-bold text-white">{title}</h3>
                                <p className="mt-3 text-sm leading-7 text-white/42">{text}</p>
                            </div>
                        ))}
                    </div>
                </section>
            </main>
        </div>
    );
}
