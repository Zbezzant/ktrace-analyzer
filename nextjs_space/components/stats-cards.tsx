'use client';

import { Phone, KeyRound, Radio, LayoutGrid } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';

interface StatsCardsProps {
  totalCalls: number;
  totalPlusKey: number;
  totalProtocallStop: number;
  pageCount: number;
}

function AnimatedNumber({ value, duration = 800 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const startVal = startRef.current;
    const startTime = performance.now();
    
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startVal + (value - startVal) * eased);
      setDisplay(current);
      
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        startRef.current = value;
      }
    };
    
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration]);

  return <span className="font-mono">{display}</span>;
}

const cards = [
  { key: 'total', label: 'Total Call Ends', icon: Phone, color: 'text-primary', bg: 'bg-primary/10' },
  { key: 'plus', label: '+ Key Ends', icon: KeyRound, color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  { key: 'stop', label: 'Protocall Stop Ends', icon: Radio, color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  { key: 'pages', label: 'Unique Pages', icon: LayoutGrid, color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
];

export function StatsCards({ totalCalls, totalPlusKey, totalProtocallStop, pageCount }: StatsCardsProps) {
  const values: Record<string, number> = {
    total: totalCalls ?? 0,
    plus: totalPlusKey ?? 0,
    stop: totalProtocallStop ?? 0,
    pages: pageCount ?? 0,
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card: any, idx: number) => {
        const Icon = card?.icon;
        return (
          <motion.div
            key={card?.key ?? idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: idx * 0.05 }}
            className="bg-card rounded-[var(--radius)] p-4 sm:p-5 group hover:scale-[1.02] transition-transform"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2 rounded-lg ${card?.bg ?? ''}`}>
                {Icon && <Icon className={`w-5 h-5 ${card?.color ?? ''}`} />}
              </div>
              <span className="text-xs sm:text-sm text-muted-foreground font-medium">{card?.label ?? ''}</span>
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-foreground">
              <AnimatedNumber value={values?.[card?.key ?? ''] ?? 0} />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
