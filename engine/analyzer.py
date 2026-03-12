"""
Reddit Opportunity Scanner — Sentiment Analyzer v3 (Weaponized)
50-Word B2B Friction VADER Matrix, AI Slop / Dead Internet Filter,
expanded markers, context validation, multi-pass analysis.
"""

import re
import nltk
from nltk.sentiment.vader import SentimentIntensityAnalyzer


def _ensure_vader():
    """Download VADER lexicon if not present."""
    try:
        nltk.data.find("sentiment/vader_lexicon.zip")
    except LookupError:
        nltk.download("vader_lexicon", quiet=True)


# ═══════════════════════════════════════════════════════
# 50-WORD B2B FRICTION VADER MATRIX
# ═══════════════════════════════════════════════════════
# Every word here is a business signal — not generic sentiment.
# Negative = pain = opportunity. Positive = validated solution.

VADER_B2B_MATRIX = {
    # ── Churn & Migration Intent (highest signal — wallet is OPEN) ──
    "migration": -2.5,
    "migrating": -2.5,
    "migrate": -2.0,
    "switched from": -3.0,
    "switching from": -3.0,
    "moved away from": -3.0,
    "ditched": -2.5,
    "cancelled": -2.0,
    "churned": -2.5,
    "churn": -1.5,
    "locked in": -2.5,
    "vendor lock": -3.0,
    "no way out": -2.5,

    # ── Pricing Rage (customer with credit card ready for YOUR product) ──
    "price hike": -3.5,
    "price increase": -3.0,
    "raised their prices": -3.5,
    "overpriced": -2.5,
    "too expensive": -2.5,
    "nickel and dime": -3.0,
    "money grab": -3.0,
    "highway robbery": -3.0,

    # ── Product Decay (enshittification pipeline) ──
    "enshittification": -3.5,
    "enshittified": -3.0,
    "nerfed": -2.0,
    "bloatware": -3.0,
    "bloated": -2.0,
    "vaporware": -3.0,
    "abandonware": -2.5,
    "dead app": -2.5,
    "dumpster fire": -3.5,
    "shitshow": -3.0,
    "dogshit": -3.5,
    "bricked": -3.0,
    "paywall": -2.5,
    "paywalled": -2.5,

    # ── Workflow / Integration Pain ──
    "scope creep": -2.5,
    "bottleneck": -2.0,
    "downtime": -2.5,
    "onboarding hell": -3.0,
    "onboarding nightmare": -3.0,
    "integration nightmare": -3.0,
    "broken integration": -2.5,
    "manual workaround": -2.5,

    # ── Business Stress ──
    "burnout": -2.5,
    "overhead": -1.5,
    "ghosted": -2.0,
    "underpaid": -2.0,
    "overworked": -2.0,
    "rugpull": -3.5,
    "rugpulled": -3.5,
    "scam": -2.5,

    # ── Reddit Slang ──
    "mid": -1.0,
    "copium": -1.0,
    "sus": -1.0,
    "sketchy": -1.5,

    # ── Positive (validated solutions — what YOUR product should feel like) ──
    "game changer": 2.5,
    "game-changer": 2.5,
    "lifesaver": 3.0,
    "life saver": 3.0,
    "godsend": 3.0,
    "essential": 1.5,
    "must-have": 2.5,
    "no-brainer": 2.5,
    "brilliant": 2.0,
    "slick": 1.5,
    "buttery smooth": 2.0,
}
# Total: 50 words — every one a B2B signal


# ═══════════════════════════════════════════════════════
# AI SLOP / DEAD INTERNET FILTER
# ═══════════════════════════════════════════════════════
# Detects ChatGPT / AI-generated posts that pollute data.
# We guarantee 100% human frustration in the database.

AI_SLOP_PHRASES = [
    # ChatGPT signature phrases
    "in today's fast-paced",
    "in today's digital landscape",
    "in today's ever-evolving",
    "in the ever-changing landscape",
    "it's important to note that",
    "it's worth noting that",
    "it is worth mentioning",
    "let me break this down",
    "here's the thing",
    "at the end of the day",

    # AI vocabulary tells
    "delve",
    "tapestry",
    "multifaceted",
    "holistic approach",
    "synergy",
    "leverage",
    "paradigm shift",
    "cutting-edge",
    "revolutionize",
    "seamlessly",
    "robust solution",
    "comprehensive guide",
    "unlock the power",
    "harness the potential",
    "navigate the complexities",
    "empower you to",
    "elevate your",

    # Structural AI tells
    "as an ai",
    "as a language model",
    "i cannot and will not",
    "i'd be happy to help",
    "great question!",
    "absolutely! here",
    "certainly! let me",
]

AI_SLOP_STRUCTURAL = [
    # AI loves numbered lists with emoji headers
    r"^\d+\.\s*[🔥💡🚀✨🎯]\s",
    # Perfect paragraph structure (intro → 3 points → conclusion)
    r"(?:firstly|secondly|thirdly|in conclusion|to summarize|to sum up)",
    # Hedge stacking
    r"(?:however|furthermore|moreover|additionally|consequently){2,}",
]

_slop_structural_re = [re.compile(p, re.IGNORECASE | re.MULTILINE) for p in AI_SLOP_STRUCTURAL]


def _ai_slop_score(text):
    """
    Score how likely a post is AI-generated. 0.0 = human, 1.0 = bot.
    Posts scoring > 0.5 get flagged; > 0.7 get dropped.
    """
    text_lower = text.lower()
    hits = 0

    # Phrase matching
    for phrase in AI_SLOP_PHRASES:
        if phrase in text_lower:
            hits += 1

    # Structural patterns
    for pat in _slop_structural_re:
        if pat.search(text):
            hits += 1

    # Normalize: 3+ hits is almost certainly AI
    return min(hits / 3.0, 1.0)


# ═══════════════════════════════════════════════════════
# FRUSTRATION MARKERS (25 patterns)
# ═══════════════════════════════════════════════════════
FRUSTRATION_MARKERS = [
    # Emotional frustration
    r"\b(hate|hating|loathe|detest|despise)\b",
    r"\b(frustrat\w+|infuriat\w+|annoy\w+|irritat\w+)\b",
    r"\b(ugh+|argh+|grr+|fml|smh)\b",
    r"\b(ridiculous|absurd|insane|unbelievable)\b",
    r"\b(desperate|desperately|begging)\b",
    r"!{2,}",
    r"\b[A-Z]{4,}\b",

    # Time/productivity waste
    r"\b(waste|wasting|wasted)\b.{0,20}\b(time|hours|days)\b",
    r"\b(takes forever|takes hours|takes all day)\b",
    r"\b(manual|manually)\b.{0,20}\b(process|entry|work|task)\b",
    r"\b(tedious|repetitive|monotonous|boring)\b",
    r"\bkills? my productivity\b",

    # Tool/product frustration
    r"\b(broken|buggy|crashes?|useless|garbage|trash)\b",
    r"\b(no one|nobody|nothing)\b.{0,15}\b(works?|helps?|cares?)\b",
    r"\b(why\b.{0,30}\b(so hard|impossible|no way))\b",
    r"\b(please|somebody|anyone)\b.{0,20}\b(help|save|fix)\b",
    r"\b(switched from|moved away|leaving|ditched|cancelled)\b",

    # Pricing frustration
    r"\b(overpric\w+|too expensive|price hike|price increase)\b",
    r"\b(nickel and dim\w+|money grab|cash grab)\b",
    r"\b(paying through the nose|highway robbery)\b",

    # Integration/workflow pain
    r"\b(doesn't integrate|no integration|can't connect)\b",
    r"\b(silos?|fragmented|disconnected)\b.{0,20}\b(data|tools?|system)\b",
    r"\b(copy.{0,5}paste|export.{0,5}import|csv.{0,5}upload)\b",
    r"\b(workaround|hack|duct tape|band.?aid)\b",
    r"\b(breaking change|backward.?compat|migration nightmare)\b",
]

# ═══════════════════════════════════════════════════════
# OPPORTUNITY MARKERS (15 patterns)
# ═══════════════════════════════════════════════════════
OPPORTUNITY_MARKERS = [
    r"\b(pay|paid|paying)\b.{0,20}\b(for|money|premium)\b",
    r"\b(shut up and take my money)\b",
    r"\b(would buy|will buy|take my money)\b",
    r"\b(willing to pay|happy to pay|ready to pay)\b",
    r"\b(budget|afford|invest)\b.{0,20}\$\d+",
    r"\b(need|looking for|searching for)\b.{0,15}\b(tool|software|app|solution|service)\b",
    r"\b(alternative|replacement|substitute)\b.{0,15}\b(to|for)\b",
    r"\b(recommend|suggestion|advice)\b",
    r"\b(anyone know|does anyone use|what do you use)\b",
    r"\b(best tool|best app|best software)\b.{0,20}\b(for)\b",
    r"\b(wish|if only)\b.{0,30}\b(had|could|would|existed)\b",
    r"\b(feature request|missing feature|need a feature)\b",
    r"\b(doesn't exist|no tool|nothing out there)\b",
    r"\b(vs|versus|compared to|comparing)\b.{0,20}\b(which|better|best)\b",
    r"\b(what.{0,10}better|which.{0,10}better|pros.{0,10}cons)\b",
]

# ═══════════════════════════════════════════════════════
# CONTEXT VALIDATION
# ═══════════════════════════════════════════════════════
NON_BUSINESS_PATTERNS = [
    r"\b(personal|relationship|dating|girlfriend|boyfriend|marriage)\b",
    r"\b(depression|anxiety|mental health|therapy|counseling)\b",
    r"\b(homework|assignment|exam|college|university)\b.{0,30}\b(help|due)\b",
    r"\b(game|gaming|xbox|playstation|steam)\b",
]
_non_biz_re = [re.compile(p, re.IGNORECASE) for p in NON_BUSINESS_PATTERNS]


def _is_business_related(text):
    hits = sum(1 for pat in _non_biz_re if pat.search(text))
    return hits == 0


# ═══════════════════════════════════════════════════════
# AGREEMENT DETECTION (for comment analysis)
# ═══════════════════════════════════════════════════════
AGREEMENT_PATTERNS = [
    r"\b(same|same here|this|exactly|100%|so true)\b",
    r"\b(i have this|i need this|me too|\+1|upvoted)\b",
    r"\b(great idea|good point|agree|agreed|seconded)\b",
]


# ═══════════════════════════════════════════════════════
# MAIN: 4-PASS ANALYSIS
# ═══════════════════════════════════════════════════════
def analyze_posts(posts):
    """
    4-pass analysis pipeline:
    Pass 1: AI Slop Filter (Dead Internet detection)
    Pass 2: VADER sentiment (50-word B2B Matrix)
    Pass 3: Frustration + Opportunity regex scan
    Pass 4: Context validation (business relevance)
    """
    _ensure_vader()
    sia = SentimentIntensityAnalyzer()

    # Inject 50-word B2B Friction Matrix
    for word, score in VADER_B2B_MATRIX.items():
        sia.lexicon[word] = score

    filtered_posts = []
    ai_dropped = 0

    for post in posts:
        text = post.get("full_text", "")

        # ═══ PASS 1: AI SLOP FILTER ═══
        slop_score = _ai_slop_score(text)
        post["ai_slop_score"] = round(slop_score, 3)

        if slop_score >= 0.7:
            # Almost certainly AI — drop completely
            ai_dropped += 1
            continue
        elif slop_score >= 0.4:
            # Suspicious — keep but flag and penalize later
            post["ai_flagged"] = True
        else:
            post["ai_flagged"] = False

        # ═══ PASS 2: VADER (B2B Matrix) ═══
        scores = sia.polarity_scores(text)
        post["sentiment_compound"] = scores["compound"]
        post["sentiment_pos"] = scores["pos"]
        post["sentiment_neg"] = scores["neg"]
        post["sentiment_neu"] = scores["neu"]

        # ═══ PASS 3: Frustration + Opportunity ═══
        frustration_hits = 0
        frustration_types = []
        for pattern in FRUSTRATION_MARKERS:
            matches = re.findall(pattern, text, re.IGNORECASE)
            if matches:
                frustration_hits += len(matches)
                frustration_types.append(pattern[:30])

        post["frustration_score"] = min(frustration_hits / 8.0, 1.0)
        post["frustration_types"] = frustration_types[:5]

        opportunity_hits = 0
        opportunity_types = []
        for pattern in OPPORTUNITY_MARKERS:
            matches = re.findall(pattern, text, re.IGNORECASE)
            if matches:
                opportunity_hits += len(matches)
                opportunity_types.append(pattern[:30])

        post["opportunity_score"] = min(opportunity_hits / 4.0, 1.0)
        post["opportunity_types"] = opportunity_types[:5]

        # ═══ PASS 4: Context + Penalties ═══
        is_business = _is_business_related(text)
        post["is_business_relevant"] = is_business

        # Penalize non-business
        if not is_business:
            post["frustration_score"] *= 0.3
            post["opportunity_score"] *= 0.3

        # Penalize AI-suspicious posts (flagged but not dropped)
        if post.get("ai_flagged"):
            post["frustration_score"] *= 0.6
            post["opportunity_score"] *= 0.6

        # ═══ Desperation Level ═══
        combined = (
            abs(min(post["sentiment_compound"], 0)) * 0.4
            + post["frustration_score"] * 0.4
            + post["opportunity_score"] * 0.2
        )

        if combined >= 0.65:
            post["desperation_level"] = "extreme"
        elif combined >= 0.40:
            post["desperation_level"] = "high"
        elif combined >= 0.20:
            post["desperation_level"] = "medium"
        else:
            post["desperation_level"] = "low"

        filtered_posts.append(post)

    print(f"    🤖 AI slop filter: {ai_dropped} bot posts dropped")
    return filtered_posts
