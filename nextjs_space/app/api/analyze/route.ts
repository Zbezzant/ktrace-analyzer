import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// KTRACE logs can be large; allow a generous body size.
export const maxDuration = 120;

const PYTHON_DIR = path.join(process.cwd(), 'python');

function resolvePython(): string {
  return process.env.PYTHON_BIN || 'python3';
}

interface TempFile {
  name: string;
  path: string;
}

/**
 * POST /api/analyze
 * Accepts multipart/form-data with one or more `files` fields (KTRACE logs),
 * writes them to a temp dir, runs python/run_analysis.py, and returns the
 * analysis JSON produced by analyzer.py (grouped by detected level).
 */
export async function POST(req: NextRequest) {
  let workDir: string | null = null;
  try {
    const formData = await req.formData();
    const uploaded = formData.getAll('files').filter((f): f is File => f instanceof File);

    if (uploaded.length === 0) {
      return NextResponse.json({ error: 'No files uploaded.' }, { status: 400 });
    }

    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ktrace-'));
    const tempFiles: TempFile[] = [];

    for (const file of uploaded) {
      const buf = Buffer.from(await file.arrayBuffer());
      const safeName = (file.name || 'log').replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = path.join(workDir, `${crypto.randomUUID()}_${safeName}`);
      await fs.writeFile(dest, buf);
      tempFiles.push({ name: file.name || safeName, path: dest });
    }

    const result = await runPython(tempFiles);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[api/analyze] error:', err);
    return NextResponse.json(
      { error: err?.message || 'Analysis failed.' },
      { status: 500 },
    );
  } finally {
    if (workDir) {
      fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function runPython(files: TempFile[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const py = resolvePython();
    const args = [
      path.join(PYTHON_DIR, 'run_analysis.py'),
      '--json',
      JSON.stringify(files),
    ];

    const child = spawn(py, args, {
      cwd: PYTHON_DIR,
      env: { ...process.env, PYTHONPATH: PYTHON_DIR },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (e) => {
      reject(
        new Error(
          `Failed to launch Python (${py}). Ensure Python 3 is installed and on PATH. ${e.message}`,
        ),
      );
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python exited with code ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e: any) {
        reject(new Error(`Could not parse analysis output: ${e.message}\n${stderr}`));
      }
    });
  });
}
