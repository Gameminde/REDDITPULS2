# VPS Scraper Worker

Run the recurring market scraper on a VPS instead of relying on the app machine or GitHub Actions.

## Why this setup

This worker gives us:

- stable long-running execution
- better control over retries and logs
- a simple `systemd` timer instead of browser-triggered scans
- isolation from the Next.js app process
- an explicit long-run timeout policy so healthy scrapes are not cut off early
- a repo-managed runtime contract for both the scraper and the web app

## What this deploys

- a dedicated Python virtualenv at `/opt/redditpulse/.venv`
- a web runtime preparation script for `/opt/redditpulse/app/.next`
- a runtime verification script for web, scraper, timer, worker, and nginx
- a locked runner script so overlapping scans do not pile up
- a `systemd` oneshot service
- a `systemd` timer that runs every 6 hours
- log output written to `/var/log/redditpulse/market-scraper.log`

## 1. Clone the repo on the VPS

```bash
sudo mkdir -p /opt
cd /opt
sudo git clone <your-repo-url> redditpulse
sudo chown -R $USER:$USER /opt/redditpulse
cd /opt/redditpulse
```

## 2. Install OS prerequisites

Ubuntu / Debian example:

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip git
```

## 3. Install the worker

```bash
cd /opt/redditpulse
sudo bash scripts/vps/install_market_scraper.sh /opt/redditpulse
```

This will:

- create the `redditpulse` system user by default
- create `/etc/redditpulse/scraper.env`
- create a dedicated venv at `/opt/redditpulse/.venv`
- install and enable the timer
- keep repo ownership with the deploy user while `.venv`, `app/.next`, and `/var/log/redditpulse` stay runtime-owned paths

## 4. Fill in environment secrets

```bash
sudo nano /etc/redditpulse/scraper.env
```

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

Recommended:

- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `SCRAPECREATORS_API_KEY` if you want provider-backed Reddit as the first lane
- `REDDIT_OAUTH_REDIRECT_URI` if the same server also hosts the app and Reddit Connection Lab
- `GITHUB_TOKEN` for higher GitHub Issues rate limits

Optional:

- `REDDIT_OAUTH_CLIENT_ID`
- `REDDIT_OAUTH_CLIENT_SECRET`
- `PROXY_LIST`
- `PRODUCTHUNT_API_KEY`
- `PRODUCTHUNT_API_SECRET`
- `G2_API_TOKEN` for buyer-review enrichment
- `ADZUNA_APP_ID`
- `ADZUNA_APP_KEY`
- `ADZUNA_COUNTRY`
- `SCRAPER_SOURCES`

## 5. Test one manual run

```bash
sudo systemctl start redditpulse-scraper.service
sudo journalctl -u redditpulse-scraper.service -n 200 --no-pager
tail -n 200 /var/log/redditpulse/market-scraper.log
```

## 6. Verify the timer

```bash
sudo systemctl status redditpulse-scraper.timer
systemctl list-timers --all | grep redditpulse
```

## 7. Update later

```bash
cd /opt/redditpulse
git pull
sudo /opt/redditpulse/.venv/bin/pip install -r requirements-scraper.txt
cd /opt/redditpulse/app
npm install
npm run build
cd /opt/redditpulse
sudo bash scripts/vps/prepare_web_runtime.sh /opt/redditpulse
sudo systemctl restart redditpulse-web.service
sudo systemctl restart redditpulse-scraper.timer
sudo bash scripts/vps/verify_runtime.sh /opt/redditpulse
```

If you install with a non-default service name, replace `redditpulse-scraper` in the commands above with your chosen service name.

## Notes

- The runner uses a lock file at `/tmp/redditpulse-market-scraper.lock`, so the timer skips if a previous run is still active.
- The scraper already loads repo-local `.env` files through `engine/env_loader.py`, but the VPS service should use `/etc/redditpulse/scraper.env` as the main secret source.
- The Reddit Connection Lab can reuse `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`; separate `REDDIT_OAUTH_*` envs are optional.
- The app keeps reading market data from Supabase as usual. The VPS only replaces the scheduler and worker side.
- The installer renders the `systemd` unit files with your chosen repo path, user, group, and service name. If you stick with defaults, the service is `redditpulse-scraper`.
- Web deploy order on the VPS is: `git pull`, install app deps if needed, `npm run build`, `bash scripts/vps/prepare_web_runtime.sh /opt/redditpulse`, restart `redditpulse-web.service`, then `bash scripts/vps/verify_runtime.sh /opt/redditpulse`.
- Scraper update order on the VPS is: `git pull`, refresh `.venv` packages, start or restart the timer, optionally run one manual scrape, then `bash scripts/vps/verify_runtime.sh /opt/redditpulse`.
- The ownership contract is intentional: keep the repo deploy-owned, but keep `/opt/redditpulse/.venv`, `/opt/redditpulse/app/.next`, and `/var/log/redditpulse` writable by the `redditpulse` runtime user.
