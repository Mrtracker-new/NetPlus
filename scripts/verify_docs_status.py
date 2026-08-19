#!/usr/bin/env python3
"""
NetPulse Documentation & Implementation Status Verification Tool

Validates that:
1. All workspace crates in `crates/` are defined in `docs/status.yml`.
2. No stale/deleted crate entries remain in `docs/status.yml`.
3. Badges across `README.md`, `ARCHITECTURE.md`, `docs/README.md`, and `crates/README.md`
   match `docs/status.yml` column-by-column (Design, Code, Runtime) with zero drift.
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

STATUS_SYMBOLS = {"✅": "complete", "🚧": "in_progress", "📋": "planned"}


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
            elif (
                line.startswith("status_legend:")
                or line.startswith("version:")
                or line.startswith("last_updated:")
            ):
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
    links = re.findall(r'\[([^\]]+)\]\(([^)]+)\)', content)

    for label, target in links:
        if target.startswith(("http://", "https://", "mailto:", "#", "file://")):
            continue

        clean_target = target.split("#")[0]
        if not clean_target:
            continue

        resolved_path = (file_path.parent / clean_target).resolve()
        if not resolved_path.exists():
            errors.append(
                f"Broken link in {file_path.relative_to(REPO_ROOT)}: [{label}]({target}) -> {clean_target} does not exist."
            )

    return errors


def normalize_status(cell_text):
    """Extract normalized status ('complete', 'in_progress', 'planned') from a cell."""
    text = cell_text.strip()
    for symbol, st in STATUS_SYMBOLS.items():
        if symbol in text:
            return st
    lower = text.lower()
    if "complete" in lower:
        return "complete"
    elif "progress" in lower or "in progress" in lower:
        return "in_progress"
    elif "planned" in lower:
        return "planned"
    return None


def parse_markdown_tables(content):
    """Parse all markdown tables in content into structured dictionaries."""
    tables = []
    lines = content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("|") and line.endswith("|"):
            # Potential table header
            headers = [c.strip() for c in line.strip("|").split("|")]
            if i + 1 < len(lines):
                sep_line = lines[i + 1].strip()
                if sep_line.startswith("|") and ("---" in sep_line or ":---" in sep_line):
                    # Confirmed table
                    rows = []
                    j = i + 2
                    while j < len(lines) and lines[j].strip().startswith("|"):
                        row_cells = [c.strip() for c in lines[j].strip().split("|")[1:-1]]
                        rows.append(row_cells)
                        j += 1
                    tables.append({"headers": headers, "rows": rows, "line_num": i + 1})
                    i = j
                    continue
        i += 1
    return tables


def check_file_status_badges(file_path, manifest_data):
    """Perform strict, column-by-column validation of status tables against status.yml."""
    errors = []
    if not file_path.exists():
        return [f"File not found: {file_path}"]

    content = file_path.read_text(encoding="utf-8")
    crates_map = manifest_data.get("crates", {})
    tables = parse_markdown_tables(content)

    for table in tables:
        headers = [h.lower() for h in table["headers"]]

        # Find column indices
        design_idx = next((idx for idx, h in enumerate(headers) if "design" in h), None)
        code_idx = next((idx for idx, h in enumerate(headers) if "code" in h), None)
        runtime_idx = next((idx for idx, h in enumerate(headers) if "runtime" in h), None)

        if design_idx is None and code_idx is None and runtime_idx is None:
            continue

        is_capability_table = any("capability" in h for h in headers)
        crate_idx = next(
            (idx for idx, h in enumerate(headers) if "crate" in h or "package" in h or "name" in h),
            0,
        )

        for row in table["rows"]:
            if len(row) <= max(filter(None, [design_idx, code_idx, runtime_idx, crate_idx])):
                continue

            first_cell = row[0]
            row_text = " | ".join(row)

            if is_capability_table:
                # In capability tables (e.g. in README.md), extract crates and UI packages listed in the row
                crates_in_row = []
                for c in sorted(crates_map.keys(), key=len, reverse=True):
                    if c in row_text:
                        crates_in_row.append(c)

                ui_pkgs_in_row = []
                ui_map = manifest_data.get("ui_workspace", {})
                if "ui/" in row_text:
                    ui_pkgs_in_row = list(ui_map.keys())
                else:
                    for pkg in ui_map:
                        pkg_dash = pkg.replace("_", "-")
                        if (
                            f"@netpulse/{pkg}" in row_text
                            or f"@netpulse/{pkg_dash}" in row_text
                            or f"ui/{pkg}" in row_text
                            or f"ui/packages/{pkg}" in row_text
                            or f"ui/packages/{pkg_dash}" in row_text
                        ):
                            ui_pkgs_in_row.append(pkg)

                if not crates_in_row and not ui_pkgs_in_row:
                    continue

                # Aggregate status: complete only if all constituent crates and UI packages are complete
                all_design_complete = all(
                    crates_map[c].get("design") == "complete" for c in crates_in_row
                ) and all(ui_map[p].get("design") == "complete" for p in ui_pkgs_in_row)

                all_code_complete = all(
                    crates_map[c].get("code") == "complete" for c in crates_in_row
                ) and all(ui_map[p].get("code") == "complete" for p in ui_pkgs_in_row)

                all_runtime_complete = all(
                    crates_map[c].get("runtime") == "complete" for c in crates_in_row
                ) and all(ui_map[p].get("runtime") == "complete" for p in ui_pkgs_in_row)

                expected_design = "complete" if all_design_complete else "in_progress"
                expected_code = "complete" if all_code_complete else "in_progress"
                expected_runtime = "complete" if all_runtime_complete else "in_progress"

                cap_name = row[0].replace("*", "").strip()

                if design_idx is not None:
                    actual = normalize_status(row[design_idx])
                    if actual != expected_design:
                        errors.append(
                            f"Mismatch in {file_path.relative_to(REPO_ROOT)} for capability '{cap_name}' (Design column):\n"
                            f"  Found: '{row[design_idx]}' (normalized: {actual})\n"
                            f"  Expected: '{BADGE_MAP[expected_design]}'"
                        )

                if code_idx is not None:
                    actual = normalize_status(row[code_idx])
                    if actual != expected_code:
                        errors.append(
                            f"Mismatch in {file_path.relative_to(REPO_ROOT)} for capability '{cap_name}' (Code column):\n"
                            f"  Found: '{row[code_idx]}' (normalized: {actual})\n"
                            f"  Expected: '{BADGE_MAP[expected_code]}'"
                        )

                if runtime_idx is not None:
                    actual = normalize_status(row[runtime_idx])
                    if actual != expected_runtime:
                        errors.append(
                            f"Mismatch in {file_path.relative_to(REPO_ROOT)} for capability '{cap_name}' (Runtime column):\n"
                            f"  Found: '{row[runtime_idx]}' (normalized: {actual})\n"
                            f"  Expected: '{BADGE_MAP[expected_runtime]}'"
                        )

            else:
                # Crate-level table (ARCHITECTURE.md, crates/README.md)
                matched_crate = None
                for c in sorted(crates_map.keys(), key=len, reverse=True):
                    # Exact boundary matching: [`crate-name`]( or `crate-name` or /crate-name/
                    pattern = r'[`/\[]' + re.escape(c) + r'[`/\]\)]'
                    if re.search(pattern, first_cell) or first_cell.strip() == c:
                        matched_crate = c
                        break

                if not matched_crate:
                    continue

                info = crates_map[matched_crate]
                expected_design = info.get("design")
                expected_code = info.get("code")
                expected_runtime = info.get("runtime")

                if design_idx is not None and expected_design:
                    actual = normalize_status(row[design_idx])
                    if actual != expected_design:
                        errors.append(
                            f"Mismatch in {file_path.relative_to(REPO_ROOT)} for crate `{matched_crate}` (Design column):\n"
                            f"  Found: '{row[design_idx]}' (normalized: {actual})\n"
                            f"  Expected: '{BADGE_MAP.get(expected_design)}'"
                        )

                if code_idx is not None and expected_code:
                    actual = normalize_status(row[code_idx])
                    if actual != expected_code:
                        errors.append(
                            f"Mismatch in {file_path.relative_to(REPO_ROOT)} for crate `{matched_crate}` (Code column):\n"
                            f"  Found: '{row[code_idx]}' (normalized: {actual})\n"
                            f"  Expected: '{BADGE_MAP.get(expected_code)}'"
                        )

                if runtime_idx is not None and expected_runtime:
                    actual = normalize_status(row[runtime_idx])
                    if actual != expected_runtime:
                        errors.append(
                            f"Mismatch in {file_path.relative_to(REPO_ROOT)} for crate `{matched_crate}` (Runtime column):\n"
                            f"  Found: '{row[runtime_idx]}' (normalized: {actual})\n"
                            f"  Expected: '{BADGE_MAP.get(expected_runtime)}'"
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
            "version: 1",
            'last_updated: "2026-08-18"',
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
