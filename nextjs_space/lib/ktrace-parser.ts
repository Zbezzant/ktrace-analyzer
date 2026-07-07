export interface LastSpeechInfo {
  text: string;
  timestamp: string;
}

export interface CallEndEvent {
  timestamp: string;
  endType: 'plus_key' | 'protocall_stop';
  page: string;
  hotkeySequence: string;
  lastSpeech: LastSpeechInfo | null;
}

export interface PageStats {
  pageName: string;
  plusKeyCount: number;
  protocallStopCount: number;
  totalCount: number;
}

export interface ParseResult {
  callEndEvents: CallEndEvent[];
  pageStats: PageStats[];
  totalPlusKey: number;
  totalProtocallStop: number;
  totalCalls: number;
  fileName: string;
  delay: DelayAnalysis;
}

/* =============================================================================
 * AGENT RESPONSE DELAY
 * -----------------------------------------------------------------------------
 * Measures how quickly a human agent reacts after the customer STOPS speaking:
 *   delay = (agent's next key press ts) - (customer SPEECH_STOPPED ts)
 *
 * Only supported on VAD logs (those containing SPEECH_STOPPED). STT-only logs
 * are flagged unsupported (hasSpeechStopped=false) and excluded from all math.
 *
 * Thresholds (ceiling/floor) are applied LATE in the UI, never baked into raw
 * samples — the parser only applies the always-on "resume-speech" filter.
 * =========================================================================== */

export interface DelayConfig {
  ceilingMs: number; // drop delays above this (deliberation)
  floorMs: number;   // drop delays below this (anticipation)
}

export const DEFAULT_DELAY_CONFIG: DelayConfig = { ceilingMs: 1200, floorMs: 150 };

export interface DelaySample {
  delta: number;          // ms = agentActionTs - speechStoppedTs
  page: string;           // page active when the agent acted
  key: string;            // literal key pressed, e.g. "5", "DOWN"
  action: string | null;  // enriched action name (from KEYBOARD line)
  hotkey: string | null;  // enriched hotkey (from KEYBOARD line)
  timestamp: string;      // "HH:MM:SS.mmm" of the agent action
}

export interface DelayAnalysis {
  agent: string;
  hasSpeechStopped: boolean;   // false => unsupported (no VAD), excluded
  rawSamples: DelaySample[];   // resume-filtered, NO ceiling/floor applied
  nStops: number;
  nStarts: number;
  nActions: number;
  droppedResume: number;       // pairs discarded because customer resumed speaking
}

export interface DelayStat {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  std: number;
  p25: number;
  p75: number;
}

/** Derive the agent id from the filename: token between "KTRACE_PC_" and next "_". */
export function agentFromFileName(fileName: string | null | undefined): string {
  const m = (fileName ?? '').match(/KTRACE_PC_([^_]+)_/);
  return m?.[1] ?? (fileName ?? 'unknown');
}

/** Parse "HH:MM:SS.mmm" -> ms since midnight; null if not a valid timestamp. */
function timeToMs(tsStr: string): number | null {
  const m = (tsStr ?? '').match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const ms = parseInt(m[4], 10);
  return ((h * 60 + min) * 60 + s) * 1000 + ms;
}

/** Largest index in sorted[] whose value is strictly < target (or -1). */
function lastIndexBefore(sorted: number[], target: number): number {
  let lo = 0, hi = sorted.length - 1, res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) { res = mid; lo = mid + 1; }
    else { hi = mid - 1; }
  }
  return res;
}

/** Smallest index in sorted[] whose value is strictly > target (or length). */
function firstIndexAfter(sorted: number[], target: number): number {
  let lo = 0, hi = sorted.length - 1, res = sorted.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] > target) { res = mid; hi = mid - 1; }
    else { lo = mid + 1; }
  }
  return res;
}

const MS_12H = 12 * 60 * 60 * 1000;
const MS_24H = 24 * 60 * 60 * 1000;

/**
 * Analyze agent response delays for a single file (= single agent).
 * `lines` are the raw log lines (may include trailing "\r").
 */
export function analyzeDelays(lines: string[], fileName: string): DelayAnalysis {
  const agent = agentFromFileName(fileName);

  const tsLineRe = /^(\d{1,2}:\d{2}:\d{2}\.\d{3})\s+-\s+(.*)$/;
  const keyPressRe = /Agent Key Press - "([^"]*)"/;
  const goToRe = /AddActionToProcessTracker\(\) - GO To: "([^"]+)"/;
  const wsPageRe = /"name":"([^"]+)","options":.*"type":"page"/;
  const keyboardActionRe = /AddActionToProcessTracker\(\) - (?:Page|Global) ACTION: "([^"]*)" HotKey: "([^"]*)" \[.*\] triggered KEYBOARD/;
  const SPEECH_STOPPED = 'OnReActiveAudioEvent( SPEECH_STOPPED )';
  const SPEECH_STARTED = 'OnReActiveAudioEvent( SPEECH_STARTED )';

  const stops: number[] = [];
  const starts: number[] = [];
  // action tuple: [ms, key, action, hotkey, tsStr]
  const actions: Array<[number, string, string | null, string | null, string]> = [];
  const pageMarks: { ms: number; name: string }[] = [];

  let prevMs: number | null = null;
  let dayOffset = 0;

  for (const raw of (lines ?? [])) {
    const line = (raw ?? '').replace(/\r$/, ''); // GOTCHA (a): strip trailing CR
    const m = line.match(tsLineRe);
    if (!m) continue;

    const tsStr = m[1];
    const rest = m[2] ?? '';
    let ts = timeToMs(tsStr);
    if (ts == null) continue;

    // GOTCHA (b): midnight rollover
    if (prevMs != null && ts + MS_12H < prevMs) {
      dayOffset += MS_24H;
    }
    ts += dayOffset;
    prevMs = ts;

    if (rest.includes(SPEECH_STOPPED)) {
      stops.push(ts);
    } else if (rest.includes(SPEECH_STARTED)) {
      starts.push(ts);
    } else if (rest.includes('Agent Key Press')) {
      const km = rest.match(keyPressRe);
      const key = km?.[1] ?? '';
      if (key !== '') {
        actions.push([ts, key, null, null, tsStr]);
      }
    } else if (rest.includes('GO To:')) {
      const gm = rest.match(goToRe);
      if (gm) pageMarks.push({ ms: ts, name: gm[1] });
    } else if (rest.includes('"type":"page"')) {
      const wm = rest.match(wsPageRe);
      if (wm) pageMarks.push({ ms: ts, name: wm[1] });
    } else if (rest.includes('triggered KEYBOARD')) {
      const am = rest.match(keyboardActionRe);
      if (am) {
        const name = am[1] ?? '';
        const hotkey = am[2] ?? '';
        // Enrich the most recent action whose action-name is still null,
        // if it occurred within 300ms before this line.
        for (let idx = actions.length - 1; idx >= 0; idx--) {
          const a = actions[idx];
          if (a[2] === null) {
            if (ts - a[0] <= 300 && ts - a[0] >= 0) {
              a[2] = name;
              a[3] = hotkey;
            }
            break;
          }
        }
      }
    }
  }

  const nStops = stops.length;
  const nStarts = starts.length;
  const nActions = actions.length;

  if (nStops === 0) {
    return {
      agent,
      hasSpeechStopped: false,
      rawSamples: [],
      nStops,
      nStarts,
      nActions,
      droppedResume: 0,
    };
  }

  // Pass 2 — build samples
  const sortedStops = [...stops].sort((a, b) => a - b);
  const sortedStarts = [...starts].sort((a, b) => a - b);
  const sortedPages = [...pageMarks].sort((a, b) => a.ms - b.ms);
  const pageMs = sortedPages.map((p) => p.ms);

  function pageAt(ts: number): string {
    const j = lastIndexBefore(pageMs, ts + 1); // last pageMark with ms <= ts
    if (j < 0) return '(unknown)';
    return sortedPages[j]?.name ?? '(unknown)';
  }

  const rawSamples: DelaySample[] = [];
  let droppedResume = 0;

  for (const [ts, key, action, hotkey, tsStr] of actions) {
    const j = lastIndexBefore(sortedStops, ts + 1); // nearest SPEECH_STOPPED <= ts
    if (j < 0) continue;
    const delta = ts - sortedStops[j];
    if (delta < 0) continue;

    // RESUME FILTER (always on): if the customer started speaking again after
    // this SPEECH_STOPPED but before the agent acted, discard the pair.
    const k = firstIndexAfter(sortedStarts, sortedStops[j]);
    if (k < sortedStarts.length && sortedStarts[k] < ts) {
      droppedResume++;
      continue;
    }

    rawSamples.push({
      delta,
      page: pageAt(ts),
      key,
      action,
      hotkey,
      timestamp: tsStr,
    });
  }

  return {
    agent,
    hasSpeechStopped: true,
    rawSamples,
    nStops,
    nStarts,
    nActions,
    droppedResume,
  };
}

/** Summarize a list of deltas (ms) into count/mean/median/min/max/std/p25/p75. */
export function summarizeDeltas(deltas: number[]): DelayStat | null {
  const n = deltas?.length ?? 0;
  if (n === 0) return null;
  const ds = [...deltas].sort((a, b) => a - b);

  const sum = ds.reduce((s, d) => s + d, 0);
  const mean = sum / n;
  const median = n % 2 === 1 ? ds[(n - 1) / 2] : (ds[n / 2 - 1] + ds[n / 2]) / 2;
  const variance = ds.reduce((s, d) => s + (d - mean) * (d - mean), 0) / n;
  const std = Math.sqrt(variance);
  const pct = (p: number) => {
    const idx = Math.min(Math.max(Math.round(p * (n - 1)), 0), n - 1);
    return ds[idx];
  };

  return {
    count: n,
    mean: Math.round(mean),
    median: Math.round(median),
    min: Math.round(ds[0]),
    max: Math.round(ds[n - 1]),
    std: Math.round(std),
    p25: Math.round(pct(0.25)),
    p75: Math.round(pct(0.75)),
  };
}

/** Apply ceiling/floor thresholds to a delay analysis, returning kept deltas. */
export function filteredDeltas(analysis: DelayAnalysis | null | undefined, cfg: DelayConfig): number[] {
  return (analysis?.rawSamples ?? [])
    .map((s) => s.delta)
    .filter((d) => d >= cfg.floorMs && d <= cfg.ceilingMs);
}

/**
 * Parse a KTRACE log file content and extract call end events.
 *
 * Revised strategy (two-pass):
 *
 * Pass 1: Index all relevant lines by line number.
 *   - Agent Key Press "+" events
 *   - protocall_stop events
 *   - HOTKEYSEQUENCEBYPAGE entries (non-empty)
 *   - LASTPAGE entries (fallback for page identification)
 *
 * Pass 2: For every call-end event (+ or protocall_stop), determine
 *   the page by looking at the surrounding context:
 *   - For "+" events: find the next HOTKEYSEQUENCEBYPAGE and pick the
 *     page segment containing "+". If none found, fall back to the
 *     last known HOTKEYSEQUENCEBYPAGE before the event.
 *   - For protocall_stop events: look at the most recent
 *     HOTKEYSEQUENCEBYPAGE *before* this event (the state of the call
 *     when it was stopped). Use the last page in the sequence (since
 *     the call may not have a "+" at all). If none, use LASTPAGE.
 */
export function parseKtraceLog(content: string, fileName: string): ParseResult {
  const lines = (content ?? '').split('\n');

  // ---- Regex patterns ----
  const plusKeyRegex = /^(\S+)\s+-\s+Agent Key Press - "\+"/;
  const protocallStopRegex = /^(\S+)\s+-\s+<--- Received HTTP Message: protocall_stop/;
  const hotkeyByPageRegex = /^(\S+)\s+-\s+.*SESSION_DATAFIELD_HOTKEYSEQUENCEBYPAGE TO:\s*"([^"]*)"/;
  const lastPageRegex = /^(\S+)\s+-\s+.*SESSION_DATAFIELD_LASTPAGE TO:\s*"([^"]*)"/;
  const sttCaptureRegex = /^(\S+)\s+-\s+.*SESSION_DATAFIELD_LASTSTTCAPTURE TO:\s*"([^"]*)"/;

  // ---- Pass 1: index everything ----
  interface IndexedEvent {
    lineNum: number;
    timestamp: string;
  }

  interface SttCaptureEntry {
    lineNum: number;
    timestamp: string;
    text: string;
  }

  const plusEvents: IndexedEvent[] = [];
  const stopEvents: IndexedEvent[] = [];
  const hotkeyEntries: { lineNum: number; timestamp: string; sequence: string }[] = [];
  const lastPageEntries: { lineNum: number; pageId: string }[] = [];
  const sttCaptureEntries: SttCaptureEntry[] = [];

  for (let i = 0; i < (lines?.length ?? 0); i++) {
    const trimmed = (lines?.[i] ?? '').trim();
    if (!trimmed) continue;

    const plusMatch = trimmed.match(plusKeyRegex);
    if (plusMatch) {
      plusEvents.push({ lineNum: i, timestamp: plusMatch[1] ?? '' });
      continue;
    }

    const stopMatch = trimmed.match(protocallStopRegex);
    if (stopMatch) {
      stopEvents.push({ lineNum: i, timestamp: stopMatch[1] ?? '' });
      continue;
    }

    const hkMatch = trimmed.match(hotkeyByPageRegex);
    if (hkMatch) {
      const seq = (hkMatch[2] ?? '').trim();
      if (seq) {
        hotkeyEntries.push({ lineNum: i, timestamp: hkMatch[1] ?? '', sequence: seq });
      }
      continue;
    }

    const sttMatch = trimmed.match(sttCaptureRegex);
    if (sttMatch) {
      // Index ALL STT capture entries — including empty ones — so that
      // empty resets at call boundaries can clear previous call's text.
      sttCaptureEntries.push({
        lineNum: i,
        timestamp: sttMatch[1] ?? '',
        text: (sttMatch[2] ?? '').trim(),
      });
      continue;
    }

    const lpMatch = trimmed.match(lastPageRegex);
    if (lpMatch) {
      const pid = (lpMatch[2] ?? '').trim();
      if (pid) {
        lastPageEntries.push({ lineNum: i, pageId: pid });
      }
    }
  }

  // ---- Helper: find the closest hotkey entry BEFORE a given line ----
  function findHotkeyBefore(lineNum: number): { sequence: string } | null {
    let best: (typeof hotkeyEntries)[0] | null = null;
    for (const hk of hotkeyEntries) {
      if (hk.lineNum < lineNum) {
        best = hk;
      } else {
        break;
      }
    }
    return best;
  }

  // ---- Helper: find the closest hotkey entry AFTER a given line (within 50 lines) ----
  function findHotkeyAfter(lineNum: number): { sequence: string } | null {
    for (const hk of hotkeyEntries) {
      if (hk.lineNum > lineNum) {
        if (hk.lineNum - lineNum <= 50) return hk;
        return null;
      }
    }
    return null;
  }

  // ---- Helper: find the closest LASTPAGE entry before a given line ----
  function findLastPageBefore(lineNum: number): string | null {
    let best: (typeof lastPageEntries)[0] | null = null;
    for (const lp of lastPageEntries) {
      if (lp.lineNum < lineNum) {
        best = lp;
      } else {
        break;
      }
    }
    return best?.pageId ?? null;
  }

  // ---- Helper: find the most recent STT capture BEFORE a given line ----
  // If the most recent STT entry is an empty reset (e.g. "" at the start
  // of a new call), return null so we don't bleed a previous call's
  // transcription into this one.
  function findLastSpeechBefore(lineNum: number): LastSpeechInfo | null {
    let best: SttCaptureEntry | null = null;
    for (const stt of sttCaptureEntries) {
      if (stt.lineNum < lineNum) {
        best = stt;
      } else {
        break;
      }
    }
    if (!best || !best.text) return null;
    return {
      text: best.text,
      timestamp: best.timestamp,
    };
  }

  // ---- Pass 2: resolve pages for each event ----
  const callEndEvents: CallEndEvent[] = [];

  // Process "+" events
  for (const ev of plusEvents) {
    // For "+" events, prefer the next HOTKEYSEQUENCEBYPAGE (which should
    // contain the "+" in one of its segments), fall back to the one before.
    const afterHk = findHotkeyAfter(ev.lineNum);
    const beforeHk = findHotkeyBefore(ev.lineNum);

    let page: string | null = null;
    let seq = '';

    if (afterHk) {
      page = findPageWithPlus(afterHk.sequence);
      seq = afterHk.sequence;
    }
    if (!page && beforeHk) {
      page = findPageWithPlus(beforeHk.sequence) ?? findLastPageInSequence(beforeHk.sequence);
      seq = beforeHk.sequence;
    }
    if (!page) {
      const lpId = findLastPageBefore(ev.lineNum);
      if (lpId) {
        page = `Page ${lpId}`;
      }
    }

    if (page) {
      callEndEvents.push({
        timestamp: ev.timestamp,
        endType: 'plus_key',
        page,
        hotkeySequence: seq,
        lastSpeech: findLastSpeechBefore(ev.lineNum),
      });
    }
  }

  // Process protocall_stop events
  for (const ev of stopEvents) {
    // For protocall_stop, use the most recent HOTKEYSEQUENCEBYPAGE before
    // the event. Pick the last page in the sequence (the page the call was
    // on when it stopped). If no sequence, try LASTPAGE.
    const beforeHk = findHotkeyBefore(ev.lineNum);
    const afterHk = findHotkeyAfter(ev.lineNum);

    let page: string | null = null;
    let seq = '';

    // First try: look at the hotkey sequence before the stop event.
    // Use "last page in sequence" since the call may not have had a "+".
    if (beforeHk) {
      // If the sequence has a "+", the page with "+" is where the call was
      // ending; otherwise use the last page in the sequence.
      page = findPageWithPlus(beforeHk.sequence) ?? findLastPageInSequence(beforeHk.sequence);
      seq = beforeHk.sequence;
    }

    // Second try: check the hotkey entry right after (some logs write it after stop)
    if (!page && afterHk) {
      page = findPageWithPlus(afterHk.sequence) ?? findLastPageInSequence(afterHk.sequence);
      seq = afterHk.sequence;
    }

    // Third try: LASTPAGE field
    if (!page) {
      const lpId = findLastPageBefore(ev.lineNum);
      if (lpId) {
        page = `Page ${lpId}`;
      }
    }

    // Always count the protocall_stop, even if we can't determine a page
    callEndEvents.push({
      timestamp: ev.timestamp,
      endType: 'protocall_stop',
      page: page ?? 'Unknown',
      hotkeySequence: seq,
      lastSpeech: findLastSpeechBefore(ev.lineNum),
    });
  }

  // ---- Build page stats ----
  const statsMap = new Map<string, { plusKeyCount: number; protocallStopCount: number }>();

  for (const event of (callEndEvents ?? [])) {
    const existing = statsMap.get(event?.page ?? '') ?? { plusKeyCount: 0, protocallStopCount: 0 };
    if (event?.endType === 'plus_key') {
      existing.plusKeyCount++;
    } else {
      existing.protocallStopCount++;
    }
    statsMap.set(event?.page ?? '', existing);
  }

  const pageStats: PageStats[] = Array.from(statsMap.entries()).map(([pageName, counts]: [string, any]) => ({
    pageName,
    plusKeyCount: counts?.plusKeyCount ?? 0,
    protocallStopCount: counts?.protocallStopCount ?? 0,
    totalCount: (counts?.plusKeyCount ?? 0) + (counts?.protocallStopCount ?? 0),
  }));

  pageStats.sort((a: PageStats, b: PageStats) => (a?.pageName ?? '').localeCompare(b?.pageName ?? ''));

  const totalPlusKey = pageStats.reduce((sum: number, p: PageStats) => sum + (p?.plusKeyCount ?? 0), 0);
  const totalProtocallStop = pageStats.reduce((sum: number, p: PageStats) => sum + (p?.protocallStopCount ?? 0), 0);

  return {
    callEndEvents,
    pageStats,
    totalPlusKey,
    totalProtocallStop,
    totalCalls: totalPlusKey + totalProtocallStop,
    fileName,
    delay: analyzeDelays(lines, fileName),
  };
}

/**
 * Find the page segment that contains "+" in the hotkey sequence.
 * Format: "[A. Intro] 0 86 0 R 88 +, [End] 7"
 */
function findPageWithPlus(sequence: string): string | null {
  if (!sequence) return null;

  const segments = sequence.split(',');

  for (const segment of (segments ?? [])) {
    const trimmed = (segment ?? '').trim();
    const nameMatch = trimmed.match(/^\[([^\]]+)\]/);
    if (!nameMatch) continue;

    const pageName = nameMatch?.[1] ?? '';
    const keysStr = trimmed.substring((nameMatch?.[0]?.length ?? 0))?.trim() ?? '';
    const keys = keysStr.split(/\s+/);

    if (keys?.some?.((k: string) => k === '+')) {
      return pageName;
    }
  }

  return null;
}

/**
 * Find the last page name in the hotkey sequence.
 * Used for protocall_stop events where there may be no "+" in the sequence.
 * Returns the last non-"End" page, or "End" if that's the only one.
 */
function findLastPageInSequence(sequence: string): string | null {
  if (!sequence) return null;

  const segments = sequence.split(',');
  let lastPage: string | null = null;
  let lastNonEndPage: string | null = null;

  for (const segment of (segments ?? [])) {
    const trimmed = (segment ?? '').trim();
    const nameMatch = trimmed.match(/^\[([^\]]+)\]/);
    if (!nameMatch) continue;

    const pageName = nameMatch?.[1] ?? '';
    lastPage = pageName;
    if (pageName.toLowerCase() !== 'end') {
      lastNonEndPage = pageName;
    }
  }

  // Prefer the last non-"End" page, since "End" is typically a post-call cleanup page
  return lastNonEndPage ?? lastPage;
}

/**
 * Merge multiple ParseResults into aggregated page stats
 */
export function aggregateResults(results: ParseResult[]): {
  pageStats: PageStats[];
  totalPlusKey: number;
  totalProtocallStop: number;
  totalCalls: number;
} {
  const statsMap = new Map<string, { plusKeyCount: number; protocallStopCount: number }>();

  for (const result of (results ?? [])) {
    for (const stat of (result?.pageStats ?? [])) {
      const existing = statsMap.get(stat?.pageName ?? '') ?? { plusKeyCount: 0, protocallStopCount: 0 };
      existing.plusKeyCount += stat?.plusKeyCount ?? 0;
      existing.protocallStopCount += stat?.protocallStopCount ?? 0;
      statsMap.set(stat?.pageName ?? '', existing);
    }
  }

  const pageStats: PageStats[] = Array.from(statsMap.entries()).map(([pageName, counts]: [string, any]) => ({
    pageName,
    plusKeyCount: counts?.plusKeyCount ?? 0,
    protocallStopCount: counts?.protocallStopCount ?? 0,
    totalCount: (counts?.plusKeyCount ?? 0) + (counts?.protocallStopCount ?? 0),
  }));

  pageStats.sort((a: PageStats, b: PageStats) => (a?.pageName ?? '').localeCompare(b?.pageName ?? ''));

  const totalPlusKey = pageStats.reduce((sum: number, p: PageStats) => sum + (p?.plusKeyCount ?? 0), 0);
  const totalProtocallStop = pageStats.reduce((sum: number, p: PageStats) => sum + (p?.protocallStopCount ?? 0), 0);

  return {
    pageStats,
    totalPlusKey,
    totalProtocallStop,
    totalCalls: totalPlusKey + totalProtocallStop,
  };
}