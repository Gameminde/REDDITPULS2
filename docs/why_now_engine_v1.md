# Why-Now Engine v1

## Goal
Explain why an opportunity, pain cluster, or competitor weakness appears to be surfacing now, using the current trust, evidence, and monitor foundation.

V1 is intentionally incremental:
- no new source sprawl
- no broad product refactor
- backend clarity first
- minimal UI surface
- direct evidence clearly separated from inferred timing notes

## Taxonomy
V1 classifies timing signals into:

1. `AI capability shift`
2. `Tool complexity increase`
3. `Cost pressure / budget pressure`
4. `Workflow fragmentation`
5. `Regulatory / compliance pressure`
6. `Remote / distributed work friction`
7. `Integration sprawl`
8. `Competitor stagnation`
9. `New user expectation shift`
10. `Macro category acceleration`
11. `Unknown / weak signal`

## Source Inputs In V1
Primary inputs:
- `ideas`
- `competitor_complaints`
- weakness radar clusters
- `watchlists`
- `pain_alerts`
- monitor state already derived in the app

V1 does not add new scraping sources.

## Core Output
Each Why-Now signal should expose:
- `timing_category`
- `summary`
- `direct_timing_evidence[]`
- `inferred_why_now_note`
- `freshness`
- `confidence`
- `momentum_direction`
- `monitorable_change_note`
- `direct_vs_inferred`

## Direct Evidence vs Inference
Direct evidence includes:
- recent post counts
- score / momentum deltas
- freshness timestamps
- representative evidence titles
- repeated competitor complaints

Inference includes:
- the timing category label itself
- the why-now explanation note
- monitorable next-step suggestions

## API Contract
### `GET /api/why-now`

Returns:
- `signals`
- `categories`
- `summary`

Filters:
- `scope` (`opportunity`, `competitor`, or omitted for mixed)
- `limit`

## Minimal UI Integration
V1 should appear in:
- `Trends` as a compact timing-intelligence section
- `Competitors` as a why-now cue on weakness radar cards

## Monitor Integration
V1 should be monitor-aware where practical:
- watched opportunities should say that movement can be tracked through monitors
- monitored competitor weaknesses should say they are already being watched
- unwatched signals should suggest the smallest relevant monitor action

## Risks / Assumptions
- timing categories are heuristic in v1 because we are intentionally avoiding new source classes
- some categories, especially `Regulatory / compliance pressure`, will be keyword-driven
- `Macro category acceleration` is derived from momentum and freshness, not an external macro dataset

## Next Upgrade After V1
- add Google Trends / job-signal support
- add persisted timing snapshots
- compare current why-now output against previous runs for stronger delta logic
