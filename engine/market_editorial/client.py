from __future__ import annotations

import json
from typing import Any, Dict, Tuple

import requests


class CerebrasClientError(RuntimeError):
    pass


class CerebrasRateLimitError(CerebrasClientError):
    pass


class CerebrasStructuredClient:
    def __init__(self, api_key: str, model: str, timeout_seconds: int = 90):
        self.api_key = api_key.strip()
        self.model = model.strip()
        self.timeout_seconds = timeout_seconds
        self.url = "https://api.cerebras.ai/v1/chat/completions"

    def create_structured_completion(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema_name: str,
        schema: Dict[str, Any],
        max_tokens: int = 900,
        temperature: float = 0.2,
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": schema_name,
                    "strict": True,
                    "schema": schema,
                },
            },
        }
        response = requests.post(self.url, json=payload, headers=headers, timeout=self.timeout_seconds)
        if response.status_code == 429:
            raise CerebrasRateLimitError(f"Cerebras 429: {response.text[:240]}")
        if response.status_code >= 400:
            raise CerebrasClientError(f"Cerebras {response.status_code}: {response.text[:400]}")

        body = response.json()
        content = (
            body.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        if not content:
            raise CerebrasClientError("Cerebras returned an empty structured response")

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as exc:
            raise CerebrasClientError(f"Cerebras returned invalid JSON: {exc}") from exc

        usage = body.get("usage") or {}
        usage_summary = {
            "prompt_tokens": int(usage.get("prompt_tokens", 0) or 0),
            "completion_tokens": int(usage.get("completion_tokens", 0) or 0),
            "total_tokens": int(usage.get("total_tokens", 0) or 0),
        }
        return parsed, usage_summary
