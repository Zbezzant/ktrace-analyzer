'use client';

import { useState } from 'react';
import { type PageStats, type CallEndEvent } from '@/lib/ktrace-parser';
import { SpeechDetailModal } from '@/components/speech-detail-modal';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface CallEndPieChartProps {
  pageStats: PageStats[];
  callEndEvents: CallEndEvent[];
}

const COLORS = [
  '#60B5FF', '#FF9149', '#34D399', '#A78BFA', '#F472B6',
  '#FBBF24', '#6EE7B7', '#93C5FD', '#FCA5A5', '#C4B5FD',
];

function renderLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
  name,
}: any) {
  if (percent < 0.03) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 24;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="currentColor"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      className="text-[10px] fill-muted-foreground"
    >
      {name} ({(percent * 100).toFixed(1)}%)
    </text>
  );
}

export function CallEndPieChart({ pageStats, callEndEvents }: CallEndPieChartProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPage, setModalPage] = useState('');
  const [modalEndType, setModalEndType] = useState<'plus_key' | 'protocall_stop' | 'all'>('all');

  const totalAll = (pageStats ?? []).reduce((s, p) => s + (p?.totalCount ?? 0), 0);
  const totalPlusKey = (pageStats ?? []).reduce((s, p) => s + (p?.plusKeyCount ?? 0), 0);
  const totalProtocallStop = (pageStats ?? []).reduce((s, p) => s + (p?.protocallStopCount ?? 0), 0);
  if (totalAll === 0) return null;

  const agentData = (pageStats ?? [])
    .filter((p) => (p?.plusKeyCount ?? 0) > 0)
    .map((p) => ({
      name: p?.pageName ?? '',
      value: p?.plusKeyCount ?? 0,
    }));

  const customerData = (pageStats ?? [])
    .filter((p) => (p?.protocallStopCount ?? 0) > 0)
    .map((p) => ({
      name: p?.pageName ?? '',
      value: p?.protocallStopCount ?? 0,
    }));

  const handleSliceClick = (data: any, endType: 'plus_key' | 'protocall_stop') => {
    if (data?.name) {
      setModalPage(data.name);
      setModalEndType(endType);
      setModalOpen(true);
    }
  };

  return (
    <>
      <p className="text-xs text-muted-foreground text-center mb-2 italic">Click a slice to view the last speech played before hang up</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Agent Hang Up Pie */}
        <div>
          <h5 className="text-sm font-display font-semibold text-card-foreground mb-2 text-center">
            Agent Hang Up (+) by Page
          </h5>
          <div className="w-full" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={agentData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={renderLabel}
                  labelLine={{ stroke: 'var(--muted-foreground)', strokeWidth: 0.5 }}
                  cursor="pointer"
                  onClick={(data: any) => handleSliceClick(data, 'plus_key')}
                >
                  {agentData.map((_: any, idx: number) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} className="hover:opacity-80 transition-opacity" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, name: string) => [
                    `${value} (${totalPlusKey > 0 ? ((value / totalPlusKey) * 100).toFixed(1) : 0}%)`,
                    name,
                  ]}
                  contentStyle={{ fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Customer Hang Up Pie */}
        <div>
          <h5 className="text-sm font-display font-semibold text-card-foreground mb-2 text-center">
            Customer Hang Up (Protocall Stop) by Page
          </h5>
          <div className="w-full" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={customerData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={renderLabel}
                  labelLine={{ stroke: 'var(--muted-foreground)', strokeWidth: 0.5 }}
                  cursor="pointer"
                  onClick={(data: any) => handleSliceClick(data, 'protocall_stop')}
                >
                  {customerData.map((_: any, idx: number) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} className="hover:opacity-80 transition-opacity" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, name: string) => [
                    `${value} (${totalProtocallStop > 0 ? ((value / totalProtocallStop) * 100).toFixed(1) : 0}%)`,
                    name,
                  ]}
                  contentStyle={{ fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <SpeechDetailModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        pageName={modalPage}
        endType={modalEndType}
        events={callEndEvents}
      />
    </>
  );
}
