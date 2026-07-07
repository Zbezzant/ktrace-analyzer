'use client';

import { useCallback, useState, useRef } from 'react';
import { Upload, FileUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

interface FileUploaderProps {
  onUpload: (files: File[]) => void;
  isProcessing: boolean;
}

export function FileUploader({ onUpload, isProcessing }: FileUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e?.dataTransfer?.files ?? []).filter(
      (f: File) => f?.name?.endsWith?.('.log') || f?.name?.endsWith?.('.txt') || f?.type === 'text/plain'
    );
    if (files?.length > 0) {
      onUpload?.(files);
    }
  }, [onUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e?.target?.files ?? []);
    if (files?.length > 0) {
      onUpload?.(files);
    }
    if (inputRef?.current) {
      inputRef.current.value = '';
    }
  }, [onUpload]);

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`relative border-2 border-dashed rounded-[var(--radius-lg)] p-8 transition-all duration-200 text-center cursor-pointer ${
        isDragOver
          ? 'border-primary bg-primary/5'
          : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50'
      }`}
      onClick={() => inputRef?.current?.click?.()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".log,.txt"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
      
      {isProcessing ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3"
        >
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
          <p className="text-sm font-medium text-foreground">Processing log file...</p>
        </motion.div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 rounded-full bg-primary/10">
            {isDragOver ? (
              <FileUp className="w-8 h-8 text-primary" />
            ) : (
              <Upload className="w-8 h-8 text-primary" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-1">
              {isDragOver ? 'Drop files here' : 'Drag & drop KTRACE log files here'}
            </p>
            <p className="text-xs text-muted-foreground">
              or click to browse • Accepts .log and .txt files • Multiple files supported
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
