import { createClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { checkProcessLimit, trackProcess, releaseProcess } from "@/lib/process-limiter";
import { checkPremium } from "@/lib/check-premium";

// ── Rate Limiting ──
const scanTimestamps = new Map<string, number[]>();
const MAX_SCANS_PER_HOUR = 5;

function checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3600_000;
    const timestamps = (scanTimestamps.get(userId) || []).filter(t => t > hourAgo);
    if (timestamps.length >= MAX_SCANS_PER_HOUR) return false;
    timestamps.push(now);
    scanTimestamps.set(userId, timestamps);
    return true;
}

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // Rate limit
        if (!checkRateLimit(user.id)) {
            return NextResponse.json({ error: "Rate limit exceeded — max 5 scans per hour" }, { status: 429 });
        }

        // Server-side premium check
        const { isPremium } = await checkPremium(supabase, user.id);
        if (!isPremium) {
            return NextResponse.json({ error: "Premium subscription required" }, { status: 403 });
        }

        const body = await req.json();
        const { keywords, duration } = body;

        if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
            return NextResponse.json({ error: "Keywords required" }, { status: 400 });
        }
        if (!["10min", "1h", "10h", "48h"].includes(duration)) {
            return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
        }

        // Create scan row in Supabase
        const { data: scan, error } = await supabase
            .from("scans")
            .insert({
                user_id: user.id,
                keywords,
                duration,
                status: "starting",
            })
            .select()
            .single();

        if (error) {
            console.error("Scan insert error:", error.code, error.message, error.details);
            return NextResponse.json({
                error: error.code === "42P01"
                    ? "Scans table not found — run schema_scans.sql in Supabase SQL Editor first!"
                    : error.message
            }, { status: 500 });
        }

        // SAFE: Write config to temp JSON file instead of passing via shell args
        const configData = {
            scan_id: scan.id,
            keywords: keywords,
            duration: duration,
            user_id: user.id,
        };
        const configPath = path.join(os.tmpdir(), `scan_${scan.id}.json`);
        fs.writeFileSync(configPath, JSON.stringify(configData));

        // Check concurrent process limit
        if (!checkProcessLimit(user.id)) {
            return NextResponse.json({ error: "Too many active processes — please wait" }, { status: 429 });
        }

        trackProcess(user.id);

        // Launch Python scan process with JSON config file (no shell injection)
        const projectRoot = path.resolve(process.cwd(), "..");
        const env = {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
            SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
            SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
            SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
            GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
            GROQ_API_KEY: process.env.GROQ_API_KEY || "",
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
            AI_ENCRYPTION_KEY: process.env.AI_ENCRYPTION_KEY || "",
        };

        const child = spawn("python", ["run_scan.py", "--config-file", configPath], {
            cwd: projectRoot,
            env,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdoutBuffer = "";
        let stderrBuffer = "";

        child.stdout.on("data", (chunk) => {
            stdoutBuffer += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            stderrBuffer += chunk.toString();
        });

        child.on("error", (error) => {
            releaseProcess(user.id);

            try { fs.unlinkSync(configPath); } catch { }
            console.error(`Scan ${scan.id} failed to start:`, error.message);
        });

        child.on("close", (code) => {
            releaseProcess(user.id);

            // Clean up temp config file
            try { fs.unlinkSync(configPath); } catch { }

            if (code !== 0) {
                console.error(`Scan ${scan.id} exited with code ${code}`);
                if (stderrBuffer) {
                    console.error(stderrBuffer);
                }
            }
            if (stdoutBuffer) {
                console.log(`Scan ${scan.id} output:`, stdoutBuffer);
            }
        });

        return NextResponse.json({ scanId: scan.id, status: "started" });
    } catch (err) {
        console.error("Scan POST error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// GET — list user's scans
export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { data: scans } = await supabase
            .from("scans")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(20);

        return NextResponse.json({ scans: scans || [] });
    } catch {
        return NextResponse.json({ scans: [] });
    }
}
