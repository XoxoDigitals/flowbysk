import { NextResponse } from 'next/server';
import { getStudioToolSettings, STUDIO_TOOL_LABELS } from '@/lib/studioTools';

/** Public (studio) read of which tools are enabled by admin. */
export async function GET() {
  try {
    const tools = await getStudioToolSettings();
    return NextResponse.json({ success: true, tools, labels: STUDIO_TOOL_LABELS });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
