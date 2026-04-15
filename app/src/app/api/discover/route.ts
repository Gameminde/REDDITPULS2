import { createClient } from "@/lib/supabase-server";
import { createAdmin } from "@/lib/supabase-admin";
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { checkProcessLimit, trackProcess, releaseProcess } from "@/lib/process-limiter";
import { checkPremium } from "@/lib/check-premium";
import { consumeDurableRateLimit } from "@/lib/durable-rate-limit";
import { loadMarketSnapshot } from "@/lib/market-snapshot";

const MAX_DISCOVERS_PER_HOUR = 3;
const DISCOVERY_TIMEOUT_MS = 30 * 60 * 1000;

function getScraperExecutionMode() {
    return String(process.env.SCRAPER_EXECUTION_MODE || "local").toLowerCase() === "external"
        ? "external"
        : "local";
}

export async function POST(req: NextRequest) {
    try {
        const executionMode = getScraperExecutionMode();
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        if (executionMode === "external") {
            return NextResponse.json({
                error: "Market updates run automatically in this environment.",
                executionMode,
            }, { status: 409 });
        }

        const rateLimit = await consumeDurableRateLimit({
            userId: user.id,
            scope: "discover",
            limit: MAX_DISCOVERS_PER_HOUR,
        });

        if (!rateLimit.allowed) {
            return NextResponse.json({ error: "Rate limit exceeded - max 3 discovery scans per hour" }, { status: 429 });
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
            return NextResponse.json({ error: "Too many active processes - please wait" }, { status: 429 });
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
        const admin = createAdmin();
        const snapshot = await loadMarketSnapshot(admin);

        const [{ count: archivePostCount }, { count: archiveIdeaCount }] = await Promise.all([
            admin
                .from("posts")
                .select("*", { count: "exact", head: true }),
            admin
                .from("ideas")
                .select("*", { count: "exact", head: true })
                .neq("confidence_level", "INSUFFICIENT"),
        ]);

        return NextResponse.json({
            latestRun: snapshot.latestRun,
            ideaCount: snapshot.userVisibleIdeas.length,
            trackedPostCount: snapshot.trackedPostCount,
            archiveIdeaCount: archiveIdeaCount || snapshot.userArchiveIdeas.length,
            archivePostCount: archivePostCount || 0,
            evidenceAttachedCount: snapshot.evidenceAttachedCount,
            lastObservedAt: snapshot.lastObservedAt,
            funnel: {
                rawPostsAnalyzed: snapshot.funnel?.scraped_posts || archivePostCount || 0,
                candidateOpportunities: snapshot.funnel?.final_ideas || archiveIdeaCount || snapshot.userArchiveIdeas.length,
                visibleOnBoard: snapshot.userVisibleIdeas.length,
                evidenceAttached: snapshot.evidenceAttachedCount,
            },
            executionMode,
            ...snapshot.sourceHealth,
        });
    } catch {
        return NextResponse.json({
            latestRun: null,
            ideaCount: 0,
            trackedPostCount: 0,
            archiveIdeaCount: 0,
            archivePostCount: 0,
            evidenceAttachedCount: 0,
            lastObservedAt: null,
            funnel: null,
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
