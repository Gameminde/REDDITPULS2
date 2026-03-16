"""
Lightweight App Store review scraper.
Uses the public iTunes Search API and customer reviews RSS JSON feed.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

import requests


SEARCH_URL = "https://itunes.apple.com/search"
REVIEWS_URL = "https://itunes.apple.com/us/rss/customerreviews/id={app_id}/json"


class AppStoreScraper:
    def search_apps(self, query: str, limit: int = 5):
        response = requests.get(
            SEARCH_URL,
            params={"term": query, "entity": "software", "limit": limit},
            timeout=20,
        )
        if response.status_code != 200:
            return []
        data = response.json()
        return data.get("results", []) or []

    def scrape_reviews(self, query: str, max_reviews: int = 30):
        apps = self.search_apps(query, limit=3)
        if not apps:
            return {"reviews": [], "total": 0, "apps": []}

        best_app = apps[0]
        app_id = best_app.get("trackId")
        if not app_id:
            return {"reviews": [], "total": 0, "apps": apps}

        response = requests.get(REVIEWS_URL.format(app_id=app_id), timeout=20)
        if response.status_code != 200:
            return {"reviews": [], "total": 0, "apps": apps}

        feed = response.json().get("feed", {})
        entries = feed.get("entry", [])
        if isinstance(entries, dict):
            entries = [entries]

        reviews = []
        for entry in entries[1:max_reviews + 1]:
            rating = int(entry.get("im:rating", {}).get("label", 0) or 0)
            if rating != 3:
                continue
            reviews.append({
                "app_name": best_app.get("trackName", query),
                "price": best_app.get("formattedPrice") or best_app.get("price") or "Unknown",
                "rating": rating,
                "title": entry.get("title", {}).get("label", ""),
                "review_text": entry.get("content", {}).get("label", ""),
                "date": entry.get("updated", {}).get("label", ""),
            })

        return {"reviews": reviews, "total": len(reviews), "apps": apps}

    def get_top_pains(self, query: str, top_n: int = 10):
        data = self.scrape_reviews(query, max_reviews=40)
        phrases: list[str] = []
        for review in data.get("reviews", []):
            words = [word.lower() for word in str(review.get("review_text", "")).split() if len(word) > 3]
            phrases.extend(" ".join(words[i:i + 2]) for i in range(len(words) - 1))
        return [{"phrase": phrase, "count": count} for phrase, count in Counter(phrases).most_common(top_n)]


def scrape_appstore_signals(query: str):
    scraper = AppStoreScraper()
    data = scraper.scrape_reviews(query, max_reviews=30)
    return {
        "reviews": data.get("reviews", []),
        "total": data.get("total", 0),
        "apps": data.get("apps", []),
        "top_pains": scraper.get_top_pains(query, top_n=10),
    }
