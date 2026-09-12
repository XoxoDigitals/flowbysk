import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';

/** Flow / Veo character voice presets (served from Next — no Python). */
export const CHARACTER_VOICE_PRESETS = [
  { id: 'achernar', name: 'Achernar', description: 'Soft' },
  { id: 'achird', name: 'Achird', description: 'Friendly' },
  { id: 'algenib', name: 'Algenib', description: 'Gravelly' },
  { id: 'algieba', name: 'Algieba', description: 'Smooth' },
  { id: 'alnilam', name: 'Alnilam', description: 'Firm' },
  { id: 'aoede', name: 'Aoede', description: 'Breezy' },
  { id: 'autonoe', name: 'Autonoe', description: 'Bright' },
  { id: 'callirrhoe', name: 'Callirrhoe', description: 'Easy-going' },
  { id: 'charon', name: 'Charon', description: 'Informative' },
  { id: 'despina', name: 'Despina', description: 'Smooth' },
  { id: 'enceladus', name: 'Enceladus', description: 'Breathy' },
  { id: 'erinome', name: 'Erinome', description: 'Clear' },
  { id: 'fenrir', name: 'Fenrir', description: 'Excitable' },
  { id: 'gacrux', name: 'Gacrux', description: 'Mature' },
  { id: 'iapetus', name: 'Iapetus', description: 'Clear' },
  { id: 'kore', name: 'Kore', description: 'Firm' },
  { id: 'laomedeia', name: 'Laomedeia', description: 'Upbeat' },
  { id: 'leda', name: 'Leda', description: 'Youthful' },
  { id: 'orus', name: 'Orus', description: 'Firm' },
  { id: 'puck', name: 'Puck', description: 'Upbeat' },
  { id: 'pulcherrima', name: 'Pulcherrima', description: 'Forward' },
  { id: 'rasalgethi', name: 'Rasalgethi', description: 'Informative' },
  { id: 'sadachbia', name: 'Sadachbia', description: 'Lively' },
  { id: 'sadaltager', name: 'Sadaltager', description: 'Knowledgeable' },
  { id: 'schedar', name: 'Schedar', description: 'Even' },
  { id: 'sulafat', name: 'Sulafat', description: 'Warm' },
  { id: 'umbriel', name: 'Umbriel', description: 'Easy-going' },
  { id: 'vindemiatrix', name: 'Vindemiatrix', description: 'Gentle' },
  { id: 'zephyr', name: 'Zephyr', description: 'Bright' },
  { id: 'zircon', name: 'Zircon', description: 'Clear' },
];

export async function GET(req: Request) {
  try {
    await getOrCreateStudioUser(req);
    return NextResponse.json({ success: true, voices: CHARACTER_VOICE_PRESETS });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
}
