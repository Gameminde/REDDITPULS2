# Validation Queue Verification

## Purpose

This document records the verification status of the new pg-boss validation queue and the exact conditions required to run it successfully in local development and production.

## Current Status

The queue integration is now wired through pg-boss, the local worker can connect to Supabase through the session pooler, and the validation status route no longer crashes when a queued or failed validation has no verdict yet.

The queue is **partially verified end to end**. The remaining blocker for a successful validation run is no longer queue infrastructure. It is the absence of usable stored AI provider keys for the current user.

## What Was Verified Successfully

1. `POST /api/validate` now enqueues work instead of spawning Python directly.
2. The queue uses the validation UUID as the `job_id`, so queue state and `idea_validations.id` stay aligned.
3. The queue contract is configured with:
   - `retryLimit: 2`
   - `expireInSeconds: 120`
4. The worker entrypoint now loads local env files before importing the queue module.
5. The worker now supports direct or pooler-based Supabase Postgres URLs and starts correctly when one is present.
6. The new status endpoint exists and returns:
   - enriched validation state
   - queue state when available
   - retry/stale/failure diagnostics
7. Polling for queued and failed validations no longer throws when `idea_validations.verdict` is `null`.
8. The Python worker now reads AI configs through the encrypted-key RPC path instead of the removed plaintext `api_key` column.
9. Missing encrypted-key RPCs were restored in:
   - `migrations/012_ai_config_encryption_rpcs.sql`
10. Runtime spot checks passed:
   - queued validation enrichment returns `decision_pack: null` instead of crashing
   - failed validation enrichment returns the stored error payload instead of a `500`

## What Failed or Remains Risky

### Current blocker

A real successful validation is currently blocked by missing usable AI keys in `user_ai_config`.

Observed state for the affected user:

- `user_ai_config` rows exist
- `selected_model` and `is_active` are populated
- `api_key_encrypted` is `NULL`
- decrypted config RPC now works, but returns `api_key: null`

This means the queue can enqueue and the worker can start, but the Python pipeline still fails with:

- `No AI models configured. Go to Settings → AI to add your API keys.`

### Queue connection status

The local app now supports both Supabase key styles and both DB connection styles:

- publishable key via `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- legacy anon key via `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- secret backend key via `SUPABASE_SECRET_KEY`
- legacy service-role key via `SUPABASE_SERVICE_ROLE_KEY`
- direct DB URL via `SUPABASE_DB_URL`
- pooler DB URL via `SUPABASE_DB_POOLER_URL`
- strict encryption key via `AI_ENCRYPTION_KEY`

### Direct DB host caveat

In this environment, the direct host form:

```env
SUPABASE_DB_URL=postgresql://postgres:...@db.<project-ref>.supabase.co:5432/postgres
```

resolved only to IPv6 and was not reachable by the local machine. If that happens, use the Supabase **Session Pooler** connection string instead and store it as:

```env
SUPABASE_DB_POOLER_URL=postgresql://...
```

### Operational risks still present

1. A fully successful validation still depends on re-saving real AI provider keys after the encrypted RPC migration is in place.
2. Retry behavior is visible in the status route, but an actual retry cycle still needs to be observed against a live timed-out or failed validation.
3. Production deployment still needs a dedicated worker process; the Next app alone is not enough.
4. Validation settings are now encryption-required. If `AI_ENCRYPTION_KEY` is missing, both the settings API and the worker fail loudly by design.

## Required Env Vars

### App + API

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`

### Queue / Worker

- `SUPABASE_DB_POOLER_URL`, `SUPABASE_DB_URL`, or `DATABASE_URL`

Use a Postgres connection string that pg-boss can use. In this environment the pooler URL is the safer choice.

### Validation runtime

- `AI_ENCRYPTION_KEY`
  - required for both the settings API and the worker
- real AI provider keys stored in `user_ai_config`

## Local Run Instructions

### 1. Add the queue DB env

In `app/.env.local`, add one of:

```env
SUPABASE_DB_POOLER_URL=postgresql://...
```

or

```env
SUPABASE_DB_URL=postgresql://...
```

or

```env
DATABASE_URL=postgresql://...
```

If the direct `db.<project-ref>.supabase.co:5432` host fails on your machine, prefer the Session Pooler value:

```env
SUPABASE_DB_POOLER_URL=postgresql://...
```

### 1b. Add the encryption env

In `app/.env.local`, make sure this is present:

```env
AI_ENCRYPTION_KEY=...
```

Without it:

- `GET/POST /api/settings/ai` returns a clear server error
- the worker refuses to run queued validations

### 2. Start the Next app

From `RedditPulse/app`:

```bash
npm run dev
```

### 3. Start the worker in a second terminal

From `RedditPulse/app`:

```bash
npm run worker
```

Expected success log:

```text
[Worker] Validation queue worker started (...)
```

If the DB URL is still missing, the worker should fail immediately with the explicit queue connection error.

### 4. Use a premium-capable user

The validation route still requires a paid plan via `profiles.plan != 'free'`.

### 5. Apply encrypted AI config RPC migration

Run:

- `migrations/012_ai_config_encryption_rpcs.sql`

This migration restores the RPCs expected by both the settings API and the Python worker.

### 6. Re-save AI provider keys

Go to `Settings -> AI` and re-save the provider keys for the active models.

Important:

- existing rows may still show selected models
- but if `api_key_encrypted` is `NULL`, the worker has no usable key material
- those rows must be updated with real keys before validation can succeed

### 7. Run one validation

In the app:

- open `/dashboard/validate`
- submit one idea

Expected API behavior:

1. `POST /api/validate` returns:
   - `job_id`
   - `validationId`
   - `status: "queued"`
2. the worker picks up the job
3. `validate_idea.py` updates `idea_validations.status` through the normal pipeline
4. frontend polls `/api/validate/[jobId]/status`
5. report redirects on `status === "done"`
6. if validation fails, the page now shows the actual stored failure reason instead of a generic polling timeout

### 8. Verify in Supabase

Check `idea_validations`:

- row created
- status progresses
- report written on success

If needed, inspect queue job state through the status endpoint diagnostics.

## Production Worker Notes

1. Run the worker as a separate long-lived process.
2. Do not rely on the Next web process to execute queue jobs.
3. Make sure the worker has:
   - app env vars
   - direct Postgres connection string
4. Scale cautiously:
   - current worker uses `localConcurrency: 1`
   - one worker process is the safest initial deployment
5. Monitor:
   - failed jobs
   - repeated retries
   - validations stuck in `queued` or `starting`

## Reliability Hardening Notes

These protections are now in place:

1. AI settings use encrypted RPCs only in normal operation:
   - `get_ai_configs_decrypted`
   - `upsert_ai_config_encrypted`
2. Plaintext `api_key` fallback is no longer the default behavior.
3. The worker aborts queued validations if it cannot persist the starting status.
4. The status route now distinguishes:
   - queue retry pending
   - worker failure
   - validation failure
   - persistence failure
5. The validate UI surfaces real terminal failures instead of replacing them with a generic process error.

## Recommended Next Verification Pass

Once the DB URL and real AI keys are in place:

1. start app + worker
2. submit one premium validation
3. confirm:
   - row insert
   - queue enqueue
   - worker pickup
   - progress updates
   - status route correctness
   - final redirect to report
4. then run one forced failure case to observe retry visibility and final failure handling
