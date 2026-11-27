import { describe, expect, it, vi } from 'vitest';
import { FAQ_CORPUS } from '../src/server/faq/corpus';
import {
  DEEPSEEK_ENDPOINT,
  DeepSeekError,
  createDeepSeekClient,
  type EvidenceCandidate
} from '../src/server/deepseek/client';

const windowEntry = FAQ_CORPUS.find((entry) => entry.id === 'faq-exchange-window');
if (!windowEntry) {
  throw new Error('测试语料缺少换货期限条目');
}

const candidate: EvidenceCandidate = {
  faqId: windowEntry.id,
  title: windowEntry.title,
  questionExamples: windowEntry.questions,
  excerpt: windowEntry.excerpt
};

const validGeneration = {
  status: 'answered' as const,
  faqId: windowEntry.id,
  evidenceQuote: '顾客自签收商品之日起 7 天内',
  answer: '签收后 7 天内可以申请换货。'
};

function completion(content: unknown) {
  return {
    choices: [
      {
        message: {
          content: typeof content === 'string' ? content : JSON.stringify(content)
        }
      }
    ]
  };
}

function providerResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

function createClient(
  fetchImpl: typeof fetch,
  timeoutMs = 50
) {
  return createDeepSeekClient({
    apiKey: 'sk-server-secret',
    fetchImpl,
    timeoutMs
  });
}

describe('DeepSeek 客户端请求边界', () => {
  it('Key 只进入官方鉴权头，请求体只包含有限证据', async () => {
    const fetchMock = vi.fn(async () => providerResponse(completion(validGeneration)));
    const client = createClient(fetchMock as unknown as typeof fetch);

    const result = await client.generate({ question: '换货期限是多久？', candidates: [candidate] });

    expect(result).toEqual(validGeneration);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DEEPSEEK_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer sk-server-secret'
    );

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('deepseek-chat');
    expect(body.stream).toBe(false);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.max_tokens).toBeGreaterThanOrEqual(256);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(JSON.stringify(body)).not.toContain('sk-server-secret');
    expect(JSON.stringify(body.messages)).toContain(windowEntry.excerpt);
    expect(JSON.stringify(body.messages)).toContain('换货期限是多久？');
  });

  it.each([
    { status: 401, reason: 'auth' },
    { status: 403, reason: 'auth' },
    { status: 402, reason: 'quota' },
    { status: 429, reason: 'quota' },
    { status: 500, reason: 'unavailable' }
  ])('HTTP $status 归类为 $reason', async ({ status, reason }) => {
    const client = createClient(
      vi.fn(async () => providerResponse({}, status)) as unknown as typeof fetch
    );

    await expect(client.generate({ question: '换货期限是多久？', candidates: [candidate] }))
      .rejects.toMatchObject({ reason });
  });

  it.each([
    { label: 'choices 为空', body: { choices: [] } },
    { label: 'content 不是 JSON', body: completion('not json') },
    { label: '决策结构不完整', body: completion({ status: 'answered', answer: '缺少引用' }) }
  ])('$label 时归类为结构异常', async ({ body }) => {
    const client = createClient(
      vi.fn(async () => providerResponse(body)) as unknown as typeof fetch
    );

    await expect(
      client.generate({ question: '换货期限是多久？', candidates: [candidate] })
    ).rejects.toMatchObject({ reason: 'invalid_response' });
  });

  it('请求超时会中止上游调用', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        })
    );
    const client = createClient(fetchImpl as unknown as typeof fetch, 20);

    await expect(
      client.generate({ question: '换货期限是多久？', candidates: [candidate] })
    ).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('读取响应体也计入超时', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          resolve({
            ok: true,
            status: 200,
            json: () =>
              new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                  reject(new DOMException('Aborted', 'AbortError'));
                });
              })
          } as Response);
        })
    );
    const client = createClient(fetchImpl as unknown as typeof fetch, 20);

    await expect(
      client.generate({ question: '换货期限是多久？', candidates: [candidate] })
    ).rejects.toMatchObject({ reason: 'timeout' });
  });
});

describe('DeepSeekError', () => {
  it('错误信息只包含稳定原因', () => {
    const error = new DeepSeekError('auth');
    expect(error.message).not.toContain('sk-server-secret');
    expect(error.reason).toBe('auth');
  });
});
