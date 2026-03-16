import path from "path";
import { spawn } from "child_process";
import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase-server";

export async function GET() {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectRoot = path.resolve(process.cwd(), "..");
    const env = {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
        SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
        SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    };

    try {
        const payload = await new Promise<{ brief: unknown; timeline: unknown }>((resolve, reject) => {
            const child = spawn("python", ["engine/morning_brief.py", "--user-id", user.id], {
                cwd: projectRoot,
                env,
                stdio: ["ignore", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";

            child.stdout?.on("data", (chunk: Buffer) => {
                stdout += chunk.toString();
            });

            child.stderr?.on("data", (chunk: Buffer) => {
                stderr += chunk.toString();
            });

            child.on("error", reject);

            child.on("close", (code) => {
                if (code !== 0) {
                    reject(new Error(stderr || `morning brief exited with code ${code}`));
                    return;
                }

                try {
                    const parsed = JSON.parse(stdout.trim() || "{}");
                    resolve({
                        brief: parsed.brief || null,
                        timeline: parsed.timeline || [],
                    });
                } catch (error) {
                    reject(error);
                }
            });
        });

        return NextResponse.json(payload);
    } catch (error) {
        console.error("[Digest] Failed to load morning brief:", error);
        return NextResponse.json({ error: "Could not load digest" }, { status: 500 });
    }
}
