import type { Metadata } from "next";
import StockMarketDashboard, { type Idea, type MarketIntelligencePayload } from "./StockMarket";
import { createAdmin } from "@/lib/supabase-admin";
import { buildMarketIdeas } from "@/lib/market-feed";

export const metadata: Metadata = {
  title: "Opportunity Radar",
  description: "Browse live startup opportunities shaped from repeated public pain across Reddit, Hacker News, Product Hunt, Indie Hackers, GitHub Issues, reviews, and hiring signals.",
  alternates: {
    canonical: "/dashboard",
  },
  openGraph: {
    title: "CueIdea Opportunity Radar",
    description: "See live startup opportunities shaped from repeated public pain before you build.",
    url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://cueidea.me"}/dashboard`,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "CueIdea Opportunity Radar",
    description: "See live startup opportunities shaped from repeated public pain before you build.",
  },
};

async function getInitialDashboardData() {
  const admin = createAdmin();
  const { data, error } = await admin
    .from("ideas")
    .select("*")
    .neq("confidence_level", "INSUFFICIENT")
    .order("current_score", { ascending: false })
    .limit(500);

  if (error || !data) {
    return {
      ideas: [] as Idea[],
      intelligence: null as MarketIntelligencePayload | null,
      trendCounts: { rising: 0, falling: 0 },
    };
  }

  const visibleIdeas = buildMarketIdeas(data as Array<Record<string, unknown>>, {
    includeExploratory: false,
    surface: "user",
  }) as unknown as Idea[];

  const initialIdeas = visibleIdeas.slice(0, 120);
  const new72hCount = visibleIdeas.filter((idea) => {
    const firstSeen = Date.parse(String(idea.first_seen || ""));
    return Number.isFinite(firstSeen) && Date.now() - firstSeen <= 72 * 3600000;
  }).length;

  const intelligence: MarketIntelligencePayload = {
    summary: {
      generated_at: new Date().toISOString(),
      run_health: "healthy",
      healthy_sources: [],
      degraded_sources: [],
      raw_idea_count: visibleIdeas.length,
      feed_visible_count: visibleIdeas.length,
      new_72h_count: new72hCount,
      emerging_wedge_count: 0,
    },
    emerging_wedges: [],
    themes_to_shape: [],
    competitor_pressure: [],
  };

  return {
    ideas: initialIdeas,
    intelligence,
    trendCounts: {
      rising: visibleIdeas.filter((idea) => idea.trend_direction === "rising").length,
      falling: visibleIdeas.filter((idea) => idea.trend_direction === "falling").length,
    },
  };
}

export default async function DashboardPage() {
  const { ideas, intelligence, trendCounts } = await getInitialDashboardData();

  return (
    <StockMarketDashboard
      initialIdeas={ideas}
      initialMarketIntelligence={intelligence}
      initialTrendCounts={trendCounts}
    />
  );
}
