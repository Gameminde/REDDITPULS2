import json
import sys
import time
import types

import scraper_job as market_scraper
import validate_idea as pipeline
from engine import keyword_scraper
from engine.competition import analyze_competition, competition_summary
from engine.multi_brain import MultiBrain


class StubBrain:
    def __init__(self, configs=None):
        self.configs = configs or pipeline._dummy_test_configs()

    def single_call(self, prompt, system_prompt, pinned_index=None):
        if "startup market research expert" in system_prompt:
            return json.dumps({
                "keywords": ["invoice automation", "freelance invoicing", "late payments", "payment reminders"],
                "colloquial_keywords": ["clients keep paying late", "hate chasing invoices", "need help getting paid"],
                "subreddits": ["freelance", "graphic_design", "smallbusiness"],
                "competitors": ["FreshBooks", "Wave", "Stripe Invoicing"],
                "audience": "Freelance designers and solo service businesses",
                "pain_hypothesis": "Getting paid is manual, awkward, and time-consuming",
                "search_queries": ["freelance invoice reminder", "late client payment"],
            })

        if "market signal extractor" in system_prompt.lower():
            return json.dumps({
                "pain_quotes": [
                    "I hate chasing invoices every month.",
                    "Clients keep paying late and it wrecks cash flow.",
                ],
                "wtp_signals": ["I'd pay for invoice reminders if it saved me time."],
                "competitor_mentions": ["FreshBooks", "Wave"],
                "key_insight": "Freelancers consistently complain about awkward payment follow-up.",
            })

        if "market research analyst" in system_prompt.lower():
            return json.dumps({
                "pain_validated": True,
                "pain_description": "Freelancers are frustrated by repeated invoice follow-ups and late payments.",
                "pain_frequency": "weekly",
                "pain_intensity": "HIGH",
                "willingness_to_pay": "Multiple posts indicate willingness to pay for less awkward payment reminders.",
                "market_timing": "GROWING",
                "tam_estimate": "Large global freelance market with recurring invoice pain.",
                "evidence": [
                    {
                        "post_title": "Clients keep paying late",
                        "source": "reddit",
                        "score": 42,
                        "what_it_proves": "Late payments are a repeated operational pain point.",
                    },
                    {
                        "post_title": "Need help chasing unpaid invoices",
                        "source": "reddit",
                        "score": 35,
                        "what_it_proves": "Founders actively seek alternatives for invoice follow-up.",
                    },
                ],
            })

        if "startup strategist" in system_prompt.lower():
            return json.dumps({
                "ideal_customer_profile": {
                    "primary_persona": "Freelance designer juggling multiple client invoices",
                    "demographics": "Solo operators, 25-45, remote-first",
                    "psychographics": "Values cash flow, hates awkward collection conversations",
                    "specific_communities": [{"name": "r/freelance", "subscribers": "300000", "relevance": "PRIMARY"}],
                    "influencers_they_follow": ["Creative Boom"],
                    "tools_they_already_use": ["FreshBooks", "Wave"],
                    "buying_objections": ["Worried about trusting an automated reminder tool with clients"],
                    "previous_solutions_tried": ["Manual reminders", "FreshBooks automations"],
                    "day_in_the_life": "Sends invoices in the morning, follows up manually in the afternoon.",
                    "willingness_to_pay_evidence": ["Would pay to avoid awkward collections."],
                    "budget_range": "$15-$49/mo",
                    "buying_triggers": ["Late invoices", "Cash flow crunch"],
                },
                "competition_landscape": {
                    "market_saturation": "HIGH",
                    "total_products_found": 5,
                    "direct_competitors": [
                        {"name": "FreshBooks", "price": "$17/mo", "weakness": "Generic invoicing, weak follow-up UX"},
                        {"name": "Wave", "price": "Free", "weakness": "Limited reminder intelligence"},
                    ],
                    "indirect_competitors": ["Stripe Invoicing"],
                    "your_unfair_advantage": "Founder-friendly invoice follow-up workflows built around freelancer tone.",
                },
                "pricing_strategy": {
                    "recommended_model": "subscription",
                    "price_range": "$19-$39/mo",
                },
                "monetization_channels": [{"channel": "Subscription", "timeline": "Immediate"}],
            })

        if "startup launch advisor" in system_prompt.lower():
            return json.dumps({
                "launch_roadmap": [
                    {"step": "Build invoice reminder MVP"},
                    {"step": "Test with 10 freelancers"},
                    {"step": "Launch onboarding flow"},
                ],
                "revenue_projections": {
                    "month_1": {"mrr": "$190", "users": "50", "paying": "10"},
                    "month_6": {"mrr": "$950", "users": "250", "paying": "50"},
                },
                "risk_matrix": [
                    {"risk": "Clients dislike automated tone", "severity": "MEDIUM"},
                    {"risk": "Competition from invoicing suites", "severity": "HIGH"},
                ],
                "first_10_customers_strategy": {
                    "customers_1_3": {"tactic": "DM freelancers in communities"},
                },
                "mvp_features": ["Invoice reminders", "Payment status tracking"],
            })

        return json.dumps({"ok": True})

    def debate(self, prompt, system_prompt, on_progress=None, metadata=None):
        if on_progress:
            on_progress("debating", "Round 1: 3 models analyzing independently")
            on_progress("debating", "Round 2: Models debating with hidden scores")
        return {
            "verdict": "BUILD_IT",
            "confidence": 72,
            "executive_summary": "Strong buyer pain exists, but differentiation must stay focused on freelancer collections.",
            "summary": "Strong buyer pain exists, but differentiation must stay focused on freelancer collections.",
            "evidence": [
                {"title": "Clients keep paying late", "source": "reddit", "score": 42},
                {"title": "Need help chasing unpaid invoices", "source": "reddit", "score": 35},
            ],
            "evidence_count": 2,
            "risk_factors": ["Competition from invoicing suites"],
            "suggestions": ["Start with freelancers already using generic invoicing tools"],
            "action_plan": ["Launch reminder MVP"],
            "top_posts": [
                {"title": "Clients keep paying late", "source": "reddit", "score": 42},
            ],
            "top_unknowns": ["Churn after first successful invoice cycle"],
            "models_used": [
                "nvidia/test-bull-model",
                "nvidia/test-skeptic-model",
                "openrouter/test-analyst-model",
            ],
            "model_verdicts": {
                "nvidia/test-bull-model": {"verdict": "BUILD_IT", "role": "BULL"},
                "nvidia/test-skeptic-model": {"verdict": "RISKY", "role": "SKEPTIC"},
                "openrouter/test-analyst-model": {"verdict": "BUILD_IT", "role": "MARKET_ANALYST"},
            },
            "debate_mode": True,
            "debate_log": [
                {"model": "nvidia/test-bull-model", "role": "BULL", "round": 1, "verdict": "BUILD_IT", "confidence": 80, "reasoning": "Build it", "changed": False},
                {"model": "nvidia/test-skeptic-model", "role": "SKEPTIC", "round": 2, "verdict": "RISKY", "confidence": 60, "reasoning": "Risky", "changed": False},
            ],
            "debate_transcript": {
                "models": [
                    {"id": "test-bull", "provider": "nvidia", "role": "BULL"},
                    {"id": "test-skeptic", "provider": "nvidia", "role": "SKEPTIC"},
                    {"id": "test-analyst", "provider": "openrouter", "role": "MARKET_ANALYST"},
                ],
                "rounds": [
                    {
                        "round": 1,
                        "entries": [
                            {"model_id": "test-bull", "role": "BULL", "verdict": "BUILD_IT", "confidence": 80, "confidence_delta": 0, "held": True, "argument_text": "Freelancers hate chasing invoices.", "engagement_score": 0, "engagement_label": "Initial position"},
                        ],
                    },
                    {
                        "round": 2,
                        "entries": [
                            {"model_id": "test-skeptic", "role": "SKEPTIC", "verdict": "RISKY", "confidence": 60, "confidence_delta": 0, "held": True, "argument_text": "Still risky because incumbents exist.", "engagement_score": 1, "engagement_label": "Partial engagement (1/2 models)"},
                        ],
                    },
                ],
                "round2_summary": "One model changed its tone but not the final verdict.",
                "final": {
                    "verdict": "BUILD_IT",
                    "confidence": 72,
                    "weights": [
                        {"model_id": "test-bull", "role": "BULL", "weight": 1.2, "verdict": "BUILD_IT"},
                    ],
                    "dissent": {
                        "exists": True,
                        "dissenting_model_id": "test-skeptic",
                        "dissenting_role": "SKEPTIC",
                        "dissenting_verdict": "RISKY",
                        "dissent_reason": "Still risky because incumbents exist.",
                    },
                },
            },
        }


def _make_reddit_child(index, title, body, subreddit="freelance", score=10):
    return {
        "kind": "t3",
        "data": {
            "id": f"reddit-{index}",
            "title": title,
            "selftext": body,
            "score": score,
            "upvote_ratio": 0.9,
            "num_comments": 5 + index,
            "created_utc": 1710892800 + index,
            "subreddit": subreddit,
            "permalink": f"/r/{subreddit}/comments/{index}/example/",
            "author": f"user{index}",
            "url": f"https://reddit.com/r/{subreddit}/comments/{index}/example/",
        },
    }


def test_phase1_decomposition(load_user_configs):
    result = pipeline.run_phase1(
        "invoice chasing for freelancers",
        brain=StubBrain(load_user_configs()),
        test_mode=True,
    )
    assert result["keywords"] is not None
    assert len(result["keywords"]) >= 3
    assert result["subreddits"] is not None
    assert result["competitors"] is not None
    print(f"Phase 1: {len(result['keywords'])} keywords, {len(result['subreddits'])} subreddits")


def test_reddit_scraping(monkeypatch):
    start = time.time()

    monkeypatch.setattr(keyword_scraper.time, "sleep", lambda _: None)
    monkeypatch.setattr(keyword_scraper, "_select_subreddits", lambda keywords, forced_subreddits=None: ["freelance", "graphic_design"])
    monkeypatch.setattr(keyword_scraper, "search_reddit", lambda keywords, after="", limit=100: ([
        _make_reddit_child(1, "Freelancers need help chasing invoices", "Late client payments are a problem."),
        _make_reddit_child(2, "How do I automate invoice reminders?", "Looking for a better workflow."),
    ], ""))
    monkeypatch.setattr(keyword_scraper, "search_subreddit", lambda subreddit, keywords, after="", limit=100: ([
        _make_reddit_child(10, f"{subreddit} invoice reminder workflow", "Need help getting paid faster.", subreddit=subreddit, score=7),
    ], ""))

    fake_reddit_async = types.SimpleNamespace(AIOHTTP_AVAILABLE=False, scrape_all_async=lambda *args, **kwargs: [])
    fake_pullpush = types.SimpleNamespace(scrape_historical=lambda *args, **kwargs: [])
    monkeypatch.setitem(sys.modules, "reddit_async", fake_reddit_async)
    monkeypatch.setitem(sys.modules, "pullpush_scraper", fake_pullpush)

    posts = keyword_scraper.run_keyword_scan(
        ["invoice", "freelance payment"],
        duration="10min",
        min_keyword_matches=1,
    )
    elapsed = time.time() - start
    assert elapsed < 30, f"Reddit took {elapsed}s - too slow"
    assert len(posts) > 0, "Reddit returned 0 posts"
    print(f"Reddit: {len(posts)} posts in {elapsed:.1f}s")


def test_reddit_scraping_uses_provider_when_available(monkeypatch):
    monkeypatch.setattr(keyword_scraper.time, "sleep", lambda _: None)
    monkeypatch.setattr(keyword_scraper, "SCRAPECREATORS_IMPORTED", True)
    monkeypatch.setattr(keyword_scraper, "scrapecreators_available", lambda: True)
    monkeypatch.setattr(keyword_scraper, "PRAW_IMPORTED", False)
    monkeypatch.setattr(keyword_scraper, "praw_available", lambda: False)
    monkeypatch.setattr(
        keyword_scraper,
        "search_scrapecreators_posts",
        lambda keywords, selected_subreddits=None, forced_subreddits=None, idea_text="", max_posts=250: {
            "posts": [
                {
                    "id": "provider-1",
                    "external_id": "provider-1",
                    "title": "Freelancers hate chasing invoices",
                    "body": "Looking for a better payment reminder flow.",
                    "selftext": "Looking for a better payment reminder flow.",
                    "full_text": "Freelancers hate chasing invoices Looking for a better payment reminder flow.",
                    "score": 19,
                    "num_comments": 7,
                    "subreddit": "freelance",
                    "permalink": "https://reddit.com/r/freelance/comments/provider-1/example/",
                    "matched_keywords": ["invoice", "payment reminder"],
                    "source": "reddit",
                }
            ],
            "global_posts": [
                {
                    "title": "Freelancers hate chasing invoices",
                    "body": "Looking for a better payment reminder flow.",
                    "full_text": "Freelancers hate chasing invoices Looking for a better payment reminder flow.",
                    "score": 19,
                    "num_comments": 7,
                    "subreddit": "freelance",
                },
                {
                    "title": "My agency invoicing workflow is broken",
                    "body": "Need automation for reminders.",
                    "full_text": "My agency invoicing workflow is broken Need automation for reminders.",
                    "score": 11,
                    "num_comments": 5,
                    "subreddit": "agency",
                },
            ],
            "discovered_subreddits": ["agency"],
            "stats": {"mode": "provider_api"},
        },
    )

    result = keyword_scraper.run_keyword_scan(
        ["invoice", "payment reminder"],
        duration="10min",
        min_keyword_matches=1,
        return_metadata=True,
    )

    assert len(result["posts"]) == 1
    assert result["posts"][0]["external_id"] == "provider-1"
    assert "agency" in result["selected_subreddits"]
    assert "agency" in result["discovered_subreddits"]


def test_primary_filter(generate_mock_posts):
    mock_posts = generate_mock_posts(50)
    passed = pipeline.apply_primary_filter(mock_posts, "invoice freelance")
    pass_rate = len(passed) / len(mock_posts)
    assert 0.15 < pass_rate < 0.70, f"Filter pass rate {pass_rate:.0%} - out of range"
    print(f"Filter: {len(passed)}/50 passed ({pass_rate:.0%})")


def test_primary_filter_keeps_empty_when_no_relevant_signal():
    mock_posts = [
        {
            "id": "irrelevant-1",
            "external_id": "irrelevant-1",
            "title": "Funny meme thread",
            "selftext": "Nothing about buyer pain here.",
            "body": "Nothing about buyer pain here.",
            "full_text": "Funny meme thread. Nothing about buyer pain here.",
            "score": 12,
            "num_comments": 8,
            "created_utc": "2026-03-20T00:00:00+00:00",
            "subreddit": "funny",
            "source": "reddit",
            "permalink": "https://example.com/posts/irrelevant-1",
            "url": "https://example.com/posts/irrelevant-1",
            "matched_keywords": [],
        },
        {
            "id": "irrelevant-2",
            "external_id": "irrelevant-2",
            "title": "Gaming news thread",
            "selftext": "Totally unrelated discussion.",
            "body": "Totally unrelated discussion.",
            "full_text": "Gaming news thread. Totally unrelated discussion.",
            "score": 14,
            "num_comments": 12,
            "created_utc": "2026-03-20T00:00:00+00:00",
            "subreddit": "gaming",
            "source": "reddit",
            "permalink": "https://example.com/posts/irrelevant-2",
            "url": "https://example.com/posts/irrelevant-2",
            "matched_keywords": [],
        },
    ]
    filtered, diagnostics = pipeline.apply_primary_filter(
        mock_posts,
        "invoice freelance",
        return_diagnostics=True,
    )
    assert filtered == []
    assert diagnostics["final_filtered_count"] == 0
    assert diagnostics["fallback_mode"] == "no_relevant_posts"


def test_data_quality_counts_direct_from_filtered_corpus():
    direct_post = {
        "id": "churn-1",
        "external_id": "churn-1",
        "title": "Usage dropped and churn spiked for my tiny SaaS",
        "selftext": (
            "I run a small B2B SaaS and need an early warning when customers go cold "
            "before cancellation and renewal risk gets worse."
        ),
        "body": (
            "I run a small B2B SaaS and need an early warning when customers go cold "
            "before cancellation and renewal risk gets worse."
        ),
        "full_text": (
            "Usage dropped and churn spiked for my tiny SaaS. "
            "I need an early warning before cancellation and renewal risk gets worse."
        ),
        "score": 18,
        "num_comments": 11,
        "created_utc": "2026-03-20T00:00:00+00:00",
        "subreddit": "microsaas",
        "source": "reddit",
        "permalink": "https://example.com/posts/churn-1",
        "url": "https://example.com/posts/churn-1",
        "matched_keywords": ["churn", "saas"],
    }
    data_quality = pipeline._check_data_quality(
        posts=[direct_post],
        source_counts={"reddit": 1},
        pass1={"pain_validated": True, "evidence": []},
        pass2={"pricing_strategy": {}},
        pass3={"revenue_projections": {}},
        idea_text="Churn prediction tool for B2B SaaS under $1M ARR",
        keywords=["churn prediction", "saas churn analysis", "customer retention"],
        target_audience="B2B SaaS founders under $1M ARR",
        forced_subreddits=["saas", "microsaas", "customersuccess"],
        filtered_posts=[direct_post],
    )
    assert data_quality["direct_evidence_count"] >= 1


def test_compute_relevance_tier_demotes_show_hn_launch_posts():
    tier = pipeline.compute_relevance_tier(
        {
            "title": "Show HN: Validating DefendChurn - Early warning system for SaaS customer churn",
            "source": "hackernews",
            "what_it_proves": "Founders are discovering churn after it's too late to prevent it.",
            "body": "We are validating a churn startup for SaaS teams.",
        },
        "Early-warning retention alerts for tiny B2B SaaS teams",
        ["customer churn prediction", "SaaS retention tools", "customer health score"],
        "Solo founder or small team lead of a tiny B2B SaaS company",
        ["saas", "microsaas", "customersuccess"],
    )
    assert tier == "ADJACENT"


def test_compute_relevance_tier_demotes_generic_tooling_stack_posts():
    tier = pipeline.compute_relevance_tier(
        {
            "title": "Automation stack for a 3-person team",
            "source": "reddit",
            "subreddit": "saas",
            "what_it_proves": "Tiny B2B SaaS teams are actively seeking solutions to automate their processes.",
            "body": "Here are the tools we use across marketing, ops, and billing.",
        },
        "Early-warning retention alerts for tiny B2B SaaS teams",
        ["customer churn prediction", "SaaS retention tools", "customer health score"],
        "Solo founder or small team lead of a tiny B2B SaaS company",
        ["saas", "microsaas", "customersuccess"],
    )
    assert tier == "ADJACENT"


def test_compute_relevance_tier_keeps_first_person_retention_pain_direct():
    tier = pipeline.compute_relevance_tier(
        {
            "title": "Lost 3 customers to expired cards this month and I'm freaking out",
            "source": "reddit",
            "subreddit": "microsaas",
            "body": (
                "I run a tiny B2B SaaS and lost 3 customers after cards expired. "
                "I need an early warning alert before more customers churn."
            ),
            "what_it_proves": "Tiny B2B SaaS founders are losing customers because they find out about churn too late.",
        },
        "Early-warning retention alerts for tiny B2B SaaS teams",
        ["customer churn prediction", "SaaS retention tools", "customer health score"],
        "Solo founder or small team lead of a tiny B2B SaaS company",
        ["saas", "microsaas", "customersuccess"],
    )
    assert tier == "DIRECT"


def test_compute_relevance_tier_demotes_meta_tool_critique_posts():
    tier = pipeline.compute_relevance_tier(
        {
            "title": "Why Most Customer Health Scores Are Meaningless",
            "source": "reddit",
            "subreddit": "customersuccess",
            "what_it_proves": "Critique of existing health score systems used by customer success teams.",
            "body": "This post critiques the category, but it is not a first-person buyer pain report.",
        },
        "Early-warning retention alerts for tiny B2B SaaS teams",
        ["customer churn prediction", "SaaS retention tools", "customer health score"],
        "Solo founder or small team lead of a tiny B2B SaaS company",
        ["saas", "microsaas", "customersuccess"],
    )
    assert tier == "ADJACENT"


def test_market_top_posts_demote_launch_posts_below_buyer_pain():
    top_posts = market_scraper.build_top_posts_for_topic([
        {
            "title": "Show HN: DefendChurn - Early warning system for SaaS customer churn",
            "source": "hackernews",
            "score": 140,
            "num_comments": 36,
            "permalink": "https://news.ycombinator.com/item?id=1",
            "source_class": "community",
            "voice_type": "founder",
            "signal_kind": "launch_discussion",
            "directness_tier": "supporting",
        },
        {
            "title": "Lost 3 customers to expired cards this month and I'm freaking out",
            "source": "reddit",
            "subreddit": "microsaas",
            "score": 18,
            "num_comments": 9,
            "permalink": "https://reddit.com/r/microsaas/comments/abc",
            "source_class": "forum",
            "voice_type": "buyer",
            "signal_kind": "pain_point",
            "directness_tier": "direct",
        },
    ])

    assert top_posts[0]["title"] == "Lost 3 customers to expired cards this month and I'm freaking out"
    assert top_posts[0]["market_support_level"] == "evidence_backed"
    assert top_posts[1]["market_support_level"] == "hypothesis"


def test_market_confidence_caps_hn_launch_heavy_hypotheses():
    confidence = market_scraper.determine_confidence(
        post_count=9,
        source_count=1,
        pain_count=1,
        signal_contract={
            "support_level": "hypothesis",
            "buyer_native_direct_count": 0,
            "single_source": True,
            "hn_launch_heavy": True,
        },
    )
    assert confidence == "INSUFFICIENT"


def test_builder_launch_posts_need_stronger_topic_match():
    topics = market_scraper.classify_post_to_topics({
        "title": "Show HN: Refrax - my Arc Browser replacement I made from scratch",
        "body": "A browser project built from scratch with Rust and AI help.",
        "source": "hackernews",
        "signal_kind": "launch_discussion",
        "voice_type": "founder",
        "directness_tier": "supporting",
    })
    assert "project-management" not in topics
    assert "no-code-tools" not in topics


def test_dynamic_market_topics_promote_recurring_unmatched_phrase_clusters():
    unmatched_posts = [
        {
            "title": "Refund tracking between Stripe and Notion is a mess",
            "body": "I am frustrated manually reconciling refunds and chargebacks every week.",
            "source": "reddit",
            "subreddit": "shopify",
            "score": 18,
            "num_comments": 7,
            "permalink": "https://reddit.com/r/shopify/comments/refund-1",
            "voice_type": "buyer",
            "signal_kind": "complaint",
            "directness_tier": "direct",
        },
        {
            "title": "Anyone solved refund tracking for ops teams?",
            "body": "Still doing refund tracking across Stripe exports and support tools manually.",
            "source": "reddit",
            "subreddit": "smallbusiness",
            "score": 12,
            "num_comments": 4,
            "permalink": "https://reddit.com/r/smallbusiness/comments/refund-2",
            "voice_type": "operator",
            "signal_kind": "workaround",
            "directness_tier": "adjacent",
        },
    ]

    idea_posts, signal_posts, topic_meta, assigned_keys = market_scraper._discover_dynamic_market_topics(
        unmatched_posts,
        unmatched_posts,
    )

    assert len(idea_posts) == 1
    slug = next(iter(idea_posts.keys()))
    assert slug.startswith("dyn-refund-tracking")
    assert topic_meta[slug]["topic"] == "Refund Tracking"
    assert topic_meta[slug]["category"] in {"fintech", "ecommerce", "saas"}
    assert len(signal_posts[slug]) == 2
    assert len(assigned_keys) == 2


def test_market_score_promotes_buyer_native_evidence_quality():
    now = int(time.time())

    direct_posts = [
        {
            "title": "Our accounting team is drowning in invoice categorization",
            "full_text": "I hate manually cleaning invoice data every week and we need a better workflow.",
            "source": "reddit",
            "subreddit": "accounting",
            "score": 22,
            "num_comments": 10,
            "created_utc": now - 1800,
            "voice_type": "buyer",
            "signal_kind": "pain_point",
            "directness_tier": "direct",
            "source_class": "forum",
        },
        {
            "title": "Anyone else wasting hours reconciling supplier invoices?",
            "full_text": "Manual reconciliation is broken and my ops team is tired of this process.",
            "source": "reddit",
            "subreddit": "smallbusiness",
            "score": 19,
            "num_comments": 8,
            "created_utc": now - 2200,
            "voice_type": "operator",
            "signal_kind": "workaround",
            "directness_tier": "adjacent",
            "source_class": "forum",
        },
        {
            "title": "Finance ops keeps asking for better invoice coding automation",
            "full_text": "We would pay for software that reduces invoice coding errors.",
            "source": "indiehackers",
            "score": 16,
            "num_comments": 7,
            "created_utc": now - 2600,
            "voice_type": "buyer",
            "signal_kind": "willingness_to_pay",
            "directness_tier": "direct",
            "source_class": "review",
        },
    ]

    launch_posts = [
        {
            "title": "Show HN: AI accounting co-pilot for back offices",
            "full_text": "I built a new accounting copilot from scratch this weekend.",
            "source": "hackernews",
            "score": 24,
            "num_comments": 11,
            "created_utc": now - 1800,
            "voice_type": "founder",
            "signal_kind": "launch_discussion",
            "directness_tier": "supporting",
            "source_class": "forum",
        },
        {
            "title": "Ask HN: anyone building accounting automation for SMBs?",
            "full_text": "Curious if others are shipping this category right now.",
            "source": "hackernews",
            "score": 18,
            "num_comments": 9,
            "created_utc": now - 2200,
            "voice_type": "founder",
            "signal_kind": "launch_discussion",
            "directness_tier": "supporting",
            "source_class": "forum",
        },
        {
            "title": "Launch PH: bookkeeping copilot",
            "full_text": "New launch for founders doing finance workflows.",
            "source": "producthunt",
            "score": 20,
            "num_comments": 8,
            "created_utc": now - 2600,
            "voice_type": "founder",
            "signal_kind": "launch_discussion",
            "directness_tier": "supporting",
            "source_class": "forum",
        },
    ]

    buyer_score, buyer_breakdown = market_scraper.calculate_idea_score("accounting-automation", direct_posts)
    launch_score, launch_breakdown = market_scraper.calculate_idea_score("accounting-automation", launch_posts)

    assert buyer_breakdown["evidence_quality"] > launch_breakdown["evidence_quality"]
    assert buyer_score > launch_score


def test_market_leaders_extract_live_mentions_and_known_market_map():
    now = int(time.time())
    competition = market_scraper._build_market_leaders(
        "invoice-automation",
        "Invoice Automation",
        [
            {
                "title": "Need a QuickBooks alternative for invoice reminders",
                "full_text": "We're using QuickBooks today and hate the reminder workflow.",
                "source": "reddit",
                "subreddit": "smallbusiness",
                "score": 21,
                "num_comments": 9,
                "created_utc": now - 1200,
                "voice_type": "buyer",
                "signal_kind": "pain_point",
                "directness_tier": "direct",
            },
            {
                "title": "Switched from Xero back to QuickBooks because automation was weak",
                "full_text": "Comparing Xero and QuickBooks is taking too much time for our team.",
                "source": "indiehackers",
                "score": 15,
                "num_comments": 6,
                "created_utc": now - 2200,
                "voice_type": "operator",
                "signal_kind": "workaround",
                "directness_tier": "adjacent",
            },
        ],
        keywords=["invoice", "billing"],
    )

    assert competition is not None
    names = [entry["name"] for entry in competition["direct_competitors"]]
    assert "QuickBooks" in names
    assert "Xero" in names
    quickbooks = next(entry for entry in competition["direct_competitors"] if entry["name"] == "QuickBooks")
    assert quickbooks["mention_count"] >= 2
    assert competition["market_leaders_summary"]
    assert competition["extraction_method"] in {"live_mentions", "hybrid"}


def test_dynamic_market_topics_ignore_launch_only_clusters():
    idea_posts, signal_posts, topic_meta, assigned_keys = market_scraper._discover_dynamic_market_topics(
        [
            {
                "title": "Show HN: Browser workspace replacement built from scratch",
                "body": "A launch thread for a new browser workspace project.",
                "source": "hackernews",
                "score": 40,
                "num_comments": 11,
                "permalink": "https://news.ycombinator.com/item?id=launch-1",
                "voice_type": "founder",
                "signal_kind": "launch_discussion",
                "directness_tier": "supporting",
            },
            {
                "title": "Show HN: Another browser workspace project from scratch",
                "body": "Launching another tool for browser workspaces.",
                "source": "hackernews",
                "score": 28,
                "num_comments": 6,
                "permalink": "https://news.ycombinator.com/item?id=launch-2",
                "voice_type": "founder",
                "signal_kind": "launch_discussion",
                "directness_tier": "supporting",
            },
        ],
        [],
    )

    assert idea_posts == {}
    assert signal_posts == {}
    assert topic_meta == {}
    assert assigned_keys == set()


def test_bulk_upsert_rows_falls_back_to_individual_writes(monkeypatch):
    class FakeResponse:
        def __init__(self, status_code, text=""):
            self.status_code = status_code
            self.text = text

    calls = []

    def fake_sb_upsert(table, rows, on_conflict=""):
        calls.append((table, [row.get("slug") for row in rows], on_conflict))
        if len(rows) > 1:
            return FakeResponse(599, "timeout")
        if rows[0]["slug"] == "second":
            return FakeResponse(599, "still bad")
        return FakeResponse(200, "ok")

    monkeypatch.setattr(market_scraper, "sb_upsert", fake_sb_upsert)

    success_count, failure_ids = market_scraper._bulk_upsert_rows(
        "ideas",
        [{"slug": "first"}, {"slug": "second"}],
        on_conflict="slug",
        chunk_size=25,
        id_fn=lambda row: row["slug"],
    )

    assert success_count == 1
    assert failure_ids == ["second"]
    assert calls[0] == ("ideas", ["first", "second"], "slug")


def test_quality_guardrails_force_insufficient_on_zero_direct():
    verdict, confidence, notes = pipeline._apply_quality_verdict_guardrails(
        "BUILD IT",
        72,
        {
            "direct_evidence_count": 0,
            "adjacent_evidence_count": 9,
            "contradictions": [],
        },
        total_posts=12,
        pain_validated=True,
        adjacent_heavy=True,
        test_mode=False,
    )
    assert verdict == "INSUFFICIENT DATA"
    assert confidence == 25
    assert any("Zero direct evidence" in note for note in notes)


def test_problem_validity_labels_adjacent_heavy_runs_honestly():
    validity = pipeline._build_problem_validity(
        {"pain_validated": True},
        {
            "direct_evidence_count": 0,
            "adjacent_evidence_count": 12,
            "low_volume_context": False,
        },
        {
            "reddit": 8,
            "reddit_comment": 4,
            "hackernews": 20,
        },
        {},
        {
            "pain_quotes": [
                "We lost another customer.",
                "Usage dropped and I missed it.",
                "Retention is killing us.",
            ]
        },
    )
    assert validity["adjacent_heavy"] is True
    assert "adjacent buyer conversations" in validity["summary"].lower()


def test_quality_guardrails_soften_adjacent_heavy_dont_build():
    verdict, confidence, notes = pipeline._apply_quality_verdict_guardrails(
        "DON'T BUILD",
        38,
        {
            "direct_evidence_count": 4,
            "adjacent_evidence_count": 14,
            "contradictions": [],
        },
        total_posts=24,
        pain_validated=True,
        adjacent_heavy=True,
        test_mode=False,
    )
    assert verdict == "RISKY"
    assert confidence == 38
    assert any("softened from DON'T BUILD to RISKY" in note for note in notes)


def test_claim_contract_marks_problem_as_evidence_backed_and_pricing_as_hypothesis_without_wtp():
    report = {
        "problem_validity": {
            "label": "MODERATE",
            "score": 72,
            "summary": "Repeated buyer pain is visible across buyer-native sources.",
            "buyer_source_count": 2,
        },
        "business_validity": {
            "label": "MODERATE",
            "score": 64,
            "summary": "Business context is credible.",
            "wtp_signals_found": 0,
            "job_signals_found": 3,
            "review_signals_found": 0,
            "competitor_count": 2,
        },
        "pricing_strategy": {
            "recommended_model": "subscription",
            "price_range": "$50-$200/mo",
        },
        "ideal_customer_profile": {
            "primary_persona": "Tiny B2B SaaS founder",
            "budget_range": "$50-$200/mo",
        },
        "competition_landscape": {
            "market_saturation": "COMPETITIVE",
            "direct_competitors": [{"name": "ChurnZero"}, {"name": "Totango"}],
        },
    }
    claim_contract = pipeline._build_claim_contract(
        report,
        pass1={"tam_estimate": "Tens of millions"},
        pass2={},
        intel={"trends": {"overall_trend": "GROWING"}},
        data_quality={"direct_evidence_count": 6, "adjacent_evidence_count": 4},
        source_counts={"reddit": 5, "job_posting": 3},
        batch_signals={"pain_quotes": ["Lost 3 customers"], "wtp_signals": []},
    )
    entries = {entry["claim_id"]: entry for entry in claim_contract["entries"]}

    assert entries["problem_validity"]["support_level"] == "evidence_backed"
    assert entries["problem_validity"]["allowed_for_problem_validity"] is True
    assert entries["pricing_strategy"]["support_level"] == "hypothesis"
    assert entries["pricing_strategy"]["allowed_for_business_validity"] is False
    assert entries["market_timing"]["allowed_for_problem_validity"] is False


def test_claim_contract_keeps_icp_as_hypothesis_when_direct_evidence_is_thin():
    report = {
        "problem_validity": {
            "label": "LOW",
            "score": 36,
            "summary": "Thin direct pain proof with stronger adjacent pain.",
            "buyer_source_count": 1,
            "adjacent_heavy": True,
        },
        "business_validity": {
            "label": "LOW",
            "score": 42,
            "summary": "Some business signal exists.",
            "wtp_signals_found": 0,
            "job_signals_found": 0,
            "review_signals_found": 0,
            "competitor_count": 1,
        },
        "ideal_customer_profile": {
            "primary_persona": "Tiny B2B SaaS founder",
        },
        "competition_landscape": {
            "market_saturation": "EMERGING",
            "direct_competitors": [{"name": "ChurnZero"}],
        },
    }
    claim_contract = pipeline._build_claim_contract(
        report,
        pass1={"tam_estimate": ""},
        pass2={},
        intel={"trends": {"overall_trend": "GROWING"}},
        data_quality={"direct_evidence_count": 2, "adjacent_evidence_count": 10},
        source_counts={"reddit": 4},
        batch_signals={"pain_quotes": ["Customers are going cold"], "wtp_signals": []},
    )
    entries = {entry["claim_id"]: entry for entry in claim_contract["entries"]}

    assert entries["problem_validity"]["support_level"] == "supporting_context"
    assert entries["ideal_customer_profile"]["support_level"] == "hypothesis"
    assert entries["tam_estimate"]["support_level"] == "hypothesis"


def test_live_reddit_comment_posts_from_seed_posts(monkeypatch):
    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return [
                {"data": {"children": []}},
                {
                    "data": {
                        "children": [
                            {
                                "kind": "t1",
                                "data": {
                                    "id": "comment-1",
                                    "body": "We keep losing customers when usage drops and I would pay for an alert before churn spikes.",
                                    "score": 14,
                                    "created_utc": 1710892800,
                                    "author": "founder1",
                                    "permalink": "/r/microsaas/comments/post1/example/comment-1/",
                                },
                            }
                        ]
                    }
                },
            ]

    monkeypatch.setattr(pipeline.requests, "get", lambda *args, **kwargs: FakeResponse())

    comments = pipeline._fetch_live_reddit_comment_posts(
        [
            {
                "id": "post-1",
                "external_id": "post-1",
                "source": "reddit",
                "subreddit": "microsaas",
                "title": "Usage dropped for my tiny SaaS",
                "score": 28,
                "num_comments": 22,
                "permalink": "https://reddit.com/r/microsaas/comments/post1/example/",
            }
        ],
        ["usage drop", "churn"],
        timeout_seconds=5,
        max_posts=5,
    )
    assert len(comments) == 1
    assert comments[0]["source"] == "reddit_comment"
    assert comments[0]["parent_external_id"] == "post-1"
    assert "churn" in " ".join(comments[0]["matched_keywords"]).lower()


def test_live_reddit_comment_posts_prefers_provider_comments(monkeypatch):
    fake_provider_module = types.SimpleNamespace(
        is_available=lambda: True,
        fetch_top_comments=lambda seed_posts, keywords, max_posts=40, per_post_limit=4: [
            {
                "id": "provider-comment-1",
                "external_id": "provider-comment-1",
                "title": "We would pay for better churn alerts",
                "body": "We would pay for better churn alerts before cancellations spike.",
                "selftext": "We would pay for better churn alerts before cancellations spike.",
                "full_text": "Usage dropped for my tiny SaaS. We would pay for better churn alerts before cancellations spike.",
                "score": 22,
                "num_comments": 0,
                "source": "reddit_comment",
                "subreddit": "microsaas",
                "permalink": "https://reddit.com/r/microsaas/comments/post1/example/provider-comment-1/",
                "matched_keywords": ["churn"],
                "parent_external_id": "post-1",
            }
        ],
    )

    monkeypatch.setitem(sys.modules, "engine.reddit_scrapecreators", fake_provider_module)
    monkeypatch.setattr(
        pipeline.requests,
        "get",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("fallback HTTP path should not be used")),
    )

    comments = pipeline._fetch_live_reddit_comment_posts(
        [
            {
                "id": "post-1",
                "external_id": "post-1",
                "source": "reddit",
                "subreddit": "microsaas",
                "title": "Usage dropped for my tiny SaaS",
                "score": 28,
                "num_comments": 22,
                "permalink": "https://reddit.com/r/microsaas/comments/post1/example/",
            }
        ],
        ["usage drop", "churn"],
        timeout_seconds=5,
        max_posts=5,
    )

    assert len(comments) == 1
    assert comments[0]["external_id"] == "provider-comment-1"
    assert comments[0]["source"] == "reddit_comment"


def test_synthesis_pass1(get_sample_posts, load_user_configs):
    brain = StubBrain(load_user_configs())
    result = pipeline.run_synthesis_pass1(
        brain=brain,
        posts=get_sample_posts(20),
        idea="invoice chasing for freelancers",
        test_mode=True,
    )
    assert result is not None
    assert "pain_validated" in result
    assert "evidence" in result
    print(
        f"Synthesis Pass 1: pain_validated={result['pain_validated']}, "
        f"{len(result.get('evidence', []))} evidence points"
    )


def test_debate_engine(monkeypatch, load_user_configs):
    from engine import multi_brain as multi_brain_module

    def fake_call_provider(config, prompt, system_prompt):
        role = "ANALYST"
        prompt_upper = prompt.upper()
        system_upper = system_prompt.upper()
        if "BULL" in system_upper:
            role = "BULL"
        elif "SKEPTIC" in system_upper:
            role = "SKEPTIC"
        elif "MARKET_ANALYST" in system_upper or "MARKET ANALYST" in system_upper:
            role = "MARKET_ANALYST"

        round2 = "OTHER MODELS' REASONING" in prompt_upper or "YOUR ORIGINAL ANALYSIS" in prompt_upper

        if round2:
            payload = {
                "verdict": "BUILD_IT" if role != "SKEPTIC" else "RISKY",
                "confidence": 76 if role == "BULL" else (62 if role == "SKEPTIC" else 71),
                "evidence": [f"{role} follow-up evidence"],
                "suggestions": [f"{role} suggestion"],
                "risk_factors": [f"{role} risk"],
                "action_plan": [f"{role} action"],
                "top_posts": [{"title": f"{role} top post"}],
                "top_unknowns": ["Unknown retention effect"],
                "summary": f"{role} round 2 summary",
                "debate_note": f"[BULL] and [SKEPTIC] arguments were considered by {role}.",
            }
        else:
            payload = {
                "verdict": "BUILD_IT" if role != "SKEPTIC" else "RISKY",
                "confidence": 80 if role == "BULL" else (60 if role == "SKEPTIC" else 70),
                "evidence": [f"{role} evidence point"],
                "suggestions": [f"{role} suggestion"],
                "risk_factors": [f"{role} risk"],
                "action_plan": [f"{role} action"],
                "top_posts": [{"title": f"{role} top post"}],
                "top_unknowns": ["Unknown retention effect"],
                "executive_summary": f"{role} sees meaningful demand.",
                "summary": f"{role} sees meaningful demand.",
            }

        return config["provider"], config["selected_model"], json.dumps(payload)

    monkeypatch.setattr(multi_brain_module, "call_provider", fake_call_provider)

    brain = MultiBrain(load_user_configs())
    result = brain.debate(
        prompt="Strong demand signal for invoice chasing among freelancers.",
        system_prompt="Return JSON with verdict, confidence, evidence, suggestions, action_plan, risk_factors, top_posts, top_unknowns, summary, debate_note.",
        metadata={},
    )
    assert result["verdict"] in ["BUILD_IT", "RISKY", "DONT_BUILD"]
    assert 0 < result["confidence"] <= 100
    assert len(result.get("models_used", [])) >= 1
    transcript = result["debate_transcript"]
    assert transcript["version"] == 2
    assert transcript["room"]["mode"] == "structured_room"
    assert transcript["room"]["moderated"] is True
    assert transcript["room"]["moderator_hidden"] is True
    assert transcript["evidence_board"]
    assert transcript["debate_events"]
    assert transcript["rounds"][0]["phase"] == "opening"
    first_entry = transcript["rounds"][0]["entries"][0]
    assert "stance_summary" in first_entry
    assert "response_mode" in first_entry
    assert "status" in first_entry
    assert first_entry["response_mode"] == "claim"
    assert first_entry["status"] == "ok"
    round2 = next((round_ for round_ in transcript["rounds"] if round_["round"] == 2), None)
    assert round2 is not None
    round2_entry = round2["entries"][0]
    assert "cited_evidence_ids" in round2_entry
    assert "engaged_model_ids" in round2_entry
    assert "response_mode" in round2_entry
    assert "status" in round2_entry
    assert "moderator_summary" in transcript["final"]
    assert "key_disagreements" in transcript["final"]
    print(f"Debate: {result['verdict']} ({result['confidence']}%) - {len(result.get('models_used', []))} models")


def test_debate_engine_consensus_emits_structured_transcript_without_round2(monkeypatch, load_user_configs):
    from engine import multi_brain as multi_brain_module

    def fake_consensus_provider(config, prompt, system_prompt):
        role = "ANALYST"
        system_upper = system_prompt.upper()
        if "BULL" in system_upper:
            role = "BULL"
        elif "SKEPTIC" in system_upper:
            role = "SKEPTIC"
        elif "MARKET_ANALYST" in system_upper or "MARKET ANALYST" in system_upper:
            role = "MARKET_ANALYST"

        payload = {
            "verdict": "BUILD_IT",
            "confidence": 74,
            "evidence": [f"{role} evidence point"],
            "suggestions": [f"{role} suggestion"],
            "risk_factors": [f"{role} risk"],
            "action_plan": [f"{role} action"],
            "top_posts": [{"title": f"{role} top post"}],
            "top_unknowns": ["Unknown retention effect"],
            "executive_summary": f"{role} sees repeated buyer pain.",
            "summary": f"{role} sees repeated buyer pain.",
        }

        return config["provider"], config["selected_model"], json.dumps(payload)

    monkeypatch.setattr(multi_brain_module, "call_provider", fake_consensus_provider)

    brain = MultiBrain(load_user_configs())
    result = brain.debate(
        prompt="Strong demand signal for invoice chasing among freelancers.",
        system_prompt="Return JSON with verdict, confidence, evidence, suggestions, action_plan, risk_factors, top_posts, top_unknowns, summary, debate_note.",
        metadata={},
    )

    transcript = result["debate_transcript"]
    assert transcript["version"] == 2
    assert transcript["room"]["moderated"] is True
    assert transcript["evidence_board"]
    assert transcript["debate_events"]
    assert len(transcript["rounds"]) == 1
    assert transcript["rounds"][0]["round"] == 1
    assert transcript["round2_summary"] == ""
    assert transcript["final"]["moderator_summary"]
    assert transcript["final"]["key_disagreements"]


def test_competition_tier():
    result = analyze_competition(
        keywords=["invoice software"],
        idea_text="invoice automation for freelancers",
        known_competitors=["FreshBooks", "Wave", "Stripe"],
    )
    summary = competition_summary(result)
    assert summary["overall_tier"] != "BLUE_OCEAN", "BLUE_OCEAN with 3 known competitors - bug!"
    print(f"Competition: {summary['overall_tier']} (not BLUE_OCEAN)")


def test_authenticated_reddit_scrape_records_stats(monkeypatch):
    from engine import reddit_auth

    class FakeSubmission:
        def __init__(self, submission_id, subreddit_name, title):
            self.id = submission_id
            self.subreddit = subreddit_name
            self.title = title
            self.selftext = "Repeated buyer pain around invoice reminders."
            self.author = "tester"
            self.score = 12
            self.num_comments = 4
            self.created_utc = 1710892800
            self.permalink = f"/r/{subreddit_name}/comments/{submission_id}/example/"

    class FakeSubreddit:
        def __init__(self, name):
            self.name = name

        def new(self, limit=100):
            return [FakeSubmission(f"{self.name}-new", self.name, f"{self.name} new post")]

        def hot(self, limit=100):
            return [FakeSubmission(f"{self.name}-hot", self.name, f"{self.name} hot post")]

    class FakeReddit:
        def subreddit(self, name):
            return FakeSubreddit(name)

    monkeypatch.setattr(reddit_auth, "_get_reddit", lambda: FakeReddit())

    posts = reddit_auth.scrape_all_authenticated(["SaaS"], sorts=["new", "hot"], limit=5)

    assert len(posts) == 2
    stats = getattr(reddit_auth.scrape_all_authenticated, "last_run_stats", {})
    assert stats["mode"] == "authenticated_app"
    assert stats["requested_requests"] == 2
    assert stats["successful_requests"] == 2
    assert stats["failed_requests"] == 0
    assert stats["subreddits_with_posts"] == 1


def test_scraper_run_notes_include_reddit_health_and_runner():
    runner_note = market_scraper._format_runner_note("github_actions")
    reddit_note = market_scraper._format_reddit_health_note(
        "authenticated_app",
        128,
        84,
        0,
        "",
    )

    assert runner_note == "Run metadata: caller=github_actions"
    assert reddit_note == "Reddit health: mode=authenticated_app; posts=128; success=84; failed=0; reason=none"


def test_finalize_scraper_run_preserves_structured_notes(monkeypatch):
    captured = {}

    class DummyResponse:
        status_code = 200

    def fake_patch(table, match_query, data):
        captured["payload"] = data
        return DummyResponse()

    monkeypatch.setattr(market_scraper, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(market_scraper, "sb_patch", fake_patch)

    market_scraper.finalize_scraper_run_record(
        "run-123",
        "completed",
        time.time(),
        notes=[
            "ordinary note 1",
            "ordinary note 2",
            "ordinary note 3",
            "ordinary note 4",
            "ordinary note 5",
            "ordinary note 6",
            "Source health: healthy=reddit; degraded=none",
            "Run metadata: caller=github_actions",
            "Reddit health: mode=authenticated_app; posts=120; success=84; failed=0; reason=none",
        ],
    )

    error_text = captured["payload"]["error_text"]
    assert "Source health: healthy=reddit; degraded=none" in error_text
    assert "Run metadata: caller=github_actions" in error_text
    assert "Reddit health: mode=authenticated_app; posts=120; success=84; failed=0; reason=none" in error_text


def test_full_pipeline_quick(monkeypatch, get_sample_posts, load_user_configs):
    start = time.time()

    monkeypatch.setattr(pipeline, "AIBrain", StubBrain)
    monkeypatch.setattr(pipeline, "DEATHWATCH_AVAILABLE", False)
    monkeypatch.setattr(pipeline, "PAIN_STREAM_AVAILABLE", False)

    sample_posts = get_sample_posts(24)
    source_counts = {"reddit": 12, "hackernews": 8, "indiehackers": 4}
    intel = {
        "trends": {"available": True, "overall_trend": "GROWING"},
        "competition": {"available": True, "overall_tier": "EMERGING"},
        "trend_prompt": "",
        "comp_prompt": "",
    }

    monkeypatch.setattr(
        pipeline,
        "phase2_scrape",
        lambda *args, **kwargs: (sample_posts, source_counts, []),
    )
    monkeypatch.setattr(
        pipeline,
        "phase2b_intelligence",
        lambda *args, **kwargs: intel,
    )

    result = pipeline.validate_idea(
        idea="invoice chasing for freelancers",
        depth="quick",
        test_mode=True,
    )
    elapsed = time.time() - start
    assert elapsed < 180, f"Quick validation took {elapsed}s"
    assert result["verdict"] in ["BUILD_IT", "RISKY", "DONT_BUILD"]
    assert result["confidence"] > 0
    assert len(result.get("debate_evidence", [])) > 0, "Empty evidence - synthesis failed"
    print(f"Full pipeline: {result['verdict']} ({result['confidence']}%) in {elapsed:.0f}s")
