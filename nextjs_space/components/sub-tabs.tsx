'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';

export interface TabItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

interface SubTabsProps {
  tabs: TabItem[];
  defaultTab?: string;
  id?: string;
  children: (activeTab: string) => React.ReactNode;
}

export function SubTabs({ tabs, defaultTab, id, children }: SubTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs?.[0]?.key ?? '');
  const layoutId = id ?? 'sub-tab-' + tabs.map(t => t.key).join('-');

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border mb-5">
        {(tabs ?? []).map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.icon}
              {tab.label}
              {isActive && (
                <motion.div
                  layoutId={layoutId}
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>{children(activeTab)}</div>
    </div>
  );
}
