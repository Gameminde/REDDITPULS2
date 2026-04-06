#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import quote


REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

import scraper_job  # noqa: E402
from market_editorial.orchestrator import run_market_editorial_pass  # noqa: E402


def load_existing_ideas(limit: int) -> list[dict]:
    rows = scraper_job.sb_select(
        "ideas",
        (
            "select=*"
            "&order=current_score.desc.nullslast,last_updated.desc.nullslast"
            f"&limit={max(1, limit)}"
        ),
    )
    return rows if isinstance(rows, list) else []


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a short Cerebras editorial backfill over existing market ideas.")
    parser.add_argument("--limit", type=int, default=int(os.environ.get("MARKET_EDITORIAL_BACKFILL_LIMIT", "120")))
    args = parser.parse_args()

    idea_rows = load_existing_ideas(args.limit)
    if not idea_rows:
        print("[Editorial backfill] No ideas found.")
        return 0

    persist_enabled = scraper_job.table_has_column("ideas", "market_editorial") and scraper_job.table_has_column("ideas", "market_editorial_updated_at")
    _, stale_updates, telemetry = run_market_editorial_pass(
        [],
        idea_rows,
        persist_enabled=persist_enabled,
        logger=print,
    )

    print(
        "[Editorial backfill] "
        f"considered={telemetry.get('considered', 0)} "
        f"processed={telemetry.get('processed', 0)} "
        f"approved_public={telemetry.get('approved_public', 0)} "
        f"fallback={telemetry.get('fallback_count', 0)} "
        f"tokens={telemetry.get('tokens_used', 0)}"
    )

    if not stale_updates:
        print("[Editorial backfill] No editorial updates were produced.")
        return 0

    success_count = 0
    failure_ids: list[str] = []
    for row in stale_updates:
        slug = str(row.get("slug") or "").strip()
        if not slug:
            failure_ids.append("unknown")
            continue
        response = scraper_job.sb_patch(
            "ideas",
            f"slug=eq.{quote(slug, safe='')}",
            {
                "market_editorial": row.get("market_editorial"),
                "market_editorial_updated_at": row.get("market_editorial_updated_at"),
            },
        )
        if response.status_code < 400:
            success_count += 1
        else:
            failure_ids.append(slug)

    print(f"[Editorial backfill] persisted={success_count} failed={len(failure_ids)}")
    if failure_ids:
        print(f"[Editorial backfill] failed_ids={', '.join(failure_ids[:10])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
