"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Home } from "lucide-react";

import { BrandLogo } from "@/app/components/brand-logo";
import { ADMIN_NAV } from "@/app/admin/nav";

export function AdminShell({
    children,
    actor,
}: {
    children: React.ReactNode;
    actor: {
        email: string;
        role: string;
    };
}) {
    const pathname = usePathname();

    return (
        <div className="min-h-screen text-foreground">
            <div className="pointer-events-none fixed inset-0 z-0 opacity-60">
                <div className="noise-overlay" />
            </div>

            <div className="relative z-10 mx-auto flex min-h-screen max-w-[1600px] gap-6 px-4 py-4 lg:px-6">
                <aside className="hidden w-[250px] shrink-0 rounded-[20px] border border-white/10 bg-[rgba(17,17,17,0.92)] p-4 shadow-[0_0_30px_-18px_rgba(249,115,22,0.4)] backdrop-blur-xl lg:flex lg:flex-col">
                    <Link href="/admin" className="mb-5 flex items-center gap-3 rounded-2xl border border-white/6 bg-white/[0.03] px-3 py-3">
                        <BrandLogo compact href={null} />
                        <div>
                            <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-primary">Admin</div>
                            <div className="text-sm font-semibold text-white">Control Panel</div>
                        </div>
                    </Link>

                    <nav className="space-y-1">
                        {ADMIN_NAV.map((item) => {
                            const Icon = item.icon;
                            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                                        active
                                            ? "border-primary/30 bg-primary/10 text-primary"
                                            : "border-transparent text-muted-foreground hover:border-white/8 hover:bg-white/[0.03] hover:text-white"
                                    }`}
                                >
                                    <Icon className="h-4 w-4" />
                                    <span>{item.title}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="mt-auto space-y-3 pt-5">
                        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                            <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">Signed in</div>
                            <div className="mt-2 truncate text-sm text-white">{actor.email}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.14em] text-primary">{actor.role}</div>
                        </div>
                        <Link
                            href="/dashboard"
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground transition hover:border-primary/20 hover:text-white"
                        >
                            <Home className="h-3.5 w-3.5" />
                            Back to App
                        </Link>
                    </div>
                </aside>

                <div className="flex min-w-0 flex-1 flex-col gap-4">
                    <header className="rounded-[20px] border border-white/10 bg-[rgba(17,17,17,0.82)] px-4 py-4 backdrop-blur-xl">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-primary">Operator Surface</div>
                                <div className="mt-1 text-xl font-semibold text-white">Runtime, growth, and diagnostics</div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.14em] text-primary">
                                    /admin
                                </span>
                                <Link
                                    href="/pricing"
                                    className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground transition hover:border-primary/20 hover:text-white"
                                >
                                    Public site
                                    <ArrowUpRight className="h-3 w-3" />
                                </Link>
                            </div>
                        </div>
                    </header>

                    <div className="flex-1">{children}</div>
                </div>
            </div>
        </div>
    );
}
