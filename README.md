# CueIdea

CueIdea is a startup opportunity intelligence app.

It watches public pain across places like Reddit, Hacker News, Product Hunt, Indie Hackers, jobs, and review signals, then turns that signal into:

- a public opportunity radar
- founder-facing validation runs
- explainable reports
- ongoing monitoring for saved opportunities and reports

Launch domain:

- `https://cueidea.me`

Core product model:

- `Radar` discovers
- `Validate` decides
- `Reports` prove
- `Following` and `Digest` keep the decision alive

## What collaborators should know first

This repo is two systems working together:

1. A Next.js app in [`app/`](./app) for product surfaces, auth, API routes, queue worker, SEO pages, and admin.
2. A Python engine in the repo root and [`engine/`](./engine) for scraping, enrichment, debate, scoring, and report synthesis.

If you are onboarding fast, start here:

1. [`DOCUMENTATION_SUMMARY.md`](./DOCUMENTATION_SUMMARY.md)
2. [`PRODUCT_OPERATING_MODEL.md`](./PRODUCT_OPERATING_MODEL.md)
3. [`DOCUMENTATION.md`](./DOCUMENTATION.md)
4. [`docs/cueidea_system_handbook_2026-04-08.md`](./docs/cueidea_system_handbook_2026-04-08.md)
5. [`README.md`](./README.md)

If you are touching the product UX, also read:

- [`docs/market_user_surface_audit_2026-04-08.md`](./docs/market_user_surface_audit_2026-04-08.md)
- [`docs/dashboard_surface_audit_2026-04-08.md`](./docs/dashboard_surface_audit_2026-04-08.md)
- [`docs/validate_core_audit_2026-04-08.md`](./docs/validate_core_audit_2026-04-08.md)
- [`docs/exhaustive_logic_audit_2026-04-08.md`](./docs/exhaustive_logic_audit_2026-04-08.md)

## Current product state

Important current truths:

- the public launch brand is `CueIdea`
- the public launch domain is `cueidea.me`
- `/`, `/radar`, `/startup-ideas`, and `/dashboard` are crawlable public surfaces
- `Validate` is not allowed to start unless the user has at least one active AI API key configured
- `Refine` and `Competitors` in the market view are real-data-backed, but they still include heuristic suggestion layers that are now labeled more honestly

Recent product shifts already reflected in code:

- stronger favicon, manifest, brand logo, and loading identity
- cleaner public SEO metadata and sitemap/robots setup
- public radar and startup ideas pillar pages
- better report evidence funnel clarity
- visible AI-key gate for validation
- `Following` replacing the older monitor-heavy mental model

## Main user-facing surfaces

### Public

- [`app/src/app/page.tsx`](./app/src/app/page.tsx) - homepage
- [`app/src/app/radar/page.tsx`](./app/src/app/radar/page.tsx) - public radar page
- [`app/src/app/startup-ideas/page.tsx`](./app/src/app/startup-ideas/page.tsx) - public pillar page
- [`app/src/app/how-it-works/page.tsx`](./app/src/app/how-it-works/page.tsx) - public explainer
- [`app/src/app/pricing/page.tsx`](./app/src/app/pricing/page.tsx) - pricing

### App

- [`app/src/app/dashboard/page.tsx`](./app/src/app/dashboard/page.tsx) - server entry for dashboard
- [`app/src/app/dashboard/StockMarket.tsx`](./app/src/app/dashboard/StockMarket.tsx) - main radar UI
- [`app/src/app/dashboard/validate/page.tsx`](./app/src/app/dashboard/validate/page.tsx) - validation entry and live run UX
- [`app/src/app/dashboard/reports/page.tsx`](./app/src/app/dashboard/reports/page.tsx) - report library
- [`app/src/app/dashboard/reports/[id]/page.tsx`](./app/src/app/dashboard/reports/[id]/page.tsx) - single report view
- [`app/src/app/dashboard/saved/page.tsx`](./app/src/app/dashboard/saved/page.tsx) - Following page
- [`app/src/app/dashboard/alerts/page.tsx`](./app/src/app/dashboard/alerts/page.tsx) - alert configuration
- [`app/src/app/dashboard/settings/page.tsx`](./app/src/app/dashboard/settings/page.tsx) - settings and AI keys

### Brand and shell

- [`app/src/app/layout.tsx`](./app/src/app/layout.tsx) - metadata, icons, global shell
- [`app/src/app/components/brand-logo.tsx`](./app/src/app/components/brand-logo.tsx) - shared logo renderer
- [`app/src/app/loading.tsx`](./app/src/app/loading.tsx) - loading screen
- [`app/src/app/manifest.ts`](./app/src/app/manifest.ts) - web app manifest

## Architecture

### Next.js app

The app handles:

- public marketing pages
- dashboard UI
- auth and settings
- route handlers
- queue submission
- validation polling
- admin surfaces
- SEO metadata, robots, and sitemap

Important app routes:

- [`app/src/app/api/market/intelligence/route.ts`](./app/src/app/api/market/intelligence/route.ts)
- [`app/src/app/api/validate/route.ts`](./app/src/app/api/validate/route.ts)
- [`app/src/app/api/validate/[jobId]/route.ts`](./app/src/app/api/validate/[jobId]/route.ts)
- [`app/src/app/api/validate/[jobId]/status/route.ts`](./app/src/app/api/validate/[jobId]/status/route.ts)
- [`app/src/app/api/settings/ai/route.ts`](./app/src/app/api/settings/ai/route.ts)

### Python engine

The Python layer handles:

- scraper orchestration
- source-specific scraping
- market scoring
- evidence shaping
- debate runs
- report synthesis
- enrichment

Important Python entry points:

- [`scraper_job.py`](./scraper_job.py)
- [`run_scan.py`](./run_scan.py)
- [`validate_idea.py`](./validate_idea.py)
- [`enrich_idea.py`](./enrich_idea.py)

Important engine modules:

- [`engine/multi_brain.py`](./engine/multi_brain.py)
- [`engine/validation_depth.py`](./engine/validation_depth.py)
- [`engine/keyword_scraper.py`](./engine/keyword_scraper.py)
- [`engine/reddit_async.py`](./engine/reddit_async.py)
- [`engine/config.py`](./engine/config.py)

## Key system concepts

### Market visibility

The radar does not simply show every scraped idea.

There is a visibility contract that decides whether an opportunity is:

- visible
- hidden because it still needs a wedge
- hidden because proof is weak
- hidden because it is malformed
- hidden because editorial shaping suppressed it

Important files:

- [`app/src/lib/market-feed.ts`](./app/src/lib/market-feed.ts)
- [`app/src/lib/public-idea-eligibility.ts`](./app/src/lib/public-idea-eligibility.ts)
- [`app/src/lib/market-visibility.ts`](./app/src/lib/market-visibility.ts)

### Validation truth contract

Validation is intentionally stricter than a feed card.

A report distinguishes:

- raw collected hits
- filtered synthesis corpus
- database history contribution
- canonical direct evidence
- adjacent/supporting evidence

Important files:

- [`validate_idea.py`](./validate_idea.py)
- [`engine/multi_brain.py`](./engine/multi_brain.py)
- [`app/src/app/dashboard/reports/[id]/page.tsx`](./app/src/app/dashboard/reports/[id]/page.tsx)

### Market intelligence tabs

`Emerging`, `Refine`, and `Competitors` are not mock sections.

They are built from real database rows, then shaped with heuristic copy where needed.

Important files:

- [`app/src/app/dashboard/StockMarket.tsx`](./app/src/app/dashboard/StockMarket.tsx)
- [`app/src/lib/market-intelligence.ts`](./app/src/lib/market-intelligence.ts)
- [`app/src/lib/competitor-weakness.ts`](./app/src/lib/competitor-weakness.ts)
- [`app/src/lib/why-now.ts`](./app/src/lib/why-now.ts)

## Local development

### App

From [`app/`](./app):

```bash
npm install
npm run dev
```

Useful scripts:

```bash
npm run dev:all
npm run build
npm run worker
npm run verify:queue
```

### Python dependencies

From the repo root:

```bash
pip install -r requirements-scraper.txt
```

Current scraper requirements live in:

- [`requirements-scraper.txt`](./requirements-scraper.txt)

### Environment

The app expects local env in:

- [`app/.env.local`](./app/.env.local)

Common categories of env values:

- Supabase URL and keys
- AI encryption key
- Stripe keys
- app/site public URLs
- optional Reddit OAuth values for the Reddit lab flow

Server deployments currently use a separate environment file on the VPS.

## Operational notes

### Validation UX

- users must connect at least one active AI model before validation can start
- the API enforces this on the server, not only in the UI
- progress copy should stay user-safe; infra failures belong in admin/operator views

### Search and discoverability

Current launch discoverability work includes:

- `robots.txt`
- `sitemap.xml`
- homepage metadata
- public radar metadata
- `SoftwareApplication` schema on the homepage
- dedicated public routes for `/radar` and `/startup-ideas`

### Branding

The current brand assets live in:

- [`app/public/brand/`](./app/public/brand)
- [`app/public/favicon.ico`](./app/public/favicon.ico)
- [`app/public/favicon-32.png`](./app/public/favicon-32.png)
- [`app/public/favicon-16.png`](./app/public/favicon-16.png)

## Repo map

### Product docs

- [`PRODUCT_BLUEPRINT.md`](./PRODUCT_BLUEPRINT.md)
- [`PRODUCT_OPERATING_MODEL.md`](./PRODUCT_OPERATING_MODEL.md)
- [`USER_FLOW.md`](./USER_FLOW.md)
- [`PAGE_AUDIT.md`](./PAGE_AUDIT.md)
- [`DATA_QUALITY_MAP.md`](./DATA_QUALITY_MAP.md)
- [`SYSTEM_CARTOGRAPHY.md`](./SYSTEM_CARTOGRAPHY.md)

### Audits and strategy docs

- [`docs/market_user_surface_audit_2026-04-08.md`](./docs/market_user_surface_audit_2026-04-08.md)
- [`docs/dashboard_surface_audit_2026-04-08.md`](./docs/dashboard_surface_audit_2026-04-08.md)
- [`docs/validate_core_audit_2026-04-08.md`](./docs/validate_core_audit_2026-04-08.md)
- [`docs/exhaustive_logic_audit_2026-04-08.md`](./docs/exhaustive_logic_audit_2026-04-08.md)
- [`docs/market_logic_audit_2026-04-06.md`](./docs/market_logic_audit_2026-04-06.md)

### Queue and validation verification

- [`VALIDATION_BENCHMARK_REPORT.md`](./VALIDATION_BENCHMARK_REPORT.md)
- [`SOURCE_SCRAPE_SMOKE_REPORT.md`](./SOURCE_SCRAPE_SMOKE_REPORT.md)
- [`docs/validation_queue_verification.md`](./docs/validation_queue_verification.md)

## Collaboration guidelines

If you are making product changes:

1. Prefer fixing truth and clarity before adding more cleverness.
2. Keep public copy short and legible.
3. Distinguish clearly between observed evidence and inferred suggestions.
4. Do not reintroduce fake trading language, fake financial theater, or mock metrics.
5. Validate major UI or logic changes with:
   - `cmd /c npx tsc --noEmit`
   - `cmd /c npm run build --silent`

If you are touching market logic:

1. Check whether the field is evidence-backed or inferred.
2. Check whether the same idea can appear differently across surfaces.
3. Check whether weak-evidence ideas are being overstated.

If you are touching validation:

1. Preserve the evidence funnel.
2. Keep user-facing progress copy calm and non-technical.
3. Keep hard API checks on the server.

## Known non-product files

There are some local logs, rerun artifacts, and scratch files in the repo root. They are useful during debugging but should not be treated as canonical product docs.

Examples:

- `*_rerun.log`
- `trust_pass_run.log`
- `qwen_timeout_reddit_source_rerun.log`
- `live_market.json`

## Status

This repository is active and moving quickly.

If you are unsure what is current, treat the app code and this README as the starting point, then use the docs linked above to go deeper.
