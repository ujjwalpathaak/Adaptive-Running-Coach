import { cacheDelByPrefix, cacheGet, cacheSet, getCacheMode } from '../cache/redis.js';
import {
  fetchGarminRunDetail,
  fetchGarminRuns,
  type GarminRunDetail,
  type GarminRunRow,
} from './client.js';

const LIST_TTL_SEC = Number(process.env.GARMIN_CACHE_TTL_SEC ?? 15 * 60);
const DETAIL_TTL_SEC = Number(process.env.GARMIN_DETAIL_CACHE_TTL_SEC ?? 60 * 60);
const KEY_PREFIX = 'garmin:';

function listKey(startDate?: string, endDate?: string, limit?: number): string {
  return `${KEY_PREFIX}runs:${startDate ?? 'default'}:${endDate ?? 'default'}:${limit ?? 50}`;
}

function detailKey(id: string): string {
  return `${KEY_PREFIX}run:${id}`;
}

export async function getCachedGarminRuns(options?: {
  startDate?: string;
  endDate?: string;
  limit?: number;
  refresh?: boolean;
}): Promise<{ runs: GarminRunRow[]; cache: 'hit' | 'miss'; store: 'redis' | 'memory' }> {
  const key = listKey(options?.startDate, options?.endDate, options?.limit);

  if (!options?.refresh) {
    const cached = await cacheGet<GarminRunRow[]>(key);
    if (cached) {
      return { runs: cached, cache: 'hit', store: getCacheMode() };
    }
  }

  const runs = await fetchGarminRuns(options);
  await cacheSet(key, runs, LIST_TTL_SEC);
  return { runs, cache: 'miss', store: getCacheMode() };
}

export async function getCachedGarminRunDetail(
  id: string,
  options?: { refresh?: boolean },
): Promise<{ run: GarminRunDetail; cache: 'hit' | 'miss'; store: 'redis' | 'memory' }> {
  const key = detailKey(id);

  if (!options?.refresh) {
    const cached = await cacheGet<GarminRunDetail>(key);
    if (cached) {
      return { run: cached, cache: 'hit', store: getCacheMode() };
    }
  }

  const run = await fetchGarminRunDetail(id);
  await cacheSet(key, run, DETAIL_TTL_SEC);
  return { run, cache: 'miss', store: getCacheMode() };
}

export async function clearGarminCache(): Promise<{ removed: number; store: 'redis' | 'memory' }> {
  const removed = await cacheDelByPrefix(KEY_PREFIX);
  return { removed, store: getCacheMode() };
}
