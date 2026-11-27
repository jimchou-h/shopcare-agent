import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/server/app';
import {
  DeepSeekError,
  type DeepSeekGeneration,
  type DeepSeekGenerator,
  type EvidenceCandidate
} from '../src/server/deepseek/client';
import { FAQ_CORPUS } from '../src/server/faq/corpus';
import type { ChatErrorResponse, ChatResponse } from '../src/shared/chat';

function requireEntry(id: string) {
  const entry = FAQ_CORPUS.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`测试语料缺少 ${id} 条目`);
  }
  return entry;
}

const windowEntry = requireEntry('faq-exchange-window');
const conditionEntry = requireEntry('faq-exchange-condition');
const shippingEntry = requireEntry('faq-exchange-shipping');

const config = { chatMode: 'deepseek' as const, deepseekApiKey: 'sk-server-test' };

async function askWith(
  question: string,
  generate: DeepSeekGenerator
): Promise<{ statusCode: number; body: ChatResponse | ChatErrorResponse }> {
  const app = buildApp({ config, generate });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { question }
    });
    return { statusCode: response.statusCode, body: response.json() };
  } finally {
    await app.close();
  }
}

function generatorReturning(generation: DeepSeekGeneration | Error) {
  return {
    generate: vi.fn(
      async (_input: { question: string; candidates: readonly EvidenceCandidate[] }) => {
        if (generation instanceof Error) {
          throw generation;
        }
        return generation;
      }
    )
  };
}

function generatedWindow(overrides: Record<string, unknown> = {}) {
  return {
    status: 'answered' as const,
    faqId: windowEntry.id,
    evidenceQuote: '顾客自签收商品之日起 7 天内',
    answer: '根据政策，签收后 7 天内可以申请换货。',
    ...overrides
  };
}

describe('POST /api/chat 真实模式：生成带出处的正文', () => {
  it('唯一命中时把单条证据交给模型并展示生成正文', async () => {
    const generate = generatorReturning(generatedWindow());
    const { statusCode, body } = await askWith('换货期限是多久？', generate);

    expect(statusCode).toBe(200);
    expect(body).toMatchObject({
      status: 'answered',
      mode: 'generated',
      answer: '根据政策，签收后 7 天内可以申请换货。',
      source: { id: windowEntry.id }
    });
    expect(generate.generate).toHaveBeenCalledTimes(1);

    const input = generate.generate.mock.calls[0]?.[0] as {
      question: string;
      candidates: readonly EvidenceCandidate[];
    };
    expect(input.question).toBe('换货期限是多久？');
    expect(input.candidates.map((candidate) => candidate.faqId)).toEqual([windowEntry.id]);
    expect(JSON.stringify(input)).not.toContain('sk-server-test');
  });

  it('未命中但主题明确时只在换货候选内生成', async () => {
    const generate = generatorReturning(generatedWindow());
    const { body } = await askWith('换货最晚什么时候能办？', generate);

    expect(body).toMatchObject({ status: 'answered', mode: 'generated' });
    const input = generate.generate.mock.calls[0]?.[0] as {
      candidates: readonly EvidenceCandidate[];
    };
    expect(input.candidates.map((candidate) => candidate.faqId)).toEqual(
      FAQ_CORPUS.filter((entry) => entry.topic === '换货').map((entry) => entry.id)
    );
  });

  it.each(['我不能换货吗？', '不是不能换货吧？'])(
    '否定疑问句「%s」进入换货候选并选择条件条目',
    async (question) => {
      const generate = generatorReturning({
        status: 'answered',
        faqId: conditionEntry.id,
        evidenceQuote: '申请换货的商品应保持完好，配件、赠品及原包装齐全',
        answer: '换货商品需要保持完好，配件、赠品和原包装齐全。'
      });
      const { body } = await askWith(question, generate);

      expect(body).toMatchObject({
        status: 'answered',
        mode: 'generated',
        source: { id: conditionEntry.id }
      });
      expect(generate.generate).toHaveBeenCalledTimes(1);
    }
  );
});

describe('POST /api/chat 真实模式：证据不足与歧义', () => {
  it.each(['我不想换货，会员积分兑换需要什么条件？', '换货的期限和条件是什么？'])(
    '「%s」直接澄清且不调用模型',
    async (question) => {
      const generate = generatorReturning(generatedWindow());
      const { statusCode, body } = await askWith(question, generate);

      expect(statusCode).toBe(200);
      expect(body.status).toBe('insufficient_evidence');
      expect(generate.generate).not.toHaveBeenCalled();
    }
  );

  it('模型拒配且无唯一依据时提示补充信息', async () => {
    const generate = generatorReturning({ status: 'insufficient_evidence' });
    const { statusCode, body } = await askWith('换货最晚什么时候能办？', generate);

    expect(statusCode).toBe(200);
    expect(body.status).toBe('insufficient_evidence');
    expect(body).not.toHaveProperty('source');
  });
});

describe('POST /api/chat 真实模式：生成结果校验', () => {
  it.each([
    {
      label: '越界候选',
      generation: generatedWindow({ faqId: 'faq-return-window' })
    },
    {
      label: '引文不属于该条目',
      generation: generatedWindow({ evidenceQuote: '这段原文并不存在' })
    },
    {
      label: '错误期限',
      generation: generatedWindow({ answer: '签收后 14 天内可以申请换货。' })
    }
  ])('$label 时降级为同一政策的预置答复', async ({ generation }) => {
    const generate = generatorReturning(generation as DeepSeekGeneration);
    const { statusCode, body } = await askWith('换货期限是多久？', generate);

    expect(statusCode).toBe(200);
    expect(body).toMatchObject({
      status: 'answered',
      mode: 'fallback',
      answer: windowEntry.answer,
      source: { id: windowEntry.id }
    });
  });

  it('费用承担与摘录一致时保留生成正文', async () => {
    const generate = generatorReturning({
      status: 'answered',
      faqId: shippingEntry.id,
      evidenceQuote: '非质量原因发起的换货，寄回运费由顾客承担',
      answer: '质量问题换货由商家承担运费；非质量原因换货由顾客承担寄回运费。'
    });
    const { body } = await askWith('换货的运费谁出？', generate);

    expect(body).toMatchObject({
      status: 'answered',
      mode: 'generated',
      source: { id: shippingEntry.id }
    });
  });

  it('费用承担与摘录冲突时降级', async () => {
    const generate = generatorReturning({
      status: 'answered',
      faqId: shippingEntry.id,
      evidenceQuote: '非质量原因发起的换货，寄回运费由顾客承担',
      answer: '非质量原因的换货由商家承担运费。'
    });
    const { body } = await askWith('换货的运费谁出？', generate);

    expect(body).toMatchObject({
      status: 'answered',
      mode: 'fallback',
      source: { id: shippingEntry.id }
    });
  });

  it('主题候选内越界时澄清而不是套用无关政策', async () => {
    const generate = generatorReturning(generatedWindow({ faqId: 'faq-return-window' }));
    const { statusCode, body } = await askWith('换货最晚什么时候能办？', generate);

    expect(statusCode).toBe(200);
    expect(body.status).toBe('insufficient_evidence');
    expect(body).not.toHaveProperty('source');
  });
});

describe('POST /api/chat 真实模式：配置边界', () => {
  it('缺少部署 Key 时拒绝装配应用', () => {
    expect(() => buildApp({ config: { chatMode: 'deepseek' } })).toThrowError(/DEEPSEEK_API_KEY/);
  });
});

describe('POST /api/chat 真实模式：上游失败恢复', () => {
  it.each([
    { reason: 'auth' as const },
    { reason: 'quota' as const },
    { reason: 'timeout' as const },
    { reason: 'invalid_response' as const }
  ])('$reason 且存在唯一依据时降级为预置答复', async ({ reason }) => {
    const generate = generatorReturning(new DeepSeekError(reason));
    const { body } = await askWith('换货期限是多久？', generate);

    expect(body).toMatchObject({
      status: 'answered',
      mode: 'fallback',
      answer: windowEntry.answer,
      source: { id: windowEntry.id }
    });
  });

  it('无法降级时返回受控的可重试错误', async () => {
    const generate = generatorReturning(new DeepSeekError('quota'));
    const { statusCode, body } = await askWith('换货最晚什么时候能办？', generate);

    expect(statusCode).toBe(502);
    expect(body).toEqual({
      status: 'upstream_error',
      message: '生成服务暂时不可用，请稍后重试。'
    });
    expect(JSON.stringify(body)).not.toContain('sk-server-test');
  });
});
