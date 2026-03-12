"""
RedditPulse — ICP Detector (Ideal Customer Profile)
Aggregates persona data from AI-analyzed posts to build a
composite picture of WHO has the pain and WHAT they'd pay.

From scattered posts → structured customer profile:
  - Primary persona (freelancer? CTO? agency?)
  - Tools they already use (and hate)
  - Budget range
  - Pain intensity distribution
"""

from collections import Counter, defaultdict
from typing import List, Dict, Optional


class ICPReport:
    """Aggregated Ideal Customer Profile from analyzed posts."""

    def __init__(self):
        self.persona_counts = Counter()
        self.persona_details = []
        self.tools_mentioned = Counter()
        self.tools_sentiment = defaultdict(list)  # tool → [positive, negative, ...]
        self.budget_signals = Counter()
        self.budget_evidence = []
        self.pain_intensity = Counter()
        self.total_posts = 0
        self.posts_with_icp = 0

    def add_result(self, result: dict):
        """Add one AI analysis result to the aggregate."""
        self.total_posts += 1
        icp = result.get("icp", {})
        if not icp or not isinstance(icp, dict):
            return

        self.posts_with_icp += 1

        # Persona
        persona = icp.get("persona", "other")
        if persona:
            self.persona_counts[persona] += 1
        detail = icp.get("persona_detail", "")
        if detail and len(detail) > 5:
            self.persona_details.append(detail)

        # Tools
        tools = icp.get("tools_mentioned", [])
        if isinstance(tools, list):
            for tool in tools:
                if isinstance(tool, str) and len(tool) > 1:
                    clean = tool.strip().title()
                    self.tools_mentioned[clean] += 1

        # Tool sentiment
        sentiments = icp.get("tools_sentiment", {})
        if isinstance(sentiments, dict):
            for tool, sent in sentiments.items():
                if isinstance(tool, str) and isinstance(sent, str):
                    self.tools_sentiment[tool.strip().title()].append(sent)

        # Budget
        budget = icp.get("budget_signal", "none")
        if budget:
            self.budget_signals[budget] += 1
        evidence = icp.get("budget_evidence", "")
        if evidence and len(evidence) > 5 and evidence.lower() not in ("none", "n/a", "no evidence"):
            self.budget_evidence.append(evidence)

        # Pain intensity
        pain = icp.get("pain_intensity", "mild")
        if pain:
            self.pain_intensity[pain] += 1

    def get_primary_persona(self) -> str:
        """Most common persona type."""
        if not self.persona_counts:
            return "unknown"
        return self.persona_counts.most_common(1)[0][0]

    def get_persona_breakdown(self) -> List[dict]:
        """Persona distribution with percentages."""
        total = sum(self.persona_counts.values()) or 1
        return [
            {
                "persona": persona,
                "count": count,
                "percent": round(count / total * 100, 1),
            }
            for persona, count in self.persona_counts.most_common(8)
        ]

    def get_top_tools(self, n: int = 10) -> List[dict]:
        """Most mentioned tools with sentiment summary."""
        result = []
        for tool, count in self.tools_mentioned.most_common(n):
            sentiments = self.tools_sentiment.get(tool, [])
            neg = sum(1 for s in sentiments if s in ("negative", "very_negative"))
            pos = sum(1 for s in sentiments if s in ("positive", "very_positive"))
            neu = len(sentiments) - neg - pos

            if neg > pos:
                overall = "negative"
            elif pos > neg:
                overall = "positive"
            else:
                overall = "mixed"

            result.append({
                "tool": tool,
                "mentions": count,
                "sentiment": overall,
                "negative_pct": round(neg / max(len(sentiments), 1) * 100),
            })
        return result

    def get_budget_summary(self) -> dict:
        """Budget signal distribution."""
        total = sum(self.budget_signals.values()) or 1
        return {
            "distribution": {
                k: round(v / total * 100, 1)
                for k, v in self.budget_signals.most_common()
            },
            "primary": self.budget_signals.most_common(1)[0][0] if self.budget_signals else "unknown",
            "evidence_samples": self.budget_evidence[:5],
        }

    def get_pain_summary(self) -> dict:
        """Pain intensity distribution."""
        total = sum(self.pain_intensity.values()) or 1
        return {
            k: round(v / total * 100, 1)
            for k, v in self.pain_intensity.most_common()
        }

    def to_dict(self) -> dict:
        """Full ICP report as dict."""
        return {
            "primary_persona": self.get_primary_persona(),
            "persona_breakdown": self.get_persona_breakdown(),
            "persona_samples": self.persona_details[:5],
            "top_tools": self.get_top_tools(),
            "budget": self.get_budget_summary(),
            "pain_intensity": self.get_pain_summary(),
            "coverage": {
                "total_posts": self.total_posts,
                "posts_with_icp": self.posts_with_icp,
                "icp_rate": round(self.posts_with_icp / max(self.total_posts, 1) * 100, 1),
            },
        }

    def to_prompt_section(self) -> str:
        """Generate a prompt section for AI synthesis."""
        if self.posts_with_icp < 3:
            return ""

        personas = self.get_persona_breakdown()
        tools = self.get_top_tools(5)
        budget = self.get_budget_summary()
        pain = self.get_pain_summary()

        persona_lines = [f"  {p['persona']}: {p['percent']}% ({p['count']} posts)" for p in personas[:5]]
        tool_lines = [f"  {t['tool']}: {t['mentions']} mentions ({t['sentiment']})" for t in tools[:5]]
        budget_lines = [f"  {k}: {v}%" for k, v in budget["distribution"].items()]
        pain_lines = [f"  {k}: {v}%" for k, v in pain.items()]

        sections = [
            "IDEAL CUSTOMER PROFILE (auto-detected from posts):",
            f"Primary persona: {self.get_primary_persona()}",
            "Persona breakdown:",
            *persona_lines,
        ]

        if tool_lines:
            sections.extend(["", "Tools they already use:"] + tool_lines)

        if self.budget_evidence:
            sections.extend([
                "", "Budget signals:", *budget_lines,
                f"  Evidence: {'; '.join(self.budget_evidence[:3])}",
            ])

        if pain_lines:
            sections.extend(["", "Pain intensity:", *pain_lines])

        sections.append("")
        sections.append("IMPORTANT: Use ICP data to make persona-specific recommendations.")
        sections.append("Target the primary persona. Reference tools they hate. Price within their budget range.")

        return "\n".join(sections)


def build_icp(results: List[dict]) -> ICPReport:
    """Build an ICP report from AI analysis results."""
    report = ICPReport()
    for r in results:
        report.add_result(r)
    return report


if __name__ == "__main__":
    # Test with mock data
    mock_results = [
        {
            "is_opportunity": True,
            "icp": {
                "persona": "freelancer",
                "persona_detail": "Solo freelance web developer, 3 years experience",
                "tools_mentioned": ["FreshBooks", "Wave", "QuickBooks"],
                "tools_sentiment": {"FreshBooks": "negative", "Wave": "neutral", "QuickBooks": "negative"},
                "budget_signal": "price_sensitive",
                "budget_evidence": "Can't afford more than $15/month",
                "pain_intensity": "severe",
            },
        },
        {
            "is_opportunity": True,
            "icp": {
                "persona": "freelancer",
                "persona_detail": "Freelance graphic designer, just starting out",
                "tools_mentioned": ["FreshBooks", "Toggl"],
                "tools_sentiment": {"FreshBooks": "negative", "Toggl": "positive"},
                "budget_signal": "price_sensitive",
                "budget_evidence": "$20/month max",
                "pain_intensity": "desperate",
            },
        },
        {
            "is_opportunity": True,
            "icp": {
                "persona": "agency_owner",
                "persona_detail": "Small design agency, 5 employees",
                "tools_mentioned": ["QuickBooks", "Harvest"],
                "tools_sentiment": {"QuickBooks": "negative", "Harvest": "neutral"},
                "budget_signal": "mid_range",
                "budget_evidence": "Paying $50/month for QB, would switch",
                "pain_intensity": "moderate",
            },
        },
    ]

    icp = build_icp(mock_results)
    report = icp.to_dict()

    print(f"Primary persona: {report['primary_persona']}")
    print(f"Personas: {report['persona_breakdown']}")
    print(f"Top tools: {report['top_tools']}")
    print(f"Budget: {report['budget']}")
    print(f"Pain: {report['pain_intensity']}")
    print(f"\nPrompt section:")
    print(icp.to_prompt_section())
