import Link from "next/link";

export function AdminPageHeader({
    eyebrow,
    title,
    description,
}: {
    eyebrow: string;
    title: string;
    description: string;
}) {
    return (
        <div className="mb-6">
            <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-primary">{eyebrow}</div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
    );
}

export function AdminSection({
    title,
    description,
    children,
    action,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
    action?: React.ReactNode;
}) {
    return (
        <section className="rounded-[20px] border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-white">{title}</h2>
                    {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

export function AdminStatCard({
    label,
    value,
    hint,
    tone = "neutral",
    badge,
}: {
    label: string;
    value: string | number;
    hint?: string;
    tone?: "neutral" | "healthy" | "degraded" | "warning";
    badge?: string;
}) {
    const toneClasses = {
        neutral: "border-white/8 bg-white/[0.03] text-white",
        healthy: "border-build/20 bg-build/10 text-build",
        degraded: "border-dont/20 bg-dont/10 text-dont",
        warning: "border-risky/20 bg-risky/10 text-risky",
    }[tone];

    return (
        <div className={`rounded-2xl border p-4 ${toneClasses}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
                {badge ? <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.14em] text-muted-foreground">{badge}</span> : null}
            </div>
            <div className="mt-3 text-3xl font-semibold leading-none">{value}</div>
            {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
    );
}

export function AdminPill({
    children,
    tone = "neutral",
}: {
    children: React.ReactNode;
    tone?: "neutral" | "healthy" | "degraded" | "warning";
}) {
    const toneClasses = {
        neutral: "border-white/10 bg-white/[0.03] text-muted-foreground",
        healthy: "border-build/20 bg-build/10 text-build",
        degraded: "border-dont/20 bg-dont/10 text-dont",
        warning: "border-risky/20 bg-risky/10 text-risky",
    }[tone];

    return (
        <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-[0.14em] ${toneClasses}`}>
            {children}
        </span>
    );
}

export function EmptyAdminState({
    title,
    body,
}: {
    title: string;
    body: string;
}) {
    return (
        <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-12 text-center">
            <div className="text-base font-medium text-white">{title}</div>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{body}</p>
        </div>
    );
}

export function AdminLink({
    href,
    children,
}: {
    href: string;
    children: React.ReactNode;
}) {
    return (
        <Link href={href} className="text-sm text-primary transition hover:text-white">
            {children}
        </Link>
    );
}
