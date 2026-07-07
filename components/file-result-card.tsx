'use client';

import { useState, useCallback } from 'react';
import { type ParseResult, type PageStats, FULL_TRACE_MASK } from '@/lib/ktrace-parser';
import { StatsCards } from '@/components/stats-cards';
import { DataTable } from '@/components/data-table';
import { CallEndChart } from '@/components/call-end-chart';
import { CallEndPieChart } from '@/components/call-end-pie-chart';
import { SubTabs } from '@/components/sub-tabs';
import { motion } from 'framer-motion';
import { FileText, ChevronDown, ChevronUp, Hash, KeyRound, Radio, Table2, BarChart3, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

interface FileResultCardProps {
  result: ParseResult;
  index: number;
}

export function FileResultCard({ result, index }: FileResultCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [sortField, setSortField] = useState<'pageName' | 'plusKeyCount' | 'protocallStopCount' | 'totalCount'>('totalCount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = useCallback((field: 'pageName' | 'plusKeyCount' | 'protocallStopCount' | 'totalCount') => {
    setSortDir((prev: string) => sortField === field ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setSortField(field);
  }, [sortField]);

  const sortedStats = [...(result?.pageStats ?? [])].sort((a: PageStats, b: PageStats) => {
    const aVal = a?.[sortField] ?? 0;
    const bVal = b?.[sortField] ?? 0;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  // Trace-log mismatch warning: the DebugLog Trace Mask at the start of the
  // KTRACE is NOT the full 0xFFFFFFFF AND SPEECH_STOPPED events are missing.
  const traceMask = result?.traceMask ?? null;
  const traceMaskNotFull = traceMask !== null && traceMask !== FULL_TRACE_MASK;
  const showTraceLogMismatchWarning = traceMaskNotFull && (result?.missingSpeechStopped ?? false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className="bg-card rounded-[var(--radius-lg)] overflow-hidden"
      style={{ boxShadow: 'var(--shadow-md)' }}
    >
      {/* Collapsible Header */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-display font-semibold text-foreground truncate">
              {result?.fileName ?? 'Unknown File'}
            </h3>
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-0.5">
              <span className="flex items-center gap-1">
                <Hash className="w-3 h-3" />
                {result?.totalCalls ?? 0} calls
              </span>
              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                <KeyRound className="w-3 h-3" />
                {result?.totalPlusKey ?? 0}
              </span>
              <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
                <Radio className="w-3 h-3" />
                {result?.totalProtocallStop ?? 0}
              </span>
            </div>
          </div>
        </div>
        <div className="shrink-0 ml-3">
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expandable Content */}
      {expanded && (
        <div className="px-6 pb-6 space-y-6 border-t border-border">
          {/* Trace log mismatch warning */}
          {showTraceLogMismatchWarning && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="pt-5"
            >
              <Alert
                variant="destructive"
                className="border-2 border-destructive bg-destructive/10 shadow-md"
              >
                <AlertTriangle className="h-5 w-5" />
                <AlertTitle className="text-base font-display font-semibold">
                  Trace log mismatch detected — may be causing the issue
                </AlertTitle>
                <AlertDescription className="space-y-1.5">
                  <p>
                    The DebugLog Trace Mask at the beginning of this KTRACE is{' '}
                    <span className="font-mono font-semibold">{traceMask}</span>, not the
                    expected <span className="font-mono font-semibold">{FULL_TRACE_MASK}</span>,
                    and <span className="font-semibold">SPEECH_STOPPED</span> events are missing
                    from the log.
                  </p>
                  <p className="text-xs opacity-90">
                    Because tracing was not fully enabled, speech-stop events were likely not
                    captured. This trace log mismatch may be the cause of the observed problem
                    rather than an actual issue in the call flow. Re-capture the KTRACE with the
                    full trace mask (<span className="font-mono">{FULL_TRACE_MASK}</span>) to
                    confirm.
                  </p>
                  <p className="text-xs opacity-90">
                    Detected {result?.speechStartedCount ?? 0} SPEECH_STARTED vs{' '}
                    {result?.speechStoppedCount ?? 0} SPEECH_STOPPED event(s).
                  </p>
                </AlertDescription>
              </Alert>
            </motion.div>
          )}

          {/* Stats */}
          <div className="pt-5">
            <StatsCards
              totalCalls={result?.totalCalls ?? 0}
              totalPlusKey={result?.totalPlusKey ?? 0}
              totalProtocallStop={result?.totalProtocallStop ?? 0}
              pageCount={result?.pageStats?.length ?? 0}
            />
          </div>

          {/* Tabbed Content */}
          {(sortedStats?.length ?? 0) > 0 && (
            <SubTabs
              tabs={[
                { key: 'breakdown', label: 'Detailed Breakdown', icon: <Table2 className="w-4 h-4" /> },
                { key: 'charts', label: 'Charts', icon: <BarChart3 className="w-4 h-4" /> },
              ]}
              defaultTab="breakdown"
              id={`file-tabs-${index}`}
            >
              {(activeTab) => (
                <>
                  {activeTab === 'breakdown' && (
                    <DataTable
                      stats={sortedStats}
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  )}
                  {activeTab === 'charts' && (
                    <div className="space-y-8">
                      <div>
                        <h4 className="text-sm font-display font-semibold mb-3 text-card-foreground">Call End Distribution</h4>
                        <CallEndChart pageStats={sortedStats} />
                      </div>
                      <div>
                        <h4 className="text-sm font-display font-semibold mb-3 text-card-foreground">Hang Up Percentage by Page</h4>
                        <CallEndPieChart pageStats={sortedStats} callEndEvents={result?.callEndEvents ?? []} />
                      </div>
                    </div>
                  )}
                </>
              )}
            </SubTabs>
          )}
        </div>
      )}
    </motion.div>
  );
}
