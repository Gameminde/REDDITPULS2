# Opportunity-to-Revenue Engine v1

## Goal

Help RedditPulse answer not only:

- "Is this a strong opportunity?"

but also:

- "What is the fastest realistic path to first revenue if I pursue it?"

This layer builds on top of:

- Decision Pack
- Compare Ideas
- Founder-Market Fit
- trust, evidence, competitor weakness, why-now, and live memory foundations

It does not create a separate planning subsystem. It adds one reusable, decision-ready `revenue_path` contract.

## Scope

Validation-first:

- compute a structured revenue path from the existing validation report plus Decision Pack sections
- attach it to the Decision Pack
- show it in report detail and compare flows

Opportunity reuse comes later.

## A. Implementation plan for v1

1. Define a reusable revenue-path contract and entry-mode taxonomy
2. Derive revenue-path recommendations from existing report fields and Decision Pack sections
3. Attach `revenue_path` to the validation Decision Pack
4. Reuse that contract inside Compare Ideas scoring and recommendations
5. Add a compact UI block to the report and compare flows

## B. Files / routes / types changed

New docs:

- `docs/opportunity_to_revenue_engine_v1.md`

New shared helper:

- `app/src/lib/opportunity-to-revenue.ts`

Updated shared contracts:

- `app/src/lib/decision-pack.ts`
- `app/src/lib/compare-ideas.ts`

Updated UI:

- `app/src/app/dashboard/reports/[id]/page.tsx`
- `app/src/app/dashboard/reports/compare/page.tsx`

## C. Risks / assumptions

- v1 is heuristic and intentionally explicit; it is not a forecast model
- willingness-to-pay and pricing suggestions depend on current report quality
- some entry-mode decisions are inferred from workflow complexity and go-to-market clues, not directly observed proof
- compare recommendations should be treated as decision support, not hard truth

## Entry mode taxonomy v1

1. SaaS-first
2. Service-first
3. Concierge MVP
4. Hybrid service + software
5. Internal-tool-to-product
6. Template / workflow product
7. Plugin / add-on wedge
8. Test-only / interviews first

## Revenue-path dimensions

- buyer urgency
- willingness-to-pay evidence
- implementation complexity
- customer reachability
- trust barrier
- speed to first proof
- support burden

## Minimal contract

```ts
type OpportunityRevenuePath = {
  recommended_entry_mode: RevenueEntryMode;
  summary: string;
  first_offer_suggestion: string;
  pricing_test_suggestion: string;
  first_customer_path: string;
  speed_to_revenue_band: RevenueSpeedBand;
  confidence_level: TrustLevel;
  confidence_score: number;
  main_execution_risk: string;
  rationale: string;
  dimensions: RevenuePathDimension[];
  direct_vs_inferred: {
    direct_evidence_count: number;
    inferred_markers: string[];
  };
};
```

## Why this matters

This is the first step from:

- "good idea, interesting report"

to:

- "clear first revenue path with a realistic entry mode"

That makes RedditPulse more actionable, more monetization-ready, and easier to justify as an ongoing founder decision product.
