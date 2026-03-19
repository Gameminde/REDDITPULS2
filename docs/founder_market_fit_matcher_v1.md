# Founder-Market Fit Matcher v1

## Goal

Help RedditPulse answer not only:

- "Which idea is strongest?"

but also:

- "Which idea is strongest for this founder?"

## Scope

This version is intentionally lightweight:

- no heavy onboarding flow
- no database-backed founder profile
- no broad product redesign

It adds a small founder profile to the Compare Ideas flow and reuses the existing Decision Pack plus comparison outputs.

## A. Implementation plan for v1

1. Define a lightweight founder profile contract
2. Define fit dimensions and explicit heuristic scoring rules
3. Add founder-fit computation on top of enriched validations and Decision Packs
4. Extend Compare Ideas output with:
   - fit score
   - fit summary
   - strongest alignment
   - biggest mismatch
   - founder-specific next move note
5. Extend the compare API to accept founder profile inputs
6. Add a compact founder profile control panel to the Compare Ideas page

## B. Files / routes / types changed

New docs:

- `docs/founder_market_fit_matcher_v1.md`

New shared helper:

- `app/src/lib/founder-market-fit.ts`

Updated comparison engine:

- `app/src/lib/compare-ideas.ts`

Updated compare API:

- `app/src/app/api/compare-ideas/route.ts`

Updated compare UI:

- `app/src/app/dashboard/reports/compare/page.tsx`

## C. Risks / assumptions

- fit reasoning is heuristic and partly inferred from current Decision Pack output
- no persisted founder profile yet; v1 is intentionally adjustable and lightweight
- some dimensions, especially domain fit and budget fit, depend on imperfect inference from current reports
- fit should be treated as decision support, not as an absolute personalized truth

## Founder profile fields

- technical level
- domain familiarity
- sales / GTM strength
- preferred GTM motion
- available time
- budget tolerance
- solo vs team
- appetite for complexity

## Fit dimensions

1. Technical Fit
2. Domain Fit
3. GTM Fit
4. Speed-to-Execution Fit
5. Complexity Tolerance Fit
6. Budget / Runway Fit

## Output per compared idea

- fit score
- fit summary
- strongest alignment
- biggest mismatch
- founder-specific next move note
- explicit direct-vs-inferred markers

## Why this matters

This is one of the strongest differentiation layers in RedditPulse.

It pushes the product beyond:

- "good market"

to:

- "good market for you, right now"

That makes the product more actionable, more personal, and harder to replace with a generic report stack.
