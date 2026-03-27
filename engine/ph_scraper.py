"""
Product Hunt scraper with an official API primary path.

Priority order:
1. Official Product Hunt GraphQL API
2. Frontend GraphQL fallback
3. RSS fallback
"""

from __future__ import annotations

import os
import re
import time
from datetime import datetime
from xml.etree import ElementTree

import requests

from proxy_rotator import get_rotator


PH_OFFICIAL_GRAPHQL_URL = "https://api.producthunt.com/v2/api/graphql"
PH_OAUTH_URL = "https://api.producthunt.com/v2/oauth/token"
PH_FRONTEND_GRAPHQL_URL = "https://www.producthunt.com/frontend/graphql"
PH_RSS_URL = "https://www.producthunt.com/feed"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

_session = None
_rotator = get_rotator()
_official_token = None
_official_token_source = None


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
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers.update({
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/html, application/xhtml+xml, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.producthunt.com/",
            "Origin": "https://www.producthunt.com",
        })
        try:
            _session.get("https://www.producthunt.com", timeout=10, **_proxy_kwargs())
        except Exception:
            pass
    return _session


def _parse_rss_date(date_str):
    if not date_str:
        return time.time()
    try:
        from email.utils import parsedate_to_datetime

        return parsedate_to_datetime(date_str).timestamp()
    except Exception:
        return time.time()


def _parse_iso_date(date_str):
    if not date_str:
        return time.time()
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00")).timestamp()
    except Exception:
        return time.time()


def _parse_timestamp(value):
    if not value:
        return time.time()
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except Exception:
        return time.time()


def _official_auth_token():
    global _official_token, _official_token_source
    if _official_token:
        return _official_token

    developer_token = (
        os.environ.get("PRODUCTHUNT_DEVELOPER_TOKEN", "").strip()
        or os.environ.get("PH_DEVELOPER_TOKEN", "").strip()
        or os.environ.get("PH_API_KEY", "").strip()
    )
    if developer_token:
        _official_token = developer_token
        _official_token_source = "developer_token"
        return _official_token

    client_id = (
        os.environ.get("PRODUCTHUNT_API_KEY", "").strip()
        or os.environ.get("PH_CLIENT_ID", "").strip()
    )
    client_secret = (
        os.environ.get("PRODUCTHUNT_API_SECRET", "").strip()
        or os.environ.get("PH_CLIENT_SECRET", "").strip()
    )
    if not client_id or not client_secret:
        return ""

    try:
        response = requests.post(
            PH_OAUTH_URL,
            json={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "client_credentials",
            },
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=20,
        )
        if response.status_code != 200:
            return ""
        payload = response.json() or {}
        token = str(payload.get("access_token") or "").strip()
        if token:
            _official_token = token
            _official_token_source = "oauth_client_credentials"
            return _official_token
    except Exception:
        return ""
    return ""


def _maybe_wait_for_rate_limit(resp):
    try:
        remaining = int(resp.headers.get("X-Rate-Limit-Remaining") or "0")
        reset_seconds = int(resp.headers.get("X-Rate-Limit-Reset") or "0")
    except Exception:
        return
    if resp.status_code == 429:
        wait_seconds = max(1, min(reset_seconds or 60, 120))
        print(f"    [PH] Official API rate limited, waiting {wait_seconds}s...")
        time.sleep(wait_seconds)
        return
    if remaining and remaining <= 25 and reset_seconds:
        wait_seconds = max(1, min(reset_seconds, 60))
        print(f"    [PH] Official API nearing limit ({remaining} left), waiting {wait_seconds}s...")
        time.sleep(wait_seconds)


def _post_matches_keyword(node, keyword):
    phrase = str(keyword or "").strip().lower()
    if not phrase:
        return True
    topics = node.get("topics") or {}
    text_parts = [
        node.get("name", ""),
        node.get("tagline", ""),
        node.get("description", ""),
    ]
    for edge in topics.get("edges", []) or []:
        topic_node = edge.get("node", {}) or {}
        text_parts.append(topic_node.get("name", ""))
        text_parts.append(topic_node.get("slug", ""))
    haystack = " ".join(str(part or "") for part in text_parts).lower()
    if phrase in haystack:
        return True
    terms = [term for term in re.findall(r"[a-z0-9][a-z0-9+/-]{2,}", phrase) if len(term) >= 3]
    return bool(terms) and all(term in haystack for term in terms)


def _official_node_to_post(node, matched_keywords=None):
    topics = []
    for edge in ((node.get("topics") or {}).get("edges") or []):
        topic_node = edge.get("node", {}) or {}
        topic_name = str(topic_node.get("name") or topic_node.get("slug") or "").strip()
        if topic_name:
            topics.append(topic_name)
    body = " ".join(
        part for part in [node.get("tagline", ""), node.get("description", ""), " | ".join(topics)] if part
    ).strip()
    return {
        "id": f"ph_{node.get('id')}",
        "title": str(node.get("name") or "").strip(),
        "selftext": body[:2000],
        "full_text": f"{node.get('name', '')} {body}".strip()[:2500],
        "score": node.get("votesCount", 0),
        "num_comments": node.get("commentsCount", 0),
        "upvote_ratio": 0.8,
        "created_utc": _parse_timestamp(node.get("createdAt", "")),
        "subreddit": "ProductHunt",
        "permalink": str(node.get("url") or "").strip(),
        "author": "[producthunt-api]",
        "url": str(node.get("url") or "").strip(),
        "source": "producthunt",
        "matched_phrases": list(matched_keywords or []),
        "topics": topics,
    }


def _search_ph_official(keywords, max_pages=2, page_size=20):
    token = _official_auth_token()
    if not token:
        return _health_payload(
            posts=[],
            status="failed",
            error_code="official_token_missing",
            error_detail="Product Hunt official API token is not configured",
            method="Official API",
        )

    session = requests.Session()
    session.headers.update({
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "RedditPulse/1.0",
    })

    seen_ids = set()
    posts = []
    cursor = None

    for _ in range(max_pages):
        after_clause = f', after: "{cursor}"' if cursor else ""
        query = f"""
            query {{
              posts(first: {page_size}{after_clause}) {{
                edges {{
                  cursor
                  node {{
                    id
                    name
                    tagline
                    description
                    votesCount
                    commentsCount
                    createdAt
                    url
                    slug
                    topics(first: 3) {{
                      edges {{
                        node {{
                          name
                          slug
                        }}
                      }}
                    }}
                  }}
                }}
                pageInfo {{
                  endCursor
                  hasNextPage
                }}
              }}
            }}
        """
        try:
            response = session.post(PH_OFFICIAL_GRAPHQL_URL, json={"query": query}, timeout=20)
        except requests.exceptions.RequestException as exc:
            return _health_payload(
                posts=posts,
                status="failed" if not posts else "degraded",
                error_code="official_transport_error",
                error_detail=str(exc)[:200],
                method="Official API",
            )

        _maybe_wait_for_rate_limit(response)
        if response.status_code == 429:
            return _health_payload(
                posts=posts,
                status="failed" if not posts else "degraded",
                error_code="official_rate_limited",
                error_detail="Product Hunt official API rate limit reached",
                method="Official API",
            )
        if response.status_code != 200:
            return _health_payload(
                posts=posts,
                status="failed" if not posts else "degraded",
                error_code=f"official_http_{response.status_code}",
                error_detail=response.text[:200],
                method="Official API",
            )

        payload = response.json() or {}
        errors = payload.get("errors") or []
        if errors:
            return _health_payload(
                posts=posts,
                status="failed" if not posts else "degraded",
                error_code="official_graphql_error",
                error_detail=str(errors[0].get("message") or "unknown")[:200],
                method="Official API",
            )

        posts_connection = ((payload.get("data") or {}).get("posts") or {})
        edges = posts_connection.get("edges") or []
        for edge in edges:
            node = edge.get("node", {}) or {}
            post_id = str(node.get("id") or "").strip()
            if not post_id or post_id in seen_ids:
                continue
            matched = [kw for kw in (keywords or []) if _post_matches_keyword(node, kw)]
            if not matched:
                continue
            seen_ids.add(post_id)
            posts.append(_official_node_to_post(node, matched_keywords=matched))

        page_info = posts_connection.get("pageInfo") or {}
        cursor = page_info.get("endCursor")
        if not page_info.get("hasNextPage") or not cursor:
            break
        time.sleep(0.4)

    if posts:
        return _health_payload(posts=posts, status="ok", method=f"Official API ({_official_token_source or 'token'})")
    return _health_payload(
        posts=[],
        status="empty",
        error_code="official_no_keyword_match",
        error_detail="Official API returned recent posts but none matched the requested keywords",
        method=f"Official API ({_official_token_source or 'token'})",
    )


def _search_ph_graphql(keyword, cursor="", max_retries=3):
    session = _get_session()
    query = {
        "operationName": "SearchQuery",
        "variables": {"query": keyword, "first": 20, "after": cursor},
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
                PH_FRONTEND_GRAPHQL_URL,
                json=query,
                headers={"Content-Type": "application/json"},
                timeout=15,
                **_proxy_kwargs(),
            )
            if resp.status_code == 200:
                data = resp.json()
                if "errors" in data:
                    message = data["errors"][0].get("message", "unknown")
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
                    return {
                        "edges": [],
                        "cursor": "",
                        "has_next": False,
                        "status": "failed",
                        "error_code": "graphql_null_search",
                        "error_detail": "search returned null",
                    }

                page_info = search_data.get("pageInfo", {})
                return {
                    "edges": search_data.get("edges", []),
                    "cursor": page_info.get("endCursor", ""),
                    "has_next": page_info.get("hasNextPage", False),
                    "status": "ok",
                    "error_code": None,
                    "error_detail": None,
                }

            if resp.status_code == 429:
                wait = 3 * (attempt + 1)
                print(f"    [PH] Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue

            if resp.status_code in (401, 403):
                body = resp.text.lower()
                if "just a moment" in body or "cloudflare" in body:
                    return {
                        "edges": [],
                        "cursor": "",
                        "has_next": False,
                        "status": "failed",
                        "error_code": "cloudflare_block",
                        "error_detail": f"GraphQL blocked by Cloudflare ({resp.status_code})",
                    }
                return {
                    "edges": [],
                    "cursor": "",
                    "has_next": False,
                    "status": "failed",
                    "error_code": "graphql_auth_failed",
                    "error_detail": f"GraphQL auth failed ({resp.status_code})",
                }

            return {
                "edges": [],
                "cursor": "",
                "has_next": False,
                "status": "failed",
                "error_code": "graphql_http_error",
                "error_detail": f"unexpected status {resp.status_code}",
            }
        except requests.exceptions.Timeout:
            time.sleep(2)
        except requests.exceptions.ConnectionError:
            time.sleep(3)
        except Exception as exc:
            return {
                "edges": [],
                "cursor": "",
                "has_next": False,
                "status": "failed",
                "error_code": "graphql_exception",
                "error_detail": str(exc)[:200],
            }

    return {
        "edges": [],
        "cursor": "",
        "has_next": False,
        "status": "failed",
        "error_code": "graphql_retry_exhausted",
        "error_detail": "GraphQL retries exhausted",
    }


def _parse_atom_entries(entries, keyword, ns):
    posts = []
    keyword_lower = keyword.lower()
    for entry in entries:
        title = entry.findtext("atom:title", "", ns)
        summary = entry.findtext("atom:summary", "", ns) or entry.findtext("atom:content", "", ns) or ""
        link_el = entry.find("atom:link", ns)
        link = link_el.get("href", "") if link_el is not None else ""
        updated = entry.findtext("atom:updated", "", ns)

        full = f"{title} {summary}".lower()
        if keyword_lower not in full:
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


def _parse_ph_rss(keyword):
    session = _get_session()
    posts = []
    try:
        response = session.get(
            PH_RSS_URL,
            headers={"Accept": "application/rss+xml, application/xml, text/xml"},
            timeout=15,
            **_proxy_kwargs(),
        )
        if response.status_code != 200:
            print(f"    [PH] RSS returned {response.status_code}")
            return posts

        root = ElementTree.fromstring(response.content)
        channel = root.find("channel")
        if channel is None:
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            entries = root.findall("atom:entry", ns)
            return _parse_atom_entries(entries, keyword, ns) if entries else posts

        keyword_lower = keyword.lower()
        for item in channel.findall("item"):
            title = item.findtext("title", "")
            desc = item.findtext("description", "")
            link = item.findtext("link", "")
            pub_date = item.findtext("pubDate", "")
            full = f"{title} {desc}".lower()
            if keyword_lower not in full:
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
        print("    [PH] RSS XML parsing failed - format may have changed")
    except Exception as exc:
        print(f"    [PH] RSS error: {exc}")
    return posts


def run_ph_scrape(keywords, max_pages=2, return_health=False):
    official = _search_ph_official(keywords, max_pages=max_pages, page_size=20)
    official_posts = list(official.get("posts") or [])
    if official_posts:
        print(f"    [PH] Total: {len(official_posts)} posts (via {official.get('method', 'Official API')})")
        return official if return_health else official_posts
    if official.get("status") == "failed":
        detail = official.get("error_detail")
        print(f"    [PH] Official API unavailable{': ' + detail if detail else ''}")

    seen_ids = set()
    all_posts = []
    graphql_failed = False
    graphql_error_code = None
    graphql_error_detail = None

    for keyword in keywords:
        print(f"    [PH] Searching: '{keyword}'...")
        if not graphql_failed:
            cursor = ""
            for _ in range(max_pages):
                graphql_result = _search_ph_graphql(keyword, cursor)
                edges = graphql_result.get("edges", [])
                cursor = graphql_result.get("cursor", "")
                has_next = graphql_result.get("has_next", False)

                if not edges:
                    graphql_failed = True
                    graphql_error_code = graphql_result.get("error_code")
                    graphql_error_detail = graphql_result.get("error_detail")
                    print("    [PH] GraphQL unavailable - switching to RSS for all keywords")
                    break

                for edge in edges:
                    node = edge.get("node", {}) or {}
                    post_id = str(node.get("id", "")).strip()
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

        keyword_posts = [post for post in all_posts if keyword.lower() in post.get("full_text", "").lower()]
        if not keyword_posts or graphql_failed:
            for post in _parse_ph_rss(keyword):
                if post["id"] not in seen_ids:
                    seen_ids.add(post["id"])
                    all_posts.append(post)
        time.sleep(0.5)

    method = "RSS-only" if graphql_failed else "GraphQL"
    print(f"    [PH] Total: {len(all_posts)} posts (via {method})")

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
            error_detail=graphql_error_detail or "GraphQL unavailable and RSS returned 0 posts",
            method=method,
        )

    if official.get("status") == "empty" and not all_posts:
        return _health_payload(
            posts=[],
            status="empty",
            error_code=official.get("error_code"),
            error_detail=official.get("error_detail"),
            method=official.get("method"),
        )

    return _health_payload(posts=all_posts, status="ok", method=method)


if __name__ == "__main__":
    results = run_ph_scrape(["invoice tool", "freelancer", "saas"])
    print(f"\nFound {len(results)} Product Hunt posts")
    for post in results[:5]:
        print(f"  [{post['score']}] {post['title'][:80]}")
