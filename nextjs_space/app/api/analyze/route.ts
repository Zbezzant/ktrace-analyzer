import { NextRequest, NextResponse } from 'next/server';
import { analyzeFiles, type AnalyzeInputFile } from '@/lib/timing-analyzer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// KTRACE logs can be large; allow a generous execution window.
export const maxDuration = 120;

/**
 * POST /api/analyze
 * Accepts multipart/form-data with one or more `files` fields (KTRACE logs)
 * and returns the five-attribute timing analysis JSON (grouped by detected
 * level). The analysis runs natively in Node (ported from the original
 * analyzer.py) so no Python runtime is required.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const uploaded = formData.getAll('files').filter((f): f is File => f instanceof File);

    if (uploaded.length === 0) {
      return NextResponse.json({ error: 'No files uploaded.' }, { status: 400 });
    }

    const inputs: AnalyzeInputFile[] = [];
    for (const file of uploaded) {
      const content = await file.text();
      inputs.push({ name: file.name || 'log', content });
    }

    const result = analyzeFiles(inputs);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[api/analyze] error:', err);
    return NextResponse.json(
      { error: err?.message || 'Analysis failed.' },
      { status: 500 },
    );
  }
}
