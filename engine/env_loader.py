"""
Minimal .env loader for Python entrypoints.

We keep this local instead of relying on python-dotenv so scraper/test
scripts behave the same on fresh machines.
"""

from __future__ import annotations

from pathlib import Path


def _parse_env_line(line: str):
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return None, None
    key, value = stripped.split("=", 1)
    key = key.strip()
    value = value.strip().strip('"').strip("'")
    return key, value


def load_local_env(repo_root: str | Path):
    root = Path(repo_root).resolve()
    candidates = [
        root / ".env.local",
        root / ".env",
        root / "app" / ".env.local",
        root / "app" / ".env",
    ]

    import os

    loaded = []
    for path in candidates:
        if not path.exists():
            continue
        try:
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                key, value = _parse_env_line(line)
                if not key:
                    continue
                os.environ.setdefault(key, value)
            loaded.append(str(path))
        except Exception:
            continue
    return loaded
