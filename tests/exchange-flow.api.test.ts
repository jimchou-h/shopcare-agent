import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './support/temp';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app';
import type { DemoSessionResponse } from '../src/shared/orders';

const HOST = 'shopcare.test';
const ORIGIN = `http://${HOST}`;
const NOW = Date.UTC(2026, 10, 26, 10, 0, 0);

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

function ask(app: ReturnType<typeof buildApp>, question: string, cookie?: string) {
  return post(app, '/api/chat', { question }, cookie);
}

async function claim(app: ReturnType<typeof buildApp>) {
  const response = await post(app, '/api/demo/session', {});
  expect(response.statusCode).toBe(200);
  return {
    cookie: readCookie(response.headers),
    orderId: response.json<DemoSessionResponse>().order.orderId
  };
}

/** 启动办理并选择原因，停在等待商品申报。 */
async function startAndChooseReason(
  app: ReturnType<typeof buildApp>,
  cookie: string
) {
  expect((await ask(app, '我想换货', cookie)).json()).toMatchObject({ outcome: 'step' });
  expect((await ask(app, '质量问题', cookie)).json()).toMatchObject({
    outcome: 'step',
    step: 'declaration'
  });
}

describe('对话内换货进度持久化', () => {
  it('保留数据卷重建后继续原步骤，其他访客无法恢复', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shopcare-flow-db-'));
    const databasePath = join(directory, 'shopcare.sqlite');

    try {
      const first = buildApp({ config: { chatMode: 'preset', databasePath }, now: () => NOW });
      let cookie = '';
      let orderId = '';
      try {
        const claimed = await claim(first);
        cookie = claimed.cookie;
        orderId = claimed.orderId;
        await startAndChooseReason(first, cookie);
      } finally {
        await first.close();
      }

      // 使用同一数据文件重建应用，等价于容器保留数据卷重建。
      const rebuilt = buildApp({ config: { chatMode: 'preset', databasePath }, now: () => NOW });
      try {
        const resumed = await ask(rebuilt, '继续换货', cookie);
        expect(resumed.json()).toMatchObject({
          status: 'exchange_flow',
          outcome: 'step',
          step: 'declaration',
          orderId,
          reason: 'quality'
        });
        expect(resumed.json().message).toContain('质量问题');

        const summary = await ask(rebuilt, '齐全', cookie);
        expect(summary.json()).toMatchObject({
          outcome: 'summary',
          summary: { orderId, reason: 'quality', reasonLabel: '质量问题' }
        });

        // 独立浏览器会话有自己的订单，无法恢复原访客的办理进度。
        const stranger = await claim(rebuilt);
        const strangerResume = await ask(rebuilt, '继续换货', stranger.cookie);
        expect(strangerResume.json()).toMatchObject({
          status: 'exchange_flow',
          outcome: 'notice'
        });
        expect(strangerResume.json().message).toContain('没有');
        expect(strangerResume.json()).not.toHaveProperty('summary');
      } finally {
        await rebuilt.close();
      }
    } finally {
      removeTempDir(directory);
    }
  });

  it('刷新后在同一会话继续发送消息即可恢复办理', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shopcare-flow-refresh-'));
    const databasePath = join(directory, 'shopcare.sqlite');

    try {
      const first = buildApp({ config: { chatMode: 'preset', databasePath }, now: () => NOW });
      let cookie = '';
      let orderId = '';
      try {
        const claimed = await claim(first);
        cookie = claimed.cookie;
        orderId = claimed.orderId;
        await startAndChooseReason(first, cookie);
      } finally {
        await first.close();
      }

      // 模拟刷新：同一会话进入新的页面/服务实例，直接继续发消息而不是先恢复步骤。
      const refreshed = buildApp({
        config: { chatMode: 'preset', databasePath },
        now: () => NOW
      });
      try {
        const faq = await ask(refreshed, '换货期限是多久？', cookie);
        expect(faq.json()).toMatchObject({
          status: 'answered',
          source: { id: 'faq-exchange-window' }
        });

        const summary = await ask(refreshed, '齐全', cookie);
        expect(summary.json()).toMatchObject({
          status: 'exchange_flow',
          outcome: 'summary',
          summary: { orderId, reason: 'quality', reasonLabel: '质量问题' }
        });
      } finally {
        await refreshed.close();
      }
    } finally {
      removeTempDir(directory);
    }
  });

  it('取消后旧摘要无法提交，已提交申请的回执仍可恢复', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shopcare-flow-cancel-'));
    const databasePath = join(directory, 'shopcare.sqlite');

    try {
      const app = buildApp({ config: { chatMode: 'preset', databasePath }, now: () => NOW });
      try {
        const { cookie, orderId } = await claim(app);
        await startAndChooseReason(app, cookie);

        const summary = await ask(app, '齐全', cookie);
        const confirmationId = summary.json().confirmationId as string;
        expect(summary.json()).toMatchObject({ outcome: 'summary' });

        const cancelled = await ask(app, '取消换货', cookie);
        expect(cancelled.json()).toMatchObject({
          status: 'exchange_flow',
          outcome: 'cancelled'
        });

        // 已撤销的摘要不能创建申请。
        const stale = await post(app, '/api/exchange/confirm', { confirmationId }, cookie);
        expect(stale.json()).toMatchObject({
          status: 'exchange_application',
          outcome: 'superseded'
        });

        // 重新办理并提交后，查单仍能恢复回执，且「继续换货」直接给出原申请。
        await startAndChooseReason(app, cookie);
        const second = await ask(app, '齐全', cookie);
        const submitted = await post(
          app,
          '/api/exchange/confirm',
          { confirmationId: second.json().confirmationId },
          cookie
        );
        expect(submitted.json()).toMatchObject({ outcome: 'submitted' });
        const applicationId = submitted.json().application.applicationId as string;

        const queried = await ask(app, `查订单 ${orderId}`, cookie);
        expect(queried.json()).toMatchObject({
          outcome: 'found',
          exchange: { applicationId, status: 'submitted' }
        });

        const resume = await ask(app, '继续换货', cookie);
        expect(resume.json()).toMatchObject({
          outcome: 'already_submitted',
          application: { applicationId, status: 'submitted' }
        });
      } finally {
        await app.close();
      }
    } finally {
      removeTempDir(directory);
    }
  });

  it('没有进行中的办理时取消只给出提示', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'shopcare-flow-none-'));
    const databasePath = join(directory, 'shopcare.sqlite');

    try {
      const app = buildApp({ config: { chatMode: 'preset', databasePath }, now: () => NOW });
      try {
        const { cookie } = await claim(app);
        const response = await ask(app, '取消换货', cookie);
        expect(response.json()).toMatchObject({
          status: 'exchange_flow',
          outcome: 'notice'
        });
      } finally {
        await app.close();
      }
    } finally {
      removeTempDir(directory);
    }
  });
});
