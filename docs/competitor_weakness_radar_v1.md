# Competitor Weakness Radar v1

## Goal
Use the existing trust, evidence, and monitor foundation to surface where incumbents are failing users badly enough that a founder can wedge into the market.

V1 is intentionally incremental:
- no source sprawl
- no broad app redesign
- backend clarity first
- minimal UI surface
- practical monitor integration through existing `pain_alerts`

## Weakness Taxonomy
V1 classifies weakness evidence into these categories:

1. `Pricing`
2. `Complexity`
3. `Missing Features`
4. `Poor UX / Onboarding`
5. `Support / Trust`
6. `Performance / Reliability`
7. `Integration Gaps`
8. `Wrong Segment Fit`
9. `AI / Automation Gaps`
10. `Workflow Friction`

## Data Sources In V1
Primary source:
- `competitor_complaints`

Supportive context already available in-product:
- `idea_validations.report.competition_landscape`
- `watchlists`
- `pain_alerts`
- `monitor_events`

V1 does not introduce new scraping sources.

## Core Object
Each radar cluster represents:

- one `competitor`
- one `weakness_category`
- one grouped evidence cluster

### Cluster fields
- `competitor`
- `weakness_category`
- `summary`
- `affected_segment`
- `evidence_count`
- `source_count`
- `freshness`
- `trust`
- `representative_evidence[]`
- `wedge_opportunity_note`
- `direct_vs_inferred`
- `monitor`

## Direct Evidence vs Inference
Direct evidence:
- complaint posts
- complaint titles
- complaint signals
- platform and freshness metadata

Inference:
- affected segment guess
- wedge opportunity note
- cluster summary sentence

V1 must always keep those separate.

## API Contract
### `GET /api/competitor-radar`

Returns:
- `clusters`
- `competitors`
- `categories`
- `summary`

Filters:
- `competitor`
- `category`
- `limit`

### `POST /api/competitor-radar`

Creates a practical monitor using the existing `pain_alerts` table.

Input:
- `competitor`
- `category`

Behavior:
- creates a keyword-backed pain alert for that competitor + weakness family
- avoids duplicates when a matching active alert already exists

## Monitoring Strategy In V1
We are not introducing a new competitor-specific monitor table yet.

Instead, `Monitor this competitor` creates a targeted `pain_alert`:
- keyword 1 = competitor name
- keywords 2+ = weakness-family keywords

This keeps monitor integration mergeable and immediately compatible with:
- Monitor Core v1
- Digest / Brief
- alert matches

## Risks / Assumptions
- `competitor_complaints` is still shallow evidence compared with full review data
- some categories will be inferred from title + signal phrases only
- affected segment is best-effort and can be null
- V1 is a trusted first pass, not a full market-comparison engine

## Next Likely Upgrade After V1
- enrich with competitor pricing pages
- enrich with review-site complaints
- store persisted weakness snapshots over time
- promote competitor monitors from alert-backed to first-class monitor objects
