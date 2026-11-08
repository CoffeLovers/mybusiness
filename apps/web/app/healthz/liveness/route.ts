import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({
    status: 'ok',
    service: 'web',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
