"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase-browser";
import { APP_NAME } from "@/lib/brand";

export default function ResetPasswordPage() {
    const supabase = useMemo(() => createClient(), []);

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [recoveryReady, setRecoveryReady] = useState(false);
    const [message, setMessage] = useState("Open the reset link from your email to choose a new password.");
    const [messageTone, setMessageTone] = useState<"error" | "success">("success");

    useEffect(() => {
        let mounted = true;

        async function bootstrapRecovery() {
            const { data } = await supabase.auth.getSession();
            if (!mounted) return;
            if (data.session) {
                setRecoveryReady(true);
                setMessage("Recovery session detected. Enter your new password below.");
                setMessageTone("success");
            }
        }

        bootstrapRecovery();

        const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
            if (!mounted) return;
            if (event === "PASSWORD_RECOVERY" || !!session) {
                setRecoveryReady(true);
                setMessage("Recovery session detected. Enter your new password below.");
                setMessageTone("success");
            }
        });

        return () => {
            mounted = false;
            listener.subscription.unsubscribe();
        };
    }, [supabase]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!recoveryReady) {
            setMessageTone("error");
            setMessage("This reset page is only usable from the recovery link sent to your email.");
            return;
        }

        if (password.length < 8) {
            setMessageTone("error");
            setMessage("Password must be at least 8 characters.");
            return;
        }

        if (password !== confirmPassword) {
            setMessageTone("error");
            setMessage("Passwords do not match.");
            return;
        }

        setLoading(true);
        setMessage("");

        const { error } = await supabase.auth.updateUser({ password });

        if (error) {
            setLoading(false);
            setMessageTone("error");
            setMessage(error.message || "Could not update your password.");
            return;
        }

        await supabase.auth.signOut();
        window.location.href = "/login?message=Password%20updated.%20Log%20in%20with%20your%20new%20password.";
    }

    return (
        <div className="min-h-screen flex items-center justify-center px-6">
            <div className="w-full max-w-md">
                <Link href="/" className="flex items-center gap-2 justify-center mb-8">
                    <span className="text-3xl">📡</span>
                    <span className="font-bold text-2xl">{APP_NAME}</span>
                </Link>

                <div className="card-glow p-8">
                    <h1 className="text-2xl font-bold text-center mb-2">Reset your password</h1>
                    <p className="text-zinc-400 text-sm text-center mb-6">
                        Finish account recovery by choosing a new password.
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input
                            type="password"
                            placeholder="New password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            minLength={8}
                            required
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition"
                        />
                        <input
                            type="password"
                            placeholder="Confirm new password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            minLength={8}
                            required
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition"
                        />

                        <button
                            type="submit"
                            disabled={loading || !recoveryReady}
                            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition"
                        >
                            {loading ? "Updating..." : "Save new password"}
                        </button>
                    </form>

                    <p
                        className={`text-sm text-center mt-4 ${
                            messageTone === "success" ? "text-emerald-400" : "text-orange-400"
                        }`}
                    >
                        {message}
                    </p>

                    <p className="text-sm text-center text-zinc-500 mt-6">
                        <Link href="/login" className="text-orange-400 hover:underline">
                            Back to login
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
