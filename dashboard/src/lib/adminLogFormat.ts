const SKIP_KEYS = new Set([
  'action',
  'username',
  'targetUserId',
  'targetUsername',
  'channelId',
  'attemptId',
  'serverId',
  'sessionVersion',
]);

function cleanIp(ip: unknown): string {
  let s = String(ip || '').trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s === '::1') s = '127.0.0.1';
  return s;
}

/** Pretty-print Express systemLog.details for admin Activity. */
export function formatLogDetails(details?: Record<string, unknown> | null): string {
  if (!details || typeof details !== 'object') return '';
  const parts: string[] = [];
  const ip = cleanIp(details.ip);
  const country = details.country;
  const deviceId = details.deviceId;
  const client = details.client;
  const code = details.code;
  const reason = details.reason;
  const cascadeCount = details.cascadeCount;
  const cascaded = details.cascaded;
  const serverName = details.serverName;

  if (ip) parts.push(`IP ${ip}`);
  if (typeof country === 'string' && country) parts.push(country);
  if (typeof deviceId === 'string' && deviceId) parts.push(`Device ${deviceId}`);
  if (typeof client === 'string' && client) parts.push(client);
  if (typeof serverName === 'string' && serverName) parts.push(serverName);
  if (typeof code === 'string' && code) parts.push(code);
  if (typeof reason === 'string' && reason) parts.push(reason);
  if (typeof cascadeCount === 'number' && cascadeCount > 0) {
    parts.push(`cascade:${cascadeCount}`);
  }
  if (Array.isArray(cascaded) && cascaded.length) {
    parts.push(`also banned: ${cascaded.map(String).join(', ')}`);
  }

  if (parts.length) return parts.join(' · ');

  // Fallback: compact leftover fields (no raw dump of ids)
  const leftover: string[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (SKIP_KEYS.has(k) || v == null || v === '') continue;
    if (typeof v === 'object') continue;
    leftover.push(`${k}=${String(v)}`);
  }
  return leftover.slice(0, 6).join(' · ');
}

export function formatPeriodWindow(periodStart?: string, periodEnd?: string): string {
  const fmt = (iso?: string) => {
    if (!iso) return '—';
    try {
      return (
        new Date(iso).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }) + ' UTC'
      );
    } catch {
      return iso;
    }
  };
  return `${fmt(periodStart)} → ${fmt(periodEnd)}`;
}
