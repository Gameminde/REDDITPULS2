"""
G2 review collector.

Priority order:
1. Official G2 API when a platform token is configured
2. Legacy public web scrape fallback
"""

from __future__ import annotations

import os
import re
import time
from collections import Counter

import requests


USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
]

API_PRODUCTS_URL = "https://data.g2.com/api/v1/products"
API_SYNDICATION_REVIEWS_URL = "https://data.g2.com/api/2018-01-01/syndication/reviews"


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def get_g2_api_token() -> str:
    return (
        os.environ.get("G2_API_TOKEN", "").strip()
        or os.environ.get("G2_ACCESS_TOKEN", "").strip()
        or os.environ.get("G2_TOKEN", "").strip()
    )


def has_g2_api_token() -> bool:
    return bool(get_g2_api_token())


class G2Scraper:
    BASE_URL = "https://www.g2.com/products"

    def __init__(self):
        self.last_status_code = None
        self.last_url = ""
        self.last_error = ""
        self.last_method = ""
        self.last_product_id = ""

    def _headers(self, idx: int = 0):
        return {
            "User-Agent": USER_AGENTS[idx % len(USER_AGENTS)],
            "Accept-Language": "en-US,en;q=0.9",
        }

    def _api_headers(self):
        token = get_g2_api_token()
        return {
            "Authorization": f"Token token={token}",
            "Accept": "application/vnd.api+json",
            "Content-Type": "application/vnd.api+json",
            "User-Agent": "RedditPulse/1.0",
        }

    def _lookup_product(self, competitor_name: str, product_slug: str = ""):
        self.last_method = "api_lookup"
        headers = self._api_headers()
        candidates = []
        if product_slug:
            candidates.append(("filter[slug]", product_slug))
        if competitor_name:
            candidates.append(("filter[name]", competitor_name))

        for filter_name, filter_value in candidates:
            try:
                response = requests.get(
                    API_PRODUCTS_URL,
                    headers=headers,
                    params={filter_name: filter_value, "page[size]": 5},
                    timeout=20,
                )
            except Exception as exc:
                self.last_error = f"api_lookup_exception:{str(exc)[:160]}"
                continue

            self.last_status_code = response.status_code
            self.last_url = response.url
            if response.status_code == 401:
                self.last_error = "api_bad_credentials"
                return None
            if response.status_code == 403:
                self.last_error = "api_permission_denied"
                return None
            if response.status_code != 200:
                self.last_error = f"api_lookup_http_{response.status_code}"
                continue

            payload = response.json() or {}
            for item in payload.get("data") or []:
                attrs = item.get("attributes") or {}
                slug = str(attrs.get("slug") or "").strip().lower()
                name = str(attrs.get("name") or "").strip().lower()
                if product_slug and slug == str(product_slug).strip().lower():
                    return {
                        "id": str(item.get("id") or "").strip(),
                        "slug": slug,
                        "name": str(attrs.get("name") or "").strip(),
                        "url": str(attrs.get("public_detail_url") or "").strip(),
                        "review_count": attrs.get("review_count") or 0,
                    }
                if competitor_name and name == str(competitor_name).strip().lower():
                    return {
                        "id": str(item.get("id") or "").strip(),
                        "slug": slug,
                        "name": str(attrs.get("name") or "").strip(),
                        "url": str(attrs.get("public_detail_url") or "").strip(),
                        "review_count": attrs.get("review_count") or 0,
                    }

            items = payload.get("data") or []
            if items:
                item = items[0]
                attrs = item.get("attributes") or {}
                return {
                    "id": str(item.get("id") or "").strip(),
                    "slug": str(attrs.get("slug") or "").strip(),
                    "name": str(attrs.get("name") or "").strip(),
                    "url": str(attrs.get("public_detail_url") or "").strip(),
                    "review_count": attrs.get("review_count") or 0,
                }

        self.last_error = self.last_error or "api_product_not_found"
        return None

    def _scrape_competitor_reviews_api(self, competitor_name: str, product_slug: str = "", max_reviews: int = 50):
        if not has_g2_api_token():
            self.last_error = "api_token_missing"
            return []

        product = self._lookup_product(competitor_name, product_slug=product_slug)
        if not product or not product.get("id"):
            return []

        self.last_method = "official_api"
        self.last_product_id = product["id"]
        self.last_url = API_SYNDICATION_REVIEWS_URL

        headers = self._api_headers()
        reviews = []
        page = 1
        page_size = min(100, max(10, max_reviews))
        while len(reviews) < max_reviews:
            params = {
                "filter[product_id]": product["id"],
                "filter[nps_score][]": 3,
                "page[size]": min(page_size, max_reviews - len(reviews)),
                "page[number]": page,
            }
            try:
                response = requests.get(
                    API_SYNDICATION_REVIEWS_URL,
                    headers=headers,
                    params=params,
                    timeout=20,
                )
            except Exception as exc:
                self.last_error = f"api_reviews_exception:{str(exc)[:160]}"
                break

            self.last_status_code = response.status_code
            self.last_url = response.url
            if response.status_code == 401:
                self.last_error = "api_bad_credentials"
                break
            if response.status_code == 403:
                self.last_error = "api_permission_denied"
                break
            if response.status_code != 200:
                self.last_error = f"api_reviews_http_{response.status_code}"
                break

            payload = response.json() or {}
            data = payload.get("data") or []
            for item in data:
                attrs = item.get("attributes") or {}
                answers = attrs.get("answers") or {}
                hate = ((answers.get("hate") or {}).get("value") or "").strip()
                if not hate:
                    continue
                rating = int(round(float(attrs.get("star_rating") or 0)))
                reviews.append({
                    "product": product.get("slug") or product_slug,
                    "rating": rating,
                    "title": str(attrs.get("title") or "").strip(),
                    "dislikes": hate,
                    "likes": ((answers.get("love") or {}).get("value") or "").strip(),
                    "recommendations": ((answers.get("recommendations") or {}).get("value") or "").strip(),
                    "benefits": ((answers.get("benefits") or {}).get("value") or "").strip(),
                    "industry": ((attrs.get("user") or {}).get("industry") or "").strip(),
                    "company_size": ((attrs.get("user") or {}).get("company_segment") or "").strip(),
                    "user_title": ((attrs.get("user") or {}).get("title") or "").strip(),
                    "date": attrs.get("published_at") or attrs.get("submitted_at") or "",
                    "url": str(attrs.get("url") or "").strip(),
                })
                if len(reviews) >= max_reviews:
                    break

            meta = payload.get("meta") or {}
            page_count = int(meta.get("page_count") or page)
            if page >= page_count or not data or len(reviews) >= max_reviews:
                break
            page += 1
            time.sleep(0.2)

        return reviews[:max_reviews]

    def _scrape_competitor_reviews_html(self, product_slug: str, max_reviews: int = 50):
        url = f"{self.BASE_URL}/{product_slug}/reviews"
        reviews = []
        self.last_method = "html_fallback"
        self.last_url = url
        self.last_status_code = None
        self.last_error = ""

        try:
            response = requests.get(url, headers=self._headers(), timeout=20)
            self.last_status_code = response.status_code
            if response.status_code != 200:
                body = response.text.lower()
                if response.status_code == 403 and ("enable js" in body or "disable any ad blocker" in body):
                    self.last_error = "js_challenge_block"
                else:
                    self.last_error = f"http_{response.status_code}"
                return reviews

            html = response.text
            blocks = re.split(r'data-testid="review-item"|class="paper paper--white review"', html)
            for block in blocks[1:max_reviews + 1]:
                title_match = re.search(r'aria-label="Review title">\s*([^<]+)', block)
                dislikes_match = re.search(r"What do you dislike\?\s*</[^>]+>\s*<[^>]+>(.*?)</", block, re.I | re.S)
                likes_match = re.search(r"What do you like best\?\s*</[^>]+>\s*<[^>]+>(.*?)</", block, re.I | re.S)
                rating_match = re.search(r'(\d(?:\.\d)?)\s*out of 5', block)
                industry_match = re.search(r'Industry:\s*</[^>]+>\s*<[^>]+>(.*?)</', block, re.I | re.S)
                company_match = re.search(r'Company Size:\s*</[^>]+>\s*<[^>]+>(.*?)</', block, re.I | re.S)
                date_match = re.search(r'datetime="([^"]+)"', block)

                dislikes = _clean(dislikes_match.group(1)) if dislikes_match else ""
                if not dislikes:
                    continue

                reviews.append({
                    "product": product_slug,
                    "rating": int(float(rating_match.group(1))) if rating_match else 0,
                    "title": _clean(title_match.group(1)) if title_match else "",
                    "dislikes": dislikes,
                    "likes": _clean(likes_match.group(1)) if likes_match else "",
                    "use_case": "",
                    "industry": _clean(industry_match.group(1)) if industry_match else "",
                    "company_size": _clean(company_match.group(1)) if company_match else "",
                    "date": date_match.group(1) if date_match else "",
                })
                time.sleep(0.25)
        except Exception as exc:
            self.last_error = str(exc)[:200]
            return reviews

        return reviews[:max_reviews]

    def scrape_competitor_reviews(self, product_slug: str, max_reviews: int = 50, competitor_name: str = ""):
        if has_g2_api_token():
            reviews = self._scrape_competitor_reviews_api(
                competitor_name=competitor_name or product_slug,
                product_slug=product_slug,
                max_reviews=max_reviews,
            )
            if reviews:
                return reviews
            if self.last_error in {"api_bad_credentials", "api_permission_denied"}:
                return reviews
        return self._scrape_competitor_reviews_html(product_slug, max_reviews=max_reviews)

    def get_top_complaints(self, product_slug: str, top_n: int = 10, competitor_name: str = ""):
        reviews = self.scrape_competitor_reviews(product_slug, max_reviews=100, competitor_name=competitor_name)
        phrases = []
        for review in reviews:
            text = re.sub(r"[^a-z0-9\s]", " ", review.get("dislikes", "").lower())
            words = [word for word in text.split() if len(word) > 3]
            phrases.extend(" ".join(words[i:i + 2]) for i in range(len(words) - 1))

        top = Counter(phrases).most_common(top_n)
        return [{"phrase": phrase, "count": count} for phrase, count in top if phrase.strip()]


def scrape_g2_signals(product_slug: str, competitor_name: str = ""):
    scraper = G2Scraper()
    reviews = scraper.scrape_competitor_reviews(product_slug, max_reviews=30, competitor_name=competitor_name)
    return {
        "reviews": reviews,
        "total": len(reviews),
        "top_complaints": scraper.get_top_complaints(product_slug, top_n=10, competitor_name=competitor_name),
        "method": scraper.last_method,
        "last_error": scraper.last_error,
    }
