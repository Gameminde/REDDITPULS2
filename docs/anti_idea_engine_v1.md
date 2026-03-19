# Anti-Idea Engine v1

## Goal

Help RedditPulse say not only:

- "This looks promising"

but also:

- "Here are the strongest reasons not to pursue this yet."

This layer builds on top of:

- trust
- evidence
- competitor weakness
- why-now
- live memory
- Decision Pack
- Compare Ideas
- Founder-Market Fit
- Opportunity-to-Revenue
- First-Customer Engine
- Market Attack Simulator

It does not create a giant risk dashboard. It adds one reusable `anti_idea` contract.

## Scope

Validation-first:

- derive a structured anti-idea analysis from the existing strategy and evidence layers
- attach a market-aware version to the Decision Pack
- compute a founder-aware version inside Compare Ideas when a founder profile exists
- surface it lightly in report and compare flows

## A. Implementation plan for v1

1. Define a reusable anti-idea contract and category taxonomy
2. Translate weak dimensions into explicit disqualifying reasons
3. Attach `anti_idea` to the validation Decision Pack
4. Recompute founder-aware anti-idea analysis in Compare Ideas
5. Add compact anti-idea UI blocks in report and compare flows

## B. Files / routes / types changed

New docs:

- `docs/anti_idea_engine_v1.md`

New shared helper:

- `app/src/lib/anti-idea.ts`

Updated shared contracts:

- `app/src/lib/decision-pack.ts`
- `app/src/lib/compare-ideas.ts`

Updated UI:

- `app/src/app/dashboard/reports/[id]/page.tsx`
- `app/src/app/dashboard/reports/compare/page.tsx`

## C. Risks / assumptions

- v1 is heuristic and intentionally explainable, not a predictive failure model
- the report-page anti-idea view is market-aware but not founder-profile-aware
- compare-page anti-idea becomes founder-aware because it can use the active founder profile
- the goal is trust-building clarity, not generic pessimism

## Anti-Idea categories v1

1. Pain is weak or too noisy
2. Buyer willingness is unclear
3. Customer access is too hard
4. Competition is stronger than it looks
5. Timing is weak or hype-driven
6. Entry modes are unattractive
7. Build complexity is too high
8. Founder fit is poor
9. Proof is insufficient
10. Better wedge needed before acting

## Minimal contract

```ts
type AntiIdeaAnalysis = {
  verdict: {
    label: "LOW_CONCERN" | "WAIT" | "PIVOT" | "KILL_FOR_NOW";
    summary: string;
  };
  top_disqualifying_risks: string[];
  weak_points: AntiIdeaWeakPoint[];
  strongest_reason_to_wait_pivot_or_kill: string;
  missing_evidence_note: string;
  what_would_need_to_improve: string[];
  confidence_level: TrustLevel;
  confidence_score: number;
  direct_vs_inferred: {
    direct_evidence_count: number;
    inferred_markers: string[];
  };
};
```

## Why this matters

This is one of the strongest trust layers in RedditPulse.

A product becomes more believable when it can say:

- "not yet"
- "only if this improves"
- "good market, wrong wedge"
- "good wedge, wrong founder"

That makes the product feel more like a decision system than a cheerleading report.
