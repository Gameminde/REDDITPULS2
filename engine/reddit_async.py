"""
RedditPulse — Async Reddit Scraper (Layer 1) — Production Proxy Edition
Scrapes all target subreddits concurrently using aiohttp.
Full stealth headers, exponential backoff, proxy rotation, health tracking.

Performance: 42 subreddits from ~210s → ~15s (direct) / ~25s (proxied)

Usage:
    from reddit_async import scrape_all_async
    posts = asyncio.run(scrape_all_async())
"""

import asyncio
from collections import Counter
import random
import re
import time
from datetime import datetime

try:
    import aiohttp
    AIOHTTP_AVAILABLE = True
except ImportError:
    AIOHTTP_AVAILABLE = False
    print("  [!] aiohttp not installed: pip install aiohttp")

from config import TARGET_SUBREDDITS, USER_AGENTS, SPAM_PATTERNS, HUMOR_INDICATORS
from proxy_rotator import get_rotator, stealth_json_headers

# Compiled filters
_spam_re = [re.compile(p, re.IGNORECASE) for p in SPAM_PATTERNS]
_humor_re = [re.compile(p, re.IGNORECASE) for p in HUMOR_INDICATORS]

# ═══════════════════════════════════════════════════════
# RATE LIMITING & CONFIG
# ═══════════════════════════════════════════════════════

MAX_CONCURRENT_DIRECT = 8       # max parallel when no proxy
MAX_CONCURRENT_PROXIED = 5      # lower concurrency through proxies (less suspicious)
DELAY_BETWEEN_DIRECT = 0.3      # seconds between requests (direct)
DELAY_BETWEEN_PROXIED = 0.8     # more spacing through proxies
RETRY_LIMIT = 3                 # retries per failed sub (was 2)
TIMEOUT_SECONDS = 20            # slightly longer for proxy latency
BACKOFF_BASE = 3                # exponential backoff base for 403s
JITTER_MIN = 0.5                # random jitter range
JITTER_MAX = 2.5


def _get_concurrency_config():
    """Adjust concurrency based on whether proxies are available."""
    rotator = get_rotator()
    if rotator.has_proxies():
        return MAX_CONCURRENT_PROXIED, DELAY_BETWEEN_PROXIED
    return MAX_CONCURRENT_DIRECT, DELAY_BETWEEN_DIRECT


class RateLimiter:
    """Token-bucket style rate limiter for async requests."""

    def __init__(self, max_concurrent=MAX_CONCURRENT_DIRECT, delay=DELAY_BETWEEN_DIRECT):
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.delay = delay
        self._lock = asyncio.Lock()
        self._last_request = 0.0

    async def acquire(self):
        await self.semaphore.acquire()
        async with self._lock:
            now = time.monotonic()
            wait = self.delay - (now - self._last_request)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_request = time.monotonic()

    def release(self):
        self.semaphore.release()


def _empty_stats(subs: list[str], sort_modes: list[str]) -> dict:
    return {
        "requested_subreddits": len(subs),
        "requested_requests": len(subs) * len(sort_modes),
        "successful_requests": 0,
        "failed_requests": 0,
        "status_counts": {},
        "subreddit_post_counts": {},
        "subreddits_with_posts": 0,
        "zero_post_subreddits": list(subs),
        "failures": [],
        "elapsed_seconds": 0.0,
        "mode": "async",
        "proxy_mode": "direct",
        "proxy_health": {},
    }


# ═══════════════════════════════════════════════════════
# ASYNC SCRAPER
# ═══════════════════════════════════════════════════════

def _parse_post(child_data: dict) -> dict | None:
    """Parse a Reddit API post into our normalized format."""
    d = child_data
    if d.get("removed_by_category") or d.get("selftext") in ("[removed]", "[deleted]"):
        return None

    full_text = f"{d.get('title', '')} {d.get('selftext', '')[:3000]}".strip()
    if len(full_text) < 20:
        return None
    if any(p.search(full_text) for p in _spam_re):
        return None
    if sum(1 for p in _humor_re if p.search(full_text)) >= 2:
        return None

    return {
        "source": "reddit",
        "external_id": d.get("id", ""),
        "subreddit": d.get("subreddit", ""),
        "title": d.get("title", ""),
        "body": d.get("selftext", "")[:3000],
        "full_text": full_text,
        "author": d.get("author", ""),
        "score": d.get("score", 0),
        "num_comments": d.get("num_comments", 0),
        "created_utc": d.get("created_utc", 0),
        "permalink": f"https://reddit.com{d.get('permalink', '')}",
    }


async def _fetch_subreddit(
    session: aiohttp.ClientSession,
    limiter: RateLimiter,
    subreddit: str,
    sort: str = "new",
    limit: int = 100,
    retry_limit: int = RETRY_LIMIT,
    timeout_seconds: int = TIMEOUT_SECONDS,
) -> dict:
    """Fetch posts from one subreddit with stealth headers, proxy rotation, and exponential backoff."""
    url = f"https://www.reddit.com/r/{subreddit}/{sort}.json"
    params = {"limit": limit, "raw_json": 1}
    _rotator = get_rotator()
    result = {
        "subreddit": subreddit,
        "sort": sort,
        "status": None,
        "posts": [],
        "error": None,
        "attempts": 0,
    }

    for attempt in range(retry_limit + 1):
        # Fresh stealth headers every request (different UA each time)
        headers = stealth_json_headers()
        result["attempts"] = attempt + 1
        await limiter.acquire()

        # Get a proxy — random selection to avoid sequential patterns
        proxy = _rotator.format_for_aiohttp() if _rotator.has_proxies() else None

        try:
            async with session.get(
                url, headers=headers, params=params,
                proxy=proxy,
                timeout=aiohttp.ClientTimeout(total=timeout_seconds),
                allow_redirects=False,
            ) as resp:
                result["status"] = resp.status

                if resp.status == 200:
                    _rotator.health.record_success()
                    data = await resp.json()
                    limiter.release()

                    posts = []
                    for child in data.get("data", {}).get("children", []):
                        if child.get("kind") != "t3":
                            continue
                        post = _parse_post(child["data"])
                        if post:
                            posts.append(post)
                    result["posts"] = posts
                    return result

                elif resp.status == 429:
                    # Rate limited — back off hard
                    _rotator.health.record_block()
                    wait = 5 * (attempt + 1) + random.uniform(JITTER_MIN, JITTER_MAX)
                    print(f"    [ASYNC] r/{subreddit} rate limited, waiting {wait:.1f}s...")
                    limiter.release()
                    await asyncio.sleep(wait)
                    continue

                elif resp.status == 403:
                    # BLOCKED — exponential backoff + rotate proxy
                    _rotator.health.record_block()
                    using_proxy = bool(proxy)
                    if proxy:
                        _rotator.cull_proxy(proxy)

                    backoff = BACKOFF_BASE * (2 ** attempt) + random.uniform(JITTER_MIN, JITTER_MAX)
                    if using_proxy:
                        print(f"    [ASYNC] r/{subreddit} 403 BLOCKED - rotating proxy, backoff {backoff:.1f}s (attempt {attempt + 1}/{retry_limit + 1})")
                    else:
                        print(f"    [ASYNC] r/{subreddit} 403 BLOCKED - direct mode, backoff {backoff:.1f}s (attempt {attempt + 1}/{retry_limit + 1})")
                    limiter.release()
                    await asyncio.sleep(backoff)
                    continue

                else:
                    body = (await resp.text())[:160].replace("\n", " ").strip()
                    result["error"] = f"HTTP {resp.status}: {body}" if body else f"HTTP {resp.status}"
                    _rotator.health.record_error()
                    print(f"    [ASYNC] r/{subreddit}/{sort} returned {resp.status}")
                    limiter.release()
                    if attempt < retry_limit:
                        await asyncio.sleep(2 * (attempt + 1))
                        continue
                    return result

        except asyncio.TimeoutError:
            limiter.release()
            _rotator.health.record_timeout()
            result["error"] = "TimeoutError"
            if attempt < retry_limit:
                await asyncio.sleep(2 * (attempt + 1))
            else:
                print(f"    [ASYNC] r/{subreddit}/{sort} timed out after {retry_limit + 1} attempts")
                return result

        except (aiohttp.ClientError, OSError) as e:
            limiter.release()
            _rotator.health.record_error()
            result["error"] = f"{type(e).__name__}: {e}"
            if attempt < retry_limit:
                await asyncio.sleep(2 * (attempt + 1))
            else:
                print(f"    [ASYNC] r/{subreddit}/{sort} failed after {retry_limit + 1} attempts: {e}")
                return result

        except Exception as e:
            limiter.release()
            _rotator.health.record_error()
            result["error"] = f"{type(e).__name__}: {e}"
            print(f"    [ASYNC] r/{subreddit}/{sort} unexpected error: {e}")
            return result

    return result


async def _fetch_subreddit_with_direct_fallback(
    session: aiohttp.ClientSession,
    limiter: RateLimiter,
    subreddit: str,
    sort: str = "new",
    limit: int = 100,
    retry_limit: int = RETRY_LIMIT,
    timeout_seconds: int = TIMEOUT_SECONDS,
) -> dict:
    """Retry a failed proxy-backed request directly before giving up."""
    _rotator = get_rotator()
    proxied = await _fetch_subreddit(
        session,
        limiter,
        subreddit,
        sort,
        limit,
        retry_limit=retry_limit,
        timeout_seconds=timeout_seconds,
    )
    if proxied.get("posts") or not _rotator.has_proxies():
        return proxied

    # Only retry direct when the proxy-backed request failed or returned no posts.
    url = f"https://www.reddit.com/r/{subreddit}/{sort}.json"
    params = {"limit": limit, "raw_json": 1}
    result = {
        "subreddit": subreddit,
        "sort": sort,
        "status": proxied.get("status"),
        "posts": [],
        "error": proxied.get("error"),
        "attempts": proxied.get("attempts", 0),
    }

    for attempt in range(retry_limit + 1):
        headers = stealth_json_headers()
        result["attempts"] = proxied.get("attempts", 0) + attempt + 1
        await limiter.acquire()
        try:
            async with session.get(
                url,
                headers=headers,
                params=params,
                proxy=None,
                timeout=aiohttp.ClientTimeout(total=timeout_seconds),
                allow_redirects=False,
            ) as resp:
                result["status"] = resp.status
                if resp.status == 429:
                    wait = 5 * (attempt + 1)
                    result["error"] = "HTTP 429 direct"
                    print(f"    [ASYNC] r/{subreddit} direct retry rate limited, waiting {wait}s...")
                    await asyncio.sleep(wait)
                    continue

                if resp.status == 403:
                    # Direct IP is blocked too — give up
                    result["error"] = "HTTP 403 direct"
                    if attempt < retry_limit:
                        await asyncio.sleep(BACKOFF_BASE * (2 ** attempt) + random.uniform(0, 2))
                        continue
                    print(f"    [ASYNC] r/{subreddit}/{sort} 403 on direct fallback")
                    return result

                if resp.status != 200:
                    body = (await resp.text())[:160].replace("\n", " ").strip()
                    result["error"] = f"HTTP {resp.status}: {body}" if body else f"HTTP {resp.status}"
                    if attempt < retry_limit:
                        await asyncio.sleep(2 * (attempt + 1))
                        continue
                    print(f"    [ASYNC] r/{subreddit}/{sort} direct fallback returned {resp.status}")
                    return result

                data = await resp.json()
                posts = []
                for child in data.get("data", {}).get("children", []):
                    if child.get("kind") != "t3":
                        continue
                    post = _parse_post(child["data"])
                    if post:
                        posts.append(post)
                result["posts"] = posts
                result["error"] = None
                return result
        except (asyncio.TimeoutError, aiohttp.ClientError) as e:
            result["error"] = f"{type(e).__name__}: {e}"
            if attempt < retry_limit:
                await asyncio.sleep(2 * (attempt + 1))
            else:
                print(f"    [ASYNC] r/{subreddit}/{sort} direct fallback failed after {retry_limit + 1} attempts: {e}")
                return result
        except Exception as e:
            result["error"] = f"{type(e).__name__}: {e}"
            print(f"    [ASYNC] r/{subreddit}/{sort} direct fallback unexpected error: {e}")
            return result
        finally:
            limiter.release()

    return result


async def scrape_all_async(
    subreddits: list[str] | None = None,
    sorts: list[str] | None = None,
    limit: int = 100,
    max_concurrent: int | None = None,
    on_progress=None,
    retry_limit: int = RETRY_LIMIT,
    request_timeout: int = TIMEOUT_SECONDS,
    allow_direct_fallback: bool = True,
    initial_jitter_max: float = 5.0,
) -> list[dict]:
    """
    Scrape all target subreddits concurrently with proxy support.

    Args:
        subreddits: list of subreddit names (default: TARGET_SUBREDDITS from config)
        sorts: list of sort modes (default: ["new", "hot"])
        limit: posts per request
        max_concurrent: max parallel connections (auto-detected based on proxy mode)
        on_progress: callback(completed, total, message)

    Returns:
        list of unique posts (deduplicated by external_id)
    """
    if not AIOHTTP_AVAILABLE:
        print("  [!] aiohttp not available — falling back to sync scraper")
        return _sync_fallback(subreddits or TARGET_SUBREDDITS)

    _rotator = get_rotator()
    _rotator.reset_health()  # Fresh health for this run

    subs = subreddits or TARGET_SUBREDDITS
    sort_modes = sorts or ["new", "hot"]
    stats = _empty_stats(subs, sort_modes)
    stats["proxy_mode"] = _rotator.mode

    # Auto-detect concurrency
    resolved_concurrent, resolved_delay = _get_concurrency_config()
    if max_concurrent:
        resolved_concurrent = max_concurrent

    limiter = RateLimiter(resolved_concurrent, resolved_delay)

    # Build task list: every (subreddit, sort) combo
    tasks_info = [(sub, sort) for sub in subs for sort in sort_modes]
    total = len(tasks_info)
    completed = 0

    start = time.time()
    proxy_note = f" via {_rotator.mode}" if _rotator.has_proxies() else " (direct — no proxy)"
    print(f"  [ASYNC] Scraping {len(subs)} subs × {len(sort_modes)} sorts = {total} requests{proxy_note}")

    seen = set()
    all_posts = []

    # Add random jitter per batch to look organic
    if _rotator.has_proxies():
        initial_jitter = random.uniform(0.2, max(0.2, initial_jitter_max))
        print(f"  [ASYNC] Initial jitter: {initial_jitter:.1f}s")
        await asyncio.sleep(initial_jitter)

    async with aiohttp.ClientSession() as session:
        # Create all tasks
        async def _task(sub, sort):
            if allow_direct_fallback:
                return await _fetch_subreddit_with_direct_fallback(
                    session,
                    limiter,
                    sub,
                    sort,
                    limit,
                    retry_limit=retry_limit,
                    timeout_seconds=request_timeout,
                )
            return await _fetch_subreddit(
                session,
                limiter,
                sub,
                sort,
                limit,
                retry_limit=retry_limit,
                timeout_seconds=request_timeout,
            )

        # Run all concurrently
        results = await asyncio.gather(
            *[_task(sub, sort) for sub, sort in tasks_info],
            return_exceptions=True,
        )

        for i, result in enumerate(results):
            completed += 1
            sub, sort = tasks_info[i]

            if isinstance(result, Exception):
                print(f"    [ASYNC] r/{sub}/{sort} exception: {result}")
                stats["failed_requests"] += 1
                stats["failures"].append({
                    "subreddit": sub,
                    "sort": sort,
                    "status": None,
                    "error": str(result),
                })
                continue

            status_key = str(result.get("status") or "unknown")
            stats["status_counts"][status_key] = stats["status_counts"].get(status_key, 0) + 1
            if result.get("error"):
                stats["failed_requests"] += 1
                stats["failures"].append({
                    "subreddit": sub,
                    "sort": sort,
                    "status": result.get("status"),
                    "error": result.get("error"),
                })
            else:
                stats["successful_requests"] += 1

            new_count = 0
            for post in result.get("posts", []):
                key = post["external_id"]
                if key not in seen:
                    seen.add(key)
                    all_posts.append(post)
                    new_count += 1

            if on_progress and completed % 10 == 0:
                on_progress(completed, total, f"Scraped {completed}/{total} — {len(all_posts)} unique posts")

    elapsed = time.time() - start
    subreddit_counts = Counter(p["subreddit"] for p in all_posts if p.get("subreddit"))
    stats["subreddit_post_counts"] = dict(subreddit_counts)
    stats["subreddits_with_posts"] = len(subreddit_counts)
    stats["zero_post_subreddits"] = sorted([sub for sub in subs if subreddit_counts.get(sub, 0) == 0])
    stats["elapsed_seconds"] = round(elapsed, 2)
    stats["proxy_health"] = _rotator.health.to_dict()

    scrape_all_async.last_run_stats = stats
    scrape_all_async.last_run_health = _rotator.health

    # Health summary
    health = _rotator.health
    health_icon = "✓" if not health.is_degraded else "⚠"
    print(f"  [ASYNC] Done: {len(all_posts)} unique posts from {len(subs)} subs in {elapsed:.1f}s")
    print(f"  [ASYNC] Proxy health: {health_icon} {health.success}/{health.total_requests} ok, {health.blocked} blocked, {health.timeouts} timeouts ({health.success_rate:.0%})")

    if health.is_degraded:
        print(f"  [ASYNC] ⚠ DEGRADED — success rate {health.success_rate:.0%} < 85% threshold")

    return all_posts


def _sync_fallback(subreddits):
    """Fallback sync scraper if aiohttp is not installed."""
    import requests
    from proxy_rotator import stealth_json_headers as _stealth_headers

    _rotator = get_rotator()
    _rotator.reset_health()

    all_posts = []
    seen = set()
    stats = _empty_stats(list(subreddits), ["new", "hot"])
    stats["proxy_mode"] = _rotator.mode

    for sub in subreddits:
        for sort in ("new", "hot"):
            try:
                url = f"https://www.reddit.com/r/{sub}/{sort}.json"
                headers = _stealth_headers()
                proxy_kwargs = {}
                proxies = _rotator.format_for_requests() if _rotator.has_proxies() else None
                if proxies:
                    proxy_kwargs["proxies"] = proxies

                resp = requests.get(
                    url, headers=headers,
                    params={"limit": 100, "raw_json": 1},
                    timeout=TIMEOUT_SECONDS,
                    allow_redirects=False,
                    **proxy_kwargs,
                )
                stats["status_counts"][str(resp.status_code)] = stats["status_counts"].get(str(resp.status_code), 0) + 1

                if resp.status_code == 403:
                    _rotator.health.record_block()
                    stats["failed_requests"] += 1
                    stats["failures"].append({
                        "subreddit": sub, "sort": sort,
                        "status": 403, "error": "HTTP 403 blocked",
                    })
                    time.sleep(BACKOFF_BASE + random.uniform(1, 3))
                    continue
                elif resp.status_code != 200:
                    _rotator.health.record_error()
                    stats["failed_requests"] += 1
                    stats["failures"].append({
                        "subreddit": sub, "sort": sort,
                        "status": resp.status_code, "error": f"HTTP {resp.status_code}",
                    })
                    continue

                _rotator.health.record_success()
                stats["successful_requests"] += 1
                for child in resp.json().get("data", {}).get("children", []):
                    if child.get("kind") != "t3":
                        continue
                    post = _parse_post(child["data"])
                    if post and post["external_id"] not in seen:
                        seen.add(post["external_id"])
                        all_posts.append(post)
            except Exception as e:
                _rotator.health.record_error()
                stats["failed_requests"] += 1
                stats["failures"].append({
                    "subreddit": sub, "sort": sort,
                    "status": None, "error": f"{type(e).__name__}: {e}",
                })
            time.sleep(2.5 + random.uniform(0, 1))
        print(f"    r/{sub}: {len([p for p in all_posts if p.get('subreddit') == sub])} posts")

    subreddit_counts = Counter(p["subreddit"] for p in all_posts if p.get("subreddit"))
    stats["subreddit_post_counts"] = dict(subreddit_counts)
    stats["subreddits_with_posts"] = len(subreddit_counts)
    stats["zero_post_subreddits"] = sorted([sub for sub in subreddits if subreddit_counts.get(sub, 0) == 0])
    stats["mode"] = "sync"
    stats["proxy_health"] = _rotator.health.to_dict()
    _sync_fallback.last_run_stats = stats
    _sync_fallback.last_run_health = _rotator.health

    health = _rotator.health
    print(f"  [SYNC] Proxy health: {health.success}/{health.total_requests} ok, {health.blocked} blocked ({health.success_rate:.0%})")

    return all_posts


# ═══════════════════════════════════════════════════════
# STANDALONE TEST
# ═══════════════════════════════════════════════════════

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  Async Reddit Scraper — Production Proxy Test")
    print("=" * 60)

    rotator = get_rotator()
    print(f"  Proxy: {rotator.summary()}")

    start = time.time()
    posts = asyncio.run(scrape_all_async())
    elapsed = time.time() - start

    print(f"\n  Results:")
    print(f"  Total unique posts: {len(posts)}")
    print(f"  Time: {elapsed:.1f}s")
    print(f"  Subreddits covered: {len(set(p['subreddit'] for p in posts))}")
    print(f"  Proxy health: {rotator.health}")

    # Show top subs by post count
    from collections import Counter
    sub_counts = Counter(p["subreddit"] for p in posts)
    print(f"\n  Top 10 subreddits:")
    for sub, count in sub_counts.most_common(10):
        print(f"    r/{sub}: {count} posts")
