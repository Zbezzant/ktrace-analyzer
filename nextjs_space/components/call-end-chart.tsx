'use client';

import { type PageStats } from '@/lib/ktrace-parser';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';

interface CallEndChartProps {
  pageStats: PageStats[];
}

export function CallEndChart({ pageStats }: CallEndChartProps) {
  const data = (pageStats ?? []).map((stat: PageStats) => ({
    name: stat?.pageName ?? '',
    '+ Key': stat?.plusKeyCount ?? 0,
    'Protocall Stop': stat?.protocallStopCount ?? 0,
  }));

  if ((data?.length ?? 0) === 0) return null;

  const maxVal = Math.max(
    ...data.map((d: any) => Math.max((d?.['+ Key'] ?? 0), (d?.['Protocall Stop'] ?? 0)))
  );

  return (
    <div className="w-full" style={{ height: Math.max(350, (data?.length ?? 0) * 20 + 100) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 20, right: 30, left: 20, bottom: (data?.length ?? 0) > 4 ? 60 : 40 }}
        >
          <XAxis
            dataKey="name"
            tickLine={false}
            tick={{ fontSize: 10 }}
            interval={0}
            angle={(data?.length ?? 0) > 4 ? -45 : 0}
            textAnchor={(data?.length ?? 0) > 4 ? 'end' : 'middle'}
            height={(data?.length ?? 0) > 4 ? 80 : 40}
          />
          <YAxis
            tickLine={false}
            tick={{ fontSize: 10 }}
            allowDecimals={false}
            label={{ value: 'Count', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 11 } }}
          />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
          />
          <Legend
            verticalAlign="top"
            wrapperStyle={{ fontSize: 11 }}
          />
          <Bar
            dataKey="+ Key"
            fill="#60B5FF"
            radius={[4, 4, 0, 0]}
            maxBarSize={50}
          >
            <LabelList dataKey="+ Key" position="top" style={{ fontSize: 10, fill: '#60B5FF', fontWeight: 600 }} />
          </Bar>
          <Bar
            dataKey="Protocall Stop"
            fill="#FF9149"
            radius={[4, 4, 0, 0]}
            maxBarSize={50}
          >
            <LabelList dataKey="Protocall Stop" position="top" style={{ fontSize: 10, fill: '#FF9149', fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
