import { prisma } from '@/lib/prisma';

export const STUDIO_TOOL_IDS = [
  'image',
  'video',
  'image-to-image',
  'image-to-video',
  'ingredients',
  'characters',
  'whisk',
  'storyteller',
  'bulkt2v',
  'bulkt2i',
  'bulki2v',
  'extend',
  'upscale',
] as const;

export type StudioToolId = (typeof STUDIO_TOOL_IDS)[number];

export type StudioToolSettings = Record<StudioToolId, boolean>;

export const DEFAULT_STUDIO_TOOLS: StudioToolSettings = {
  image: true,
  video: true,
  'image-to-image': true,
  'image-to-video': true,
  ingredients: true,
  characters: true,
  whisk: true,
  storyteller: true,
  bulkt2v: true,
  bulkt2i: true,
  bulki2v: true,
  extend: true,
  upscale: true,
};

export const STUDIO_TOOL_LABELS: Record<StudioToolId, string> = {
  image: 'Text to Image',
  video: 'Text to Video',
  'image-to-image': 'Image to Image',
  'image-to-video': 'Image to Video',
  ingredients: 'Ingredients',
  characters: 'Characters',
  whisk: 'Whisk',
  storyteller: 'Bulk Visual Storyteller',
  bulkt2v: 'Bulk Text to Video',
  bulkt2i: 'Bulk Text to Image',
  bulki2v: 'Bulk Image to Video',
  extend: 'Extend video',
  upscale: 'Upscale 1080p',
};

function asBool(v: unknown, fallback: boolean) {
  if (typeof v === 'boolean') return v;
  return fallback;
}

export async function getStudioToolSettings(): Promise<StudioToolSettings> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: 'STUDIO_TOOLS' } });
    const raw = (row?.value as Record<string, unknown>) || {};
    const out = { ...DEFAULT_STUDIO_TOOLS };
    for (const id of STUDIO_TOOL_IDS) {
      out[id] = asBool(raw[id], DEFAULT_STUDIO_TOOLS[id]);
    }
    return out;
  } catch {
    return { ...DEFAULT_STUDIO_TOOLS };
  }
}

export async function saveStudioToolSettings(
  input: Partial<StudioToolSettings>
): Promise<StudioToolSettings> {
  const current = await getStudioToolSettings();
  const next = { ...current };
  for (const id of STUDIO_TOOL_IDS) {
    if (typeof input[id] === 'boolean') next[id] = input[id]!;
  }
  await prisma.systemSetting.upsert({
    where: { key: 'STUDIO_TOOLS' },
    create: { key: 'STUDIO_TOOLS', value: next },
    update: { value: next },
  });
  return next;
}

export async function isStudioToolEnabled(toolId: StudioToolId): Promise<boolean> {
  const tools = await getStudioToolSettings();
  return tools[toolId] !== false;
}

export type StudioQueueControl = {
  /** When true, checkAndDispatchNextJobs will not start new IN_QUEUE jobs */
  paused: boolean;
  pausedAt: string | null;
  pausedBy: string | null;
};

export const DEFAULT_QUEUE_CONTROL: StudioQueueControl = {
  paused: false,
  pausedAt: null,
  pausedBy: null,
};

export async function getStudioQueueControl(): Promise<StudioQueueControl> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: 'STUDIO_QUEUE' } });
    const raw = (row?.value as Record<string, unknown>) || {};
    return {
      paused: asBool(raw.paused, false),
      pausedAt: typeof raw.pausedAt === 'string' ? raw.pausedAt : null,
      pausedBy: typeof raw.pausedBy === 'string' ? raw.pausedBy : null,
    };
  } catch {
    return { ...DEFAULT_QUEUE_CONTROL };
  }
}

export async function setStudioQueuePaused(
  paused: boolean,
  adminEmail?: string | null
): Promise<StudioQueueControl> {
  const next: StudioQueueControl = {
    paused,
    pausedAt: paused ? new Date().toISOString() : null,
    pausedBy: paused ? adminEmail || 'admin' : null,
  };
  await prisma.systemSetting.upsert({
    where: { key: 'STUDIO_QUEUE' },
    create: { key: 'STUDIO_QUEUE', value: next },
    update: { value: next },
  });
  return next;
}
