"""
RedditPulse — IndieHackers Scraper v3 (Hardened)
Uses IH's Algolia search with dynamic key extraction.
Falls back to web scraping if Algolia keys rotate or become invalid.
"""

import re
import time
import json
import requests
from datetime import datetime
from proxy_rotator import get_rotator


IH_BASE = "https://www.indiehackers.com"

# ── Known Algolia credentials (extracted from IH's JavaScript bundle) ──
# These are PUBLIC keys (same ones the browser uses), but they can rotate.
_ALGOLIA_APP_ID = "N2WDTEH5BU"
_ALGOLIA_API_KEY = "bd4403a4e5e03e34346e9bea8d4a1834"
_keys_refreshed = False

_session = None
_rotator = get_rotator()


def _proxy_kwargs():
    proxies = _rotator.format_for_requests() if _rotator.has_proxies() else None
    return {"proxies": proxies} if proxies else {}


def _health_payload(posts=None, status="ok", error_code=None, error_detail=None, method=None):
    return {
        "posts": posts or [],
        "status": status,
        "error_code": error_code,
        "error_detail": error_detail,
        "method": method,
    }


def _get_session():
    """Persistent session for IH."""
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html, application/json, */*",
            "Accept-Language": "en-US,en;q=0.9",
        })
    return _session


def _refresh_algolia_keys():
    """
    Extract fresh Algolia keys from IH's JavaScript bundle.
    IH embeds these in their compiled JS — we scrape them dynamically.
    """
    global _ALGOLIA_APP_ID, _ALGOLIA_API_KEY, _keys_refreshed

    if _keys_refreshed:
        return True  # Already tried once this session

    _keys_refreshed = True
    session = _get_session()

    try:
        # Step 1: Load IH homepage to find JS bundle URLs
        resp = session.get(IH_BASE, timeout=15)
        if resp.status_code != 200:
            print(f"    [IH] Homepage fetch failed for key refresh ({resp.status_code})")
            return False

        html = resp.text

        # Step 1a: Parse the URL-encoded homepage config meta payload.
        app_match = re.search(r'applicationId%22%3A%22([^%]+)%22', html, re.IGNORECASE)
        api_match = re.search(r'searchOnlyApiKey%22%3A%22([a-f0-9]{32})%22', html, re.IGNORECASE)
        if app_match and api_match:
            _ALGOLIA_APP_ID = app_match.group(1)
            _ALGOLIA_API_KEY = api_match.group(1)
            print(f"    [IH] Fresh Algolia keys from homepage config: {_ALGOLIA_APP_ID}")
            return True

        # Step 2: Find JS bundle URLs that contain Algolia config
        # IH uses Next.js/Nuxt — keys are in the compiled chunks
        js_urls = re.findall(r'src=["\']([^"\']+\.js[^"\']*)["\']', html)

        # Also check for inline script with algolia config
        inline_app_id = re.search(r'algolia[_-]?app[_-]?id["\s:]+["\']([A-Z0-9]+)["\']', html, re.IGNORECASE)
        inline_api_key = re.search(r'algolia[_-]?api[_-]?key["\s:]+["\']([a-f0-9]{32})["\']', html, re.IGNORECASE)

        if inline_app_id and inline_api_key:
            _ALGOLIA_APP_ID = inline_app_id.group(1)
            _ALGOLIA_API_KEY = inline_api_key.group(1)
            print(f"    [IH] Fresh Algolia keys from inline: {_ALGOLIA_APP_ID}")
            return True

        # Step 3: Check a few JS bundles for the keys
        checked = 0
        for url in js_urls:
            if checked >= 5:
                break
            if not url.startswith("http"):
                url = f"{IH_BASE}{url}" if url.startswith("/") else f"{IH_BASE}/{url}"

            try:
                js_resp = session.get(url, timeout=10)
                if js_resp.status_code != 200:
                    continue
                js_text = js_resp.text

                app_match = re.search(r'["\']([A-Z0-9]{10,})["\']', js_text)
                key_match = re.search(r'["\']([a-f0-9]{32})["\']', js_text)

                if app_match and key_match:
                    candidate_app = app_match.group(1)
                    candidate_key = key_match.group(1)
                    # Verify it looks like Algolia (app ID is uppercase alphanumeric)
                    if len(candidate_app) >= 10 and candidate_app.isalnum():
                        _ALGOLIA_APP_ID = candidate_app
                        _ALGOLIA_API_KEY = candidate_key
                        print(f"    [IH] Fresh Algolia keys from JS bundle: {_ALGOLIA_APP_ID}")
                        return True

                checked += 1
            except Exception:
                checked += 1
                continue

    except Exception as e:
        print(f"    [IH] Key refresh failed: {e}")

    print("    [IH] Could not refresh Algolia keys — using cached ones")
    return False


def _search_ih_algolia(keyword, page=0, hits_per_page=10, max_retries=3):
    """
    Search IndieHackers via Algolia with retry + key refresh.
    """
    global _keys_refreshed

    algolia_url = f"https://{_ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries"
    headers = {
        "x-algolia-application-id": _ALGOLIA_APP_ID,
        "x-algolia-api-key": _ALGOLIA_API_KEY,
        "Content-Type": "application/json",
    }

    payload = {
        "requests": [
            {
                "indexName": "discussions",
                "params": f"query={keyword}&page={page}&hitsPerPage={hits_per_page}",
            }
        ]
    }

    if not _ALGOLIA_APP_ID or not _ALGOLIA_API_KEY:
        return {
            "hits": [],
            "total_pages": 0,
            "status": "failed",
            "error_code": "algolia_key_missing",
            "error_detail": "No Algolia credentials available",
        }

    for attempt in range(max_retries):
        try:
            resp = requests.post(algolia_url, json=payload, headers=headers, timeout=15)

            if resp.status_code == 200:
                data = resp.json()
                results = data.get("results", [])
                if results:
                    return {
                        "hits": results[0].get("hits", []),
                        "total_pages": results[0].get("nbPages", 0),
                        "status": "ok",
                        "error_code": None,
                        "error_detail": None,
                    }
                return {
                    "hits": [],
                    "total_pages": 0,
                    "status": "ok",
                    "error_code": None,
                    "error_detail": None,
                }

            elif resp.status_code in (401, 403):
                detail = f"Algolia auth failed ({resp.status_code})"
                print(f"    [IH] Algolia auth failed - falling back to web")
                return {
                    "hits": [],
                    "total_pages": 0,
                    "status": "failed",
                    "error_code": "algolia_auth_failed",
                    "error_detail": detail,
                }

            elif resp.status_code == 404:
                detail = "Algolia index missing or renamed"
                print("    [IH] Algolia index missing - falling back to web")
                return {
                    "hits": [],
                    "total_pages": 0,
                    "status": "failed",
                    "error_code": "algolia_index_missing",
                    "error_detail": detail,
                }

            elif resp.status_code == 429:
                wait = 2 * (attempt + 1)
                print(f"    [IH] Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue

            else:
                detail = f"Algolia returned {resp.status_code}"
                print(f"    [IH] Algolia returned {resp.status_code}")
                return {
                    "hits": [],
                    "total_pages": 0,
                    "status": "failed",
                    "error_code": "algolia_http_error",
                    "error_detail": detail,
                }

        except requests.exceptions.Timeout:
            print(f"    [IH] Algolia timeout on attempt {attempt + 1}")
            time.sleep(2)
        except requests.exceptions.ConnectionError:
            print(f"    [IH] Algolia connection error on attempt {attempt + 1}")
            time.sleep(3)
        except Exception as e:
            print(f"    [IH] Algolia error: {e}")
            return {
                "hits": [],
                "total_pages": 0,
                "status": "failed",
                "error_code": "algolia_exception",
                "error_detail": str(e),
            }

    return {
        "hits": [],
        "total_pages": 0,
        "status": "failed",
        "error_code": "algolia_retry_exhausted",
        "error_detail": "Algolia retries exhausted",
    }


def _scrape_ih_web(keyword):
    """
    Fallback: scrape IH search page directly.
    Works even if Algolia keys are completely dead.
    """
    session = _get_session()
    posts = []

    try:
        # Try the search endpoint with JSON accept
        resp = session.get(
            f"{IH_BASE}/search",
            params={"q": keyword},
            headers={"Accept": "application/json"},
            timeout=15,
            **_proxy_kwargs(),
        )

        if resp.status_code == 200:
            content_type = resp.headers.get("content-type", "")

            if "application/json" in content_type:
                data = resp.json()
                results = data if isinstance(data, list) else data.get("posts", data.get("results", []))
                for item in results:
                    post_id = str(item.get("id", item.get("_id", "")))
                    title = item.get("title", "")
                    body = item.get("body", item.get("text", ""))
                    posts.append(_normalize_ih_post(post_id, title, body, item))

            else:
                # Parse HTML response
                html = resp.text
                # Find post titles and links in the rendered HTML
                post_pattern = re.compile(
                    r'<a[^>]*href=["\'](/post/[^"\']+)["\'][^>]*>([^<]+)</a>',
                    re.IGNORECASE
                )
                for match in post_pattern.finditer(html):
                    path, title = match.group(1), match.group(2).strip()
                    if title and len(title) > 5:
                        post_id = path.split("/")[-1]
                        posts.append(_normalize_ih_post(post_id, title, "", {}))
        else:
            print(f"    [IH] Web search endpoint returned {resp.status_code} for '{keyword}'")

    except Exception as e:
        print(f"    [IH] Web scrape error: {e}")

    # Also try scraping the main feed pages for relevant content
    if not posts:
        try:
            for feed_path in ["/feed", "/popular"]:
                resp = session.get(f"{IH_BASE}{feed_path}", timeout=15, **_proxy_kwargs())
                if resp.status_code != 200:
                    continue

                html = resp.text
                kw_lower = keyword.lower()

                # Extract post links and titles
                post_blocks = re.findall(
                    r'<a[^>]*href=["\'](/post/([^"\']+))["\'][^>]*>\s*([^<]{10,200})\s*</a>',
                    html, re.IGNORECASE
                )
                for path, slug, title in post_blocks:
                    title = title.strip()
                    if kw_lower in title.lower():
                        posts.append(_normalize_ih_post(slug, title, "", {}))

                if posts:
                    break
                time.sleep(3)
        except Exception as e:
            print(f"    [IH] Feed fallback error: {e}")

    if not posts:
        print(f"    [IH] Web fallback returned 0 posts for '{keyword}'")

    return posts


def _normalize_ih_post(post_id, title, body, raw_item=None):
    """Create a normalized post dict from IH data."""
    raw_item = raw_item or {}
    body = body or ""
    if body:
        body = re.sub(r"<[^>]+>", " ", body).strip()

    return {
        "id": f"ih_{post_id}",
        "title": title,
        "selftext": body[:2000],
        "full_text": f"{title} {body}".strip()[:2500],
        "score": raw_item.get("upvotes", raw_item.get("votesCount", 0)),
        "num_comments": raw_item.get("commentCount", raw_item.get("commentsCount", 0)),
        "upvote_ratio": 0.8,
        "created_utc": _parse_timestamp(raw_item.get("createdAt", raw_item.get("created_at", ""))),
        "subreddit": "IndieHackers",
        "permalink": f"{IH_BASE}/post/{post_id}",
        "author": raw_item.get("authorUsername", raw_item.get("author", "[unknown]")),
        "url": "",
        "source": "indiehackers",
        "matched_phrases": [],
    }


def _parse_timestamp(ts_str):
    """Parse various timestamp formats to Unix epoch."""
    if not ts_str:
        return time.time()
    if isinstance(ts_str, (int, float)):
        if ts_str > 1e12:
            return ts_str / 1000
        return float(ts_str)
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return dt.timestamp()
    except (ValueError, TypeError):
        return time.time()


def run_ih_scrape(keywords, max_pages=2, return_health=False):
    """
    Run IndieHackers scrape with multi-layer fallback:
    1. Algolia search (best — full text search with scores)
    2. Dynamic key refresh if Algolia fails
    3. Web scraping fallback (always works)
    """
    global _keys_refreshed

    _keys_refreshed = False
    seen_ids = set()
    all_posts = []
    algolia_dead = False
    algolia_error_code = None
    algolia_error_detail = None

    refreshed = _refresh_algolia_keys()
    if refreshed:
        print("    [IH] Homepage key refresh succeeded before Algolia search")
    else:
        print("    [IH] Homepage key refresh failed - Algolia may fall back to web")

    for kw in keywords:
        print(f"    [IH] Searching: '{kw}'...")

        # Layer 1: Algolia (fast, structured data)
        if not algolia_dead:
            for page in range(max_pages):
                algolia_result = _search_ih_algolia(kw, page=page)
                hits = algolia_result.get("hits", [])
                total_pages = algolia_result.get("total_pages", 0)

                if not hits and page == 0:
                    algolia_dead = True
                    algolia_error_code = algolia_result.get("error_code")
                    algolia_error_detail = algolia_result.get("error_detail")
                    print("    [IH] Algolia unavailable - switching to web scraping")
                    break

                for hit in hits:
                    obj_id = hit.get("objectID", str(hit.get("id", "")))
                    if not obj_id or obj_id in seen_ids:
                        continue
                    seen_ids.add(obj_id)

                    title = hit.get("title", "")
                    body = hit.get("body", hit.get("text", ""))
                    all_posts.append(_normalize_ih_post(obj_id, title, body, hit))

                if page + 1 >= total_pages:
                    break
                time.sleep(0.5)

        # Layer 2: Web scraping fallback
        kw_posts = [p for p in all_posts if kw.lower() in p.get("full_text", "").lower()]
        if not kw_posts or algolia_dead:
            web_posts = _scrape_ih_web(kw)
            for p in web_posts:
                if p["id"] not in seen_ids:
                    seen_ids.add(p["id"])
                    all_posts.append(p)

        time.sleep(0.5)

    method = "web-scrape" if algolia_dead else "Algolia"
    print(f"    [IH] Total: {len(all_posts)} posts (via {method})")
    if not return_health:
        return all_posts

    if algolia_dead and all_posts:
        return _health_payload(
            posts=all_posts,
            status="degraded",
            error_code=algolia_error_code or "algolia_fallback",
            error_detail=algolia_error_detail or "Algolia unavailable - using web fallback",
            method=method,
        )

    if algolia_dead and not all_posts:
        return _health_payload(
            posts=[],
            status="failed",
            error_code=algolia_error_code or "algolia_fallback",
            error_detail=algolia_error_detail or "Algolia unavailable and web fallback returned 0 posts",
            method=method,
        )

    return _health_payload(posts=all_posts, status="ok", method=method)


if __name__ == "__main__":
    results = run_ih_scrape(["invoice tool", "SaaS idea", "frustrated"])
    print(f"\nFound {len(results)} IH posts")
    for p in results[:5]:
        print(f"  [{p['score']}⬆] {p['title'][:80]}")
