"""
RedditPulse — Hacker News Scraper Module
Hits the free Algolia HN API to find tech pain points and tool requests.
Zero authentication required. High-quality technical audience.
"""

import time
import requests
from datetime import datetime


HN_SEARCH_API = "https://hn.algolia.com/api/v1/search"
HN_SEARCH_BY_DATE = "https://hn.algolia.com/api/v1/search_by_date"

# Focus on "Ask HN" and "Show HN" — highest signal posts
HN_TAGS = ["ask_hn", "show_hn"]


def _hn_request(url, params, max_retries=3):
    """Make a request to the HN Algolia API with retries."""
    for attempt in range(max_retries):
        try:
            resp = requests.get(url, params=params, timeout=15)
            if resp.status_code == 200:
                return resp.json()
            elif resp.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            else:
                return None
        except (requests.RequestException, ValueError):
            time.sleep(1)
            continue
    return None


def search_hn(keyword, pages=3, hits_per_page=100):
    """
    Search Hacker News for a keyword across Ask HN and Show HN posts.
    Returns a list of normalized post dicts compatible with the Reddit pipeline.
    """
    all_posts = []
    seen_ids = set()

    for tag in HN_TAGS:
        for page in range(pages):
            params = {
                "query": keyword,
                "tags": tag,
                "hitsPerPage": hits_per_page,
                "page": page,
            }

            data = _hn_request(HN_SEARCH_API, params)
            if not data or "hits" not in data:
                break

            for hit in data["hits"]:
                obj_id = hit.get("objectID", "")
                if obj_id in seen_ids:
                    continue
                seen_ids.add(obj_id)

                title = hit.get("title") or ""
                story_text = hit.get("story_text") or ""
                comment_text = hit.get("comment_text") or ""
                text_body = story_text or comment_text

                # Clean HTML tags from story_text
                import re
                text_body = re.sub(r"<[^>]+>", " ", text_body).strip()

                post = {
                    "id": f"hn_{obj_id}",
                    "title": title,
                    "selftext": text_body[:2000],
                    "full_text": f"{title} {text_body}".strip()[:2500],
                    "score": hit.get("points") or 0,
                    "num_comments": hit.get("num_comments") or 0,
                    "upvote_ratio": 0.8,  # HN doesn't expose this
                    "created_utc": _parse_hn_timestamp(hit.get("created_at", "")),
                    "subreddit": f"HackerNews/{tag}",
                    "permalink": f"https://news.ycombinator.com/item?id={obj_id}",
                    "author": hit.get("author") or "[unknown]",
                    "url": hit.get("url") or "",
                    "source": "hackernews",
                    "matched_phrases": [],
                }

                all_posts.append(post)

            if len(data.get("hits", [])) < hits_per_page:
                break

            time.sleep(0.5)  # Be respectful to the API

    return all_posts


def search_hn_recent(keyword, hits_per_page=100):
    """Search HN by date (most recent first) for a keyword."""
    all_posts = []
    seen_ids = set()

    params = {
        "query": keyword,
        "tags": "(ask_hn,show_hn)",
        "hitsPerPage": hits_per_page,
    }

    data = _hn_request(HN_SEARCH_BY_DATE, params)
    if not data or "hits" not in data:
        return all_posts

    for hit in data["hits"]:
        obj_id = hit.get("objectID", "")
        if obj_id in seen_ids:
            continue
        seen_ids.add(obj_id)

        title = hit.get("title") or ""
        story_text = hit.get("story_text") or ""

        import re
        story_text = re.sub(r"<[^>]+>", " ", story_text).strip()

        post = {
            "id": f"hn_{obj_id}",
            "title": title,
            "selftext": story_text[:2000],
            "full_text": f"{title} {story_text}".strip()[:2500],
            "score": hit.get("points") or 0,
            "num_comments": hit.get("num_comments") or 0,
            "upvote_ratio": 0.8,
            "created_utc": _parse_hn_timestamp(hit.get("created_at", "")),
            "subreddit": "HackerNews/ask_hn",
            "permalink": f"https://news.ycombinator.com/item?id={obj_id}",
            "author": hit.get("author") or "[unknown]",
            "url": hit.get("url") or "",
            "source": "hackernews",
            "matched_phrases": [],
        }

        all_posts.append(post)

    return all_posts


def _parse_hn_timestamp(ts_str):
    """Parse HN ISO timestamp to Unix epoch."""
    if not ts_str:
        return 0
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return dt.timestamp()
    except (ValueError, AttributeError):
        return 0


def run_hn_scrape(keywords, max_pages=2):
    """
    Run HN scrape for a list of keywords.
    Returns deduplicated posts compatible with the Reddit pipeline.
    """
    seen_ids = set()
    all_posts = []

    for kw in keywords:
        posts = search_hn(kw, pages=max_pages)
        for p in posts:
            if p["id"] not in seen_ids:
                seen_ids.add(p["id"])
                all_posts.append(p)

        # Also get recent posts
        recent = search_hn_recent(kw)
        for p in recent:
            if p["id"] not in seen_ids:
                seen_ids.add(p["id"])
                all_posts.append(p)

    return all_posts


if __name__ == "__main__":
    import json
    results = run_hn_scrape(["invoice tool", "CRM alternative"])
    print(f"Found {len(results)} HN posts")
    for p in results[:5]:
        print(f"  [{p['score']}] {p['title'][:80]}")
