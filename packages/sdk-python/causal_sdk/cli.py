"""
causal CLI — init, session, and ingest commands.

Usage:
    causal init           # Install git post-commit hook
    causal session start  # Manually start a session
    causal session end    # Manually end a session
    causal ingest commit --hash <sha> [--session <id>]
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


GIT_HOOK_SCRIPT = """\
#!/bin/bash
# Causal post-commit hook — auto-installed by `causal init`
# Sends commit metadata to the Causal API for CODE node creation.

COMMIT_HASH=$(git rev-parse HEAD)
SESSION_ID=$(cat .causal-session 2>/dev/null || echo '')
CAUSAL_CLI=$(which causal 2>/dev/null || echo 'python3 -m causal_sdk.cli')

if [ -z "$SESSION_ID" ]; then
  echo '[causal] No active session — commit logged without agent link'
  $CAUSAL_CLI ingest commit --hash "$COMMIT_HASH" --no-session
else
  # Embed session ID in commit notes for future reference
  git notes add -m "causal-session: $SESSION_ID" "$COMMIT_HASH" 2>/dev/null || true
  $CAUSAL_CLI ingest commit --hash "$COMMIT_HASH" --session "$SESSION_ID"
  echo "[causal] Commit $COMMIT_HASH linked to session ${SESSION_ID:0:8}"
fi
"""


def install_git_hook(git_dir: str | None = None) -> bool:
    """Install the post-commit hook in the nearest git repo."""
    if git_dir is None:
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--git-dir"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode != 0:
                print("Error: Not in a git repository.")
                return False
            git_dir = result.stdout.strip()
        except Exception as e:
            print(f"Error: {e}")
            return False

    hook_path = Path(git_dir) / "hooks" / "post-commit"
    hook_path.parent.mkdir(parents=True, exist_ok=True)

    if hook_path.exists():
        existing = hook_path.read_text()
        if "causal" in existing:
            print(f"[causal] Git hook already installed at {hook_path}")
            return True
        # Back up existing hook
        backup = hook_path.with_suffix(".pre-causal")
        hook_path.rename(backup)
        print(f"[causal] Existing hook backed up to {backup}")
        script = GIT_HOOK_SCRIPT + f"\n# Run previous hook\nbash {backup}\n"
    else:
        script = GIT_HOOK_SCRIPT

    hook_path.write_text(script)
    hook_path.chmod(0o755)
    print(f"[causal] ✓ Git hook installed at {hook_path}")
    return True


def cmd_init(args: argparse.Namespace) -> int:
    """causal init — install git hook and validate config."""
    print("Initializing Causal in this repository...")

    if not install_git_hook():
        return 1

    # Check for CAUSAL_API_KEY
    api_key = os.environ.get("CAUSAL_API_KEY")
    if not api_key:
        print("\n⚠️  CAUSAL_API_KEY not set. Add to your shell profile:")
        print("   export CAUSAL_API_KEY=causal_...")
    else:
        print(f"[causal] ✓ API key configured ({api_key[:12]}...)")

    org_id = os.environ.get("CAUSAL_ORG_ID")
    if not org_id:
        print("\n⚠️  CAUSAL_ORG_ID not set. Add to your shell profile:")
        print("   export CAUSAL_ORG_ID=your-org-id")
    else:
        print(f"[causal] ✓ Org ID: {org_id}")

    print("\n[causal] ✓ Ready. Start a Claude Code session to capture provenance.")
    print("[causal]   Or add to CLAUDE.md:")
    print("   [[mcp_servers]]")
    print('   name = "causal"')
    print('   command = "npx"')
    print('   args = ["causal-mcp", "--org", "YOUR_ORG_ID"]')
    return 0


def cmd_ingest_commit(args: argparse.Namespace) -> int:
    """causal ingest commit — send a commit to the Causal API."""
    import asyncio
    import json
    import subprocess

    commit_hash = args.hash
    session_id = getattr(args, "session", None)
    api_key = os.environ.get("CAUSAL_API_KEY", "")
    api_url = os.environ.get("CAUSAL_API_URL", "http://localhost:3001")
    org_id = os.environ.get("CAUSAL_ORG_ID", "default")
    repo_id = os.environ.get("CAUSAL_REPO_ID", "")

    # Get commit details from git
    try:
        log = subprocess.run(
            ["git", "log", "-1", "--format=%an%n%ae%n%at%n%s%n%b", commit_hash],
            capture_output=True, text=True, timeout=5
        )
        lines = log.stdout.strip().split("\n")
        author_name = lines[0] if len(lines) > 0 else ""
        author_email = lines[1] if len(lines) > 1 else ""
        commit_ts = int(lines[2]) * 1000 if len(lines) > 2 else 0
        commit_msg = "\n".join(lines[3:]) if len(lines) > 3 else ""

        diff_stat = subprocess.run(
            ["git", "diff", "--stat", f"{commit_hash}^", commit_hash],
            capture_output=True, text=True, timeout=5
        )

        files_changed = subprocess.run(
            ["git", "diff", "--name-only", f"{commit_hash}^", commit_hash],
            capture_output=True, text=True, timeout=5
        )

        repo_name = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=5
        )
        repo_full = repo_name.stdout.strip().replace(".git", "").split("github.com/")[-1] if repo_name.returncode == 0 else repo_id

        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=5
        )
    except Exception as e:
        print(f"[causal] Warning: Could not get commit details: {e}")
        return 0  # Non-fatal

    payload = {
        "layer": "CODE",
        "kind": "git_commit",
        "timestamp": commit_ts or __import__("time").time_ns() // 1_000_000,
        "agentId": None,
        "modelVersion": None,
        "sessionId": session_id,
        "contextSnapId": None,
        "payload": {
            "commitHash": commit_hash,
            "commitMessage": commit_msg,
            "authorName": author_name,
            "authorEmail": author_email,
            "branch": branch.stdout.strip() if branch.returncode == 0 else "unknown",
            "repoFullName": repo_full,
            "filesChanged": files_changed.stdout.strip().split("\n") if files_changed.returncode == 0 else [],
            "causalSessionTrailer": session_id,
        },
        "orgId": org_id,
        "repoId": repo_full or repo_id,
    }

    try:
        import urllib.request
        req = urllib.request.Request(
            f"{api_url}/api/v1/nodes",
            data=json.dumps(payload).encode(),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read())
            print(f"[causal] ✓ Commit {commit_hash[:8]} ingested → node {result.get('id', '?')[:8]}")
    except Exception as e:
        print(f"[causal] Warning: Failed to ingest commit: {e}")
        # Non-fatal — never block git operations

    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="causal",
        description="Causal CLI — manage Causal provenance capture",
    )
    subparsers = parser.add_subparsers(dest="command")

    # causal init
    init_parser = subparsers.add_parser("init", help="Install git hook and validate config")
    init_parser.set_defaults(func=cmd_init)

    # causal ingest
    ingest_parser = subparsers.add_parser("ingest", help="Ingest artifacts manually")
    ingest_sub = ingest_parser.add_subparsers(dest="artifact")

    commit_parser = ingest_sub.add_parser("commit", help="Ingest a git commit")
    commit_parser.add_argument("--hash", required=True, help="Git commit hash")
    commit_parser.add_argument("--session", default=None, help="Session ID to link")
    commit_parser.add_argument("--no-session", action="store_true")
    commit_parser.set_defaults(func=cmd_ingest_commit)

    args = parser.parse_args()

    if not hasattr(args, "func"):
        parser.print_help()
        sys.exit(1)

    sys.exit(args.func(args) or 0)


if __name__ == "__main__":
    main()
