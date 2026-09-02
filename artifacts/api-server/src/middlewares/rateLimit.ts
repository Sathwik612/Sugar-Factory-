import type { NextFunction, Request, Response } from "express";

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
};

const MAX_BUCKETS = 10_000;

function cleanExpired(buckets: Map<string, Bucket>, now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function createRateLimiter(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    cleanExpired(buckets, now);
    const key = options.key?.(req) ?? req.ip ?? req.socket.remoteAddress ?? "unknown";
    const existing = buckets.get(key);
    const bucket = !existing || existing.resetAt <= now
      ? { count: 1, resetAt: now + options.windowMs }
      : { ...existing, count: existing.count + 1 };
    buckets.set(key, bucket);
    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader("RateLimit-Limit", options.max);
    res.setHeader("RateLimit-Remaining", remaining);
    res.setHeader("RateLimit-Reset", Math.ceil(bucket.resetAt / 1000));
    if (bucket.count > options.max) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: "Too many requests. Please wait and try again." });
      return;
    }
    next();
  };
}

function envNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const apiRateLimiter = createRateLimiter({
  windowMs: envNumber("RATE_LIMIT_WINDOW_MS", 60_000),
  max: envNumber("RATE_LIMIT_MAX", 300),
});

export const loginRateLimiter = createRateLimiter({
  windowMs: envNumber("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60_000),
  max: envNumber("AUTH_RATE_LIMIT_MAX", 10),
  key: (req) => {
    const username = typeof req.body?.username === "string"
      ? req.body.username.trim().toLowerCase()
      : "unknown";
    return `${req.ip ?? req.socket.remoteAddress ?? "unknown"}:${username}`;
  },
});