'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  Trash2,
  FileText,
  Upload,
  Clock,
  ChevronDown,
  CheckCircle2,
  Info,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileUploader } from '@/components/file-uploader';
import { toast } from 'sonner';
import type {
  TimingAnalysisResult,
  TimingAttribute,
  TimingLevel,
  TimingSummary,
} from '@/lib/timing-types';

function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${Math.round(v)} ms`;
}

function LevelBadge({ level }: { level: number | null }) {
  if (level === 3) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Level 3 — Human Agent
      </span>
    );
  }
  if (level === 4) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
        <Info className="w-3.5 h-3.5" />
        Level 4 — AI Agent
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
      Unknown Level
    </span>
  );
}

function SummaryStat({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold text-foreground ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function SummaryRow({ summary, isInterrupt }: { summary: TimingSummary; isInterrupt: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      <SummaryStat label="Samples" value={String(summary.n)} />
      <SummaryStat label="Mean" value={fmtMs(summary.mean)} />
      <SummaryStat label="Median" value={fmtMs(summary.median)} />
      <SummaryStat label="Std Dev" value={fmtMs(summary.std)} />
      <SummaryStat label="Range" value={`${fmtMs(summary.min)} – ${fmtMs(summary.max)}`} />
      {isInterrupt && summary.n > 0 && (
        <SummaryStat
          label="Human Stopped"
          value={`${summary.stopped_count ?? 0} / ${summary.n}`}
        />
      )}
    </div>
  );
}

function AttributeCard({ attr }: { attr: TimingAttribute }) {
  const [open, setOpen] = useState(false);
  const hasData = attr.overall.n > 0;

  return (
    <div className="bg-card rounded-[var(--radius-lg)] border border-border overflow-hidden" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h4 className="text-base font-display font-semibold text-card-foreground flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              {attr.label}
            </h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">{attr.description}</p>
          </div>
          {!hasData && (
            <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              No samples
            </span>
          )}
        </div>

        {hasData ? (
          <div className="rounded-[var(--radius)] bg-muted/40 p-4">
            <SummaryRow summary={attr.overall} isInterrupt={attr.is_interrupt} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            No measurable instances of this attribute were found in the uploaded log(s).
          </p>
        )}
      </div>

      {hasData && attr.pages.length > 0 && (
        <div className="border-t border-border">
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <span>Breakdown by page &amp; message ({attr.pages.length} page{attr.pages.length !== 1 ? 's' : ''})</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-5 space-y-4">
                  {attr.pages.map((page) => (
                    <div key={page.page} className="rounded-[var(--radius)] border border-border">
                      <div className="px-4 py-2.5 bg-muted/40 border-b border-border">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{page.page}</span>
                          <span className="text-xs font-mono text-muted-foreground">
                            n={page.summary.n} · mean {fmtMs(page.summary.mean)} · median {fmtMs(page.summary.median)}
                          </span>
                        </div>
                      </div>
                      <div className="divide-y divide-border">
                        {page.messages.map((msg, mi) => (
                          <div key={mi} className="px-4 py-2.5">
                            <p className="text-xs text-foreground mb-1.5 font-medium">{msg.message}</p>
                            <div className="text-[11px]">
                              <SummaryRow summary={msg.summary} isInterrupt={attr.is_interrupt} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function LevelSection({ level }: { level: TimingLevel }) {
  const isLevel3 = level.level === 3;
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-4"
    >
      <div className="flex items-center gap-3 flex-wrap">
        <LevelBadge level={level.level} />
        <span className="text-sm text-muted-foreground">
          {level.fileCount} file{level.fileCount !== 1 ? 's' : ''} combined
        </span>
      </div>

      {!isLevel3 && (
        <div className="flex items-start gap-3 rounded-[var(--radius)] border border-amber-300/60 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
          <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
            These are <strong>Level {level.level}</strong> logs. Timing analysis is only
            meaningful for <strong>Level 3</strong> (human-driven) logs — Level 4 timing is
            configuration-driven, so few or no human-derived samples are expected here.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {level.attributes.map((attr) => (
          <AttributeCard key={attr.key} attr={attr} />
        ))}
      </div>
    </motion.section>
  );
}

export function TimingAnalysis() {
  const [result, setResult] = useState<TimingAnalysisResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleUpload = useCallback(async (files: File[]) => {
    if (!files?.length) return;
    setIsProcessing(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);

      const res = await fetch('/api/analyze', { method: 'POST', body: fd });
      const data: TimingAnalysisResult = await res.json();

      if (!res.ok || data?.error) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }

      setResult((prev) => {
        // Merge newly analyzed files into existing results, re-running is per request,
        // so we simply replace with the latest combined result for clarity.
        if (!prev) return data;
        return {
          files: [...prev.files, ...(data.files ?? [])],
          levels: data.levels, // latest batch's per-level aggregation
        };
      });

      const lvls = (data.files ?? []).map((f) => f.level).filter(Boolean);
      toast.success(`Analyzed ${data.files?.length ?? 0} file(s)`, {
        description: lvls.length ? `Detected level(s): ${Array.from(new Set(lvls)).join(', ')}` : undefined,
      });
    } catch (err: any) {
      console.error('Timing analysis error:', err);
      toast.error('Analysis failed', { description: err?.message });
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleClear = useCallback(() => {
    setResult(null);
    toast.info('Analysis cleared');
  }, []);

  const hasData = !!result && (result.files?.length ?? 0) > 0;
  const hasLevel3 = (result?.files ?? []).some((f) => f.level === 3);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-display font-semibold tracking-tight text-foreground mb-1">
          Timing Attribute Analysis
        </h2>
        <p className="text-muted-foreground text-sm max-w-2xl">
          Extract the five human-derived timing attributes (Cached Action, Suggestion Filter,
          Ignore Interrupt, Speech Interrupt &amp; STT VAD Silence) used to configure the
          conversational AI. Powered by <code className="font-mono text-xs">analyzer.py</code>.
        </p>
      </div>

      {/* Prominent global notice */}
      <div className="mb-6 flex items-start gap-3 rounded-[var(--radius-lg)] border-2 border-primary/30 bg-primary/5 px-5 py-4">
        <AlertTriangle className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-foreground">
            Analysis is only necessary for Level 3 ktraces
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Only Level 3 logs (human agent + AI suggestions) contain the human-driven behavior this
            analysis measures. The detected level of every uploaded file is shown below. Level 4
            (AI agent) logs are configuration-driven and will produce few or no samples.
          </p>
        </div>
      </div>

      {/* Upload */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <FileUploader onUpload={handleUpload} isProcessing={isProcessing} />
      </motion.section>

      {/* Detected levels per file */}
      <AnimatePresence>
        {hasData && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-8"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  Detected ktrace level per file
                </span>
              </div>
              <Button variant="destructive" size="sm" onClick={handleClear}>
                <Trash2 className="w-4 h-4 mr-1" />
                Clear
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {(result?.files ?? []).map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate font-mono">{f.name}</p>
                    {f.error ? (
                      <p className="text-xs text-destructive mt-0.5">{f.error}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {f.eventCount ?? 0} events · {f.totalSamples ?? 0} samples
                      </p>
                    )}
                  </div>
                  <LevelBadge level={f.level} />
                </div>
              ))}
            </div>

            {hasData && !hasLevel3 && (
              <div className="mt-4 flex items-start gap-3 rounded-[var(--radius)] border border-amber-300/60 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                  None of the uploaded files were detected as <strong>Level 3</strong>. Since
                  analysis is only necessary for Level 3 ktraces, the results below will be
                  sparse. Upload a Level 3 log to see meaningful timing attributes.
                </p>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {/* Results by level */}
      {hasData && (result?.levels?.length ?? 0) > 0 && (
        <div className="space-y-10">
          {(result?.levels ?? [])
            .slice()
            .sort((a, b) => a.level - b.level)
            .map((lvl) => (
              <div key={lvl.level}>
                <div className="flex items-center gap-2 mb-4">
                  <Layers className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-display font-semibold text-foreground">
                    Level {lvl.level} Results
                  </h3>
                </div>
                <LevelSection level={lvl} />
              </div>
            ))}
        </div>
      )}

      {/* Empty state */}
      {!hasData && !isProcessing && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
          <Upload className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">
            Upload a KTRACE log file to run the timing attribute analysis
          </p>
        </motion.div>
      )}
    </div>
  );
}
