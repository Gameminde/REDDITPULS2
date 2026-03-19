# RedditPulse Evidence Contract v1

Generated: 2026-03-17

## Goal

Normalize user-visible evidence across:

- Opportunities
- Validations
- Alerts
- Competitor complaints

This contract exists to make RedditPulse more auditable, more trusted, and easier to extend into monitors, briefs, competitor radar, and decision packs.

## Why This Exists

The repo already stores evidence in multiple shapes:

- `ideas.top_posts`
- validation report evidence
- `alert_matches`
- `competitor_complaints`
- trend snippets

Without one common evidence shape, every page invents its own logic for:

- source attribution
- direct vs inferred signals
- freshness
- evidence counts
- snippets and proof

This contract is the minimum shared layer before introducing a full `evidence_items` table.

## Core Types

### Evidence Item

Each evidence item should be normalized to:

```ts
type SourceClass = "pain" | "commercial" | "competitor" | "timing" | "verification";
type SignalKind =
  | "pain_point"
  | "buyer_intent"
  | "pricing_signal"
  | "competitor_weakness"
  | "trend_signal"
  | "market_summary"
  | "execution_note";
type EvidenceDirectness = "direct_evidence" | "derived_metric" | "ai_inference";
type EvidenceConfidence = "HIGH" | "MEDIUM" | "LOW";

interface EvidenceItem {
  id: string;
  entity_type: "opportunity" | "validation" | "alert" | "competitor";
  entity_key: string;
  source_class: SourceClass;
  source_name: string;
  platform: string;
  url: string | null;
  observed_at: string | null;
  signal_kind: SignalKind;
  title: string;
  snippet: string | null;
  author_handle: string | null;
  score: number | null;
  directness: EvidenceDirectness;
  confidence: EvidenceConfidence;
  metadata: Record<string, unknown>;
}
```

### Evidence Summary

Each API surface should also return a compact summary:

```ts
interface EvidenceSummary {
  evidence_count: number;
  direct_evidence_count: number;
  inferred_count: number;
  source_count: number;
  source_breakdown: Array<{ platform: string; count: number }>;
  latest_observed_at: string | null;
  freshness_hours: number | null;
  freshness_label: string;
  direct_vs_inferred: {
    direct: number;
    derived: number;
    inferred: number;
  };
}
```

## Product Rules

### 1. Separate evidence from inference

The UI must be able to tell the difference between:

- directly observed posts, complaints, quotes, and proof
- derived metrics
- AI-written synthesis

### 2. Preserve source attribution

Every evidence item should retain:

- platform
- URL where available
- observed timestamp where available

### 3. Keep direct evidence visible

If a conclusion is based on direct market evidence, users should be able to see representative items.

### 4. Let thin signal look thin

Low-volume and single-source evidence should never look equal to broad, recent, multi-source proof.

## Mapping From Current Repo Shapes

### Opportunities (`ideas`)

Current source:

- `ideas.top_posts`
- `ideas.pain_summary`
- `ideas.keywords`

Mapping:

- `top_posts` -> direct evidence items
- `pain_summary` -> AI inference item
- `keywords` -> optional derived support later

### Validations (`idea_validations.report`)

Current source:

- `market_analysis.evidence`
- `debate_evidence`
- `executive_summary`
- `pricing_strategy`
- `competition_landscape`

Mapping:

- evidence arrays -> direct evidence items
- executive summary -> AI inference
- pricing summary -> AI inference
- competitor landscape summary -> AI inference

### Alerts (`pain_alerts` + `alert_matches`)

Current source:

- `alert_matches`

Mapping:

- each match -> direct evidence item

### Competitor complaints (`competitor_complaints`)

Current source:

- complaint post title
- complaint signals
- competitor mentions

Mapping:

- each complaint row -> direct evidence item

## API Contract Guidance

When practical, API responses should expose:

```json
{
  "trust": {},
  "evidence": [],
  "evidence_summary": {},
  "source_breakdown": [],
  "direct_vs_inferred": {}
}
```

This is preferred over leaking many raw source-specific fields directly into components.

## Current Phase Scope

Evidence Contract v1 is intentionally lightweight:

- helper-layer only
- no full DB rewrite
- no `evidence_items` table yet

It exists to normalize current repo data before introducing:

- `monitors`
- `monitor_events`
- competitor radar
- why-now engine
- decision packs

## Next Step After This

Once the helper-layer contract is stable:

1. add a real `evidence_items` table
2. emit evidence rows during scrape and validation pipelines
3. attach evidence IDs to monitor events and briefs
4. use evidence as the main proof layer across the product
