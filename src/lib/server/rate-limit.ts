/**
 * Общий in-memory rate limiter (security audit).
 * globalThis-singleton: route-бандлы Next dev не шарят module state.
 * Окно 60с, лимит на IP+route. Для production с несколькими
 * инстансами заменить на Redis/Upstash.
 */

import { NextResponse } from 'next/server';

interface Bucket {
  hits: number[];
}

const buckets = (() => {
  const g = globalThis as unknown as Record<string, Map<string, Bucket> | undefined>;
  g['__castRateLimits__'] ??= new Map();
  return g['__castRateLimits__'];
})();

const WINDOW_MS = 60_000;
const MAX_KEYS = 10_000; // защита от раздувания Map при флуде с рандомных IP

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

/** true → лимит превышен. */
export function isRateLimited(routeKey: string, ip: string, limit: number): boolean {
  const now = Date.now();
  const key = `${routeKey}:${ip}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_KEYS) {
      // грубая зачистка: удаляем устаревшие записи; если всё свежее — отказываем
      for (const [k, b] of buckets) {
        if (b.hits.every((t) => now - t >= WINDOW_MS)) buckets.delete(k);
      }
      if (buckets.size >= MAX_KEYS) return true;
    }
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  bucket.hits = bucket.hits.filter((t) => now - t < WINDOW_MS);
  bucket.hits.push(now);
  return bucket.hits.length > limit;
}

/** 429-ответ или null. */
export function rateLimitResponse(routeKey: string, req: Request, limit: number): NextResponse | null {
  if (isRateLimited(routeKey, clientIp(req), limit)) {
    return NextResponse.json({ error: 'rate limited — wait a minute' }, { status: 429 });
  }
  return null;
}
