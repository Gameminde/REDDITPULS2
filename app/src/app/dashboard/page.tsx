import type { Metadata } from "next";
import StockMarketDashboard, { type Idea, type MarketIntelligencePayload } from "./StockMarket";
import { createAdmin } from "@/lib/supabase-admin";
import { loadMarketSnapshot } from "@/lib/market-snapshot";

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
  try {
    const snapshot = await loadMarketSnapshot(admin);
    const initialIdeas = snapshot.userVisibleIdeas.slice(0, 120) as unknown as Idea[];
    const intelligence: MarketIntelligencePayload = {
      summary: {
        generated_at: new Date().toISOString(),
        ...snapshot.sourceHealth,
        raw_idea_count: snapshot.rawIdeaCount,
        feed_visible_count: snapshot.userVisibleIdeas.length,
        new_72h_count: snapshot.new72hCount,
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
        rising: snapshot.userVisibleIdeas.filter((idea) => idea.trend_direction === "rising").length,
        falling: snapshot.userVisibleIdeas.filter((idea) => idea.trend_direction === "falling").length,
      },
    };
  } catch {
    return {
      ideas: [] as Idea[],
      intelligence: null as MarketIntelligencePayload | null,
      trendCounts: { rising: 0, falling: 0 },
    };
  }
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
