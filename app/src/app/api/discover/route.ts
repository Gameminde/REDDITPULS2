import { createClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { checkProcessLimit, trackProcess, releaseProcess } from "@/lib/process-limiter";
import { checkPremium } from "@/lib/check-premium";
import { buildMarketIdeas } from "@/lib/market-feed";
import { extractScraperRunHealth } from "@/lib/scraper-run-health";

const discoverTimestamps = new Map<string, number[]>();
const MAX_DISCOVERS_PER_HOUR = 3;
const DISCOVERY_TIMEOUT_MS = 30 * 60 * 1000;

function getScraperExecutionMode() {
    return String(process.env.SCRAPER_EXECUTION_MODE || "local").toLowerCase() === "external"
        ? "external"
        : "local";
}

function checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3600_000;
    const stamps = (discoverTimestamps.get(userId) || []).filter((timestamp) => timestamp > hourAgo);
    if (stamps.length >= MAX_DISCOVERS_PER_HOUR) return false;
    stamps.push(now);
    discoverTimestamps.set(userId, stamps);
    return true;
}

export async function POST(req: NextRequest) {
    try {
        const executionMode = getScraperExecutionMode();
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        if (executionMode === "external") {
            return NextResponse.json({
                error: "External scraper worker mode is enabled on this host. Start the scraper from the VPS worker instead.",
                executionMode,
            }, { status: 409 });
        }

        if (!checkRateLimit(user.id)) {
            return NextResponse.json({ error: "Rate limit exceeded — max 3 discovery scans per hour" }, { status: 429 });
        }

        const { isPremium } = await checkPremium(supabase, user.id);
        if (!isPremium) {
            return NextResponse.json({ error: "Premium subscription required" }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const sources = body.sources || ["reddit", "hackernews", "producthunt", "indiehackers"];
        const validSources = sources.filter((source: string) =>
            ["reddit", "hackernews", "producthunt", "indiehackers"].includes(source),
        );

        if (!checkProcessLimit(user.id)) {
            return NextResponse.json({ error: "Too many active processes — please wait" }, { status: 429 });
        }

        trackProcess(user.id);

        const projectRoot = path.resolve(process.cwd(), "..");

        const env = {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
            SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
            SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
            SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
        };

        const child = spawn("python", ["scraper_job.py", "--sources", ...validSources], {
            cwd: projectRoot,
            env,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdoutBuffer = "";
        let stderrBuffer = "";
        const timeout = setTimeout(() => {
            stderrBuffer += `\nDiscovery scan exceeded ${DISCOVERY_TIMEOUT_MS / 60000} minutes and was terminated.`;
            child.kill();
        }, DISCOVERY_TIMEOUT_MS);

        child.stdout.on("data", (chunk) => {
            stdoutBuffer = `${stdoutBuffer}${chunk.toString()}`.slice(-4000);
        });

        child.stderr.on("data", (chunk) => {
            stderrBuffer = `${stderrBuffer}${chunk.toString()}`.slice(-4000);
        });

        child.on("error", (error) => {
            clearTimeout(timeout);
            releaseProcess(user.id);
            console.error("Discovery scan spawn error:", error.message);
        });

        child.on("close", (code, signal) => {
            clearTimeout(timeout);
            releaseProcess(user.id);
            if (code !== 0) {
                console.error("Discovery scan error:", `code=${code} signal=${signal}`);
                if (stderrBuffer) {
                    console.error(stderrBuffer);
                }
            }
            if (stdoutBuffer) {
                console.log("Discovery scan output:", stdoutBuffer);
            }
        });

        return NextResponse.json({ status: "started", sources: validSources });
    } catch (error) {
        console.error("Discover POST error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function GET() {
    try {
        const executionMode = getScraperExecutionMode();
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { data: runs } = await supabase
            .from("scraper_runs")
            .select("*")
            .order("started_at", { ascending: false })
            .limit(1);

        const latestRun = (runs?.[0] || null) as Record<string, unknown> | null;

        const { data: ideaRows } = await supabase
            .from("ideas")
            .select("*")
            .neq("confidence_level", "INSUFFICIENT");

        const visibleIdeas = buildMarketIdeas((ideaRows || []) as Array<Record<string, unknown>>, {
            includeExploratory: false,
        });
        const archiveIdeas = buildMarketIdeas((ideaRows || []) as Array<Record<string, unknown>>, {
            includeExploratory: true,
        });

        const trackedPostCount = visibleIdeas.reduce((sum, row) => sum + Number(row.post_count_total || 0), 0);
        const archiveIdeaCount = archiveIdeas.length;

        const { count: archivePostCount } = await supabase
            .from("posts")
            .select("*", { count: "exact", head: true });

        return NextResponse.json({
            latestRun,
            ideaCount: visibleIdeas.length,
            trackedPostCount,
            archiveIdeaCount,
            archivePostCount: archivePostCount || 0,
            executionMode,
            ...extractScraperRunHealth(latestRun),
        });
    } catch {
        return NextResponse.json({
            latestRun: null,
            ideaCount: 0,
            trackedPostCount: 0,
            archiveIdeaCount: 0,
            archivePostCount: 0,
            executionMode: getScraperExecutionMode(),
            healthy_sources: [],
            degraded_sources: [],
            run_health: "failed",
            runner_label: null,
            reddit_access_mode: "unknown",
            reddit_post_count: 0,
            reddit_successful_requests: 0,
            reddit_failed_requests: 0,
            reddit_degraded_reason: null,
        });
    }
}
