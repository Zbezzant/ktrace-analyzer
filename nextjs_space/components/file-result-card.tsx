'use client';

import { useState, useCallback } from 'react';
import { type ParseResult, type PageStats } from '@/lib/ktrace-parser';
import { StatsCards } from '@/components/stats-cards';
import { DataTable } from '@/components/data-table';
import { CallEndChart } from '@/components/call-end-chart';
import { CallEndPieChart } from '@/components/call-end-pie-chart';
import { SubTabs } from '@/components/sub-tabs';
import { motion } from 'framer-motion';
import { FileText, ChevronDown, ChevronUp, Hash, KeyRound, Radio, Table2, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
