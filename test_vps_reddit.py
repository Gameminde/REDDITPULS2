"""Quick Reddit smoke test using the harvested proxy pool."""

import os
import random
import sys
import time

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "engine"))

from proxy_harvester import ensure_proxies
from proxy_rotator import get_rotator, reset_rotator, stealth_json_headers


def main() -> int:
    rotator = get_rotator()
    if not rotator.has_proxies():
        print("Proxy pool empty - harvesting before smoke test...")
        found = ensure_proxies(min_count=5, max_age_hours=3.0)
        if found:
            rotator = reset_rotator()

    print(f"Proxy mode: {rotator.mode}")
    print(f"Has proxies: {rotator.has_proxies()}")
    print(f"Live proxies: {rotator.live_count()}")
    print()

    test_subs = ["SaaS", "Entrepreneur", "startups", "smallbusiness", "webdev"]
    overall_success = 0

    for sub in test_subs:
        headers = stealth_json_headers()
        url = f"https://old.reddit.com/r/{sub}/new.json?limit=5&raw_json=1"

        for attempt in range(3):
            proxy_url = rotator.next_proxy()
            proxy_dict = {"http": proxy_url, "https": proxy_url} if proxy_url else None

            try:
                resp = requests.get(
                    url,
                    headers=headers,
                    proxies=proxy_dict,
                    timeout=15,
                    allow_redirects=False,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    posts = data.get("data", {}).get("children", [])
                    via = proxy_url[:40] if proxy_url else "direct"
                    print(f"r/{sub}: HTTP 200 - {len(posts)} posts OK (via {via})")
                    if posts:
                        print(f"  -> {posts[0]['data']['title'][:80]}")
                    rotator.health.record_success()
                    overall_success += 1
                    break

                if resp.status_code == 403:
                    print(f"r/{sub}: HTTP 403 attempt {attempt + 1} - rotating proxy")
                    rotator.health.record_block()
                    if proxy_url:
                        rotator.mark_dead(proxy_url)
                    time.sleep(2)
                    continue

                print(f"r/{sub}: HTTP {resp.status_code}")
                rotator.health.record_error()
                break
            except Exception as exc:
                print(f"r/{sub}: ERROR attempt {attempt + 1} - {str(exc)[:80]}")
                rotator.health.record_error()
                time.sleep(1)
        else:
            print(f"r/{sub}: FAILED after 3 attempts")

        time.sleep(1.5 + random.uniform(0, 1))

    print()
    print(f"Health: {rotator.health}")
    print(f"Success rate: {rotator.health.success_rate:.0%}")
    print(f"Live proxies remaining: {rotator.live_count()}")

    if overall_success == len(test_subs):
        print("STATUS: WORKING - real Reddit posts are flowing through the proxy pool")
        return 0
    if overall_success > 0:
        print("STATUS: PARTIAL - some subreddits worked, proxy pool may need refresh")
        return 1

    print("STATUS: BLOCKED - proxy pool did not return usable Reddit responses")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
