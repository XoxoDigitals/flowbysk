export type AnalyticsRange = 'today' | 'yesterday' | '7d' | '30d';

export const ANALYTICS_RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
];

export function parseAnalyticsRange(raw: string | null | undefined): AnalyticsRange {
  if (raw === 'yesterday' || raw === '7d' || raw === '30d' || raw === 'today') return raw;
  return 'today';
}

/** Inclusive local-day window as [start, end) ISO bounds for Prisma. */
export function rangeToDateBounds(range: AnalyticsRange, now = new Date()): { start: Date; end: Date } {
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const addDays = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };

  const today = startOfDay(now);

  if (range === 'today') {
    return { start: today, end: addDays(today, 1) };
  }
  if (range === 'yesterday') {
    const y = addDays(today, -1);
    return { start: y, end: today };
  }
  if (range === '7d') {
    return { start: addDays(today, -6), end: addDays(today, 1) };
  }
  // 30d inclusive of today
  return { start: addDays(today, -29), end: addDays(today, 1) };
}

export type JobStatusFilter =
  | 'ALL'
  | 'IN_QUEUE'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'FAILED';

export function parseJobStatusFilter(raw: string | null | undefined): JobStatusFilter {
  if (raw === 'IN_QUEUE' || raw === 'ACTIVE' || raw === 'COMPLETED' || raw === 'FAILED') return raw;
  return 'ALL';
}
