"""
run_analysis.py - JSON entrypoint used by the web app's /api/analyze route.

Usage:
    python3 run_analysis.py <log_file> [<log_file> ...]
    python3 run_analysis.py --json '[{"name": "a.log", "path": "/tmp/a.log"}]'

Reads one or more KTRACE logs, runs the five-attribute timing analysis from
analyzer.py (grouped/combined by detected level), and prints a single JSON
document to stdout describing the per-file level and per-level statistics.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from typing import Dict, List

from parser import parse_log, ParsedLog
from analyzer import analyze_log, ATTRIBUTES
from stats import aggregate


def _analyze_files(files: List[Dict[str, str]]) -> Dict[str, object]:
    per_file = []
    # combine samples by level
    level_samples: Dict[int, Dict[str, list]] = {}

    for f in files:
        name = f.get("name") or os.path.basename(f.get("path", "log"))
        path = f["path"]
        try:
            parsed: ParsedLog = parse_log(path)
        except Exception as exc:  # noqa: BLE001 - report gracefully
            per_file.append({"name": name, "error": str(exc), "level": None})
            continue

        samples = analyze_log(parsed)
        counts = {a: len(samples.get(a, [])) for a in ATTRIBUTES}
        total = sum(counts.values())

        per_file.append(
            {
                "name": name,
                "level": parsed.level,
                "eventCount": len(parsed.events),
                "sampleCounts": counts,
                "totalSamples": total,
            }
        )

        bucket = level_samples.setdefault(parsed.level, {a: [] for a in ATTRIBUTES})
        for a in ATTRIBUTES:
            bucket[a].extend(samples.get(a, []))

    levels_out = []
    for level in sorted(level_samples.keys()):
        agg = aggregate(level_samples[level])
        agg["level"] = level
        agg["fileCount"] = sum(1 for pf in per_file if pf.get("level") == level)
        levels_out.append(agg)

    return {"files": per_file, "levels": levels_out}


def main() -> int:
    logging.basicConfig(level=logging.WARNING)

    args = sys.argv[1:]
    files: List[Dict[str, str]] = []

    if args and args[0] == "--json":
        files = json.loads(args[1])
    else:
        for p in args:
            files.append({"name": os.path.basename(p), "path": p})

    if not files:
        print(json.dumps({"error": "no input files"}))
        return 1

    try:
        result = _analyze_files(files)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}))
        return 1

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
