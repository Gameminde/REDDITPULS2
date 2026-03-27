# RedditPulse Product Operating Model

This file describes the experimental operating model we want to test without changing the core app behavior.

## Principle

RedditPulse should not treat every market row as an idea.

It should separate:

1. `Theme`
   - a broad area of pain or market movement
   - example: `Retention`, `Project Management`, `No-Code Tools`

2. `Candidate Opportunity`
   - a shaped wedge with an ICP and workflow
   - example: `Expired-card and usage-drop alerts for tiny SaaS teams`

3. `Validation`
   - a decision-grade artifact for one specific opportunity statement

4. `Noise / Context`
   - launch chatter, category buzz, or weak supporting context

## Product Roles

- `Market / Stock Market`
  - discovery and monitoring
  - best for themes and context
  - should not overclaim as a decision engine

- `Validation`
  - decision engine
  - strongest product surface
  - allowed to output build / risky / insufficient verdicts

- `Saved / Watchlist`
  - portfolio memory
  - stores what the user is tracking or testing

## Trust Rule

- raw proof and deterministic enrichment can support direct claims
- heuristics and clustering can support context
- only validation can support strong product decisions

## Experimental Lab Goal

The opportunity lab exists to test whether current market rows should be reclassified into:

- `Candidate Opportunities`
- `Themes To Shape`
- `Market Context`
- `Ignore / Noise`

This is intentionally additive:

- no schema rewrite
- no replacement of existing market pages
- safe to remove later if the experiment is not useful
