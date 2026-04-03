import Link from "next/link";
import { ArrowRight, Search, FileText, TrendingUp, BellRing, Shield, Sparkles } from "lucide-react";

import { APP_NAME, APP_NAME_UPPER } from "@/lib/brand";

const steps = [
    {
        icon: Search,
        title: "1. Watch live market signal",
        body: `${APP_NAME} continuously scans Reddit and supporting sources to surface recurring pain, wedges, and proof-bearing market movement.`,
    },
    {
        icon: FileText,
        title: "2. Validate one idea deeply",
        body: "Take any idea or market signal into the validation engine to collect evidence, pressure-test the wedge, and build a decision-ready report.",
    },
    {
        icon: TrendingUp,
        title: "3. Read timing, competition, and buyer proof",
        body: "The product turns scattered posts into structured market memory: why now, competitor pressure, WTP clues, and repeat demand patterns.",
    },
    {
        icon: BellRing,
        title: "4. Save, monitor, and come back when the wedge sharpens",
        body: "Use saved ideas, live alerts, and the opportunity board to keep the strongest bets alive instead of rediscovering them every week.",
    },
];

const principles = [
    "The market feed stays raw so you can inspect the evidence yourself.",
    "Validation goes deeper than the feed and turns signal into a concrete go / no-go memo.",
    "Starter gives you the core workflow. Pro unlocks the full intelligence layer.",
];

export default function HowItWorksPage() {
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

            <nav
                className="fixed top-0 left-0 right-0 z-50"
                style={{ borderBottom: "1px solid hsl(0 0% 100% / 0.07)", background: "hsla(0,0%,4%,0.7)", backdropFilter: "blur(20px)" }}
            >
                <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
                    <Link href="/" className="font-mono text-[13px] font-semibold tracking-wider">
                        <span className="text-muted-foreground">⬡</span>{" "}
                        <span className="text-foreground">{APP_NAME_UPPER}</span>
                    </Link>
                    <div className="flex items-center gap-5 text-xs font-semibold">
                        <Link href="/pricing" className="text-muted-foreground hover:text-white transition-colors">
                            Pricing
                        </Link>
                        <Link href="/login" className="text-white hover:text-primary transition-colors">
                            Sign in
                        </Link>
                    </div>
                </div>
            </nav>

            <main className="relative z-10 max-w-6xl mx-auto px-6 pt-28 pb-16">
                <div className="text-center mb-14">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 border border-build/20 bg-build/10 text-build text-[11px] font-mono uppercase tracking-[0.16em]">
                        <Sparkles className="w-3.5 h-3.5" />
                        How {APP_NAME} works
                    </div>
                    <h1 className="font-display text-5xl md:text-7xl font-extrabold tracking-tight-custom leading-[0.92] mb-5">
                        From raw market noise
                        <br />
                        to a sharper business bet
                    </h1>
                    <p className="text-muted-foreground max-w-2xl mx-auto text-sm md:text-base leading-relaxed">
                        {APP_NAME} is built for founders who want to move from scattered signal to a tighter wedge, better validation, and a more repeatable decision loop.
                    </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2 mb-14">
                    {steps.map(({ icon: Icon, title, body }) => (
                        <div key={title} className="bento-cell rounded-[14px] p-6">
                            <div
                                className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                                style={{ background: "hsl(16 100% 50% / 0.12)", border: "1px solid hsl(16 100% 50% / 0.2)" }}
                            >
                                <Icon className="w-5 h-5 text-primary" />
                            </div>
                            <h2 className="text-lg font-semibold text-white mb-2">{title}</h2>
                            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                        </div>
                    ))}
                </div>

                <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] items-start">
                    <div className="bento-cell rounded-[14px] p-6">
                        <div className="flex items-center gap-2 mb-4 text-build text-[11px] font-mono uppercase tracking-[0.16em]">
                            <Shield className="w-3.5 h-3.5" />
                            Product principles
                        </div>
                        <div className="space-y-4">
                            {principles.map((item) => (
                                <div key={item} className="flex items-start gap-3">
                                    <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />
                                    <p className="text-sm text-muted-foreground leading-relaxed">{item}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bento-cell rounded-[14px] p-6">
                        <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground mb-3">
                            Next step
                        </div>
                        <h2 className="text-xl font-semibold text-white mb-3">See the plans, then start with the workflow that fits you</h2>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                            If you mainly want the core signal-and-validation loop, Starter is enough. If you want the full intelligence layer, Pro is the right path.
                        </p>
                        <div className="flex flex-col gap-3">
                            <Link
                                href="/pricing"
                                className="inline-flex items-center justify-center gap-2 px-5 h-11 rounded-lg text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                                style={{ background: "hsl(16 100% 50%)", boxShadow: "0 0 24px hsla(16,100%,50%,0.3)" }}
                            >
                                View pricing
                                <ArrowRight className="w-4 h-4" />
                            </Link>
                            <Link
                                href="/login"
                                className="inline-flex items-center justify-center gap-2 px-5 h-11 rounded-lg text-sm font-semibold border border-white/10 text-white hover:border-primary/40 transition-colors"
                            >
                                Open the app
                            </Link>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
