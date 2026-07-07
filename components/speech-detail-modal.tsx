'use client';

import { type CallEndEvent } from '@/lib/ktrace-parser';
import { X, KeyRound, Radio, Clock, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface SpeechDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  pageName: string;
  endType: 'plus_key' | 'protocall_stop' | 'all';
  events: CallEndEvent[];
}

export function SpeechDetailModal({ isOpen, onClose, pageName, endType, events }: SpeechDetailModalProps) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }
  }, [isOpen, onClose]);

  // Filter events by page and type
  const filtered = (events ?? []).filter((ev) => {
    if (ev?.page !== pageName) return false;
    if (endType === 'all') return true;
    return ev?.endType === endType;
  });

  const typeLabel = endType === 'plus_key' ? 'Agent Hang Up (+)' : endType === 'protocall_stop' ? 'Customer Hang Up (Protocall Stop)' : 'All Hang Ups';
  const typeColor = endType === 'plus_key' ? 'text-blue-600 dark:text-blue-400' : endType === 'protocall_stop' ? 'text-orange-600 dark:text-orange-400' : 'text-foreground';

  // Use portal to escape any parent transforms that break fixed positioning
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  if (!portalRoot) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (createPortal as any)(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />
          {/* Modal wrapper — flex centering */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-2xl max-h-[80vh] bg-card rounded-[var(--radius-lg)] flex flex-col overflow-hidden pointer-events-auto"
              style={{ boxShadow: 'var(--shadow-lg)' }}
            >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <div className="min-w-0">
                <h3 className="text-lg font-display font-semibold text-foreground truncate">
                  Last Speech Before Hang Up
                </h3>
                <div className="flex items-center gap-2 mt-1 text-sm">
                  <span className="font-medium text-foreground">{pageName}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className={typeColor}>{typeLabel}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{filtered.length} event{filtered.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-muted transition-colors shrink-0"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {filtered.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">No events found for this selection.</p>
                </div>
              ) : (
                <div>
                  <h4 className="text-sm font-display font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    Individual Events
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">#</th>
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">Time</th>
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap">Type</th>
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground">Last Speech Captured</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((ev, idx) => (
                          <tr key={idx} className="border-b border-border/50 hover:bg-muted/30 transition-colors align-top">
                            <td className="py-2 px-3 font-mono text-foreground whitespace-nowrap text-center">{idx + 1}</td>
                            <td className="py-2 px-3 font-mono text-foreground whitespace-nowrap">{ev?.timestamp ?? ''}</td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {ev?.endType === 'plus_key' ? (
                                <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                                  <KeyRound className="w-3 h-3" /> +
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400">
                                  <Radio className="w-3 h-3" /> Stop
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-foreground">
                              {ev?.lastSpeech?.text ? (
                                <span className="break-words">{ev.lastSpeech.text}</span>
                              ) : (
                                <span className="text-muted-foreground italic">None</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    portalRoot
  );
}
