import Link from "next/link";

import { BrandLogo } from "@/app/components/brand-logo";
import { PricingContent } from "@/app/components/pricing-content";
import { getBetaLoginHref } from "@/lib/beta-access";
import { APP_NAME } from "@/lib/brand";

const DASHBOARD_LOGIN_HREF = getBetaLoginHref("/dashboard");

export default function PublicPricingPage() {
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
                    <Link href="/">
                        <BrandLogo compact uppercase href={null} />
                    </Link>
                    <div className="flex items-center gap-5 text-xs font-semibold">
                        <Link
                            href="/how-it-works"
                            className="text-muted-foreground hover:text-white transition-colors"
                            data-track-event="pricing_how_it_works_click"
                            data-track-scope="marketing"
                            data-track-label="pricing nav how it works"
                        >
                            How it works
                        </Link>
                        <Link
                            href={DASHBOARD_LOGIN_HREF}
                            className="text-white hover:text-primary transition-colors"
                            data-track-event="pricing_signin_click"
                            data-track-scope="marketing"
                            data-track-label="pricing nav sign in"
                        >
                            Sign in
                        </Link>
                    </div>
                </div>
            </nav>

            <main className="relative z-10 pt-24 pb-16">
                <div className="mb-4 text-center text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    {APP_NAME} pricing
                </div>
                <PricingContent />
            </main>
        </div>
    );
}
