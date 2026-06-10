"""
analyzer.py - Extract the five human-derived timing attributes from a parsed
KTRACE event stream.

The five attributes (all in milliseconds), as defined by the user:

  a) Cached Action Timeout
       Customer speaks (STT IsFinal == FALSE).  PCAI is streaming suggestions.
       The human executes the suggested action (key press whose hotkey matches a
       recent PCAI suggestion) while the utterance is still NOT final.
       Measure = time from the customer's first word to the human action.

  b) Suggestion Filter Timeout
       Time from arriving on a new page to the human interrupting that page's
       default (auto-played) message.

  c) Ignore Interrupt Timeout
       A message starts, and the customer begins speaking within the first 1s of
       the message.  Measure the customer's speech duration (first word -> IsFinal).
       If the human stopped the message, the timeout must be < speech duration;
       if not, it must be > speech duration.

  d) Speech Interrupt Timeout
       Same as (c) but the customer begins speaking >= 1s into the message.

  e) STT VAD Silence Window
       Time from the customer's last utterance (IsFinal == TRUE) to the human's
       next action (key press / navigation).

Each extracted sample is attributed to the (page, message) context in which it
occurred so that statistics can be reported per page and per message.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from parser import Event, EventKind, ParsedLog

log = logging.getLogger("ktrace.analyzer")

# Attribute keys
CACHED_ACTION = "cached_action_timeout"
SUGGESTION_FILTER = "suggestion_filter_timeout"
IGNORE_INTERRUPT = "ignore_interrupt_timeout"
SPEECH_INTERRUPT = "speech_interrupt_timeout"
VAD_SILENCE = "vad_silence_window"

ATTRIBUTES = [
    CACHED_ACTION,
    SUGGESTION_FILTER,
    IGNORE_INTERRUPT,
    SPEECH_INTERRUPT,
    VAD_SILENCE,
]

ATTRIBUTE_LABELS = {
    CACHED_ACTION: "Cached Action Timeout",
    SUGGESTION_FILTER: "Suggestion Filter Timeout",
    IGNORE_INTERRUPT: "Ignore Interrupt Timeout",
    SPEECH_INTERRUPT: "Speech Interrupt Timeout",
    VAD_SILENCE: "STT VAD Silence Window",
}

ATTRIBUTE_DESCRIPTIONS = {
    CACHED_ACTION: "Time from the customer starting to speak (while STT is not yet "
                   "final) until the human executes the PCAI-suggested action.",
    SUGGESTION_FILTER: "Time from arriving on a new page until the human interrupts "
                       "that page's default message.",
    IGNORE_INTERRUPT: "Customer speech duration when the customer begins speaking "
                      "within the first second of a message. If the human stopped the "
                      "message the timeout is below this value; otherwise above it.",
    SPEECH_INTERRUPT: "Customer speech duration when the customer begins speaking at "
                      "least one second into a message. If the human stopped the "
                      "message the timeout is below this value; otherwise above it.",
    VAD_SILENCE: "How long the human waits after the customer's LAST utterance ends "
                 "(STTUtteranceReceived IsFinal = TRUE) before taking an action (key "
                 "press / navigation) -- the human's silence tolerance. Each action is "
                 "paired back to its nearest preceding final utterance; gaps spanning an "
                 "intervening agent message, a new customer utterance, or longer than the "
                 "silence-window ceiling are excluded.",
}

# Keys that represent "real" human actions (ignore modifier-only / blank presses).
_INTERRUPTING_KEYS_IGNORE = {""}

# Window (ms) used to associate a customer speech segment with the message it
# might be interrupting / responding to.
_GRACE_MS = 1000

# Upper bound (ms) for a plausible STT VAD silence window. The VAD silence window
# is a short "still considered talking" buffer that tolerates natural pauses; a
# human applying silence tolerance reacts within a couple of seconds. Gaps larger
# than this are human deliberation or cross-turn pairings, NOT a silence window,
# and are excluded from the measurement.
_VAD_SILENCE_MAX_MS = 2000


@dataclass
class Sample:
    """A single measured timing value attributed to a page/message context."""

    value: float                 # milliseconds
    page: str
    message: str
    ts: int
    meta: Dict[str, object] = field(default_factory=dict)


@dataclass
class SpeechSegment:
    """A contiguous customer utterance, from first word to the final transcription."""

    start_ts: int
    final_ts: Optional[int] = None
    last_partial_ts: Optional[int] = None
    text: str = ""
    became_final: bool = False

    @property
    def end_ts(self) -> int:
        return self.final_ts if self.final_ts is not None else (
            self.last_partial_ts if self.last_partial_ts is not None else self.start_ts
        )

    @property
    def duration(self) -> int:
        return self.end_ts - self.start_ts


@dataclass
class MessageInstance:
    """One agent message playback instance."""

    start_ts: int
    page: str
    msg_id: Optional[int] = None
    text: str = ""
    stop_ts: Optional[int] = None
    percent_played: Optional[int] = None
    stopped_by_human: bool = False
    is_default: bool = False     # first message auto-played after page arrival

    @property
    def label(self) -> str:
        if self.text:
            t = self.text.replace("_", "").strip()
            t = " ".join(t.split())
            if t:
                return (t[:80] + "…") if len(t) > 80 else t
        if self.msg_id is not None:
            return f"Message #{self.msg_id}"
        return "(unnamed message)"


def _norm_key(k: Optional[str]) -> str:
    return (k or "").strip().upper()


class LogAnalyzer:
    """Walks the event stream once and produces timing samples per attribute."""

    def __init__(self, parsed: ParsedLog):
        self.parsed = parsed
        self.events = parsed.events
        # samples[attribute] -> list[Sample]
        self.samples: Dict[str, List[Sample]] = {a: [] for a in ATTRIBUTES}

    # ------------------------------------------------------------------
    def analyze(self) -> Dict[str, List[Sample]]:
        self._extract_speech_segments()
        self._extract_messages_and_pages()
        self._attr_cached_action()
        self._attr_suggestion_filter()
        self._attr_ignore_and_speech_interrupt()
        self._attr_vad_silence()
        for a in ATTRIBUTES:
            log.info("  %-26s : %d samples", a, len(self.samples[a]))
        return self.samples

    # ------------------------------------------------------------------
    # Pass 1: reconstruct customer speech segments
    # ------------------------------------------------------------------
    def _extract_speech_segments(self) -> None:
        segs: List[SpeechSegment] = []
        cur: Optional[SpeechSegment] = None
        for e in self.events:
            if e.kind == EventKind.STT_WORD:
                if e.data.get("index") == 1 or cur is None:
                    # A word index of 1 marks the start of a new utterance.
                    if cur is not None and cur.start_ts != e.ts:
                        segs.append(cur)
                    cur = SpeechSegment(start_ts=e.ts)
                cur.last_partial_ts = e.ts
            elif e.kind == EventKind.STT_UTT:
                if cur is None:
                    cur = SpeechSegment(start_ts=e.ts)
                cur.text = e.data.get("utterance", "")
                if e.data.get("is_final"):
                    cur.final_ts = e.ts
                    cur.became_final = True
                    segs.append(cur)
                    cur = None
                else:
                    cur.last_partial_ts = e.ts
        if cur is not None:
            segs.append(cur)
        self.speech_segments = segs
        log.info("  reconstructed %d customer speech segments", len(segs))

    # ------------------------------------------------------------------
    # Pass 2: reconstruct page arrivals and message playbacks
    # ------------------------------------------------------------------
    def _extract_messages_and_pages(self) -> None:
        messages: List[MessageInstance] = []
        page_arrivals: List[Tuple[int, str]] = []  # (ts, page_name)

        cur_page = "(unknown)"
        cur_msg: Optional[MessageInstance] = None
        page_just_changed_ts: Optional[int] = None

        # Map dialog/message percent results to running message via msg_id/text.
        for e in self.events:
            if e.kind == EventKind.PAGE_NAV:
                name = e.data.get("page_name") or f"Page {e.data.get('page_num')}"
                # Skip pure "Home"/navigation menus repeated? Keep them; they are real pages.
                if name != cur_page or not page_arrivals:
                    cur_page = name
                    page_arrivals.append((e.ts, name))
                    page_just_changed_ts = e.ts

            elif e.kind == EventKind.MSG_START:
                if cur_msg is not None and cur_msg.stop_ts is None:
                    cur_msg.stop_ts = e.ts  # implicitly ended by next start
                is_default = (
                    page_just_changed_ts is not None
                    and (e.ts - page_just_changed_ts) <= 1500
                )
                cur_msg = MessageInstance(
                    start_ts=e.ts,
                    page=cur_page,
                    msg_id=e.data.get("dialog_id"),
                    text=e.data.get("msg_text", ""),
                    is_default=is_default,
                )
                messages.append(cur_msg)
                if is_default:
                    page_just_changed_ts = None

            elif e.kind == EventKind.MSG_STOP:
                if cur_msg is not None and cur_msg.stop_ts is None:
                    cur_msg.stop_ts = e.ts
                    pct = e.data.get("percent")
                    if pct is not None:
                        cur_msg.percent_played = pct

            elif e.kind == EventKind.MSG_PLAYED:
                # "MESSAGE x PLAYED for y seconds (z%)" - definitive percent.
                if cur_msg is not None:
                    cur_msg.percent_played = e.data.get("percent")
                    if cur_msg.stop_ts is None:
                        cur_msg.stop_ts = e.ts

        self.messages = messages
        self.page_arrivals = page_arrivals
        self._mark_human_stops()
        log.info("  reconstructed %d messages, %d page arrivals",
                 len(messages), len(page_arrivals))

    def _mark_human_stops(self) -> None:
        """A message is 'stopped by human' if it ended below ~95% AND a human key
        press / stop-sound event occurred during its playback window."""
        keypress_ts = [e.ts for e in self.events if e.kind == EventKind.KEYPRESS]
        stop_ts = [e.ts for e in self.events if e.kind == EventKind.STOP_SOUND]
        import bisect
        kp = sorted(keypress_ts)
        sp = sorted(stop_ts)

        def any_in(arr, lo, hi):
            i = bisect.bisect_left(arr, lo)
            return i < len(arr) and arr[i] <= hi

        for m in self.messages:
            end = m.stop_ts if m.stop_ts is not None else m.start_ts
            incomplete = m.percent_played is not None and m.percent_played < 95
            human_acted = any_in(kp, m.start_ts, end + 200) or any_in(sp, m.start_ts, end + 200)
            m.stopped_by_human = bool(incomplete and human_acted)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _page_at(self, ts: int) -> str:
        page = "(unknown)"
        for p_ts, name in self.page_arrivals:
            if p_ts <= ts:
                page = name
            else:
                break
        return page

    def _message_at(self, ts: int) -> Optional[MessageInstance]:
        """Return the message instance active (playing) at ts, else the most recent."""
        active = None
        recent = None
        for m in self.messages:
            if m.start_ts <= ts:
                recent = m
                end = m.stop_ts if m.stop_ts is not None else m.start_ts + 60_000
                if m.start_ts <= ts <= end:
                    active = m
            else:
                break
        return active or recent

    def _add(self, attr: str, value: float, ts: int, message: str = "(none)",
             page: Optional[str] = None, **meta) -> None:
        if value < 0:
            return
        self.samples[attr].append(
            Sample(value=value, page=page if page is not None else self._page_at(ts),
                   message=message, ts=ts, meta=meta)
        )

    # ------------------------------------------------------------------
    # (a) Cached Action Timeout
    # ------------------------------------------------------------------
    def _attr_cached_action(self) -> None:
        keypresses = [e for e in self.events if e.kind == EventKind.KEYPRESS]
        suggestions = [e for e in self.events if e.kind == EventKind.PCAI_SUGGESTION]
        import bisect
        sug_ts = [s.ts for s in suggestions]

        for seg in self.speech_segments:
            # Only segments that were observed mid-flight (not-yet-final window).
            lo, hi = seg.start_ts, seg.end_ts
            # Suggestions emitted during the speech while not final.
            i = bisect.bisect_left(sug_ts, lo)
            seg_sugs = []
            j = i
            while j < len(sug_ts) and sug_ts[j] <= hi:
                s = suggestions[j]
                if not s.data.get("is_final"):
                    seg_sugs.append(s)
                j += 1
            if not seg_sugs:
                continue
            suggested_keys = {_norm_key(s.data.get("hotkey")) for s in seg_sugs}
            suggested_keys.discard("")
            suggested_keys.discard("*")
            if not suggested_keys:
                continue
            # Human key press during the (non-final) window matching a suggestion.
            for kp in keypresses:
                if kp.ts < seg.start_ts:
                    continue
                if kp.ts > hi:
                    break
                # Must occur while utterance is NOT yet final.
                if seg.became_final and seg.final_ts is not None and kp.ts > seg.final_ts:
                    break
                if _norm_key(kp.data.get("key")) in suggested_keys:
                    msg = self._message_at(kp.ts)
                    self._add(
                        CACHED_ACTION,
                        value=kp.ts - seg.start_ts,
                        ts=kp.ts,
                        message=msg.label if msg else "(none)",
                        page=self._page_at(kp.ts),
                        key=kp.data.get("key"),
                        utterance=seg.text,
                    )
                    break

    # ------------------------------------------------------------------
    # (b) Suggestion Filter Timeout
    # ------------------------------------------------------------------
    def _attr_suggestion_filter(self) -> None:
        keypresses = sorted(
            [e for e in self.events if e.kind == EventKind.KEYPRESS], key=lambda e: e.ts
        )
        import bisect
        kp_ts = [e.ts for e in keypresses]

        # The default message of a page = first message flagged is_default.
        seen_pages: set = set()
        for m in self.messages:
            if not m.is_default:
                continue
            # find page arrival ts for this message's page (closest <= start)
            arrival = None
            for p_ts, name in self.page_arrivals:
                if p_ts <= m.start_ts and name == m.page:
                    arrival = p_ts
                elif p_ts > m.start_ts:
                    break
            if arrival is None:
                arrival = m.start_ts
            # Only count if the default message was actually interrupted by human.
            if not m.stopped_by_human:
                continue
            end = m.stop_ts if m.stop_ts is not None else m.start_ts
            i = bisect.bisect_left(kp_ts, m.start_ts)
            if i < len(kp_ts) and kp_ts[i] <= end + 200:
                interrupt_ts = kp_ts[i]
                self._add(
                    SUGGESTION_FILTER,
                    value=interrupt_ts - arrival,
                    ts=interrupt_ts,
                    message=m.label,
                    page=m.page,
                    percent_played=m.percent_played,
                )

    # ------------------------------------------------------------------
    # (c)/(d) Ignore Interrupt & Speech Interrupt Timeouts
    # ------------------------------------------------------------------
    def _attr_ignore_and_speech_interrupt(self) -> None:
        for seg in self.speech_segments:
            # Find the message that was playing when the customer began speaking.
            msg = None
            for m in self.messages:
                if m.start_ts <= seg.start_ts:
                    end = m.stop_ts if m.stop_ts is not None else m.start_ts + 60_000
                    if m.start_ts <= seg.start_ts <= end:
                        msg = m
                else:
                    break
            if msg is None:
                continue
            into_msg = seg.start_ts - msg.start_ts
            if into_msg < 0:
                continue
            duration = seg.duration
            if duration <= 0:
                continue
            meta = dict(
                into_message_ms=into_msg,
                stopped_by_human=msg.stopped_by_human,
                percent_played=msg.percent_played,
                utterance=seg.text,
            )
            if into_msg <= _GRACE_MS:
                self._add(IGNORE_INTERRUPT, value=duration, ts=seg.start_ts,
                          message=msg.label, page=msg.page, **meta)
            else:
                self._add(SPEECH_INTERRUPT, value=duration, ts=seg.start_ts,
                          message=msg.label, page=msg.page, **meta)

    # ------------------------------------------------------------------
    # (e) STT VAD Silence Window
    # ------------------------------------------------------------------
    def _attr_vad_silence(self) -> None:
        """
        Measure, for each human action, how long the human waited after the
        customer's LAST (final) utterance ended before acting -- the human's
        silence tolerance.

        Reference point  : the customer's last utterance END = the timestamp of
                           the STTUtteranceReceived(... IsFinal = TRUE) line that
                           immediately precedes the action. We measure from this
                           timestamp directly (no added system-processing delay).

        Pairing direction: we walk BACKWARD from each human action to the nearest
                           preceding final utterance. This guarantees we use the
                           customer's LAST utterance (never an earlier one) and
                           never pairs an ignored utterance with a far-away action.

        Exclusions (to avoid measuring the wrong thing):
          * An agent message started between the utterance and the action -> the
            human was responding to/after the agent's own speech, not to silence.
          * A new customer speech segment started in between -> there were multiple
            customer utterances; this is not a clean end-of-speech -> action gap.
          * gap > _VAD_SILENCE_MAX_MS -> human deliberation / a different turn,
            not a silence-tolerance window.
        """
        import bisect

        # Human actions = key presses and explicit (non-AUTO) navigations.
        actions = sorted(
            [e for e in self.events
             if e.kind == EventKind.KEYPRESS
             or (e.kind == EventKind.PAGE_NAV and e.data.get("trigger") not in ("AUTO",))],
            key=lambda e: e.ts,
        )

        finals = sorted(
            [s for s in self.speech_segments if s.became_final and s.final_ts is not None],
            key=lambda s: s.final_ts,
        )
        fin_ts = [s.final_ts for s in finals]
        msg_starts = sorted(e.ts for e in self.events if e.kind == EventKind.MSG_START)
        seg_starts = sorted(s.start_ts for s in self.speech_segments)

        kept = 0
        dropped_msg = dropped_speech = dropped_cap = dropped_none = 0

        for act in actions:
            # Nearest preceding final utterance (the customer's LAST utterance).
            j = bisect.bisect_right(fin_ts, act.ts) - 1
            if j < 0:
                dropped_none += 1
                continue
            seg = finals[j]
            gap = act.ts - seg.final_ts
            if gap < 0:
                dropped_none += 1
                continue

            # Exclude: an agent message started between the utterance and the action.
            k = bisect.bisect_right(msg_starts, seg.final_ts)
            if k < len(msg_starts) and msg_starts[k] < act.ts:
                dropped_msg += 1
                continue

            # Exclude: the customer started a new speech segment in between.
            m = bisect.bisect_right(seg_starts, seg.final_ts)
            if m < len(seg_starts) and seg_starts[m] < act.ts:
                dropped_speech += 1
                continue

            # Exclude: gap too large to be a silence-tolerance window.
            if gap > _VAD_SILENCE_MAX_MS:
                dropped_cap += 1
                continue

            log.debug(
                "VAD silence: final '%s' @%dms IsFinal=TRUE -> action %r @%dms => gap=%dms",
                (seg.text or "")[:40], seg.final_ts,
                act.data.get("key", act.kind), act.ts, gap,
            )

            msg = self._message_at(seg.final_ts)
            self._add(
                VAD_SILENCE,
                value=gap,
                ts=act.ts,
                message=msg.label if msg else "(none)",
                page=self._page_at(seg.final_ts),
                action_kind=act.kind,
                action_key=act.data.get("key"),
                final_ts=seg.final_ts,
                utterance=seg.text,
            )
            kept += 1

        log.debug(
            "VAD silence: kept=%d  dropped[msg_between=%d, speech_between=%d, "
            "gap>%dms=%d, no_final=%d]",
            kept, dropped_msg, dropped_speech, _VAD_SILENCE_MAX_MS,
            dropped_cap, dropped_none,
        )


def analyze_log(parsed: ParsedLog) -> Dict[str, List[Sample]]:
    log.info("Analyzing %s (level %d)", parsed.path, parsed.level)
    return LogAnalyzer(parsed).analyze()
