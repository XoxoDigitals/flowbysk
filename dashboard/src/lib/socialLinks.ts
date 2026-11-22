export type SocialPlatform =
  | 'telegram'
  | 'discord'
  | 'twitter'
  | 'instagram'
  | 'youtube'
  | 'whatsapp'
  | 'facebook'
  | 'tiktok';

export type SocialLinks = Partial<Record<SocialPlatform, string>>;

export const SOCIAL_PLATFORMS: {
  id: SocialPlatform;
  label: string;
  placeholder: string;
}[] = [
  { id: 'telegram', label: 'Telegram', placeholder: 'https://t.me/yourchannel' },
  { id: 'discord', label: 'Discord', placeholder: 'https://discord.gg/invite' },
  { id: 'twitter', label: 'X / Twitter', placeholder: 'https://x.com/yourhandle' },
  { id: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourhandle' },
  { id: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@yourchannel' },
  { id: 'whatsapp', label: 'WhatsApp', placeholder: 'https://wa.me/1234567890' },
  { id: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/yourpage' },
  { id: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@yourhandle' },
];

function normalizeUrl(raw: unknown): string | undefined {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w.-]+\.\w/.test(s) || s.startsWith('t.me/') || s.startsWith('wa.me/')) {
    return `https://${s}`;
  }
  return s;
}

export function normalizeSocialLinks(raw: unknown): SocialLinks {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: SocialLinks = {};
  for (const { id } of SOCIAL_PLATFORMS) {
    const url = normalizeUrl(src[id]);
    if (url) out[id] = url;
  }
  return out;
}

export function socialLinksList(links: SocialLinks | null | undefined) {
  if (!links) return [];
  return SOCIAL_PLATFORMS.filter((p) => links[p.id]).map((p) => ({
    id: p.id,
    label: p.label,
    href: links[p.id] as string,
  }));
}
