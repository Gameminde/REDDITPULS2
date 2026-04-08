"""
Profession-to-subreddit routing using the Socius occupation mapping dataset.

The dataset is used as a routing hint, not as a hard truth table.
We match audience / idea language against occupation labels, then lift
the best subreddit candidates for buyer-native discovery.
"""

from __future__ import annotations

import csv
import os
import re
from functools import lru_cache


DATASET_PATH = os.path.join(
    os.path.dirname(__file__),
    "data",
    "SOC-to-Subreddit-Mapping.csv",
)

OCCUPATION_ALIASES = {
    "hr": ["human resources", "people ops", "recruiting", "recruiter", "hr generalist", "talent"],
    "finance": ["accounting", "bookkeeping", "controller", "cfo", "finance team", "payroll"],
    "construction": ["construction", "contractor", "home builder", "general contractor", "estimator", "foreman"],
    "legal": ["lawyer", "attorney", "paralegal", "law firm", "legal ops", "compliance"],
    "marketing": ["marketing", "growth", "seo", "content marketer", "campaign manager", "demand gen"],
    "sales": ["sales", "account executive", "bdr", "sdr", "revops", "revenue operations"],
    "restaurant": ["restaurant", "chef", "food service", "hospitality", "cafe", "kitchen"],
    "real_estate": ["real estate", "property manager", "broker", "agent", "landlord"],
    "developer": ["developer", "software engineer", "programmer", "devops", "frontend", "backend"],
}


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").lower()).strip()


@lru_cache(maxsize=1)
def _load_rows():
    rows = []
    if not os.path.exists(DATASET_PATH):
        return rows

    with open(DATASET_PATH, "r", encoding="utf-8", errors="replace") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            occupation = _normalize_text(row.get("Occupation", ""))
            if not occupation:
                continue

            subreddits = []
            for idx in range(1, 6):
                subreddit = str(row.get(f"sub_{idx}", "") or "").strip()
                if not subreddit:
                    continue
                try:
                    size = float(row.get(f"size_{idx}", 0) or 0)
                except Exception:
                    size = 0.0
                subreddits.append((subreddit, size))

            if not subreddits:
                continue

            rows.append({
                "occupation": occupation,
                "subreddits": subreddits,
            })
    return rows


def _occupation_score(text: str, occupation: str) -> int:
    score = 0
    occupation_terms = [term for term in re.split(r"[^a-z0-9]+", occupation) if len(term) >= 4]
    for term in occupation_terms:
        if term in text:
            score += 2
    return score


def _alias_scores(text: str) -> dict[str, int]:
    scores = {}
    for label, aliases in OCCUPATION_ALIASES.items():
        scores[label] = sum(2 for alias in aliases if alias in text)
    return scores


def infer_occupation_subreddits(audience_text: str, idea_text: str = "", limit: int = 8):
    haystack = _normalize_text(f"{audience_text} {idea_text}")
    if not haystack:
        return {"occupations": [], "subreddits": []}

    alias_scores = _alias_scores(haystack)
    matches = []
    for row in _load_rows():
        occupation = row["occupation"]
        score = _occupation_score(haystack, occupation)
        for alias_label, alias_score in alias_scores.items():
            if alias_score <= 0:
                continue
            if alias_label in occupation:
                score += alias_score
        if score <= 0:
            continue
        matches.append({
            "occupation": occupation,
            "score": score,
            "subreddits": row["subreddits"],
        })

    matches.sort(key=lambda item: item["score"], reverse=True)
    top_matches = matches[:5]

    ranked_subs = {}
    for match in top_matches:
        for subreddit, size in match["subreddits"]:
            normalized = str(subreddit).strip()
            if not normalized:
                continue
            ranked_subs.setdefault(normalized, 0.0)
            ranked_subs[normalized] += float(match["score"]) + (float(size) / 1000.0)

    ordered_subs = [
        subreddit
        for subreddit, _ in sorted(ranked_subs.items(), key=lambda item: item[1], reverse=True)
    ][:limit]

    return {
        "occupations": [
            {
                "occupation": match["occupation"],
                "score": match["score"],
                "subreddits": [sub for sub, _ in match["subreddits"][:3]],
            }
            for match in top_matches
        ],
        "subreddits": ordered_subs,
    }
