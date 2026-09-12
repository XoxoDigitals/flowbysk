import { JobStatus } from '@prisma/client';
import { formatModelDisplayName } from '@/lib/modelLabels';

export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.PREPARING,
  JobStatus.GENERATING,
  JobStatus.RETRYING,
  JobStatus.CHECKING_STATUS,
];

export const LIVE_JOB_STATUSES: JobStatus[] = [JobStatus.IN_QUEUE, ...ACTIVE_JOB_STATUSES];

export function calendarMonthBounds(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

export function isPaidPlan(plan: { name?: string | null; priceMonthly?: number | null }): boolean {
  const name = String(plan.name || '').trim().toLowerCase();
  if (!name || name === 'free') return false;
  return Number(plan.priceMonthly || 0) > 0 || (name !== 'free' && name.length > 0 && name !== 'trial');
}

export function classifyTool(parameters: unknown): string {
  const src = String((parameters as any)?.source || '').trim().toLowerCase();
  if (!src) return 'studio';
  if (src.includes('storyteller') || src === 'bvs') return 'storyteller';
  if (src.includes('bulkt2v') || src === 'btv') return 'bulkt2v';
  if (src.includes('bulkt2i') || src === 'bti') return 'bulkt2i';
  if (src.includes('bulki2v') || src === 'biv') return 'bulki2v';
  if (src.includes('whisk')) return 'whisk';
  if (src.includes('ingredient')) return 'ingredients';
  return src;
}

export function classifyMethod(job: {
  modelKey?: string | null;
  parameters?: unknown;
}): string {
  const params = (job.parameters as Record<string, unknown>) || {};
  const mk = String(job.modelKey || '').toLowerCase();
  const tool = classifyTool(params);
  if (tool === 'ingredients' || params.ingredient_ids || params.ingredients) return 'ingredients';

  const hasFrames = !!(
    params.staged_id ||
    params.image_id ||
    params.first_frame_id ||
    params.last_frame_id ||
    params.first_frame_staged_id ||
    params.last_frame_staged_id ||
    params.frame_mode
  );
  const isVideo = mk.includes('veo') || mk.includes('omni') || mk.includes('video');
  if (isVideo) return hasFrames ? 'I2V' : 'T2V';

  const hasImageRefs = !!(
    params.image_ids ||
    params.reference_image_id ||
    params.base_image_id ||
    (Array.isArray(params.inputAssetIds) && (params.inputAssetIds as unknown[]).length > 0)
  );
  if (hasImageRefs) return 'I2I';
  return 'T2I';
}

export function isVideoModelKey(modelKey?: string | null): boolean {
  const mk = String(modelKey || '').toLowerCase();
  return mk.includes('veo') || mk.includes('omni') || mk.includes('video');
}

export function modelLabelForJob(job: { modelKey?: string | null; parameters?: unknown }): string {
  const params = (job.parameters as Record<string, unknown>) || {};
  const raw = String(params.model || job.modelKey || '');
  return formatModelDisplayName(raw, isVideoModelKey(job.modelKey) ? 'video' : 'image');
}

export function dayKey(d: Date): string {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function eachDayKeys(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endMs = end.getTime();
  while (cur.getTime() < endMs) {
    keys.push(dayKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return keys;
}

export function rankCounts(map: Record<string, number>, limit = 12) {
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function isStopFailureMessage(msg?: string | null): boolean {
  return /stop by user|cancelled by user|canceled by user/i.test(String(msg || ''));
}
