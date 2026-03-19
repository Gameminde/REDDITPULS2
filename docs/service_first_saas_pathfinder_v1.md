# Service-first SaaS Pathfinder v1

## Goal

Help RedditPulse answer not only:

- "What is the best entry mode?"

but also:

- "Should this founder stay service-first, go hybrid, productize now, or wait?"

This layer builds on top of:

- Decision Pack
- Compare Ideas
- Founder-Market Fit
- Opportunity-to-Revenue
- First-Customer Engine
- Market Attack Simulator
- Anti-Idea Engine
- trust, evidence, competitor weakness, why-now, and live memory foundations

It does not create a separate methodology system. It adds one reusable, decision-ready `service_first_pathfinder` contract.

## Scope

Validation-first:

- compute a structured productization-posture recommendation from existing strategy layers
- attach it to the Decision Pack
- recompute it with founder-fit context inside Compare Ideas
- show it lightly in report and compare flows

## A. Implementation plan for v1

1. Define a reusable pathfinder contract and fixed posture taxonomy
2. Derive posture recommendations from revenue path, first-customer path, market attack, anti-idea, and founder fit signals
3. Attach `service_first_pathfinder` to the validation Decision Pack
4. Recompute founder-aware posture output inside Compare Ideas
5. Add compact report and compare UI blocks

## B. Files / routes / types changed

New docs:

- `docs/service_first_saas_pathfinder_v1.md`

New shared helper:

- `app/src/lib/service-first-saas-pathfinder.ts`

Updated shared contracts:

- `app/src/lib/decision-pack.ts`
- `app/src/lib/compare-ideas.ts`

Updated UI:

- `app/src/app/dashboard/reports/[id]/page.tsx`
- `app/src/app/dashboard/reports/compare/page.tsx`

## C. Risks / assumptions

- v1 is heuristic and explicit, not a productization forecasting model
- the report-page posture is market-aware but not founder-profile-aware
- the compare-page posture is founder-aware because it uses the active founder profile
- posture quality still depends on the underlying report quality, especially buyer clarity, first-customer path, and proof strength

## Posture taxonomy v1

1. Stay service-first
2. Start hybrid service + software
3. Productize now
4. Concierge MVP first
5. Wait and validate more first

## Core dimensions

- buyer trust barrier
- implementation complexity
- first-customer friction
- revenue speed
- repeatability
- founder fit
- market clarity
- wedge sharpness

## Minimal contract

```ts
type ServiceFirstSaasPathfinder = {
  recommended_productization_posture: ProductizationPosture;
  posture_rationale: string;
  strongest_reason_for_posture: string;
  strongest_caution: string;
  what_must_become_true_before_productization: string[];
  confidence_level: TrustLevel;
  confidence_score: number;
  productization_readiness_score: number;
  dimensions: ServiceFirstPathfinderDimension[];
  direct_vs_inferred: {
    direct_evidence_count: number;
    inferred_markers: string[];
  };
};
```

## Why this matters

This is the missing bridge between:

- "the opportunity is promising"

and:

- "here is the right productization posture for this founder right now"

That makes RedditPulse more differentiated, more actionable, and much more useful for solo founders trying to decide whether to sell services first, go hybrid, build product now, or deliberately wait.
