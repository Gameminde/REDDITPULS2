import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";
const supabase = createClient(supabaseUrl, supabaseKey);

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
 */
export async function POST(req: NextRequest) {
  try {
    // Auth check — only logged-in users can trigger enrichment
    const authClient = await createAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { slug, topic_name, keywords, force } = body;

    if (!slug) {
      return NextResponse.json({ error: "Missing slug" }, { status: 400 });
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

    // Build the command
    const keywordsArg = keywords ? `--keywords "${keywords.join(",")}"` : "";
    const forceArg = force ? "--force" : "";
    const cmd = `python enrich_idea.py "${slug}" ${keywordsArg} ${forceArg}`.trim();

    // Run enrichment in background
    const projectRoot = process.cwd().replace(/[/\\]app$/, "");
    exec(cmd, { cwd: projectRoot, timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Enrichment error for ${slug}:`, error.message);
        console.error("stderr:", stderr);
        // Mark as error
        supabase
          .from("enrichment_cache")
          .update({ status: "error", error_message: error.message?.slice(0, 500) })
          .eq("topic_slug", slug)
          .then(() => {});
      } else {
        console.log(`Enrichment complete for ${slug}:`, stdout.slice(-200));
      }
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
