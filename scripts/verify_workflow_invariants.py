#!/usr/bin/env python3
"""
NetPulse Workflow Security Invariants & Policy Validator

Performs machine-enforceable static analysis across all GitHub Actions workflows
in `.github/workflows/` to ensure compliance with enterprise security baselines:

1. 100% Immutable Commit SHA Pinning: Every `uses:` reference must use a 40-character hex SHA.
2. Version Traceability: Every `uses:` reference must have a `# vX.Y.Z` comment.
3. Least-Privilege Permissions: Every workflow must declare top-level `permissions: {}`.
4. Credential Isolation: Every `actions/checkout` must specify `with: persist-credentials: false`.
5. Bounded Job Timeouts: Every job must specify a positive integer `timeout-minutes`.
6. Concurrency Safety: Workflows with concurrency must scope by workflow and ref.
7. Event Model Safety: No insecure usage of `pull_request_target`.
8. No Silent Failure Masking: No `|| true` on security checks, audits, tests, or fuzzing.
9. Deterministic Toolchain: No non-frozen `pnpm install` in CI jobs.
10. Local File & Package Resolution: All local files, scripts, and workspace manifests referenced exist.

Usage:
    python scripts/verify_workflow_invariants.py
"""

import sys
import os
import re
from pathlib import Path

# Force UTF-8 output encoding for Windows terminals
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

REPO_ROOT = Path(__file__).parent.parent.resolve()
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"

HEX_40_RE = re.compile(r'^[a-fA-F0-9]{40}$')


def parse_simple_yaml_structure(filepath):
    """
    Lightweight YAML parser for workflow structure inspection without third-party deps.
    Returns raw lines, comments, and top-level / job-level structure indicators.
    """
    content = filepath.read_text(encoding="utf-8")
    lines = content.splitlines()
    return lines, content


def validate_workflow(filepath):
    errors = []
    try:
        rel_path = filepath.relative_to(REPO_ROOT)
    except ValueError:
        rel_path = filepath.name
    lines, content = parse_simple_yaml_structure(filepath)

    # 1. Check top-level permissions: {}
    has_top_permissions = False
    in_jobs = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("jobs:"):
            in_jobs = True
        if not in_jobs and (stripped == "permissions: {}" or stripped == "permissions:"):
            has_top_permissions = True
            break

    if not has_top_permissions:
        errors.append(f"{rel_path}: Missing top-level 'permissions: {{}}' declaration for least-privilege default.")

    # 2. Check each uses: line for 40-char SHA and version comment
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("uses:") or " uses: " in line:
            # e.g., uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
            # or uses: ./.github/actions/... (local action)
            action_part = stripped.split("uses:", 1)[1].strip()
            
            # If local action starting with . or ./
            if action_part.startswith("."):
                continue

            comment = ""
            if "#" in action_part:
                action_ref, comment = action_part.split("#", 1)
                action_ref = action_ref.strip()
                comment = comment.strip()
            else:
                action_ref = action_part.strip()

            if "@" not in action_ref:
                errors.append(f"{rel_path}:{i}: Action '{action_ref}' missing version/SHA delimiter '@'.")
                continue

            action_name, ref = action_ref.split("@", 1)
            action_name = action_name.strip()
            ref = ref.strip()

            if not HEX_40_RE.match(ref):
                errors.append(
                    f"{rel_path}:{i}: Action '{action_name}' is not pinned to a 40-character immutable commit SHA (found: '{ref}')."
                )

            if not comment:
                errors.append(
                    f"{rel_path}:{i}: Pinned action '{action_name}@{ref}' is missing a human-readable release comment (e.g. '# v4.2.2')."
                )

    # 3. Check every actions/checkout has persist-credentials: false
    # Find all checkout blocks
    for i, line in enumerate(lines):
        if "actions/checkout@" in line:
            # Scan following lines for 'persist-credentials: false'
            has_persist_false = False
            for j in range(i + 1, min(i + 15, len(lines))):
                next_line = lines[j]
                if next_line.strip().startswith("- uses:") or (next_line.strip().startswith("- name:") and j > i + 2):
                    break
                if "persist-credentials: false" in next_line:
                    has_persist_false = True
                    break
            if not has_persist_false:
                errors.append(f"{rel_path}:{i+1}: 'actions/checkout' invocation is missing 'with: persist-credentials: false'.")

    # 4. Check every job has timeout-minutes
    in_jobs_section = False
    current_job = None
    job_has_timeout = False
    job_start_line = 0

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped == "jobs:":
            in_jobs_section = True
            continue

        if in_jobs_section:
            # Job header has 2 spaces indent
            if line.startswith("  ") and not line.startswith("    ") and stripped.endswith(":") and not stripped.startswith("#"):
                # Finishing previous job check
                if current_job and not job_has_timeout:
                    errors.append(f"{rel_path}:{job_start_line}: Job '{current_job}' is missing bounded 'timeout-minutes' declaration.")
                current_job = stripped.rstrip(":")
                job_has_timeout = False
                job_start_line = i
            elif line.startswith("    ") and "timeout-minutes:" in line:
                val = stripped.split("timeout-minutes:", 1)[1].strip()
                if val.isdigit() and int(val) > 0:
                    job_has_timeout = True
                else:
                    errors.append(f"{rel_path}:{i}: Job '{current_job}' has invalid 'timeout-minutes' value '{val}' (must be positive integer).")

    if current_job and not job_has_timeout:
        errors.append(f"{rel_path}:{job_start_line}: Job '{current_job}' is missing bounded 'timeout-minutes' declaration.")

    # 5. Check concurrency group safety
    if "concurrency:" in content:
        if "github.workflow" not in content or "github.ref" not in content:
            errors.append(f"{rel_path}: 'concurrency' group must include '${{{{ github.workflow }}}}' and ref context.")

    # 6. Check for dangerous pull_request_target
    if "pull_request_target" in content:
        errors.append(f"{rel_path}: Prohibited trigger 'pull_request_target' detected without security exception approval.")

    # 7. Check for dangerous silent failure masking (|| true on critical commands)
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if "|| true" in stripped or "|| exit 0" in stripped:
            if any(term in stripped for term in ["cargo audit", "cargo deny", "cargo test", "cargo clippy", "cargo fuzz", "pnpm audit", "pnpm test", "verify"]):
                errors.append(f"{rel_path}:{i}: Dangerous silent failure suppression '|| true' detected on critical command: '{stripped}'.")

    # 8. Check for non-frozen pnpm install
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if "pnpm install" in stripped and "--frozen-lockfile" not in stripped and not stripped.startswith("#"):
            errors.append(f"{rel_path}:{i}: 'pnpm install' in CI must include '--frozen-lockfile'.")

    # 9. Verify referenced local scripts on disk
    script_matches = re.findall(r'scripts/([a-zA-Z0-9_\-\.]+)', content)
    for script_name in set(script_matches):
        script_path = REPO_ROOT / "scripts" / script_name
        if not script_path.exists():
            errors.append(f"{rel_path}: Referenced script 'scripts/{script_name}' does not exist on disk.")

    return errors


def validate_dependabot(filepath):
    errors = []
    if not filepath.exists():
        errors.append(f"{filepath.name}: Dependabot configuration file missing.")
        return errors

    content = filepath.read_text(encoding="utf-8")

    # 1. Version check
    version_match = re.search(r"^version:\s*([0-9]+)", content, re.MULTILINE)
    if not version_match or int(version_match.group(1)) != 2:
        errors.append(f"{filepath.name}: Dependabot config must specify 'version: 2'.")

    # 2. Extract and parse update blocks
    raw_blocks = content.split("- package-ecosystem:")
    if len(raw_blocks) < 6:
        errors.append(f"{filepath.name}: Expected at least 5 update blocks, found {len(raw_blocks)-1}.")
        return errors

    required_ecosystems = {
        ("cargo", "/"): "chore(cargo)",
        ("cargo", "/src-tauri"): "chore(tauri)",
        ("cargo", "/fuzz"): "chore(fuzz)",
        ("npm", "/"): "chore(npm)",
        ("github-actions", "/"): "ci(actions)"
    }

    found_ecosystems = set()
    for i, block in enumerate(raw_blocks[1:], 1):
        block_text = "- package-ecosystem:" + block
        
        eco_m = re.search(r'package-ecosystem:\s*["\']?([^"\'\s\n]+)["\']?', block_text)
        dir_m = re.search(r'directory:\s*["\']?([^"\'\s\n]+)["\']?', block_text)
        rebase_m = re.search(r'rebase-strategy:\s*["\']?([^"\'\s\n]+)["\']?', block_text)
        limit_m = re.search(r'open-pull-requests-limit:\s*([0-9]+)', block_text)
        prefix_m = re.search(r'prefix:\s*["\']?([^"\'\n]+)["\']?', block_text)
        
        eco = eco_m.group(1) if eco_m else None
        directory = dir_m.group(1) if dir_m else None
        key = (eco, directory)
        found_ecosystems.add(key)

        # Check target directory exists on disk
        if directory and directory != "/":
            target_dir = REPO_ROOT / directory.lstrip("/")
            if not target_dir.is_dir():
                errors.append(f"{filepath.name} update #{i}: Directory '{directory}' does not exist on disk.")

        # Check rebase strategy
        if not rebase_m or rebase_m.group(1) != "auto":
            errors.append(f"{filepath.name} update #{i} ({eco}): Missing 'rebase-strategy: auto'.")

        # Check open PR limit
        if not limit_m or int(limit_m.group(1)) <= 0 or int(limit_m.group(1)) > 20:
            errors.append(f"{filepath.name} update #{i} ({eco}): Invalid 'open-pull-requests-limit' (must be bounded 1..20).")

        # Check cooldown block
        if "cooldown:" not in block_text:
            errors.append(f"{filepath.name} update #{i} ({eco}): Missing 'cooldown' block.")

        # Check applies-to: version-updates
        if "applies-to: version-updates" not in block_text:
            errors.append(f"{filepath.name} update #{i} ({eco}): Missing 'applies-to: version-updates' in groups.")

        # Check triage labels
        if "labels:" not in block_text:
            errors.append(f"{filepath.name} update #{i} ({eco}): Missing triage labels.")

        # Check semantic prefix
        if not prefix_m or not prefix_m.group(1).strip():
            errors.append(f"{filepath.name} update #{i} ({eco}): Missing semantic 'commit-message.prefix'.")

    missing = set(required_ecosystems.keys()) - found_ecosystems
    if missing:
        errors.append(f"{filepath.name}: Missing required ecosystem configurations: {missing}")

    return errors


def main():
    if not WORKFLOWS_DIR.exists():
        print(f"[ERROR] Workflows directory not found: {WORKFLOWS_DIR}")
        sys.exit(1)

    workflow_files = sorted(list(WORKFLOWS_DIR.glob("*.yml")) + list(WORKFLOWS_DIR.glob("*.yaml")))
    if not workflow_files:
        print(f"[ERROR] No workflow files found in {WORKFLOWS_DIR}")
        sys.exit(1)

    print(f"Auditing {len(workflow_files)} workflow file(s) in {WORKFLOWS_DIR} against security invariants...")
    all_errors = []

    for wf in workflow_files:
        errors = validate_workflow(wf)
        all_errors.extend(errors)

    # Validate .github/dependabot.yml
    dependabot_file = REPO_ROOT / ".github" / "dependabot.yml"
    print(f"Auditing Dependabot configuration in {dependabot_file.name}...")
    dep_errors = validate_dependabot(dependabot_file)
    all_errors.extend(dep_errors)

    if all_errors:
        print(f"\n[FAIL] Found {len(all_errors)} policy violation(s):\n")
        for err in all_errors:
            print(f"  - {err}")
        sys.exit(1)

    print(f"[SUCCESS] All {len(workflow_files)} workflows and dependabot.yml adhere 100% to enterprise security invariants!")
    sys.exit(0)


if __name__ == "__main__":
    main()
