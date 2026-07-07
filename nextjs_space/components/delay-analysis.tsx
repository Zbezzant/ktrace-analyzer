'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  parseKtraceLog,
  summarizeDeltas,
  DEFAULT_DELAY_CONFIG,
  type ParseResult,
  type DelayConfig,
  type DelayStat,
} from '@/lib/ktrace-parser';
import { FileUploader } from '@/components/file-uploader';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Timer,
  Upload,
  Trash2,
  FileText,
  Gauge,
  Users,
  Layers,
  AlertTriangle,
  RotateCcw,
  Trophy,
  KeyRound,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/* -------------------------------------------------------------------------- */
/* Speed color scale (median ms): <=600 green, <=1000 orange, else red        */
/* -------------------------------------------------------------------------- */
function speedColor(ms: number): string {
  if (ms <= 600) return 'text-emerald-600 dark:text-emerald-400';
  if (ms <= 1000) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}
function speedBg(ms: number): string {
  if (ms <= 600) return 'bg-emerald-500';
  if (ms <= 1000) return 'bg-amber-500';
  return 'bg-red-500';
}

const fmt = (n: number | undefined | null) => (n == null ? '—' : `${n}ms`);

interface DelayAnalysisProps {
  // Optional: parent may pass pre-parsed results. If omitted, the component
  // manages its own uploads (self-contained mode).
  results?: ParseResult[];
}

interface AgentRow {
  agent: string;
  fileName: string;
  stat: DelayStat | null;
}

interface KeyRow {
  agent: string;
  key: string;
  label: string;
  stat: DelayStat;
}

interface PageSection {
  page: string;
  rows: { agent: string; stat: DelayStat }[];
  total: number;
  pageMedian: number;
  keyRows: KeyRow[];
}

type KeyAgg = { deltas: number[]; action: string | null; hotkey: string | null };

export function DelayAnalysis({ results: externalResults }: DelayAnalysisProps) {
  const [internalResults, setInternalResults] = useState<ParseResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [config, setConfig] = useState<DelayConfig>({ ...DEFAULT_DELAY_CONFIG });
  const [expandedPages, setExpandedPages] = useState<Record<string, boolean>>({});

  const isControlled = externalResults != null;
  const results = isControlled ? (externalResults ?? []) : internalResults;

  const handleFileUpload = useCallback(async (files: File[]) => {
    setIsProcessing(true);
    try {
      const newResults: ParseResult[] = [];
      for (const file of files ?? []) {
        const content = await file?.text?.();
        if (content) {
          newResults.push(parseKtraceLog(content, file?.name ?? 'unknown'));
        }
      }
      setInternalResults((prev) => [...(prev ?? []), ...newResults]);
      const supported = newResults.filter((r) => r?.delay?.hasSpeechStopped).length;
      toast.success(`Processed ${newResults.length} log file(s)`, {
        description: `${supported} VAD log(s) analyzed, ${newResults.length - supported} skipped (no SPEECH_STOPPED)`,
      });
    } catch (err) {
      console.error('Error parsing log files for delay analysis:', err);
      toast.error('Failed to parse log file(s)');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleClearAll = useCallback(() => {
    setInternalResults([]);
    toast.info('All data cleared');
  }, []);

  // Split supported (VAD) vs unsupported (STT-only) files
  const supported = useMemo(
    () => (results ?? []).filter((r) => r?.delay?.hasSpeechStopped),
    [results],
  );
  const unsupported = useMemo(
    () => (results ?? []).filter((r) => r && !r.delay?.hasSpeechStopped),
    [results],
  );

  // Apply thresholds LIVE — recompute whenever ceiling/floor change
  const perFile = useMemo(
    () =>
      supported.map((r) => ({
        agent: r.delay.agent,
        fileName: r.fileName,
        samples: (r.delay.rawSamples ?? []).filter(
          (s) => s.delta >= config.floorMs && s.delta <= config.ceilingMs,
        ),
      })),
    [supported, config.ceilingMs, config.floorMs],
  );

  // (A) Overall summary
  const overall = useMemo(() => {
    const allDeltas = perFile.flatMap((f) => f.samples.map((s) => s.delta));
    const pages = new Set<string>();
    const agents = new Set<string>();
    perFile.forEach((f) => {
      agents.add(f.agent);
      f.samples.forEach((s) => pages.add(s.page));
    });
    return {
      stat: summarizeDeltas(allDeltas),
      nAgents: agents.size,
      nPages: pages.size,
    };
  }, [perFile]);

  // (B) Overall agent comparison
  const agentRows: AgentRow[] = useMemo(() => {
    const rows = perFile.map((f) => ({
      agent: f.agent,
      fileName: f.fileName,
      stat: summarizeDeltas(f.samples.map((s) => s.delta)),
    }));
    return rows
      .filter((r) => r.stat)
      .sort((a, b) => (a.stat!.median - b.stat!.median));
  }, [perFile]);

  const slowestMedian = useMemo(
    () => Math.max(1, ...agentRows.map((r) => r.stat?.median ?? 0)),
    [agentRows],
  );

  // (D) Per-page agent comparison + (7) per-key breakdown
  const pageSections: PageSection[] = useMemo(() => {
    // page -> agent -> deltas
    const pageAgent = new Map<string, Map<string, number[]>>();
    // page -> agent -> key -> KeyAgg
    const keyMap = new Map<string, Map<string, Map<string, KeyAgg>>>();

    for (const f of perFile) {
      for (const s of f.samples) {
        // page -> agent -> deltas
        if (!pageAgent.has(s.page)) pageAgent.set(s.page, new Map());
        const am = pageAgent.get(s.page)!;
        if (!am.has(f.agent)) am.set(f.agent, []);
        am.get(f.agent)!.push(s.delta);

        // page -> agent -> key -> KeyAgg
        if (!keyMap.has(s.page)) keyMap.set(s.page, new Map());
        const kagents = keyMap.get(s.page)!;
        if (!kagents.has(f.agent)) kagents.set(f.agent, new Map());
        const keys = kagents.get(f.agent)!;
        if (!keys.has(s.key)) keys.set(s.key, { deltas: [], action: null, hotkey: null });
        const agg = keys.get(s.key)!;
        agg.deltas.push(s.delta);
        if (!agg.action && s.action) agg.action = s.action;
        if (!agg.hotkey && s.hotkey) agg.hotkey = s.hotkey;
      }
    }

    const sections: PageSection[] = [];
    for (const [page, am] of pageAgent.entries()) {
      const rows = Array.from(am.entries())
        .map(([agent, deltas]) => ({ agent, stat: summarizeDeltas(deltas)! }))
        .filter((r) => r.stat)
        .sort((a, b) => a.stat.median - b.stat.median);

      const allDeltas = Array.from(am.values()).flat();
      const total = allDeltas.length;
      const pageMedian = summarizeDeltas(allDeltas)?.median ?? 0;

      // per-key rows, in ranked-agent order
      const keyRows: KeyRow[] = [];
      for (const r of rows) {
        const keys = keyMap.get(page)?.get(r.agent);
        if (!keys) continue;
        const kr = Array.from(keys.entries())
          .map(([key, info]) => ({
            agent: r.agent,
            key,
            label: info.action || info.hotkey || '',
            stat: summarizeDeltas(info.deltas)!,
          }))
          .sort((a, b) => b.stat.count - a.stat.count || a.stat.median - b.stat.median);
        keyRows.push(...kr);
      }

      sections.push({ page, rows, total, pageMedian, keyRows });
    }

    return sections.sort((a, b) => b.total - a.total);
  }, [perFile]);

  const hasData = (results?.length ?? 0) > 0;
  const hasSupported = supported.length > 0;

  const togglePage = (page: string) =>
    setExpandedPages((prev) => ({ ...prev, [page]: !prev[page] }));

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-display font-semibold tracking-tight text-foreground mb-1">
          Agent Response Delay
        </h2>
        <p className="text-muted-foreground text-sm max-w-3xl">
          Measures how quickly a human agent reacts after the customer stops speaking
          <span className="text-foreground font-medium"> (delay = agent key press − SPEECH_STOPPED)</span>.
          Lower delay = a more attentive, faster agent. Analysis runs only on VAD logs
          (those containing <code className="text-xs bg-muted px-1 rounded">SPEECH_STOPPED</code>);
          STT-only logs are flagged as unsupported and excluded.
        </p>
      </div>

      {/* Upload Area (self-contained mode only) */}
      {!isControlled && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <FileUploader onUpload={handleFileUpload} isProcessing={isProcessing} />
        </motion.section>
      )}

      {/* Controls bar */}
      <AnimatePresence>
        {hasData && !isControlled && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6"
          >
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  {results.length} log file{results.length !== 1 ? 's' : ''} processed •{' '}
                  {supported.length} analyzed
                </span>
              </div>
              <Button variant="destructive" size="sm" onClick={handleClearAll}>
                <Trash2 className="w-4 h-4 mr-1" />
                Clear All
              </Button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Threshold config controls */}
      {hasSupported && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 bg-card rounded-[var(--radius-lg)] p-5"
          style={{ boxShadow: 'var(--shadow-md)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-display font-semibold text-card-foreground">
              Threshold Configuration
            </h3>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Ceiling (ms)
              </label>
              <input
                type="number"
                step={50}
                min={0}
                value={config.ceilingMs}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, ceilingMs: Number(e.target.value) || 0 }))
                }
                className="w-28 px-3 py-1.5 text-sm rounded-[var(--radius)] border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Floor (ms)
              </label>
              <input
                type="number"
                step={50}
                min={0}
                value={config.floorMs}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, floorMs: Number(e.target.value) || 0 }))
                }
                className="w-28 px-3 py-1.5 text-sm rounded-[var(--radius)] border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfig({ ...DEFAULT_DELAY_CONFIG })}
              className="gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3 max-w-3xl">
            Delays below the <span className="font-medium">floor</span> ({config.floorMs}ms) are treated as
            anticipation (the agent pressed a key essentially at the same instant speech stopped);
            delays above the <span className="font-medium">ceiling</span> ({config.ceilingMs}ms) are treated as
            deliberation (the agent was doing something else). Typical human reaction to silence is ~300–600ms.
            Thresholds recompute live without re-parsing.
          </p>
        </motion.section>
      )}

      {/* Unsupported note */}
      {unsupported.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-6 flex items-start gap-3 rounded-[var(--radius)] border border-amber-500/40 bg-amber-500/10 p-4"
        >
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-foreground mb-1">
              {unsupported.length} file{unsupported.length !== 1 ? 's' : ''} excluded (no VAD / SPEECH_STOPPED)
            </p>
            <p className="text-muted-foreground">
              Response-delay analysis requires Voice Activity Detection logs. These STT-only agents were skipped:{' '}
              <span className="text-foreground">
                {unsupported.map((r) => r.delay.agent).join(', ')}
              </span>
            </p>
          </div>
        </motion.div>
      )}

      {/* Empty / no-supported state */}
      {!hasSupported && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
          {hasData ? (
            <>
              <AlertTriangle className="w-12 h-12 text-amber-500/50 mx-auto mb-4" />
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                None of the uploaded logs contain <code className="text-xs bg-muted px-1 rounded">SPEECH_STOPPED</code>{' '}
                events. Response-delay analysis only works on VAD logs.
              </p>
            </>
          ) : (
            <>
              <Timer className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
              <p className="text-muted-foreground text-sm">
                Upload one or more KTRACE VAD log files to measure agent response delay
              </p>
            </>
          )}
        </motion.div>
      )}

      {/* ============================ RESULTS ============================ */}
      {hasSupported && (
        <div className="space-y-8">
          {/* (A) Overall summary cards */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <SummaryCard label="Median" value={fmt(overall.stat?.median)} accent={overall.stat ? speedColor(overall.stat.median) : ''} />
              <SummaryCard label="Mean" value={fmt(overall.stat?.mean)} />
              <SummaryCard label="Samples" value={`${overall.stat?.count ?? 0}`} />
              <SummaryCard label="Agents" value={`${overall.nAgents}`} icon={<Users className="w-4 h-4" />} />
              <SummaryCard label="Pages" value={`${overall.nPages}`} icon={<Layers className="w-4 h-4" />} />
              <SummaryCard label="IQR (p25–p75)" value={overall.stat ? `${overall.stat.p25}–${overall.stat.p75}ms` : '—'} />
            </div>
          </motion.section>

          {/* (B) Overall agent comparison */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="bg-card rounded-[var(--radius-lg)] p-6"
            style={{ boxShadow: 'var(--shadow-md)' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-display font-semibold text-card-foreground">
                Agent Comparison — Fastest First
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3 font-medium">#</th>
                    <th className="py-2 pr-3 font-medium">Agent</th>
                    <th className="py-2 pr-3 font-medium text-right">Samples</th>
                    <th className="py-2 pr-3 font-medium text-right">Median</th>
                    <th className="py-2 pr-3 font-medium text-right">Mean</th>
                    <th className="py-2 pr-3 font-medium text-right">IQR</th>
                    <th className="py-2 pl-3 font-medium w-1/3">Relative speed</th>
                  </tr>
                </thead>
                <tbody>
                  {agentRows.map((r, i) => (
                    <tr key={r.agent} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                      <td className="py-2 pr-3 font-medium text-foreground">
                        {r.agent}
                        {i === 0 && (
                          <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            FASTEST
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{r.stat?.count}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${speedColor(r.stat?.median ?? 0)}`}>
                        {fmt(r.stat?.median)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{fmt(r.stat?.mean)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {r.stat ? `${r.stat.p25}–${r.stat.p75}` : '—'}
                      </td>
                      <td className="py-2 pl-3">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${speedBg(r.stat?.median ?? 0)}`}
                            style={{ width: `${Math.round(((r.stat?.median ?? 0) / slowestMedian) * 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.section>

          {/* (D) Per-page agent comparison + (7) per-key breakdown */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Layers className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-display font-semibold text-foreground">
                Per-Page Agent Comparison
              </h3>
            </div>
            <div className="space-y-4">
              {pageSections.map((section) => {
                const isExpanded = !!expandedPages[section.page];
                return (
                  <div
                    key={section.page}
                    className="bg-card rounded-[var(--radius-lg)] p-5"
                    style={{ boxShadow: 'var(--shadow-md)' }}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-base font-display font-semibold text-card-foreground">
                          {section.page}
                        </h4>
                        <span className="text-xs text-muted-foreground">
                          {section.total} samples • page median{' '}
                          <span className={`font-semibold ${speedColor(section.pageMedian)}`}>
                            {section.pageMedian}ms
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Agent ranking for this page */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-muted-foreground border-b border-border">
                            <th className="py-1.5 pr-3 font-medium">#</th>
                            <th className="py-1.5 pr-3 font-medium">Agent</th>
                            <th className="py-1.5 pr-3 font-medium text-right">N</th>
                            <th className="py-1.5 pr-3 font-medium text-right">Median</th>
                            <th className="py-1.5 pr-3 font-medium text-right">Mean</th>
                            <th className="py-1.5 pr-3 font-medium text-right">Min</th>
                            <th className="py-1.5 pr-3 font-medium text-right">Max</th>
                            <th className="py-1.5 pr-3 font-medium text-right">IQR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((r, i) => (
                            <tr key={r.agent} className="border-b border-border/50 last:border-0">
                              <td className="py-1.5 pr-3 text-muted-foreground">{i + 1}</td>
                              <td className="py-1.5 pr-3 font-medium text-foreground">
                                {r.agent}
                                {i === 0 && (
                                  <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                    FASTEST
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{r.stat.count}</td>
                              <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${speedColor(r.stat.median)}`}>
                                {r.stat.median}ms
                              </td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{r.stat.mean}ms</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{r.stat.min}ms</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{r.stat.max}ms</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                                {r.stat.p25}–{r.stat.p75}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Per-key breakdown (collapsible) */}
                    {section.keyRows.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border/60">
                        <button
                          onClick={() => togglePage(section.page)}
                          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:opacity-80 transition-opacity"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          {isExpanded ? 'Hide' : 'Show'} per-key breakdown ({section.keyRows.length} keys)
                          <ChevronDown
                            className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          />
                        </button>
                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="overflow-x-auto mt-3">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-muted-foreground border-b border-border">
                                      <th className="py-1.5 pr-3 font-medium">Agent</th>
                                      <th className="py-1.5 pr-3 font-medium">Key</th>
                                      <th className="py-1.5 pr-3 font-medium">Action</th>
                                      <th className="py-1.5 pr-3 font-medium text-right">N</th>
                                      <th className="py-1.5 pr-3 font-medium text-right">Median</th>
                                      <th className="py-1.5 pr-3 font-medium text-right">Mean</th>
                                      <th className="py-1.5 pr-3 font-medium text-right">Min</th>
                                      <th className="py-1.5 pr-3 font-medium text-right">Max</th>
                                      <th className="py-1.5 pr-3 font-medium text-right">IQR</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {section.keyRows.map((kr, i) => (
                                      <tr
                                        key={`${kr.agent}-${kr.key}-${i}`}
                                        className="border-b border-border/40 last:border-0"
                                      >
                                        <td className="py-1.5 pr-3 text-muted-foreground">{kr.agent}</td>
                                        <td className="py-1.5 pr-3">
                                          <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded text-foreground">
                                            {kr.key}
                                          </code>
                                        </td>
                                        <td className="py-1.5 pr-3 text-muted-foreground">
                                          {kr.label || <span className="italic opacity-60">—</span>}
                                        </td>
                                        <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{kr.stat.count}</td>
                                        <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${speedColor(kr.stat.median)}`}>
                                          {kr.stat.median}ms
                                        </td>
                                        <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{kr.stat.mean}ms</td>
                                        <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{kr.stat.min}ms</td>
                                        <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{kr.stat.max}ms</td>
                                        <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                                          {kr.stat.p25}–{kr.stat.p75}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.section>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
function SummaryCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-[var(--radius)] p-4" style={{ boxShadow: 'var(--shadow-md)' }}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-display font-bold tabular-nums ${accent || 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}
