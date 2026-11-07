import { Redis } from 'ioredis';

type MemoryEntry = { value: string; expiresAtMs: number };

const memory = new Map<string, MemoryEntry>();

let redis: Redis | null = null;
let redisReady = false;
let initPromise: Promise<void> | null = null;
let lastReconnectAttemptMs = 0;
const RECONNECT_COOLDOWN_MS = 30_000;

function redisUrl(): string {
  return process.env.REDIS_URL?.trim() || 'redis://127.0.0.1:6379';
}

function memoryGet(key: string): string | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key: string, value: string, ttlSec: number) {
  memory.set(key, { value, expiresAtMs: Date.now() + ttlSec * 1000 });
}

function memoryDel(patternPrefix: string) {
  for (const key of memory.keys()) {
    if (key.startsWith(patternPrefix)) memory.delete(key);
  }
}

async function connectRedis(): Promise<boolean> {
  const url = redisUrl();
  try {
    if (redis) {
      try {
        redis.disconnect();
      } catch {
        // ignore
      }
      redis = null;
    }

    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 1500,
      retryStrategy: () => null,
    });

    client.on('error', () => {
      redisReady = false;
    });
    client.on('end', () => {
      redisReady = false;
    });

    await client.connect();
    const pong = await client.ping();
    if (pong !== 'PONG') {
      client.disconnect();
      redisReady = false;
      redis = null;
      return false;
    }

    redis = client;
    redisReady = true;
    return true;
  } catch {
    redis = null;
    redisReady = false;
    return false;
  }
}

/** Redis is primary. If unreachable, callers transparently use in-memory fallback. */
export async function initCache(): Promise<{ mode: 'redis' | 'memory'; url: string }> {
  const url = redisUrl();
  if (!initPromise) {
    initPromise = (async () => {
      await connectRedis();
    })();
  }
  await initPromise;
  return { mode: redisReady ? 'redis' : 'memory', url };
}

async function maybeReconnect(): Promise<void> {
  if (redisReady && redis) return;
  const now = Date.now();
  if (now - lastReconnectAttemptMs < RECONNECT_COOLDOWN_MS) return;
  lastReconnectAttemptMs = now;
  await connectRedis();
}

export function getCacheMode(): 'redis' | 'memory' {
  return redisReady && redis ? 'redis' : 'memory';
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  await maybeReconnect();

  try {
    if (redisReady && redis) {
      const raw = await redis.get(key);
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    }
  } catch {
    redisReady = false;
  }

  const raw = memoryGet(key);
  if (raw == null) return null;
  return JSON.parse(raw) as T;
}

export async function cacheSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  await maybeReconnect();
  const raw = JSON.stringify(value);

  try {
    if (redisReady && redis) {
      await redis.set(key, raw, 'EX', ttlSec);
      // Keep a warm memory copy so a brief Redis outage still serves recent data.
      memorySet(key, raw, ttlSec);
      return;
    }
  } catch {
    redisReady = false;
  }

  memorySet(key, raw, ttlSec);
}

export async function cacheDelByPrefix(prefix: string): Promise<number> {
  await maybeReconnect();
  let removed = 0;

  try {
    if (redisReady && redis) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
        cursor = next;
        if (keys.length) {
          removed += await redis.del(...keys);
        }
      } while (cursor !== '0');
      memoryDel(prefix);
      return removed;
    }
  } catch {
    redisReady = false;
  }

  const before = memory.size;
  memoryDel(prefix);
  return before - memory.size;
}
