import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { detectGoogleFlowAccount } from '@/lib/provider-detect';

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const { cookies } = body;

    if (!cookies || !cookies.trim()) {
      return NextResponse.json(
        { error: 'Cookie string is required for probing' },
        { status: 400 }
      );
    }

    const details = await detectGoogleFlowAccount(cookies.trim());

    return NextResponse.json({
      success: true,
      details,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to probe Google Flow account' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}
