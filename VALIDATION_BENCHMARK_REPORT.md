# Validation Benchmark Report

- Mode: `pre-LLM benchmark`
- Purpose: validate source health, taxonomy, and primary filter quality without spending model tokens
- Generated: `2026-03-26T17:36:09.928314+00:00`

## Executive Readout

- Ready now: `0`
- Limited / review needed: `2`
- Not ready: `2`

## Summary

- `invoice chasing for freelancers`: `LIMITED - REVIEW BEFORE FULL VALIDATION` | problem `moderate` | business `strong` | trusted direct `2` | problem-layer `9` | pass-rate `24.8%`
- `Notion template marketplace for HR teams`: `NOT READY FOR FULL VALIDATION` | problem `weak` | business `moderate` | trusted direct `0` | problem-layer `4` | pass-rate `5.8%`
- `expense report automation for construction companies`: `NOT READY FOR FULL VALIDATION` | problem `weak` | business `moderate` | trusted direct `0` | problem-layer `9` | pass-rate `9.6%`
- `AI code review tool for developers`: `LIMITED - REVIEW BEFORE FULL VALIDATION` | problem `moderate` | business `strong` | trusted direct `3` | problem-layer `60` | pass-rate `37.1%`

## invoice chasing for freelancers

- Benchmark verdict: `LIMITED - REVIEW BEFORE FULL VALIDATION`
- Problem signal: `moderate`
- Business signal: `strong`
- Source transport: `mixed`
- Routing health: `polluted`
- ICP: `B2B_FINANCE`
- Audience: `Freelancers and solo service businesses`
- Keywords: `invoice, payment reminder, late payment, freelance invoicing`
- Base routed subreddits: `Accounting, bookkeeping, smallbusiness, tax, FreshBooks, QuickBooks, Upwork, freelance`
- Final routed subreddits: `Accounting, bookkeeping, smallbusiness, tax, FreshBooks, QuickBooks, Upwork, freelance, business, Professors, socialwork, managers, CustomerService, FuneralDirector`
- Occupation-added subreddits: `business, Professors, socialwork, managers, CustomerService, FuneralDirector`
- Suspicious routed subreddits: `business, Professors, socialwork, managers, FuneralDirector`
- Occupation map matches: `business teachers, postsecondary -> Professors, business; customer service representatives -> CustomerService; first-line supervisors of personal service workers -> managers`
- Raw posts: `395`
- Filtered posts: `98`
- Filter pass rate: `24.8%`
- Provenance loss: raw `18` (5%), filtered `7` (7%)

### Main Blockers

- source transport is mixed
- subreddit routing is polluted by weak occupation-map additions

### Source Health

- `reddit_posts`: `ok` (24 rows, 35.36s) - {"selected_subreddits": ["indiehackers", "workonline", "upwork", "bookkeeping", "freelance", "funeraldirector", "freshbooks", "freelancewrit
- `reddit_historical_posts`: `empty` (0 rows, 8.01s)
- `reddit_comments`: `empty` (0 rows, 87.11s)
- `hackernews`: `ok` (297 rows, 5.71s)
- `producthunt`: `failed` (0 rows, 4.99s) - method=RSS-only; status=failed
- `indiehackers`: `ok` (20 rows, 4.84s) - method=Algolia; status=ok
- `g2_reviews`: `empty` (0 rows, 6.39s)
- `adzuna_jobs`: `ok` (20 rows, 28.35s)
- `vendor_blogs`: `ok` (4 rows, 32.45s)
- `stackoverflow`: `skipped` (0 rows, 0.0s) - reason=non-dev or unavailable
- `github_issues`: `ok` (30 rows, 5.95s)

### Evidence Quality

- Raw by source: `{"unknown": 18, "reddit": 6, "hackernews": 297, "indiehackers": 20, "job_posting": 20, "vendor_blog": 4, "githubissues": 30}`
- Filtered by source: `{"unknown": 7, "reddit": 5, "hackernews": 70, "job_posting": 12, "vendor_blog": 4}`
- Raw taxonomy: `{"source_classes": {"community": 341, "jobs": 20, "vendor": 4, "dev-community": 30}, "evidence_layers": {"problem": 32, "business": 152, "supporting": 211}, "directness_tiers": {"adjacent": 228, "supporting": 152, "direct": 15}, "source_names": {"unknown": 18, "reddit": 6, "hackernews": 297, "indiehackers": 20, "job_posting": 20, "vendor_blog": 4, "githubissues": 30}}`
- Filtered taxonomy: `{"source_classes": {"community": 82, "jobs": 12, "vendor": 4}, "evidence_layers": {"problem": 9, "business": 58, "supporting": 31}, "directness_tiers": {"adjacent": 38, "supporting": 58, "direct": 2}, "source_names": {"unknown": 7, "reddit": 5, "hackernews": 70, "job_posting": 12, "vendor_blog": 4}}`

### Filter Diagnostics

- By reason: `{}`
- Note: rejection reasons are not being surfaced yet by the primary filter, so this part of the benchmark is still incomplete.
- Rejected sample: `["Request\u2019s Past, Present and Future", "GitHub Desktop for Linux?", "So, what's next?", "URGENT: SECURITY: New maintainer is probably malicious", "proposal: spec: add sum types / discriminated unions", "GPU acceleration for Apple's M1 chip?", "[Feature] Support CSS Grid", "[BUG] Instantly hitting usage limits with Max subscription", "[WSL 2] NIC Bridge mode \ud83d\udda7 (Has TCP Workaround\ud83d\udd28)", "Feature : Allow project reference DLLs to be added to the parent nupkg for pack target like IncludeReferencedProjects in nuget.exe"]`

### Best Buyer-Native Direct Problem Evidence

- `reddit` | `score=6.4` | `direct/problem` | What are your thoughts on late fees? Do you charge late fees on late payments?
- `reddit` | `score=3.5` | `direct/problem` | How to categorize payouts that include bank fees

### Best Buyer-Native Adjacent Problem Evidence

- None

### Best Business/Supporting Evidence

- `hackernews` | `score=338.4` | `supporting/business` | Show HN: Invoice Dragon – An open source app to create PDF invoices
- `hackernews` | `score=76.8` | `supporting/business` | Show HN: Invoice-o-matic – a free online invoice tool
- `hackernews` | `score=53.4` | `supporting/business` | Show HN: A free invoice generator
- `hackernews` | `score=34.2` | `supporting/business` | Show HN: InvoiceAtOnce – Easy Invoice Creation
- `hackernews` | `score=23.4` | `supporting/business` | Show HN: BillBuddy – Automated Invoice Processing

### Hidden Risk: High-Scoring Items With Lost Provenance

- `unknown` | `score=43.0` | `adjacent/problem` | Complicated situation: Client was my friend, became client and now we have an oustanding invoice
- `unknown` | `score=18.0` | `adjacent/problem` | What are you building? Let's self promote.
- `unknown` | `score=8.0` | `adjacent/problem` | Fellow people, I have just been scammed in OLX and I wanted to share my experience.

## Notion template marketplace for HR teams

- Benchmark verdict: `NOT READY FOR FULL VALIDATION`
- Problem signal: `weak`
- Business signal: `moderate`
- Source transport: `mixed`
- Routing health: `polluted`
- ICP: `B2B_HR`
- Audience: `HR generalists and people operations teams at small companies`
- Keywords: `notion templates, hr onboarding, people ops workflows, hr templates`
- Base routed subreddits: `humanresources, AskHR, recruiting, hrtech, peopleops, smallbusiness, Entrepreneur, WorkAdvice`
- Final routed subreddits: `humanresources, AskHR, recruiting, hrtech, peopleops, smallbusiness, Entrepreneur, WorkAdvice, managers, marketing, Archaeology, Anthropology, Professors, MarektingResearch`
- Occupation-added subreddits: `managers, marketing, Archaeology, Anthropology, Professors, MarektingResearch`
- Suspicious routed subreddits: `managers, marketing, Archaeology, Anthropology, Professors, MarektingResearch`
- Occupation map matches: `general and operations managers -> managers; anthropology and archeology teachers, postsecondary -> Professors, Anthropology, Archaeology; market research analysts and marketing specialists -> Marketresearch, MarektingResearch, marketing`
- Raw posts: `224`
- Filtered posts: `13`
- Filter pass rate: `5.8%`
- Provenance loss: raw `21` (9%), filtered `4` (31%)

### Main Blockers

- insufficient buyer-native direct problem evidence
- source transport is mixed
- subreddit routing is polluted by weak occupation-map additions
- too much filtered evidence has unknown provenance

### Source Health

- `reddit_posts`: `ok` (21 rows, 51.76s) - {"selected_subreddits": ["marektingresearch", "indiehackers", "productivity", "peopleops", "workadvice", "hrtech", "humanresources", "manage
- `reddit_historical_posts`: `empty` (0 rows, 7.05s)
- `reddit_comments`: `empty` (0 rows, 78.04s)
- `hackernews`: `ok` (134 rows, 3.56s)
- `producthunt`: `failed` (0 rows, 2.87s) - method=RSS-only; status=failed
- `indiehackers`: `ok` (20 rows, 4.18s) - method=Algolia; status=ok
- `g2_reviews`: `empty` (0 rows, 3.91s)
- `adzuna_jobs`: `ok` (19 rows, 4.41s)
- `vendor_blogs`: `ok` (1 rows, 5.05s)
- `stackoverflow`: `skipped` (0 rows, 0.0s) - reason=non-dev or unavailable
- `github_issues`: `ok` (29 rows, 5.32s)

### Evidence Quality

- Raw by source: `{"unknown": 21, "hackernews": 134, "indiehackers": 20, "job_posting": 19, "vendor_blog": 1, "githubissues": 29}`
- Filtered by source: `{"unknown": 4, "job_posting": 9}`
- Raw taxonomy: `{"source_classes": {"community": 175, "jobs": 19, "vendor": 1, "dev-community": 29}, "evidence_layers": {"problem": 35, "supporting": 161, "business": 28}, "directness_tiers": {"adjacent": 182, "supporting": 28, "direct": 14}, "source_names": {"unknown": 21, "hackernews": 134, "indiehackers": 20, "job_posting": 19, "vendor_blog": 1, "githubissues": 29}}`
- Filtered taxonomy: `{"source_classes": {"community": 4, "jobs": 9}, "evidence_layers": {"problem": 4, "business": 9}, "directness_tiers": {"adjacent": 4, "supporting": 9}, "source_names": {"unknown": 4, "job_posting": 9}}`

### Filter Diagnostics

- By reason: `{}`
- Note: rejection reasons are not being surfaced yet by the primary filter, so this part of the benchmark is still incomplete.
- Rejected sample: `["Add data classes", "Allow classes to be parametric in other parametric classes", "Static extension methods", "Feature Request: Enable/disable extensions from config file", "proposal: spec: allow type parameters in methods", "proposal: spec: short function literals", "Better sharing in Immich (feature freeze)", "Change\u00a0`useTabs` to\u00a0`true` by\u00a0default", "Regex-validated string types (feedback reset)", "[BUG] Instantly hitting usage limits with Max subscription"]`

### Best Buyer-Native Direct Problem Evidence

- None

### Best Buyer-Native Adjacent Problem Evidence

- None

### Best Business/Supporting Evidence

- `job_posting` | `score=3.4` | `supporting/business` | HR Onboarding Specialist
- `job_posting` | `score=2.4` | `supporting/business` | Senior HR Onboarding Manager
- `job_posting` | `score=1.8` | `supporting/business` | HR Onboarding Specialist
- `job_posting` | `score=1.8` | `supporting/business` | HR Onboarding Specialist
- `job_posting` | `score=1.8` | `supporting/business` | Senior HR Onboarding Specialist

### Hidden Risk: High-Scoring Items With Lost Provenance

- `unknown` | `score=11.9` | `adjacent/problem` | I built 10 digital products with an AI agent as my only employee. Honest 30-day breakdown:
- `unknown` | `score=8.4` | `adjacent/problem` | Best tool for HR onboarding docs when no one on the team designs?
- `unknown` | `score=2.8` | `adjacent/problem` | What's a Notion template you WISH existed but would take too long to build yourself?

## expense report automation for construction companies

- Benchmark verdict: `NOT READY FOR FULL VALIDATION`
- Problem signal: `weak`
- Business signal: `moderate`
- Source transport: `healthy`
- Routing health: `augmented`
- ICP: `B2B_CONSTRUCTION`
- Audience: `Construction project managers and back-office finance teams`
- Keywords: `expense report, construction expenses, receipt tracking, jobsite spend`
- Base routed subreddits: `ConstructionManagers, ConstructionTech, construction, civilengineering, projectmanagement, Homebuilding, smallbusiness`
- Final routed subreddits: `ConstructionManagers, ConstructionTech, construction, civilengineering, projectmanagement, Homebuilding, smallbusiness, BuildingCodes`
- Occupation-added subreddits: `BuildingCodes`
- Occupation map matches: `construction managers -> ConstructionManagers; construction and building inspectors -> BuildingCodes; first-line supervisors of construction trades and extraction workers -> ConstructionManagers`
- Raw posts: `177`
- Filtered posts: `17`
- Filter pass rate: `9.6%`
- Provenance loss: raw `15` (8%), filtered `11` (65%)

### Main Blockers

- insufficient buyer-native direct problem evidence
- too much filtered evidence has unknown provenance

### Source Health

- `reddit_posts`: `ok` (15 rows, 32.38s) - {"selected_subreddits": ["indiehackers", "civilengineering", "buildingcodes", "bookkeeping", "constructiontech", "financialplanning", "entre
- `reddit_historical_posts`: `ok` (1 rows, 50.15s)
- `reddit_comments`: `empty` (0 rows, 69.75s)
- `hackernews`: `ok` (98 rows, 3.33s)
- `producthunt`: `failed` (0 rows, 18.43s) - method=RSS-only; status=failed
- `indiehackers`: `ok` (18 rows, 10.46s) - method=Algolia; status=ok
- `g2_reviews`: `empty` (0 rows, 4.98s)
- `adzuna_jobs`: `ok` (20 rows, 18.19s)
- `vendor_blogs`: `ok` (10 rows, 45.04s)
- `stackoverflow`: `skipped` (0 rows, 0.0s) - reason=non-dev or unavailable
- `github_issues`: `ok` (15 rows, 17.69s)

### Evidence Quality

- Raw by source: `{"unknown": 15, "reddit": 1, "hackernews": 98, "indiehackers": 18, "job_posting": 20, "vendor_blog": 10, "githubissues": 15}`
- Filtered by source: `{"unknown": 11, "hackernews": 1, "job_posting": 5}`
- Raw taxonomy: `{"source_classes": {"community": 132, "jobs": 20, "vendor": 10, "dev-community": 15}, "evidence_layers": {"problem": 18, "business": 54, "supporting": 105}, "directness_tiers": {"adjacent": 118, "supporting": 54, "direct": 5}, "source_names": {"unknown": 15, "reddit": 1, "hackernews": 98, "indiehackers": 18, "job_posting": 20, "vendor_blog": 10, "githubissues": 15}}`
- Filtered taxonomy: `{"source_classes": {"community": 12, "jobs": 5}, "evidence_layers": {"problem": 9, "business": 8}, "directness_tiers": {"adjacent": 9, "supporting": 8}, "source_names": {"unknown": 11, "hackernews": 1, "job_posting": 5}}`

### Filter Diagnostics

- By reason: `{}`
- Note: rejection reasons are not being surfaced yet by the primary filter, so this part of the benchmark is still incomplete.
- Rejected sample: `["Sharing: Multi-user / multi-library support with private and shared photos/albums", "[BUG] Instantly hitting usage limits with Max subscription", "Project shutdown : can we help?", "Ask HN: Are things getting more convenient but less satisfying?", "I won't be posting any more preimages against neuralhash for now", "Ask HN: How to handle 50GB of transaction data each day? (200GB during peak)", "Integrate Traffic Data", "Ask HN: How does your data science or machine learning team handle DevOps?", "Show HN: Double-entry accounting based personal finance app", "Ask HN: Freelance Management Services/Apps"]`

### Best Buyer-Native Direct Problem Evidence

- None

### Best Buyer-Native Adjacent Problem Evidence

- None

### Best Business/Supporting Evidence

- `hackernews` | `score=72.0` | `supporting/business` | Show HN: Abacus – Killing The Expense Report
- `job_posting` | `score=3.4` | `supporting/business` | Expense Reporting and Accounts Payable Specialist
- `job_posting` | `score=3.4` | `supporting/business` | Expense Reporting and Accounts Payable Specialist
- `job_posting` | `score=1.8` | `supporting/business` | Administrative Assistant [Must have Excel, PowerPoint, Expense Reports]
- `job_posting` | `score=1.8` | `supporting/business` | North: Administrator

### Hidden Risk: High-Scoring Items With Lost Provenance

- `unknown` | `score=207.0` | `supporting/business` | How it feels asking that one person to enter their expense report on time
- `unknown` | `score=25.0` | `adjacent/problem` | Our company just ditched Expensify. What are you using for expense reporting?
- `unknown` | `score=18.0` | `adjacent/problem` | Made a hobby app to handle receipts + expense claims, shorten the  process with phone.

## AI code review tool for developers

- Benchmark verdict: `LIMITED - REVIEW BEFORE FULL VALIDATION`
- Problem signal: `moderate`
- Business signal: `strong`
- Source transport: `mixed`
- Routing health: `polluted`
- ICP: `DEV_TOOL`
- Audience: `Software engineers and engineering teams`
- Keywords: `code review, pull request, developer tool, github workflow`
- Base routed subreddits: `programming, webdev, cscareerquestions, MachineLearning, LocalLLaMA, devops, learnprogramming, softwareengineering`
- Final routed subreddits: `programming, webdev, cscareerquestions, MachineLearning, LocalLLaMA, devops, learnprogramming, softwareengineering, coding, software, softwaredevelopment, AskEngineers`
- Occupation-added subreddits: `coding, software, softwaredevelopment, AskEngineers`
- Suspicious routed subreddits: `coding, softwaredevelopment`
- Occupation map matches: `software developers, systems software -> softwaredevelopment, SoftwareEngineering, software; software developers, applications -> softwaredevelopment, SoftwareEngineering, software; web developers -> softwaredevelopment, SoftwareEngineering, software`
- Raw posts: `658`
- Filtered posts: `244`
- Filter pass rate: `37.1%`
- Provenance loss: raw `184` (28%), filtered `71` (29%)

### Main Blockers

- source transport is mixed
- subreddit routing is polluted by weak occupation-map additions
- too much filtered evidence has unknown provenance

### Source Health

- `reddit_posts`: `ok` (185 rows, 56.82s) - {"selected_subreddits": ["indiehackers", "productivity", "python", "coding", "software", "java", "experienceddevs", "node", "reactjs", "askp
- `reddit_historical_posts`: `empty` (0 rows, 7.68s)
- `reddit_comments`: `empty` (0 rows, 108.59s)
- `hackernews`: `ok` (390 rows, 5.58s)
- `producthunt`: `failed` (0 rows, 2.89s) - method=RSS-only; status=failed
- `indiehackers`: `ok` (20 rows, 4.09s) - method=Algolia; status=ok
- `g2_reviews`: `empty` (0 rows, 0.0s)
- `adzuna_jobs`: `ok` (20 rows, 3.62s)
- `vendor_blogs`: `empty` (0 rows, 0.0s)
- `stackoverflow`: `ok` (25 rows, 3.68s)
- `github_issues`: `ok` (18 rows, 5.47s)

### Evidence Quality

- Raw by source: `{"unknown": 184, "reddit": 1, "hackernews": 390, "indiehackers": 20, "job_posting": 20, "stackoverflow": 25, "githubissues": 18}`
- Filtered by source: `{"unknown": 71, "hackernews": 166, "job_posting": 2, "stackoverflow": 5}`
- Raw taxonomy: `{"source_classes": {"community": 595, "jobs": 20, "dev-community": 43}, "evidence_layers": {"problem": 154, "business": 306, "supporting": 198}, "directness_tiers": {"adjacent": 339, "supporting": 306, "direct": 13}, "source_names": {"unknown": 184, "reddit": 1, "hackernews": 390, "indiehackers": 20, "job_posting": 20, "stackoverflow": 25, "githubissues": 18}}`
- Filtered taxonomy: `{"source_classes": {"community": 237, "jobs": 2, "dev-community": 5}, "evidence_layers": {"business": 112, "problem": 60, "supporting": 72}, "directness_tiers": {"supporting": 112, "adjacent": 129, "direct": 3}, "source_names": {"unknown": 71, "hackernews": 166, "job_posting": 2, "stackoverflow": 5}}`

### Filter Diagnostics

- By reason: `{}`
- Note: rejection reasons are not being surfaced yet by the primary filter, so this part of the benchmark is still incomplete.
- Rejected sample: `["Congratulations on creating the one billionth repository on GitHub!", "Allow to change the font size and font of the workbench", "Request\u2019s Past, Present and Future", "GitHub Desktop for Linux?", "Feature Request: Support AGENTS.md.", "Is Java &quot;pass-by-reference&quot; or &quot;pass-by-value&quot;?", "How do I check whether a file exists without exceptions?", "So, what's next?", "How to disable text selection highlighting", "How do I make the first letter of a string uppercase in JavaScript?"]`

### Best Buyer-Native Direct Problem Evidence

- `stackoverflow` | `score=2.4` | `direct/problem` | Github branch specific pull request template
- `stackoverflow` | `score=2.4` | `direct/problem` | Is it possible to choose pull request templates like issue in github
- `stackoverflow` | `score=2.4` | `direct/problem` | No &quot;Create Pull Request&quot; option in Xcode 13.2.1

### Best Buyer-Native Adjacent Problem Evidence

- None

### Best Business/Supporting Evidence

- `hackernews` | `score=181.2` | `supporting/business` | Ask HN: What tone to use in code review suggestions?
- `hackernews` | `score=159.0` | `supporting/business` | Show HN: I made a heatmap diff viewer for code reviews
- `hackernews` | `score=115.8` | `supporting/business` | Show HN: GitPlex – A new Git repo management server with code review
- `hackernews` | `score=93.0` | `supporting/business` | Show HN: Bot accepts every pull request for its own code
- `hackernews` | `score=66.0` | `supporting/business` | Show HN: Better code review for GitHub

### Hidden Risk: High-Scoring Items With Lost Provenance

- `unknown` | `score=583.0` | `supporting/business` | I am done. I will not be an AI slop code reviewer
- `unknown` | `score=150.0` | `adjacent/problem` | So I didn’t believe until just now
- `unknown` | `score=116.0` | `adjacent/problem` | New senior dev at a new company. Bad signs or just how it is?
