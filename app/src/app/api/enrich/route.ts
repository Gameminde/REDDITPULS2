import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase-server";
import path from "path";
import fs from "fs";
import os from "os";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";
const supabase = createClient(supabaseUrl, supabaseKey);

// ── Rate Limiting ──
const enrichTimestamps = new Map<string, number[]>();
const MAX_ENRICHMENTS_PER_HOUR = 3;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const hourAgo = now - 3600_000;
  const stamps = (enrichTimestamps.get(userId) || []).filter(t => t > hourAgo);
  if (stamps.length >= MAX_ENRICHMENTS_PER_HOUR) return false;
  stamps.push(now);
  enrichTimestamps.set(userId, stamps);
  return true;
}

// ── Input Validation ──
const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,100}$/;

/**
 * GET /api/enrich?slug=invoice-automation
 * Returns cached enrichment data if fresh, or { status: "pending" } if not.
 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "Missing slug parameter" }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from("enrichment_cache")
      .select("*")
      .eq("topic_slug", slug)
      .maybeSingle();

    if (error) {
      console.error("Enrichment cache query error:", error);
      return NextResponse.json({ status: "pending", slug });
    }

    if (!data) {
      return NextResponse.json({ status: "pending", slug });
    }

    // Check if expired
    const expiresAt = new Date(data.expires_at);
    if (expiresAt < new Date()) {
      return NextResponse.json({ status: "expired", slug });
    }

    // Parse JSON fields
    const parseJson = (val: unknown) => {
      if (typeof val === "string") {
        try { return JSON.parse(val); } catch { return []; }
      }
      return val || [];
    };

    return NextResponse.json({
      status: data.status || "done",
      slug: data.topic_slug,
      topic_name: data.topic_name,
      stackoverflow: {
        questions: parseJson(data.so_questions),
        total: data.so_total || 0,
        top_tags: parseJson(data.so_top_tags),
      },
      github: {
        issues: parseJson(data.gh_issues),
        total: data.gh_total || 0,
        top_repos: parseJson(data.gh_top_repos),
      },
      confirmed_gaps: parseJson(data.confirmed_gaps),
      enriched_at: data.enriched_at,
      cached: true,
    });
  } catch (err) {
    console.error("Enrichment GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/enrich
 * Body: { slug: "invoice-automation", topic_name: "Invoice Automation", keywords: [...] }
 * Triggers enrichment in background and returns immediately.
 *
 * SECURITY: Uses spawn() + config-file pattern (no shell interpolation).
 */
export async function POST(req: NextRequest) {
  try {
    // Auth check — only logged-in users can trigger enrichment
    const authClient = await createAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit
    if (!checkRateLimit(user.id)) {
      return NextResponse.json(
        { error: "Rate limit exceeded — max 3 enrichments per hour" },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { slug, topic_name, keywords, force } = body;

    if (!slug || typeof slug !== "string") {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
    }

    // Validate slug format (alphanumeric + hyphens only — blocks injection)
    if (!SAFE_SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: "Invalid slug format — use lowercase letters, numbers, and hyphens only" },
        { status: 400 }
      );
    }

    // Validate keywords if provided
    if (keywords && (!Array.isArray(keywords) || keywords.some((k: unknown) => typeof k !== "string"))) {
      return NextResponse.json({ error: "Keywords must be an array of strings" }, { status: 400 });
    }

    // Check if we already have fresh data (unless force refresh)
    if (!force) {
      const { data: cached } = await supabase
        .from("enrichment_cache")
        .select("status, expires_at")
        .eq("topic_slug", slug)
        .maybeSingle();

      if (cached) {
        const expiresAt = new Date(cached.expires_at);
        if (expiresAt > new Date() && cached.status === "done") {
          return NextResponse.json({
            status: "cached",
            message: "Fresh enrichment data already available",
          });
        }

        // If already enriching, don't kick off another one
        if (cached.status === "enriching") {
          return NextResponse.json({
            status: "enriching",
            message: "Enrichment already in progress",
          });
        }
      }
    }

    // Mark as enriching
    await supabase
      .from("enrichment_cache")
      .upsert(
        {
          topic_slug: slug,
          topic_name: topic_name || slug.replace(/-/g, " "),
          status: "enriching",
          enriched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "topic_slug" }
      );

    // SAFE: Write config to temp JSON file (no shell interpolation)
    const configData = {
      slug,
      topic_name: topic_name || slug.replace(/-/g, " "),
      keywords: keywords || [],
      force: !!force,
    };
    const configPath = path.join(os.tmpdir(), `enrich_${slug}_${Date.now()}.json`);
    fs.writeFileSync(configPath, JSON.stringify(configData));

    // Launch Python enrichment via spawn (safe — no shell)
    const projectRoot = process.cwd().replace(/[/\\]app$/, "");
    const env = {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
    };

    const child = spawn("python", ["enrich_idea.py", "--config-file", configPath], {
      cwd: projectRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    child.stdout?.on("data", (data: Buffer) => {
      console.log(`[Enrich ${slug}] ${data.toString().trim()}`);
    });

    child.stderr?.on("data", (data: Buffer) => {
      console.error(`[Enrich ${slug} ERR] ${data.toString().trim()}`);
    });

    child.on("close", (code) => {
      // Clean up temp config file
      try { fs.unlinkSync(configPath); } catch { }

      if (code !== 0) {
        console.error(`[Enrich ${slug}] Process exited with code ${code}`);
        supabase
          .from("enrichment_cache")
          .update({ status: "error", error_message: `Process exited with code ${code}` })
          .eq("topic_slug", slug)
          .then(() => {});
      } else {
        console.log(`[Enrich ${slug}] Enrichment complete`);
      }
    });

    child.on("error", (err) => {
      try { fs.unlinkSync(configPath); } catch { }
      console.error(`[Enrich ${slug}] Spawn error:`, err.message);
      supabase
        .from("enrichment_cache")
        .update({ status: "error", error_message: err.message?.slice(0, 500) })
        .eq("topic_slug", slug)
        .then(() => {});
    });

    return NextResponse.json({
      status: "enriching",
      message: `Enrichment started for '${slug}'`,
    });
  } catch (err) {
    console.error("Enrichment POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
