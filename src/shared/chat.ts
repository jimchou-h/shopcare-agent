import { z } from 'zod';
import { exchangeApplicationSchema } from './exchange.js';
import { faqSourceSchema } from './faq.js';
import { demoOrderSchema } from './orders.js';

export { faqSourceSchema };

/** 问答接口的请求体。空白问题在入口处拒绝，避免绕过页面直接提交。 */
export const chatRequestSchema = z.object({
  question: z
    .string({ required_error: '请输入售后问题。' })
    .trim()
    .min(1, { message: '请输入售后问题。' })
});

/** 请求无法处理、生成服务不可用或来源不受信任时返回的稳定错误码，与业务结果区分。 */
export const chatErrorResponseSchema = z.object({
  status: z.enum(['invalid_request', 'upstream_error', 'forbidden', 'rate_limited']),
  message: z.string()
});

export type ChatErrorResponse = z.infer<typeof chatErrorResponseSchema>;

/** 本轮实际采用的回答来源：预置、模型生成或上游失败后的预置降级。 */
export const chatModeSchema = z.enum(['preset', 'generated', 'fallback']);

export type ChatMode = z.infer<typeof chatModeSchema>;

// 字段保持可选，兼容已经归档的问答契约；当前服务在回答中显式返回来源。
const answeredChatResponseSchema = z.object({
  status: z.literal('answered'),
  answer: z.string(),
  source: faqSourceSchema,
  mode: chatModeSchema.optional()
});

/** 证据不足时只返回引导文案，不携带任何政策结论或引用。 */
const insufficientEvidenceResponseSchema = z.object({
  status: z.literal('insufficient_evidence'),
  message: z.string(),
  mode: chatModeSchema.optional()
});

/**
 * 查单由服务端确定性处理，结果与模型生成的政策回答分开表示。
 * `found` 携带订单摘要；其余结果只带引导文案，不携带任何订单详情。
 */
export const orderQueryResponseSchema = z.discriminatedUnion('outcome', [
  z.object({
    status: z.literal('order_query'),
    outcome: z.literal('found'),
    order: demoOrderSchema,
    /** 已受理的换货申请；查单时一并返回，刷新页面也能恢复回执。 */
    exchange: exchangeApplicationSchema.optional()
  }),
  z.object({
    status: z.literal('order_query'),
    outcome: z.enum([
      'not_found',
      'number_required',
      'invalid_number',
      'session_required',
      'ask_separately',
      'query_hint'
    ]),
    message: z.string()
  })
]);

/**
 * 问答接口的响应契约，页面也用它在渲染前校验外部输入。
 * 只有结构完整时才进入对应渲染分支，避免异常响应在渲染出处或订单时崩溃。
 * 查单结果本身按 `outcome` 判别，这里用普通联合承载它与政策回答。
 */
export const chatResponseSchema = z.union([
  answeredChatResponseSchema,
  insufficientEvidenceResponseSchema,
  orderQueryResponseSchema
]);

export type ChatResponse = z.infer<typeof chatResponseSchema>;
