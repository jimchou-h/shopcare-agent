import { z } from 'zod';

/** DeepSeek 官方 Chat Completions 端点；部署 Key 只会出现在这里的鉴权头。 */
export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 15_000;

/** 传给模型的有限政策证据，只包含公开描述和原文摘录。 */
export interface EvidenceCandidate {
  faqId: string;
  title: string;
  questionExamples: string[];
  excerpt: string;
}

export type DeepSeekGeneration =
  | {
      status: 'answered';
      faqId: string;
      evidenceQuote: string;
      answer: string;
    }
  | { status: 'insufficient_evidence' };

/** 模型只能返回这两种结构，正文和引用仍需服务端进一步校验。 */
export const deepseekGenerationSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('answered'),
      faqId: z.string().min(1),
      evidenceQuote: z.string().min(1),
      answer: z.string().min(1)
    })
    .strict(),
  z.object({ status: z.literal('insufficient_evidence') }).strict()
]);

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string()
        })
      })
    )
    .min(1)
});

export type DeepSeekFailureReason =
  | 'auth'
  | 'quota'
  | 'timeout'
  | 'unavailable'
  | 'invalid_response';

/** 把上游差异收敛成稳定原因，路由和降级逻辑不再解析提供商原文。 */
export class DeepSeekError extends Error {
  constructor(readonly reason: DeepSeekFailureReason) {
    super(`DeepSeek 请求失败：${reason}`);
    this.name = 'DeepSeekError';
  }
}

export interface DeepSeekGenerator {
  generate(input: {
    question: string;
    candidates: readonly EvidenceCandidate[];
  }): Promise<DeepSeekGeneration>;
}

export interface DeepSeekClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
  model?: string;
}

const SYSTEM_PROMPT = [
  '你是售后政策助手。只依据本轮候选证据回答顾客问题。',
  '必须只输出 JSON，不能输出解释、Markdown 或其他文字。',
  '命中候选时输出：{"status":"answered","faqId":"候选的 faqId","evidenceQuote":"从该候选 excerpt 中逐字摘录的连续原文","answer":"用简体中文复述的政策结论"}。',
  '没有候选能支持问题时输出：{"status":"insufficient_evidence"}。',
  '不得编造候选以外的政策、期限、起算点、费用承担或商品条件；数字和承担方必须与 excerpt 一致。'
].join('');

/** 只把公开候选描述发给模型，不发送内部关键词、访客凭证或持久化数据。 */
function buildUserPrompt(
  question: string,
  candidates: readonly EvidenceCandidate[]
): string {
  return JSON.stringify({
    question,
    candidates: candidates.map((candidate) => ({
      faqId: candidate.faqId,
      title: candidate.title,
      questionExamples: candidate.questionExamples,
      excerpt: candidate.excerpt
    }))
  });
}

/**
 * 创建服务端 DeepSeek 客户端。
 *
 * 超时覆盖请求与响应体读取；网络错误、HTTP 状态和结构问题都转换为稳定原因。
 * Key 只写入发往官方端点的 Authorization 头，不进入请求体或错误信息。
 */
export function createDeepSeekClient(options: DeepSeekClientOptions): DeepSeekGenerator {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpoint = options.endpoint ?? DEEPSEEK_ENDPOINT;
  const model = options.model ?? DEFAULT_MODEL;

  return {
    async generate({ question, candidates }) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`
          },
          body: JSON.stringify({
            model,
            stream: false,
            // 关闭思考，避免推理过程拖慢响应并挤占有限输出预算。
            thinking: { type: 'disabled' },
            temperature: 0,
            max_tokens: 512,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: buildUserPrompt(question, candidates) }
            ]
          })
        });

        if (response.status === 401 || response.status === 403) {
          throw new DeepSeekError('auth');
        }
        if (response.status === 402 || response.status === 429) {
          throw new DeepSeekError('quota');
        }
        if (!response.ok) {
          throw new DeepSeekError('unavailable');
        }

        let payload: unknown;
        try {
          // 读取响应体也在超时范围内。
          payload = await response.json();
        } catch {
          throw new DeepSeekError(timedOut ? 'timeout' : 'invalid_response');
        }

        const completion = completionSchema.safeParse(payload);
        if (!completion.success) {
          throw new DeepSeekError('invalid_response');
        }

        const content = completion.data.choices[0]?.message.content;
        if (!content) {
          throw new DeepSeekError('invalid_response');
        }

        let raw: unknown;
        try {
          raw = JSON.parse(content);
        } catch {
          throw new DeepSeekError('invalid_response');
        }

        const generation = deepseekGenerationSchema.safeParse(raw);
        if (!generation.success) {
          throw new DeepSeekError('invalid_response');
        }

        return generation.data;
      } catch (error) {
        if (error instanceof DeepSeekError) {
          throw error;
        }
        throw new DeepSeekError(timedOut ? 'timeout' : 'unavailable');
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
