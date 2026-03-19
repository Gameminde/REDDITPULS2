# Compare Ideas v1

## Goal

Help users compare multiple validated ideas in a structured, decision-ready way so RedditPulse can answer:

- "Is this good?"

and also:

- "Which of these is the best use of my time?"

## Scope

Validation-first:

- compare 2 to 4 completed validations
- reuse the existing Decision Pack contract
- keep the implementation backend-first and lightweight in the UI

This version does not introduce a broad analytics dashboard or a new data model.

## A. Implementation plan for v1

1. Create a shared validation enrichment helper so both single-validation and compare flows use the same:
   - parsed report
   - trust
   - evidence
   - decision pack
   - overlapping live competitor weakness context
2. Create a comparison builder that consumes enriched validations and outputs:
   - one normalized comparison object per idea
   - top-level recommendations
   - tradeoff notes
3. Add a compare API:
   - `GET /api/compare-ideas?ids=a,b,c`
4. Add a minimal comparison page:
   - `/dashboard/reports/compare`
5. Add a minimal selection flow from the Reports directory so users can compare selected validations

## B. Files / routes / types changed

New docs:

- `docs/compare_ideas_v1.md`

New shared helpers:

- `app/src/lib/validation-insights.ts`
- `app/src/lib/compare-ideas.ts`

Updated route:

- `app/src/app/api/validate/[jobId]/status/route.ts`

New API route:

- `app/src/app/api/compare-ideas/route.ts`

New UI route:

- `app/src/app/dashboard/reports/compare/page.tsx`

Updated UI:

- `app/src/app/dashboard/reports/page.tsx`

## C. Risks / assumptions

- v1 compares only validations, not opportunities yet
- comparison scoring is heuristic and intentionally simple
- some axes such as buyer clarity and next move still depend on report synthesis quality
- "best" recommendations should be presented as guidance, not as absolute truth
- failed or incomplete validations are not good comparison candidates and should be excluded

## Decision Pack reuse

Compare Ideas v1 does **not** invent a second analysis schema.

Each compared idea reuses the existing `decision_pack` and adds:

- normalized comparison scores
- comparison summary
- tradeoff note

## Comparison axes

Compare side-by-side across:

1. verdict
2. confidence
3. demand proof
4. buyer clarity
5. competitor gap
6. why now
7. next move
8. kill risk / kill criteria severity

## Top-level recommendation outputs

The comparison result should recommend:

- best overall
- best fastest-to-test
- best low-risk
- most promising but needs more proof

## Why this matters

Compare Ideas v1 is the first step from:

- "I have one report"

to:

- "I can prioritize where to spend time next"

That improves decision quality, actionability, and the subscription value of the product without requiring a large UI rewrite.
