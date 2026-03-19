# Decision Pack v1

## Goal

Turn RedditPulse validations from rich but report-shaped analysis into a reusable decision system that tells the user what to do next.

Decision Pack v1 sits on top of the existing:

- trust layer
- evidence layer
- competitor weakness radar
- why-now engine
- live market memory foundations where practical

It does not replace the full report. It extracts the most decision-critical parts into a compact, structured contract.

## Scope

Validation-first:

- attach a reusable `decision_pack` object to validation responses
- render a compact Decision Pack section in the report experience
- keep the full report intact underneath

Opportunity reuse is a later step. The contract is intentionally generic enough to support it.

## Required sections

1. verdict
2. confidence
3. demand proof
4. buyer clarity
5. competitor gap
6. why now
7. next move
8. kill criteria

## Minimal API contract

`decision_pack` is returned as part of the existing validation payload from:

- `GET /api/validate/[jobId]/status`

Core shape:

```ts
type DecisionPack = {
  version: "v1";
  entity_type: "validation";
  entity_id: string;
  generated_at: string | null;
  verdict: { ... };
  confidence: { ... };
  demand_proof: { ... };
  buyer_clarity: { ... };
  competitor_gap: { ... };
  why_now: { ... };
  next_move: { ... };
  kill_criteria: { ... };
};
```

## Decision rules for v1

### Verdict

Use the existing validation verdict and executive summary. Do not invent a new model verdict.

### Confidence

Blend:

- evidence-backed trust
- validation confidence
- freshness
- source breadth

This section should explain confidence rather than only output a number.

### Demand proof

Use:

- normalized evidence items
- evidence summary
- signal summary
- direct quote count

This section must separate direct proof from inference.

### Buyer clarity

Use:

- `ideal_customer_profile`
- budget range
- buying triggers
- wedge language from the report

### Competitor gap

Prefer:

- live competitor weakness clusters when they overlap with report competitors

Fallback:

- `competition_landscape`

### Why now

Prefer:

- live weakness timing
- trend acceleration
- market timing text

Do not add new source types in v1.

### Next move

Use:

- verdict
- trust/confidence
- launch roadmap
- first 10 customers strategy

This section should output one recommended action and one immediate first step.

### Kill criteria

Prefer:

- roadmap validation gates
- high-severity risks

Fallback:

- trust and proof gaps

## Direct evidence vs inference

Every major section carries a `direct_vs_inferred` block or equivalent markers.

Principle:

- direct evidence = observed posts, complaint clusters, quotes, metrics
- inference = synthesis, wedge recommendation, next-action recommendation

## Files involved in v1

- `app/src/lib/decision-pack.ts`
- `app/src/app/api/validate/[jobId]/status/route.ts`
- `app/src/app/dashboard/reports/[id]/page.tsx`

## Risks / assumptions

- competitor gap quality depends on overlap between validation competitors and live complaint data
- kill criteria quality depends on roadmap gates being present
- v1 is still heuristic and synthesis-heavy in `next_move` and `why_now`
- monitor/memory integration is light in this slice; it is not yet a full decision-history system

## Why this matters

Decision Pack v1 is the first step from:

- "interesting AI report"

to:

- "actionable founder decision system"

It makes the premium validation output easier to trust, easier to act on, and easier to reuse later for opportunities and comparison workflows.
