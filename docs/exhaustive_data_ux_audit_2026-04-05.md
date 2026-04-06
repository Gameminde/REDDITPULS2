# CueIdea Exhaustive Data + UX Audit

Date: 2026-04-05  
Scope: user-facing product surfaces only  
Environment audited: local code + live Supabase data snapshot  
Goal: explain why new users do not understand the product, where the data quality breaks trust, and what needs to be cleaned up first

## Executive Summary

CueIdea has a real product underneath:
- real community posts
- real multi-source scraping
- real validation reports
- real opportunity clustering

But the current user-facing experience still fails the first-visit test for two reasons:

1. The product **looks like a trading terminal** more than a startup idea validation app.
2. The app exposes **too much raw pipeline language, too much weak data, and too many intermediate judgments** before giving the user a conclusion.

The biggest problem is not just text density. It is this combination:
- weak topic generation
- broken or empty summaries
- too many low-confidence ideas still appearing in browse flows
- financial/trading-style labels like `Market`, `Rising`, `Falling`, `Score`, `Signals`
- expert-mode panels shown too early

The result:
- visitors do not immediately understand what the app does
- weak ideas reduce trust in strong ideas
- users must read system reasoning before they even understand the answer

## Product Clarity Audit

### What users need to understand in 5 seconds

CueIdea is:
- a startup idea discovery and validation app
- built for founders and product teams
- turns real complaints into product opportunities
- helps decide what is worth building next

CueIdea is not:
- a stock tracker
- a crypto dashboard
- a trading terminal
- a general market news product

### Why users currently misread it as trading software

The app currently uses a heavy cluster of trading-style words on the main board:
- `Market`
- `Live Signals`
- `Rising`
- `Falling`
- `Avg Score`
- `Top Scores`
- `Scan`

This pattern is visible in the main market screen in [StockMarket.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/StockMarket.tsx#L2442) and [StockMarket.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/StockMarket.tsx#L2644).

The top bar reinforces this terminal feeling with archive counts and status language in [TopBar.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/components/TopBar.tsx#L171).

### Product clarity verdict

The product promise is good.  
The current vocabulary makes it sound like a market-tracking tool before it sounds like an idea-validation tool.

## Live Data Quality Snapshot

Pulled from the current Supabase snapshot during this audit:

- `posts`: `3,921`
- `ideas`: `151`
- `idea_history`: `4,026`
- `scraper_runs`: `113`
- `idea_validations`: `67`
- `profiles`: `12`
- `watchlists`: `0`
- `analytics_events`: `184`

### Source coverage in archived posts

- `reddit`: `1,800`
- `hackernews`: `1,780`
- `producthunt`: `190`
- `indiehackers`: `121`
- `githubissues`: `26`
- `unknown`: `4`

This is a real multi-source archive. The data foundation is not fake.

### Quality of the full `ideas` table

Across all `151` ideas:

- `103` have score `< 20`
- `116` have score `< 25`
- `76` are `INSUFFICIENT` confidence
- `111` are single-source
- `51` have fewer than `3` posts
- `122` have no `pain_summary`
- `139` have a missing or broken summary

This means the browse layer is sitting on top of a very noisy inventory.

### Quality of the top 50 visible browse ideas

Using the same public-style filter as the ideas endpoints, among the top `50` non-`INSUFFICIENT` ideas:

- `31` still have score `< 30`
- `36` are still single-source
- `18` have fewer than `5` posts
- `47` have broken or empty summaries
- `3` are `MEDIUM`
- `0` are `HIGH` or `STRONG`

This is the most important number in the audit:

**The public browse layer is mostly made of weak ideas wearing polished UI.**

## Concrete Bad Data Examples

### Broken topic titles

Real examples currently in the data:
- `Else Tired`
- `Fuckingg Million Dollars`
- `Don Know`
- `Explore Page`
- `Hey Guys`
- `Featured Offer`
- `Tiktok Littlebabybat_0`

These are not usable opportunity names.

### Generic subreddit bucket titles that still feel weak

Real examples in the current visible set:
- `Pain signals from Legaladvice`
- `Pain signals from Cscareerquestions`
- `Pain signals from Smallbusiness`
- `Pain signals from Productivity`
- `Pain signals from Notion`

These are technically cleaner than the broken titles above, but still too internal and too bucket-like for public UX.

### Broken NLP summaries

Real examples:
- `People repeatedly complain about frustrated with.`
- `People repeatedly complain about frustrated with and manual process.`
- `People repeatedly complain about i wish there was.`
- `People repeatedly complain about need help finding.`

This is trust-damaging output. It reads like an unfinished prototype.

## Root Causes in the Pipeline

### 1. Pain summaries are generated from phrase fragments that do not guarantee English

In [scraper_job.py](c:/Users/PC/Desktop/youcef/A/RedditPulse/scraper_job.py#L531), `_build_pain_summary()` builds phrases like:
- `People repeatedly complain about {top_phrase}`

The problem is that many `PAIN_PHRASES` are fragments, not user-facing clauses. That directly creates broken output like:
- `complain about frustrated with`
- `complain about need help finding`

This is the clearest backend root cause of visible bad copy.

### 2. Subreddit bucket fallback still creates internal-feeling topics

In [scraper_job.py](c:/Users/PC/Desktop/youcef/A/RedditPulse/scraper_job.py#L3072), subreddit-derived topics are named as:
- `Pain signals from {Subreddit}`

Even when technically valid, this is not a product opportunity. It is a collection bucket.

### 3. Market filtering is not strict enough for public browse

The public ideas endpoints only exclude `INSUFFICIENT` confidence in:
- [api/ideas/route.ts](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/api/ideas/route.ts#L24)
- [api/public/ideas/route.ts](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/api/public/ideas/route.ts#L14)

That still allows a large amount of:
- low-score ideas
- single-source ideas
- low-volume ideas
- broken-summary ideas

to reach the public grid.

### 4. The app hydrates too much intelligence into browse surfaces

`buildIdeaDetailPayload()` and `buildMarketIdeas()` assemble trust, evidence, strategy, hints, and market presentation in:
- [idea-api.ts](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/lib/idea-api.ts#L55)
- [market-feed.ts](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/lib/market-feed.ts#L312)

This is useful for deeper views, but too much of that output leaks into browse surfaces.

## User-Facing UX / Information Architecture Findings

### 1. Market screen still behaves like an operator console

The opening block in [StockMarket.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/StockMarket.tsx#L2442) still pushes:
- live feed framing
- counts
- scan actions
- stat cards
- feed filters

before the user sees a simple answer to:
- What is this?
- Why should I care?
- Which idea is strongest?

### 2. The expanded desktop market card still contains too much system reasoning

The mobile version has already been staged better into:
- `Verdict`
- `Evidence`
- `Next step`
- optional `Show full analysis`

in [StockMarket.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/StockMarket.tsx#L1658).

But the desktop expanded card still exposes too much at once, including:
- signal badge logic
- confidence badge logic
- direct buyer proof
- source diversity
- data quality
- validation CTA
- board readiness
- missing proof
- recommended action
- legacy metadata warnings
- score formulas

You can see this overload in [StockMarket.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/StockMarket.tsx#L980) and [StockMarket.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/StockMarket.tsx#L1105).

This is expert-mode analysis shown too early.

### 3. Explore cards are still too tall and too analytical for scan mode

In [explore/page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/explore/page.tsx#L414), each card currently shows:
- verdict
- score
- category
- title
- summary paragraph
- 24h movement
- updated time
- momentum box
- posts box
- sources box
- trust badge
- trust score
- evidence
- freshness
- direct proof
- weak signal reasons
- strategy posture

That is too much for a browse grid.

### 4. Validate page still talks like an internal AI lab

The opening copy in [validate/page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L745) uses language like:
- `Validation Engine`
- `Extract the pain. Debate the build. Ship with conviction.`
- `full multi-pass pipeline`
- `decompose the wedge`
- `claim contract`

This is powerful language for power users, but it still reads like tool internals rather than a simple founder action.

### 5. Landing is improved, but still carries a process-first tone in parts

The landing is much clearer now, especially with:
- `Find startup ideas`
- `Not stocks, crypto, or trading`

in [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/page.tsx#L442) and [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/page.tsx#L455).

But some support sections still lean process-heavy:
- `Turn it into an opportunity`
- `Additional proof lanes include ... when available`
- `Product angle`

These are better than before, but still a little too pipeline-aware for a cold visitor.

## Why the App Feels "Too Texty"

The problem is not only paragraph count. It is repeated explanatory labeling.

The UI currently repeats the same kinds of text in multiple places:
- what the score means
- what the evidence means
- what is missing
- what the recommendation is
- what source diversity means
- what trust means

This creates a pattern where every card is trying to:
- summarize the opportunity
- explain the system
- defend the model
- warn about limitations
- propose a next move

all in the same view.

The result is a UI that feels intellectually dense even when the data itself is not strong.

## Priority Problems Ranked

### Critical

1. Weak ideas still appear too prominently in public browse
2. Broken pain summaries visibly damage trust
3. Topic generation still produces junk and bucket-style names
4. Desktop market details reveal too much scaffolding

### High

1. Product vocabulary still feels like trading / signal terminal language
2. Explore cards are too dense for browsing
3. Validate screen copy is too technical for first-time users
4. Summary fallbacks are not strong enough when no real summary exists

### Medium

1. Too many slightly different words for the same concept
2. Top bar still behaves like an operator HUD
3. Landing still has a few process-heavy support sections

## What Must Change First

### Phase 1: Data Quality Gate Before UI

Before more design polish, add a stricter public visibility gate.

Minimum recommendation for browse visibility:
- confidence not `INSUFFICIENT`
- score >= `30`
- source_count >= `2` or direct buyer proof > `0`
- post_count_total >= `5`
- valid clean topic name
- safe summary or strong fallback available

If this gate existed today, the app would instantly feel smarter.

### Phase 2: Replace Topic and Summary Generation

Replace the current public summary strategy:
- never surface `People repeatedly complain about ...`
- never surface `Pain signals from ...`
- never surface fragment-derived phrases

Preferred fallback order:
1. clean public-facing opportunity title
2. strongest representative complaint title
3. plain-language source-backed sentence

### Phase 3: Make Browse Surfaces Conclusion-First

For public cards, show only:
- title
- one-sentence conclusion
- score or verdict
- evidence count
- CTA

Everything else should be hidden by default.

### Phase 4: Rename the Market Vocabulary

Replace or soften terms that create trading confusion:
- `Market` -> `Opportunity board` or `Idea board`
- `Live signals` -> `Live opportunities`
- `Rising / Falling` -> `Gaining traction / Cooling off`
- `Top scores` -> `Best bets`

You do not have to remove metrics.  
You need to rename them into founder language.

## Recommended Cleanup Roadmap

### Immediate

1. Add a public-quality gate for ideas
2. Replace summary generation with stronger fallbacks
3. Suppress `Pain signals from ...` buckets from browse
4. Collapse desktop market cards to the same 3-block disclosure model as mobile

### Next

1. Rename market terminology away from trading language
2. Shorten explore cards to one conclusion block + one compact metric row
3. Rewrite validate hero copy in simple founder language
4. Reduce top-bar telemetry on user-facing pages

### Later

1. Create separate modes:
   - founder mode
   - operator/admin mode
2. Move deep system explanations into admin or advanced views only
3. Add explicit product screenshots / visual walk-through for onboarding

## Final Verdict

CueIdea does not have a fake-data problem.  
It has a **data staging problem**.

The app is trying to show:
- raw signal
- trust reasoning
- scoring logic
- strategy
- warnings
- internal evidence mechanics

all at once.

That makes even real, valuable data feel noisy and harder to trust.

The cleanup should not start with more animation or more panels.
It should start with:

1. stricter public data gating  
2. cleaner topic and summary generation  
3. conclusion-first browse cards  
4. founder-language renaming

Once those four are done, the product will feel much more obvious, premium, and trustworthy without changing its core engine.
