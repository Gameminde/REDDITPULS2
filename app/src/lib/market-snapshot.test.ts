import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketSnapshotFromRows } from "@/lib/market-snapshot";

function baseIdea(overrides: Record<string, unknown>) {
    return {
        id: "idea-base",
        topic: "Async invoice reminders for freelancers",
        slug: "async-invoice-reminders",
        category: "finance",
        pain_summary: "Freelancers keep complaining about manual follow-up on unpaid invoices.",
        current_score: 58,
        confidence_level: "MEDIUM",
        post_count_total: 12,
        post_count_24h: 2,
        post_count_7d: 5,
        source_count: 2,
        sources: [
            { platform: "reddit", count: 8 },
            { platform: "hackernews", count: 4 },
        ],
        top_posts: [
            {
                title: "Freelancers hate chasing invoices every month",
                source: "reddit",
                source_name: "reddit",
                subreddit: "freelance",
                score: 42,
                comments: 9,
                signal_kind: "complaint",
                directness_tier: "direct",
            },
            {
                title: "Need a calmer workflow for client payment reminders",
                source: "hackernews",
                source_name: "hackernews",
                score: 19,
                comments: 4,
                signal_kind: "feature_request",
                directness_tier: "adjacent",
            },
        ],
        keywords: ["invoice reminders", "late payments", "freelancers"],
        first_seen: new Date(Date.now() - 6 * 3600000).toISOString(),
        last_updated: new Date().toISOString(),
        ...overrides,
    };
}

test("market snapshot keeps one canonical view of user-visible and admin-visible ideas", () => {
    const rows = [
        baseIdea({ id: "visible-idea", slug: "visible-idea" }),
        baseIdea({
            id: "needs-wedge",
            topic: "Payroll automation",
            slug: "dyn-payroll-automation",
            category: "ops",
            top_posts: [
                {
                    title: "Payroll automation tools are still too generic for this workflow",
                    source: "reddit",
                    source_name: "reddit",
                    subreddit: "entrepreneur",
                    score: 16,
                    comments: 5,
                    signal_kind: "complaint",
                    directness_tier: "direct",
                },
            ],
            keywords: ["automation", "workflow", "ops", "pain", "generic", "tools", "manual", "teams", "small business"],
        }),
        baseIdea({
            id: "suppressed-idea",
            topic: "Pain signals from productivity",
            slug: "sub-productivity",
            category: "ops",
            source_count: 1,
            sources: [{ platform: "reddit", count: 7 }],
            post_count_total: 7,
            post_count_7d: 2,
            keywords: ["productivity"],
        }),
    ];

    const latestRun = {
        status: "degraded",
        source: "reddit,hackernews",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_text: "Source health: healthy=hackernews; degraded=reddit | Reddit health: mode=provider_api; posts=12; success=3; failed=1; reason=quota | Run metadata: caller=vps_timer",
    };

    const snapshot = buildMarketSnapshotFromRows(rows, latestRun);
    assert.equal(snapshot.rawIdeaCount, 3);
    assert.equal(snapshot.userVisibleIdeas.length, 1);
    assert.equal(snapshot.adminIdeas.length, 2);
    assert.equal(snapshot.sourceHealth.run_health, "degraded");

    const broadTheme = snapshot.hydratedIdeas.find((idea) => idea.id === "needs-wedge");
    assert.ok(broadTheme);
    assert.equal(broadTheme?.visibility_explanation.coarse_classification.market_status, "needs_wedge");
    assert.equal(broadTheme?.visibility_explanation.final_surface.user_visible, false);
    assert.equal(broadTheme?.visibility_explanation.final_surface.admin_visible, true);

    const opsLane = buildMarketSnapshotFromRows(rows, latestRun, { category: "ops" });
    assert.equal(opsLane.rawIdeaCount, 2);
    assert.equal(opsLane.laneUserVisibleIdeas.length, 0);
    assert.equal(opsLane.laneAdminIdeas.length, 1);
});
