import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// GET /api/graveyard — list all public reports or get one by slug
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");

  if (slug) {
    // Single report by slug
    const { data, error } = await supabase
      .from("graveyard_reports")
      .select("*")
      .eq("slug", slug)
      .eq("is_public", true)
      .single();

    if (error || !data) {
      return NextResponse.json({ report: null }, { status: 404 });
    }
    return NextResponse.json({ report: data });
  }

  // List all public reports
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "100");
  const { data, error } = await supabase
    .from("graveyard_reports")
    .select("*")
    .eq("is_public", true)
    .order("generated_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reports: data || [] });
}
