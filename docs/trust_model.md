# Trust Model

## Purpose

Phase 1 starts by standardizing how RedditPulse expresses trust across:

- opportunities (`ideas`)
- trends derived from opportunities
- validations (`idea_validations`)

The goal is not to invent new confidence theatrics.
The goal is to make existing evidence, freshness, and coverage more visible and easier to reason about.

## Core Principles

1. Evidence over vibes
2. Freshness matters
3. Weak signal should look weaker
4. Direct evidence and inference should be distinguished
5. The same trust language should appear across discovery and validation

## Shared Trust Contract

Each trust-aware entity exposes a derived `trust` object with:

- `level`
  - `HIGH`, `MEDIUM`, or `LOW`
- `label`
  - human-readable trust label
- `score`
  - derived 0-100 trust score
- `evidence_count`
  - amount of supporting evidence behind the current signal
- `direct_evidence_count`
  - count of attached concrete evidence items
- `direct_quote_count`
  - direct quotes or quote-like pain evidence when available
- `source_count`
  - number of contributing sources
- `freshness_hours`
  - hours since the signal/report was last updated
- `freshness_label`
  - user-facing freshness summary
- `weak_signal`
  - whether the signal should be treated cautiously
- `weak_signal_reasons`
  - explicit reasons the signal is weak
- `inference_flags`
  - explicit notes when conclusions rely on synthesis rather than directly observed evidence

## Opportunity Trust

Opportunity trust is derived from:

- `post_count_7d`
- `post_count_total`
- `source_count`
- `confidence_level`
- `top_posts`
- `pain_count`
- `last_updated`

This makes `ideas` cards auditable without needing an LLM.

## Validation Trust

Validation trust is derived from:

- report `evidence_count`
- `signal_summary`
- `data_quality`
- `platform_warnings`
- `partial_coverage`
- contradictions and warnings
- `confidence`
- completion freshness

This allows report pages to say not only what the verdict is, but how trustworthy the verdict currently is.

## Intentional Limits

This phase does not claim that the trust score is a scientific truth.
It is a normalization layer over already-available evidence quality signals.

Later phases can improve it by adding:

- source-role weighting
- authority-source weighting
- quote provenance
- buyer/commercial proof weighting
- monitor-level delta trust
