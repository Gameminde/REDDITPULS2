"""
RedditPulse - Morning Brief
Generates and caches a compact daily summary for a user from Supabase data.
"""

import argparse
import json
import os
import requests
from datetime import datetime, timedelta, timezone

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_KEY", ""))
CACHE_TABLE = "morning_brief_cache"
CACHE_TTL = timedelta(hours=1)


def _headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def _safe_datetime(value: str):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


class MorningBrief:
    def __init__(self, user_id: str):
        self.user_id = user_id

    def _select(self, table: str, params: dict):
        if not SUPABASE_URL or not SUPABASE_KEY:
            return []
        try:
            response = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers=_headers(),
                params=params,
                timeout=15,
            )
            if response.status_code == 200:
                return response.json()
        except Exception:
            return []
        return []

    def _upsert_cache(self, payload: dict) -> None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            return
        cache_payload = {
            "user_id": self.user_id,
            "brief": payload.get("brief", {}),
            "timeline": payload.get("timeline", []),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            requests.post(
                f"{SUPABASE_URL}/rest/v1/{CACHE_TABLE}",
                headers={**_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
                params={"on_conflict": "user_id"},
                json=cache_payload,
                timeout=10,
            )
        except Exception:
            pass

    def _load_cache(self):
        rows = self._select(
            CACHE_TABLE,
            {"user_id": f"eq.{self.user_id}", "limit": 1},
        )
        if not rows:
            return None
        row = rows[0]
        generated_at = _safe_datetime(row.get("generated_at"))
        if not generated_at:
            return None
        if datetime.now(timezone.utc) - generated_at > CACHE_TTL:
            return None
        return {
            "brief": row.get("brief") or {},
            "timeline": row.get("timeline") or [],
            "cached": True,
            "generated_at": generated_at.isoformat(),
        }

    def _build_timeline(self, matches: list, complaints: list, trends: list) -> list:
        timeline = [
            {
                "bucket": "Today",
                "time": match.get("matched_at"),
                "icon": "alert",
                "description": f"New Pain Stream match: {match.get('post_title', 'Untitled post')}",
                "action": {"href": match.get("post_url") or "/dashboard/alerts", "label": "View post"},
            }
            for match in matches
        ]
        timeline.extend([
            {
                "bucket": "Today",
                "time": complaint.get("scraped_at"),
                "icon": "competitor",
                "description": f"{', '.join((complaint.get('competitors_mentioned') or [])[:2])} complaints detected",
                "action": {"href": complaint.get("post_url") or "/dashboard/competitors", "label": "View complaint"},
            }
            for complaint in complaints
        ])
        timeline.extend([
            {
                "bucket": "This Week",
                "time": trend.get("updated_at"),
                "icon": "trend",
                "description": f"{trend.get('keyword', 'Unknown')} is {str(trend.get('tier', 'STABLE')).lower()} ({trend.get('change_24h', 0)}% 24h)",
                "action": {"href": "/dashboard/trends", "label": "Open trends"},
            }
            for trend in trends
        ])
        return sorted(
            [item for item in timeline if item.get("time")],
            key=lambda item: item["time"],
            reverse=True,
        )

    def _build_payload(self):
        now = datetime.now(timezone.utc)
        since_24h = (now - timedelta(hours=24)).isoformat()
        since_30d = (now - timedelta(days=30)).isoformat()

        matches = self._select(
            "alert_matches",
            {
                "user_id": f"eq.{self.user_id}",
                "matched_at": f"gte.{since_24h}",
                "order": "matched_at.desc",
                "limit": 50,
            },
        )
        complaints = self._select(
            "competitor_complaints",
            {
                "scraped_at": f"gte.{since_24h}",
                "order": "post_score.desc",
                "limit": 20,
            },
        )
        trending = self._select(
            "trend_signals",
            {"order": "change_24h.desc", "limit": 5},
        )
        recent_validations = self._select(
            "idea_validations",
            {
                "user_id": f"eq.{self.user_id}",
                "status": "eq.done",
                "created_at": f"gte.{since_30d}",
                "order": "created_at.asc",
                "limit": 50,
            },
        )

        stale = []
        for validation in recent_validations:
            created_at = _safe_datetime(validation.get("created_at", ""))
            if not created_at:
                continue
            days_ago = (now - created_at).days
            if days_ago >= 30:
                stale.append({
                    "idea": validation.get("idea_text", ""),
                    "days_ago": days_ago,
                })

        top_signal = trending[0] if trending else {}
        top_complaint = complaints[0] if complaints else {}

        brief = {
            "date": now.strftime("%A, %B %d"),
            "alert_matches": len(matches),
            "top_signal": {
                "keyword": top_signal.get("keyword", ""),
                "trend": top_signal.get("tier", ""),
                "change": top_signal.get("change_24h", 0),
            } if top_signal else None,
            "competitor_alerts": len(complaints),
            "top_complaint": {
                "competitor": ", ".join((top_complaint.get("competitors_mentioned") or [])[:2]),
                "signal": ", ".join((top_complaint.get("complaint_signals") or [])[:2]),
                "score": top_complaint.get("post_score", 0),
            } if top_complaint else None,
            "trending": [
                {
                    "keyword": row.get("keyword", ""),
                    "tier": row.get("tier", ""),
                    "change": row.get("change_24h", 0),
                }
                for row in trending
            ],
            "revalidate_suggestions": stale[:5],
        }

        return {
            "brief": brief,
            "timeline": self._build_timeline(matches, complaints, trending),
            "cached": False,
            "generated_at": now.isoformat(),
        }

    def generate(self, force_refresh: bool = False):
        if not force_refresh:
            cached = self._load_cache()
            if cached:
                return cached

        payload = self._build_payload()
        self._upsert_cache(payload)
        return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--force-refresh", action="store_true")
    args = parser.parse_args()

    payload = MorningBrief(args.user_id).generate(force_refresh=args.force_refresh)
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
