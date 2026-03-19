# RedditPulse Market Attack Execution Plan

Generated: 2026-03-17

## 1. Goal

Transform RedditPulse from a useful but partly noisy validation product into a recurring, subscription-worthy **Market Attack Engine** for solo founders building B2B SaaS.

This plan is grounded in the current repo, not a greenfield rewrite.

## 2. What Exists Today

Current repo primitives already map well to the target product:

| Target object | Current repo primitive | Status |
|---|---|---|
| Opportunity | `ideas` | Strong base, still too score-centric |
| Validation | `idea_validations` + `validate_idea.py` | Strongest current asset |
| Monitor | `watchlists`, `pain_alerts`, `alert_matches`, `competitor_complaints`, Market Pulse | Fragmented across retention features |
| Brief | `engine/morning_brief.py` + `morning_brief_cache` + `/api/digest` | Proto-brief exists |
| Change Event | `idea_history`, scraper deltas, alert matches, complaints | Not unified |
| Decision Pack | `report` JSON inside `idea_validations` | Rich but unstructured for recurring workflows |

Key code centers:

- Opportunity engine:
  - [scraper_job.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scraper_job.py)
  - [schema_stock_market.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/sql/schema_stock_market.sql)
- Validation engine:
  - [validate_idea.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/validate_idea.py)
  - [engine/multi_brain.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/engine/multi_brain.py)
  - [schema_validations.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/sql/schema_validations.sql)
- Monitoring fragments:
  - [005_strategic_features.sql](/c:/Users/PC/Desktop/youcef/A/RedditPulse/migrations/005_strategic_features.sql)
  - [app/src/app/api/watchlist/route.ts](/c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/api/watchlist/route.ts)
  - [app/src/app/api/alerts/route.ts](/c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/api/alerts/route.ts)
  - [app/src/app/api/competitor-complaints/route.ts](/c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/api/competitor-complaints/route.ts)
  - [engine/pain_stream.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/engine/pain_stream.py)
  - [engine/competitor_deathwatch.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/engine/competitor_deathwatch.py)
- Brief/digest:
  - [engine/morning_brief.py](/c:/Users/PC/Desktop/youcef/A/RedditPulse/engine/morning_brief.py)
  - [app/src/app/api/digest/route.ts](/c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/api/digest/route.ts)
- Trust layer already started:
  - [app/src/lib/trust.ts](/c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/lib/trust.ts)

## 3. Product Reframe

RedditPulse should organize around 4 user workflows:

1. **Discover**
   - Find attackable B2B SaaS wedges
2. **Validate**
   - Deeply test one idea
3. **Monitor**
   - Track an opportunity, competitor, pain theme, or wedge over time
4. **Brief**
   - See what changed and what to do next

This means the product should gradually de-emphasize “many dashboards” and emphasize “few high-trust workflows.”

## 4. What To Keep, Merge, Rename, or Demote

### Keep and upgrade

- `Explore` -> keep, but evolve into **Opportunities**
- `Validate` -> keep as the primary hook
- `Saved` -> keep, but evolve into **Monitors**
- `Digest` -> keep, but evolve into **Brief**
- `Reports` -> keep, but gradually expose a structured Decision Pack

### Merge or absorb

- `Trends` -> should become a filtered view of Opportunities and Monitors, not a parallel concept
- `Alerts` -> should fold into the Monitor model as monitor events
- `Competitors` -> should become a monitorable competitor weakness view, not a separate island
- `WTP` -> should be absorbed into Opportunity trust and Decision Pack output

### Demote or keep secondary

- `Scans` -> admin/debug or advanced exploration, not primary navigation
- `Sources`/source diagnostics -> internal or advanced transparency, not a main user mental model

## 5. The Canonical Data Model To Build Toward

Do not jump straight to many new tables. Build toward this model incrementally.

### A. Evidence

Atomic signal from a source.

Minimum shape:

- `id`
- `entity_type` (`opportunity`, `competitor`, `keyword`, `validation`)
- `entity_key`
- `source_class` (`pain`, `commercial`, `competitor`, `timing`, `verification`)
- `source_name`
- `platform`
- `url`
- `observed_at`
- `signal_kind`
- `title`
- `snippet`
- `author_handle` optional
- `score` optional
- `directness` (`direct_evidence`, `derived_metric`, `ai_inference`)
- `confidence`
- `metadata`

### B. Opportunity

`ideas` should grow from a stock-style row into a richer market wedge object:

- topic/wedge
- category
- trust
- pain signals
- buyer proof
- competitor weakness summary
- why-now summary
- first attack angle
- monitoring deltas

### C. Validation

`idea_validations` remains the deep-analysis object, but should emit structured Decision Pack fields in addition to report text.

### D. Monitor

Unify these fragments:

- `watchlists`
- `pain_alerts`
- `competitor_complaints`
- Market Pulse deltas
- digest reminders

Target shape:

- `id`
- `user_id`
- `monitor_type` (`opportunity`, `validation`, `competitor`, `keyword`, `pain_theme`)
- `target_id`
- `target_key`
- `name`
- `status`
- `notification_preferences`
- `created_at`
- `last_checked_at`
- `last_changed_at`

### E. Change Event

Instead of forcing users to infer movement from raw tables, store explicit change records:

- `id`
- `monitor_id`
- `event_type`
- `direction`
- `summary`
- `evidence_ids`
- `detected_at`
- `impact_level`

### F. Decision Pack

Structured output layer for validations and eventually opportunities:

- verdict
- confidence
- demand proof
- buyer clarity
- competitor weakness
- why now
- market attack angle
- pricing test
- launch test
- kill criteria

## 6. Source Strategy For This Repo

### Keep and stabilize first

Pain sources:

- Reddit
- Hacker News
- Stack Overflow
- GitHub Issues

These already fit the repo and support the pain/opportunity engine.

### Keep only if reliable

- Product Hunt
- Indie Hackers

These should not dominate trust unless stability improves.

### Add next

1. **Competitor websites + pricing pages**
   - Highest-value trust upgrade
   - Best source for attack angle, pricing test, and incumbent weakness
2. **Review-like sources**
   - G2, Capterra, marketplaces, public review pages
   - Best source for switching intent and buyer proof
3. **Google Trends**
   - Useful only as timing context, not as primary proof
4. **Job boards**
   - Useful for why-now and workflow urgency

### Avoid for now

- many new noisy community sources
- more unstable scraping for its own sake
- adding sources that do not materially improve trust or decision quality

## 7. The Best Build Order For This Codebase

This is the order that best fits the current architecture.

### Phase A — Finish Trust Foundation

Goal:

- make opportunities, validations, and monitors visibly auditable

Build:

1. Extend the trust contract to:
   - Alerts
   - Competitor views
   - Digest/Brief
2. Add explicit `direct_evidence` vs `inference` labeling at the evidence-item level
3. Add freshness and source diversity everywhere a major conclusion appears

Why first:

- the repo already has most required fields
- this raises trust fast without a rewrite

### Phase B — Evidence Normalization Layer

Goal:

- stop treating `top_posts`, alert matches, complaints, report evidence, and trend rows as separate shapes

Build:

1. New evidence helper contract
2. Normalize:
   - `ideas.top_posts`
   - validation evidence
   - `alert_matches`
   - `competitor_complaints`
   - trend/top post snippets
3. Use one evidence serializer across APIs

Why second:

- this is the foundation for competitor weakness, why-now, briefs, and decision packs

### Phase C — Competitor Weakness Radar

Goal:

- make RedditPulse useful for attack strategy, not just idea scoring

Build:

1. competitor profile object
2. pricing page / product page / review evidence ingestion
3. weakness clusters:
   - overpriced
   - overbuilt
   - missing integrations
   - poor support
   - SMB neglect
4. competitor weakness events in monitor feeds

Best existing foundations:

- `competition_data`
- `competitor_complaints`
- report competitor sections

### Phase D — Why-Now Engine

Goal:

- explain timing shifts instead of only showing current pain

Build:

1. why-now signal class
2. Google Trends + recent activity + job boards + launch/release changes
3. opportunity-level timing summaries
4. trend decay / strengthening in Briefs

Best existing foundations:

- `trend_signals`
- Google Trends usage already present in validation
- `idea_history`

### Phase E — Monitor Unification

Goal:

- convert saved items, alerts, complaints, and pulse deltas into a recurring product loop

Build:

1. canonical `Monitor` model
2. monitor creation from:
   - opportunity
   - validation
   - competitor
   - keyword/pain theme
3. change-event feed
4. “what changed since last check?” for every monitor

Why this matters:

- this is the subscription engine

### Phase F — Decision Pack

Goal:

- turn reports into reusable decision infrastructure

Build:

1. structured decision-pack schema in validation outputs
2. stable API contract
3. report UI with clear sections:
   - demand proof
   - buyer clarity
   - competitor weakness
   - pricing test
   - wedge
   - kill criteria
4. reuse pieces in Opportunities and Briefs

### Phase G — Information Architecture Cleanup

Goal:

- reduce page confusion and product split-brain

Likely route model:

- `/dashboard/opportunities`
- `/dashboard/validate`
- `/dashboard/monitors`
- `/dashboard/brief`
- secondary:
  - reports
  - competitors
  - settings

### Phase H — Monetization Refactor

Goal:

- make pricing align with recurring value

Target premium model:

- validation credits or deep validation allowance
- active monitor slots
- premium briefs
- advanced competitor tracking
- exports and comparison

Remove strategic dependence on:

- lifetime-unlock framing

## 8. The First Three Highest-Leverage Engines

If the product must become much more powerful without bloating, prioritize these three engines first:

1. **Competitor Weakness Radar**
   - gives users an attack angle, not just a score
2. **Why-Now Engine**
   - gives timing edge and makes signals feel smarter
3. **Live Market Memory**
   - gives users a reason to come back weekly and pay monthly

These three create the strongest bridge from “insight tool” to “decision and monitoring system.”

## 9. The First Concrete Implementation Slice

The best next implementation slice is:

### Slice 1 — Evidence Layer v1

Deliverables:

1. `docs/evidence_contract.md`
2. evidence normalization helpers shared across:
   - opportunities
   - validations
   - alerts
   - competitor complaints
3. API responses include:
   - `evidence[]`
   - `trust`
   - `freshness`
   - `source_breakdown`
   - `direct_vs_inferred`
4. UI cards gain:
   - “why this matters”
   - direct evidence count
   - clear thin-signal downgrades

Why this slice:

- it compounds every future feature
- it improves trust before new complexity

### Slice 2 — Monitor Model v1

Deliverables:

1. new `monitors` migration
2. map watchlists/pain alerts into monitors
3. add `monitor_events`
4. turn Saved into Monitors
5. turn Digest into “what changed on your monitors”

Why this slice:

- it transforms retention features into a recurring engine

## 10. Minimal Schema Additions To Prepare

These should be incremental, not a full rewrite.

### Add soon

1. `evidence_items`
2. `monitors`
3. `monitor_events`
4. optional `opportunity_scores` or `opportunity_dimensions` JSONB field on `ideas`

### Defer until later

1. full entity graph
2. founder-fit personalization tables
3. advanced simulator tables

## 11. What Not To Build Yet

Do not spend early cycles on:

- many new dashboards
- many new LLM agents
- flashy visualizations
- many extra community scrapers
- advanced team features
- founder-fit personalization before trust and monitors are solid

## 12. Success Metrics For The Transformation

### Trust

- more pages show evidence count, freshness, and source diversity
- fewer thin-signal rows presented as strong

### Recurring usage

- more users save/monitor opportunities after validating or discovering
- digest/brief becomes about changes, not static summaries

### Actionability

- more outputs contain wedge, pricing test, and attack path
- users can tell what to do this week

### Monetization readiness

- premium logic maps to deep validations, active monitors, and recurring briefs
- less dependence on lifetime pricing

## 13. Recommended Immediate Sequence

The best immediate path from here is:

1. Finish trust rollout into Alerts, Competitors, and Brief
2. Write the evidence contract doc and implement Evidence Layer v1
3. Introduce `monitors` + `monitor_events`
4. Convert Saved + Alerts + Digest into the first real monitor workflow
5. Add competitor pricing/product-page ingestion
6. Build Why-Now summaries on top of existing trend/history data
7. Only then simplify IA and pricing around the new product core

## 14. Final Recommendation

RedditPulse should not try to become “the biggest startup idea dashboard.”

It should become:

**the system that helps a solo B2B SaaS founder find an attackable wedge, understand why now, see where incumbents are weak, decide how to enter, and keep monitoring whether the opportunity is getting stronger or weaker.**

That is sharper, more defensible, and much more likely to become a recurring product people pay for.
