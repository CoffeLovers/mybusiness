import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  // En Next.js BFF el liveness y readiness validan el proceso web activo
  return NextResponse.json(
    {
      status: 'ready',
      service: 'web',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
