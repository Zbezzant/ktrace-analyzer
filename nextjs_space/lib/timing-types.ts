// Types describing the JSON returned by /api/analyze (produced by python/run_analysis.py).

export interface TimingSummary {
  n: number;
  mean: number | null;
  median: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
  stopped_count?: number;
  not_stopped_count?: number;
}

export interface TimingSample {
  value: number;
  page: string;
  message: string;
  ts: number;
  meta: Record<string, unknown>;
}

export interface TimingMessageRow {
  message: string;
  summary: TimingSummary;
  samples: TimingSample[];
}

export interface TimingPageRow {
  page: string;
  summary: TimingSummary;
  messages: TimingMessageRow[];
}

export interface TimingAttribute {
  key: string;
  label: string;
  description: string;
  is_interrupt: boolean;
  overall: TimingSummary;
  pages: TimingPageRow[];
}

export interface TimingLevel {
  level: number;
  fileCount: number;
  attributes: TimingAttribute[];
}

export interface TimingFileInfo {
  name: string;
  level: number | null;
  eventCount?: number;
  totalSamples?: number;
  sampleCounts?: Record<string, number>;
  error?: string;
}

export interface TimingAnalysisResult {
  files: TimingFileInfo[];
  levels: TimingLevel[];
  error?: string;
}
