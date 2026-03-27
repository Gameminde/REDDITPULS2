import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
ENGINE_DIR = REPO_ROOT / "engine"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from engine.env_loader import load_local_env

load_local_env(REPO_ROOT)

from engine.hn_scraper import run_hn_scrape
from engine.ph_scraper import run_ph_scrape
from engine.ih_scraper import run_ih_scrape
from engine.keyword_scraper import run_keyword_scan
from engine.pullpush_scraper import scrape_historical_comments_multi, scrape_historical_multi
from engine.stackoverflow_scraper import scrape_stackoverflow
from engine.github_issues_scraper import scrape_github_issues
from validate_idea import (
    _fetch_adzuna_job_posts,
    _fetch_g2_review_posts,
    _fetch_vendor_blog_posts,
    classify_icp,
)


SCENARIO = {
    "idea": "invoice chasing for freelancers",
    "keywords": ["invoice", "payment reminder", "late payment", "freelance invoicing"],
    "forced_subreddits": ["freelance", "smallbusiness", "Accounting", "bookkeeping"],
    "known_competitors": ["FreshBooks", "Wave", "QuickBooks"],
    "audience": "Freelancers and solo service businesses",
}

DEV_SCENARIO = {
    "keywords": ["code review", "pull request", "github app", "developer tool"],
}


def _sample_titles(rows, limit=3):
    samples = []
    for row in rows[:limit]:
        title = str(row.get("title") or row.get("post_title") or "").strip()
        if not title:
            title = str(row.get("full_text") or row.get("body") or "").strip()[:120]
        source = str(row.get("source") or row.get("subreddit") or "").strip()
        score = row.get("score")
        samples.append({
            "title": title[:160],
            "source": source,
            "score": score,
        })
    return samples


def _run_probe(name, fn):
    started = time.time()
    try:
        payload = fn()
        rows = []
        status = "ok"
        meta = {}

        if isinstance(payload, dict):
            rows = list(payload.get("posts") or payload.get("results") or [])
            meta = {
                key: value
                for key, value in payload.items()
                if key not in {"posts", "results"}
            }
            if meta.get("status") not in (None, "ok"):
                status = str(meta.get("status"))
        elif isinstance(payload, list):
            rows = payload
        else:
            rows = []
            status = "unexpected"
            meta = {"payload_type": type(payload).__name__}

        elapsed = round(time.time() - started, 2)
        if status == "ok" and len(rows) == 0:
            status = "empty"

        return {
            "name": name,
            "status": status,
            "count": len(rows),
            "elapsed_seconds": elapsed,
            "samples": _sample_titles(rows),
            "meta": meta,
        }
    except Exception as exc:
        return {
            "name": name,
            "status": "error",
            "count": 0,
            "elapsed_seconds": round(time.time() - started, 2),
            "samples": [],
            "meta": {
                "error_type": type(exc).__name__,
                "error": str(exc),
            },
        }


def build_report(results):
    now = datetime.now(timezone.utc).isoformat()
    lines = [
        "# Source Smoke Test Report",
        "",
        f"- Generated: `{now}`",
        f"- Idea scenario: `{SCENARIO['idea']}`",
        f"- Keywords: `{', '.join(SCENARIO['keywords'])}`",
        f"- Audience: `{SCENARIO['audience']}`",
        "",
        "## Summary",
        "",
    ]

    for result in results:
        lines.append(
            f"- `{result['name']}`: `{result['status']}` "
            f"({result['count']} rows, {result['elapsed_seconds']}s)"
        )

    lines.append("")
    lines.append("## Details")
    lines.append("")

    for result in results:
        lines.append(f"### {result['name']}")
        lines.append("")
        lines.append(f"- Status: `{result['status']}`")
        lines.append(f"- Count: `{result['count']}`")
        lines.append(f"- Duration: `{result['elapsed_seconds']}s`")
        if result["meta"]:
            lines.append(f"- Meta: `{json.dumps(result['meta'], ensure_ascii=True)}`")
        if result["samples"]:
            lines.append("- Samples:")
            for sample in result["samples"]:
                source = sample["source"] or "unknown"
                score = sample["score"] if sample["score"] is not None else "n/a"
                lines.append(f"  - `{source}` | `score={score}` | {sample['title']}")
        else:
            lines.append("- Samples: none")
        lines.append("")

    return "\n".join(lines)


def main():
    icp = classify_icp(SCENARIO["idea"], SCENARIO["audience"], SCENARIO["keywords"])

    probes = [
        ("reddit_posts", lambda: run_keyword_scan(
            SCENARIO["keywords"],
            duration="10min",
            forced_subreddits=SCENARIO["forced_subreddits"],
            min_keyword_matches=1,
            idea_text=SCENARIO["idea"],
            icp_category=icp,
            return_metadata=True,
        )),
        ("reddit_historical_posts", lambda: scrape_historical_multi(
            subreddits=SCENARIO["forced_subreddits"][:4],
            keywords=SCENARIO["keywords"][:2],
            days_back=365,
            size_per_sub=20,
        )),
        ("reddit_comments", lambda: scrape_historical_comments_multi(
            subreddits=SCENARIO["forced_subreddits"][:4],
            keyword=SCENARIO["keywords"][:3],
            days_back=365,
            size_per_sub=15,
            max_total=60,
        )),
        ("hackernews", lambda: run_hn_scrape(["invoice", "payment reminder"], max_pages=1)),
        ("producthunt", lambda: run_ph_scrape(["invoice", "developer tools"], max_pages=1, return_health=True)),
        ("indiehackers", lambda: run_ih_scrape(["invoice", "freelance invoicing"], max_pages=1, return_health=True)),
        ("stackoverflow", lambda: scrape_stackoverflow(DEV_SCENARIO["keywords"][:2], max_keywords=2, time_budget=20, pages=1)),
        ("github_issues", lambda: scrape_github_issues(DEV_SCENARIO["keywords"][:2], max_keywords=2, time_budget=20, pages=1)),
        ("g2_reviews", lambda: _fetch_g2_review_posts(icp, SCENARIO["known_competitors"], timeout_seconds=45)),
        ("adzuna_jobs", lambda: _fetch_adzuna_job_posts(SCENARIO["keywords"][:3], icp, timeout_seconds=25, max_posts=20)),
        ("vendor_blogs", lambda: _fetch_vendor_blog_posts(icp, SCENARIO["idea"], SCENARIO["keywords"], max_posts=10)),
    ]

    results = []
    for name, fn in probes:
        print(f"\n=== {name} ===", flush=True)
        results.append(_run_probe(name, fn))
        print(json.dumps(results[-1], indent=2), flush=True)

    report_md = build_report(results)
    report_path = REPO_ROOT / "SOURCE_SCRAPE_SMOKE_REPORT.md"
    report_path.write_text(report_md, encoding="utf-8")
    print(f"\n[report] wrote {report_path}")


if __name__ == "__main__":
    main()
