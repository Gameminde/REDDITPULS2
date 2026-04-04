import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { trackServerEvent } from "@/lib/analytics";
import { ensureProfileForUser } from "@/lib/ensure-profile";

const signupTimestamps = new Map<string, number[]>();
const MAX_SIGNUPS_PER_HOUR = 3;

function checkSignupRateLimit(ip: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3600_000;
    const stamps = (signupTimestamps.get(ip) || []).filter((timestamp) => timestamp > hourAgo);
    if (stamps.length >= MAX_SIGNUPS_PER_HOUR) return false;
    stamps.push(now);
    signupTimestamps.set(ip, stamps);
    return true;
}

function isValidEmail(email: string): boolean {
    return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(email);
}

function isStrongPassword(password: string): { valid: boolean; reason?: string } {
    if (password.length < 8) return { valid: false, reason: "Password must be at least 8 characters" };
    if (password.length > 128) return { valid: false, reason: "Password is too long" };
    if (!/[a-zA-Z]/.test(password)) return { valid: false, reason: "Password must contain at least one letter" };
    if (!/[0-9]/.test(password)) return { valid: false, reason: "Password must contain at least one number" };
    return { valid: true };
}

export async function POST(req: NextRequest) {
    try {
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("x-real-ip")
            || "unknown";

        if (!checkSignupRateLimit(ip)) {
            await trackServerEvent(req, {
                eventName: "signup_failed",
                scope: "auth",
                route: "/login",
                properties: { reason: "rate_limited" },
            });
            return NextResponse.json({ error: "Too many signup attempts - try again later" }, { status: 429 });
        }

        const { email, password } = await req.json();

        if (!email || !password) {
            await trackServerEvent(req, {
                eventName: "signup_failed",
                scope: "auth",
                route: "/login",
                properties: { reason: "missing_fields" },
            });
            return NextResponse.json({ error: "Email and password required" }, { status: 400 });
        }

        if (!isValidEmail(email)) {
            await trackServerEvent(req, {
                eventName: "signup_failed",
                scope: "auth",
                route: "/login",
                properties: { reason: "invalid_email" },
            });
            return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
        }

        const pwCheck = isStrongPassword(password);
        if (!pwCheck.valid) {
            await trackServerEvent(req, {
                eventName: "signup_failed",
                scope: "auth",
                route: "/login",
                properties: { reason: pwCheck.reason || "weak_password" },
            });
            return NextResponse.json({ error: pwCheck.reason }, { status: 400 });
        }

        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceKey) {
            await trackServerEvent(req, {
                eventName: "signup_failed",
                scope: "auth",
                route: "/login",
                properties: { reason: "missing_service_role" },
            });
            return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
        }

        const adminClient = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            serviceKey,
            {
                cookies: {
                    getAll() { return []; },
                    setAll() {},
                },
            }
        );

        const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        });

        if (authError) {
            console.error("Signup error:", authError.message);
            await trackServerEvent(req, {
                eventName: "signup_failed",
                scope: "auth",
                route: "/login",
                properties: { reason: authError.message },
            });
            return NextResponse.json({ error: "Signup failed - check your email and try again" }, { status: 400 });
        }

        const user = authData.user;

        try {
            await ensureProfileForUser(user);
        } catch (profileError) {
            console.error("Profile creation error:", profileError);
        }

        const cookieStore = await cookies();
        const anonClient = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() { return cookieStore.getAll(); },
                    setAll(cookiesToSet) {
                        try {
                            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
                        } catch {}
                    },
                },
            }
        );

        const { error: signInError } = await anonClient.auth.signInWithPassword({
            email,
            password,
        });

        await trackServerEvent(req, {
            eventName: "signup_success",
            scope: "auth",
            route: "/login",
            userId: user.id,
            properties: { auto_login: !signInError },
        });

        if (signInError) {
            console.error("Auto-signin error:", signInError.message);
            return NextResponse.json({
                success: true,
                needsLogin: true,
                message: "Account created! Please log in.",
            });
        }

        return NextResponse.json({ success: true, needsLogin: false });
    } catch (error) {
        console.error("Signup route error:", error);
        await trackServerEvent(req, {
            eventName: "signup_failed",
            scope: "auth",
            route: "/login",
            properties: { reason: "internal_error" },
        });
        return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
}
