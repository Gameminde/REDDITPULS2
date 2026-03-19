"""
RedditPulse — Stack Overflow Scraper
Finds unanswered + high-voted questions related to a topic.
Uses the free Stack Exchange API (10,000 requests/day, no auth needed).
"""

import time
import requests
from datetime import datetime, timezone


SE_API = "https://api.stackexchange.com/2.3"

# Map idea topics to relevant SO tags
TOPIC_TAG_MAP = {
    "invoice-automation": ["invoicing", "billing", "payment", "stripe"],
    "accounting-software": ["accounting", "bookkeeping", "quickbooks", "xero"],
    "payment-processing": ["payment-gateway", "stripe-payments", "paypal", "checkout"],
    "personal-finance": ["personal-finance", "budgeting", "finance"],
    "time-tracking": ["time-tracking", "productivity", "toggl"],
    "project-management": ["project-management", "jira", "trello", "asana"],
    "note-taking": ["note-taking", "obsidian", "notion-api", "evernote"],
    "email-marketing": ["email", "newsletter", "mailchimp", "sendgrid"],
    "seo-tools": ["seo", "google-search", "web-crawling", "sitemap"],
    "no-code-tools": ["no-code", "low-code", "bubble.io", "webflow"],
    "ai-writing": ["openai-api", "chatgpt-api", "gpt-4", "llm", "natural-language-processing"],
    "ai-coding": ["github-copilot", "code-generation", "ai", "machine-learning"],
    "ai-automation": ["automation", "rpa", "ai", "chatbot"],
    "ai-image-generation": ["stable-diffusion", "dall-e", "image-generation", "generative-ai"],
    "customer-support": ["customer-support", "helpdesk", "zendesk", "intercom", "chatbot"],
    "crm-tools": ["crm", "salesforce", "hubspot", "lead-management"],
    "ecommerce-tools": ["e-commerce", "shopify", "woocommerce", "magento"],
    "inventory-management": ["inventory", "warehouse-management", "supply-chain"],
    "data-analytics": ["analytics", "data-visualization", "dashboard", "business-intelligence"],
    "web-scraping": ["web-scraping", "beautifulsoup", "selenium", "puppeteer"],
    "ci-cd-devops": ["devops", "docker", "kubernetes", "ci-cd", "github-actions"],
    "developer-tools": ["developer-tools", "vscode", "ide", "debugging"],
    "landing-pages": ["landing-page", "conversion-rate", "a-b-testing"],
    "social-media-scheduling": ["social-media", "twitter-api", "instagram-api"],
    "recruitment-hiring": ["recruitment", "hiring", "applicant-tracking"],
    "remote-work-tools": ["remote-work", "slack", "team-collaboration"],
    "scheduling-booking": ["scheduling", "calendar", "booking-system", "appointment"],
    "forms-surveys": ["survey", "forms", "google-forms", "typeform"],
    "design-tools": ["figma", "design", "ui-design", "graphic-design"],
    "video-conferencing": ["webrtc", "video-streaming", "zoom-sdk"],
    "vpn-privacy": ["vpn", "encryption", "privacy", "security"],
    "proptech": ["real-estate", "property-management", "rental"],
    "online-courses": ["e-learning", "lms", "online-education"],
    "freelance-tools": ["freelancing", "upwork", "fiverr"],
    "feedback-tools": ["user-feedback", "feature-request", "product-management"],
    "content-creation": ["content-management", "blogging", "cms", "wordpress"],
    "onboarding-tools": ["user-onboarding", "product-tour", "onboarding"],
}


def _build_search_tags(topic_slug, keywords=None):
    """Get relevant SO tags for a topic."""
    tags = TOPIC_TAG_MAP.get(topic_slug, [])
    if not tags and keywords:
        # Fall back to using first 3 keywords as search terms
        tags = [kw.replace(" ", "-").lower() for kw in keywords[:3]]
    return tags


def search_stackoverflow(query, tags=None, page_size=30, pages=2):
    """
    Search Stack Overflow for unanswered questions with high votes.
    Returns normalized question data.
    """
    all_questions = []
    seen_ids = set()

    for page in range(1, pages + 1):
        params = {
            "order": "desc",
            "sort": "votes",
            "site": "stackoverflow",
            "pagesize": min(page_size, 100),
            "page": page,
            "filter": "withbody",  # include body excerpt
        }

        # Strategy 1: Search by tagged questions (unanswered)
        if tags:
            params["tagged"] = ";".join(tags[:5])
            params["accepted"] = "False"
            endpoint = f"{SE_API}/questions/no-answers"
        else:
            # Fallback: search by query text
            params["intitle"] = query
            params["accepted"] = "False"
            endpoint = f"{SE_API}/search/advanced"

        try:
            resp = requests.get(endpoint, params=params, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                items = data.get("items", [])

                for item in items:
                    qid = item.get("question_id")
                    if qid in seen_ids:
                        continue
                    seen_ids.add(qid)

                    all_questions.append({
                        "id": qid,
                        "title": item.get("title", ""),
                        "score": item.get("score", 0),
                        "view_count": item.get("view_count", 0),
                        "answer_count": item.get("answer_count", 0),
                        "is_answered": item.get("is_answered", False),
                        "tags": item.get("tags", []),
                        "url": item.get("link", f"https://stackoverflow.com/q/{qid}"),
                        "created_at": item.get("creation_date", 0),
                        "body_excerpt": _clean_html(item.get("body", ""))[:300],
                        "owner": item.get("owner", {}).get("display_name", "[unknown]"),
                    })

                # Check quota
                quota = data.get("quota_remaining", 9999)
                if quota < 100:
                    print(f"    [SO] Quota low: {quota} remaining")
                    break

                if not data.get("has_more", False):
                    break

            elif resp.status_code == 429:
                print("    [SO] Rate limited — waiting 30s")
                time.sleep(30)
                continue
            else:
                print(f"    [SO] Error: {resp.status_code}")
                break

        except Exception as e:
            print(f"    [SO] Request error: {e}")
            break

        time.sleep(0.5)

    return all_questions


def search_so_by_text(query, page_size=25):
    """
    Text-based search on SO — catches questions that aren't tagged properly.
    """
    params = {
        "order": "desc",
        "sort": "relevance",
        "site": "stackoverflow",
        "pagesize": page_size,
        "intitle": query,
        "accepted": "False",
        "answers": 0,  # unanswered only
    }

    try:
        resp = requests.get(f"{SE_API}/search/advanced", params=params, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("items", [])
            return [{
                "id": item.get("question_id"),
                "title": item.get("title", ""),
                "score": item.get("score", 0),
                "view_count": item.get("view_count", 0),
                "answer_count": 0,
                "is_answered": False,
                "tags": item.get("tags", []),
                "url": item.get("link", ""),
                "created_at": item.get("creation_date", 0),
                "body_excerpt": "",
                "owner": item.get("owner", {}).get("display_name", "[unknown]"),
            } for item in items]
    except Exception as e:
        print(f"    [SO] Text search error: {e}")

    return []


def run_so_scrape(topic_slug, keywords=None):
    """
    Full Stack Overflow scrape for a topic.
    Combines tag-based + text-based search, deduplicates, ranks by signal strength.
    """
    print(f"    [SO] Enriching: '{topic_slug}'...")

    tags = _build_search_tags(topic_slug, keywords)

    # Layer 1: Tag-based unanswered questions
    tag_results = search_stackoverflow(topic_slug, tags=tags) if tags else []

    # Layer 2: Text search for common keyword
    search_term = topic_slug.replace("-", " ")
    text_results = search_so_by_text(search_term)

    # Merge + deduplicate
    seen_ids = set()
    all_questions = []
    for q in tag_results + text_results:
        if q["id"] not in seen_ids:
            seen_ids.add(q["id"])
            all_questions.append(q)

    # Sort by signal strength: votes * log(views)
    import math
    for q in all_questions:
        q["signal_score"] = q["score"] * max(1, math.log(q["view_count"] + 1))

    all_questions.sort(key=lambda x: x["signal_score"], reverse=True)

    # Extract top tags across all questions
    tag_counts = {}
    for q in all_questions:
        for tag in q.get("tags", []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
    top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:10]

    print(f"    [SO] Found {len(all_questions)} unanswered questions")

    return {
        "questions": all_questions[:15],  # Top 15 by signal
        "total": len(all_questions),
        "top_tags": [{"tag": t[0], "count": t[1]} for t in top_tags],
    }


def _clean_html(html):
    """Strip HTML tags from SO body content."""
    import re
    if not html:
        return ""
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _normalize_so_question(question: dict, keyword: str) -> dict:
    created_at = question.get("created_at", 0) or 0
    created_utc = ""
    if created_at:
        created_utc = datetime.fromtimestamp(int(created_at), tz=timezone.utc).isoformat()

    return {
        "id": str(question.get("id", "")),
        "external_id": str(question.get("id", "")),
        "title": question.get("title", ""),
        "url": question.get("url", ""),
        "score": question.get("score", 0),
        "num_comments": question.get("answer_count", 0),
        "source": "stackoverflow",
        "created_utc": created_utc,
        "selftext": question.get("body_excerpt", ""),
        "full_text": f"{question.get('title', '')} {question.get('body_excerpt', '')}".strip(),
        "matched_keywords": [keyword],
        "tags": question.get("tags", []),
    }


def scrape_stackoverflow(keywords: list[str], max_keywords: int = 3, time_budget: int = 30, pages: int = 1) -> list[dict]:
    """
    Validation-path SO wrapper.
    Args:
        keywords: formal keywords from decomposition
        max_keywords: how many keywords to use (default 3)
        time_budget: seconds before stopping (default 30)
        pages: pages per keyword search (default 1)
    """
    search_terms = [str(kw).strip() for kw in (keywords or []) if str(kw).strip()][:max_keywords]
    print(f"[SO] Scraping Stack Overflow for {len(search_terms)} keywords (budget={time_budget}s, pages={pages})...")

    start_time = time.time()
    seen_ids = set()
    normalized_posts = []

    for keyword in search_terms:
        if time.time() - start_time > time_budget:
            print("[SO] Time budget reached — stopping early")
            break

        before_count = len(normalized_posts)
        tag_query = keyword.replace(" ", "-").lower()
        tag_results = search_stackoverflow(tag_query, tags=[tag_query], page_size=15, pages=pages)
        text_results = []
        if time.time() - start_time <= time_budget:
            text_results = search_so_by_text(keyword, page_size=10)

        for question in tag_results + text_results:
            question_id = str(question.get("id", "")).strip()
            if not question_id or question_id in seen_ids:
                continue
            seen_ids.add(question_id)
            normalized_posts.append(_normalize_so_question(question, keyword))

        print(f"[SO] '{keyword}': +{len(normalized_posts) - before_count} posts (total {len(normalized_posts)})")

    return normalized_posts


if __name__ == "__main__":
    result = run_so_scrape("invoice-automation", ["invoice", "billing", "payment"])
    print(f"\n{result['total']} questions found")
    for q in result["questions"][:5]:
        print(f"  [{q['score']}⬆ {q['view_count']}👁] {q['title'][:80]}")
        print(f"    Tags: {', '.join(q['tags'][:5])}")
