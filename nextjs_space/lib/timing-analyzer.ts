/**
 * timing-analyzer.ts - A faithful TypeScript port of the Python timing analysis
 * pipeline (python/parser.py + analyzer.py + stats.py + run_analysis.py).
 *
 * This runs natively in Node.js so the /api/analyze route no longer needs to
 * spawn a Python subprocess (Python is not available in the production runtime).
 *
 * The output shape matches lib/timing-types.ts (TimingAnalysisResult).
 */

import type {
  TimingAnalysisResult,
  TimingAttribute,
  TimingFileInfo,
  TimingLevel,
  TimingMessageRow,
  TimingPageRow,
  TimingSample,
  TimingSummary,
} from '@/lib/timing-types';

/* ==========================================================================
 * parser.ts  (port of python/parser.py)
 * ======================================================================== */

export enum EventKind {
  PAGE_NAV = 'page_nav',
  MSG_START = 'msg_start',
  MSG_STOP = 'msg_stop',
  MSG_PLAYED = 'msg_played',
  STT_WORD = 'stt_word',
  STT_UTT = 'stt_utt',
  KEYPRESS = 'keypress',
  PCAI_SUGGESTION = 'pcai_suggestion',
  STOP_SOUND = 'stop_sound',
  OTHER = 'other',
}

interface KEvent {
  kind: EventKind;
  ts: number; // milliseconds since start of log
  data: Record<string, any>;
  raw: string;
}

export interface ParsedLog {
  path: string;
  level: number;
  events: KEvent[];
}

const _TS_RE = /^\s*(\d{1,2}):(\d{2}):(\d{2})\.(\d{1,3})/;
const _KEYPRESS_RE = /Agent Key Press\s*-\s*"([^"]*)"/;
const _STT_WORD_RE = /STTWordReceived\s*\(\s*\)/;
const _STT_WORD_IDX_RE = /(?:index|word|#)\s*[:=]?\s*(\d+)/i;
const _STT_UTT_RE = /STTUtteranceReceived\s*\(\s*\)/;
const _ISFINAL_RE = /IsFinal\s*[:=]?\s*(TRUE|FALSE|true|false|1|0)/;
const _UTT_TEXT_RE = /(?:Utterance|Text)\s*[:=]?\s*"([^"]*)"/i;
const _MSG_PLAYED_RE = /MESSAGE\s+(\d+)\s+PLAYED\s+for\s+[\d.]+\s+seconds?\s*\((\d+)%\)/i;
const _PLAYINTRO_RE = /PLAYINTROAUDIO/i;
const _STOPSOUND_RE = /STOPSOUND|SPEECH_STOPPED|StopSound/i;

function _parseTs(line: string): number | null {
  const m = line.match(_TS_RE);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const ms = parseInt(m[4].padEnd(3, '0'), 10);
  return ((h * 60 + mi) * 60 + s) * 1000 + ms;
}

/** Best-effort extraction of the first JSON object embedded in a log line. */
function _extractJson(line: string): any | null {
  const start = line.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        const blob = line.slice(start, i + 1);
        try {
          return JSON.parse(blob);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function _truthy(val: any): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') return ['true', '1', 'yes'].includes(val.trim().toLowerCase());
  return false;
}

export function parseLog(path: string, text: string): ParsedLog {
  const events: KEvent[] = [];
  let baseMs: number | null = null;
  let prevRel = 0;
  let dayOffset = 0;
  let lastAbs: number | null = null;

  for (const rawLine of (text ?? '').split(/\r?\n/)) {
    const line = rawLine;
    if (!line.trim()) continue;

    const absMs = _parseTs(line);
    let ts: number;
    if (absMs === null) {
      ts = prevRel; // carry forward last known timestamp
    } else {
      if (baseMs === null) {
        baseMs = absMs;
        lastAbs = absMs;
      }
      if (lastAbs !== null && absMs + dayOffset < lastAbs) {
        dayOffset += 24 * 60 * 60 * 1000;
      }
      const curAbs = absMs + dayOffset;
      lastAbs = curAbs;
      ts = curAbs - (baseMs as number);
      prevRel = ts;
    }

    const ev = _classify(line, ts);
    if (ev !== null) events.push(ev);
  }

  const level = _detectLevel(events);
  return { path, level, events };
}

function _classify(line: string, ts: number): KEvent | null {
  // --- Human key press ---
  const km = line.match(_KEYPRESS_RE);
  if (km) {
    return { kind: EventKind.KEYPRESS, ts, data: { key: km[1] }, raw: line };
  }

  // --- MESSAGE x PLAYED for y seconds (z%) ---
  const pm = line.match(_MSG_PLAYED_RE);
  if (pm) {
    return {
      kind: EventKind.MSG_PLAYED,
      ts,
      data: { dialog_id: parseInt(pm[1], 10), percent: parseInt(pm[2], 10) },
      raw: line,
    };
  }

  // --- Customer utterance (final / partial) ---
  if (_STT_UTT_RE.test(line)) {
    const fm = line.match(_ISFINAL_RE);
    const isFinal = !!fm && ['TRUE', '1'].includes(fm[1].toUpperCase());
    const tm = line.match(_UTT_TEXT_RE);
    return {
      kind: EventKind.STT_UTT,
      ts,
      data: { utterance: tm ? tm[1] : '', is_final: isFinal },
      raw: line,
    };
  }

  // --- Customer first/partial word ---
  if (_STT_WORD_RE.test(line)) {
    const im = line.match(_STT_WORD_IDX_RE);
    const idx = im ? parseInt(im[1], 10) : null;
    return { kind: EventKind.STT_WORD, ts, data: { index: idx }, raw: line };
  }

  // --- Intro audio = an auto-played message ---
  if (_PLAYINTRO_RE.test(line)) {
    return {
      kind: EventKind.MSG_START,
      ts,
      data: { dialog_id: null, msg_text: '(intro audio)' },
      raw: line,
    };
  }

  // --- JSON-bearing lines ---
  const obj = _extractJson(line);
  if (obj !== null && typeof obj === 'object') {
    const ev = _classifyJson(obj, ts, line);
    if (ev !== null) return ev;
  }

  // --- Stop-sound (human interrupt of playback) ---
  if (_STOPSOUND_RE.test(line)) {
    return { kind: EventKind.STOP_SOUND, ts, data: {}, raw: line };
  }

  return null;
}

function _classifyJson(obj: any, ts: number, line: string): KEvent | null {
  const settings = obj.SETTINGS && typeof obj.SETTINGS === 'object' ? obj.SETTINGS : {};

  const cmd = String(obj.CMD ?? '').toUpperCase();
  if (cmd === 'PAGEACTION') {
    const hotkey = settings ? settings.hotkey : obj.hotkey;
    const invoke = settings ? settings.invoke : obj.invoke;
    const isFinal = _truthy(obj.is_final) || _truthy(settings.is_final);
    return {
      kind: EventKind.PCAI_SUGGESTION,
      ts,
      data: { hotkey, invoke, is_final: isFinal },
      raw: line,
    };
  }

  const objType = String(obj.type ?? settings.type ?? '').toLowerCase();

  if (objType === 'page') {
    return {
      kind: EventKind.PAGE_NAV,
      ts,
      data: {
        page_name: obj.name ?? settings.name,
        page_num: obj.page ?? obj.id ?? settings.page ?? settings.id,
        trigger: obj.trigger ?? settings.trigger,
      },
      raw: line,
    };
  }

  const trigger = String(obj.trigger ?? '').toUpperCase();
  if (objType === 'action' && trigger === 'KEYBOARD') {
    return {
      kind: EventKind.KEYPRESS,
      ts,
      data: { key: obj.hotkey ?? obj.key ?? '' },
      raw: line,
    };
  }

  const action = String(obj.action ?? settings.action ?? '').toLowerCase();
  const msgObj = ('text' in obj || 'id' in obj) ? obj : (Object.keys(settings).length ? settings : obj);
  if (action === 'start' && ['dialog', 'message', 'voice', ''].includes(objType)) {
    if ('text' in obj || 'text' in settings || ['dialog', 'message', 'voice'].includes(objType)) {
      return {
        kind: EventKind.MSG_START,
        ts,
        data: {
          dialog_id:
            msgObj.dialog_id ??
            obj.dialog_id ??
            settings.dialog_id ??
            msgObj.id ??
            obj.id ??
            msgObj.voice ??
            obj.voice,
          msg_text: obj.text ?? settings.text ?? '',
        },
        raw: line,
      };
    }
  }
  if (action === 'stop') {
    return {
      kind: EventKind.MSG_STOP,
      ts,
      data: { percent: obj.percent },
      raw: line,
    };
  }

  return null;
}

function _detectLevel(events: KEvent[]): number {
  const keypresses = events.filter((e) => e.kind === EventKind.KEYPRESS).length;
  const messages = events.filter((e) => e.kind === EventKind.MSG_START).length;

  if (messages === 0) {
    return keypresses >= 3 ? 3 : 4;
  }
  const ratio = keypresses / messages;
  return ratio >= 0.5 ? 3 : 4;
}

/* ==========================================================================
 * analyzer.ts  (port of python/analyzer.py)
 * ======================================================================== */

const CACHED_ACTION = 'cached_action_timeout';
const SUGGESTION_FILTER = 'suggestion_filter_timeout';
const IGNORE_INTERRUPT = 'ignore_interrupt_timeout';
const SPEECH_INTERRUPT = 'speech_interrupt_timeout';
const VAD_SILENCE = 'vad_silence_window';

export const ATTRIBUTES = [
  CACHED_ACTION,
  SUGGESTION_FILTER,
  IGNORE_INTERRUPT,
  SPEECH_INTERRUPT,
  VAD_SILENCE,
];

const ATTRIBUTE_LABELS: Record<string, string> = {
  [CACHED_ACTION]: 'Cached Action Timeout',
  [SUGGESTION_FILTER]: 'Suggestion Filter Timeout',
  [IGNORE_INTERRUPT]: 'Ignore Interrupt Timeout',
  [SPEECH_INTERRUPT]: 'Speech Interrupt Timeout',
  [VAD_SILENCE]: 'STT VAD Silence Window',
};

const ATTRIBUTE_DESCRIPTIONS: Record<string, string> = {
  [CACHED_ACTION]:
    'Time from the customer starting to speak (while STT is not yet final) until the human executes the PCAI-suggested action.',
  [SUGGESTION_FILTER]:
    "Time from arriving on a new page until the human interrupts that page's default message.",
  [IGNORE_INTERRUPT]:
    'Customer speech duration when the customer begins speaking within the first second of a message. If the human stopped the message the timeout is below this value; otherwise above it.',
  [SPEECH_INTERRUPT]:
    'Customer speech duration when the customer begins speaking at least one second into a message. If the human stopped the message the timeout is below this value; otherwise above it.',
  [VAD_SILENCE]:
    "How long the human waits after the customer's LAST utterance ends (STTUtteranceReceived IsFinal = TRUE) before taking an action (key press / navigation) -- the human's silence tolerance. Each action is paired back to its nearest preceding final utterance; gaps spanning an intervening agent message, a new customer utterance, or longer than the silence-window ceiling are excluded.",
};

const _GRACE_MS = 1000;
const _VAD_SILENCE_MAX_MS = 2000;

interface Sample {
  value: number;
  page: string;
  message: string;
  ts: number;
  meta: Record<string, any>;
}

class SpeechSegment {
  start_ts: number;
  final_ts: number | null = null;
  last_partial_ts: number | null = null;
  text = '';
  became_final = false;

  constructor(start_ts: number) {
    this.start_ts = start_ts;
  }

  get end_ts(): number {
    if (this.final_ts !== null) return this.final_ts;
    if (this.last_partial_ts !== null) return this.last_partial_ts;
    return this.start_ts;
  }

  get duration(): number {
    return this.end_ts - this.start_ts;
  }
}

class MessageInstance {
  start_ts: number;
  page: string;
  msg_id: number | null;
  text: string;
  stop_ts: number | null = null;
  percent_played: number | null = null;
  stopped_by_human = false;
  is_default = false;

  constructor(start_ts: number, page: string, msg_id: number | null, text: string, is_default: boolean) {
    this.start_ts = start_ts;
    this.page = page;
    this.msg_id = msg_id;
    this.text = text;
    this.is_default = is_default;
  }

  get label(): string {
    if (this.text) {
      let t = this.text.replace(/_/g, '').trim();
      t = t.split(/\s+/).join(' ');
      if (t) return t.length > 80 ? t.slice(0, 80) + '...' : t;
    }
    if (this.msg_id !== null && this.msg_id !== undefined && this.msg_id !== 0)
      return `Message #${this.msg_id}`;
    return '(no audio)';
  }
}

function _normKey(k: any): string {
  return String(k ?? '').trim().toUpperCase();
}

function bisectLeft(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function bisectRight(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < arr[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

class LogAnalyzer {
  parsed: ParsedLog;
  events: KEvent[];
  samples: Record<string, Sample[]>;
  speech_segments: SpeechSegment[] = [];
  messages: MessageInstance[] = [];
  page_arrivals: Array<[number, string]> = [];

  constructor(parsed: ParsedLog) {
    this.parsed = parsed;
    this.events = parsed.events;
    this.samples = {};
    for (const a of ATTRIBUTES) this.samples[a] = [];
  }

  analyze(): Record<string, Sample[]> {
    this._extractSpeechSegments();
    this._extractMessagesAndPages();
    this._attrCachedAction();
    this._attrSuggestionFilter();
    this._attrIgnoreAndSpeechInterrupt();
    this._attrVadSilence();
    return this.samples;
  }

  private _extractSpeechSegments(): void {
    const segs: SpeechSegment[] = [];
    let cur: SpeechSegment | null = null;
    for (const e of this.events) {
      if (e.kind === EventKind.STT_WORD) {
        if (e.data.index === 1 || cur === null) {
          if (cur !== null && cur.start_ts !== e.ts) {
            segs.push(cur);
          }
          cur = new SpeechSegment(e.ts);
        }
        cur.last_partial_ts = e.ts;
      } else if (e.kind === EventKind.STT_UTT) {
        if (cur === null) cur = new SpeechSegment(e.ts);
        cur.text = e.data.utterance ?? '';
        if (e.data.is_final) {
          cur.final_ts = e.ts;
          cur.became_final = true;
          segs.push(cur);
          cur = null;
        } else {
          cur.last_partial_ts = e.ts;
        }
      }
    }
    if (cur !== null) segs.push(cur);
    this.speech_segments = segs;
  }

  private _extractMessagesAndPages(): void {
    const messages: MessageInstance[] = [];
    const pageArrivals: Array<[number, string]> = [];

    // Build a dialog_id -> text map so empty-text instances of a known dialog
    // can inherit the real message text seen on another instance in the log.
    const dialogText = new Map<number, string>();
    for (const e of this.events) {
      if (e.kind === EventKind.MSG_START) {
        const id = e.data.dialog_id;
        const txt = (e.data.msg_text ?? '').trim();
        if (id !== null && id !== undefined && id !== 0 && txt && !dialogText.has(id)) {
          dialogText.set(id, e.data.msg_text);
        }
      }
    }

    let curPage = '(unknown)';
    let curMsg: MessageInstance | null = null;
    let pageJustChangedTs: number | null = null;

    for (const e of this.events) {
      if (e.kind === EventKind.PAGE_NAV) {
        const name = e.data.page_name || `Page ${e.data.page_num}`;
        if (name !== curPage || pageArrivals.length === 0) {
          curPage = name;
          pageArrivals.push([e.ts, name]);
          pageJustChangedTs = e.ts;
        }
      } else if (e.kind === EventKind.MSG_START) {
        if (curMsg !== null && curMsg.stop_ts === null) {
          curMsg.stop_ts = e.ts;
        }
        const isDefault =
          pageJustChangedTs !== null && e.ts - pageJustChangedTs <= 1500;
        let msgText = e.data.msg_text ?? '';
        if (!msgText.trim()) {
          const did = e.data.dialog_id;
          if (did !== null && did !== undefined && dialogText.has(did)) {
            msgText = dialogText.get(did)!;
          }
        }
        curMsg = new MessageInstance(
          e.ts,
          curPage,
          e.data.dialog_id ?? null,
          msgText,
          isDefault,
        );
        messages.push(curMsg);
        if (isDefault) pageJustChangedTs = null;
      } else if (e.kind === EventKind.MSG_STOP) {
        if (curMsg !== null && curMsg.stop_ts === null) {
          curMsg.stop_ts = e.ts;
          const pct = e.data.percent;
          if (pct !== null && pct !== undefined) curMsg.percent_played = pct;
        }
      } else if (e.kind === EventKind.MSG_PLAYED) {
        if (curMsg !== null) {
          curMsg.percent_played = e.data.percent ?? null;
          if (curMsg.stop_ts === null) curMsg.stop_ts = e.ts;
        }
      }
    }

    this.messages = messages;
    this.page_arrivals = pageArrivals;
    this._markHumanStops();
  }

  private _markHumanStops(): void {
    const kp = this.events
      .filter((e) => e.kind === EventKind.KEYPRESS)
      .map((e) => e.ts)
      .sort((a, b) => a - b);
    const sp = this.events
      .filter((e) => e.kind === EventKind.STOP_SOUND)
      .map((e) => e.ts)
      .sort((a, b) => a - b);

    const anyIn = (arr: number[], lo: number, hi: number): boolean => {
      const i = bisectLeft(arr, lo);
      return i < arr.length && arr[i] <= hi;
    };

    for (const m of this.messages) {
      const end = m.stop_ts !== null ? m.stop_ts : m.start_ts;
      const incomplete = m.percent_played !== null && m.percent_played < 95;
      const humanActed = anyIn(kp, m.start_ts, end + 200) || anyIn(sp, m.start_ts, end + 200);
      m.stopped_by_human = Boolean(incomplete && humanActed);
    }
  }

  private _pageAt(ts: number): string {
    let page = '(unknown)';
    for (const [pTs, name] of this.page_arrivals) {
      if (pTs <= ts) page = name;
      else break;
    }
    return page;
  }

  private _messageAt(ts: number): MessageInstance | null {
    let active: MessageInstance | null = null;
    let recent: MessageInstance | null = null;
    for (const m of this.messages) {
      if (m.start_ts <= ts) {
        recent = m;
        const end = m.stop_ts !== null ? m.stop_ts : m.start_ts + 60000;
        if (m.start_ts <= ts && ts <= end) active = m;
      } else {
        break;
      }
    }
    return active ?? recent;
  }

  private _add(
    attr: string,
    value: number,
    ts: number,
    message = '(none)',
    page: string | null = null,
    meta: Record<string, any> = {},
  ): void {
    if (value < 0) return;
    this.samples[attr].push({
      value,
      page: page !== null ? page : this._pageAt(ts),
      message,
      ts,
      meta,
    });
  }

  private _attrCachedAction(): void {
    const keypresses = this.events.filter((e) => e.kind === EventKind.KEYPRESS);
    const suggestions = this.events.filter((e) => e.kind === EventKind.PCAI_SUGGESTION);
    const sugTs = suggestions.map((s) => s.ts);

    for (const seg of this.speech_segments) {
      const lo = seg.start_ts;
      const hi = seg.end_ts;
      const i = bisectLeft(sugTs, lo);
      const segSugs: KEvent[] = [];
      let j = i;
      while (j < sugTs.length && sugTs[j] <= hi) {
        const s = suggestions[j];
        if (!s.data.is_final) segSugs.push(s);
        j += 1;
      }
      if (segSugs.length === 0) continue;
      const suggestedKeys = new Set<string>();
      for (const s of segSugs) suggestedKeys.add(_normKey(s.data.hotkey));
      suggestedKeys.delete('');
      suggestedKeys.delete('*');
      if (suggestedKeys.size === 0) continue;

      for (const kp of keypresses) {
        if (kp.ts < seg.start_ts) continue;
        if (kp.ts > hi) break;
        if (seg.became_final && seg.final_ts !== null && kp.ts > seg.final_ts) break;
        if (suggestedKeys.has(_normKey(kp.data.key))) {
          const msg = this._messageAt(kp.ts);
          this._add(
            CACHED_ACTION,
            kp.ts - seg.start_ts,
            kp.ts,
            msg ? msg.label : '(none)',
            this._pageAt(kp.ts),
            { key: kp.data.key, utterance: seg.text },
          );
          break;
        }
      }
    }
  }

  private _attrSuggestionFilter(): void {
    const keypresses = this.events
      .filter((e) => e.kind === EventKind.KEYPRESS)
      .sort((a, b) => a.ts - b.ts);
    const kpTs = keypresses.map((e) => e.ts);

    for (const m of this.messages) {
      if (!m.is_default) continue;
      let arrival: number | null = null;
      for (const [pTs, name] of this.page_arrivals) {
        if (pTs <= m.start_ts && name === m.page) arrival = pTs;
        else if (pTs > m.start_ts) break;
      }
      if (arrival === null) arrival = m.start_ts;
      if (!m.stopped_by_human) continue;
      const end = m.stop_ts !== null ? m.stop_ts : m.start_ts;
      const i = bisectLeft(kpTs, m.start_ts);
      if (i < kpTs.length && kpTs[i] <= end + 200) {
        const interruptTs = kpTs[i];
        this._add(
          SUGGESTION_FILTER,
          interruptTs - arrival,
          interruptTs,
          m.label,
          m.page,
          { percent_played: m.percent_played },
        );
      }
    }
  }

  private _attrIgnoreAndSpeechInterrupt(): void {
    for (const seg of this.speech_segments) {
      let msg: MessageInstance | null = null;
      for (const m of this.messages) {
        if (m.start_ts <= seg.start_ts) {
          const end = m.stop_ts !== null ? m.stop_ts : m.start_ts + 60000;
          if (m.start_ts <= seg.start_ts && seg.start_ts <= end) msg = m;
        } else {
          break;
        }
      }
      if (msg === null) continue;
      const intoMsg = seg.start_ts - msg.start_ts;
      if (intoMsg < 0) continue;
      const duration = seg.duration;
      if (duration <= 0) continue;
      const meta = {
        into_message_ms: intoMsg,
        stopped_by_human: msg.stopped_by_human,
        percent_played: msg.percent_played,
        utterance: seg.text,
      };
      if (intoMsg <= _GRACE_MS) {
        this._add(IGNORE_INTERRUPT, duration, seg.start_ts, msg.label, msg.page, meta);
      } else {
        this._add(SPEECH_INTERRUPT, duration, seg.start_ts, msg.label, msg.page, meta);
      }
    }
  }

  private _attrVadSilence(): void {
    const actions = this.events
      .filter(
        (e) =>
          e.kind === EventKind.KEYPRESS ||
          (e.kind === EventKind.PAGE_NAV && e.data.trigger !== 'AUTO'),
      )
      .sort((a, b) => a.ts - b.ts);

    const finals = this.speech_segments
      .filter((s) => s.became_final && s.final_ts !== null)
      .sort((a, b) => (a.final_ts as number) - (b.final_ts as number));
    const finTs = finals.map((s) => s.final_ts as number);
    const msgStarts = this.events
      .filter((e) => e.kind === EventKind.MSG_START)
      .map((e) => e.ts)
      .sort((a, b) => a - b);
    const segStarts = this.speech_segments.map((s) => s.start_ts).sort((a, b) => a - b);

    for (const act of actions) {
      const j = bisectRight(finTs, act.ts) - 1;
      if (j < 0) continue;
      const seg = finals[j];
      const gap = act.ts - (seg.final_ts as number);
      if (gap < 0) continue;

      const k = bisectRight(msgStarts, seg.final_ts as number);
      if (k < msgStarts.length && msgStarts[k] < act.ts) continue;

      const m = bisectRight(segStarts, seg.final_ts as number);
      if (m < segStarts.length && segStarts[m] < act.ts) continue;

      if (gap > _VAD_SILENCE_MAX_MS) continue;

      const msg = this._messageAt(seg.final_ts as number);
      this._add(
        VAD_SILENCE,
        gap,
        act.ts,
        msg ? msg.label : '(none)',
        this._pageAt(seg.final_ts as number),
        {
          action_kind: act.kind,
          action_key: act.data.key,
          final_ts: seg.final_ts,
          utterance: seg.text,
        },
      );
    }
  }
}

function analyzeLog(parsed: ParsedLog): Record<string, Sample[]> {
  return new LogAnalyzer(parsed).analyze();
}

/* ==========================================================================
 * stats.ts  (port of python/stats.py)
 * ======================================================================== */

const _INTERRUPT_ATTRS = new Set([IGNORE_INTERRUPT, SPEECH_INTERRUPT]);

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function _mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function _median(values: number[]): number {
  const ds = [...values].sort((a, b) => a - b);
  const n = ds.length;
  return n % 2 === 1 ? ds[(n - 1) / 2] : (ds[n / 2 - 1] + ds[n / 2]) / 2;
}

function _pstdev(values: number[]): number {
  const mean = _mean(values);
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

function _summary(samples: Sample[], attr: string): TimingSummary {
  const values = samples.map((s) => s.value);
  const out: TimingSummary = {
    n: values.length,
    mean: values.length ? round1(_mean(values)) : null,
    median: values.length ? round1(_median(values)) : null,
    std: values.length > 1 ? round1(_pstdev(values)) : values.length ? 0.0 : null,
    min: values.length ? round1(Math.min(...values)) : null,
    max: values.length ? round1(Math.max(...values)) : null,
  };
  if (_INTERRUPT_ATTRS.has(attr) && samples.length) {
    const stopped = samples.filter((s) => s.meta.stopped_by_human).length;
    out.stopped_count = stopped;
    out.not_stopped_count = samples.length - stopped;
  }
  return out;
}

function _sampleToDict(s: Sample): TimingSample {
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.meta || {})) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
      meta[k] = v;
    } else if (v !== undefined) {
      meta[k] = String(v);
    }
  }
  return {
    value: round1(s.value),
    page: s.page,
    message: s.message,
    ts: s.ts,
    meta,
  };
}

function aggregate(samplesByAttr: Record<string, Sample[]>): { attributes: TimingAttribute[] } {
  const attributesOut: TimingAttribute[] = [];

  for (const attr of ATTRIBUTES) {
    const samples = samplesByAttr[attr] ?? [];

    const pages = new Map<string, Map<string, Sample[]>>();
    for (const s of samples) {
      if (!pages.has(s.page)) pages.set(s.page, new Map());
      const msgs = pages.get(s.page)!;
      if (!msgs.has(s.message)) msgs.set(s.message, []);
      msgs.get(s.message)!.push(s);
    }

    const pageRows: TimingPageRow[] = [];
    for (const pageName of Array.from(pages.keys()).sort()) {
      const msgs = pages.get(pageName)!;
      const pageSamples: Sample[] = [];
      for (const ms of msgs.values()) pageSamples.push(...ms);
      const messageRows: TimingMessageRow[] = [];
      for (const msgName of Array.from(msgs.keys()).sort()) {
        const ms = msgs.get(msgName)!;
        messageRows.push({
          message: msgName,
          summary: _summary(ms, attr),
          samples: ms.map(_sampleToDict),
        });
      }
      pageRows.push({
        page: pageName,
        summary: _summary(pageSamples, attr),
        messages: messageRows,
      });
    }

    attributesOut.push({
      key: attr,
      label: ATTRIBUTE_LABELS[attr],
      description: ATTRIBUTE_DESCRIPTIONS[attr],
      is_interrupt: _INTERRUPT_ATTRS.has(attr),
      overall: _summary(samples, attr),
      pages: pageRows,
    });
  }

  return { attributes: attributesOut };
}

/* ==========================================================================
 * run_analysis.ts  (port of python/run_analysis.py)
 * ======================================================================== */

export interface AnalyzeInputFile {
  name: string;
  content: string;
}

export function analyzeFiles(files: AnalyzeInputFile[]): TimingAnalysisResult {
  const perFile: TimingFileInfo[] = [];
  const levelSamples = new Map<number, Record<string, Sample[]>>();

  for (const f of files) {
    const name = f.name || 'log';
    let parsed: ParsedLog;
    try {
      parsed = parseLog(name, f.content);
    } catch (exc: any) {
      perFile.push({ name, error: String(exc?.message ?? exc), level: null });
      continue;
    }

    const samples = analyzeLog(parsed);
    const counts: Record<string, number> = {};
    for (const a of ATTRIBUTES) counts[a] = (samples[a] ?? []).length;
    const total = Object.values(counts).reduce((s, v) => s + v, 0);

    perFile.push({
      name,
      level: parsed.level,
      eventCount: parsed.events.length,
      sampleCounts: counts,
      totalSamples: total,
    });

    if (!levelSamples.has(parsed.level)) {
      const bucket: Record<string, Sample[]> = {};
      for (const a of ATTRIBUTES) bucket[a] = [];
      levelSamples.set(parsed.level, bucket);
    }
    const bucket = levelSamples.get(parsed.level)!;
    for (const a of ATTRIBUTES) bucket[a].push(...(samples[a] ?? []));
  }

  const levelsOut: TimingLevel[] = [];
  for (const level of Array.from(levelSamples.keys()).sort((a, b) => a - b)) {
    const agg = aggregate(levelSamples.get(level)!);
    levelsOut.push({
      level,
      fileCount: perFile.filter((pf) => pf.level === level).length,
      attributes: agg.attributes,
    });
  }

  return { files: perFile, levels: levelsOut };
}
