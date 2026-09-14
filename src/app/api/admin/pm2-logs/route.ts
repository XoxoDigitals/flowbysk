import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth';
import {
  clearPm2ServiceLogs,
  listPm2LogHistory,
  Pm2Service,
  readPm2HistoryFile,
  readPm2ServiceLogs,
} from '@/lib/pm2Logs';

const SERVICES = new Set<Pm2Service>(['web', 'bib', 'api']);

function parseService(raw: string | null): Pm2Service {
  const s = (raw || 'web').toLowerCase() as Pm2Service;
  return SERVICES.has(s) ? s : 'web';
}

/** GET — live PM2 logs (or archived history file) for web / bib / api. Super admin only. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const { searchParams } = new URL(req.url);
    const service = parseService(searchParams.get('service'));
    const q = searchParams.get('q') || '';
    const lines = Number(searchParams.get('lines') || 800);
    const stream = (searchParams.get('stream') || 'all') as 'all' | 'out' | 'error';
    const historyFile = searchParams.get('history');

    if (historyFile) {
      const hist = readPm2HistoryFile(historyFile, { lines, q });
      return NextResponse.json({
        success: true,
        mode: 'history',
        service,
        history: hist,
        archives: listPm2LogHistory(service),
      });
    }

    const data = readPm2ServiceLogs(service, { lines, q, stream });
    return NextResponse.json({
      success: true,
      mode: 'live',
      ...data,
      archives: listPm2LogHistory(service),
    });
  } catch (error: any) {
    const status =
      error?.message === 'FORBIDDEN' || error?.message === 'UNAUTHORIZED' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Forbidden' }, { status });
  }
}

/** DELETE — clear live PM2 logs and delete History archives for that scope. Super admin only. */
export async function DELETE(req: Request) {
  try {
    await requireSuperAdmin(req);
    const { searchParams } = new URL(req.url);
    const scope = (searchParams.get('service') || 'current').toLowerCase();
    const service =
      scope === 'all' ? ('all' as const) : parseService(searchParams.get('service'));

    const result = clearPm2ServiceLogs(service);
    const parts: string[] = [];
    if (result.cleared.length) parts.push(`cleared ${result.cleared.length} live file(s)`);
    if (result.deletedHistory.length) {
      parts.push(`deleted ${result.deletedHistory.length} history file(s)`);
    }
    return NextResponse.json({
      success: result.errors.length === 0,
      ...result,
      message:
        parts.length > 0
          ? parts.join(' · ')
          : result.errors[0] || 'No log files found to clear',
    });
  } catch (error: any) {
    const status =
      error?.message === 'FORBIDDEN' || error?.message === 'UNAUTHORIZED' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Forbidden' }, { status });
  }
}
