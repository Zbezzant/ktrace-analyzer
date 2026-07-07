'use client';

import { type ParseResult } from '@/lib/ktrace-parser';
import { FileText, Hash, KeyRound, Radio } from 'lucide-react';
import { motion } from 'framer-motion';

interface FileListProps {
  results: ParseResult[];
}

export function FileList({ results }: FileListProps) {
  return (
    <div className="grid gap-2">
      {(results ?? []).map((result: ParseResult, idx: number) => (
        <motion.div
          key={`${result?.fileName ?? ''}-${idx}`}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: idx * 0.05 }}
          className="flex items-center justify-between bg-muted/40 rounded-[var(--radius)] px-4 py-2.5"
        >
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground truncate max-w-[200px] sm:max-w-none">
              {result?.fileName ?? 'unknown'}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Hash className="w-3.5 h-3.5" />
              {result?.totalCalls ?? 0} calls
            </span>
            <span className="flex items-center gap-1 text-blue-600">
              <KeyRound className="w-3.5 h-3.5" />
              {result?.totalPlusKey ?? 0}
            </span>
            <span className="flex items-center gap-1 text-orange-600">
              <Radio className="w-3.5 h-3.5" />
              {result?.totalProtocallStop ?? 0}
            </span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
