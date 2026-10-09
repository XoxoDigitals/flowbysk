/** Pretty-print Express systemLog.details for admin Activity. */
export function formatLogDetails(details?: Record<string, unknown> | null): string {
  if (!details || typeof details !== 'object') return '';
  const parts: string[] = [];
  const ip = details.ip;
  const country = details.country;
  const deviceId = details.deviceId;
  const client = details.client;
  const code = details.code;
  const reason = details.reason;
  const cascadeCount = details.cascadeCount;
  const cascaded = details.cascaded;

  if (typeof ip === 'string' && ip) parts.push(`IP ${ip}`);
  if (typeof country === 'string' && country) parts.push(country);
  if (typeof deviceId === 'string' && deviceId) parts.push(`Device ${deviceId}`);
  if (typeof client === 'string' && client) parts.push(client);
  if (typeof code === 'string' && code) parts.push(code);
  if (typeof reason === 'string' && reason) parts.push(reason);
  if (typeof cascadeCount === 'number' && cascadeCount > 0) {
    parts.push(`cascade:${cascadeCount}`);
  }
  if (Array.isArray(cascaded) && cascaded.length) {
    parts.push(`also banned: ${cascaded.map(String).join(', ')}`);
  }
  if (parts.length) return parts.join(' · ');
  try {
    return JSON.stringify(details);
  } catch {
    return '';
  }
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
