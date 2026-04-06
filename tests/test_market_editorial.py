import scraper_job  # noqa: F401 - ensures engine/ is on sys.path for market_editorial imports
import market_editorial.orchestrator as orchestrator


def _idea_row(slug="async-video-updates", score=61, source_count=2):
    return {
        "slug": slug,
        "topic": "Async video updates for product teams",
        "category": "productivity",
        "current_score": score,
        "confidence_level": "MEDIUM",
        "post_count_total": 9,
        "source_count": source_count,
        "sources": [
            {"platform": "reddit", "count": 6},
            {"platform": "hackernews", "count": 3},
        ],
        "top_posts": [
            {
                "title": "Screen recording tools are too flaky for async standups",
                "source": "reddit",
                "subreddit": "productivity",
                "score": 41,
                "comments": 12,
                "market_support_level": "evidence_backed",
                "signal_kind": "complaint",
            },
            {
                "title": "Teams still need a better Loom alternative",
                "source": "hackernews",
                "score": 19,
                "comments": 7,
                "market_support_level": "supporting_context",
                "signal_kind": "feature_request",
            },
        ],
        "public_title": "Async video updates for product teams",
        "public_summary": "Product teams keep complaining that current async update tools are unreliable.",
        "suggested_wedge_label": "Async update workflow for product teams",
        "signal_contract": {
            "support_level": "evidence_backed",
            "buyer_native_direct_count": 2,
            "supporting_signal_count": 3,
            "dominant_platform": "reddit",
            "single_source": False,
        },
        "first_seen": "2026-04-05T10:00:00+00:00",
        "last_updated": "2026-04-06T10:00:00+00:00",
    }


class FakeClient:
    def __init__(self, api_key, model, timeout_seconds=90):
        self.api_key = api_key
        self.model = model

    def create_structured_completion(self, *, schema_name, **_kwargs):
        if schema_name == orchestrator.EDITOR_ROLE_NAME:
            return ({
                "edited_title": "Async updates tool for product teams",
                "edited_summary": "Product teams keep asking for a calmer async update workflow because current screen recording tools feel flaky and messy.",
                "pain_statement": "Teams struggle to share reliable async updates without meetings or tool friction.",
                "ideal_buyer": "Product teams running async standups and release updates.",
                "product_angle": "A reliable async update workflow built around short, structured team check-ins.",
                "verdict": "Worth validating with product teams already using async standups.",
                "next_step": "Validate with five product teams and test whether reliability is the main trigger to switch.",
            }, {"total_tokens": 640})

        return ({
            "visibility_decision": "public",
            "duplicate_of_slug": None,
            "quality_score": 82,
            "grounding_confidence": 87,
            "critic_reasons": ["The copy stays grounded in repeated pain across multiple sources."],
            "tightened_title": None,
            "tightened_summary": None,
        }, {"total_tokens": 310})


def test_market_editorial_pass_updates_current_rows(monkeypatch):
    monkeypatch.setenv("MARKET_AGENT_ENABLED", "true")
    monkeypatch.setenv("CEREBRAS_API_KEY", "test-key")
    monkeypatch.setenv("CEREBRAS_MODEL", "llama-test")
    monkeypatch.setenv("MARKET_AGENT_TOP_N", "5")
    monkeypatch.setenv("MARKET_AGENT_MAX_INPUT_POSTS", "4")
    monkeypatch.setenv("MARKET_AGENT_MAX_TOKENS_PER_RUN", "5000")
    monkeypatch.setenv("MARKET_AGENT_REFRESH_HOURS", "24")
    monkeypatch.setattr(orchestrator, "CerebrasStructuredClient", FakeClient)

    updated_rows, stale_updates, telemetry = orchestrator.run_market_editorial_pass(
        [_idea_row()],
        [_idea_row(slug="older-opportunity", score=42)],
        persist_enabled=True,
        logger=lambda *_args, **_kwargs: None,
    )

    assert len(updated_rows) == 1
    assert stale_updates == []
    payload = updated_rows[0]["market_editorial"]
    assert payload["status"] == "success"
    assert payload["visibility_decision"] == "public"
    assert payload["edited_title"] == "Async updates tool for product teams"
    assert telemetry["approved_public"] == 1
    assert telemetry["tokens_used"] == 950


def test_market_editorial_pass_fail_soft_without_columns(monkeypatch):
    monkeypatch.setenv("MARKET_AGENT_ENABLED", "true")
    monkeypatch.setenv("CEREBRAS_API_KEY", "test-key")

    rows, stale_updates, telemetry = orchestrator.run_market_editorial_pass(
        [_idea_row()],
        [],
        persist_enabled=False,
        logger=lambda *_args, **_kwargs: None,
    )

    assert rows[0]["slug"] == "async-video-updates"
    assert stale_updates == []
    assert telemetry["enabled"] is False
