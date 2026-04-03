"""
RedditPulse — Free Proxy Harvester
Scrapes free proxy aggregator APIs, tests each one against Reddit,
saves working proxies for the main scraper to consume.

Run BEFORE each scraper job to refresh the pool.
Cost: $0. Reliability: ~15-30 working proxies per harvest.

Usage:
    python engine/proxy_harvester.py          # harvest + test + save
    python engine/proxy_harvester.py --quick  # quick test, fewer sources
"""

import os
import sys
import json
import time
import random
import requests
import concurrent.futures
from datetime import datetime, timezone

# ═══════════════════════════════════════════════════════
# FREE PROXY SOURCES
# ═══════════════════════════════════════════════════════

PROXY_SOURCES = [
    {
        "name": "ProxyScrape-HTTP",
        "url": "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=http&timeout=8000&anonymity=elite,anonymous",
        "parser": "text_lines",
    },
    {
        "name": "ProxyScrape-SOCKS5",
        "url": "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&protocol=socks5&timeout=8000",
        "parser": "text_lines",
    },
    {
        "name": "GeoNode",
        "url": "https://proxylist.geonode.com/api/proxy-list?limit=200&page=1&sort_by=lastChecked&sort_type=desc&protocols=http%2Chttps%2Csocks5&anonymityLevel=elite%2Canonymous",
        "parser": "geonode",
    },
    {
        "name": "ProxyList-Download-HTTP",
        "url": "https://www.proxy-list.download/api/v1/get?type=http&anon=elite",
        "parser": "text_lines_plain",
    },
    {
        "name": "ProxyList-Download-HTTPS",
        "url": "https://www.proxy-list.download/api/v1/get?type=https&anon=elite",
        "parser": "text_lines_plain",
    },
    {
        "name": "MoroSQLi-HTTP",
        "url": "https://raw.githubusercontent.com/morosQi/proxy/refs/heads/main/checked_proxies/http.txt",
        "parser": "text_lines_plain",
    },
    {
        "name": "TheSpeedX-HTTP",
        "url": "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt",
        "parser": "text_lines_plain",
    },
    {
        "name": "TheSpeedX-SOCKS5",
        "url": "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt",
        "parser": "text_lines_socks5",
    },
    {
        "name": "Clarketm",
        "url": "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
        "parser": "text_lines_plain",
    },
    {
        "name": "ShiftyTR",
        "url": "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
        "parser": "text_lines_plain",
    },
]

# Where to save working proxies
WORKING_PROXIES_FILE = os.path.join(os.path.dirname(__file__), "data", "working_proxies.json")
WORKING_PROXIES_TXT = os.path.join(os.path.dirname(__file__), "data", "working_proxies.txt")

# Reddit test targets — old.reddit.com is softer on blocks
REDDIT_TEST_URLS = [
    "https://old.reddit.com/r/all/new.json?limit=3&raw_json=1",
    "https://www.reddit.com/r/test/new.json?limit=2&raw_json=1",
]

# Stealth headers for testing
TEST_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:134.0) Gecko/20100101 Firefox/134.0",
]


def _stealth_headers():
    ua = random.choice(TEST_USER_AGENTS)
    return {
        "User-Agent": ua,
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.google.com/",
        "DNT": "1",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
        "Connection": "keep-alive",
    }


# ═══════════════════════════════════════════════════════
# PROXY PARSING
# ═══════════════════════════════════════════════════════

def _parse_proxies(source: dict) -> list[str]:
    """Fetch and parse proxies from a single source."""
    name = source["name"]
    url = source["url"]
    parser = source["parser"]

    try:
        resp = requests.get(url, timeout=15, headers={"User-Agent": random.choice(TEST_USER_AGENTS)})
        if resp.status_code != 200:
            print(f"  [{name}] HTTP {resp.status_code} — skipped")
            return []

        proxies = []

        if parser == "text_lines":
            # Format: protocol://ip:port per line
            for line in resp.text.strip().splitlines():
                line = line.strip()
                if line and ":" in line:
                    proxies.append(line)

        elif parser == "text_lines_plain":
            # Format: ip:port per line (assume http)
            for line in resp.text.strip().splitlines():
                line = line.strip()
                if line and ":" in line and not line.startswith("#"):
                    if not line.startswith("http"):
                        line = f"http://{line}"
                    proxies.append(line)

        elif parser == "text_lines_socks5":
            # Format: ip:port per line (SOCKS5)
            for line in resp.text.strip().splitlines():
                line = line.strip()
                if line and ":" in line:
                    proxies.append(f"socks5://{line}")

        elif parser == "geonode":
            data = resp.json()
            for item in data.get("data", []):
                ip = item.get("ip", "")
                port = item.get("port", "")
                protocols = item.get("protocols", [])
                if ip and port:
                    proto = "socks5" if "socks5" in protocols else "http"
                    proxies.append(f"{proto}://{ip}:{port}")

        print(f"  [{name}] {len(proxies)} proxies fetched")
        return proxies

    except Exception as e:
        print(f"  [{name}] ERROR: {str(e)[:80]}")
        return []


def harvest_all_proxies(quick: bool = False) -> list[str]:
    """Fetch proxies from all sources, deduplicate."""
    sources = PROXY_SOURCES[:6] if quick else PROXY_SOURCES
    print(f"\n  Harvesting from {len(sources)} sources...")

    all_proxies = []
    for source in sources:
        proxies = _parse_proxies(source)
        all_proxies.extend(proxies)
        time.sleep(0.5)

    # Deduplicate
    unique = list(dict.fromkeys(all_proxies))
    print(f"\n  Total harvested: {len(all_proxies)} → {len(unique)} unique proxies")
    return unique


# ═══════════════════════════════════════════════════════
# PROXY TESTING
# ═══════════════════════════════════════════════════════

def _test_single_proxy(proxy_url: str) -> dict | None:
    """Test one proxy against Reddit. Returns result dict or None."""
    headers = _stealth_headers()

    # Determine proxy dict format
    if proxy_url.startswith("socks5://"):
        proxy_dict = {"http": proxy_url, "https": proxy_url}
    else:
        proxy_dict = {"http": proxy_url, "https": proxy_url}

    for test_url in REDDIT_TEST_URLS:
        try:
            start = time.time()
            resp = requests.get(
                test_url,
                headers=headers,
                proxies=proxy_dict,
                timeout=12,
                allow_redirects=False,
            )
            elapsed = round(time.time() - start, 2)

            if resp.status_code == 200:
                data = resp.json()
                posts = data.get("data", {}).get("children", [])
                if posts:
                    return {
                        "proxy": proxy_url,
                        "status": 200,
                        "latency": elapsed,
                        "posts": len(posts),
                        "tested_at": datetime.now(timezone.utc).isoformat(),
                    }
        except Exception:
            continue
    return None


def test_proxies_parallel(proxies: list[str], max_workers: int = 30, max_working: int = 40) -> list[dict]:
    """Test proxies against Reddit in parallel. Stop early when we have enough."""
    print(f"\n  Testing {len(proxies)} proxies against Reddit (max {max_workers} parallel)...")
    print(f"  Target: {max_working} working proxies")

    working = []
    tested = 0
    failed = 0

    # Shuffle to avoid hammering same proxy region
    random.shuffle(proxies)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit in batches to allow early stopping
        batch_size = max_workers * 3
        for batch_start in range(0, len(proxies), batch_size):
            if len(working) >= max_working:
                break

            batch = proxies[batch_start:batch_start + batch_size]
            futures = {executor.submit(_test_single_proxy, p): p for p in batch}

            try:
              for future in concurrent.futures.as_completed(futures, timeout=60):
                tested += 1
                try:
                    result = future.result()
                    if result:
                        working.append(result)
                        latency = result["latency"]
                        print(f"    ✓ #{len(working):3d} | {result['proxy'][:50]:50s} | {latency:.1f}s | {result['posts']} posts")
                        if len(working) >= max_working:
                            break
                    else:
                        failed += 1
                except Exception:
                    failed += 1

                if tested % 50 == 0:
                    print(f"    ... tested {tested}/{len(proxies)}, working: {len(working)}, failed: {failed}")
            except (TimeoutError, concurrent.futures.TimeoutError):
                print(f"    ... batch timed out, moving to next (working so far: {len(working)})")

    # Sort by latency (fastest first)
    working.sort(key=lambda x: x["latency"])

    print(f"\n  Results: {len(working)} working / {tested} tested / {failed} failed")
    if working:
        avg_latency = sum(w["latency"] for w in working) / len(working)
        print(f"  Average latency: {avg_latency:.1f}s")
        print(f"  Fastest: {working[0]['proxy'][:50]} ({working[0]['latency']:.1f}s)")

    return working


# ═══════════════════════════════════════════════════════
# SAVE & LOAD
# ═══════════════════════════════════════════════════════

def save_working_proxies(working: list[dict]):
    """Save working proxies to JSON and TXT files."""
    os.makedirs(os.path.dirname(WORKING_PROXIES_FILE), exist_ok=True)

    # JSON (full details)
    with open(WORKING_PROXIES_FILE, "w") as f:
        json.dump({
            "harvested_at": datetime.now(timezone.utc).isoformat(),
            "count": len(working),
            "proxies": working,
        }, f, indent=2)

    # TXT (comma-separated for PROXY_LIST env var)
    proxy_urls = [w["proxy"] for w in working]
    with open(WORKING_PROXIES_TXT, "w") as f:
        f.write(",".join(proxy_urls))

    print(f"\n  Saved {len(working)} proxies to:")
    print(f"    {WORKING_PROXIES_FILE}")
    print(f"    {WORKING_PROXIES_TXT}")

    return proxy_urls


def load_working_proxies() -> list[str]:
    """Load previously saved working proxies."""
    if not os.path.exists(WORKING_PROXIES_FILE):
        return []
    try:
        with open(WORKING_PROXIES_FILE, "r") as f:
            data = json.load(f)
        proxies = [p["proxy"] for p in data.get("proxies", [])]
        age_str = data.get("harvested_at", "")
        if age_str:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(age_str)
            hours = age.total_seconds() / 3600
            print(f"  [Proxy] Loaded {len(proxies)} cached proxies (age: {hours:.1f}h)")
            if hours > 4:
                print(f"  [Proxy] ⚠ Proxies are {hours:.0f}h old — consider re-harvesting")
        return proxies
    except Exception as e:
        print(f"  [Proxy] Failed to load cache: {e}")
        return []


# ═══════════════════════════════════════════════════════
# AUTO-HARVEST (call from scraper_job.py pre-step)
# ═══════════════════════════════════════════════════════

def ensure_proxies(min_count: int = 8, max_age_hours: float = 3.0) -> list[str]:
    """
    Ensure we have enough working proxies. Re-harvests if cache is
    stale or has too few proxies. Called automatically before scraper runs.
    
    Returns list of proxy URLs ready for PROXY_LIST env var.
    """
    cached = []
    should_harvest = True

    if os.path.exists(WORKING_PROXIES_FILE):
        try:
            with open(WORKING_PROXIES_FILE, "r") as f:
                data = json.load(f)
            cached = [p["proxy"] for p in data.get("proxies", [])]
            age_str = data.get("harvested_at", "")
            if age_str:
                age = datetime.now(timezone.utc) - datetime.fromisoformat(age_str)
                hours = age.total_seconds() / 3600
                if len(cached) >= min_count and hours < max_age_hours:
                    print(f"  [Proxy] Cache valid: {len(cached)} proxies, {hours:.1f}h old")
                    should_harvest = False
                else:
                    reason = f"too few ({len(cached)})" if len(cached) < min_count else f"stale ({hours:.1f}h)"
                    print(f"  [Proxy] Cache invalid ({reason}) — re-harvesting...")
        except Exception:
            pass

    if should_harvest:
        raw = harvest_all_proxies(quick=False)
        if raw:
            working = test_proxies_parallel(raw, max_workers=40, max_working=40)
            if working:
                cached = save_working_proxies(working)
            else:
                print("  [Proxy] ⚠ No working proxies found! Scraper will run direct (expect 403s)")
        else:
            print("  [Proxy] ⚠ Harvest returned 0 proxies")

    # Set env var so proxy_rotator picks them up
    if cached:
        os.environ["PROXY_LIST"] = ",".join(cached)
        print(f"  [Proxy] PROXY_LIST set with {len(cached)} proxies")

    return cached


# ═══════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  RedditPulse — Free Proxy Harvester")
    print("=" * 60)

    quick = "--quick" in sys.argv
    start = time.time()

    # 1. Harvest
    raw_proxies = harvest_all_proxies(quick=quick)

    if not raw_proxies:
        print("\n  [!] No proxies harvested from any source. Network issue?")
        sys.exit(1)

    # 2. Test against Reddit
    working = test_proxies_parallel(
        raw_proxies,
        max_workers=40,
        max_working=40,
    )

    # 3. Save
    if working:
        save_working_proxies(working)
    else:
        print("\n  [!] No proxies passed Reddit test. All free proxies may be burned.")
        print("  Try again in 30 minutes, or use a paid residential proxy.")

    elapsed = round(time.time() - start, 1)
    print(f"\n  Done in {elapsed}s")
    print(f"  Working proxies: {len(working)}")

    if working:
        print(f"\n  To use immediately:")
        print(f"    export PROXY_LIST=\"{','.join(w['proxy'] for w in working[:5])},...\"")
    print("=" * 60)
