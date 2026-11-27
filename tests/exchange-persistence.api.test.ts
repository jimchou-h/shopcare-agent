import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './support/temp';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app';
import type { ChatResponse } from '../src/shared/chat';
import type { DemoSessionResponse } from '../src/shared/orders';

const HOST = 'shopcare.test';
const ORIGIN = `http://${HOST}`;
const START = 1_700_000_000_000;
const DECLARATION = {
  itemIntact: true,
  accessoriesComplete: true,
  originalPackaging: true,
  giftComplete: false
};

function readCookie(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    throw new Error('领取响应缺少演示会话 Cookie');
  }
  return value.split(';')[0] ?? '';
}

async function post(
  app: ReturnType<typeof buildApp>,
  url: string,
  payload: unknown,
  cookie?: string
) {
  return app.inject({
    method: 'POST',
    url,
    headers: { host: HOST, origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    payload: payload as object
  });
}

async function ask(
  app: ReturnType<typeof buildApp>,
  question: string,
  cookie?: string
) {
  return post(app, '/api/chat', { question }, cookie);
}

describe('换货申请在数据卷重建后恢复', () => {
  it('保留数据库重建后原会话查单返回同一申请，独立会话看不到', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shopcare-exchange-db-'));
    const databasePath = join(directory, 'shopcare.sqlite');
    const now = START;

    try {
      const first = buildApp({
        config: { chatMode: 'preset', databasePath },
        now: () => now
      });
      let cookie: string;
      let orderId: string;
      let confirmationId: string;
      let applicationId: string;

      try {
        const claimed = await post(first, '/api/demo/session', {});
        expect(claimed.statusCode).toBe(200);
        cookie = readCookie(claimed.headers);
        orderId = claimed.json<DemoSessionResponse>().order.orderId;

        const preview = await post(
          first,
          '/api/exchange/preview',
          { orderId, reason: 'quality', declaration: DECLARATION },
          cookie
        );
        expect(preview.json()).toMatchObject({ outcome: 'eligible' });
        confirmationId = preview.json().confirmationId;

        const confirmed = await post(
          first,
          '/api/exchange/confirm',
          { confirmationId },
          cookie
        );
        expect(confirmed.json()).toMatchObject({ outcome: 'submitted' });
        applicationId = confirmed.json().application.applicationId;
      } finally {
        await first.close();
      }

      // 使用同一数据文件重建应用，等价于容器保留数据卷重建。
      const rebuilt = buildApp({
        config: { chatMode: 'preset', databasePath },
        now: () => now
      });
      try {
        expect((await rebuilt.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);

        // 响应丢失后的重试在重建后仍返回原申请编号。
        const retried = await post(
          rebuilt,
          '/api/exchange/confirm',
          { confirmationId },
          cookie
        );
        expect(retried.json()).toMatchObject({
          status: 'exchange_application',
          outcome: 'submitted',
          application: { applicationId, status: 'submitted' }
        });

        const resumed = await ask(rebuilt, `查订单 ${orderId}`, cookie);
        expect(resumed.json<ChatResponse>()).toEqual({
          status: 'order_query',
          outcome: 'found',
          order: { orderId, productName: '轻量通勤双肩包', status: '已签收' },
          exchange: { applicationId, status: 'submitted' }
        });

        // 独立浏览器会话领取自己的订单，看不到原访客的申请。
        const strangerClaim = await post(rebuilt, '/api/demo/session', {});
        const strangerCookie = readCookie(strangerClaim.headers);
        const strangerOrderId = strangerClaim.json<DemoSessionResponse>().order.orderId;

        const strangerOwn = await ask(rebuilt, `查订单 ${strangerOrderId}`, strangerCookie);
        expect(strangerOwn.json()).toMatchObject({ outcome: 'found' });
        expect(strangerOwn.json()).not.toHaveProperty('exchange');

        const strangerForeign = await ask(rebuilt, `查订单 ${orderId}`, strangerCookie);
        expect(strangerForeign.json()).toEqual({
          status: 'order_query',
          outcome: 'not_found',
          message: '未找到可查询的订单。'
        });
      } finally {
        await rebuilt.close();
      }
    } finally {
      removeTempDir(directory);
    }
  });
});
