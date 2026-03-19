# Market Attack Simulator v1

## Goal

Help RedditPulse answer not only:

- "Is this a good opportunity?"

but also:

- "What is the best way to enter this market for this founder right now?"

This layer builds on top of:

- Decision Pack
- Compare Ideas
- Founder-Market Fit
- Opportunity-to-Revenue
- First-Customer Engine
- competitor weakness, why-now, trust, evidence, and live memory foundations

It does not create a forecasting engine. It compares a fixed set of entry strategies with explicit reasoning.

## Scope

Validation-first:

- compute a structured attack-mode simulation from existing decision, revenue, and first-customer outputs
- attach a generic simulator to the Decision Pack
- compute founder-aware attack-mode simulations inside Compare Ideas
- surface the results lightly in report and compare flows

## A. Implementation plan for v1

1. Define a reusable attack-mode contract and fixed entry-mode list
2. Derive per-mode scores from existing revenue, first-customer, why-now, trust, and competitor-gap signals
3. Apply founder-fit adjustments when available
4. Attach a generic `market_attack` simulator to the Decision Pack
5. Recompute founder-aware `market_attack` results in Compare Ideas
6. Add minimal report and compare UI blocks

## B. Files / routes / types changed

New docs:

- `docs/market_attack_simulator_v1.md`

New shared helper:

- `app/src/lib/market-attack-simulator.ts`

Updated shared contracts:

- `app/src/lib/decision-pack.ts`
- `app/src/lib/compare-ideas.ts`

Updated UI:

- `app/src/app/dashboard/reports/[id]/page.tsx`
- `app/src/app/dashboard/reports/compare/page.tsx`

## C. Risks / assumptions

- v1 is heuristic and comparative, not predictive
- attack-mode quality depends on current report quality, especially buyer clarity, first-customer strategy, and pricing signals
- the report-page simulator is market-aware but not founder-profile-aware
- the compare-page simulator is founder-aware because it uses the active founder profile

## Fixed attack modes

1. Service-first wedge
2. SaaS-first wedge
3. Concierge MVP
4. Hybrid service + software
5. Plugin / add-on wedge
6. Interview-only / proof-first

## Per-mode outputs

- fit score
- speed-to-proof
- speed-to-revenue
- trust barrier
- complexity
- customer reachability
- execution risk
- rationale
- recommended first move
- direct vs inferred markers

## Top-level simulator outputs

- best overall attack mode
- best lowest-risk mode
- best fastest-revenue mode
- most scalable mode
- explicit tradeoff notes

## Why this matters

This is the first clear strategy layer that helps founders choose not just whether to enter a market, but how to enter it right now.

That makes RedditPulse more differentiated, more operational, and more useful as a founder decision system.
