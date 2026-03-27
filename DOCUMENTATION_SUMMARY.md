# RedditPulse — Documentation Summary

> Condensed reference card for the full [DOCUMENTATION.md](./DOCUMENTATION.md).

---

## What It Does

RedditPulse validates startup ideas by scraping **8 platforms** (Reddit, HN, ProductHunt, IndieHackers, Stack Overflow, GitHub Issues, G2, App Store), running data through an **adversarial multi-model AI debate**, and returning a structured verdict: **BUILD IT / RISKY / DON'T BUILD** with confidence score, evidence, risks, ICP, and a 12-week roadmap.

---

## Tech Stack

| Layer | Stack |
|-------|-------|
| Frontend | Next.js 14, React 18, TailwindCSS, Framer Motion, Three.js |
| Backend | Python 3.10+ (engine), Node.js (API routes) |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| AI | 7 providers: Gemini, Anthropic, OpenAI, Groq, DeepSeek, Mistral, OpenRouter |
| Payments | Stripe |

---

## Codebase At a Glance

| Category | Count | Total Lines |
|----------|-------|-------------|
| Root Python scripts | 6 | ~4,100 |
| Engine modules | 29 | ~9,500 |
| SQL schemas + migrations | 19+ | ~900 |
| API routes | 28 | ~3,000 |
| Frontend pages | 21 | ~8,000 |
| Frontend libs | 25 | ~3,500 |
| Tests | 2 | targeted pipeline coverage |
| Design docs | 17 | — |
| **Total** | **~115+** | **~25,000+** |

---

## Core Pipelines

### 1. Validation Pipeline (`validate_idea.py`, 1776 lines)
```
Idea → Depth Mode Selection (Quick/Deep/Investigation) → AI Decomposition → 8-Platform Scrape → Local NLP (4-pass) → 3-Pass AI Synthesis → Multi-Model Debate → Verdict
```
Each mode scales Reddit lookback (10min/1h/3h), keyword budgets, evidence sampling, batch signal caps, and competitor depth.

### 2. Scan Pipeline (`run_scan.py`, 549 lines)
```
Keywords → Reddit/HN/PH/IH Scrape → Credibility Check → Per-Post AI Analysis → ICP + Competition + Trends → Multi-Brain Synthesis → Report
```

### 3. Opportunity Engine (`scraper_job.py`, 1359 lines)
```
Scheduled scrape → 45 topics × 12 categories → Score calculation → "Stock price" update → Pain Stream + Deathwatch + Trends
```

---

## Key Modules

| Module | Lines | What It Does |
|--------|-------|-------------|
| `multi_brain.py` | 1181 | Multi-model debate: 3 rounds, adversarial roles, weighted merge |
| `credibility.py` | 457 | 5-tier data quality with Shannon entropy |
| `scorer.py` | 400 | Subreddit-baseline normalized scoring |
| `analyzer.py` | 382 | AI slop filter + VADER + frustration/opportunity NLP |
| `icp.py` | 254 | Ideal Customer Profile aggregation |
| `competition.py` | 510 | Google/Bing scraping + 40+ known competitors |
| `enrich_idea.py` | 303 | SO + GitHub + G2 + AppStore with triangulated gap detection |

---

## Database (20+ live tables)

**Core:** `idea_validations`, `ideas`, `idea_history`, `posts`, `profiles`, `user_ai_config`

**Monitoring:** `monitors`, `monitor_events`, `monitor_snapshots`, `pain_alerts`, `alert_matches`, `competitor_complaints`, `watchlists`

**Supporting:** `scans`, `ai_analysis`, `scraper_runs`, `trend_signals`, `enrichment_cache`, `graveyard_reports`, `morning_brief_cache`

**Security:** RLS is enabled on all current live base tables. `validation_queue` and `trend_signals` are no longer publicly readable. AI keys are encrypted at rest (`pgp_sym_encrypt`). Residual drift remains around `user_ai_config_safe`, which is still publicly readable despite masking the key itself.

---

## Environment Variables (14)

**Required:** `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `AI_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

**AI Providers:** `GEMINI_API_KEY` (fallback), `GROQ_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`

**Optional:** `GITHUB_TOKEN`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `PROXY_LIST`

---

## Premium Access

Hardcoded whitelist in `check-premium.ts` (server) and `use-user-plan.ts` (client):
- `youcefneoyoucef@gmail.com`
- `cheriet.samimhamed@gmail.com`

Stripe webhook upgrades `profiles.plan` to `"pro"` on payment.

---

## Known Limitations

1. Google/Bing scraping susceptible to blocks (fallback: known competitors DB)
2. PullPush.io has intermittent downtime
3. G2/AppStore HTML parsing is fragile
4. Test coverage now exists, but it is still narrow and mostly focused on pipeline smoke/unit cases
5. Validation now runs through a `pg-boss` queue worker, but scraper reliability and worker observability still need hardening
6. Premium emails hardcoded in two separate files
