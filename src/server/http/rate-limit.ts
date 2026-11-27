/** 公开接口的默认频率限制：每个来源 IP 每分钟最多 60 次请求。 */
export const DEFAULT_RATE_LIMIT = {
  limit: 60,
  windowMs: 60_000
} as const;

export interface RateLimiter {
  /** 消耗一次配额；返回 false 表示当前窗口内已超过限制。 */
  consume(key: string): boolean;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

/**
 * 进程内固定窗口限流。
 *
 * 演示服务只有一个实例，按来源 IP 计数即可挡住脚本高频领取或问答；
 * 窗口到期自动重新计数，不需要额外的持久化或外部依赖。
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const now = options.now ?? Date.now;

  return {
    consume(key) {
      const current = now();
      const bucket = buckets.get(key);

      if (!bucket || current >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: current + options.windowMs });
        return true;
      }

      if (bucket.count >= options.limit) {
        return false;
      }

      bucket.count += 1;
      return true;
    }
  };
}
