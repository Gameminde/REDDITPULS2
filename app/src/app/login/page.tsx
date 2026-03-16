"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
    const searchParams = useSearchParams();
    const isSignup = searchParams.get("mode") === "signup";

    const [mode, setMode] = useState<"login" | "signup">(isSignup ? "signup" : "login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");

    const supabase = createClient();

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setMessage("");

        if (mode === "signup") {
            // Use server-side signup route (creates user + profile with service_role)
            try {
                const resp = await fetch("/api/auth/signup", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password }),
                });
                const data = await resp.json();
                if (!resp.ok) {
                    setMessage(data.error || "Signup failed");
                } else if (data.needsLogin) {
                    setMessage(data.message || "Account created! Please log in.");
                    setMode("login");
                } else {
                    setMessage("Account created! Redirecting...");
                    window.location.href = "/dashboard";
                }
            } catch {
                setMessage("Network error — please try again");
            }
        } else {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            if (error) {
                setMessage(error.message);
            } else {
                window.location.href = "/dashboard";
            }
        }

        setLoading(false);
    }

    async function handleGoogle() {
        await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: `${window.location.origin}/dashboard` },
        });
    }

    return (
        <div className="min-h-screen flex items-center justify-center px-6">
            <div className="w-full max-w-md">
                <Link href="/" className="flex items-center gap-2 justify-center mb-8">
                    <span className="text-3xl">📡</span>
                    <span className="font-bold text-2xl">RedditPulse</span>
                </Link>

                <div className="card-glow p-8">
                    <h2 className="text-2xl font-bold mb-2 text-center">
                        {mode === "login" ? "Welcome back" : "Create your account"}
                    </h2>
                    <p className="text-zinc-400 text-sm text-center mb-6">
                        {mode === "login"
                            ? "Log in to your dashboard"
                            : "Start scanning Reddit for opportunities"}
                    </p>

                    {/* Google OAuth */}
                    <button
                        onClick={handleGoogle}
                        className="w-full flex items-center justify-center gap-3 border border-zinc-700 hover:border-zinc-500 rounded-lg py-3 mb-4 transition text-sm"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path
                                fill="#4285F4"
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
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

                    <div className="flex items-center gap-4 mb-4">
                        <div className="flex-1 h-px bg-zinc-800" />
                        <span className="text-xs text-zinc-500">or</span>
                        <div className="flex-1 h-px bg-zinc-800" />
                    </div>

                    {/* Email form */}
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
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={6}
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition"
                        />
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3 rounded-lg font-semibold transition"
                        >
                            {loading ? "..." : mode === "login" ? "Log In" : "Create Account"}
                        </button>
                    </form>

                    {message && (
                        <p className="text-sm text-center mt-4 text-orange-400">{message}</p>
                    )}

                    <p className="text-sm text-center text-zinc-500 mt-6">
                        {mode === "login" ? (
                            <>
                                No account?{" "}
                                <button
                                    onClick={() => setMode("signup")}
                                    className="text-orange-400 hover:underline"
                                >
                                    Sign up
                                </button>
                            </>
                        ) : (
                            <>
                                Already have one?{" "}
                                <button
                                    onClick={() => setMode("login")}
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
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><span className="text-xl">Loading...</span></div>}>
            <LoginForm />
        </Suspense>
    );
}
