"""
Rebrand BCProxyAI → SML Gateway
Runs only against tracked source files — NOT node_modules, .next, .git, worktrees
"""
import os
import re
from pathlib import Path

ROOT = Path("d:/test01/hrai")
EXCLUDE_DIRS = {
    "node_modules", ".next", ".git", "dist",
    ".claude", "data", "coverage",
}
# File extensions to process
INCLUDE_EXT = {
    ".ts", ".tsx", ".js", ".jsx",
    ".md", ".json", ".yml", ".yaml",
    ".Caddyfile", ".env", ".example",
}
# Files to explicitly skip
SKIP_FILES = {
    "package-lock.json",  # don't touch lockfile
}

# Substitutions in order — keep backward-compat for model prefix
# (bcproxy/auto still works alongside sml/auto)
SUBSTITUTIONS = [
    # 1. Class/constant identifiers (case-sensitive)
    (r"\bBCProxyAI\b", "SMLGateway"),
    (r"\bBCProxyAi\b", "SMLGateway"),
    (r"\bBCProxy\b", "SMLGateway"),

    # 2. Headers that clients see (HTTP headers use X-BCProxy-*)
    (r"X-BCProxy-", "X-SML-"),

    # 3. User-facing names in comments/docs — keep Thai untouched, English only
    (r"BCProxyAI", "SML Gateway"),
    (r"BCProxyAi", "SML Gateway"),

    # 4. npm package name
    (r'"name": "bcproxyai"', '"name": "sml-gateway"'),

    # 5. Docker container / network references
    # Note: docker-compose service names stay "bcproxyai" temporarily
    # to avoid breaking running containers — can rename later

    # 6. Lowercase all-letter references (careful — avoid URLs/paths)
    # Match whole-word bcproxyai only
    (r"\bbcproxyai\b", "sml-gateway"),
]

def should_process(path: Path) -> bool:
    # Skip excluded dirs
    for part in path.parts:
        if part in EXCLUDE_DIRS:
            return False
    if path.name in SKIP_FILES:
        return False
    # Check extension
    if path.suffix in INCLUDE_EXT or path.name in INCLUDE_EXT:
        return True
    # Special files without extension (Dockerfile, Caddyfile)
    if path.name in ("Dockerfile", "Caddyfile"):
        return True
    return False

def rebrand_file(path: Path) -> int:
    try:
        content = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, PermissionError):
        return 0
    original = content
    for pattern, replacement in SUBSTITUTIONS:
        content = re.sub(pattern, replacement, content)
    if content != original:
        path.write_text(content, encoding="utf-8")
        # Count changes
        changes = sum(1 for _ in re.finditer(
            "|".join(p for p, _ in SUBSTITUTIONS), original
        ))
        return changes
    return 0

def main() -> None:
    total_files = 0
    total_changes = 0
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if not should_process(path):
            continue
        changes = rebrand_file(path)
        if changes > 0:
            rel = path.relative_to(ROOT)
            print(f"  {rel}: {changes} changes")
            total_files += 1
            total_changes += changes
    print(f"\n✅ Rebranded {total_files} files, {total_changes} substitutions")

if __name__ == "__main__":
    main()
