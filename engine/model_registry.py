import json
from functools import lru_cache
from pathlib import Path
from typing import Optional


REGISTRY_PATH = Path(__file__).resolve().parent.parent / "config" / "ai-model-registry.json"


@lru_cache(maxsize=1)
def load_registry() -> dict:
    with REGISTRY_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def get_provider_registry(provider: str) -> Optional[dict]:
    providers = load_registry().get("providers", {})
    return providers.get(str(provider or "").strip().lower())


def get_default_model(provider: str) -> Optional[str]:
    entry = get_provider_registry(provider)
    if not entry:
        return None
    return entry.get("default_model")


def resolve_model_name(model_name: str) -> str:
    normalized = str(model_name or "").strip()
    if not normalized:
        return normalized

    for provider in load_registry().get("providers", {}).values():
        for model in provider.get("models", []):
            runtime_model_id = str(model.get("runtime_model_id") or model.get("id") or "").strip()
            if normalized == runtime_model_id:
                return runtime_model_id
            aliases = [str(alias).strip() for alias in model.get("aliases", [])]
            if normalized in aliases:
                return runtime_model_id

    return normalized


def get_model_entry(provider: str, model_name: str) -> Optional[dict]:
    entry = get_provider_registry(provider)
    if not entry:
        return None

    resolved_name = resolve_model_name(model_name)
    for model in entry.get("models", []):
        runtime_model_id = str(model.get("runtime_model_id") or model.get("id") or "").strip()
        if runtime_model_id == resolved_name:
            return model
    return None


def get_verification_model(provider: str, model_name: str) -> str:
    entry = get_model_entry(provider, model_name)
    if not entry:
        return resolve_model_name(model_name)
    return str(entry.get("verification_model_id") or entry.get("runtime_model_id") or entry.get("id") or model_name)
