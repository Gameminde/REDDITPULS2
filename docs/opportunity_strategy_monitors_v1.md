# Opportunity Strategy on Saved / Monitors v1

## Goal
Make monitored opportunities feel like recurring decision surfaces, not just saved score cards.

This v1 layer answers:
- what is the current productization posture?
- did posture get stronger or weaker since the last check?
- did readiness change?
- did the recommended next move change?
- did timing or anti-idea risk improve or worsen?

## Short Implementation Plan
1. Reuse the existing `opportunity-strategy` snapshot for monitored opportunities.
2. Store compact strategy fields inside monitor metadata and memory hints.
3. Extend the live-memory snapshot contract to persist strategy-relevant state:
   - productization posture
   - readiness score
   - next-move summary
   - anti-idea verdict
4. Let the existing snapshot delta engine generate meaningful strategy deltas.
5. Render the current strategy and “since last check” strategy changes on `/dashboard/saved`.

## Files / Routes / Types Changed

### Strategy reuse
- `app/src/lib/opportunity-strategy.ts`

### Monitor and memory plumbing
- `app/src/lib/monitors.ts`
- `app/src/lib/live-market-memory.ts`

### UI
- `app/src/app/dashboard/saved/page.tsx`

## Reused Foundations
This v1 deliberately avoids a separate monitor strategy subsystem.

It reuses:
- opportunity strategy snapshot
- live market memory snapshots
- monitor core
- why-now engine
- anti-idea engine
- service-first SaaS pathfinder
- existing monitor events

## Contract Additions

### Opportunity monitor strategy preview
Stored on the monitor payload as a compact preview:
- `posture`
- `posture_rationale`
- `strongest_reason`
- `strongest_caution`
- `readiness_score`
- `why_now_category`
- `why_now_momentum`
- `next_move_summary`
- `next_move_recommended_action`
- `anti_idea_verdict`
- `anti_idea_summary`

### Memory state additions
Stored in snapshot JSON:
- `productization_posture`
- `readiness_score`
- `next_move_summary`
- `anti_idea_verdict`

### Memory delta additions
Derived between snapshots:
- `previous_productization_posture`
- `current_productization_posture`
- `readiness_score_change`
- `next_move_change_note`
- `anti_idea_change_note`

## Meaningful Strategy Change Rules
V1 treats these as meaningful:
- posture changed
- readiness moved by 5+ points
- next move changed
- anti-idea verdict changed

These changes then influence:
- monitor delta summary
- strengthening / weakening direction
- “since last check” notes on Saved

## UI Behavior
On `/dashboard/saved`, opportunity monitors now show:
- current productization posture
- readiness score
- why-now category
- next-move summary

If a persisted delta exists, the monitor also shows:
- previous posture -> current posture
- readiness score delta
- next-move delta
- anti-idea change note
- existing confidence / timing / weakness notes

## Risks / Assumptions
- v1 is heuristic and explainable, not predictive.
- Strategy deltas depend on the opportunity strategy snapshot staying reasonably stable.
- Native standalone monitors only show strategy if their stored metadata already includes the strategy preview.
- This does not yet create weekly rollups or long-horizon strategy history views.

## What This Unlocks
- stronger recurring value for saved opportunities
- better “come back and see what changed” behavior
- a clearer bridge from discovery to subscription-worthy monitoring

## Deliberately Not Included Yet
- dedicated strategy-history pages
- analytics-heavy posture dashboards
- founder-aware opportunity monitor strategy
- email / push delivery of posture shifts

## Best Next Step
Extend this same strategy delta pattern into the Digest / Brief so the brief can say:
- which monitored opportunity got more productizable
- which one weakened
- which one now looks more service-first than SaaS-first
