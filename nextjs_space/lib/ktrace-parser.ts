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