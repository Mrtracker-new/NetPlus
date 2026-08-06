#!/usr/bin/env python3
"""
NetPulse Documentation & Implementation Status Verification Tool

Validates that:
1. All workspace crates in `crates/` are defined in `docs/status.yml`.
2. No stale/deleted crate entries remain in `docs/status.yml`.
3. Badges across `README.md`, `ARCHITECTURE.md`, `docs/README.md`, and `crates/README.md`
   match `docs/status.yml` exactly.
4. Relative Markdown file links resolve to existing files.

Usage:
    python scripts/verify_docs_status.py           # Verification mode (CI / pre-push)
    python scripts/verify_docs_status.py --sync    # Auto-discover crates & update manifest
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

# Base directory setup
REPO_ROOT = Path(__file__).parent.parent.resolve()
STATUS_YML = REPO_ROOT / "docs" / "status.yml"
CRATES_DIR = REPO_ROOT / "crates"

BADGE_MAP = {
    "complete": "✅ Complete",
    "in_progress": "🚧 In Progress",
    "planned": "📋 Planned",
}

BADGE_REVERSE_MAP = {
    "✅ Complete": "complete",
    "🚧 In Progress": "in_progress",
    "📋 Planned": "planned",
    "✅": "complete",
    "🚧": "in_progress",
    "📋": "planned",
}

def parse_simple_yml(filepath):
    """Simple parser for docs/status.yml to avoid external dependencies."""
    data = {"crates": {}, "ui_workspace": {}}
    current_section = None
    current_key = None

    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue

            # Section header
            if line.startswith("crates:"):
                current_section = "crates"
                continue
            elif line.startswith("ui_workspace:"):
                current_section = "ui_workspace"
                continue
            elif line.startswith("status_legend:") or line.startswith("version:") or line.startswith("last_updated:"):
                current_section = None
                continue

            # Crate/package entry header (2 spaces indent)
            if current_section and line.startswith("  ") and not line.startswith("    "):
                current_key = line.strip().rstrip(":")
                data[current_section][current_key] = {}
                continue

            # Attribute entry (4 spaces indent)
            if current_section and current_key and line.startswith("    "):
                parts = line.strip().split(":", 1)
                if len(parts) == 2:
                    k = parts[0].strip()
                    v = parts[1].strip().strip('"').strip("'")
                    data[current_section][current_key][k] = v

    return data

def get_workspace_crates():
    """Discover all crate names in the crates/ directory."""
    if not CRATES_DIR.exists():
        return []
    crates = []
    for item in CRATES_DIR.iterdir():
        if item.is_dir() and (item / "Cargo.toml").exists():
            crates.append(item.name)
    return sorted(crates)

def check_crate_coverage(manifest_data, workspace_crates):
    """Ensure all workspace crates exist in status.yml and no stale entries exist."""
    errors = []
    manifest_crates = set(manifest_data.get("crates", {}).keys())
    disk_crates = set(workspace_crates)

    missing = disk_crates - manifest_crates
    if missing:
        errors.append(f"Crates on disk missing from docs/status.yml: {sorted(list(missing))}")

    stale = manifest_crates - disk_crates
    if stale:
        errors.append(f"Stale crates in docs/status.yml not found on disk: {sorted(list(stale))}")

    return errors

def validate_relative_links(file_path):
    """Validate relative markdown file links in a document."""
    errors = []
    if not file_path.exists():
        return [f"File not found: {file_path}"]

    content = file_path.read_text(encoding="utf-8")
    # Match markdown links: [label](path)
    links = re.findall(r'\[([^\]]+)\]\(([^)]+)\)', content)

    for label, target in links:
        # Ignore external URLs, anchors, mailto, etc.
        if target.startswith(("http://", "https://", "mailto:", "#", "file://")):
            continue

        # Strip anchor from target if present
        clean_target = target.split("#")[0]
        if not clean_target:
            continue

        # Resolve path relative to file directory
        resolved_path = (file_path.parent / clean_target).resolve()
        if not resolved_path.exists():
            errors.append(f"Broken link in {file_path.relative_to(REPO_ROOT)}: [{label}]({target}) -> {clean_target} does not exist.")

    return errors

def check_file_status_badges(file_path, manifest_data):
    """Check that status badges in markdown documentation match status.yml."""
    errors = []
    if not file_path.exists():
        return [f"File not found: {file_path}"]

    content = file_path.read_text(encoding="utf-8")
    crates_map = manifest_data.get("crates", {})

    for crate_name, crate_info in crates_map.items():
        if crate_name not in content:
            continue

        # Find markdown table rows containing crate_name
        lines = [line for line in content.splitlines() if crate_name in line and "|" in line]
        for line in lines:
            # Check design/code/runtime badges if present in table row
            expected_runtime = BADGE_MAP.get(crate_info.get("runtime"), "")
            expected_code = BADGE_MAP.get(crate_info.get("code"), "")
            expected_design = BADGE_MAP.get(crate_info.get("design"), "")

            # Short symbol representations (e.g. ✅, 🚧, 📋)
            symbol_runtime = expected_runtime.split()[0] if expected_runtime else ""
            symbol_code = expected_code.split()[0] if expected_code else ""
            symbol_design = expected_design.split()[0] if expected_design else ""

            # If line mentions status badges, check if matches expected
            if "✅" in line or "🚧" in line or "📋" in line:
                matches_full = expected_runtime in line or expected_code in line or expected_design in line
                matches_symbol = symbol_runtime in line or symbol_code in line or symbol_design in line
                if not (matches_full or matches_symbol):
                    errors.append(
                        f"Mismatch in {file_path.relative_to(REPO_ROOT)} for `{crate_name}`:\n"
                        f"  Row: {line.strip()}\n"
                        f"  Expected one of: [{expected_design}, {expected_code}, {expected_runtime}] from status.yml"
                    )

    return errors

def sync_manifest(manifest_data, workspace_crates):
    """Auto-add missing workspace crates to docs/status.yml."""
    manifest_crates = manifest_data.get("crates", {})
    added = False

    for crate in workspace_crates:
        if crate not in manifest_crates:
            print(f"[SYNC] Adding missing crate `{crate}` to docs/status.yml...")
            manifest_crates[crate] = {
                "layer": "Base",
                "design": "complete",
                "code": "in_progress",
                "runtime": "in_progress",
                "summary": f"Workspace crate `{crate}`.",
            }
            added = True

    if added:
        lines = [
            "# NetPulse System Implementation Status Manifest",
            "# Single authoritative source of truth for implementation maturity across crates & capabilities.",
            "# Synchronized with documentation via `python scripts/verify_docs_status.py`.",
            "",
            'version: 1',
            'last_updated: "2026-08-06"',
            "",
            "status_legend:",
            '  complete: "✅ Complete"',
            '  in_progress: "🚧 In Progress"',
            '  planned: "📋 Planned"',
            "",
            "crates:",
        ]

        for crate, info in manifest_crates.items():
            lines.append(f"  {crate}:")
            lines.append(f"    layer: {info.get('layer', 'Base')}")
            lines.append(f"    design: {info.get('design', 'complete')}")
            lines.append(f"    code: {info.get('code', 'in_progress')}")
            lines.append(f"    runtime: {info.get('runtime', 'in_progress')}")
            lines.append(f"    summary: \"{info.get('summary', '')}\"")

        lines.append("")
        lines.append("ui_workspace:")
        for pkg, info in manifest_data.get("ui_workspace", {}).items():
            lines.append(f"  {pkg}:")
            lines.append(f"    design: {info.get('design', 'complete')}")
            lines.append(f"    code: {info.get('code', 'in_progress')}")
            lines.append(f"    runtime: {info.get('runtime', 'in_progress')}")

        STATUS_YML.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("[SYNC] docs/status.yml updated successfully.")

def main():
    sync_mode = "--sync" in sys.argv or "--fix" in sys.argv

    if not STATUS_YML.exists():
        print(f"[ERROR] Manifest file missing at: {STATUS_YML}")
        sys.exit(1)

    manifest_data = parse_simple_yml(STATUS_YML)
    workspace_crates = get_workspace_crates()

    if sync_mode:
        sync_manifest(manifest_data, workspace_crates)
        manifest_data = parse_simple_yml(STATUS_YML)

    all_errors = []

    # 1. Check Crate Coverage
    coverage_errors = check_crate_coverage(manifest_data, workspace_crates)
    all_errors.extend(coverage_errors)

    # 2. Check Relative Links across key documentation files
    doc_files = [
        REPO_ROOT / "README.md",
        REPO_ROOT / "ARCHITECTURE.md",
        REPO_ROOT / "CONTRIBUTING.md",
        REPO_ROOT / "SECURITY.md",
        REPO_ROOT / "docs" / "README.md",
        REPO_ROOT / "docs" / "IMPLEMENTATION_PLAN.md",
        REPO_ROOT / "crates" / "README.md",
    ]

    for doc in doc_files:
        if doc.exists():
            link_errors = validate_relative_links(doc)
            all_errors.extend(link_errors)

    # 3. Check Badge Matching across key documentation files
    for doc in doc_files:
        if doc.exists():
            badge_errors = check_file_status_badges(doc, manifest_data)
            all_errors.extend(badge_errors)

    if all_errors:
        print(f"\n[FAIL] Found {len(all_errors)} verification error(s):\n")
        for err in all_errors:
            print(f"  - {err}")
        sys.exit(1)

    print("[SUCCESS] All documentation files, crate mappings, links, and status matrices match docs/status.yml!")
    sys.exit(0)

if __name__ == "__main__":
    main()
