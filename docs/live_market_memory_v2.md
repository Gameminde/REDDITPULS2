# Live Market Memory v2

## Goal
Make RedditPulse remember meaningful market change over time so users can see what changed since the last check, not just what is true right now.

V2 builds on:
- trust
- evidence
- monitor core
- competitor weakness radar
- why-now engine

## Product Intent
Every important monitor should answer:

- what changed since the last check
- whether the signal is strengthening or weakening
- whether the confidence is changing
- whether timing is improving or fading
- whether competitor weakness is intensifying

That memory should feed:
- monitor cards
- monitor events
- digest / brief

## Reusable Memory Contract

### Monitor memory state
A persisted snapshot of the important parts of a monitor at a point in time.

V2 state fields:
- `summary`
- `trust_score`
- `evidence_count`
- `primary_metric_label`
- `primary_metric_value`
- `secondary_metric_label`
- `secondary_metric_value`
- `timing_category`
- `timing_momentum`
- `weakness_signal_count`
- `status`
- `captured_at`

### Monitor memory delta
The comparison between the previous state and the current state.

V2 delta fields:
- `previous_state_summary`
- `current_state_summary`
- `delta_summary`
- `direction`
- `new_evidence_note`
- `confidence_change`
- `timing_change_note`
- `weakness_change_note`
- `direct_vs_inferred`

## Persistence Model

### `monitor_snapshots`
New table for persisted monitor state snapshots.

Each row stores:
- monitor id
- user id
- captured time
- snapshot hash
- state summary JSON
- delta summary JSON
- direction

V2 uses snapshots to avoid rebuilding “what changed” from scratch every time.

## Event Strategy
Current monitor events capture immediate signals such as:
- score change
- confidence change
- pain match
- competitor weakness

V2 adds persisted memory-driven events:
- `memory_change`

These represent meaningful deltas between snapshots, not just raw current values.

## What Counts As Meaningful Change In V2
- trust score change of 5+ points
- primary metric movement
- evidence count increase
- timing category change
- timing momentum change
- weakness signal count change
- status moving from quiet to active or active to quiet

## Digest / Brief Behavior
The Brief should use persisted deltas to explain:
- what changed since last check
- which monitor strengthened most
- where new evidence arrived
- which monitored area weakened

## Minimal UI Surfaces In V2
- monitor cards on `/dashboard/saved`
- digest timeline and recommendations

## Risks / Assumptions
- snapshot quality depends on the monitor state contract staying stable
- not every monitor type supports every delta field
- V2 prefers “good enough meaningful change” over a perfect historical analytics model

## Next Upgrade After V2
- persisted weekly summary rollups
- timing-history comparisons
- competitor weakness progression over time
- true “since last week” and “since last month” views
