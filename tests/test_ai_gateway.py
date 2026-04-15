import scraper_job  # noqa: F401 - ensures engine/ is on sys.path for ai_gateway imports
from engine.ai_gateway import classify_ai_error


def test_classify_ai_error_marks_billing_inactive_as_non_retryable():
    kind, status, retryable = classify_ai_error(
        Exception("OpenAI 429: billing_not_active: Your account is not active"),
    )

    assert kind == "billing_inactive"
    assert status == 429
    assert retryable is False


def test_classify_ai_error_marks_quota_exceeded_as_non_retryable():
    kind, status, retryable = classify_ai_error(
        Exception("Gemini 429: Quota exceeded for quota metric"),
    )

    assert kind == "quota_exceeded"
    assert status == 429
    assert retryable is False
