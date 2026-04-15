import random
import re
import time
from dataclasses import dataclass, asdict
from typing import Callable, Optional

import requests
from model_registry import resolve_model_name


STRICT_JSON_SUFFIX = """

STRICT OUTPUT CONTRACT:
- Return valid JSON only.
- Do not wrap the JSON in markdown fences.
- Do not add commentary before or after the JSON.
- If uncertain, keep fields narrow and mark them as unknown/speculative rather than inventing facts.
""".strip()


MODEL_PRICING = {
    "claude-opus-4-6": {"input": 5.0, "output": 25.0},
    "claude-opus-4-5": {"input": 5.0, "output": 25.0},
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0},
    "claude-sonnet-4-5": {"input": 3.0, "output": 15.0},
    "claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0},
    "claude-haiku-4-5": {"input": 1.0, "output": 5.0},
    "claude-3-5-sonnet": {"input": 3.0, "output": 15.0},
    "claude-3-5-haiku": {"input": 0.8, "output": 4.0},
    "gpt-5.4": {"input": 2.5, "output": 15.0},
    "gpt-5.4-mini": {"input": 0.75, "output": 4.5},
    "gpt-5.4-nano": {"input": 0.2, "output": 1.25},
    "gpt-4o": {"input": 2.5, "output": 10.0},
    "gpt-4.1": {"input": 2.0, "output": 8.0},
    "gpt-4.1-mini": {"input": 0.4, "output": 1.6},
    "gpt-4.1-nano": {"input": 0.1, "output": 0.4},
    "gemini-2.0-flash": {"input": 0.1, "output": 0.4},
    "deepseek-chat": {"input": 0.27, "output": 1.1},
    "mistral-large": {"input": 2.0, "output": 6.0},
}


@dataclass
class AICallTelemetry:
    provider: str
    model: str
    task_type: str
    stage: str
    success: bool
    attempts: int
    retry_count: int
    duration_ms: int
    input_tokens_est: int
    output_tokens_est: int
    cost_usd_est: float
    expect_json: bool
    error_kind: Optional[str] = None
    error_status: Optional[int] = None
    error_message: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


def estimate_tokens(text: str, is_json: bool = False) -> int:
    normalized = re.sub(r"\s+", " ", str(text or "")).strip()
    if not normalized:
        return 0
    bytes_per_token = 2 if is_json else 4
    return max(1, int(round(len(normalized.encode("utf-8")) / bytes_per_token)))


def summarize_ai_telemetry(events: list[dict]) -> dict:
    if not events:
        return {
            "total_calls": 0,
            "successful_calls": 0,
            "failed_calls": 0,
            "retry_count": 0,
            "estimated_cost_usd": 0.0,
            "estimated_input_tokens": 0,
            "estimated_output_tokens": 0,
            "by_stage": {},
            "by_provider": {},
        }

    summary = {
        "total_calls": len(events),
        "successful_calls": 0,
        "failed_calls": 0,
        "retry_count": 0,
        "estimated_cost_usd": 0.0,
        "estimated_input_tokens": 0,
        "estimated_output_tokens": 0,
        "by_stage": {},
        "by_provider": {},
    }

    for event in events:
        success = bool(event.get("success"))
        stage = str(event.get("stage") or "unknown")
        provider = str(event.get("provider") or "unknown")

        summary["successful_calls"] += 1 if success else 0
        summary["failed_calls"] += 0 if success else 1
        summary["retry_count"] += int(event.get("retry_count", 0) or 0)
        summary["estimated_cost_usd"] += float(event.get("cost_usd_est", 0.0) or 0.0)
        summary["estimated_input_tokens"] += int(event.get("input_tokens_est", 0) or 0)
        summary["estimated_output_tokens"] += int(event.get("output_tokens_est", 0) or 0)

        stage_bucket = summary["by_stage"].setdefault(stage, {"calls": 0, "cost_usd_est": 0.0, "retry_count": 0})
        stage_bucket["calls"] += 1
        stage_bucket["cost_usd_est"] += float(event.get("cost_usd_est", 0.0) or 0.0)
        stage_bucket["retry_count"] += int(event.get("retry_count", 0) or 0)

        provider_bucket = summary["by_provider"].setdefault(provider, {"calls": 0, "cost_usd_est": 0.0, "retry_count": 0})
        provider_bucket["calls"] += 1
        provider_bucket["cost_usd_est"] += float(event.get("cost_usd_est", 0.0) or 0.0)
        provider_bucket["retry_count"] += int(event.get("retry_count", 0) or 0)

    summary["estimated_cost_usd"] = round(summary["estimated_cost_usd"], 6)
    for bucket in summary["by_stage"].values():
        bucket["cost_usd_est"] = round(bucket["cost_usd_est"], 6)
    for bucket in summary["by_provider"].values():
        bucket["cost_usd_est"] = round(bucket["cost_usd_est"], 6)
    return summary


def _looks_like_json(text: str) -> bool:
    stripped = str(text or "").strip()
    return stripped.startswith("{") or stripped.startswith("[")


def _append_json_contract(system_prompt: str, expect_json: bool) -> str:
    prompt = str(system_prompt or "").strip()
    if not expect_json:
        return prompt
    if "STRICT OUTPUT CONTRACT" in prompt:
        return prompt
    return f"{prompt}\n\n{STRICT_JSON_SUFFIX}".strip()


def _extract_status_code(message: str) -> Optional[int]:
    match = re.search(r"\b(408|409|413|429|500|502|503|504|529)\b", message)
    if match:
        return int(match.group(1))
    return None


def classify_ai_error(error: Exception) -> tuple[str, Optional[int], bool]:
    if isinstance(error, requests.exceptions.Timeout):
        return "timeout", None, True
    if isinstance(error, requests.exceptions.ConnectionError):
        return "connection", None, True

    message = str(error or "")
    lowered = message.lower()
    status = _extract_status_code(message)

    if "timed out" in lowered or "timeout" in lowered:
        return "timeout", status, True
    if status == 429 and ("billing_not_active" in lowered or "account is not active" in lowered):
        return "billing_inactive", status, False
    if status == 429 and ("insufficient_quota" in lowered or "quota exceeded" in lowered):
        return "quota_exceeded", status, False
    if status in {429, 529, 408, 409, 500, 502, 503, 504}:
        return "http_retryable", status, True
    if status == 413:
        return "context_too_large", status, False
    if "json" in lowered and "decode" in lowered:
        return "json_decode", status, False
    if "unauthorized" in lowered or "forbidden" in lowered or status in {401, 403}:
        return "auth", status, False
    return "unknown", status, False


def _retry_delay_seconds(attempt: int) -> float:
    base = min(0.5 * (2 ** max(0, attempt - 1)), 8.0)
    return base + random.random() * min(0.25 * base, 1.0)


def _resolve_pricing(provider: str, model: str) -> dict:
    provider_l = str(provider or "").lower()
    model_l = resolve_model_name(str(model or "")).lower()

    if model_l in MODEL_PRICING:
        return MODEL_PRICING[model_l]

    for key in sorted(MODEL_PRICING.keys(), key=len, reverse=True):
        price = MODEL_PRICING[key]
        if key in model_l:
            return price

    if provider_l == "anthropic":
        return MODEL_PRICING["claude-3-5-sonnet"]
    if provider_l == "openai":
        return MODEL_PRICING["gpt-4o"]
    if provider_l == "gemini":
        return MODEL_PRICING["gemini-2.0-flash"]
    if provider_l == "deepseek":
        return MODEL_PRICING["deepseek-chat"]
    return {"input": 0.0, "output": 0.0}


def _estimate_cost_usd(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = _resolve_pricing(provider, model)
    return round(
        (input_tokens / 1_000_000.0) * float(pricing.get("input", 0.0))
        + (output_tokens / 1_000_000.0) * float(pricing.get("output", 0.0)),
        6,
    )


def call_with_ai_policy(
    *,
    provider: str,
    model: str,
    prompt: str,
    system_prompt: str,
    api_key: str,
    provider_fn: Callable,
    endpoint_url: Optional[str] = None,
    task_type: str = "general",
    stage: str = "general",
    expect_json: bool = False,
    max_retries: int = 2,
    observer: Optional[Callable[[dict], None]] = None,
) -> tuple[str, AICallTelemetry]:
    sanitized_system_prompt = _append_json_contract(system_prompt, expect_json=expect_json)
    input_tokens_est = estimate_tokens(sanitized_system_prompt) + estimate_tokens(prompt)

    attempts = 0
    last_error: Optional[Exception] = None
    start = time.time()

    for attempt in range(1, max_retries + 2):
        attempts = attempt
        try:
            kwargs = {
                "prompt": prompt,
                "system_prompt": sanitized_system_prompt,
                "api_key": api_key,
                "model": model,
            }
            if provider == "ollama":
                kwargs["endpoint_url"] = endpoint_url

            text = provider_fn(**kwargs)
            output_tokens_est = estimate_tokens(text, is_json=expect_json or _looks_like_json(text))
            telemetry = AICallTelemetry(
                provider=provider,
                model=model,
                task_type=task_type,
                stage=stage,
                success=True,
                attempts=attempts,
                retry_count=max(0, attempts - 1),
                duration_ms=int((time.time() - start) * 1000),
                input_tokens_est=input_tokens_est,
                output_tokens_est=output_tokens_est,
                cost_usd_est=_estimate_cost_usd(provider, model, input_tokens_est, output_tokens_est),
                expect_json=expect_json,
            )
            if observer:
                observer(telemetry.to_dict())
            return text, telemetry
        except Exception as exc:  # noqa: BLE001 - policy wrapper must classify provider failures centrally
            last_error = exc
            error_kind, error_status, retryable = classify_ai_error(exc)
            if attempt > max_retries or not retryable:
                telemetry = AICallTelemetry(
                    provider=provider,
                    model=model,
                    task_type=task_type,
                    stage=stage,
                    success=False,
                    attempts=attempts,
                    retry_count=max(0, attempts - 1),
                    duration_ms=int((time.time() - start) * 1000),
                    input_tokens_est=input_tokens_est,
                    output_tokens_est=0,
                    cost_usd_est=0.0,
                    expect_json=expect_json,
                    error_kind=error_kind,
                    error_status=error_status,
                    error_message=str(exc)[:400],
                )
                if observer:
                    observer(telemetry.to_dict())
                raise
            time.sleep(_retry_delay_seconds(attempt))

    if last_error is not None:
        raise last_error
    raise RuntimeError("AI gateway exited without response or captured error")
