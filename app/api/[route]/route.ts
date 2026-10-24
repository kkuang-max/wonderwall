// One handler for every /api/* endpoint the wall, station, and sticker pages call.
import os from 'node:os';
import * as core from '@/lib/core';
import { persistent } from '@/lib/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ route: string }> };

function fail(e: unknown) {
  const err = e as { status?: number; message?: string };
  if (!err.status) console.error(e);
  return Response.json({ error: err.message || 'Server error' }, { status: err.status || 500 });
}

// Addresses other devices on the same Wi-Fi can use (only meaningful when running locally).
function lanUrls(request: Request) {
  if (process.env.VERCEL) return [];
  const url = new URL(request.url);
  const urls: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) urls.push(url.protocol + '//' + n.address + (url.port ? ':' + url.port : ''));
  }
  return urls;
}

export async function GET(request: Request, { params }: Ctx) {
  const { route } = await params;
  try {
    if (route === 'state') return Response.json(await core.getState());
    if (route === 'events') {
      const since = Number(new URL(request.url).searchParams.get('since'));
      return Response.json(await core.eventsSince(since));
    }
    if (route === 'info') return Response.json({ urls: lanUrls(request), persistent, vercel: Boolean(process.env.VERCEL) });
    return Response.json({ error: 'Not found' }, { status: 404 });
  } catch (e) { return fail(e); }
}

export async function POST(request: Request, { params }: Ctx) {
  const { route } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    if (route === 'tap') return Response.json(await core.tap(body));
    if (route === 'action') return Response.json(await core.act(body));
    if (route === 'scene') return Response.json(await core.setScene(body));
    if (route === 'reset') return Response.json(await core.reset());
    return Response.json({ error: 'Not found' }, { status: 404 });
  } catch (e) { return fail(e); }
}
