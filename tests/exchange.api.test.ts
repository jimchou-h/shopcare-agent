import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/server/app';
import type { ServerConfig } from '../src/server/config';
import { hashSessionToken } from '../src/server/demo-session/token';
import { DEMO_SESSION_COOKIE } from '../src/server/http/cookies';
import type { DeepSeekGenerator } from '../src/server/deepseek/client';
import type { DemoSessionResponse } from '../src/shared/orders';

const HOST = 'shopcare.test';
const ORIGIN = `http://${HOST}`;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 2026-11-26 18:00（Asia/Shanghai），用作大多数用例的“当前时间”。 */
const NOW = Date.UTC(2026, 10, 26, 10, 0, 0);
const SEED_PRODUCT = '轻量通勤双肩包';
const ALL_DECLARED = {
  itemIntact: true,
  accessoriesComplete: true,
  originalPackaging: true,
  giftComplete: true
};

interface Harness {
  app: FastifyInstance;
  databasePath: string;
  claim(): Promise<{ cookie: string; orderId: string }>;
  preview(
    payload: unknown,
    headers?: Record<string, string | undefined>
  ): Promise<LightMyRequestResponse>;
  confirm(
    payload: unknown,
    headers?: Record<string, string | undefined>
  ): Promise<LightMyRequestResponse>;
  ask(
    question: string,
    headers?: Record<string, string | undefined>
  ): Promise<LightMyRequestResponse>;
  setNow(value: number): void;
  advance(ms: number): void;
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

function buildHarness(
  app: FastifyInstance,
  databasePath: string,
  clock: { now: number }
): Harness {
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
    preview(payload, extra = {}) {
      return app.inject({
        method: 'POST',
        url: '/api/exchange/preview',
        headers: headers(extra),
        payload: payload as object
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
    ask(question, extra = {}) {
      return app.inject({
        method: 'POST',
        url: '/api/chat',
        headers: headers(extra),
        payload: { question }
      });
    },
    setNow(value) {
      clock.now = value;
    },
    advance(ms) {
      clock.now += ms;
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
  const directory = mkdtempSync(join(tmpdir(), 'shopcare-exchange-'));
  const databasePath = join(directory, 'shopcare.sqlite');
  const clock = { now: NOW };
  const app = buildApp({
    config: { chatMode: 'preset', ...options.config, databasePath },
    rateLimit: options.rateLimit,
    generate: options.generate,
    now: () => clock.now
  });

  try {
    await run(buildHarness(app, databasePath, clock));
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('POST /api/exchange/preview 核对换货资格', () => {
  it('符合条件时返回待确认摘要、两类运费说明与政策出处', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();

      const quality = await harness.preview(
        { orderId, reason: 'quality', declaration: ALL_DECLARED },
        { cookie }
      );
      expect(quality.statusCode).toBe(200);
      const qualityBody = quality.json();
      expect(qualityBody).toMatchObject({
        status: 'exchange_preview',
        outcome: 'eligible',
        summary: {
          orderId,
          productName: SEED_PRODUCT,
          reason: 'quality',
          reasonLabel: '质量问题',
          shipping: { borneBy: 'merchant' }
        }
      });
      expect(qualityBody.confirmationId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      expect(qualityBody.expiresAt).toBe(NOW + 10 * 60 * 1000);
      expect(qualityBody.summary.shipping.note).toContain('商家承担');
      expect(qualityBody.summary.sources.map((source: { id: string }) => source.id)).toEqual([
        'faq-exchange-window',
        'faq-exchange-condition',
        'faq-exchange-shipping'
      ]);
      for (const source of qualityBody.summary.sources) {
        expect(source.title).toBeTruthy();
        expect(source.excerpt).toBeTruthy();
        expect(source.version).toBeTruthy();
      }

      const other = await harness.preview(
        { orderId, reason: 'other', declaration: ALL_DECLARED },
        { cookie }
      );
      expect(other.json()).toMatchObject({
        outcome: 'eligible',
        summary: {
          reason: 'other',
          reasonLabel: '其他原因',
          shipping: { borneBy: 'customer' }
        }
      });
      expect(other.json().summary.shipping.note).toContain('顾客承担');
    });
  });

  it('签收第 7 天可申请，第 8 天零时起返回逾期原因', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      // 签收于 2026-11-19 10:00（上海）：第 7 天为 11-25，第 8 天从 11-26 00:00 开始。
      harness.updateSignedAt(orderId, Date.UTC(2026, 10, 19, 2, 0, 0));
      const payload = { orderId, reason: 'quality', declaration: ALL_DECLARED };

      harness.setNow(Date.UTC(2026, 10, 25, 15, 59, 59));
      expect((await harness.preview(payload, { cookie })).json()).toMatchObject({
        outcome: 'eligible'
      });

      harness.setNow(Date.UTC(2026, 10, 25, 16, 0, 0));
      const overdue = await harness.preview(payload, { cookie });
      expect(overdue.json()).toMatchObject({
        status: 'exchange_preview',
        outcome: 'ineligible',
        reason: 'overdue'
      });
      expect(overdue.json().message).toContain('7 天');
      expect(overdue.json().sources.map((source: { id: string }) => source.id)).toEqual([
        'faq-exchange-window'
      ]);
      expect(overdue.json()).not.toHaveProperty('confirmationId');
    });
  });

  it('未签收时说明原因并引用期限政策', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      harness.updateSignedAt(orderId, null);

      const response = await harness.preview(
        { orderId, reason: 'quality', declaration: ALL_DECLARED },
        { cookie }
      );
      expect(response.json()).toMatchObject({
        status: 'exchange_preview',
        outcome: 'ineligible',
        reason: 'not_signed'
      });
      expect(response.json().message).toContain('尚未签收');
      expect(response.json().sources.map((source: { id: string }) => source.id)).toEqual([
        'faq-exchange-window'
      ]);
    });
  });

  it.each([
    { field: 'itemIntact', label: '商品完好' },
    { field: 'accessoriesComplete', label: '配件齐全' },
    { field: 'originalPackaging', label: '原包装齐全' }
  ])('顾客未确认$label时返回商品条件原因', async ({ field }) => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();

      const response = await harness.preview(
        {
          orderId,
          reason: 'quality',
          declaration: { ...ALL_DECLARED, [field]: false }
        },
        { cookie }
      );
      expect(response.json()).toMatchObject({
        status: 'exchange_preview',
        outcome: 'ineligible',
        reason: 'condition_not_met'
      });
      expect(response.json().sources.map((source: { id: string }) => source.id)).toEqual([
        'faq-exchange-condition'
      ]);
    });
  });

  it('没有有效会话时引导领取，不返回摘要', async () => {
    await withHarness(async (harness) => {
      const response = await harness.preview({
        orderId: 'SC-AB12CD34EF56',
        reason: 'quality',
        declaration: ALL_DECLARED
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'exchange_preview',
        outcome: 'session_required',
        message: '请先领取示例订单，再申请换货。'
      });
      expect(response.json()).not.toHaveProperty('confirmationId');
      expect(harness.readAll('SELECT * FROM exchange_summaries')).toEqual([]);
    });
  });

  it('其他访客的订单与不存在的单号得到一致响应', async () => {
    await withHarness(async (harness) => {
      const visitorA = await harness.claim();
      const visitorB = await harness.claim();

      const foreign = await harness.preview(
        { orderId: visitorA.orderId, reason: 'quality', declaration: ALL_DECLARED },
        { cookie: visitorB.cookie }
      );
      const missing = await harness.preview(
        { orderId: 'SC-ZZZZZZZZZZZZ', reason: 'quality', declaration: ALL_DECLARED },
        { cookie: visitorB.cookie }
      );

      expect(foreign.json()).toEqual(missing.json());
      expect(foreign.json()).toMatchObject({
        status: 'exchange_preview',
        outcome: 'not_found',
        message: '未找到可办理换货的订单。'
      });
      expect(foreign.json()).not.toHaveProperty('confirmationId');
      expect(harness.readAll('SELECT * FROM exchange_summaries')).toEqual([]);
    });
  });

  it('外部来源不能创建换货摘要', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();

      const response = await harness.preview(
        { orderId, reason: 'quality', declaration: ALL_DECLARED },
        { cookie, origin: 'https://evil.example' }
      );
      expect(response.statusCode).toBe(403);
      expect(harness.readAll('SELECT * FROM exchange_summaries')).toEqual([]);
    });
  });

  it('重新预览会替换此前的待确认摘要', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      const payload = { orderId, reason: 'quality', declaration: ALL_DECLARED };

      const first = await harness.preview(payload, { cookie });
      const second = await harness.preview(payload, { cookie });
      expect(first.json().confirmationId).not.toBe(second.json().confirmationId);

      const rows = harness.readAll<{ confirmation_id: string; superseded_at: number | null }>(
        'SELECT confirmation_id, superseded_at FROM exchange_summaries'
      );
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.superseded_at === null)).toHaveLength(1);
      const old = rows.find((row) => row.confirmation_id === first.json().confirmationId);
      expect(old?.superseded_at).not.toBeNull();
    });
  });

  it('超出限流时拒绝预览', async () => {
    await withHarness(
      async (harness) => {
        const { cookie, orderId } = await harness.claim();
        const payload = { orderId, reason: 'quality', declaration: ALL_DECLARED };

        expect((await harness.preview(payload, { cookie })).statusCode).toBe(200);
        const limited = await harness.preview(payload, { cookie });
        expect(limited.statusCode).toBe(429);
        expect(limited.json()).toEqual({
          status: 'rate_limited',
          message: '请求过于频繁，请稍后重试。'
        });
      },
      { rateLimit: { limit: 1, windowMs: 60_000 } }
    );
  });

  it('启用 DeepSeek 时换货预览不调用模型', async () => {
    const generate = { generate: vi.fn() };
    await withHarness(
      async (harness) => {
        const { cookie, orderId } = await harness.claim();

        const response = await harness.preview(
          { orderId, reason: 'quality', declaration: ALL_DECLARED },
          { cookie }
        );
        expect(response.json()).toMatchObject({ outcome: 'eligible' });
        expect(generate.generate).not.toHaveBeenCalled();
      },
      { config: { chatMode: 'deepseek', deepseekApiKey: 'sk-test' }, generate }
    );
  });
});

describe('POST /api/exchange/confirm 确认提交换货申请', () => {
  async function previewConfirmation(
    harness: Harness,
    cookie: string,
    orderId: string
  ): Promise<string> {
    const response = await harness.preview(
      { orderId, reason: 'quality', declaration: ALL_DECLARED },
      { cookie }
    );
    expect(response.json()).toMatchObject({ outcome: 'eligible' });
    return response.json().confirmationId as string;
  }

  it('确认有效摘要后返回申请编号与已提交状态', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      const confirmationId = await previewConfirmation(harness, cookie, orderId);

      const response = await harness.confirm({ confirmationId }, { cookie });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        status: 'exchange_application',
        outcome: 'submitted',
        application: { status: 'submitted' }
      });
      expect(body.application.applicationId).toMatch(/^EX-[A-Z0-9]{12}$/);

      const rows = harness.readAll<{ confirmation_id: string; status: string }>(
        'SELECT confirmation_id, status FROM exchange_applications'
      );
      expect(rows).toEqual([
        { confirmation_id: confirmationId, status: 'submitted' }
      ]);
    });
  });

  it('重复提交同一确认返回同一申请编号，数据库只有一笔申请', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      const confirmationId = await previewConfirmation(harness, cookie, orderId);

      const first = await harness.confirm({ confirmationId }, { cookie });
      const second = await harness.confirm({ confirmationId }, { cookie });

      expect(second.json()).toEqual(first.json());
      expect(harness.readAll('SELECT * FROM exchange_applications')).toHaveLength(1);
    });
  });

  it('并发提交同一确认只创建一笔申请', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      const confirmationId = await previewConfirmation(harness, cookie, orderId);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => harness.confirm({ confirmationId }, { cookie }))
      );
      const applicationIds = responses.map(
        (response) => response.json().application.applicationId as string
      );

      expect(new Set(applicationIds).size).toBe(1);
      expect(harness.readAll('SELECT * FROM exchange_applications')).toHaveLength(1);
    });
  });

  it('过期摘要被拒绝且不写入申请', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      const confirmationId = await previewConfirmation(harness, cookie, orderId);

      harness.advance(10 * 60 * 1000 + 1);
      const response = await harness.confirm({ confirmationId }, { cookie });

      expect(response.json()).toMatchObject({
        status: 'exchange_application',
        outcome: 'expired'
      });
      expect(response.json().message).toContain('重新核对');
      expect(harness.readAll('SELECT * FROM exchange_applications')).toEqual([]);
    });
  });

  it('被替换的摘要不能提交，最新摘要可以提交', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      const payload = { orderId, reason: 'quality', declaration: ALL_DECLARED };
      const oldConfirmation = (await harness.preview(payload, { cookie })).json()
        .confirmationId as string;
      const latestConfirmation = (await harness.preview(payload, { cookie })).json()
        .confirmationId as string;

      const stale = await harness.confirm({ confirmationId: oldConfirmation }, { cookie });
      expect(stale.json()).toMatchObject({
        status: 'exchange_application',
        outcome: 'superseded'
      });
      expect(harness.readAll('SELECT * FROM exchange_applications')).toEqual([]);

      const latest = await harness.confirm({ confirmationId: latestConfirmation }, { cookie });
      expect(latest.json()).toMatchObject({ outcome: 'submitted' });
    });
  });

  it('预览后越过期限时确认返回逾期原因且不写入申请', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      // 签收于第 7 天 23:55（上海）且预览成功，5 分钟后进入第 8 天。
      harness.updateSignedAt(orderId, Date.UTC(2026, 10, 19, 2, 0, 0));
      harness.setNow(Date.UTC(2026, 10, 25, 15, 55, 0));
      const confirmationId = await previewConfirmation(harness, cookie, orderId);

      harness.advance(5 * 60 * 1000);
      const response = await harness.confirm({ confirmationId }, { cookie });

      expect(response.json()).toMatchObject({
        status: 'exchange_application',
        outcome: 'ineligible',
        reason: 'overdue'
      });
      expect(response.json().sources.map((source: { id: string }) => source.id)).toEqual([
        'faq-exchange-window'
      ]);
      expect(harness.readAll('SELECT * FROM exchange_applications')).toEqual([]);
    });
  });

  it('跨来源确认被拒绝且不消耗摘要', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      const confirmationId = await previewConfirmation(harness, cookie, orderId);

      const rejected = await harness.confirm(
        { confirmationId },
        { cookie, origin: 'https://evil.example' }
      );
      expect(rejected.statusCode).toBe(403);
      expect(harness.readAll('SELECT * FROM exchange_applications')).toEqual([]);

      const accepted = await harness.confirm({ confirmationId }, { cookie });
      expect(accepted.json()).toMatchObject({ outcome: 'submitted' });
    });
  });

  it('没有会话或使用其他访客的摘要都无法创建申请', async () => {
    await withHarness(async (harness) => {
      const visitorA = await harness.claim();
      const visitorB = await harness.claim();
      const confirmationId = await previewConfirmation(
        harness,
        visitorA.cookie,
        visitorA.orderId
      );

      const anonymous = await harness.confirm({ confirmationId });
      expect(anonymous.json()).toMatchObject({
        status: 'exchange_application',
        outcome: 'session_required',
        message: '请先领取示例订单，再申请换货。'
      });

      const foreign = await harness.confirm(
        { confirmationId },
        { cookie: visitorB.cookie }
      );
      expect(foreign.json()).toMatchObject({
        status: 'exchange_application',
        outcome: 'invalid_confirmation'
      });
      expect(harness.readAll('SELECT * FROM exchange_applications')).toEqual([]);

      // 原访客的摘要未被消耗，仍可正常提交。
      const owner = await harness.confirm({ confirmationId }, { cookie: visitorA.cookie });
      expect(owner.json()).toMatchObject({ outcome: 'submitted' });
    });
  });

  it('其他访客不能凭已提交的确认标识读取他人回执', async () => {
    await withHarness(async (harness) => {
      const visitorA = await harness.claim();
      const visitorB = await harness.claim();
      const confirmationId = await previewConfirmation(
        harness,
        visitorA.cookie,
        visitorA.orderId
      );
      const submitted = await harness.confirm({ confirmationId }, { cookie: visitorA.cookie });
      expect(submitted.json()).toMatchObject({ outcome: 'submitted' });
      const applicationId = submitted.json().application.applicationId as string;

      // 幂等命中已提交的确认时仍要校验归属，不能把 A 的回执返回给 B。
      const foreign = await harness.confirm({ confirmationId }, { cookie: visitorB.cookie });
      expect(foreign.json()).toEqual({
        status: 'exchange_application',
        outcome: 'invalid_confirmation',
        message: '确认信息已失效，请重新核对换货信息。'
      });
      expect(foreign.json()).not.toHaveProperty('application');
      expect(JSON.stringify(foreign.json())).not.toContain(applicationId);

      const rows = harness.readAll<{ application_id: string }>(
        'SELECT application_id FROM exchange_applications'
      );
      expect(rows).toEqual([{ application_id: applicationId }]);
    });
  });

  it('无效确认标识与非法请求体得到稳定结果', async () => {
    await withHarness(async (harness) => {
      const { cookie } = await harness.claim();

      const unknown = await harness.confirm(
        { confirmationId: 'unknown-confirmation-id-1234' },
        { cookie }
      );
      expect(unknown.json()).toMatchObject({
        status: 'exchange_application',
        outcome: 'invalid_confirmation'
      });

      const invalid = await harness.confirm({}, { cookie });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({ status: 'invalid_request' });
    });
  });

  it('同一订单已有申请时再次预览直接返回原回执', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();
      const confirmationId = await previewConfirmation(harness, cookie, orderId);
      const submitted = await harness.confirm({ confirmationId }, { cookie });

      const preview = await harness.preview(
        { orderId, reason: 'other', declaration: ALL_DECLARED },
        { cookie }
      );
      expect(preview.json()).toEqual({
        status: 'exchange_preview',
        outcome: 'already_submitted',
        application: submitted.json().application
      });
    });
  });
});

describe('查单结果恢复换货回执', () => {
  it('提交申请后查单返回申请编号与状态，提交前没有回执', async () => {
    await withHarness(async (harness) => {
      const { cookie, orderId } = await harness.claim();

      const before = await harness.ask(`查订单 ${orderId}`, { cookie });
      expect(before.json()).toEqual({
        status: 'order_query',
        outcome: 'found',
        order: { orderId, productName: SEED_PRODUCT, status: '已签收' }
      });

      const preview = await harness.preview(
        { orderId, reason: 'quality', declaration: ALL_DECLARED },
        { cookie }
      );
      const submitted = await harness.confirm(
        { confirmationId: preview.json().confirmationId },
        { cookie }
      );

      const after = await harness.ask(`查订单 ${orderId}`, { cookie });
      expect(after.json()).toEqual({
        status: 'order_query',
        outcome: 'found',
        order: { orderId, productName: SEED_PRODUCT, status: '已签收' },
        exchange: submitted.json().application
      });
    });
  });

  it('其他访客查单看不到该申请，也无法查询其他订单', async () => {
    await withHarness(async (harness) => {
      const visitorA = await harness.claim();
      const visitorB = await harness.claim();

      const preview = await harness.preview(
        { orderId: visitorA.orderId, reason: 'quality', declaration: ALL_DECLARED },
        { cookie: visitorA.cookie }
      );
      await harness.confirm({ confirmationId: preview.json().confirmationId }, {
        cookie: visitorA.cookie
      });

      const own = await harness.ask(`查订单 ${visitorB.orderId}`, {
        cookie: visitorB.cookie
      });
      expect(own.json()).toMatchObject({ outcome: 'found' });
      expect(own.json()).not.toHaveProperty('exchange');

      const foreign = await harness.ask(`查订单 ${visitorA.orderId}`, {
        cookie: visitorB.cookie
      });
      expect(foreign.json()).toEqual({
        status: 'order_query',
        outcome: 'not_found',
        message: '未找到可查询的订单。'
      });
      expect(foreign.json()).not.toHaveProperty('exchange');
    });
  });
});

describe('升级前已有的演示订单', () => {
  it('迁移补齐签收时间后，原会话仍可进入换货预览', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shopcare-legacy-'));
    const databasePath = join(directory, 'shopcare.sqlite');
    const visitorId = 'visitor_legacy';
    const orderId = 'SC-LEGACY000001';
    const token = 'legacy-demo-token';
    const createdAt = NOW - 2 * DAY_MS;

    try {
      // 复刻迁移版本 1 的结构与数据：订单表还没有签收时间列。
      const legacy = new DatabaseSync(databasePath);
      legacy.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
        CREATE TABLE demo_orders (
          order_id TEXT PRIMARY KEY,
          visitor_id TEXT NOT NULL UNIQUE,
          product_name TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE demo_sessions (
          token_hash TEXT PRIMARY KEY,
          visitor_id TEXT NOT NULL,
          order_id TEXT NOT NULL REFERENCES demo_orders(order_id) ON DELETE CASCADE,
          pending_order_query INTEGER NOT NULL DEFAULT 0 CHECK (pending_order_query IN (0, 1)),
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX idx_demo_sessions_expires_at ON demo_sessions(expires_at);
      `);
      legacy
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)')
        .run(new Date(NOW).toISOString());
      legacy
        .prepare(
          'INSERT INTO demo_orders (order_id, visitor_id, product_name, status, created_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(orderId, visitorId, SEED_PRODUCT, '已签收', createdAt);
      legacy
        .prepare(
          `INSERT INTO demo_sessions
             (token_hash, visitor_id, order_id, pending_order_query, expires_at, created_at)
           VALUES (?, ?, ?, 0, ?, ?)`
        )
        .run(hashSessionToken(token), visitorId, orderId, NOW + DAY_MS, createdAt);
      legacy.close();

      const app = buildApp({
        config: { chatMode: 'preset', databasePath },
        now: () => NOW
      });
      try {
        const [order] = readAll<{ signed_at: number | null }>(
          databasePath,
          'SELECT signed_at FROM demo_orders WHERE order_id = ?',
          orderId
        );
        expect(order?.signed_at).toBe(createdAt);

        const response = await app.inject({
          method: 'POST',
          url: '/api/exchange/preview',
          headers: {
            host: HOST,
            origin: ORIGIN,
            cookie: `${DEMO_SESSION_COOKIE}=${token}`
          },
          payload: { orderId, reason: 'quality', declaration: ALL_DECLARED }
        });
        expect(response.json()).toMatchObject({
          status: 'exchange_preview',
          outcome: 'eligible',
          summary: { orderId }
        });
      } finally {
        await app.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
