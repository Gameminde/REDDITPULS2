# Market User Surface Audit - 2026-04-08

## Scope

This audit covers the **user-facing Market / Opportunity Board UI only**.

It does **not** propose backend, scoring, or scraper changes yet.
It focuses on:

- what the eye sees first
- why the current board still feels too textual
- what visual signals should replace some text
- what copy should stay visible vs move behind expansion

This is a **local planning document only**. No deploy is implied by this audit.

---

## 1. What The User Sees First Today

### Desktop row

The eye currently lands on:

1. rank
2. title
3. category badge
4. several small badges
5. score
6. 24h / 7d / volume / sources

This is not terrible structurally, but the row still has 3 problems:

- the **title often reads like a diagnosis**, not like an opportunity
- the **middle of the row is metric-heavy before it is action-heavy**
- the user still has to **read too much to understand why this matters**

### Mobile card

Mobile is clearer than desktop in structure, but still suffers from:

- large title + long subtitle + long summary
- repeated labels
- too many neutral blocks with similar visual weight

The result:

- the board feels informative
- but not yet sharp
- and not yet visually addictive

---

## 2. Core UX Problem

The current Market shows:

- pain
- proof
- score
- verdict
- next step

But the **visual hierarchy is still too flat**.

The user should instantly perceive:

1. is this worth attention?
2. what kind of opportunity is this?
3. how strong is the evidence?
4. what should I do next?

Right now, the board often asks the user to **read paragraphs to derive this**.

That is too expensive.

---

## 3. Why The Current Cards Still Leak Attention

### Problem A: Title is sometimes still pain-first

Example:

`Access control and API mocking gaps in shared development tools frustrate developers`

This is understandable, but it is still closer to:

- analyst note
- research sentence

than to:

- a founder opportunity

The user naturally asks:

`Okay, so what is the thing to build?`

That means the title is not yet doing enough work.

### Problem B: The row is data-dense before it is meaning-dense

Current row gives:

- score
- 24h
- 7d
- volume
- sources

before the user clearly understands:

- category of opportunity
- maturity
- product angle

This is useful later, but not first.

### Problem C: Badges are present, but they do not form a strong visual system

Current badges:

- `Cross-source proof`
- `Needs focus`
- `Fresh`

These help, but they do not yet create a strong “market radar” feeling.

They look like metadata, not like conviction markers.

### Problem D: Expansion still carries too much explanatory prose

The expanded state is already better than before, but still too verbal.

It should feel like:

- verdict
- proof
- next move
- audit panel if wanted

Instead, it still feels slightly like:

- report excerpt

---

## 4. What The Market Should Feel Like

The board should feel like:

- a radar
- a board of moving opportunities
- a place where the eye catches momentum and confidence first

It should **not** feel like:

- a database table
- a long-form report
- a noisy analyst terminal

So the target visual feeling is:

- compact
- signal-first
- dark
- sharp
- scanable in seconds

---

## 5. What Signals We Should Add

The right direction is **not** to copy Binance literally.

Binance works because the eye immediately sees:

- movement
- confidence
- structure

We should borrow that principle, not the financial metaphor.

### Add 1: Opportunity strength rail

Each row/card should have a compact left-edge or top-edge signal showing strength:

- weak / early
- interesting
- strong

Visual form:

- vertical glow rail on desktop row
- short top rail on mobile card

Mapping:

- gray = weak / early
- blue = cross-source but not proven
- orange = strong founder-useful
- green only when there is unusually strong buyer proof

This gives the eye a fast “worth my time?” read.

### Add 2: Opportunity type chip

Add a first-class signal for **type**, not just category.

Examples:

- `Workflow gap`
- `Replacement pull`
- `Ops pain`
- `Compliance setup`
- `Trust breakdown`
- `Creator workflow`

This is more useful than showing only `saas` / `marketing`.

Category can remain, but it should be secondary.

### Add 3: Evidence density mini-bar

Instead of making the user read `19 posts / 3 sources / Cross-source proof`, use:

- one small segmented evidence bar
- plus one compact numeric label

Example:

- `Proof 3/5`
- or `3 sources / 19 posts`

Goal:

- show density quickly
- remove repeated sentence-like metadata

### Add 4: Motion pulse for trend

Current 24h / 7d numbers are useful, but visually cold.

Instead:

- keep numbers
- add a small directional pulse or sparkline-style cue

Not a big chart.
Just enough to visually distinguish:

- rising
- flat
- cooling

### Add 5: Product angle lockup

If the AI gives a clean `product_angle`, it should be shown as a distinct lockup:

- title = opportunity
- line below = product angle

Example:

- `Shared dev environment collaboration tool`
- `Adds access control, feedback tagging, and mock APIs`

This is much stronger than a single long sentence title.

---

## 6. What Text Must Be Reduced

### Keep visible by default

- title
- compact product angle
- one-line summary
- core proof strip
- score / trend
- one primary CTA

### Move behind expansion

- long verdict paragraph
- long explanation of why the signal is early
- detailed source mix prose
- market leaders summary
- proof audit prose
- most score decomposition text

### Remove from default row/card

- any sentence that starts reading like analyst narration
- repeated hints that restate the same weakness
- labels that do not change user action

---

## 7. Recommended New Hierarchy

### Desktop row

Left to right:

1. signal rail
2. rank
3. title + product angle + one-line summary
4. evidence strength block
5. trend block
6. score block
7. CTA block

Current issue:

- score is too central

Recommended:

- meaning first
- score second

### Mobile card

Top to bottom:

1. signal rail / header chip row
2. title
3. product angle
4. one-line summary
5. 3 compact stat blocks:
   - proof
   - trend
   - score
6. CTA row
7. optional expansion

This should fit in one clean screen chunk.

---

## 8. Recommended Badge System

We need fewer badge families and clearer semantics.

### Evidence badge

Use:

- `Early proof`
- `Cross-source`
- `Buyer proof`

### Maturity badge

Use:

- `Early`
- `Worth validating`
- `Strong`

### Opportunity type badge

Use:

- `Workflow gap`
- `Replacement`
- `Setup pain`
- `Trust breakdown`
- `Manual ops`

### Remove or reduce

- `Needs focus` as a dominant badge

Reason:

It is internally meaningful, but not visually attractive enough to anchor the row.

Better replacement:

- use it in expansion
- or translate it to user meaning like `Needs sharper angle`

---

## 9. Concrete UI Changes To Make Next

### Phase A: low-risk visual cleanup

1. Replace `Needs focus` visible pill with a better user-facing maturity/type signal.
2. Add `product angle` as a distinct second line everywhere.
3. Compress evidence into one proof strip.
4. Rename and simplify stats:
   - `Candidate ideas`
   - `Visible in board`
   - `Posts analyzed`

### Phase B: signal-first row redesign

1. Add a colored rail by conviction.
2. Reduce visible metric columns on desktop.
3. Make trend visually directional, not only numeric.
4. Turn the row into a cleaner hierarchy with less table feeling.

### Phase C: expansion cleanup

1. Keep only:
   - verdict
   - evidence
   - next step
2. Put everything else behind `Show full analysis`
3. Remove repeated prose

---

## 10. Product Rule For “Where Is The Opportunity?”

If a user can read a card and still ask:

`Where is the opportunity?`

then the card is not finished.

A finished card must answer this visibly:

- **who is struggling**
- **what workflow is broken**
- **what kind of tool or product angle could win**

That means:

- pain alone is not enough
- proof alone is not enough
- score alone is not enough

The UI must show the **buildable angle**.

---

## 11. Recommendation

Do not add charts or signals everywhere at once.

The best next move is:

1. redesign one desktop row and one mobile card
2. introduce:
   - conviction rail
   - product angle lockup
   - proof strip
   - cleaner CTA hierarchy
3. compare that against the current board

That will tell us quickly whether the Market becomes more attractive without becoming noisy.

---

## 12. No-Deploy Status

This audit proposes the next UX direction.

No deploy should happen until:

- the new row/card system is implemented locally
- reviewed visually
- approved explicitly

---

## 13. Continued Browser Inspection

After a second pass in the browser, 3 additional problems became obvious.

### Problem E: The top bar is repeating itself

The top bar currently repeats idea and post counts in a way that feels noisy instead of useful.

The eye should get:

- brand
- state
- one compact market count

It should not get multiple versions of the same metric sentence.

### Problem F: The bottom dock feels detached from the workspace

The dock works, but it still feels too designed and too separate from the main board.

The main issue is stronger on mobile:

- the raised `Validate` item grabs too much attention
- the bar looks like a floating promo object
- it competes with the cards instead of quietly supporting navigation

The dock should feel:

- functional
- calm
- always available

It should not feel like a hero component.

### Problem G: Too much copy appears before the first real opportunity

Before the user reaches the first board row, they still pass through:

- headline
- support paragraph
- beta banner
- intelligence intro
- intelligence summary
- intelligence metrics
- board metrics

That is too much reading before the board starts doing its main job.

The board should get to the first opportunity faster.

### Secondary finding: Explore is still too verbose

Even though this audit is centered on Market, the same pattern appears in Explore:

- long summaries
- too many support labels
- proof and momentum explained with too much language

So the cleanup direction should stay consistent across:

- Market
- Explore
- Dock
- Top bar

### Updated local cleanup direction

The most useful local adjustments are now:

1. simplify the top bar metric chip
2. flatten and calm the bottom dock
3. reduce copy above the first opportunity
4. keep titles and product angles short enough to scan
5. make navigation feel connected, not ornamental
