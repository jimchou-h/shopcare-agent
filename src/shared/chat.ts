import { z } from 'zod';

/** 问答接口的请求体。空白问题在入口处拒绝，避免绕过页面直接提交。 */
export const chatRequestSchema = z.object({
  question: z
    .string({ required_error: '请输入售后问题。' })
    .trim()
    .min(1, { message: '请输入售后问题。' })
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** 请求无法处理时返回的稳定错误码，与业务结果区分。 */
export interface ChatErrorResponse {
  status: 'invalid_request';
  message: string;
}

/** 回答所依据的 FAQ 出处，字段来自同一条语料。 */
export const faqSourceSchema = z.object({
  /** 稳定条目 ID，后续换货 Flow 也用它引用政策。 */
  id: z.string(),
  title: z.string(),
  /** 直接支持结论的政策原文摘录。 */
  excerpt: z.string(),
  /** 语料版本，便于演示环境核对回答依据。 */
  version: z.string()
});

export type FaqSource = z.infer<typeof faqSourceSchema>;

/**
 * 问答接口的响应契约，页面也用它在渲染前校验外部输入。
 * 只有结构完整时才进入已回答分支，避免异常响应在渲染出处时崩溃。
 */
export const chatResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('answered'),
    answer: z.string(),
    source: faqSourceSchema
  }),
  z.object({
    status: z.literal('insufficient_evidence'),
    message: z.string()
  })
]);

export type ChatResponse = z.infer<typeof chatResponseSchema>;
