'use client';

import { type PageStats } from '@/lib/ktrace-parser';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

interface DataTableProps {
  stats: PageStats[];
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: 'pageName' | 'plusKeyCount' | 'protocallStopCount' | 'totalCount') => void;
}

const columns = [
  { key: 'pageName', label: 'Page Name' },
  { key: 'plusKeyCount', label: '+ Key Count' },
  { key: 'protocallStopCount', label: 'Protocall Stop Count' },
] as const;

function pct(value: number, total: number): string {
  if (total === 0) return '0.0%';
  return ((value / total) * 100).toFixed(1) + '%';
}

export function DataTable({ stats, sortField, sortDir, onSort }: DataTableProps) {
  const getSortIcon = (field: string) => {
    if (sortField !== field) return <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground/50" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5 text-primary" />
      : <ArrowDown className="w-3.5 h-3.5 text-primary" />;
  };

  const totalPlusKey = (stats ?? []).reduce((s: number, p: PageStats) => s + (p?.plusKeyCount ?? 0), 0);
  const totalProtocallStop = (stats ?? []).reduce((s: number, p: PageStats) => s + (p?.protocallStopCount ?? 0), 0);
  const totalAll = totalPlusKey + totalProtocallStop;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col: any) => (
              <th
                key={col?.key}
                className="text-left py-3 px-4 font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none"
                onClick={() => onSort?.(col?.key as any)}
              >
                <div className="flex items-center gap-1.5">
                  {col?.label ?? ''}
                  {getSortIcon(col?.key ?? '')}
                </div>
              </th>
            ))}
            <th className="text-left py-3 px-4 font-medium text-muted-foreground select-none">
              <div className="flex items-center gap-1.5">
                Agent Hang Up %
              </div>
            </th>
            <th className="text-left py-3 px-4 font-medium text-muted-foreground select-none">
              <div className="flex items-center gap-1.5">
                Customer Hang Up %
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {(stats ?? []).map((stat: PageStats, idx: number) => {
            return (
              <tr
                key={stat?.pageName ?? idx}
                className="border-b border-border/50 hover:bg-muted/50 transition-colors"
              >
                <td className="py-3 px-4 font-medium text-foreground">{stat?.pageName ?? ''}</td>
                <td className="py-3 px-4 font-mono text-blue-600 dark:text-blue-400">{stat?.plusKeyCount ?? 0}</td>
                <td className="py-3 px-4 font-mono text-orange-600 dark:text-orange-400">{stat?.protocallStopCount ?? 0}</td>
                <td className="py-3 px-4 font-mono text-blue-600 dark:text-blue-400">{pct(stat?.plusKeyCount ?? 0, totalPlusKey)}</td>
                <td className="py-3 px-4 font-mono text-orange-600 dark:text-orange-400">{pct(stat?.protocallStopCount ?? 0, totalProtocallStop)}</td>
              </tr>
            );
          })}
          {/* Totals row */}
          <tr className="bg-muted/50 font-semibold">
            <td className="py-3 px-4 text-foreground">Total</td>
            <td className="py-3 px-4 font-mono text-blue-600 dark:text-blue-400">{totalPlusKey}</td>
            <td className="py-3 px-4 font-mono text-orange-600 dark:text-orange-400">{totalProtocallStop}</td>
            <td className="py-3 px-4 font-mono text-blue-600 dark:text-blue-400">{pct(totalPlusKey, totalPlusKey)}</td>
            <td className="py-3 px-4 font-mono text-orange-600 dark:text-orange-400">{pct(totalProtocallStop, totalProtocallStop)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
