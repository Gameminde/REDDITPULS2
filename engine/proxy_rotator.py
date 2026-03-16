"""
RedditPulse - Proxy Rotator
Lightweight shared proxy helper for requests/aiohttp scrapers.

Reads PROXY_LIST from the environment as comma/newline/semicolon separated URLs.
"""

import os
import threading
from itertools import cycle


class ProxyRotator:
    def __init__(self, raw_proxy_list: str = ""):
        raw = raw_proxy_list or os.environ.get("PROXY_LIST", "")
        tokens = []
        for chunk in raw.replace(";", "\n").replace(",", "\n").splitlines():
            value = chunk.strip()
            if value:
                tokens.append(value)
        self.proxies = tokens
        self._lock = threading.Lock()
        self._cycler = cycle(self.proxies) if self.proxies else None

    def has_proxies(self) -> bool:
        return bool(self.proxies)

    def next_proxy(self):
        if not self._cycler:
            return None
        with self._lock:
            return next(self._cycler)

    def format_for_requests(self):
        proxy = self.next_proxy()
        if not proxy:
            return None
        return {"http": proxy, "https": proxy}

    def format_for_aiohttp(self):
        return self.next_proxy()


_ROTATOR = None


def get_rotator() -> ProxyRotator:
    global _ROTATOR
    if _ROTATOR is None:
        _ROTATOR = ProxyRotator()
    return _ROTATOR
