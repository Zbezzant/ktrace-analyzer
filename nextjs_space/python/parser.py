"""
parser.py - Parse a ProtoCall Agent (Fivestrata) KTRACE log into a normalized
event stream consumed by analyzer.py.

This module reconstructs the structures analyzer.py expects:

    Event       - one normalized log event (kind + ms-timestamp + data dict)
    EventKind   - the categories of events the analyzer reasons about
    ParsedLog   - the parsed file (path, detected level, list of events)

Recognized KTRACE patterns (see README.md "How the log is interpreted"):

  * Timestamps             HH:MM:SS.mmm  -> ms-since-start (midnight roll-over aware)
  * Pages                  Sending PCAI Web Socket Message: {... "type":"page", "name":"..." ...}
  * Agent messages start   {"action":"start", ... "type":"dialog", "text":"..."}
  * Agent messages stop    {"action":"stop",  ... "percent":NN}
  * Message played         MESSAGE x PLAYED for y seconds (z%)
  * Intro audio            JavaScript PLAYINTROAUDIO(...)
  * Customer first word    CInteractionManager::STTWordReceived()
  * Customer utterance     CInteractionManager::STTUtteranceReceived() ... IsFinal = TRUE/FALSE
  * Human key press        Agent Key Press - "X"
  * Human action (ws)      {"trigger":"KEYBOARD","type":"action"}
  * PCAI suggestion        {"CMD":"PAGEACTION","SETTINGS":{ ... "hotkey":"3", "invoke":0 ... }}
  * Stop sound             STOPSOUND / OnReActiveAudioEvent( SPEECH_STOPPED )

Level detection uses the ratio of human key-presses to agent messages, which is a
far more reliable signal than the presence of GetPCAI*Timeout config reads.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

log = logging.getLogger("ktrace.parser")


class EventKind(Enum):
    PAGE_NAV = "page_nav"
    MSG_START = "msg_start"
    MSG_STOP = "msg_stop"
    MSG_PLAYED = "msg_played"
    STT_WORD = "stt_word"
    STT_UTT = "stt_utt"
    KEYPRESS = "keypress"
    PCAI_SUGGESTION = "pcai_suggestion"
    STOP_SOUND = "stop_sound"
    OTHER = "other"


@dataclass
class Event:
    kind: EventKind
    ts: int                                   # milliseconds since start of log
    data: Dict[str, object] = field(default_factory=dict)
    raw: str = ""


@dataclass
class ParsedLog:
    path: str
    level: int
    events: List[Event] = field(default_factory=list)
    meta: Dict[str, object] = field(default_factory=dict)


# --------------------------------------------------------------------------
# Regex patterns
# --------------------------------------------------------------------------
_TS_RE = re.compile(r"^\s*(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})")
_KEYPRESS_RE = re.compile(r'Agent Key Press\s*-\s*"([^"]*)"')
_STT_WORD_RE = re.compile(r"STTWordReceived\s*\(\s*\)")
_STT_WORD_IDX_RE = re.compile(r"(?:index|word|#)\s*[:=]?\s*(\d+)", re.IGNORECASE)
_STT_UTT_RE = re.compile(r"STTUtteranceReceived\s*\(\s*\)")
_ISFINAL_RE = re.compile(r"IsFinal\s*[:=]?\s*(TRUE|FALSE|true|false|1|0)")
_UTT_TEXT_RE = re.compile(r'(?:Utterance|Text)\s*[:=]?\s*"([^"]*)"', re.IGNORECASE)
_MSG_PLAYED_RE = re.compile(
    r"MESSAGE\s+(\d+)\s+PLAYED\s+for\s+[\d.]+\s+seconds?\s*\((\d+)%\)",
    re.IGNORECASE,
)
_PLAYINTRO_RE = re.compile(r"PLAYINTROAUDIO", re.IGNORECASE)
_STOPSOUND_RE = re.compile(r"STOPSOUND|SPEECH_STOPPED|StopSound", re.IGNORECASE)


def _parse_ts(line: str, base: Optional[int], prev: int) -> Optional[int]:
    """Return ms-since-start for `line`, or None if it carries no timestamp.

    `base` is the absolute ms-of-day of the first timestamp encountered.
    Handles roll-over past midnight by adding 24h whenever the computed value
    would go backwards relative to the previous timestamp.
    """
    m = _TS_RE.match(line)
    if not m:
        return None
    h, mi, s, ms = m.groups()
    abs_ms = ((int(h) * 60 + int(mi)) * 60 + int(s)) * 1000 + int(ms.ljust(3, "0"))
    return abs_ms


def _extract_json(line: str) -> Optional[dict]:
    """Best-effort extraction of the first JSON object embedded in a log line."""
    start = line.find("{")
    if start == -1:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(line)):
        c = line[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                blob = line[start : i + 1]
                try:
                    return json.loads(blob)
                except (json.JSONDecodeError, ValueError):
                    return None
    return None


def _truthy(val) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val != 0
    if isinstance(val, str):
        return val.strip().lower() in ("true", "1", "yes")
    return False


def parse_log(path: str, text: Optional[str] = None) -> ParsedLog:
    """Parse a KTRACE log from `path` (or from `text` if provided)."""
    if text is None:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()

    events: List[Event] = []
    base_ms: Optional[int] = None
    prev_rel = 0
    day_offset = 0
    last_abs = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip("\n")
        if not line.strip():
            continue

        abs_ms = _parse_ts(line, base_ms, prev_rel)
        if abs_ms is None:
            ts = prev_rel  # carry forward the last known timestamp
        else:
            if base_ms is None:
                base_ms = abs_ms
                last_abs = abs_ms
            # midnight roll-over
            if last_abs is not None and abs_ms + day_offset < last_abs:
                day_offset += 24 * 60 * 60 * 1000
            cur_abs = abs_ms + day_offset
            last_abs = cur_abs
            ts = cur_abs - base_ms
            prev_rel = ts

        ev = _classify(line, ts)
        if ev is not None:
            events.append(ev)

    level = _detect_level(events)
    log.info("Parsed %s: %d events, level %d", path, len(events), level)
    return ParsedLog(path=path, level=level, events=events)


def _classify(line: str, ts: int) -> Optional[Event]:
    # --- Human key press ---------------------------------------------------
    km = _KEYPRESS_RE.search(line)
    if km:
        return Event(EventKind.KEYPRESS, ts, {"key": km.group(1)}, line)

    # --- MESSAGE x PLAYED for y seconds (z%) -------------------------------
    pm = _MSG_PLAYED_RE.search(line)
    if pm:
        return Event(
            EventKind.MSG_PLAYED,
            ts,
            {"dialog_id": int(pm.group(1)), "percent": int(pm.group(2))},
            line,
        )

    # --- Customer utterance (final / partial) ------------------------------
    if _STT_UTT_RE.search(line):
        fm = _ISFINAL_RE.search(line)
        is_final = bool(fm) and fm.group(1).upper() in ("TRUE", "1")
        tm = _UTT_TEXT_RE.search(line)
        return Event(
            EventKind.STT_UTT,
            ts,
            {"utterance": tm.group(1) if tm else "", "is_final": is_final},
            line,
        )

    # --- Customer first/partial word ---------------------------------------
    if _STT_WORD_RE.search(line):
        im = _STT_WORD_IDX_RE.search(line)
        idx = int(im.group(1)) if im else None
        return Event(EventKind.STT_WORD, ts, {"index": idx}, line)

    # --- Intro audio = an auto-played message ------------------------------
    if _PLAYINTRO_RE.search(line):
        return Event(
            EventKind.MSG_START,
            ts,
            {"dialog_id": None, "msg_text": "(intro audio)"},
            line,
        )

    # --- JSON-bearing lines: pages, dialog messages, suggestions, actions --
    obj = _extract_json(line)
    if obj is not None:
        ev = _classify_json(obj, ts, line)
        if ev is not None:
            return ev

    # --- Stop-sound (human interrupt of playback) --------------------------
    if _STOPSOUND_RE.search(line):
        return Event(EventKind.STOP_SOUND, ts, {}, line)

    return None


def _classify_json(obj: dict, ts: int, line: str) -> Optional[Event]:
    # Some lines wrap the payload under "SETTINGS"/"DATA"; normalize a view.
    settings = obj.get("SETTINGS") if isinstance(obj.get("SETTINGS"), dict) else {}

    # PCAI suggestion: {"CMD":"PAGEACTION","SETTINGS":{"hotkey":"3","invoke":0}}
    cmd = str(obj.get("CMD", "")).upper()
    if cmd == "PAGEACTION":
        hotkey = settings.get("hotkey") if settings else obj.get("hotkey")
        invoke = settings.get("invoke") if settings else obj.get("invoke")
        # A suggestion that is auto-invoked (invoke truthy) is treated as final.
        is_final = _truthy(obj.get("is_final")) or _truthy(settings.get("is_final"))
        return Event(
            EventKind.PCAI_SUGGESTION,
            ts,
            {"hotkey": hotkey, "invoke": invoke, "is_final": is_final},
            line,
        )

    obj_type = str(obj.get("type", "")).lower()

    # Page navigation: {"type":"page","name":"0005. Greeting", ...}
    if obj_type == "page":
        return Event(
            EventKind.PAGE_NAV,
            ts,
            {
                "page_name": obj.get("name"),
                "page_num": obj.get("page") or obj.get("id"),
                "trigger": obj.get("trigger"),
            },
            line,
        )

    # Human action via websocket keyboard: {"trigger":"KEYBOARD","type":"action"}
    trigger = str(obj.get("trigger", "")).upper()
    if obj_type == "action" and trigger == "KEYBOARD":
        return Event(EventKind.KEYPRESS, ts, {"key": obj.get("hotkey") or obj.get("key") or ""}, line)

    # Agent message start / stop: {"action":"start"/"stop","type":"dialog",...}
    action = str(obj.get("action", "")).lower()
    if action == "start" and obj_type in ("dialog", "message", "voice", ""):
        if "text" in obj or obj_type in ("dialog", "message", "voice"):
            return Event(
                EventKind.MSG_START,
                ts,
                {"dialog_id": obj.get("id") or obj.get("voice"), "msg_text": obj.get("text", "")},
                line,
            )
    if action == "stop":
        return Event(
            EventKind.MSG_STOP,
            ts,
            {"percent": obj.get("percent")},
            line,
        )

    return None


def _detect_level(events: List[Event]) -> int:
    """Level 3 = human agent (key press per action); Level 4 = AI agent.

    Uses the ratio of human key-presses to agent messages. In Level 3 a human
    presses a key for essentially every action, so key-presses are comparable to
    (or exceed) the number of messages.  In Level 4 the application invokes
    actions automatically and human key-presses are negligible.
    """
    keypresses = sum(1 for e in events if e.kind == EventKind.KEYPRESS)
    messages = sum(1 for e in events if e.kind == EventKind.MSG_START)

    if messages == 0:
        # No agent messages to compare against: any meaningful number of human
        # key presses implies a human-driven (Level 3) session.
        return 3 if keypresses >= 3 else 4

    ratio = keypresses / messages
    return 3 if ratio >= 0.5 else 4
