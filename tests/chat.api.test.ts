import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/server/app';
import { FAQ_CORPUS } from '../src/server/faq/corpus';
import type { ChatErrorResponse, ChatResponse } from '../src/shared/chat';

const exchangeWindowFaq = FAQ_CORPUS.find((entry) => entry.id === 'faq-exchange-window');
if (!exchangeWindowFaq) {
  throw new Error('测试语料缺少换货期限条目');
}

async function ask(question: string): Promise<ChatResponse> {
  const app = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: { question }
  });

  expect(response.statusCode).toBe(200);
  return response.json<ChatResponse>();
}

async function askAnswered(question: string) {
  const response = await ask(question);
  if (response.status !== 'answered') {
    throw new Error(`期望得到带出处的回答，实际状态为 ${response.status}`);
  }
  return response;
}

describe('POST /api/chat 换货期限问答', () => {
  it('默认实例只开放预置问答路径，浏览器参数无法开启模型', async () => {
    const app = buildApp();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const question = '换货期限是多久？';
    try {
      const result = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { question, mode: 'deepseek' }
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({
        status: 'answered',
        mode: 'preset',
        source: { id: 'faq-exchange-window' }
      });

      const retired = await app.inject({ method: 'POST', url: '/api/chat/context', payload: { question } });
      expect(retired.statusCode).toBe(404);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      await app.close();
    }
  });

  it('两种等价问法返回同一政策支持的结论、标题和摘录', async () => {
    const [firstQuestion, secondQuestion] = exchangeWindowFaq.questions;
    if (!firstQuestion || !secondQuestion) {
      throw new Error('换货期限条目缺少已覆盖问法');
    }

    const first = await askAnswered(firstQuestion);
    const second = await askAnswered(secondQuestion);

    expect(first.answer).toBe(exchangeWindowFaq.answer);
    expect(first.source.title).toBe(exchangeWindowFaq.title);
    expect(first.source.excerpt).toBe(exchangeWindowFaq.excerpt);

    expect(second.answer).toBe(first.answer);
    expect(second.source.id).toBe(first.source.id);
    expect(second.source.title).toBe(first.source.title);
    expect(second.source.excerpt).toBe(first.source.excerpt);
  });
});

describe('POST /api/chat 证据不足', () => {
  it('未覆盖的问法给出补充引导，不返回结论与出处', async () => {
    const response = await ask('会员积分怎么兑换？');

    expect(response.status).toBe('insufficient_evidence');
    if (response.status !== 'insufficient_evidence') {
      return;
    }

    expect(response.message).toContain('补充');
    expect(response).not.toHaveProperty('answer');
    expect(response).not.toHaveProperty('source');
  });

  it('证据无法唯一支持结论时引导缩小范围', async () => {
    const response = await ask('换货的期限和条件是什么？');

    expect(response.status).toBe('insufficient_evidence');
    if (response.status !== 'insufficient_evidence') {
      return;
    }

    expect(response.message).toContain('多条');
    expect(response).not.toHaveProperty('answer');
    expect(response).not.toHaveProperty('source');
  });

  it.each([
    '会员积分兑换需要什么条件？',
    '退货邮费谁承担？',
    '换货期限是多久，换货需要什么条件？',
    '我不想换货，会员积分兑换需要什么条件？'
  ])('「%s」不应套用无关政策', async (question) => {
    const response = await ask(question);

    expect(response.status).toBe('insufficient_evidence');
    expect(response).not.toHaveProperty('answer');
    expect(response).not.toHaveProperty('source');
  });
});

describe('POST /api/chat 输入校验', () => {
  it.each([
    { label: '空字符串', question: '' },
    { label: '纯空白', question: '   ' }
  ])('拒绝$label问题', async ({ question }) => {
    const response = await buildApp().inject({
      method: 'POST',
      url: '/api/chat',
      payload: { question }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ChatErrorResponse>()).toEqual({
      status: 'invalid_request',
      message: '请输入售后问题。'
    });
  });

  it('缺少 question 字段时拒绝', async () => {
    const response = await buildApp().inject({
      method: 'POST',
      url: '/api/chat',
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ChatErrorResponse>().status).toBe('invalid_request');
  });

  it('去掉首尾空白后正常回答', async () => {
    const response = await ask('  换货期限是多久？  ');

    expect(response.status).toBe('answered');
  });
});
