# VPS Scraper Worker Code Review and Logic Audit

Date: 2026-03-31

Scope:

- `scripts/vps/install_market_scraper.sh`
- `scripts/vps/run_market_scraper.sh`
- `scripts/vps/redditpulse-scraper.service`
- `scripts/vps/redditpulse-scraper.timer`
- `docs/vps_scraper_worker.md`
- `app/src/app/api/discover/route.ts`
- `app/src/app/dashboard/StockMarket.tsx`

Goal:

- determine whether the new VPS worker path is safe to deploy
- identify operational blockers before we move the recurring scraper off the app machine
- separate worker-deployment issues from the existing market-discovery logic issues

## Executive Verdict

Current status: **NO-GO until the worker units are corrected**

Why:

1. the `systemd` service is missing an explicit long-run timeout override, which means a real scrape can be killed long before completion
2. the installer claims to support custom install paths and names, but the shipped unit files are hardcoded to `/opt/redditpulse` and `redditpulse`
3. the installer and the docs disagree about repo ownership and update flow

Important product note:

- even after the worker is fixed, this only improves **run stability and freshness**
- it does **not** by itself solve the market’s current “broad themes instead of sharp wedges” problem

## Findings

### 1. Critical: the `systemd` oneshot service has no long-run timeout override

Files:

- [redditpulse-scraper.service](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scripts/vps/redditpulse-scraper.service#L6)
- [run_market_scraper.sh](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scripts/vps/run_market_scraper.sh#L41)

Details:

- the service is declared as `Type=oneshot`
- the scraper command is a real long-running job
- there is no `TimeoutStartSec=` in the service unit

Logic risk:

- on many `systemd` setups, a oneshot service inherits the manager default startup timeout
- that means a healthy scrape can be killed by the service manager before it finishes
- this would recreate the exact class of “run died upstream” problem we are trying to escape

Impact:

- recurring runs can fail even when Python and Supabase are healthy
- the worker can look “installed” but never complete real production scans

Recommendation:

- add `TimeoutStartSec=infinity` or a deliberately large explicit timeout
- consider also adding `SuccessExitStatus=0` only if needed, but the timeout is the blocker

### 2. High: installer is configurable on paper, but the unit files are hardcoded

Files:

- [install_market_scraper.sh](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scripts/vps/install_market_scraper.sh#L4)
- [install_market_scraper.sh](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scripts/vps/install_market_scraper.sh#L43)
- [redditpulse-scraper.service](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scripts/vps/redditpulse-scraper.service#L8)
- [redditpulse-scraper.service](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scripts/vps/redditpulse-scraper.service#L10)
- [redditpulse-scraper.service](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scripts/vps/redditpulse-scraper.service#L12)
- [redditpulse-scraper.timer](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scripts/vps/redditpulse-scraper.timer#L8)

Details:

- the installer exposes:
  - `REPO_DIR`
  - `APP_USER`
  - `APP_GROUP`
  - `SERVICE_NAME`
- but the installed service still hardcodes:
  - `User=redditpulse`
  - `Group=redditpulse`
  - `WorkingDirectory=/opt/redditpulse`
  - `ExecStart=/opt/redditpulse/scripts/vps/run_market_scraper.sh`
- the timer hardcodes `Unit=redditpulse-scraper.service`

Logic risk:

- any non-default install path or service name produces a half-configured system
- the installer gives the illusion of flexibility while silently shipping fixed assumptions

Impact:

- custom installations fail at runtime
- env-file group permissions can drift from the actual service user/group
- documentation becomes unreliable because the real deployment contract is hidden in the unit files

Recommendation:

- either:
  - make the installer truly template the service and timer units
- or:
  - remove the configurable env vars and document a single supported fixed install contract

### 3. Medium: installer ownership model conflicts with the documented update flow

Files:

- [install_market_scraper.sh](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scripts/vps/install_market_scraper.sh#L29)
- [install_market_scraper.sh](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scripts/vps/install_market_scraper.sh#L30)
- [vps_scraper_worker.md](/c:/Users/PC/Desktop/youcef/A/RedditPulse/docs/vps_scraper_worker.md#L88)

Details:

- the install script recursively changes repo ownership to the service user:
  - `chown -R "$APP_USER:$APP_GROUP" "$REPO_DIR"`
- the docs later say:
  - `cd /opt/redditpulse`
  - `git pull`

Logic risk:

- after installation, the original SSH user may no longer own the repo
- the documented update flow can fail with permissions errors

Impact:

- day-2 operations become brittle
- updates can accidentally be done as the wrong user or with `sudo`, which then starts a permission tug-of-war

Recommendation:

- choose one model and document it:
  - either the repo is owned by the deploy user and only the runtime/log paths belong to the service user
  - or all updates are explicitly run as the service user

### 4. Medium: external-worker mode is enforced in the API, but not explained in the market UI

Files:

- [discover route](/c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/api/discover/route.ts#L85)
- [StockMarket.tsx](/c:/Users/PC/Desktop/youcef/A/RedditPulse/app/src/app/dashboard/StockMarket.tsx#L1906)

Details:

- `POST /api/discover` now returns `409` when `SCRAPER_EXECUTION_MODE=external`
- `GET /api/discover` returns `executionMode`
- the market page still tries to launch scans normally and only shows the returned error after the button is used

Logic risk:

- the user sees a normal scan action on a host that is intentionally not allowed to run scans
- this produces confusion rather than a clear operational state

Impact:

- support noise
- unnecessary failed scan attempts
- the UI still implies the app host is responsible for scans

Recommendation:

- surface `executionMode` in the market UI
- disable or relabel the scan control when the host is in external-worker mode
- show a small “scanner runs on VPS worker” status message instead of waiting for a 409

### 5. Low: installer assumes `sudo` inside a root-run script

Files:

- [install_market_scraper.sh](/c:/Users/PC/Desktop/youcef/A/RedditPulse/scripts/vps/install_market_scraper.sh#L33)

Details:

- docs call the installer with `sudo bash ...`
- inside that script, the venv/bootstrap steps use nested `sudo -u ...`

Logic risk:

- this is usually fine on a standard Ubuntu VPS
- but it is an unnecessary dependency on `sudo` being installed and configured even when already running as root

Impact:

- lower portability to stripped-down VPS images
- avoidable failure mode during automation

Recommendation:

- either keep it and explicitly document “requires sudo”
- or replace nested `sudo -u` with `runuser` / `su` / direct ownership-safe commands

## Logic Audit

### What the VPS worker path fixes

- removes recurring market scraping from the app process
- gives the scraper stable runtime and its own logs
- avoids browser-triggered scans as the primary operational path
- keeps Supabase as the shared source of truth, so the app side does not need a big rewrite

### What it does not fix

- broad parent-theme dominance in the market
- low wedge-generation quality
- stale discovery logic
- source-specific data quality issues by itself

So the worker is the right **operations fix**, but not the full **product fix**.

### Current app integration quality

Good:

- the API now has an explicit external-worker mode
- the app can stay read-only against Supabase while the worker runs elsewhere

Incomplete:

- the market UI still behaves like the same host owns scan execution
- the operator experience is not yet clean enough for “scanner lives on VPS”

## Go / No-Go Guidance

### Go now?

No.

### What blocks go-live?

1. add a safe long-run timeout policy to the service unit
2. resolve the hardcoded-path/hardcoded-user mismatch
3. fix the documented update flow versus ownership model

### What can wait until after go-live?

- UI polish for external-worker mode
- better status copy in the market page

## Recommended Fix Order

1. Fix the worker units first
   - timeout
   - path/user/service-name templating or explicit fixed contract
2. Fix the install/update ownership model
3. Make the market UI acknowledge external-worker mode
4. Deploy the VPS worker
5. Then reassess market freshness from healthy runs before touching discovery logic again

## Bottom Line

The VPS direction is correct.

The current worker package is **close**, but not deployment-safe yet. The biggest issue is not market logic; it is that the new `systemd` worker can still fail for service-level reasons before the scraper even gets a fair chance to run.
