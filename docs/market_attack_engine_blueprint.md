# RedditPulse Transformation Blueprint

Generated: 2026-03-17

## 1. The New Product Thesis

RedditPulse should not evolve into:

- a better scraper
- a bigger dashboard
- a noisier AI research assistant

RedditPulse should evolve into:

**A Market Attack Engine for solo B2B SaaS founders**

Meaning:

- it finds painful, attackable market wedges
- it explains why now
- it shows where incumbents are weak
- it estimates whether buyers are reachable and likely to pay
- it tells the founder how to enter
- it keeps tracking the wedge over time

The product is no longer just "What idea should I build?"

It becomes:

**"What exact wedge can I realistically attack, why now, and what should I do next?"**

## 2. What RedditPulse Becomes

When the current validation/report engine, recurring scrape engine, and monitoring pieces are unified correctly, RedditPulse becomes five systems inside one product:

1. **Opportunity Finder**
   - detect real pain and neglected workflows
2. **Wedge Generator**
   - turn broad market noise into attackable sub-niches
3. **Competitor Weakness Radar**
   - identify where incumbents are weak, hated, overpriced, or overbuilt
4. **Founder Decision Engine**
   - rank opportunities by attackability, founder fit, and speed to revenue
5. **Validation-to-Revenue Planner**
   - turn insight into wedge, offer, pricing test, and first-customer actions

That is stronger than:

- trend spotting
- validation-only
- market research summarization

## 3. Product Category

RedditPulse should stop behaving like a generic "startup idea tool."

The category should move toward one of these:

- Opportunity Intelligence for B2B SaaS founders
- Founder Decision Engine
- Market Wedge Discovery Platform
- Market Attack Engine for Solo Founders

The sharpest positioning for this repo direction is:

**RedditPulse is a market attack engine for solo B2B SaaS founders.**

## 4. The Unified Core Object

The most important structural decision:

Do not build ten disconnected features.
Build one canonical **Opportunity Object** with richer evidence and decision layers.

Every strong opportunity should answer:

### A. Pain

- what hurts
- how often it appears
- how urgent it sounds
- what workaround behavior exists

### B. Buyer

- who has the pain
- how specific the niche is
- whether the buyer is reachable
- likely budget sensitivity

### C. Competition

- who already serves this workflow
- where they are weak
- who is overbuilt or overpriced
- what gaps appear repeatedly

### D. Timing

- why now
- what has changed recently
- whether momentum is strengthening or fading

### E. Feasibility

- how hard the solution is to build
- how complex the workflow is
- compliance or integration burden

### F. Founder Fit

- whether this is a good wedge for this founder specifically

### G. Attack Path

- the best wedge
- first offer
- pricing test
- fastest channel
- first-customer route
- kill criteria

### H. Monitoring

- what changed
- whether the wedge is getting stronger or weaker
- whether competitor vulnerability is increasing
- whether buyer proof is strengthening

## 5. The Internal Architecture It Implies

RedditPulse should converge on these internal objects:

1. **Evidence**
   - atomic signal from a source
2. **Entity**
   - competitor, category, workflow, tool, niche, buyer type
3. **Opportunity**
   - attackable market wedge
4. **Validation**
   - deep analysis of one entered idea
5. **Monitor**
   - recurring tracked target
6. **Change Event**
   - structured "what changed since last check"
7. **Decision Pack**
   - final recommendation layer

The current repo already has rough seeds of these:

- `ideas` -> Opportunity
- `idea_validations` -> Validation
- `watchlists`, `pain_alerts`, `competitor_complaints` -> Monitor fragments
- `idea_history`, `market_pulse` -> Change history fragments
- report JSON -> proto Decision Pack

## 6. The 5 Source Classes You Actually Need

Do not optimize for more websites.
Optimize for the right **source classes**.

### 1. Pain Sources

Purpose:

- surface pain, complaints, unmet needs, workaround behavior

Best current sources:

- Reddit
- Hacker News
- Stack Overflow
- GitHub Issues

### 2. Commercial Proof Sources

Purpose:

- reveal whether money and switching intent exist

Needed sources:

- G2
- Capterra
- app marketplace reviews
- public pricing pages
- alternatives pages

### 3. Competitor Intelligence Sources

Purpose:

- expose incumbent weakness and entry gaps

Needed sources:

- competitor websites
- pricing pages
- feature pages
- changelogs
- docs
- public community complaints

### 4. Timing Sources

Purpose:

- power the "why now?" engine

Needed sources:

- Google Trends
- Product Hunt
- job boards
- repo/release velocity

### 5. Trust / Verification Sources

Purpose:

- separate direct evidence from inference
- reduce hallucination and thin-signal confidence inflation

Needed sources:

- official websites
- official docs
- public pricing pages
- repeated evidence across source classes

## 7. What To Add Next vs What To Avoid

### Add next

High-value next additions:

1. competitor pricing pages and product pages
2. public reviews (G2/Capterra/review-like sources)
3. Google Trends as timing input
4. job boards for "why now?" signals

### Avoid for now

Do not expand aggressively into:

- many unstable community sources
- many weak or duplicate scrapers
- more dashboards before the decision engine improves
- more model-provider complexity
- more report text without better evidence normalization

## 8. The Scoring System RedditPulse Should Grow Into

Every opportunity should eventually be scored across these dimensions:

1. **Pain Strength**
2. **Buyer Spend Signal**
3. **Competitor Weakness**
4. **Timing Momentum**
5. **Buyer Access**
6. **Buildability**
7. **Founder Fit**
8. **First Revenue Path**
9. **Confidence / Trust**

The current repo already supports part of this:

- pain strength: yes
- timing momentum: partly
- confidence/trust: now beginning
- competitor weakness: partly

The largest gaps are:

- buyer spend signal
- founder fit
- buyer access
- first revenue path as a first-class score

## 9. The 4 User Workflows The Product Should Converge On

The UI should gradually simplify into four workflows:

### 1. Discover

"Show me attackable B2B SaaS opportunities."

### 2. Validate

"I already have an idea. Pressure-test it deeply."

### 3. Compare

"Which of these ideas or wedges is the best use of my time?"

### 4. Monitor

"Track this niche, wedge, competitor, or opportunity over time."

Everything else should become either:

- a sub-view
- a supporting module
- or a detail panel

Not a primary product noun.

## 10. The Best Build Order

Do not build all ten discussed directions at once.

### First 3 to build

These are the highest-leverage differentiators:

1. **Competitor Weakness Radar**
2. **Why-Now Engine**
3. **Live Market Memory / Monitoring**

Why first:

- they increase trust
- they increase recurring value
- they increase monetization readiness
- they fit the current codebase well

### Then build next 3

4. **Micro-Niche Wedge Generator**
5. **Anti-Idea Engine**
6. **Opportunity-to-Revenue Engine**

### Then build advanced layers

7. **First-Customer Engine**
8. **Market Attack Simulator**
9. **Founder-Market Fit Matcher**
10. **Service-First SaaS Pathfinder**

## 11. The Repo-Grounded Transformation Roadmap

This roadmap is tied to the existing RedditPulse architecture.

### Phase A — Trust Foundation

Already started.

Use:

- `ideas`
- `idea_validations`
- `idea_history`
- report `data_quality`

Goals:

- shared trust model
- freshness
- weak-signal labeling
- direct evidence vs inference cues

### Phase B — Evidence Normalization Layer

Goal:

Move from page-specific logic to a common evidence schema.

Add or derive:

- `source_type`
- `signal_kind`
- `direct_vs_inferred`
- `entity/topic`
- evidence snippet / quote
- confidence
- timestamp

This is the most important backend foundation after trust.

### Phase C — Competitor Weakness Radar

Upgrade:

- `competitor_complaints`
- report competition sections
- review / pricing ingestion

Output:

- vulnerable competitor segments
- repeated complaint clusters
- attackable positioning gaps

### Phase D — Why-Now Engine

Upgrade:

- Google Trends
- recent market change signals
- timing language in opportunities and validations

Output:

- "why this is build-worthy now"
- "what changed recently"

### Phase E — Monitor and Memory System

Unify:

- `watchlists`
- `pain_alerts`
- `competitor_complaints`
- `morning_brief_cache`
- `market_pulse`

into a clearer `Monitor` system with:

- what changed
- what worsened
- what strengthened
- what to do next

### Phase F — Decision Pack

Turn report output into a stable structure:

- wedge
- buyer
- attack angle
- pricing test
- first channel
- first revenue route
- kill criteria

### Phase G — Compare and Founder Fit

Only after the above:

- compare opportunities
- rank by founder profile
- score attackability vs fit

## 12. What Should Be Demoted or Merged

To make room for the stronger product:

- `Scans`
  - demote to advanced/manual discovery
- `Trends`
  - fold into the Opportunity system, not a separate worldview
- `Sources`
  - make it a trust detail, not a primary destination
- `WTP`
  - fold into decision pack and buyer/commercial proof
- report-derived intelligence pages
  - temporary bridge only, not the long-term engine

## 13. What Powerful and Functional Should Mean

A powerful RedditPulse should answer these seven questions better than the market:

1. What exact pain is worth building for?
2. Which niche is most attackable?
3. Why is now the right time?
4. Where are incumbents weak?
5. Will buyers actually pay?
6. What is the fastest route to first revenue?
7. What should I do this week?

If RedditPulse can answer those reliably, it stops being "one more tool."

## 14. The Main Product Rule

Do not optimize for:

- the biggest market
- the loudest trend
- the highest post count
- the most AI text

Optimize for:

**the best attackable market wedge for this founder, right now**

That is the opening.
That is what can make RedditPulse genuinely stronger than generic validation or trend tools.
