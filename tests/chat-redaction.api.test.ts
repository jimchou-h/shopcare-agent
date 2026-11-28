import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/server/app';
import {
  DeepSeekError,
  type DeepSeekGeneration,
  type DeepSeekGenerator,
  type EvidenceCandidate
} from '../src/server/deepseek/client';
import { REDACTION_SAMPLES } from '../src/server/guardrails/redaction-samples';
import { redactPii } from '../src/server/guardrails/redact';
import { FAQ_CORPUS } from '../src/server/faq/corpus';
import type { ChatResponse } from '../src/shared/chat';

const config = { chatMode: 'deepseek' as const, deepseekApiKey: 'sk-server-test' };
const HOST = 'shopcare.test';
const ORIGIN = `http://${HOST}`;

function requireEntry(id: string) {
  const entry = FAQ_CORPUS.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`测试语料缺少 ${id} 条目`);
  }
  return entry;
}

const windowEntry = requireEntry('faq-exchange-window');

function generatorReturning(result: DeepSeekGeneration | Error) {
  const generate = vi.fn(
    async (_input: { question: string; candidates: readonly EvidenceCandidate[] }): Promise<DeepSeekGeneration> => {
      if (result instanceof Error) {
        throw result;
      }
      return result;
    }
  );
  return { generate };
}

async function askWith(question: string, generate: DeepSeekGenerator) {
  const app = buildApp({ config, generate });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { host: HOST, origin: ORIGIN },
      payload: { question }
    });
    return { statusCode: response.statusCode, body: response.json<ChatResponse>() };
  } finally {
    await app.close();
  }
}

function generatedWindow(answer: string) {
  return {
    status: 'answered' as const,
    faqId: windowEntry.id,
    evidenceQuote: '顾客自签收商品之日起 7 天内',
    answer
  };
}

describe('redactPii 标注样本', () => {
  it.each(REDACTION_SAMPLES)('$id：$original → $expected', ({ original, expected }) => {
    expect(redactPii(original)).toBe(expected);
  });

  it('手机号保留前 3 后 4，身份证保留前 6 后 4，邮箱保留首字符', () => {
    expect(redactPii('13812345678')).toBe('138****5678');
    expect(redactPii('110101199001011234')).toBe('110101********1234');
    expect(redactPii('alice@example.com')).toBe('a***@example.com');
  });
});

describe('POST /api/chat 真实模式：模型请求脱敏', () => {
  it('模型替身收到的 question 中三类个人信息均被遮盖', async () => {
    const generate = generatorReturning(generatedWindow('根据政策，签收后 7 天内可换货。'));
    const question = '换货期限是多久？联系 13812345678、110101199001011234 或 alice@example.com';
    const { statusCode } = await askWith(question, generate);

    expect(statusCode).toBe(200);
    expect(generate.generate).toHaveBeenCalledTimes(1);
    const input = generate.generate.mock.calls[0]?.[0] as { question: string };
    expect(input.question).toContain('138****5678');
    expect(input.question).toContain('110101********1234');
    expect(input.question).toContain('a***@example.com');
    expect(input.question).not.toContain('13812345678');
    expect(input.question).not.toContain('110101199001011234');
    expect(input.question).not.toContain('alice@example.com');
  });
});

describe('POST /api/chat 真实模式：回复脱敏并保留出处', () => {
  it('正文中的手机号被遮盖，同一条政策出处保留，响应不含原始信息', async () => {
    const generate = generatorReturning(
      generatedWindow('签收后 7 天内可换货，客服电话 13812345678。')
    );
    const { body } = await askWith('换货期限是多久？', generate);

    expect(body).toMatchObject({
      status: 'answered',
      mode: 'generated',
      answer: '签收后 7 天内可换货，客服电话 138****5678。',
      source: { id: windowEntry.id }
    });
    expect(JSON.stringify(body)).not.toContain('13812345678');
  });

  it('一段正文含身份证与邮箱时逐类遮盖，普通业务数字与政策时限保留', async () => {
    const generate = generatorReturning(
      generatedWindow('订单 SC-AB12CD34EF56 签收后 7 天内可换货，联系 110101199001011234 或 alice@example.com。')
    );
    const { body } = await askWith('换货期限是多久？', generate);

    expect(body.status).toBe('answered');
    if (body.status !== 'answered') {
      return;
    }
    expect(body.answer).toContain('SC-AB12CD34EF56');
    expect(body.answer).toContain('7 天');
    expect(body.answer).toContain('110101********1234');
    expect(body.answer).toContain('a***@example.com');
    expect(body.answer).not.toContain('110101199001011234');
    expect(body.answer).not.toContain('alice@example.com');
  });

  it('生成结果校验失败时降级为预置答复，正文不含上游原始个人信息', async () => {
    const generate = generatorReturning(
      generatedWindow('错误的 14 天期限，请联系 13812345678。')
    );
    const { body } = await askWith('换货期限是多久？', generate);

    expect(body).toMatchObject({
      status: 'answered',
      mode: 'fallback',
      answer: windowEntry.answer,
      source: { id: windowEntry.id }
    });
    expect(JSON.stringify(body)).not.toContain('13812345678');
  });

  it('上游错误时返回受控失败提示，不含原始个人信息', async () => {
    const generate = generatorReturning(new DeepSeekError('quota'));
    const { statusCode, body } = await askWith('换货最晚什么时候能办？', generate);

    expect(statusCode).toBe(502);
    expect(JSON.stringify(body)).not.toContain('alice@example.com');
  });
});
