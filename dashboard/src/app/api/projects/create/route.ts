import { NextResponse } from 'next/server';
import { POST as createProject } from '../route';

export async function POST(req: Request) {
  return createProject(req);
}
