"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Skull, TrendingDown, AlertTriangle, ArrowRight, Search } from "lucide-react";

interface GraveyardReport {
  id: string;
  slug: string;
  idea_text: string;
  verdict: string;
  confidence: number;
  pain_level: string;
  competition_tier: string;
  evidence_summary: string;
  generated_at: string;
}

export default function GraveyardDirectory() {
  const [reports, setReports] = useState<GraveyardReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch("/api/graveyard")
      .then((r) => r.json())
      .then((data) => setReports(data.reports || []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = reports.filter(
    (r) =>
      r.idea_text.toLowerCase().includes(filter.toLowerCase()) ||
      r.verdict.toLowerCase().includes(filter.toLowerCase())
  );

  const verdictColor = (v: string) => {
    if (v === "DON'T BUILD") return "text-red-400 bg-red-500/10 border-red-500/20";
    if (v === "RISKY") return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    return "text-green-400 bg-green-500/10 border-green-500/20";
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Hero */}
      <div className="border-b border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950">
        <div className="max-w-5xl mx-auto px-4 py-16 text-center">
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-2 bg-red-500/10 rounded-full border border-red-500/20">
            <Skull className="w-4 h-4 text-red-400" />
            <span className="text-sm text-red-300">Idea Graveyard</span>
          </div>
          <h1 className="text-4xl font-bold mb-4">
            Startup Ideas That Keep Failing
          </h1>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto mb-8">
            We pre-validated 50+ commonly pitched startup ideas with real market data.
            Check if your idea is here before you spend months building it.
          </p>

          {/* Search */}
          <div className="max-w-md mx-auto relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search ideas..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-5xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-zinc-500">
            <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg">
              {reports.length === 0
                ? "Graveyard is being populated... Run the seeder to generate reports."
                : "No matching ideas found"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((report) => (
              <Link
                key={report.id}
                href={`/graveyard/${report.slug}`}
                className="group p-5 rounded-xl bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 transition-all hover:shadow-lg hover:shadow-purple-500/5"
              >
                <div className="flex items-start justify-between mb-3">
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-md border ${verdictColor(
                      report.verdict
                    )}`}
                  >
                    {report.verdict}
                  </span>
                  <span className="text-xs text-zinc-500">{report.confidence}%</span>
                </div>
                <h3 className="text-sm font-medium text-zinc-200 mb-2 group-hover:text-purple-300 transition-colors">
                  {report.idea_text}
                </h3>
                <p className="text-xs text-zinc-500 line-clamp-2 mb-3">
                  {report.evidence_summary}
                </p>
                <div className="flex items-center gap-3 text-xs text-zinc-600">
                  <span className="flex items-center gap-1">
                    <TrendingDown className="w-3 h-3" />
                    Pain: {report.pain_level}
                  </span>
                  <span>Comp: {report.competition_tier}</span>
                </div>
                <div className="mt-3 flex items-center gap-1 text-xs text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  View full analysis <ArrowRight className="w-3 h-3" />
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="mt-16 text-center p-8 rounded-2xl bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20">
          <h2 className="text-xl font-bold mb-2">
            Your idea isn&apos;t here?
          </h2>
          <p className="text-zinc-400 mb-4">
            Get a full AI-powered validation with real market data, competitor analysis, and funding roadmap.
          </p>
          <Link
            href="/dashboard/validate"
            className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-colors"
          >
            Validate Your Idea <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
