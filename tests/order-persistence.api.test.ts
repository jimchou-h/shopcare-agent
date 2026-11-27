import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app';
import { DEFAULT_SESSION_TTL_MS } from '../src/server/demo-session/repository';
import type { ChatResponse } from '../src/shared/chat';
import type { DemoSessionResponse } from '../src/shared/orders';

const HOST = 'shopcare.test';
const ORIGIN = `http://${HOST}`;
const START = 1_700_000_000_000;

interface TempDatabase {
  directory: string;
  databasePath: string;
  cleanup(): void;
}

function createTempDatabase(): TempDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'shopcare-db-'));
  return {
    directory,
    databasePath: join(directory, 'shopcare.sqlite'),
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

function readCookie(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    throw new Error('领取响应缺少演示会话 Cookie');
  }
  return value.split(';')[0] ?? '';
}

async function claim(app: ReturnType<typeof buildApp>, cookie?: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/demo/session',
    headers: { host: HOST, origin: ORIGIN, ...(cookie ? { cookie } : {}) }
  });
  return response;
}

async function ask(
  app: ReturnType<typeof buildApp>,
  question: string,
  cookie?: string
) {
  return app.inject({
    method: 'POST',
    url: '/api/chat',
    headers: { host: HOST, ...(cookie ? { cookie } : {}) },
    payload: { question }
  });
}

describe('演示状态在数据库重建后恢复', () => {
  it('保留数据库时原浏览器可继续补单号，新浏览器不能读取原会话', async () => {
    const temp = createTempDatabase();
    const now = START;

    try {
      const first = buildApp({
        config: { chatMode: 'preset', databasePath: temp.databasePath },
        now: () => now
      });
      const claimed = await claim(first);
      expect(claimed.statusCode).toBe(200);
      const cookie = readCookie(claimed.headers);
      const orderId = claimed.json<DemoSessionResponse>().order.orderId;

      const pending = await ask(first, '查订单', cookie);
      expect(pending.json<ChatResponse>()).toMatchObject({
        status: 'order_query',
        outcome: 'number_required'
      });
      await first.close();

      // 使用同一数据文件重建应用，等价于容器保留数据卷重建。
      const rebuilt = buildApp({
        config: { chatMode: 'preset', databasePath: temp.databasePath },
        now: () => now
      });
      try {
        expect((await rebuilt.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);

        const stranger = await ask(rebuilt, `查订单 ${orderId}`);
        expect(stranger.json<ChatResponse>()).toMatchObject({
          status: 'order_query',
          outcome: 'session_required'
        });

        const resumed = await ask(rebuilt, orderId, cookie);
        expect(resumed.json<ChatResponse>()).toEqual({
          status: 'order_query',
          outcome: 'found',
          order: { orderId, productName: '轻量通勤双肩包', status: '已签收' }
        });
      } finally {
        await rebuilt.close();
      }
    } finally {
      temp.cleanup();
    }
  });

  it('过期会话拒绝查单，重新领取后可以查询新订单', async () => {
    const temp = createTempDatabase();
    let now = START;

    try {
      const app = buildApp({
        config: { chatMode: 'preset', databasePath: temp.databasePath },
        now: () => now
      });
      try {
        const first = await claim(app);
        const cookie = readCookie(first.headers);
        const oldOrderId = first.json<DemoSessionResponse>().order.orderId;

        now += DEFAULT_SESSION_TTL_MS + 1;

        const expired = await ask(app, `查订单 ${oldOrderId}`, cookie);
        expect(expired.json<ChatResponse>()).toEqual({
          status: 'order_query',
          outcome: 'session_required',
          message: '请先领取示例订单，再查询订单状态。'
        });

        const reclaimed = await claim(app, cookie);
        expect(reclaimed.statusCode).toBe(200);
        expect(reclaimed.headers['set-cookie']).toBeDefined();
        const newOrderId = reclaimed.json<DemoSessionResponse>().order.orderId;
        expect(newOrderId).not.toBe(oldOrderId);

        const newCookie = readCookie(reclaimed.headers);
        expect(newCookie).not.toBe(cookie);

        // 旧凭证必须持续失效：即使新订单已建立，旧 Cookie 也不能查询它。
        const staleAttempt = await ask(app, `查订单 ${newOrderId}`, cookie);
        expect(staleAttempt.json<ChatResponse>()).toEqual({
          status: 'order_query',
          outcome: 'session_required',
          message: '请先领取示例订单，再查询订单状态。'
        });

        const fresh = await ask(app, `查订单 ${newOrderId}`, newCookie);
        expect(fresh.json<ChatResponse>()).toMatchObject({
          status: 'order_query',
          outcome: 'found',
          order: { orderId: newOrderId }
        });
      } finally {
        await app.close();
      }
    } finally {
      temp.cleanup();
    }
  });
});
