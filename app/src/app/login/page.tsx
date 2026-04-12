"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { BrandLogo } from "@/app/components/brand-logo";
import { trackClientEvent } from "@/lib/analytics-client";
import { getBetaTargetPath } from "@/lib/beta-access";
import { createClient } from "@/lib/supabase-browser";

type AuthMode = "login" | "signup";

function resolvePublicSiteUrl() {
    if (typeof window !== "undefined") {
        return window.location.origin;
    }

    const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
    if (configured) {
        return configured;
    }

    return "";
}

function LoginForm() {
    const searchParams = useSearchParams();
    const modeParam = searchParams.get("mode");
    const messageParam = searchParams.get("message");
    const nextPath = getBetaTargetPath(searchParams.get("next"));
    const googleAuthEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

    const initialMode: AuthMode = modeParam === "signup" ? "signup" : "login";
    const supabase = useMemo(() => createClient(), []);

    const [mode, setMode] = useState<AuthMode>(initialMode);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(messageParam || "");
    const [messageTone, setMessageTone] = useState<"error" | "success">(
        messageParam ? "success" : "error"
    );

    useEffect(() => {
        setMode(initialMode);
    }, [initialMode]);

    useEffect(() => {
        if (messageParam) {
            setMessage(messageParam);
            setMessageTone("success");
        }
    }, [messageParam]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setMessage("");

        try {
            if (mode === "signup") {
                if (password !== confirmPassword) {
                    setMessageTone("error");
                    setMessage("Passwords do not match.");
                    return;
                }

                const resp = await fetch("/api/auth/signup", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password }),
                });
                const data = await resp.json();
                if (!resp.ok) {
                    setMessageTone("error");
                    setMessage(data.error || "Signup failed");
                } else if (data.needsLogin) {
                    setMessageTone("success");
                    setMessage(data.message || "Account created. Please log in.");
                    setMode("login");
                    setPassword("");
                    setConfirmPassword("");
                } else {
                    window.location.href = nextPath;
                }
                return;
            }

            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) {
                setMessageTone("error");
                setMessage(error.message);
                return;
            }

            void trackClientEvent("login_success", "auth", {
                method: "password",
                redirect_to: nextPath,
            }, "/login");

            window.location.href = nextPath;
        } catch {
            setMessageTone("error");
            setMessage("Network error - please try again.");
        } finally {
            setLoading(false);
        }
    }

    async function handleGoogle() {
        if (!googleAuthEnabled) {
            setMessageTone("error");
            setMessage("Google login is not enabled yet. Finish the Supabase Google provider setup first.");
            return;
        }

        setLoading(true);
        setMessage("");
        const publicSiteUrl = resolvePublicSiteUrl();

        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: `${publicSiteUrl}/auth/callback?next=${encodeURIComponent(nextPath)}`,
            },
        });

        void trackClientEvent("google_oauth_start", "auth", {
            redirect_to: nextPath,
        }, "/login");

        if (error) {
            setLoading(false);
            setMessageTone("error");
            setMessage(error.message || "Google login failed.");
        }
    }

    async function handleForgotPassword() {
        if (!email.trim()) {
            setMessageTone("error");
            setMessage("Enter your email first, then click Forgot password.");
            return;
        }

        setLoading(true);
        setMessage("");
        const publicSiteUrl = resolvePublicSiteUrl();

        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: `${publicSiteUrl}/reset-password`,
        });

        setLoading(false);

        if (error) {
            setMessageTone("error");
            setMessage(error.message || "Could not send reset email.");
            return;
        }

        setMessageTone("success");
        setMessage("Password reset email sent. Open the link in your inbox to choose a new password.");
    }

    return (
        <div className="min-h-screen flex items-center justify-center px-6">
            <div className="w-full max-w-md">
                <div className="mb-8 flex justify-center">
                    <BrandLogo compact uppercase />
                </div>

                <div className="card-glow p-8">
                    <h2 className="text-2xl font-bold mb-2 text-center">
                        {mode === "login" ? "Welcome back" : "Join the beta"}
                    </h2>
                    <p className="text-zinc-400 text-sm text-center mb-6">
                        {mode === "login"
                            ? "Log in to your dashboard"
                            : "Sign up with Google to join the beta and unlock your dashboard"}
                    </p>

                    <button
                        onClick={handleGoogle}
                        disabled={loading}
                        data-track-event="google_oauth_click"
                        data-track-scope="auth"
                        className="w-full flex items-center justify-center gap-3 border border-zinc-700 hover:border-zinc-500 rounded-lg py-3 mb-2 transition text-sm disabled:opacity-50"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path
                                fill="#4285F4"
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                            />
                            <path
                                fill="#34A853"
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                                fill="#FBBC05"
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                            />
                            <path
                                fill="#EA4335"
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                            />
                        </svg>
                        Continue with Google
                    </button>

                    {!googleAuthEnabled ? (
                        <p className="text-xs text-zinc-500 text-center mb-4">
                            Google login is being configured. Email login works right now.
                        </p>
                    ) : null}

                    <div className="flex items-center gap-4 mb-4">
                        <div className="flex-1 h-px bg-zinc-800" />
                        <span className="text-xs text-zinc-500">or</span>
                        <div className="flex-1 h-px bg-zinc-800" />
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <input
                            type="email"
                            placeholder="Email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition"
                        />
                        <input
                            type="password"
                            placeholder={mode === "login" ? "Password" : "Create a password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={8}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition"
                        />

                        {mode === "signup" && (
                            <input
                                type="password"
                                placeholder="Confirm password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                minLength={8}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition"
                            />
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            data-track-event={mode === "login" ? "login_submit_click" : "signup_submit_click"}
                            data-track-scope="auth"
                            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition"
                        >
                            {loading ? "..." : mode === "login" ? "Log In" : "Join Beta"}
                        </button>
                    </form>

                    {mode === "login" && (
                        <button
                            type="button"
                            onClick={handleForgotPassword}
                            disabled={loading}
                            className="w-full mt-3 text-sm text-orange-400 hover:underline disabled:opacity-50"
                        >
                            Forgot password?
                        </button>
                    )}

                    {message && (
                        <p
                            className={`text-sm text-center mt-4 ${
                                messageTone === "success" ? "text-emerald-400" : "text-orange-400"
                            }`}
                        >
                            {message}
                        </p>
                    )}

                    <p className="text-sm text-center text-zinc-500 mt-6">
                        {mode === "login" ? (
                            <>
                                New here?{" "}
                                <button
                                    onClick={() => {
                                        setMode("signup");
                                        setMessage("");
                                    }}
                                    className="text-orange-400 hover:underline"
                                >
                                    Join beta
                                </button>
                            </>
                        ) : (
                            <>
                                Already in the beta?{" "}
                                <button
                                    onClick={() => {
                                        setMode("login");
                                        setMessage("");
                                    }}
                                    className="text-orange-400 hover:underline"
                                >
                                    Log in
                                </button>
                            </>
                        )}
                    </p>
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center">
                    <span className="text-xl">Loading...</span>
                </div>
            }
        >
            <LoginForm />
        </Suspense>
    );
}
