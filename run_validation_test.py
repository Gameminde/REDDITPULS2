import subprocess, sys, os, json, requests, uuid

SUPABASE_URL = "https://wpdtgfashbtlkdcuachh.supabase.co"
VAL_ID       = str(uuid.uuid4())
USER_ID      = "ba3c9bf1-eac2-40f5-8b81-dee1b7e6cb28"
IDEA         = ("AI-powered code review tool for solo developers and small teams "
                "who can't afford a senior engineer — automatically reviews pull "
                "requests, catches bugs, suggests improvements, and explains why "
                "changes matter, without needing a team member to review")

# Read service key from .env.local
SERVICE_KEY = ""
with open("app/.env.local") as f:
    for line in f:
        line = line.strip()
        if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
            SERVICE_KEY = line.split("=", 1)[1]
            break

headers = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

print(f"[OK] user_id = {USER_ID}")
print(f"[OK] val_id  = {VAL_ID}")

# Insert validation row
print(f"[DB] Inserting validation row...")
r = requests.post(
    SUPABASE_URL + "/rest/v1/idea_validations",
    json={"id": VAL_ID, "user_id": USER_ID, "idea_text": IDEA, "model": "multi-brain", "status": "queued"},
    headers=headers,
    timeout=10,
)
print(f"[DB] Insert: {r.status_code} {r.text[:100]}")
if r.status_code not in (200, 201):
    print("[FATAL] Insert failed, aborting.")
    sys.exit(1)

# Write config
config = {"validation_id": VAL_ID, "idea": IDEA, "user_id": USER_ID}
with open("test_config.json", "w") as f:
    json.dump(config, f)

print(f"\n[>>>] Launching validation...\n{'='*60}")

env = os.environ.copy()
env["SUPABASE_URL"]         = SUPABASE_URL
env["SUPABASE_KEY"]         = SERVICE_KEY
env["SUPABASE_SERVICE_KEY"] = SERVICE_KEY
env["PYTHONIOENCODING"]     = "utf-8"

proc = subprocess.Popen(
    [sys.executable, "validate_idea.py", "--config-file", "test_config.json"],
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
)

for line in proc.stdout:
    print(line, end="", flush=True)

proc.wait()
print(f"\n{'='*60}\n[DONE] Exit code: {proc.returncode}")
