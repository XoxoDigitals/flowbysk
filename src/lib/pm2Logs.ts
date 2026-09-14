import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

export type Pm2Service = 'web' | 'bib' | 'api';

const SERVICE_GLOBS: Record<Pm2Service, string[]> = {
  web: ['flowbysk-web', 'gflow-web'],
  bib: ['flowbysk-bib', 'gflow-bib'],
  api: ['flowbysk-api', 'gflow-api'],
};

const SERVICE_PM2_NAME: Record<Pm2Service, string> = {
  web: 'flowbysk-web',
  bib: 'flowbysk-bib',
  api: 'flowbysk-api',
};

function candidateDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.PM2_LOG_DIR) dirs.push(process.env.PM2_LOG_DIR);
  if (process.env.PM2_HOME) dirs.push(path.join(process.env.PM2_HOME, 'logs'));
  dirs.push('/root/.pm2/logs');
  dirs.push(path.join(os.homedir(), '.pm2', 'logs'));
  dirs.push(path.join(process.cwd(), 'data', 'pm2-logs'));
  return [...new Set(dirs)];
}

function matchesService(fileName: string, service: Pm2Service): boolean {
  const lower = fileName.toLowerCase();
  return SERVICE_GLOBS[service].some((prefix) => lower.startsWith(prefix.toLowerCase()));
}

function listLogFiles(service: Pm2Service): { path: string; name: string; stream: 'out' | 'error' | 'other'; size: number; mtime: string }[] {
  const files: { path: string; name: string; stream: 'out' | 'error' | 'other'; size: number; mtime: string }[] = [];
  for (const dir of candidateDirs()) {
    let entries: string[] = [];
    try {
      if (!fs.existsSync(dir)) continue;
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!matchesService(name, service)) continue;
      if (!name.endsWith('.log')) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        const stream = /-error-/i.test(name) || /error\.log$/i.test(name)
          ? 'error'
          : /-out-/i.test(name) || /out\.log$/i.test(name)
            ? 'out'
            : 'other';
        files.push({
          path: full,
          name,
          stream,
          size: st.size,
          mtime: st.mtime.toISOString(),
        });
      } catch {
        /* skip */
      }
    }
    if (files.length) break;
  }
  return files.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

function readTailLines(filePath: string, maxLines: number, maxBytes = 1_500_000): string[] {
  let fd: number | null = null;
  try {
    const st = fs.statSync(filePath);
    const size = st.size;
    if (size === 0) return [];
    const readStart = Math.max(0, size - maxBytes);
    const len = size - readStart;
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, readStart);
    let text = buf.toString('utf8');
    if (readStart > 0) {
      const nl = text.indexOf('\n');
      if (nl >= 0) text = text.slice(nl + 1);
    }
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

export function readPm2ServiceLogs(
  service: Pm2Service,
  opts?: { lines?: number; q?: string; stream?: 'all' | 'out' | 'error' }
): {
  service: Pm2Service;
  files: { name: string; stream: string; size: number; mtime: string; path: string }[];
  lines: { file: string; stream: string; text: string }[];
  dirsChecked: string[];
} {
  const maxLines = Math.min(5000, Math.max(50, opts?.lines ?? 800));
  const streamFilter = opts?.stream || 'all';
  const q = (opts?.q || '').trim().toLowerCase();
  const files = listLogFiles(service).filter((f) => {
    if (streamFilter === 'all') return true;
    return f.stream === streamFilter;
  });

  const collected: { file: string; stream: string; text: string; order: number }[] = [];
  let order = 0;
  for (const f of files) {
    const raw = readTailLines(f.path, maxLines);
    for (const text of raw) {
      if (!text) continue;
      if (q && !text.toLowerCase().includes(q)) continue;
      collected.push({ file: f.name, stream: f.stream, text, order: order++ });
    }
  }

  if (!collected.length && files.length === 0) {
    try {
      const out = execFileSync(
        'pm2',
        [
          'logs',
          SERVICE_PM2_NAME[service],
          '--nostream',
          '--lines',
          String(Math.min(maxLines, 500)),
          '--raw',
        ],
        { encoding: 'utf8', timeout: 10_000, maxBuffer: 2_500_000 }
      );
      for (const text of out.split(/\r?\n/)) {
        if (!text) continue;
        if (q && !text.toLowerCase().includes(q)) continue;
        collected.push({ file: 'pm2-cli', stream: 'out', text, order: order++ });
      }
    } catch {
      /* CLI fallback unavailable */
    }
  }

  // Prefer chronological-ish: take last maxLines from merged buffer
  const sliced = collected.slice(-maxLines);

  return {
    service,
    files: files.map(({ name, stream, size, mtime, path: p }) => ({
      name,
      stream,
      size,
      mtime,
      path: p,
    })),
    lines: sliced.map(({ file, stream, text }) => ({ file, stream, text })),
    dirsChecked: candidateDirs(),
  };
}

export function clearPm2ServiceLogs(service: Pm2Service | 'all'): {
  cleared: string[];
  deletedHistory: string[];
  errors: string[];
} {
  const services: Pm2Service[] =
    service === 'all' ? ['web', 'bib', 'api'] : [service];
  const cleared: string[] = [];
  const deletedHistory: string[] = [];
  const errors: string[] = [];

  for (const svc of services) {
    for (const f of listLogFiles(svc)) {
      try {
        fs.truncateSync(f.path, 0);
        cleared.push(f.path);
      } catch (e: any) {
        errors.push(`${f.path}: ${e?.message || 'failed'}`);
      }
    }
  }

  // Also wipe archived History copies for this scope
  const historyDir = path.join(process.cwd(), 'data', 'pm2-log-history');
  try {
    if (fs.existsSync(historyDir)) {
      const entries = fs.readdirSync(historyDir);
      for (const name of entries) {
        if (!name.endsWith('.log')) continue;
        const matchAll = service === 'all';
        const matchSvc = services.some((svc) => name.startsWith(`${svc}-`));
        if (!matchAll && !matchSvc) continue;
        const full = path.join(historyDir, name);
        try {
          fs.unlinkSync(full);
          deletedHistory.push(name);
        } catch (e: any) {
          errors.push(`${full}: ${e?.message || 'delete failed'}`);
        }
      }
    }
  } catch (e: any) {
    errors.push(`history: ${e?.message || 'failed'}`);
  }

  return { cleared, deletedHistory, errors };
}

export function listPm2LogHistory(service?: Pm2Service, limit = 40): {
  name: string;
  path: string;
  size: number;
  mtime: string;
  service: string;
}[] {
  const historyDir = path.join(process.cwd(), 'data', 'pm2-log-history');
  let entries: string[] = [];
  try {
    if (!fs.existsSync(historyDir)) return [];
    entries = fs.readdirSync(historyDir);
  } catch {
    return [];
  }

  const items = entries
    .filter((n) => n.endsWith('.log'))
    .filter((n) => !service || n.startsWith(`${service}-`))
    .map((name) => {
      const full = path.join(historyDir, name);
      try {
        const st = fs.statSync(full);
        const svc = name.split('-')[0] || 'unknown';
        return {
          name,
          path: full,
          size: st.size,
          mtime: st.mtime.toISOString(),
          service: svc,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as {
    name: string;
    path: string;
    size: number;
    mtime: string;
    service: string;
  }[];

  return items.sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, limit);
}

export function readPm2HistoryFile(
  fileName: string,
  opts?: { lines?: number; q?: string }
): { name: string; lines: string[]; error?: string } {
  const safe = path.basename(fileName);
  const full = path.join(process.cwd(), 'data', 'pm2-log-history', safe);
  if (!full.startsWith(path.join(process.cwd(), 'data', 'pm2-log-history'))) {
    return { name: safe, lines: [], error: 'Invalid path' };
  }
  if (!fs.existsSync(full)) {
    return { name: safe, lines: [], error: 'Not found' };
  }
  const maxLines = Math.min(5000, Math.max(50, opts?.lines ?? 800));
  const q = (opts?.q || '').trim().toLowerCase();
  let lines = readTailLines(full, maxLines);
  if (q) lines = lines.filter((l) => l.toLowerCase().includes(q));
  return { name: safe, lines };
}
