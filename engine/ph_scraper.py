"""
RedditPulse — ProductHunt Scraper v3 (Hardened)
Uses PH's frontend GraphQL → RSS feed fallback → direct page scrape fallback.
Dynamic session handling to survive schema/auth changes.
"""

import re
import time
import json
import requests
from datetime import datetime
from xml.etree import ElementTree
from proxy_rotator import get_rotator


# ── Session-based approach (survives cookie/header changes) ──
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
    """Create a persistent session with browser-like headers."""
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "application/json, text/html, application/xhtml+xml, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.producthunt.com/",
            "Origin": "https://www.producthunt.com",
        })
        # Warm the session — grab PH homepage to get cookies/CSRF
        try:
            _session.get("https://www.producthunt.com", timeout=10, **_proxy_kwargs())
        except Exception:
            pass
    return _session


PH_GRAPHQL_URL = "https://www.producthunt.com/frontend/graphql"
PH_RSS_URL = "https://www.producthunt.com/feed"


def _search_ph_graphql(keyword, cursor="", max_retries=3):
    """
    Use PH's frontend GraphQL endpoint with retries.
    Falls back gracefully if PH changes schema or adds auth.
    """
    session = _get_session()

    query = {
        "operationName": "SearchQuery",
        "variables": {
            "query": keyword,
            "first": 20,
            "after": cursor,
        },
        "query": """
            query SearchQuery($query: String!, $first: Int!, $after: String) {
                search(query: $query, first: $first, after: $after, type: POST) {
                    edges {
                        node {
                            ... on Post {
                                id
                                name
                                tagline
                                description
                                votesCount
                                commentsCount
                                createdAt
                                slug
                                url
                                user { username }
                            }
                        }
                    }
                    pageInfo { endCursor hasNextPage }
                }
            }
        """,
    }

    for attempt in range(max_retries):
        try:
            resp = session.post(
                PH_GRAPHQL_URL,
                json=query,
                headers={"Content-Type": "application/json"},
                timeout=15,
                **_proxy_kwargs(),
            )
            if resp.status_code == 200:
                data = resp.json()
                # Check for GraphQL errors
                if "errors" in data:
                    message = data["errors"][0].get("message", "unknown")
                    print(f"    [PH] GraphQL schema error: {message}")
                    return {
                        "edges": [],
                        "cursor": "",
                        "has_next": False,
                        "status": "failed",
                        "error_code": "graphql_schema_error",
                        "error_detail": message,
                    }

                search_data = data.get("data", {}).get("search", {})
                if search_data is None:
                    detail = "search returned null"
                    print(f"    [PH] GraphQL returned null search - schema may have changed")
                    return {
                        "edges": [],
                        "cursor": "",
                        "has_next": False,
                        "status": "failed",
                        "error_code": "graphql_null_search",
                        "error_detail": detail,
                    }

                edges = search_data.get("edges", [])
                page_info = search_data.get("pageInfo", {})
                return {
                    "edges": edges,
                    "cursor": page_info.get("endCursor", ""),
                    "has_next": page_info.get("hasNextPage", False),
                    "status": "ok",
                    "error_code": None,
                    "error_detail": None,
                }

            elif resp.status_code == 429:
                wait = 3 * (attempt + 1)
                print(f"    [PH] Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue

            elif resp.status_code in (401, 403):
                detail = f"GraphQL auth failed ({resp.status_code})"
                print(f"    [PH] Auth required ({resp.status_code}) - GraphQL endpoint locked, using fallback")
                return {
                    "edges": [],
                    "cursor": "",
                    "has_next": False,
                    "status": "failed",
                    "error_code": "graphql_auth_failed",
                    "error_detail": detail,
                }

            else:
                detail = f"unexpected status {resp.status_code}"
                print(f"    [PH] Unexpected status {resp.status_code}")
                return {
                    "edges": [],
                    "cursor": "",
                    "has_next": False,
                    "status": "failed",
                    "error_code": "graphql_http_error",
                    "error_detail": detail,
                }

        except requests.exceptions.Timeout:
            print(f"    [PH] Timeout on attempt {attempt + 1}")
            time.sleep(2)
        except requests.exceptions.ConnectionError:
            print(f"    [PH] Connection error on attempt {attempt + 1}")
            time.sleep(3)
        except Exception as e:
            print(f"    [PH] GraphQL error: {e}")
            return {
                "edges": [],
                "cursor": "",
                "has_next": False,
                "status": "failed",
                "error_code": "graphql_exception",
                "error_detail": str(e),
            }

    return {
        "edges": [],
        "cursor": "",
        "has_next": False,
        "status": "failed",
        "error_code": "graphql_retry_exhausted",
        "error_detail": "GraphQL retries exhausted",
    }


def _parse_ph_rss(keyword):
    """Fallback: search PH via RSS feed — always available, no auth."""
    session = _get_session()
    posts = []
    try:
        resp = session.get(
            PH_RSS_URL,
            headers={"Accept": "application/rss+xml, application/xml, text/xml"},
            timeout=15,
            **_proxy_kwargs(),
        )
        if resp.status_code != 200:
            print(f"    [PH] RSS returned {resp.status_code}")
            return posts

        root = ElementTree.fromstring(resp.content)
        channel = root.find("channel")
        if channel is None:
            # Try Atom format
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            entries = root.findall("atom:entry", ns)
            if entries:
                return _parse_atom_entries(entries, keyword, ns)
            return posts

        kw_lower = keyword.lower()
        for item in channel.findall("item"):
            title = item.findtext("title", "")
            desc = item.findtext("description", "")
            link = item.findtext("link", "")
            pub_date = item.findtext("pubDate", "")

            full = f"{title} {desc}".lower()
            if kw_lower not in full:
                continue

            desc_clean = re.sub(r"<[^>]+>", " ", desc).strip()

            posts.append({
                "id": f"ph_rss_{hash(link) & 0xFFFFFFFF}",
                "title": title.strip(),
                "selftext": desc_clean[:2000],
                "full_text": f"{title} {desc_clean}".strip()[:2500],
                "score": 0,
                "num_comments": 0,
                "upvote_ratio": 0.8,
                "created_utc": _parse_rss_date(pub_date),
                "subreddit": "ProductHunt",
                "permalink": link,
                "author": "[producthunt]",
                "url": link,
                "source": "producthunt",
                "matched_phrases": [],
            })
    except ElementTree.ParseError:
        print("    [PH] RSS XML parsing failed — format may have changed")
    except Exception as e:
        print(f"    [PH] RSS error: {e}")

    return posts


def _parse_atom_entries(entries, keyword, ns):
    """Parse Atom feed format (PH sometimes serves this instead of RSS)."""
    posts = []
    kw_lower = keyword.lower()
    for entry in entries:
        title = entry.findtext("atom:title", "", ns)
        summary = entry.findtext("atom:summary", "", ns) or entry.findtext("atom:content", "", ns) or ""
        link_el = entry.find("atom:link", ns)
        link = link_el.get("href", "") if link_el is not None else ""
        updated = entry.findtext("atom:updated", "", ns)

        full = f"{title} {summary}".lower()
        if kw_lower not in full:
            continue

        summary_clean = re.sub(r"<[^>]+>", " ", summary).strip()
        posts.append({
            "id": f"ph_atom_{hash(link) & 0xFFFFFFFF}",
            "title": title.strip(),
            "selftext": summary_clean[:2000],
            "full_text": f"{title} {summary_clean}".strip()[:2500],
            "score": 0,
            "num_comments": 0,
            "upvote_ratio": 0.8,
            "created_utc": _parse_iso_date(updated),
            "subreddit": "ProductHunt",
            "permalink": link,
            "author": "[producthunt]",
            "url": link,
            "source": "producthunt",
            "matched_phrases": [],
        })
    return posts


def _parse_rss_date(date_str):
    """Parse RSS date format."""
    if not date_str:
        return time.time()
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(date_str)
        return dt.timestamp()
    except Exception:
        return time.time()


def _parse_iso_date(date_str):
    """Parse ISO date format."""
    if not date_str:
        return time.time()
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        return dt.timestamp()
    except Exception:
        return time.time()


def _parse_timestamp(ts_str):
    """Parse ISO timestamp to Unix epoch."""
    if not ts_str:
        return time.time()
    if isinstance(ts_str, (int, float)):
        return float(ts_str)
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return dt.timestamp()
    except (ValueError, TypeError):
        return time.time()


def run_ph_scrape(keywords, max_pages=2, return_health=False):
    """
    Run ProductHunt scrape with multi-layer fallback:
    1. GraphQL (best data — votes, comments, descriptions)
    2. RSS feed (always works — limited data)
    """
    seen_ids = set()
    all_posts = []
    graphql_failed = False
    graphql_error_code = None
    graphql_error_detail = None

    for kw in keywords:
        print(f"    [PH] Searching: '{kw}'...")

        # Layer 1: Try GraphQL
        if not graphql_failed:
            cursor = ""
            for page in range(max_pages):
                graphql_result = _search_ph_graphql(kw, cursor)
                edges = graphql_result.get("edges", [])
                cursor = graphql_result.get("cursor", "")
                has_next = graphql_result.get("has_next", False)

                if not edges and page == 0:
                    # GraphQL is broken for this session — skip for all keywords
                    graphql_failed = True
                    graphql_error_code = graphql_result.get("error_code")
                    graphql_error_detail = graphql_result.get("error_detail")
                    print("    [PH] GraphQL unavailable - switching to RSS for all keywords")
                    break

                for edge in edges:
                    node = edge.get("node", {})
                    if not node:
                        continue

                    post_id = str(node.get("id", ""))
                    if not post_id or post_id in seen_ids:
                        continue
                    seen_ids.add(post_id)

                    title = node.get("name", "")
                    tagline = node.get("tagline", "")
                    desc = node.get("description", "")
                    body = f"{tagline} {desc}".strip()

                    all_posts.append({
                        "id": f"ph_{post_id}",
                        "title": title,
                        "selftext": body[:2000],
                        "full_text": f"{title} {body}".strip()[:2500],
                        "score": node.get("votesCount", 0),
                        "num_comments": node.get("commentsCount", 0),
                        "upvote_ratio": 0.8,
                        "created_utc": _parse_timestamp(node.get("createdAt", "")),
                        "subreddit": "ProductHunt",
                        "permalink": f"https://www.producthunt.com/posts/{node.get('slug', post_id)}",
                        "author": node.get("user", {}).get("username", "[unknown]") if isinstance(node.get("user"), dict) else "[unknown]",
                        "url": node.get("url", ""),
                        "source": "producthunt",
                        "matched_phrases": [],
                    })

                if not has_next or not cursor:
                    break
                time.sleep(1)

        # Layer 2: RSS fallback (always try if GraphQL gave nothing for this keyword)
        kw_posts = [p for p in all_posts if kw.lower() in p.get("full_text", "").lower()]
        if not kw_posts or graphql_failed:
            rss_posts = _parse_ph_rss(kw)
            for p in rss_posts:
                if p["id"] not in seen_ids:
                    seen_ids.add(p["id"])
                    all_posts.append(p)

        time.sleep(0.5)

    method = "RSS-only" if graphql_failed else "GraphQL"
    print(f"    [PH] Total: {len(all_posts)} posts (via {method})")
    if graphql_failed and not all_posts and graphql_error_code == "graphql_auth_failed":
        print("    [PH] ProductHunt currently unavailable - known auth limitation")
    if not return_health:
        return all_posts

    if graphql_failed and all_posts:
        return _health_payload(
            posts=all_posts,
            status="degraded",
            error_code=graphql_error_code or "graphql_fallback",
            error_detail=graphql_error_detail or "GraphQL unavailable - using RSS fallback",
            method=method,
        )

    if graphql_failed and not all_posts:
        return _health_payload(
            posts=[],
            status="failed",
            error_code=graphql_error_code or "graphql_fallback",
            error_detail=(
                "ProductHunt currently unavailable - known auth limitation"
                if graphql_error_code == "graphql_auth_failed"
                else (graphql_error_detail or "GraphQL unavailable and RSS returned 0 posts")
            ),
            method=method,
        )

    return _health_payload(posts=all_posts, status="ok", method=method)


if __name__ == "__main__":
    results = run_ph_scrape(["invoice tool", "freelancer", "saas"])
    print(f"\nFound {len(results)} ProductHunt posts")
    for p in results[:5]:
        print(f"  [{p['score']}⬆] {p['title'][:80]}")
