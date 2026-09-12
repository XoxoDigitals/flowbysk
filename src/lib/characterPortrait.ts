import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export const CHARACTERS_DIR = path.resolve(process.cwd(), 'data', 'characters');

const FAR_FUTURE_MS = 10 * 365 * 24 * 60 * 60 * 1000; // ~10 years

export function durableCharacterExpiresAt(from = new Date()): Date {
  return new Date(from.getTime() + FAR_FUTURE_MS);
}

export function characterPortraitDir(userId: string): string {
  return path.join(CHARACTERS_DIR, userId);
}

export function characterPortraitPath(userId: string, characterId: string, ext = '.jpg'): string {
  const safeExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return path.join(characterPortraitDir(userId), `${characterId}${safeExt}`);
}

export function characterPortraitApiUrl(characterId: string): string {
  return `/api/characters/file/${characterId}`;
}

function extFromUrlOrType(url: string, contentType?: string | null): string {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  try {
    const u = new URL(url, 'http://localhost');
    const m = u.pathname.match(/\.(png|jpe?g|webp|gif)$/i);
    if (m) return `.${m[1].toLowerCase().replace('jpeg', 'jpg')}`;
  } catch {
    /* ignore */
  }
  if (/\.png(\?|$)/i.test(url)) return '.png';
  if (/\.webp(\?|$)/i.test(url)) return '.webp';
  return '.jpg';
}

function isLocalApiPortrait(url: string): boolean {
  return /^\/api\/characters\/file\//i.test(url) || /^\/api\/assets\/file\//i.test(url);
}

function resolveLocalFileFromApiUrl(url: string): string | null {
  if (/^\/api\/assets\/file\//i.test(url)) {
    const name = url.split('/').pop()?.split('?')[0] || '';
    if (!name) return null;
    const p = path.resolve(process.cwd(), 'data', 'uploads', name);
    return fs.existsSync(p) ? p : null;
  }
  return null;
}

/** Download or copy portrait bytes into durable character storage. */
export async function persistCharacterPortrait(opts: {
  userId: string;
  characterId: string;
  sourceUrl: string;
  localImagePath?: string | null;
}): Promise<{ portraitUrl: string; localPath: string } | null> {
  const { userId, characterId, sourceUrl, localImagePath } = opts;
  fs.mkdirSync(characterPortraitDir(userId), { recursive: true });

  let buffer: Buffer | null = null;
  let ext = '.jpg';

  if (localImagePath && fs.existsSync(localImagePath)) {
    buffer = fs.readFileSync(localImagePath);
    ext = path.extname(localImagePath) || '.jpg';
  } else if (isLocalApiPortrait(sourceUrl)) {
    const local = resolveLocalFileFromApiUrl(sourceUrl);
    if (local) {
      buffer = fs.readFileSync(local);
      ext = path.extname(local) || '.jpg';
    }
  }

  if (!buffer && sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
    try {
      const res = await fetch(sourceUrl, {
        headers: { 'User-Agent': 'GoogleFlowStudio/1.0' },
        redirect: 'follow',
      });
      if (res.ok) {
        const ab = await res.arrayBuffer();
        buffer = Buffer.from(ab);
        ext = extFromUrlOrType(sourceUrl, res.headers.get('content-type'));
      }
    } catch (e) {
      console.warn('persistCharacterPortrait download failed:', e);
    }
  }

  // data: URLs
  if (!buffer && /^data:image\//i.test(sourceUrl)) {
    const m = sourceUrl.match(/^data:image\/([\w+]+);base64,(.+)$/i);
    if (m) {
      buffer = Buffer.from(m[2], 'base64');
      ext = `.${m[1].toLowerCase().replace('jpeg', 'jpg')}`;
    }
  }

  if (!buffer || buffer.length < 32) return null;

  // Remove any prior portrait files for this character
  const dir = characterPortraitDir(userId);
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(`${characterId}.`)) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        /* ignore */
      }
    }
  }

  const dest = characterPortraitPath(userId, characterId, ext);
  fs.writeFileSync(dest, buffer);
  return {
    portraitUrl: characterPortraitApiUrl(characterId),
    localPath: dest,
  };
}

export function findCharacterPortraitFile(userId: string, characterId: string): string | null {
  const dir = characterPortraitDir(userId);
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((n) => n === characterId || n.startsWith(`${characterId}.`));
  return hit ? path.join(dir, hit) : null;
}

export function deleteCharacterPortraitFiles(userId: string, characterId: string, traits?: any) {
  const local =
    (traits && typeof traits === 'object' && traits.local_image_path) ||
    findCharacterPortraitFile(userId, characterId);
  if (local && typeof local === 'string' && fs.existsSync(local)) {
    try {
      fs.unlinkSync(local);
    } catch {
      /* ignore */
    }
  }
  const dir = characterPortraitDir(userId);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name === characterId || name.startsWith(`${characterId}.`)) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        /* ignore */
      }
    }
  }
}

export function mimeForPortraitPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

export function needsPortraitBackfill(portraitUrl: string | null | undefined): boolean {
  if (!portraitUrl) return true;
  if (/^\/api\/characters\/file\//i.test(portraitUrl)) return false;
  if (/flow-content\.google|googleusercontent\.com|Expires=/i.test(portraitUrl)) return true;
  if (/^https?:\/\//i.test(portraitUrl) && !/unsplash\.com/i.test(portraitUrl)) return true;
  return false;
}

/** Temp id helper if needed before create — unused normally. */
export function newCharacterFileId(): string {
  return randomUUID();
}
