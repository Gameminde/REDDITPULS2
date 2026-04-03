"""
Reddit Opportunity Scanner — Configuration v2 (Hardened)
Target subreddits, pain-point phrases, scoring weights, spam filters, and industry tags.
"""

import os

# ─── Target Subreddits (42 — covering major business verticals) ──────
TARGET_SUBREDDITS = [
    # ── Core business / startup ──
    "smallbusiness",
    "Entrepreneur",
    "startups",
    "SaaS",
    "sidehustle",
    "indiehackers",
    "microsaas",
    "EntrepreneurRideAlong",
    "sweatystartup",

    # ── E-commerce / DTC ──
    "ecommerce",
    "shopify",
    "dropship",
    "FulfillmentByAmazon",
    "AmazonSeller",

    # ── Freelance / agency ──
    "freelance",
    "freelanceWriters",
    "graphic_design",
    "web_design",
    "Upwork",

    # ── Marketing / growth ──
    "marketing",
    "SEO",
    "PPC",
    "socialmedia",
    "emailmarketing",
    "ContentCreators",
    "juststart",

    # ── Dev / tech ──
    "webdev",
    "devops",
    "selfhosted",
    "nocode",
    "ProductManagement",
    "cscareerquestions",
    "learnprogramming",

    # ── Finance / legal ──
    "Accounting",
    "realestateinvesting",
    "tax",
    "legaladvice",

    # ── Remote / nomad ──
    "digitalnomad",
    "remotework",
    "WorkOnline",

    # ── AI / data ──
    "artificial",
    "MachineLearning",
    "analytics",
]

# ─── Pain-Point Trigger Phrases (expanded: 50+) ──────────────────────
PAIN_PHRASES = [
    # ── Direct tool requests ──
    "I wish there was",
    "I'd pay for",
    "is there a tool",
    "anyone know a tool",
    "looking for a solution",
    "looking for software",
    "need help finding",
    "any recommendations for",
    "wish someone would build",
    "why is there no",
    "can't believe there's no",
    "would kill for a tool",
    "is there an alternative to",
    "need a better way to",
    "what tool do you use",
    "what app do you use",
    "what software do you use",
    "best tool for",
    "does anyone use",

    # ── Frustration / pain ──
    "I hate that I have to",
    "frustrated with",
    "I spend hours",
    "waste so much time",
    "there has to be a better way",
    "manual process",
    "spreadsheet hell",
    "does anyone else struggle with",
    "so tedious",
    "kills my productivity",
    "tired of manually",
    "biggest pain point",
    "most annoying part",
    "drives me crazy",
    "sick of",
    "fed up with",
    "can't stand",
    "broken workflow",
    "terrible experience",

    # ── Pricing / cost pain ──
    "paying too much for",
    "too expensive",
    "overpriced",
    "cheaper alternative",
    "free alternative",
    "price keeps going up",
    "raised their prices",

    # ── Automation / efficiency ──
    "automate this",
    "is there a way to automate",
    "doing this manually",
    "repetitive task",
    "takes forever",
    "bottleneck in my workflow",
]

# ─── Industry Classification Keywords ────────────────────────────────
INDUSTRY_KEYWORDS = {
    "SaaS / Software": [
        "saas", "software", "app", "platform", "api", "integration",
        "subscription", "mrr", "arr", "churn", "onboarding", "user retention",
        "b2b", "b2c", "product-market fit", "mvp", "launch",
    ],
    "Marketing / Growth": [
        "seo", "marketing", "ads", "advertising", "lead gen", "outreach",
        "cold email", "social media", "content marketing", "funnel",
        "conversion rate", "landing page", "brand", "campaign",
    ],
    "E-Commerce / DTC": [
        "ecommerce", "e-commerce", "shopify", "amazon", "dropship",
        "fulfillment", "shipping", "product photos", "supplier",
        "inventory", "returns", "wholesale", "dtc", "print on demand",
    ],
    "Freelance / Services": [
        "freelance", "client", "contractor", "invoice", "proposal",
        "scope creep", "hourly rate", "retainer", "ghosted", "upwork",
        "fiverr", "agency", "consulting",
    ],
    "Accounting / Finance": [
        "accounting", "bookkeeping", "tax", "quickbooks", "xero",
        "invoice", "payroll", "expenses", "cash flow", "profit margin",
        "cpa", "revenue", "p&l",
    ],
    "Web Dev / Tech": [
        "web dev", "react", "javascript", "hosting", "deploy",
        "database", "api", "frontend", "backend", "devops", "ci/cd",
        "bug", "code review", "tech stack",
    ],
    "Content Creation": [
        "content creator", "youtube", "podcast", "newsletter", "blog",
        "monetize", "audience", "subscribers", "viral", "algorithm",
    ],
    "Real Estate": [
        "real estate", "rental", "tenant", "property", "mortgage",
        "landlord", "airbnb", "lease", "broker", "closing",
    ],
    "Remote Work / Nomad": [
        "remote work", "digital nomad", "timezone", "async", "wfh",
        "coworking", "visa", "nomad", "distributed team",
    ],
    "Side Hustle / Startup": [
        "side hustle", "side project", "startup", "bootstrap",
        "solopreneur", "indie hacker", "passive income", "validate",
    ],
}

# ─── Spam / Low-Quality Patterns ─────────────────────────────────────
SPAM_PATTERNS = [
    r"(?:check out|visit|use) my (?:tool|app|site|product|link)",
    r"(?:i built|i made|just launched|check out) .{0,30}(?:link in|check it|try it|sign up)",
    r"(?:affiliate|referral|promo code|discount code|coupon)",
    r"(?:dm me|pm me|send me a message) for",
    r"free trial.{0,20}(?:link|sign up|click)",
    r"(?:upvote|like|subscribe|follow me)",
    r"\[?ad\]?|\[?sponsored\]?|\[?promotion\]?",
]

# ─── Humor / Off-topic Indicators ────────────────────────────────────
HUMOR_INDICATORS = [
    r"(?:lmao|lmfao|rofl|haha|jk|just kidding|shitpost)",
    r"(?:meme|joke|funny|satire|sarcasm|/s)",
]

# ─── Scoring Weights ─────────────────────────────────────────────────
SCORING_WEIGHTS = {
    "engagement": 0.25,       # per-subreddit normalized (reduced from 0.30)
    "frustration": 0.30,      # sentiment negativity
    "phrase_match": 0.20,     # pain-point phrase match
    "recency": 0.10,          # newer posts = trending problems
    "cross_sub": 0.15,        # appears in multiple subreddits (bumped from 0.05)
}

# ─── Scraper Settings ────────────────────────────────────────────────
REQUEST_DELAY = 2.0           # seconds between requests
POSTS_PER_PAGE = 100          # max Reddit allows
PAGES_PER_SUBREDDIT = 5       # 5 × 100 = 500 posts per sub
SEARCH_PAGES = 3

USER_AGENTS = [
    # ── Chrome 131-134 (Windows, Mac, Linux) ──
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    # ── Firefox 132-134 ──
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:134.0) Gecko/20100101 Firefox/134.0",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
    "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    # ── Safari 18 (macOS Sonoma / Sequoia) ──
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3.1 Safari/605.1.15",
    # ── Edge 131+ ──
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    # ── Brave / Vivaldi (share Chrome UA with slight variations) ──
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
]

# ─── Reddit OAuth (optional API fallback) ────────────────────────────
# Register at https://www.reddit.com/prefs/apps → "script" type app
# Fill these in .env for API-backed scraping (60 req/min vs ~10/min public)
REDDIT_CLIENT_ID = os.environ.get("REDDIT_CLIENT_ID", "")
REDDIT_CLIENT_SECRET = os.environ.get("REDDIT_CLIENT_SECRET", "")
REDDIT_USERNAME = os.environ.get("REDDIT_USERNAME", "")
REDDIT_PASSWORD = os.environ.get("REDDIT_PASSWORD", "")

# ─── Output Settings ─────────────────────────────────────────────────
OUTPUT_DIR = "output"
RAW_DATA_FILE = "raw_scraped_data.json"
RESULTS_CSV = "results.csv"
REPORT_HTML = "report.html"
TOP_N_RESULTS = 50
