import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app';
import type { ChatResponse } from '../src/shared/chat';

const HOST = 'shopcare.test';
const ORIGIN = `http://${HOST}`;

async function ask(question: string) {
  const app = buildApp({ config: { chatMode: 'preset' } });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { host: HOST, origin: ORIGIN },
      payload: { question }
    });
    expect(response.statusCode).toBe(200);
    return response.json<ChatResponse>();
  } finally {
    await app.close();
  }
}

/**
 * 验收回归：跑题判定要看顾客实际在问什么，不能只看天气词面。
 * 同一组「下雨」措辞，纯天气问题拦截，带天气背景的售后问题放行。
 */
describe('输入护栏：天气词面与实际意图的对照', () => {
  it('纯天气问题按 off_topic 拦截', async () => {
    expect(await ask('今天会下雨吗？')).toMatchObject({
      status: 'blocked',
      reason: 'off_topic'
    });
  });

  it.each([
    '快递因为下雨延误了，我签收后还有几天可以换货？',
    '商品下雨淋湿了，能申请换货吗？',
    '下雨天收到的，外包装湿了可以换货吗？',
    '因为下雪快递耽搁了，签收后多久内还能申请换货？'
  ])('带天气/物流背景的售后问题「%s」放行，不返回 blocked', async (question) => {
    const body = await ask(question);
    expect(body.status).not.toBe('blocked');
  });
});
