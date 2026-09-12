import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';

const STYLES = [
  'cinematic film look with 35mm grain',
  'photorealistic, intricate octane render details',
  'moody volumetric lighting with anamorphic lens flare',
  'hyper-detailed IMAX cinematography, ultra-crisp textures',
];
const CAMERAS = [
  'slow dynamic push-in camera track',
  'subtle cinematic pan with shallow depth of field',
  'low-angle heroic perspective with smooth gimbal motion',
  'sweeping drone aerial orbit revealing the landscape',
];
const LIGHTING = [
  'warm golden hour side-lighting with soft diffused shadows',
  'dramatic chiaroscuro lighting with deep atmospheric haze',
  'vibrant neon rim light cutting through misty twilight ambience',
  'natural overcast soft light with high dynamic range',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Local prompt enhancer (same behavior as Python) — no BiB/Python needed. */
export async function POST(req: Request) {
  try {
    await getOrCreateStudioUser(req);
    const body = await req.json().catch(() => ({}));
    const base = String(body.prompt || body.base_prompt || '').trim();
    if (!base) {
      return NextResponse.json({
        success: true,
        prompt:
          'Cinematic landscape with rolling hills, golden hour sunlight, slow sweeping drone tracking shot, 8k resolution hyperrealistic texture',
      });
    }
    const enhanced = `${base}, ${pick(LIGHTING)}, ${pick(CAMERAS)}, ${pick(STYLES)}`;
    return NextResponse.json({ success: true, prompt: enhanced, enhanced_prompt: enhanced });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
}
