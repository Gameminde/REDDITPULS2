# Validate Core Audit - 2026-04-08

## Scope

This audit focuses on the `Validate` surface as the core product workflow, with a quick triage of the next dashboard pages that deserve review.

Current live app after deployment:

- VPS web commit: `0d710f2`
- Market generic `needs_wedge` rows like `Recruitment Hiring` are no longer visible on the public radar

## Main judgment

`Validate` is the product's core promise, but the current page still feels like:

- a technical operator console
- a premium upsell gate
- a long-running job monitor

more than it feels like:

- the single best place to make a build / pass decision

The page is powerful, but it is not yet giving itself the right product status.

## Findings

### 1. Critical: validate is treated as premium-only even though the depth model says otherwise

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L740)
- [route.ts](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/api/validate/route.ts#L48)
- [validation-depth.ts](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/lib/validation-depth.ts#L12)

What is happening:

- the page returns a generic `PremiumGate` for any non-premium user
- the API also blocks all validation requests for non-premium users
- but `validation-depth.ts` marks all three modes as `premiumRequired: false`

Why this matters:

- product truth is split
- UI truth, API truth, and mode metadata disagree
- this makes `Validate` feel bolted onto pricing instead of being the app's main value path

Recommendation:

- decide one clear rule:
  - either `Quick Validation` is available to all signed-in beta users
  - or all validation is premium and the depth metadata must say that explicitly
- do not keep contradictory rules

### 2. High: the page leads with process mechanics instead of the user outcome

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L745)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L820)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L1086)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L1122)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L1166)

What is happening:

- the hero is correct but generic: "Check the idea before you build it."
- the page quickly becomes a dense control room:
  - active models
  - recent validations
  - pipeline
  - live terminal

Why this matters:

- this is the main decision page
- the user should first feel:
  - "I can get a trustworthy answer here"
- instead, the page says:
  - "here is the machine running"

Recommendation:

- make the outcome promise primary
- move ops chrome behind expansion or secondary tabs
- the top of the page should be:
  - idea
  - buyer
  - pain
  - validation depth
  - one clear CTA
- the job internals should come after the run starts

### 3. High: there is visible encoding damage in the core copy

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L30)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L46)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L695)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L703)
- [validation-depth.ts](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/lib/validation-depth.ts#L19)
- [ValidationProgressPane.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/ValidationProgressPane.tsx#L93)
- [ValidationProgressPane.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/ValidationProgressPane.tsx#L104)
- [ValidationProgressPane.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/ValidationProgressPane.tsx#L226)

What is happening:

- the file contains mojibake like `â€¦`, `Â·`, and broken symbols in status copy

Why this matters:

- this is the product's trust engine
- broken copy instantly makes the page feel less reliable and less premium

Recommendation:

- clean all mojibake first
- keep copy strictly ASCII-safe where possible
- only reintroduce typographic punctuation when the encoding path is confirmed clean

### 4. High: the page is still too monolithic to evolve safely

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx)

What is happening:

- `validate/page.tsx` is about `1660` lines
- it combines:
  - form shell
  - routing/prefill logic
  - validation submission
  - polling
  - progress parsing
  - terminal rendering
  - mobile CTA
  - history
  - model state
  - pipeline visuals

Why this matters:

- UX changes become risky
- logic drift is easy
- the page is hard to reason about as a product surface

Recommendation:

- split into:
  - `ValidateShell`
  - `ValidationComposer`
  - `ValidationRunState`
  - `ValidationHistoryPanel`
  - `ValidationOpsPanel`

### 5. Medium: there is dead duplicate layout still shipped in the page

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L1229)

What is happening:

- there is a large hidden grid block that is not rendered
- it still contains a duplicate validation layout and duplicate sections

Why this matters:

- maintenance drag
- easy source of future regressions
- adds noise while auditing or editing the page

Recommendation:

- delete the dead hidden layout
- keep one canonical validate layout only

### 6. Medium: the mobile fixed CTA competes with the dashboard dock

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L1199)
- [Dock.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/components/Dock.tsx)

What is happening:

- mobile validate uses a fixed bottom action bar
- the dashboard already has a persistent dock
- the CTA tries to dodge the dock with `bottom: calc(env(safe-area-inset-bottom, 0px) + 86px)`

Why this matters:

- this is fragile
- easy to feel layered, cramped, or visually stacked
- especially risky on smaller mobile heights

Recommendation:

- decide whether validate owns the bottom action area or the dashboard dock does
- do not make both compete for the same space

### 7. Medium: the CTA hierarchy is still too generic for the most important workflow

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L738)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L1274)

What is happening:

- the main CTA is still `Launch Validation`

Why this matters:

- this sounds like starting a machine
- not making a decision

Recommendation:

- rename based on the chosen depth
- examples:
  - `Run Quick Validation`
  - `Run Deep Validation`
  - `Start Market Investigation`

### 8. Medium: progress UI is strong, but too operational for the first screen

Files:

- [ValidationProgressPane.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/ValidationProgressPane.tsx#L138)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/validate/page.tsx#L1529)

What is happening:

- the app does a good job showing source progress and terminal events
- but once the run starts, the page becomes more about the pipeline than about the answer

Why this matters:

- this should feel like:
  - "show me whether I should build this"
- not:
  - "watch the machinery work"

Recommendation:

- keep progress, but frame it as trust support
- the primary post-submit state should highlight:
  - current stage
  - expected answer
  - when report will be ready
- the terminal should be secondary

## Product conclusion

Right now `Validate` is powerful but under-positioned.

It should become:

- the clearest page in the app
- the highest-trust page in the app
- the page that feels most decisive

Instead, today it still feels like a hybrid between:

- a premium feature gate
- a research console
- a background job monitor

That is the main gap.

## Recommended next build order

1. Resolve the premium truth
2. Fix encoding / mojibake
3. Remove dead duplicate layout
4. Reframe the page around decision outcome, not pipeline chrome
5. Split the page into smaller components
6. Revisit mobile bottom CTA vs dock ownership

## Next audit queue after Validate

These are now the highest-value pages to audit next:

1. `reports/[id]/page.tsx` - about `1915` lines
2. `StockMarket.tsx` - still the largest user-facing surface at about `3079` lines
3. `saved/page.tsx`
4. `digest/page.tsx`
5. `scans/page.tsx`

`reports/[id]` should be next after `Validate`, because that is where the answer quality is actually paid off.
