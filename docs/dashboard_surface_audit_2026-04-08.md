# Dashboard Surface Audit - 2026-04-08

## Scope

This pass extends the audit beyond `Validate` into the surrounding dashboard surfaces that shape the full product journey:

- `Explore`
- `Opportunities`
- `Reports directory`
- `Reports detail`
- `Saved / Monitors`
- `Digest`

The goal is not to nitpick styling. The goal is to check whether the product hierarchy is coherent:

1. radar surfaces discovery
2. validate surfaces decision
3. report surfaces payoff
4. monitor surfaces retention

## Main judgment

The app already has the right pieces, but the hierarchy is still upside down.

Right now:

- `Radar` is strong and getting clearer
- `Validate` is under-positioned
- `Reports` are information-rich but still too archive-like
- `Monitors` and `Digest` feel like premium sidecars, not natural follow-through from validation

The product should feel like:

- discover
- validate
- decide
- track

But some surfaces still feel like:

- browse
- browse more
- enter a heavy machine
- later maybe find a report

## Findings

### 1. High: Reports directory is framed like an archive, not the decision memory of the product

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/reports/page.tsx#L97)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/reports/page.tsx#L101)

What is happening:

- the title is just `Directory`
- the subtitle is `Archive of synthesized intelligence reports.`

Why this matters:

- this is where the app should prove it produces usable decisions
- `Directory` sounds like storage, not insight
- the page undersells the value of completed validations

Recommendation:

- rename the page around decisions, not filing
- examples:
  - `Validation Reports`
  - `Decision Reports`
  - `Validation Library`

### 2. High: Reports detail is likely the payoff page, but it is still visually and structurally too operator-heavy

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/reports/[id]/page.tsx#L1)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/reports/[id]/page.tsx#L515)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/reports/[id]/page.tsx#L1847)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/reports/[id]/page.tsx#L1908)

What is happening:

- the page is large and powerful
- it includes a lot of intelligence sections, but also debate, raw evidence mechanics, export-like content, and rerun affordances
- `Run deep validation` stays prominent even on the page that should represent the answer

Why this matters:

- this page should feel like the decisive moment of the app
- instead, it risks feeling like:
  - a powerful analyst workbench
  - a research dump
  - a rerun hub

Recommendation:

- make the first screen of the report clearly answer:
  - should I build this
  - for whom
  - why now
  - what could invalidate it
- move deeper debate and raw machinery lower
- keep rerun explicit but secondary

### 3. Medium: Explore is useful, but it still behaves like a second radar instead of a distinct discovery mode

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/explore/page.tsx#L1)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/explore/page.tsx#L128)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/explore/page.tsx#L423)

What is happening:

- Explore has useful sorting and browsing
- but conceptually it is still close to `Radar`
- the difference between:
  - `Radar`
  - `Explore`
  - `Opportunities`
  is not yet sharp enough

Why this matters:

- users can feel the app has multiple lists of ideas without a clear mental model
- that weakens product confidence

Recommendation:

- define Explore as the broader search/discovery shelf
- define Radar as the curated live shortlist
- define Opportunities as promoted saved bets
- then align titles and microcopy to that model

### 4. Medium: Opportunities has the right direction, but still reads more like a staging table than a premium action surface

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/opportunities/page.tsx#L164)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/opportunities/page.tsx#L167)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/opportunities/page.tsx#L243)

What is happening:

- the page correctly frames promoted opportunities as more structured
- but the tone still feels transitional
- it explains what the table is, more than why the user should care right now

Why this matters:

- if this page represents your serious shortlist, it should feel sharper
- it should feel closer to:
  - prioritized bets
  - decision-ready opportunities
not:
  - promoted rows

Recommendation:

- strengthen the “decision shortlist” framing
- reduce process language like `promoted opportunities become structured decision cards`
- emphasize:
  - best bets worth validating next
  - saved opportunities worth tracking

### 5. Medium: Saved / Monitors is strategically strong, but currently feels like a premium subsystem instead of the natural next step after validation

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/saved/page.tsx#L216)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/saved/page.tsx#L227)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/saved/page.tsx#L499)

What is happening:

- the page is conceptually good
- but the copy is still systems-oriented:
  - recurring workflow
  - recurring market memory system

Why this matters:

- the user motivation is simpler:
  - tell me when this opportunity changes
  - tell me if this validation gets stronger or weaker

Recommendation:

- rewrite around watchfulness and change detection
- make the main promise:
  - `Track what changed so you do not have to keep checking manually.`

### 6. Medium: Digest is valuable, but too detached from the main validation loop

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/digest/page.tsx#L161)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/digest/page.tsx#L182)

What is happening:

- Digest summarizes monitor changes
- but it depends on monitors existing first
- its empty state says `Run a validation first to create your first monitor`

Why this matters:

- that is correct technically
- but it reveals product chaining that is still too hidden elsewhere

Recommendation:

- make the chain explicit throughout the app:
  - validate -> save/watch -> digest/alerts
- digest should feel like the morning briefing generated by earlier good decisions

### 7. Medium: premium gating is consistent in many secondary pages, but Validate is where the inconsistency hurts most

Files:

- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/reports/page.tsx#L65)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/reports/[id]/page.tsx#L515)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/saved/page.tsx#L216)
- [page.tsx](c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/digest/page.tsx#L164)

What is happening:

- secondary intelligence surfaces are gated as premium
- that is product-coherent enough
- the main problem is not that these pages are gated
- the main problem is that `Validate` itself is the core workflow and is still ambiguously positioned

Recommendation:

- fix `Validate` first
- after that, premium gating on reports/monitors/digest will read as a clearer upgrade path

## Product map after this audit

This is the cleanest role assignment for the app:

- `Radar`
  - live shortlist of opportunities worth attention now
- `Explore`
  - broader discovery and scanning layer
- `Opportunities`
  - curated shortlist of saved bets
- `Validate`
  - core decision engine
- `Reports`
  - durable answer and reference memory
- `Saved / Monitors`
  - recurring watch layer
- `Digest`
  - passive update layer

Right now, the codebase already contains these surfaces, but the product language and emphasis still blur them.

## Next recommended build order

1. Fix `Validate` truth and hierarchy first
2. Reframe `Reports` as the payoff of validation, not an archive
3. Sharpen the difference between `Radar`, `Explore`, and `Opportunities`
4. Reframe `Saved` and `Digest` as follow-through surfaces after validation

## Bottom line

The app does not mainly need more pages.

It needs a stronger hierarchy between the pages it already has.

The biggest product opportunity remains:

- make `Validate` feel like the center of gravity
- make `Reports` feel like the earned answer
- make the rest of the dashboard feel like support for that core loop
