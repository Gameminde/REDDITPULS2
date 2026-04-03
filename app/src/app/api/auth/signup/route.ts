import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ensureProfileForUser } from "@/lib/ensure-profile";

// ── Rate Limiting (per IP) ──
const signupTimestamps = new Map<string, number[]>();
const MAX_SIGNUPS_PER_HOUR = 3;

function checkSignupRateLimit(ip: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3600_000;
    const stamps = (signupTimestamps.get(ip) || []).filter(t => t > hourAgo);
    if (stamps.length >= MAX_SIGNUPS_PER_HOUR) return false;
    stamps.push(now);
    signupTimestamps.set(ip, stamps);
    return true;
}

// ── Validation ──
function isValidEmail(email: string): boolean {
    // RFC 5322 simplified — covers 99.9% of valid emails
    return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(email);
}

function isStrongPassword(password: string): { valid: boolean; reason?: string } {
    if (password.length < 8) return { valid: false, reason: "Password must be at least 8 characters" };
    if (password.length > 128) return { valid: false, reason: "Password is too long" };
    if (!/[a-zA-Z]/.test(password)) return { valid: false, reason: "Password must contain at least one letter" };
    if (!/[0-9]/.test(password)) return { valid: false, reason: "Password must contain at least one number" };
    return { valid: true };
}

// POST /api/auth/signup — create user + profile
export async function POST(req: NextRequest) {
    try {
        // Rate limit by IP
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("x-real-ip")
            || "unknown";

        if (!checkSignupRateLimit(ip)) {
            return NextResponse.json({ error: "Too many signup attempts — try again later" }, { status: 429 });
        }

        const { email, password } = await req.json();

        if (!email || !password) {
            return NextResponse.json({ error: "Email and password required" }, { status: 400 });
        }

        // Validate email format
        if (!isValidEmail(email)) {
            return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
        }

        // Validate password strength
        const pwCheck = isStrongPassword(password);
        if (!pwCheck.valid) {
            return NextResponse.json({ error: pwCheck.reason }, { status: 400 });
        }

        // Use service_role key to bypass RLS and create profile
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceKey) {
            return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
        }

        const adminClient = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            serviceKey,
            {
                cookies: {
                    getAll() { return []; },
                    setAll() { },
                },
            }
        );

        // 1. Create the auth user via admin
        const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        });

        if (authError) {
            // Generic error — don't reveal if email already exists
            console.error("Signup error:", authError.message);
            return NextResponse.json({ error: "Signup failed — check your email and try again" }, { status: 400 });
        }

        const user = authData.user;

        // 2. Create profile row (using service role — bypasses RLS)
        try {
            await ensureProfileForUser(user);
        } catch (profileError: any) {
            console.error("Profile creation error:", profileError?.message || profileError);
        }

        // 3. Sign in the user with the anon client to set cookies
        const cookieStore = await cookies();
        const anonClient = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() { return cookieStore.getAll(); },
                    setAll(cookiesToSet) {
                        try {
                            cookiesToSet.forEach(({ name, value, options }) =>
                                cookieStore.set(name, value, options)
                            );
                        } catch { }
                    },
                },
            }
        );

        const { error: signInError } = await anonClient.auth.signInWithPassword({
            email,
            password,
        });

        if (signInError) {
            console.error("Auto-signin error:", signInError.message);
            return NextResponse.json({
                success: true,
                needsLogin: true,
                message: "Account created! Please log in."
            });
        }

        return NextResponse.json({ success: true, needsLogin: false });
    } catch (err) {
        console.error("Signup route error:", err);
        return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }
}
