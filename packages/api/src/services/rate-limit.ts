/**
 * In-memory rate limiter for public endpoints (e.g. receipt submission).
 * Uses a sliding window per key (e.g. client IP).
 *
 * Note: Resets on server restart. For multi-instance deployments, use Redis or similar.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 10;

const store = new Map<string, { count: number; resetAt: number }>();

function prune() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

/**
 * Check and consume one request for the given key. Returns true if allowed, false if over limit.
 */
export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  if (store.size > 10_000) prune();

  const entry = store.get(key);
  if (!entry) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.resetAt <= now) {
    entry.count = 1;
    entry.resetAt = now + WINDOW_MS;
    return true;
  }
  if (entry.count >= MAX_REQUESTS) return false;
  entry.count += 1;
  return true;
}
