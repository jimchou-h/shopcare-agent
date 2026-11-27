import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { removeTempDir } from './support/temp';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/server/app';
import type { ServerConfig } from '../src/server/config';
import type { DeepSeekGenerator } from '../src/server/deepseek/client';
import type { DemoSessionResponse } from '../src/shared/orders';

const HOST = 'shopcare.test';
const ORIGIN = `http://${HOST}`;
/** 2026-11-26 18:00（Asia/Shanghai）。 */
const NOW = Date.UTC(2026, 10, 26, 10, 0, 0);
const SEED_PRODUCT = '轻量通勤双肩包';
const SOURCE_IDS = [
  'faq-exchange-window',
  'faq-exchange-condition',
  'faq-exchange-shipping'
];

interface Harness {
  app: FastifyInstance;
  databasePath: string;
  claim(): Promise<{ cookie: string; orderId: string }>;
  ask(question: string, headers?: Record<string, string | undefined>): Promise<LightMyRequestResponse>;
  confirm(
    payload: unknown,
    headers?: Record<string, string | undefined>
  ): Promise<LightMyRequestResponse>;
  updateSignedAt(orderId: string, value: number | null): void;
  readAll<T>(sql: string, ...params: unknown[]): T[];
}

function readCookie(response: LightMyRequestResponse): string {
  const raw = response.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    throw new Error('响应没有设置演示会话 Cookie');
  }
  return value.split(';')[0] ?? '';
}

function readAll<T>(databasePath: string, sql: string, ...params: unknown[]): T[] {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare(sql).all(...(params as never[])) as T[];
  } finally {
    db.close();
  }
}

function buildHarness(app: FastifyInstance, databasePath: string): Harness {
  function headers(extra: Record<string, string | undefined> = {}) {
    const merged: Record<string, string> = { host: HOST, origin: ORIGIN };
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    return merged;
  }

  return {
    app,
    databasePath,
    async claim() {
      const response = await app.inject({
        method: 'POST',
        url: '/api/demo/session',
        headers: headers()
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<DemoSessionResponse>();
      return { cookie: readCookie(response), orderId: body.order.orderId };
    },
    ask(question, extra = {}) {
      return app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: headers(extra),
        payload: { question }
      });
    },
    confirm(payload, extra = {}) {
      return app.inject({
        method: 'POST',
        url: '/api/exchange/confirm',
        headers: headers(extra),
        payload: payload as object
      });
    },
    updateSignedAt(orderId, value) {
      const db = new DatabaseSync(databasePath);
      try {
        db.prepare('UPDATE demo_orders SET signed_at = ? WHERE order_id = ?').run(value, orderId);
      } finally {
        db.close();
      }
    },
    readAll(sql, ...params) {
      return readAll(databasePath, sql, ...params);
    }
  };
}

async function withHarness(
  run: (harness: Harness) => Promise<void>,
  options: {
    config?: ServerConfig;
    rateLimit?: { limit?: number; windowMs?: number };
    generate?: DeepSeekGenerator;
  } = {}
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'shopcare-exchange-chat-'));
  const databasePath = join(directory, 'shopcare.sqlite');
  const app = buildApp({
    config: { chatMode: 'preset', ...options.config, databasePath },
    rateLimit: options.rateLimit,
    generate: options.generate,
    now: () => NOW
  });

  try {
    await run(buildHarness(app, databasePath));
  } finally {
    await app.close();
    removeTempDir(directory);
  }
}

/** 依次补充原因和商品申报，停在待确认摘要。 */
async function reachSummary(harness: Harness, cookie: string, orderId: string) {
  expect((await harness.ask('我想换货', { cookie })).json()).toMatchObject({
    status: 'exchange_flow',
    outcome: 'step',
    step: 'reason',
    orderId
  });
  expect((await harness.ask('质量问题', { cookie })).json()).toMatchObject({
    outcome: 'step',
    step: 'declaration',
    reason: 'quality'
  });
  const summary = await harness.ask('都齐全', { cookie });
  expect(summary.json()).toMatchObject({ outcome: 'summary' });
  return summary.json() as { confirmationId: string; summary: Record<string, unknown> };
}

describe('POST /api/chat 在对话内办理换货', () => {
  it('逐轮补充原因与商品申报后展示摘要，尚未写入申请', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();

      const start = await harness.ask('我想换货', { cookie });
      expect(start.statusCode).toBe(200);
      expect(start.json()).toMatchObject({
        status: 'exchange_flow',
        outcome: 'step',
        step: 'reason',
        orderId
      });
      expect(start.json().options).toEqual(['质量问题', '其他原因']);

      const reason = await harness.ask('质量问题', { cookie });
      expect(reason.json()).toMatchObject({
        status: 'exchange_flow',
        outcome: 'step',
        step: 'declaration',
        orderId,
        reason: 'quality'
      });
      expect(reason.json().message).toContain('质量问题');

      const summary = await harness.ask('都齐全', { cookie });
      const body = summary.json();
      expect(body).toMatchObject({
        status: 'exchange_flow',
        outcome: 'summary',
        summary: {
          orderId,
          productName: SEED_PRODUCT,
          reason: 'quality',
          reasonLabel: '质量问题',
          shipping: { borneBy: 'merchant' }
        }
      });
      expect(body.confirmationId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      expect(body.summary.shipping.note).toContain('商家承担');
      expect(body.summary.sources.map((source: { id: string }) => source.id)).toEqual(SOURCE_IDS);

      expect(harness.readAll('SELECT * FROM exchange_applications')).toEqual([]);
      expect(harness.readAll<{ step: string; reason: string }>(
        'SELECT step, reason FROM exchange_flows'
      )).toEqual([{ step: 'confirmation', reason: 'quality' }]);
    });
  });

  it('办理途中插问 FAQ 后继续沿用原订单和已选原因', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      await harness.ask('我想换货', { cookie });
      await harness.ask('质量问题', { cookie });

      const faq = await harness.ask('换货期限是多久？', { cookie });
      expect(faq.json()).toMatchObject({
        status: 'answered',
        mode: 'preset',
        source: { id: 'faq-exchange-window' }
      });

      const summary = await harness.ask('都齐全', { cookie });
      expect(summary.json()).toMatchObject({
        status: 'exchange_flow',
        outcome: 'summary',
        summary: { orderId, reason: 'quality', reasonLabel: '质量问题' }
      });
    });
  });

  it('聊天文本「确认」只提示点击摘要按钮，不写入申请', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      const summary = await reachSummary(harness, cookie, orderId);

      const confirmed = await harness.ask('确认', { cookie });
      expect(confirmed.json()).toMatchObject({
        status: 'exchange_flow',
        outcome: 'notice'
      });
      expect(confirmed.json().message).toContain('确认提交');
      expect(harness.readAll('SELECT * FROM exchange_applications')).toEqual([]);

      // 摘要按钮复用原确认接口，仍然可以正常提交。
      const submitted = await harness.confirm(
        { confirmationId: summary.confirmationId },
        { cookie }
      );
      expect(submitted.json()).toMatchObject({ outcome: 'submitted' });
      expect(harness.readAll('SELECT * FROM exchange_flows')).toEqual([]);
    });
  });

  it('发起换货结束查单补问，办理中缺单号的查单请求提示先完成或取消', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();

      const pending = await harness.ask('查订单', { cookie });
      expect(pending.json()).toMatchObject({ outcome: 'number_required' });

      await harness.ask('我想换货', { cookie });

      // 待补状态已被发起换货结束：单独发单号只提示明确问法。
      const bare = await harness.ask(orderId, { cookie });
      expect(bare.json()).toMatchObject({ status: 'order_query', outcome: 'query_hint' });

      const conflict = await harness.ask('查订单', { cookie });
      expect(conflict.json()).toMatchObject({
        status: 'exchange_flow',
        outcome: 'notice'
      });
      expect(conflict.json().message).toContain('取消换货');

      // 办理进度保持不变，下一轮仍按原因后的商品申报推进。
      expect((await harness.ask('质量问题', { cookie })).json()).toMatchObject({
        outcome: 'step',
        step: 'declaration'
      });
    });
  });

  it('带单号的查单不会中断正在进行的换货', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      await harness.ask('我想换货', { cookie });
      await harness.ask('质量问题', { cookie });

      const query = await harness.ask(`查订单 ${orderId}`, { cookie });
      expect(query.json()).toMatchObject({ status: 'order_query', outcome: 'found' });

      const summary = await harness.ask('都齐全', { cookie });
      expect(summary.json()).toMatchObject({
        outcome: 'summary',
        summary: { orderId, reason: 'quality' }
      });
    });
  });

  it.each([
    {
      name: '未签收',
      signedAt: null,
      answer: '都齐全',
      reason: 'not_signed',
      sources: ['faq-exchange-window']
    },
    {
      name: '超过 7 天',
      signedAt: Date.UTC(2026, 10, 5, 2, 0, 0),
      answer: '都齐全',
      reason: 'overdue',
      sources: ['faq-exchange-window']
    },
    {
      name: '商品条件不满足',
      signedAt: NOW,
      answer: '有缺失',
      reason: 'condition_not_met',
      sources: ['faq-exchange-condition']
    }
  ])('$name时在对话中说明原因与出处', async ({ signedAt, answer, reason, sources }) => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      harness.updateSignedAt(orderId, signedAt);

      await harness.ask('我想换货', { cookie });
      await harness.ask('质量问题', { cookie });
      const response = await harness.ask(answer, { cookie });

      expect(response.json()).toMatchObject({
        status: 'exchange_flow',
        outcome: 'ineligible',
        reason
      });
      expect(response.json().sources.map((source: { id: string }) => source.id)).toEqual(sources);
      expect(response.json()).not.toHaveProperty('confirmationId');
      expect(harness.readAll('SELECT * FROM exchange_flows')).toEqual([]);
      expect(harness.readAll('SELECT * FROM exchange_applications')).toEqual([]);
    });
  });

  it('没有有效会话时引导领取，外部来源被拒绝', async () => {
    await withHarness(async (harness) => {
      const anonymous = await harness.ask('我想换货');
      expect(anonymous.json()).toEqual({
        status: 'exchange_flow',
        outcome: 'session_required',
        message: '请先领取示例订单，再办理换货。'
      });

      const { cookie } = await harness.claim();
      const rejected = await harness.ask('我想换货', {
        cookie,
        origin: 'https://evil.example'
      });
      expect(rejected.statusCode).toBe(403);
      expect(harness.readAll('SELECT * FROM exchange_flows')).toEqual([]);
    });
  });

  it('启用 DeepSeek 时换货全流程不调用模型', async () => {
    const generate = { generate: vi.fn() };
    await withHarness(
      async (harness) => {
        const { cookie, orderId } = await harness.claim();
        await reachSummary(harness, cookie, orderId);
        expect(generate.generate).not.toHaveBeenCalled();
      },
      { config: { chatMode: 'deepseek', deepseekApiKey: 'sk-test' }, generate }
    );
  });

  it('超出限流时拒绝对话请求', async () => {
    await withHarness(
      async (harness) => {
        const { cookie } = await harness.claim();
        expect((await harness.ask('我想换货', { cookie })).statusCode).toBe(200);
        const limited = await harness.ask('质量问题', { cookie });
        expect(limited.statusCode).toBe(429);
      },
      { rateLimit: { limit: 1, windowMs: 60_000 } }
    );
  });
});
