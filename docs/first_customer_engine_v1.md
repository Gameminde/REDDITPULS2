# First-Customer Engine v1

## Goal

Help RedditPulse answer not only:

- "What is the fastest path to first revenue?"

but also:

- "Where do I realistically find the first customers and what is the best first-contact path?"

This layer builds on top of:

- Decision Pack
- Compare Ideas
- Founder-Market Fit
- Opportunity-to-Revenue
- trust, evidence, competitor weakness, why-now, and live memory foundations

It does not create a lead database or automation system. It adds one reusable `first_customer` contract.

## Scope

Validation-first:

- derive a structured first-customer plan from existing report, decision, and revenue-path outputs
- attach it to the Decision Pack
- surface it in report and compare flows

Opportunity reuse comes later.

## A. Implementation plan for v1

1. Define a reusable first-customer contract and channel taxonomy
2. Derive likely first-customer archetype, channel, outreach angle, and proof path from existing report fields
3. Attach `first_customer` to the Decision Pack
4. Reuse that contract in Compare Ideas scoring and recommendations
5. Add compact UI blocks in report and compare flows

## B. Files / routes / types changed

New docs:

- `docs/first_customer_engine_v1.md`

New shared helper:

- `app/src/lib/first-customer.ts`

Updated shared contracts:

- `app/src/lib/decision-pack.ts`
- `app/src/lib/compare-ideas.ts`

Updated UI:

- `app/src/app/dashboard/reports/[id]/page.tsx`
- `app/src/app/dashboard/reports/compare/page.tsx`

## C. Risks / assumptions

- v1 is heuristic and intentionally explainable, not a prospecting engine
- channel and outreach suggestions depend on report quality, especially `first_10_customers_strategy`
- founder-specific suitability is expressed in compare scoring, not in the core first-customer contract itself
- some channel recommendations are inferred from communities, tactic text, and revenue-path shape rather than direct observed conversion data

## First-customer channel taxonomy v1

1. Founder communities
2. Niche professional communities
3. LinkedIn outbound
4. Warm network / referrals
5. Service-led outreach
6. Integration ecosystem / marketplace
7. Content-led inbound
8. Interview-first / discovery-first

## First-customer dimensions

- buyer reachability
- niche concentration
- trust barrier
- urgency
- clarity of pain
- outreach friendliness
- proof requirement
- channel accessibility

## Minimal contract

```ts
type FirstCustomerPlan = {
  likely_first_customer_archetype: string;
  primary_channel: FirstCustomerChannel;
  first_customer_channels: FirstCustomerChannelRecommendation[];
  first_outreach_angle: string;
  first_proof_path: string;
  best_initial_validation_motion: string;
  confidence_level: TrustLevel;
  confidence_score: number;
  main_acquisition_friction: string;
  rationale: string;
  dimensions: FirstCustomerDimension[];
  direct_vs_inferred: {
    direct_evidence_count: number;
    inferred_markers: string[];
  };
};
```

## Why this matters

This is the step from:

- "interesting go-to-market advice"

to:

- "clear first-contact path for getting the first paying or pilot customers"

That makes RedditPulse more useful for founder action and more defensible as a decision system, not just an analysis tool.
