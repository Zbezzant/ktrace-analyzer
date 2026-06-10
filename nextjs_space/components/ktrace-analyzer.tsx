'use client';

import { motion } from 'framer-motion';
import { BarChart3, PhoneOff, Clock } from 'lucide-react';
import { SubTabs } from '@/components/sub-tabs';
import { CallEndAnalysis } from '@/components/call-end-analysis';
import { TimingAnalysis } from '@/components/timing-analysis';

export function KtraceAnalyzer() {
  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <BarChart3 className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-display font-bold tracking-tight text-foreground">
            KTRACE <span className="text-primary">Analyzer</span>
          </h1>
        </div>
        <p className="text-muted-foreground text-base max-w-2xl">
          Upload KTRACE log files to analyze call center agent behavior — track where calls end,
          and extract the human-derived timing attributes that drive the conversational AI.
        </p>
      </motion.header>

      {/* Top-level tabs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <SubTabs
          id="ktrace-main-tabs"
          tabs={[
            { key: 'call-end', label: 'Call End Analysis', icon: <PhoneOff className="w-4 h-4" /> },
            { key: 'timing', label: 'Timing Analysis', icon: <Clock className="w-4 h-4" /> },
          ]}
          defaultTab="call-end"
        >
          {(activeTab) => (
            <>
              {activeTab === 'call-end' && <CallEndAnalysis />}
              {activeTab === 'timing' && <TimingAnalysis />}
            </>
          )}
        </SubTabs>
      </motion.div>
    </div>
  );
}
