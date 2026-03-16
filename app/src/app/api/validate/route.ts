import { createClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import os from "os";
import { checkProcessLimit, trackProcess, releaseProcess } from "@/lib/process-limiter";
import { checkPremium } from "@/lib/check-premium";

// ── Rate Limiting ──
const validateTimestamps = new Map<string, number[]>();
const MAX_VALIDATIONS_PER_HOUR = 5;

function checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3600_000;
    const stamps = (validateTimestamps.get(userId) || []).filter(t => t > hourAgo);
    if (stamps.length >= MAX_VALIDATIONS_PER_HOUR) return false;
    stamps.push(now);
    validateTimestamps.set(userId, stamps);
    return true;
}

// POST — launch a new idea validation via queue (serialized execution)
export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // Rate limit
        if (!checkRateLimit(user.id)) {
            return NextResponse.json({ error: "Rate limit exceeded — max 5 validations per hour" }, { status: 429 });
        }

        // Server-side premium check
        const { isPremium } = await checkPremium(supabase, user.id);
        if (!isPremium) {
            return NextResponse.json({ error: "Premium subscription required" }, { status: 403 });
        }

        const body = await req.json();
        const { idea } = body;

        if (!idea || typeof idea !== "string" || idea.trim().length < 10) {
            return NextResponse.json({ error: "Idea must be at least 10 characters" }, { status: 400 });
        }

        // Cap idea length at 2000 chars
        const trimmedIdea = idea.trim().slice(0, 2000);

        // Create validation row
        const { data: validation, error } = await supabase
            .from("idea_validations")
            .insert({
                user_id: user.id,
                idea_text: trimmedIdea,
                model: "multi-brain",
                status: "queued",
            })
            .select()
            .single();

        if (error) {
            console.error("Validation insert error:", error.code, error.message);
            return NextResponse.json({
                error: error.code === "42P01"
                    ? "idea_validations table not found — run schema_validations.sql in Supabase SQL Editor first!"
                    : error.message,
            }, { status: 500 });
        }

        // Write config to temp JSON file (safe — no shell injection)
        const configData = {
            validation_id: validation.id,
            idea: trimmedIdea,
            user_id: user.id,
        };
        const configPath = path.join(os.tmpdir(), `validate_${validation.id}.json`);
        fs.writeFileSync(configPath, JSON.stringify(configData));

        // Check concurrent process limit (user-level guard)
        if (!checkProcessLimit(user.id)) {
            return NextResponse.json({ error: "Too many active processes — please wait" }, { status: 429 });
        }

        trackProcess(user.id);

        // ── Spawn the validation process directly ──
        const { spawn } = await import("child_process");
        const projectRoot = path.resolve(process.cwd(), "..");
        const env = {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
            SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
            SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
            SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
            AI_ENCRYPTION_KEY: process.env.AI_ENCRYPTION_KEY || "",
        };

        console.log(`[Validate] Spawning: python validate_idea.py --config-file "${configPath}"`);
        console.log(`[Validate] CWD: ${projectRoot}`);

        const child = spawn("python", ["validate_idea.py", "--config-file", configPath], {
            cwd: projectRoot,
            env,
            stdio: ["ignore", "pipe", "pipe"],
            detached: false,
        });

        const userId = user.id;
        const valId = validation.id;

        child.stdout?.on("data", (data: Buffer) => {
            console.log(`[Validate ${valId}] ${data.toString().trim()}`);
        });

        child.stderr?.on("data", (data: Buffer) => {
            console.error(`[Validate ${valId} ERR] ${data.toString().trim()}`);
        });

        child.on("error", (err) => {
            console.error(`[Validate ${valId}] Spawn error:`, err.message);
            releaseProcess(userId);
            // Mark as failed in Supabase
            fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/idea_validations?id=eq.${valId}`, {
                method: "PATCH",
                headers: {
                    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
                    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""}`,
                    "Content-Type": "application/json",
                    Prefer: "return=minimal",
                },
                body: JSON.stringify({ status: "failed", report: JSON.stringify({ error: err.message }) }),
            }).catch(() => {});
        });

        child.on("close", (code) => {
            console.log(`[Validate ${valId}] Process exited with code ${code}`);
            releaseProcess(userId);
            try { fs.unlinkSync(configPath); } catch { }
        });

        return NextResponse.json({ validationId: validation.id, status: "queued" });
    } catch (err) {
        console.error("Validate POST error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// GET — list user's validations
export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { data: validations } = await supabase
            .from("idea_validations")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(20);

        return NextResponse.json({ validations: validations || [] });
    } catch {
        return NextResponse.json({ validations: [] });
    }
}
