"""Verify all proxy modules load correctly on VPS."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "engine"))

print("=" * 50)
print("  Module Verification")
print("=" * 50)

# 1. proxy_rotator
from proxy_rotator import get_rotator, stealth_json_headers, stealth_headers, ProxyHealth
r = get_rotator()
print(f"[OK] proxy_rotator loaded — mode={r.mode}")

# 2. stealth headers
h = stealth_json_headers()
print(f"[OK] stealth_json_headers — {len(h)} headers: {list(h.keys())[:5]}...")

# 3. config user agents
from config import USER_AGENTS
print(f"[OK] config.USER_AGENTS — {len(USER_AGENTS)} agents loaded")

# 4. reddit_async
from reddit_async import scrape_all_async, AIOHTTP_AVAILABLE
print(f"[OK] reddit_async loaded — aiohttp={AIOHTTP_AVAILABLE}")

# 5. keyword_scraper (check proxy wiring)
from keyword_scraper import _headers, search_reddit
test_h = _headers()
has_stealth = "Sec-Fetch-Mode" in test_h
print(f"[OK] keyword_scraper._headers() — stealth={has_stealth}, keys={list(test_h.keys())[:4]}...")

print()
print("ALL MODULES VERIFIED ✓")
print(f"Proxy status: {'READY (set env var to activate)' if r.mode == 'direct' else r.mode}")
