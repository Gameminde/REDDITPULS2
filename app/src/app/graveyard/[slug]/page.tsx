"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Skull, AlertTriangle, TrendingDown, Shield, ArrowLeft, ArrowRight, Lightbulb } from "lucide-react";

interface GraveyardReport {
  id: string;
  slug: string;
  idea_text: string;
  verdict: string;
  confidence: number;
  pain_level: string;
  competition_tier: string;
  evidence_summary: string;
  top_posts: string; // JSON string
  generated_at: string;
}

export default function GraveyardReport() {
  const params = useParams();
  const slug = params.slug as string;
  const [report, setReport] = useState<GraveyardReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/graveyard?slug=${slug}`)
      .then((r) => r.json())
      .then((data) => setReport(data.report || null))
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-400">
        <AlertTriangle className="w-12 h-12 mb-4 opacity-30" />
        <p className="text-lg">Report not found</p>
        <Link href="/graveyard" className="text-purple-400 mt-4 hover:underline">
          ← Back to Graveyard
        </Link>
      </div>
    );
  }

  let topPosts: { common_failure_reasons?: string[]; better_angle?: string } = {};
  try {
    topPosts = typeof report.top_posts === "string" ? JSON.parse(report.top_posts) : report.top_posts || {};
  } catch {
    topPosts = {};
  }

  const verdictColor =
    report.verdict === "DON'T BUILD"
      ? "text-red-400 bg-red-500/10 border-red-500/30"
      : report.verdict === "RISKY"
      ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
      : "text-green-400 bg-green-500/10 border-green-500/30";

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950">
        <div className="max-w-3xl mx-auto px-4 py-12">
          <Link
            href="/graveyard"
            className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-purple-400 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Graveyard
          </Link>

          <div className="flex items-center gap-3 mb-4">
            <Skull className="w-6 h-6 text-red-400" />
            <span className={`text-sm font-medium px-3 py-1 rounded-lg border ${verdictColor}`}>
              {report.verdict}
            </span>
            <span className="text-sm text-zinc-500">{report.confidence}% confidence</span>
          </div>

          <h1 className="text-3xl font-bold mb-4">{report.idea_text}</h1>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
            <div className="text-xs text-zinc-500 mb-1">Pain Level</div>
            <div className="text-lg font-bold flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              {report.pain_level}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800">
            <div className="text-xs text-zinc-500 mb-1">Competition</div>
            <div className="text-lg font-bold flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />
              {report.competition_tier}
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="p-6 rounded-xl bg-zinc-900/50 border border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Why This Idea Typically Fails
          </h2>
          <p className="text-zinc-300 leading-relaxed">{report.evidence_summary}</p>
        </div>

        {/* Failure Reasons */}
        {topPosts.common_failure_reasons && topPosts.common_failure_reasons.length > 0 && (
          <div className="p-6 rounded-xl bg-zinc-900/50 border border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
              Common Failure Reasons
            </h2>
            <div className="space-y-3">
              {topPosts.common_failure_reasons.map((reason, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-1 w-5 h-5 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-xs text-red-400">
                    {i + 1}
                  </div>
                  <p className="text-sm text-zinc-300">{reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Better Angle */}
        {topPosts.better_angle && (
          <div className="p-6 rounded-xl bg-purple-500/5 border border-purple-500/20">
            <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Lightbulb className="w-4 h-4" />
              The Twist That Could Work
            </h2>
            <p className="text-zinc-300 leading-relaxed">{topPosts.better_angle}</p>
          </div>
        )}

        {/* CTA */}
        <div className="text-center p-8 rounded-2xl bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20">
          <h2 className="text-xl font-bold mb-2">
            Think your version is different?
          </h2>
          <p className="text-zinc-400 mb-4">
            Get a personalized validation with your specific angle, market data, and competitor analysis.
          </p>
          <Link
            href="/dashboard/validate"
            className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-colors"
          >
            Validate Your Version <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
