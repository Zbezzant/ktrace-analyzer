"""
stats.py - Aggregate the raw timing samples produced by analyzer.py into
mean / median / standard-deviation summaries, organized by
Level -> Attribute -> Page -> Message.
"""

from __future__ import annotations

import statistics
from typing import Dict, List, Optional

from analyzer import (
    ATTRIBUTES,
    ATTRIBUTE_LABELS,
    ATTRIBUTE_DESCRIPTIONS,
    IGNORE_INTERRUPT,
    SPEECH_INTERRUPT,
    Sample,
)

_INTERRUPT_ATTRS = {IGNORE_INTERRUPT, SPEECH_INTERRUPT}


def _summary(samples: List[Sample], attr: str) -> Dict[str, object]:
    values = [s.value for s in samples]
    out: Dict[str, object] = {
        "n": len(values),
        "mean": round(statistics.fmean(values), 1) if values else None,
        "median": round(statistics.median(values), 1) if values else None,
        "std": round(statistics.pstdev(values), 1) if len(values) > 1 else (0.0 if values else None),
        "min": round(min(values), 1) if values else None,
        "max": round(max(values), 1) if values else None,
    }
    if attr in _INTERRUPT_ATTRS and samples:
        stopped = sum(1 for s in samples if s.meta.get("stopped_by_human"))
        out["stopped_count"] = stopped
        out["not_stopped_count"] = len(samples) - stopped
    return out


def _sample_to_dict(s: Sample) -> Dict[str, object]:
    meta = {}
    for k, v in (s.meta or {}).items():
        # keep only JSON-serializable scalars
        if isinstance(v, (str, int, float, bool)) or v is None:
            meta[k] = v
        elif hasattr(v, "value"):  # Enum (e.g. EventKind) -> its string value
            meta[k] = v.value
        else:
            meta[k] = str(v)
    return {
        "value": round(s.value, 1),
        "page": s.page,
        "message": s.message,
        "ts": s.ts,
        "meta": meta,
    }


def aggregate(samples_by_attr: Dict[str, List[Sample]]) -> Dict[str, object]:
    """Build a nested, JSON-friendly summary for one level's worth of samples."""
    attributes_out: List[Dict[str, object]] = []

    for attr in ATTRIBUTES:
        samples = samples_by_attr.get(attr, [])

        # Group by page -> message
        pages: Dict[str, Dict[str, List[Sample]]] = {}
        for s in samples:
            pages.setdefault(s.page, {}).setdefault(s.message, []).append(s)

        page_rows = []
        for page_name in sorted(pages.keys()):
            msgs = pages[page_name]
            page_samples = [s for ms in msgs.values() for s in ms]
            message_rows = []
            for msg_name in sorted(msgs.keys()):
                ms = msgs[msg_name]
                message_rows.append(
                    {
                        "message": msg_name,
                        "summary": _summary(ms, attr),
                        "samples": [_sample_to_dict(s) for s in ms],
                    }
                )
            page_rows.append(
                {
                    "page": page_name,
                    "summary": _summary(page_samples, attr),
                    "messages": message_rows,
                }
            )

        attributes_out.append(
            {
                "key": attr,
                "label": ATTRIBUTE_LABELS[attr],
                "description": ATTRIBUTE_DESCRIPTIONS[attr],
                "is_interrupt": attr in _INTERRUPT_ATTRS,
                "overall": _summary(samples, attr),
                "pages": page_rows,
            }
        )

    return {"attributes": attributes_out}
