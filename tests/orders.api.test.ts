import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildApp, type BuildAppOptions } from '../src/server/app';
import type { DemoSessionResponse } from '../src/shared/orders';
import type { ChatResponse } from '../src/shared/chat';

const HOST = 'shopcare.test';
const SAME_ORIGIN = `http://${HOST}`;
const SEED_PRODUCT = '轻量通勤双肩包';

async function withApp(
  run: (app: FastifyInstance) => Promise<void>,
  options: BuildAppOptions = {}
): Promise<void> {
  const app = buildApp(options);
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

function readCookie(response: LightMyRequestResponse): string {
  const raw = response.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    throw new Error('响应没有设置演示会话 Cookie');
  }
  return value.split(';')[0] ?? '';
}

async function claim(
  app: FastifyInstance,
  headers: Record<string, string> = { host: HOST, origin: SAME_ORIGIN }
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/demo/session',
    headers
  });
  return response;
}

async function claimCookie(app: FastifyInstance): Promise<{ cookie: string; orderId: string }> {
  const response = await claim(app);
  expect(response.statusCode).toBe(200);
  const body = response.json<DemoSessionResponse>();
  expect(body.status).toBe('claimed');
  return { cookie: readCookie(response), orderId: body.order.orderId };
}

async function ask(
  app: FastifyInstance,
  question: string,
  headers: Record<string, string> = {}
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/chat',
    headers: { host: HOST, ...headers },
    payload: { question }
  });
  return response;
}

describe('POST /api/demo/session 领取示例订单', () => {
  it('无会话时建立会话并返回一笔已签收的合成订单', async () => {
    await withApp(async (app) => {
      const response = await claim(app);

      expect(response.statusCode).toBe(200);
      const body = response.json<DemoSessionResponse>();
      expect(body).toEqual({
        status: 'claimed',
        order: {
          orderId: expect.stringMatching(/^SC-[A-Z0-9]{12}$/),
          productName: SEED_PRODUCT,
          status: '已签收'
        }
      });

      const setCookie = String(response.headers['set-cookie']);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Path=/');
    });
  });

  it('同一有效会话重复领取返回同一单号', async () => {
    await withApp(async (app) => {
      const first = await claim(app);
      const firstCookie = readCookie(first);
      const firstOrderId = first.json<DemoSessionResponse>().order.orderId;

      const reused = await claim(app, {
        host: HOST,
        origin: SAME_ORIGIN,
        cookie: firstCookie
      });

      expect(reused.statusCode).toBe(200);
      expect(reused.json<DemoSessionResponse>().order.orderId).toBe(firstOrderId);

      // 另一浏览器上下文没有 Cookie，会得到一笔独立订单。
      const other = await claimCookie(app);
      expect(other.orderId).not.toBe(firstOrderId);
    });
  });

  it('拒绝外部来源的领取请求且不建立会话', async () => {
    await withApp(async (app) => {
      const response = await claim(app, {
        host: HOST,
        origin: 'https://evil.example'
      });

      expect(response.statusCode).toBe(403);
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });
});

describe('POST /api/chat 查询自己的示例订单', () => {
  it('持有效会话提交明确查单问法后返回单号、商品和已签收状态', async () => {
    await withApp(async (app) => {
      const { cookie, orderId } = await claimCookie(app);
      const response = await ask(app, `查订单 ${orderId}`, { cookie });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'order_query',
        outcome: 'found',
        order: {
          orderId,
          productName: SEED_PRODUCT,
          status: '已签收'
        }
      });
    });
  });

  it('单号大小写和首尾空白不影响查询', async () => {
    await withApp(async (app) => {
      const { cookie, orderId } = await claimCookie(app);
      const response = await ask(app, `  查订单   ${orderId.toLowerCase()}  `, { cookie });

      expect(response.json()).toMatchObject({
        status: 'order_query',
        outcome: 'found',
        order: { orderId }
      });
    });
  });

  it('无有效会话时引导领取，不返回订单详情', async () => {
    await withApp(async (app) => {
      const response = await ask(app, '查订单 SC-AB12CD34EF56');

      expect(response.statusCode).toBe(200);
      const body = response.json<ChatResponse>();
      expect(body).toEqual({
        status: 'order_query',
        outcome: 'session_required',
        message: '请先领取示例订单，再查询订单状态。'
      });
      expect(body).not.toHaveProperty('order');
    });
  });

  it('只提交「查订单」且无会话时同样引导领取', async () => {
    await withApp(async (app) => {
      const response = await ask(app, '查订单');

      expect(response.json()).toMatchObject({
        status: 'order_query',
        outcome: 'session_required'
      });
    });
  });

  it('查询其他访客的单号和不存在单号得到一致的响应', async () => {
    await withApp(async (app) => {
      const visitorA = await claimCookie(app);
      const visitorB = await claimCookie(app);

      const foreign = await ask(app, `查订单 ${visitorA.orderId}`, { cookie: visitorB.cookie });
      const missing = await ask(app, '查订单 SC-ZZZZZZZZZZZZ', { cookie: visitorB.cookie });

      expect(foreign.statusCode).toBe(200);
      expect(missing.statusCode).toBe(200);
      expect(foreign.json()).toEqual(missing.json());
      expect(foreign.json()).toMatchObject({
        status: 'order_query',
        outcome: 'not_found',
        message: '未找到可查询的订单。'
      });
      expect(foreign.json()).not.toHaveProperty('order');

      const own = await ask(app, `查订单 ${visitorB.orderId}`, { cookie: visitorB.cookie });
      expect(own.json()).toMatchObject({ outcome: 'found', order: { orderId: visitorB.orderId } });
    });
  });

  it('混有演示单号的政策提问提示分开提交', async () => {
    await withApp(async (app) => {
      const { cookie } = await claimCookie(app);
      const response = await ask(app, '你们换货期限多久，订单号 SC-AB12CD34EF56', { cookie });

      expect(response.json()).toEqual({
        status: 'order_query',
        outcome: 'ask_separately',
        message: '请把订单查询和售后政策问题分开提交。'
      });
    });
  });

  it('普通 FAQ 不受查单能力影响', async () => {
    await withApp(async (app) => {
      const { cookie } = await claimCookie(app);
      const response = await ask(app, '换货期限是多久？', { cookie });

      expect(response.json()).toMatchObject({
        status: 'answered',
        mode: 'preset',
        source: { id: 'faq-exchange-window' }
      });
    });
  });

  it('外部来源不能借已有会话查询订单', async () => {
    await withApp(async (app) => {
      const { cookie, orderId } = await claimCookie(app);
      const response = await ask(app, `查订单 ${orderId}`, {
        cookie,
        origin: 'https://evil.example'
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        status: 'forbidden',
        message: '请求来源不受信任。'
      });
    });
  });
});

describe('查单的模型边界', () => {
  it('启用 DeepSeek 时查单和混合提问都不调用模型', async () => {
    const generate = { generate: vi.fn() };
    await withApp(
      async (app) => {
        const { cookie, orderId } = await claimCookie(app);

        const orderResult = await ask(app, `查订单 ${orderId}`, { cookie });
        expect(orderResult.json()).toMatchObject({ status: 'order_query', outcome: 'found' });

        const mixed = await ask(app, '换货期限多久，订单号 SC-AB12CD34EF56', { cookie });
        expect(mixed.json()).toMatchObject({ status: 'order_query', outcome: 'ask_separately' });

        expect(generate.generate).not.toHaveBeenCalled();
      },
      { config: { chatMode: 'deepseek', deepseekApiKey: 'sk-test' }, generate }
    );
  });
});
