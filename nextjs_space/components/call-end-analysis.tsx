'use client';

import { useState, useCallback } from 'react';
import { parseKtraceLog, aggregateResults, type ParseResult, type PageStats } from '@/lib/ktrace-parser';
import { FileUploader } from '@/components/file-uploader';
import { StatsCards } from '@/components/stats-cards';
import { DataTable } from '@/components/data-table';
import { CallEndChart } from '@/components/call-end-chart';
import { CallEndPieChart } from '@/components/call-end-pie-chart';
import { FileResultCard } from '@/components/file-result-card';
import { motion, AnimatePresence } from 'framer-motion';
import { SubTabs } from '@/components/sub-tabs';
import { BarChart3, Upload, Trash2, FileText, Layers, List, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type ViewMode = 'individual' | 'combined';

export function CallEndAnalysis() {
  const [results, setResults] = useState<ParseResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('individual');
  const [combinedSortField, setCombinedSortField] = useState<'pageName' | 'plusKeyCount' | 'protocallStopCount' | 'totalCount'>('totalCount');
  const [combinedSortDir, setCombinedSortDir] = useState<'asc' | 'desc'>('desc');

  const aggregated = aggregateResults(results);

  const combinedSortedStats = [...(aggregated?.pageStats ?? [])].sort((a: PageStats, b: PageStats) => {
    const aVal = a?.[combinedSortField] ?? 0;
    const bVal = b?.[combinedSortField] ?? 0;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return combinedSortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return combinedSortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const handleCombinedSort = useCallback((field: 'pageName' | 'plusKeyCount' | 'protocallStopCount' | 'totalCount') => {
    setCombinedSortDir((prev: string) => combinedSortField === field ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setCombinedSortField(field);
  }, [combinedSortField]);

  const handleFileUpload = useCallback(async (files: File[]) => {
    setIsProcessing(true);
    try {
      const newResults: ParseResult[] = [];
      for (const file of (files ?? [])) {
        const content = await file?.text?.();
        if (content) {
          const result = parseKtraceLog(content, file?.name ?? 'unknown');
          newResults.push(result);
        }
      }
      setResults((prev: ParseResult[]) => [...(prev ?? []), ...newResults]);
      toast.success(`Processed ${newResults?.length ?? 0} log file(s)`, {
        description: `Found ${newResults.reduce((s: number, r: ParseResult) => s + (r?.totalCalls ?? 0), 0)} call end events`,
      });
    } catch (err: any) {
      console.error('Error parsing log files:', err);
      toast.error('Failed to parse log file(s)');
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleClearAll = useCallback(() => {
    setResults([]);
    setViewMode('individual');
    toast.info('All data cleared');
  }, []);

  const hasData = (results?.length ?? 0) > 0;
  const hasMultipleFiles = (results?.length ?? 0) > 1;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-display font-semibold tracking-tight text-foreground mb-1">
          Call End Analysis
        </h2>
        <p className="text-muted-foreground text-sm max-w-2xl">
          Track where and how calls end across script pages. Identify call drop patterns
          with detailed page-by-page breakdowns.
        </p>
      </div>

      {/* Upload Area */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <FileUploader onUpload={handleFileUpload} isProcessing={isProcessing} />
      </motion.section>

      {/* Controls Bar: File count, View Toggle, Clear */}
      <AnimatePresence>
        {hasData && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-8"
          >
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  {results?.length ?? 0} log file{(results?.length ?? 0) !== 1 ? 's' : ''} processed
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* View Mode Toggle - only show when multiple files */}
                {hasMultipleFiles && (
                  <div className="flex items-center bg-muted rounded-[var(--radius)] p-1">
                    <Button
                      variant={viewMode === 'individual' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('individual')}
                      className="gap-1.5 text-xs h-8"
                    >
                      <List className="w-3.5 h-3.5" />
                      Individual
                    </Button>
                    <Button
                      variant={viewMode === 'combined' ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('combined')}
                      className="gap-1.5 text-xs h-8"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      Combined
                    </Button>
                  </div>
                )}

                <Button variant="destructive" size="sm" onClick={handleClearAll}>
                  <Trash2 className="w-4 h-4 mr-1" />
                  Clear All
                </Button>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ======= INDIVIDUAL VIEW ======= */}
      <AnimatePresence mode="wait">
        {hasData && (viewMode === 'individual' || !hasMultipleFiles) && (
          <motion.div
            key="individual-view"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            {(results ?? []).map((result: ParseResult, idx: number) => (
              <FileResultCard key={`${result?.fileName ?? ''}-${idx}`} result={result} index={idx} />
            ))}
          </motion.div>
        )}

        {/* ======= COMBINED VIEW ======= */}
        {hasData && viewMode === 'combined' && hasMultipleFiles && (
          <motion.div
            key="combined-view"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="space-y-8"
          >
            {/* Combined Stats */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Layers className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-display font-semibold text-foreground">
                  Combined Results ({results?.length ?? 0} files)
                </h2>
              </div>
              <StatsCards
                totalCalls={aggregated?.totalCalls ?? 0}
                totalPlusKey={aggregated?.totalPlusKey ?? 0}
                totalProtocallStop={aggregated?.totalProtocallStop ?? 0}
                pageCount={aggregated?.pageStats?.length ?? 0}
              />
            </motion.section>

            {/* Combined Tabbed Content */}
            {(combinedSortedStats?.length ?? 0) > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
              >
                <div className="bg-card rounded-[var(--radius-lg)] p-6" style={{ boxShadow: 'var(--shadow-md)' }}>
                  <SubTabs
                    tabs={[
                      { key: 'breakdown', label: 'Detailed Breakdown', icon: <Table2 className="w-4 h-4" /> },
                      { key: 'charts', label: 'Charts', icon: <BarChart3 className="w-4 h-4" /> },
                    ]}
                    defaultTab="breakdown"
                    id="call-end-combined"
                  >
                    {(activeTab) => (
                      <>
                        {activeTab === 'breakdown' && (
                          <DataTable
                            stats={combinedSortedStats}
                            sortField={combinedSortField}
                            sortDir={combinedSortDir}
                            onSort={handleCombinedSort}
                          />
                        )}
                        {activeTab === 'charts' && (
                          <div className="space-y-8">
                            <div>
                              <h4 className="text-sm font-display font-semibold mb-3 text-card-foreground">Combined Call End Distribution</h4>
                              <CallEndChart pageStats={combinedSortedStats} />
                            </div>
                            <div>
                              <h4 className="text-sm font-display font-semibold mb-3 text-card-foreground">Hang Up Percentage by Page</h4>
                              <CallEndPieChart pageStats={combinedSortedStats} callEndEvents={(results ?? []).flatMap((r) => r?.callEndEvents ?? [])} />
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </SubTabs>
                </div>
              </motion.section>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty State */}
      {!hasData && !isProcessing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16"
        >
          <Upload className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Upload a KTRACE log file to get started</p>
        </motion.div>
      )}
    </div>
  );
}
