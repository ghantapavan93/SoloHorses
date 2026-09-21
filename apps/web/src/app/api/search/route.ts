import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';
import type { SearchHit } from '@/lib/types';

/** ⌘K search, RBAC-scoped by the API. */
export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const hits = await apiFetch<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`, { allowReviewer: true });
  return NextResponse.json(hits);
}
