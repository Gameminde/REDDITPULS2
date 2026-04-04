"""
Optional market-source enrichers for the main market scraper.

These sources are additive. They should widen coverage when available,
without becoming hard dependencies for the core market feed.
"""

from __future__ import annotations

import os
import re
import time
from html import unescape as html_unescape
from typing import Any

import requests

from competition import match_known_competitors
from g2_scraper import G2Scraper, has_g2_api_token
from github_issues_scraper import (
    TOPIC_REPO_MAP,
    _normalize_github_issue,
    get_repo_issues,
    search_github_issues,
)

ADZUNA_API_TEMPLATE = "https://api.adzuna.com/v1/api/jobs/{country}/search/{page}"
ADZUNA_PAIN_TERMS = [
    "manual", "manually", "slow", "slower", "wasted", "waste", "pain", "frustrating",
    "struggle", "struggling", "bottleneck", "error-prone", "tedious", "messy",
    "repetitive", "time-consuming", "backlog", "overwhelming",
]
KNOWN_SOFTWARE_TERMS = [
    "salesforce", "hubspot", "jira", "slack", "notion", "asana", "trello", "excel",
    "shopify", "quickbooks", "xero", "stripe", "airtable", "zapier", "mailchimp",
    "intercom", "zendesk", "github", "gitlab", "figma",
]


def has_adzuna_credentials() -> bool:
    return bool(
        os.environ.get("ADZUNA_APP_ID", "").strip()
        and os.environ.get("ADZUNA_APP_KEY", "").strip()
    )


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _dedupe_posts(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for post in posts:
        key = _clean_text(post.get("external_id") or post.get("id") or post.get("url") or post.get("title"))
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(post)
    return deduped


def _keyword_hits(keywords: list[str], text: str) -> tuple[bool, int]:
    haystack = text.lower()
    phrase_hit = False
    hits = 0
    for keyword in keywords or []:
        normalized = _clean_text(keyword).lower()
        if not normalized:
            continue
        if " " in normalized or "-" in normalized or "/" in normalized:
            if normalized in haystack:
                phrase_hit = True
                hits += 2
        elif re.search(rf"\b{re.escape(normalized)}\b", haystack):
            hits += 1
    return phrase_hit, hits


def _is_relevant_github_issue(issue: dict[str, Any], keywords: list[str], allowed_repos: set[str]) -> bool:
    repo = _clean_text(issue.get("repo")).lower()
    if repo and repo in allowed_repos:
        return True

    text = " ".join(
        [
            _clean_text(issue.get("title")),
            _clean_text(issue.get("body_excerpt")),
            repo,
            " ".join([_clean_text(label) for label in issue.get("labels") or []]),
        ]
    )
    phrase_hit, hits = _keyword_hits(keywords, text)
    return phrase_hit or hits >= 2


def _github_signal_score(issue: dict[str, Any], allowed_repos: set[str], keywords: list[str]) -> float:
    repo = _clean_text(issue.get("repo")).lower()
    body = _clean_text(issue.get("body_excerpt"))
    labels = " ".join([_clean_text(label) for label in issue.get("labels") or []])
    text = " ".join([_clean_text(issue.get("title")), body, repo, labels]).strip()
    phrase_hit, hits = _keyword_hits(keywords, text)

    score = float(issue.get("thumbs_up") or 0) * 2.0
    score += float(issue.get("total_reactions") or 0)
    score += float(issue.get("comments") or 0) * 0.75
    score += min(hits, 4) * 3.0

    if repo and repo in allowed_repos:
        score += 12.0
    if phrase_hit:
        score += 6.0

    return score


def scrape_market_github_posts(
    topic_slugs: list[str],
    tracked_topics: dict[str, dict[str, Any]],
    *,
    max_topics: int = 4,
    max_issues_per_topic: int = 8,
) -> dict[str, Any]:
    posts: list[dict[str, Any]] = []
    searched_topics: list[dict[str, Any]] = []
    errors: list[str] = []

    for slug in list(dict.fromkeys(topic_slugs or []))[:max_topics]:
        topic_info = tracked_topics.get(slug) or {}
        keywords = list(topic_info.get("keywords") or [])
        fallback_keyword = keywords[0] if keywords else slug.replace("-", " ")
        repo_candidates = [
            _clean_text(repo)
            for repo in list((TOPIC_REPO_MAP.get(slug) or {}).get("repos") or [])[:3]
            if _clean_text(repo)
        ]
        allowed_repos = {
            repo.lower()
            for repo in repo_candidates
        }
        search_query = _clean_text((TOPIC_REPO_MAP.get(slug) or {}).get("search")) or fallback_keyword

        try:
            global_issues = search_github_issues(search_query, per_page=12, pages=1)
            repo_issues: list[dict[str, Any]] = []
            for repo in repo_candidates:
                repo_issues.extend(get_repo_issues(repo, per_page=10))

            merged_issues: list[dict[str, Any]] = []
            seen_issue_ids: set[str] = set()
            for issue in global_issues + repo_issues:
                issue_id = _clean_text(issue.get("id"))
                if not issue_id or issue_id in seen_issue_ids:
                    continue
                seen_issue_ids.add(issue_id)
                merged_issues.append(issue)

            filtered_issues = [
                issue
                for issue in merged_issues
                if _is_relevant_github_issue(issue, keywords, allowed_repos)
            ]
            filtered_issues.sort(
                key=lambda issue: _github_signal_score(issue, allowed_repos, keywords),
                reverse=True,
            )
            issues = filtered_issues[:max_issues_per_topic]
            for issue in issues:
                post = _normalize_github_issue(issue, fallback_keyword)
                post["matched_topics"] = [slug]
                posts.append(post)
            searched_topics.append({
                "slug": slug,
                "issues": len(issues),
                "repos": repo_candidates,
            })
        except Exception as exc:
            errors.append(f"{slug}:{type(exc).__name__}")

    return {
        "posts": _dedupe_posts(posts),
        "searched_topics": searched_topics,
        "errors": errors,
    }


def _candidate_g2_slugs(competitor_name: str) -> list[str]:
    base = re.sub(r"[^a-z0-9]+", "-", str(competitor_name or "").lower()).strip("-")
    if not base:
        return []

    candidates = [base]
    if not base.endswith("-1"):
        candidates.append(f"{base}-1")

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        clean = _clean_text(candidate).lower()
        if clean and clean not in seen:
            seen.add(clean)
            deduped.append(clean)
    return deduped


def _g2_reviews_to_posts(competitor_name: str, reviews: list[dict[str, Any]], product_slug: str = "") -> list[dict[str, Any]]:
    posts: list[dict[str, Any]] = []
    competitor_slug = _clean_text(product_slug or competitor_name).lower().replace(" ", "-")
    for idx, review in enumerate(reviews, start=1):
        rating = int(review.get("rating") or 0)
        dislikes = _clean_text(review.get("dislikes"))
        if rating and rating > 3:
            continue
        if not dislikes:
            continue

        title = _clean_text(review.get("title")) or f"{competitor_name} review complaint"
        posts.append({
            "id": f"g2-{competitor_slug}-{idx}",
            "external_id": f"g2-{competitor_slug}-{idx}",
            "title": title,
            "selftext": dislikes,
            "body": dislikes,
            "full_text": f"{title}. {dislikes}".strip(),
            "score": max(1, 5 - rating) if rating else 3,
            "num_comments": 0,
            "created_utc": review.get("date") or "",
            "source": "g2_review",
            "subreddit": f"g2/{competitor_slug}",
            "url": f"https://www.g2.com/products/{competitor_slug}/reviews",
            "permalink": f"https://www.g2.com/products/{competitor_slug}/reviews",
            "matched_keywords": [],
            "competitor": competitor_name,
            "rating": rating,
            "industry": review.get("industry") or "",
            "company_size": review.get("company_size") or "",
        })
    return posts


def _competitors_for_topic(topic_slug: str, topic_info: dict[str, Any]) -> list[str]:
    search_text = " ".join(
        [
            topic_slug.replace("-", " "),
            " ".join(list(topic_info.get("keywords") or [])[:8]),
        ]
    ).strip()
    matched = match_known_competitors(search_text)
    if not matched:
        return []
    return [
        _clean_text(item.get("name"))
        for item in list(matched.get("competitors") or [])[:3]
        if _clean_text(item.get("name"))
    ]


def scrape_market_g2_posts(
    topic_slugs: list[str],
    tracked_topics: dict[str, dict[str, Any]],
    *,
    max_topics: int = 3,
    timeout_seconds: int = 45,
) -> dict[str, Any]:
    if not has_g2_api_token():
        return {
            "posts": [],
            "searched_topics": [],
            "errors": [],
            "executed": False,
            "reason": "missing_g2_token",
        }

    start_time = time.time()
    scraper = G2Scraper()
    posts: list[dict[str, Any]] = []
    searched_topics: list[dict[str, Any]] = []
    errors: list[str] = []

    for slug in list(dict.fromkeys(topic_slugs or []))[:max_topics]:
        if time.time() - start_time >= timeout_seconds:
            break

        topic_info = tracked_topics.get(slug) or {}
        competitors = _competitors_for_topic(slug, topic_info)
        if not competitors:
            continue

        kept_for_topic = 0
        for competitor in competitors:
            for candidate_slug in _candidate_g2_slugs(competitor):
                if time.time() - start_time >= timeout_seconds:
                    break
                try:
                    reviews = scraper.scrape_competitor_reviews(
                        candidate_slug,
                        max_reviews=30,
                        competitor_name=competitor,
                    )
                    matched_posts = _g2_reviews_to_posts(competitor, reviews, product_slug=candidate_slug)
                    if matched_posts:
                        for post in matched_posts:
                            post["matched_topics"] = [slug]
                        posts.extend(matched_posts)
                        kept_for_topic += len(matched_posts)
                        break
                except Exception as exc:
                    errors.append(f"{slug}:{competitor}:{type(exc).__name__}")

        if kept_for_topic or competitors:
            searched_topics.append({
                "slug": slug,
                "competitors": competitors,
                "posts": kept_for_topic,
            })

    return {
        "posts": _dedupe_posts(posts),
        "searched_topics": searched_topics,
        "errors": errors,
        "executed": True,
        "reason": "",
    }


def _strip_html_to_text(value: Any) -> str:
    text = re.sub(r"(?is)<script.*?>.*?</script>", " ", str(value or ""))
    text = re.sub(r"(?is)<style.*?>.*?</style>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html_unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _extract_pain_sentences(text: str, max_sentences: int = 3) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", str(text or ""))
    return [
        sentence.strip()
        for sentence in sentences
        if sentence.strip() and any(term in sentence.lower() for term in ADZUNA_PAIN_TERMS)
    ][:max_sentences]


def _extract_required_tools(text: str) -> list[str]:
    haystack = str(text or "").lower()
    return list(dict.fromkeys([tool for tool in KNOWN_SOFTWARE_TERMS if tool in haystack]))[:10]


def _adzuna_job_to_post(job: dict[str, Any], keywords: list[str], topic_slug: str) -> dict[str, Any] | None:
    description = _strip_html_to_text(job.get("description") or "")[:500]
    pain_language = _extract_pain_sentences(description)
    title = _clean_text(job.get("title"))
    if not title:
        return None

    combined = " ".join([title, description, " ".join(pain_language)]).strip()
    matched_keywords = [kw for kw in (keywords or []) if str(kw or "").lower() in combined.lower()]
    redirect_url = _clean_text(job.get("redirect_url") or job.get("adref"))
    job_id = _clean_text(job.get("id") or redirect_url or title)
    if not job_id:
        return None

    return {
        "id": f"job-{job_id}",
        "external_id": f"job-{job_id}",
        "title": title,
        "selftext": description,
        "body": description,
        "full_text": combined[:900],
        "score": 4 if pain_language else 3,
        "num_comments": 0,
        "created_utc": job.get("created") or "",
        "source": "job_posting",
        "subreddit": f"adzuna/{topic_slug}",
        "url": redirect_url,
        "permalink": redirect_url,
        "matched_keywords": matched_keywords,
        "required_tools": _extract_required_tools(description),
        "pain_language": pain_language,
        "company": ((job.get("company") or {}).get("display_name") if isinstance(job.get("company"), dict) else ""),
    }


def scrape_market_job_posts(
    topic_slugs: list[str],
    tracked_topics: dict[str, dict[str, Any]],
    *,
    max_topics: int = 3,
    max_posts: int = 45,
    timeout_seconds: int = 35,
) -> dict[str, Any]:
    app_id = os.environ.get("ADZUNA_APP_ID", "").strip()
    app_key = os.environ.get("ADZUNA_APP_KEY", "").strip()
    country = os.environ.get("ADZUNA_COUNTRY", "us").strip().lower() or "us"
    if not app_id or not app_key:
        return {
            "posts": [],
            "searched_topics": [],
            "errors": [],
            "executed": False,
            "reason": "missing_adzuna_credentials",
        }

    start_time = time.time()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "close",
    }

    posts: list[dict[str, Any]] = []
    searched_topics: list[dict[str, Any]] = []
    errors: list[str] = []
    seen: set[str] = set()

    session = requests.Session()
    endpoint = ADZUNA_API_TEMPLATE.format(country=country, page=1)

    for slug in list(dict.fromkeys(topic_slugs or []))[:max_topics]:
        if len(posts) >= max_posts or time.time() - start_time >= timeout_seconds:
            break

        topic_info = tracked_topics.get(slug) or {}
        keywords = [str(kw).strip() for kw in list(topic_info.get("keywords") or [])[:3] if str(kw).strip()]
        if not keywords:
            continue

        topic_added = 0
        for keyword in keywords:
            if len(posts) >= max_posts or time.time() - start_time >= timeout_seconds:
                break

            params = {
                "app_id": app_id,
                "app_key": app_key,
                "what": keyword,
                "results_per_page": min(10, max_posts - len(posts)),
                "content-type": "application/json",
            }

            try:
                response = session.get(endpoint, params=params, headers=headers, timeout=15)
                if response.status_code != 200:
                    errors.append(f"{slug}:{keyword}:status={response.status_code}")
                    continue

                payload = response.json() or {}
                for job in payload.get("results", []) or []:
                    post = _adzuna_job_to_post(job, keywords, slug)
                    if not post:
                        continue
                    dedupe_key = _clean_text(post.get("external_id") or post.get("url") or post.get("title"))
                    if not dedupe_key or dedupe_key in seen:
                        continue
                    seen.add(dedupe_key)
                    post["matched_topics"] = [slug]
                    posts.append(post)
                    topic_added += 1
                    if len(posts) >= max_posts:
                        break
            except requests.exceptions.RequestException as exc:
                errors.append(f"{slug}:{keyword}:{type(exc).__name__}")

            time.sleep(0.35)

        searched_topics.append({
            "slug": slug,
            "keywords": keywords,
            "posts": topic_added,
        })

    return {
        "posts": _dedupe_posts(posts),
        "searched_topics": searched_topics,
        "errors": errors,
        "executed": True,
        "reason": "",
    }
