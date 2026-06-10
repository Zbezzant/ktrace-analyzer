# Timing Analysis backend (`analyzer.py` integration)

This folder contains the Python that powers the **Timing Analysis** tab of the
web app. It is the integration of the original `analyzer.py` CLI logic into the
KTRACE Analyzer web application.

```
python/
├── analyzer.py        # The provided five-attribute timing analyzer (unchanged)
├── parser.py          # KTRACE line/timestamp/event parsing + Level 3/4 detection
├── stats.py           # mean / median / std aggregation by Level → Page → Message
└── run_analysis.py    # JSON entrypoint invoked by /api/analyze
```

## How it is used

The Next.js API route `app/api/analyze/route.ts` receives uploaded log files,
writes them to a temp directory, and runs:

```bash
python3 run_analysis.py --json '[{"name":"a.log","path":"/tmp/.../a.log"}]'
```

`run_analysis.py` parses each file, detects its **level**, runs `analyze_log()`
from `analyzer.py`, combines samples by level, and prints a single JSON document
that the UI renders.

## Requirements

* **Python 3.8+** must be available on `PATH` (only the standard library is used).
  Override the interpreter with the `PYTHON_BIN` environment variable if needed.

## The five timing attributes

All values are in milliseconds. See the project root README for full definitions:

1. **Cached Action Timeout**
2. **Suggestion Filter Timeout**
3. **Ignore Interrupt Timeout**
4. **Speech Interrupt Timeout**
5. **STT VAD Silence Window**

## Level detection

`parser._detect_level` uses the ratio of human key-presses to agent messages:

* **Level 3** (human agent + AI suggestions) — a human presses a key for nearly
  every action. **This is the only level for which timing analysis is necessary.**
* **Level 4** (AI agent) — actions are invoked automatically; human key-presses
  are negligible, so few/zero human-derived samples are expected.

> **Note:** `parser.py` was reconstructed from the documented KTRACE patterns
> (see the root `README` and `ktrace_analysis.md`) because the original
> `parser.py`/`stats.py`/`report.py` modules were not provided alongside
> `analyzer.py`. The `analyzer.py` analysis logic itself is used verbatim.
