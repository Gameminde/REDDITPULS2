"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

function ActionButton({
    children,
    onClick,
    disabled,
    tone = "neutral",
}: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    tone?: "neutral" | "primary" | "danger";
}) {
    const classes = {
        neutral: "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-white hover:border-primary/20",
        primary: "border-primary/25 bg-primary/10 text-primary hover:bg-primary/15",
        danger: "border-dont/25 bg-dont/10 text-dont hover:bg-dont/15",
    }[tone];

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`rounded-xl border px-3 py-2 text-xs font-mono uppercase tracking-[0.14em] transition disabled:cursor-not-allowed disabled:opacity-50 ${classes}`}
        >
            {children}
        </button>
    );
}

export function RetryValidationButton({ validationId }: { validationId: string }) {
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    return (
        <ActionButton
            tone="primary"
            disabled={pending}
            onClick={() => startTransition(async () => {
                const response = await fetch(`/api/admin/validations/${validationId}/retry`, { method: "POST" });
                if (response.ok) router.refresh();
            })}
        >
            {pending ? "Retrying..." : "Retry"}
        </ActionButton>
    );
}

export function JobsControlPanel({
    scrapersPaused,
    validationsPaused,
}: {
    scrapersPaused: boolean;
    validationsPaused: boolean;
}) {
    const [message, setMessage] = useState("");
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    function runAction(url: string, body?: Record<string, unknown>) {
        startTransition(async () => {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: body ? JSON.stringify(body) : undefined,
            });
            const payload = await response.json().catch(() => ({}));
            setMessage(payload.message || (response.ok ? "Action completed." : payload.error || "Action failed."));
            router.refresh();
        });
    }

    return (
        <div className="flex flex-wrap items-center gap-2">
            <ActionButton tone="primary" disabled={pending} onClick={() => runAction("/api/admin/jobs/run-scraper")}>
                Force run scraper
            </ActionButton>
            <ActionButton disabled={pending} onClick={() => runAction("/api/admin/jobs/pause", { paused: !scrapersPaused })}>
                {scrapersPaused ? "Resume scrapers" : "Pause scrapers"}
            </ActionButton>
            <ActionButton disabled={pending} onClick={() => runAction("/api/admin/jobs/pause-validations", { paused: !validationsPaused })}>
                {validationsPaused ? "Resume validations" : "Pause validations"}
            </ActionButton>
            {message ? <span className="ml-2 text-xs text-muted-foreground">{message}</span> : null}
        </div>
    );
}

export function UserPlanForm({ userId, currentPlan }: { userId: string; currentPlan: string }) {
    const [plan, setPlan] = useState(currentPlan);
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    return (
        <div className="flex items-center gap-2">
            <select
                value={plan}
                onChange={(event) => setPlan(event.target.value)}
                className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs text-foreground"
            >
                {["free", "starter", "pro", "enterprise", "beta", "founder"].map((option) => (
                    <option key={option} value={option}>{option}</option>
                ))}
            </select>
            <ActionButton
                tone="primary"
                disabled={pending}
                onClick={() => startTransition(async () => {
                    await fetch(`/api/admin/users/${userId}/plan`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ plan }),
                    });
                    router.refresh();
                })}
            >
                Save
            </ActionButton>
        </div>
    );
}

export function UserRoleForm({ userId, currentRole }: { userId: string; currentRole: string }) {
    const [role, setRole] = useState(currentRole);
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    return (
        <div className="flex items-center gap-2">
            <select
                value={role}
                onChange={(event) => setRole(event.target.value)}
                className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-xs text-foreground"
            >
                {["user", "moderator", "admin"].map((option) => (
                    <option key={option} value={option}>{option}</option>
                ))}
            </select>
            <ActionButton
                tone="primary"
                disabled={pending}
                onClick={() => startTransition(async () => {
                    await fetch(`/api/admin/users/${userId}/role`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ role }),
                    });
                    router.refresh();
                })}
            >
                Save
            </ActionButton>
        </div>
    );
}

export function RuntimeSettingsForm({
    initial,
}: {
    initial: {
        scrapers_paused: boolean;
        validations_paused: boolean;
        default_validation_depth: string;
        maintenance_note: string | null;
    };
}) {
    const [scrapersPaused, setScrapersPaused] = useState(initial.scrapers_paused);
    const [validationsPaused, setValidationsPaused] = useState(initial.validations_paused);
    const [depth, setDepth] = useState(initial.default_validation_depth);
    const [note, setNote] = useState(initial.maintenance_note || "");
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    return (
        <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
                <label className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-muted-foreground">
                    <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Default validation depth</div>
                    <select
                        value={depth}
                        onChange={(event) => setDepth(event.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-foreground"
                    >
                        {["quick", "deep", "investigation"].map((option) => (
                            <option key={option} value={option}>{option}</option>
                        ))}
                    </select>
                </label>
                <label className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-muted-foreground">
                    <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">Maintenance note</div>
                    <input
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-foreground"
                        placeholder="Optional banner text for operators"
                    />
                </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-foreground">
                    <input type="checkbox" checked={scrapersPaused} onChange={(event) => setScrapersPaused(event.target.checked)} />
                    Pause scraper runtime
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-foreground">
                    <input type="checkbox" checked={validationsPaused} onChange={(event) => setValidationsPaused(event.target.checked)} />
                    Pause validation intake
                </label>
            </div>

            <ActionButton
                tone="primary"
                disabled={pending}
                onClick={() => startTransition(async () => {
                    await fetch("/api/admin/settings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            scrapers_paused: scrapersPaused,
                            validations_paused: validationsPaused,
                            default_validation_depth: depth,
                            maintenance_note: note,
                        }),
                    });
                    router.refresh();
                })}
            >
                Save runtime settings
            </ActionButton>
        </div>
    );
}
