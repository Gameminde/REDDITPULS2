"""
RedditPulse — Report Generator (Safe CLI wrapper)
Called by the API route with --config-file for safe data passing.
Replaces the old inline Python execution which was an RCE vulnerability.
"""

import sys
import os
import json
import argparse

# Add engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "engine"))

from report_synthesizer import ReportSynthesizer


def generate_report(config_path: str):
    """Generate a report from a JSON config file."""
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    scan = config.get("scan", {})
    results = config.get("results", [])
    posts = config.get("posts", [])
    user_id = config.get("user_id", "")

    # Use multi-brain with user config if available
    synth = ReportSynthesizer(user_id=user_id)
    report = synth.generate_report(scan, results, posts)

    if report:
        print(json.dumps(report))
    else:
        print(json.dumps({"error": "Report generation failed"}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate an AI report from scan data")
    parser.add_argument("--config-file", required=True, help="Path to JSON config file")
    args = parser.parse_args()
    generate_report(args.config_file)
