# Market Logic Audit - 2026-04-06

## Current truth

- The public market reads from `ideas`, not raw `posts`.
- The scraper is collecting raw data, but the public board only shows rows that survive:
  - topic shaping
  - market classification
  - public browse eligibility
  - and now, when present, market editorial visibility

## What was broken

### 1. Editorial AI was not reaching existing ideas

- The original editorial pass mostly processed `current_rows` from the active scraper run.
- Existing ideas already in the database were not being backfilled in a practical way.
- Result:
  - `market_editorial` stayed null for most of the board
  - publish mode could not really prove whether AI filtering helped

### 2. Cerebras structured output schema was too strict

- The original schema used unsupported JSON schema fields for Cerebras:
  - `minLength`
  - `maxLength`
  - `minItems`
  - `maxItems`
- Result:
  - `422 wrong_api_format`
  - editorial runs failed before producing valid payloads

### 3. Backfill writes were using the wrong persistence pattern

- The first backfill attempt used minimal upserts on `ideas` with only editorial fields.
- That caused insert-style failures on rows that required full non-null data.
- Fixed by patching rows by `slug` instead of partial upsert.

### 4. Failed editorial rows were not retried quickly

- A failed editorial payload still had a fresh `updated_at`.
- The refresh logic treated it as recent and skipped retry for up to `MARKET_AGENT_REFRESH_HOURS`.
- Fixed so non-success editorial rows are retried immediately.

### 5. Candidate selection wasted tokens on subreddit buckets

- Top rows in the DB are dominated by `sub-*` buckets and other coarse themes.
- The editorial layer spent tokens judging those instead of stronger shaped opportunities.
- Fixed by skipping:
  - `sub-*` buckets
  - `not-promote` slugs
  - `pain signals from ...` style topics
  - weak single-source rows without real supporting proof

## What the AI revealed about the market

The AI is not the main problem. It exposed real upstream quality issues:

- `feedback-tools` was a bad derived opportunity.
  - The evidence was mostly feature requests in dev tooling, not real pain about feedback tooling itself.
- `dyn-social-media` was real but broad.
  - The signal looked early and founder-useful, but not mature enough for a hard `public` verdict.
- Several top database rows are still just subreddit-bucket artifacts.

This means the market currently has a **clustering and shaping problem**, not just a UI problem.

## Product decision calibration

Pure `public` vs `internal` was too harsh for this stage of the product.

For an opportunity board, we need a middle state:

- `public`
  - strong enough to browse confidently
- `needs_more_proof`
  - specific enough to browse
  - still early
  - should remain visible if it passes a stronger soft gate
- `internal`
  - too weak, too generic, misclustered, or misleading

That is now implemented in the public logic:

- `needs_more_proof` can be shown when the idea still has:
  - valid title
  - valid summary
  - score >= 25
  - post_count_total >= 5
  - source_count >= 2 or direct buyer proof

## Current deployed state

Deployed commits in this sequence:

- `1cdbd74` - Backfill existing market ideas with editorial AI
- `bd24094` - Fix Cerebras schema and editorial backfill writes
- `2df1606` - Relax Cerebras editorial array schema
- `f435197` - Retry failed market editorial rows immediately
- `82cdfa8` - Skip low-value subreddit buckets in editorial backfill
- `e649b79` - Show editorial needs-more-proof opportunities

## Live result after fixes

- Editorial persistence works.
- Cerebras responses are being stored successfully.
- The market is no longer stuck on heuristic-only rows.
- The public board recovered from `0` to `3` visible ideas under AI publish mode.

Visible examples now include:

- `feedback-tools`
- `dyn-social-media`
- `dyn-small-business`

These are currently visible as `needs_more_proof`, not as strong public approvals.

## Remaining problems

### 1. Reddit ingestion quality is still weak

- Reddit access is still highly dependent on a noisy proxy pool.
- Async success is inconsistent.
- The scraper still reports poor proxy health and too many blocked/timeouts in practice.

### 2. The top of the `ideas` table is still polluted

- Too many high-ranked rows are coarse buckets instead of shaped opportunities.
- This wastes scoring attention and editorial budget.

### 3. Opportunity shaping is still producing malformed or overly broad themes

Examples seen in editorial backfill:

- `dyn-hey-everyone`
- `dyn-lot-people`
- `dyn-https-www`
- `dyn-explore-page`

These should not make it near the top candidate list.

## Next best moves

1. Tighten cluster/topic shaping before scoring.
2. Penalize coarse `sub-*` and malformed `dyn-*` rows earlier in the pipeline.
3. Improve proxy hygiene on VPS:
   - remove dead proxies faster
   - separate HTTP vs SOCKS pools more intentionally
4. Add a small operator surface showing:
   - editorial status counts
   - editorial visibility distribution
   - top critic rejection reasons
5. Keep publish mode for testing, but use the admin comparison surface to monitor whether `needs_more_proof` rows are actually useful to founders.
