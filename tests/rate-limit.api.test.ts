import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app';

const HOST = 'shopcare.test';
const ORIGIN = `http://${HOST}`;
const START = 1_700_000_000_000;

function claim(app: FastifyInstance, remoteAddress = '127.0.0.1') {
  return app.inject({
    method: 'POST',
    url: '/api/demo/session',
    headers: { host: HOST, origin: ORIGIN },
    remoteAddress
  });
}

function ask(app: FastifyInstance, question: string, remoteAddress = '127.0.0.1') {
  return app.inject({
    method: 'POST',
    url: '/api/chat',
    headers: { host: HOST },
    remoteAddress,
    payload: { question }
  });
}

describe('公开入口限流', () => {
  it('领取接口超过窗口额度后返回 429，窗口结束后恢复', async () => {
    let now = START;
    const app = buildApp({
      now: () => now,
      rateLimit: { limit: 2, windowMs: 60_000 }
    });

    try {
      expect((await claim(app)).statusCode).toBe(200);
      expect((await claim(app)).statusCode).toBe(200);

      const blocked = await claim(app);
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toEqual({
        status: 'rate_limited',
        message: '请求过于频繁，请稍后重试。'
      });

      now += 60_001;
      expect((await claim(app)).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('问答接口使用独立配额并在超限时返回 429', async () => {
    const app = buildApp({ rateLimit: { limit: 1, windowMs: 60_000 } });

    try {
      expect((await ask(app, '换货期限是多久？')).statusCode).toBe(200);

      const blocked = await ask(app, '退货期限是多久？');
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toMatchObject({
        status: 'rate_limited',
        message: '请求过于频繁，请稍后重试。'
      });
    } finally {
      await app.close();
    }
  });

  it('按来源 IP 分别计算配额', async () => {
    const app = buildApp({ rateLimit: { limit: 1, windowMs: 60_000 } });

    try {
      expect((await claim(app, '203.0.113.1')).statusCode).toBe(200);
      expect((await claim(app, '203.0.113.1')).statusCode).toBe(429);
      expect((await claim(app, '203.0.113.2')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
