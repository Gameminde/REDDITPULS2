import { createClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { checkProcessLimit, trackProcess, releaseProcess } from "@/lib/process-limiter";
import { checkPremium } from "@/lib/check-premium";

// POST /api/scan/[id]/report — generate AI report (SAFE: no inline Python)
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Server-side premium check
    const { isPremium } = await checkPremium(supabase, user.id);
    if (!isPremium) {
        return NextResponse.json({ error: "Premium subscription required" }, { status: 403 });
    }

    // Verify scan belongs to user
    const { data: scan } = await supabase
        .from("scans")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();

    if (!scan) return NextResponse.json({ error: "Scan not found" }, { status: 404 });

    // Check concurrent process limit
    if (!checkProcessLimit(user.id)) {
        return NextResponse.json({ error: "Too many active processes — please wait" }, { status: 429 });
    }

    // Get analysis results (with user_id defense-in-depth)
    const { data: results } = await supabase
        .from("ai_analysis")
        .select("*")
        .eq("scan_id", id);

    // Get posts
    const { data: posts } = await supabase
        .from("posts")
        .select("*")
        .eq("scan_id", id)
        .limit(100);

    // SAFE: Write data to temp JSON file, call Python script with --config-file
    const configData = {
        scan: scan,
        results: results || [],
        posts: (posts || []).slice(0, 50),
        user_id: user.id,
    };
    const configPath = path.join(os.tmpdir(), `report_${id}_${Date.now()}.json`);
    fs.writeFileSync(configPath, JSON.stringify(configData));

    const projectRoot = path.resolve(process.cwd(), "..");

    trackProcess(user.id);

    return new Promise<Response>((resolve) => {
        const env = {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
            GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
            GROQ_API_KEY: process.env.GROQ_API_KEY || "",
            OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
            AI_ENCRYPTION_KEY: process.env.AI_ENCRYPTION_KEY || "",
            SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
            SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
        };

        const cmd = `python generate_report.py --config-file "${configPath}"`;

        exec(cmd, { cwd: projectRoot, env, timeout: 120000 }, (error, stdout, stderr) => {
            releaseProcess(user.id);

            // Clean up temp file
            try { fs.unlinkSync(configPath); } catch { }

            if (error) {
                console.error("Report error:", error.message);
                resolve(NextResponse.json({ error: "Report generation failed" }, { status: 500 }));
                return;
            }
            try {
                const report = JSON.parse(stdout.trim());
                resolve(NextResponse.json({ report }));
            } catch {
                console.error("Failed to parse report output");
                resolve(NextResponse.json({ error: "Report generation failed" }, { status: 500 }));
            }
        });
    });
}
