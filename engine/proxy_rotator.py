"""
RedditPulse - Proxy Rotator
Shared proxy helper for requests/aiohttp scrapers.

Primary source:
- PROXY_LIST environment variable (comma/newline/semicolon separated URLs)

Fallback source:
- engine/data/working_proxies.txt written by proxy_harvester.py
"""

from __future__ import annotations

import os
import random
import threading
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

try:
    from config import USER_AGENTS
except Exception:
    USER_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    ]


DATA_DIR = Path(__file__).resolve().parent / "data"
WORKING_PROXIES_TXT = DATA_DIR / "working_proxies.txt"


def _dedupe_keep_order(values: Iterable[str]) -> list[str]:
    seen = set()
    ordered: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _parse_proxy_tokens(raw_proxy_list: str = "") -> list[str]:
    raw = (raw_proxy_list or "").strip()
    tokens: list[str] = []

    if raw:
        normalized = raw.replace(";", "\n").replace(",", "\n")
        for chunk in normalized.splitlines():
            value = chunk.strip()
            if value:
                tokens.append(value)
        return _dedupe_keep_order(tokens)

    if WORKING_PROXIES_TXT.exists():
        try:
            file_text = WORKING_PROXIES_TXT.read_text(encoding="utf-8", errors="ignore")
            normalized = file_text.replace(";", "\n").replace(",", "\n")
            for chunk in normalized.splitlines():
                value = chunk.strip()
                if value:
                    tokens.append(value)
        except Exception:
            return []

    return _dedupe_keep_order(tokens)


@dataclass
class ProxyHealth:
    total_requests: int = 0
    success: int = 0
    blocked: int = 0
    timeouts: int = 0
    errors: int = 0

    def record_success(self) -> None:
        self.total_requests += 1
        self.success += 1

    def record_block(self) -> None:
        self.total_requests += 1
        self.blocked += 1

    def record_timeout(self) -> None:
        self.total_requests += 1
        self.timeouts += 1

    def record_error(self) -> None:
        self.total_requests += 1
        self.errors += 1

    @property
    def success_rate(self) -> float:
        if self.total_requests <= 0:
            return 1.0
        return self.success / self.total_requests

    @property
    def is_degraded(self) -> bool:
        if self.total_requests <= 0:
            return False
        return self.success_rate < 0.85

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["success_rate"] = self.success_rate
        payload["is_degraded"] = self.is_degraded
        return payload

    def reset(self) -> None:
        self.total_requests = 0
        self.success = 0
        self.blocked = 0
        self.timeouts = 0
        self.errors = 0

    def __str__(self) -> str:
        return (
            f"{self.success}/{self.total_requests} ok, "
            f"{self.blocked} blocked, {self.timeouts} timeouts, {self.errors} errors "
            f"({self.success_rate:.0%})"
        )


class ProxyRotator:
    def __init__(self, raw_proxy_list: str = ""):
        env_value = raw_proxy_list or os.environ.get("PROXY_LIST", "")
        proxies = _parse_proxy_tokens(env_value)
        self.proxies = list(proxies)
        self._live_proxies = list(proxies)
        self._quarantined_proxies: set[str] = set()
        self._cooldown_until: dict[str, float] = {}
        self._lock = threading.Lock()
        self.health = ProxyHealth()
        self.mode = "proxy_pool" if self.proxies else "direct"

    def _prune_cooldowns_locked(self) -> None:
        if not self._cooldown_until:
            return
        now = time.monotonic()
        expired = [proxy for proxy, until in self._cooldown_until.items() if until <= now]
        for proxy in expired:
            self._cooldown_until.pop(proxy, None)

    def _eligible_proxies_locked(self) -> list[str]:
        self._prune_cooldowns_locked()
        return [
            proxy
            for proxy in self.proxies
            if proxy not in self._quarantined_proxies and proxy not in self._cooldown_until
        ]

    def has_proxies(self) -> bool:
        with self._lock:
            self._restore_pool_if_needed()
            return bool(self._live_proxies)

    def live_count(self) -> int:
        with self._lock:
            self._restore_pool_if_needed()
            return len(self._live_proxies)

    def total_count(self) -> int:
        return len(self.proxies)

    def _restore_pool_if_needed(self) -> None:
        self._prune_cooldowns_locked()
        self._live_proxies = [
            proxy for proxy in self._live_proxies
            if proxy not in self._quarantined_proxies and proxy not in self._cooldown_until
        ]
        if not self._live_proxies and self.proxies:
            self._live_proxies = self._eligible_proxies_locked()

    def next_proxy(self) -> str | None:
        with self._lock:
            self._restore_pool_if_needed()
            if not self._live_proxies:
                return None
            proxy = self._live_proxies.pop(0)
            self._live_proxies.append(proxy)
            return proxy

    def random_proxy(self) -> str | None:
        with self._lock:
            self._restore_pool_if_needed()
            if not self._live_proxies:
                return None
            return random.choice(self._live_proxies)

    def random_http_proxy(self) -> str | None:
        with self._lock:
            self._restore_pool_if_needed()
            http_like = [proxy for proxy in self._live_proxies if not str(proxy).lower().startswith("socks")]
            if not http_like:
                return None
            return random.choice(http_like)

    def next_http_proxy(self) -> str | None:
        with self._lock:
            self._restore_pool_if_needed()
            if not self._live_proxies:
                return None
            for index, proxy in enumerate(list(self._live_proxies)):
                if str(proxy).lower().startswith("socks"):
                    continue
                selected = self._live_proxies.pop(index)
                self._live_proxies.append(selected)
                return selected
            return None

    def format_for_requests(self) -> dict | None:
        proxy = self.next_http_proxy() or self.next_proxy()
        if not proxy:
            return None
        return {"http": proxy, "https": proxy}

    def format_for_aiohttp(self) -> str | None:
        return self.random_http_proxy()

    def cull_proxy(self, proxy: str | None, quarantine: bool = True) -> None:
        if not proxy:
            return
        with self._lock:
            self._live_proxies = [item for item in self._live_proxies if item != proxy]
            self._cooldown_until.pop(proxy, None)
            if quarantine:
                self._quarantined_proxies.add(proxy)
            self._restore_pool_if_needed()

    def mark_dead(self, proxy: str | None) -> None:
        self.cull_proxy(proxy, quarantine=True)

    def cooldown_proxy(self, proxy: str | None, seconds: float = 90.0) -> None:
        if not proxy:
            return
        with self._lock:
            self._live_proxies = [item for item in self._live_proxies if item != proxy]
            self._quarantined_proxies.discard(proxy)
            self._cooldown_until[proxy] = time.monotonic() + max(1.0, float(seconds))
            self._restore_pool_if_needed()

    def pool_stats(self) -> dict:
        with self._lock:
            self._restore_pool_if_needed()
            return {
                "total_proxies": len(self.proxies),
                "live_proxies": len(self._live_proxies),
                "quarantined_proxies": len(self._quarantined_proxies),
                "cooldown_proxies": len(self._cooldown_until),
            }

    def reset_health(self) -> None:
        self.health.reset()

    def summary(self) -> str:
        if not self.proxies:
            return "direct (no proxies)"
        stats = self.pool_stats()
        return (
            f"{self.mode} ({stats['live_proxies']} live / {stats['total_proxies']} total, "
            f"{stats['quarantined_proxies']} quarantined, {stats['cooldown_proxies']} cooling down)"
        )


def stealth_headers() -> dict:
    ua = random.choice(USER_AGENTS) if USER_AGENTS else "Mozilla/5.0"
    return {
        "User-Agent": ua,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "DNT": "1",
        "Referer": "https://www.google.com/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }


def stealth_json_headers() -> dict:
    headers = stealth_headers()
    headers.update(
        {
            "Accept": "application/json",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
        }
    )
    return headers


_ROTATOR: ProxyRotator | None = None


def get_rotator() -> ProxyRotator:
    global _ROTATOR
    if _ROTATOR is None:
        _ROTATOR = ProxyRotator()
    return _ROTATOR


def reset_rotator() -> ProxyRotator:
    global _ROTATOR
    _ROTATOR = ProxyRotator()
    return _ROTATOR


if __name__ == "__main__":
    rotator = get_rotator()
    print(f"Proxy status: {rotator.summary()}")
    print(f"Health: {rotator.health}")
