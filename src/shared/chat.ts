import { z } from 'zod';
import {
  exchangeApplicationSchema,
  exchangeIneligibleReasonSchema,
  exchangeReasonSchema,
  exchangeSummarySchema
} from './exchange.js';
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
 * 对话内办理换货由服务端状态机推进，页面只展示当前步骤、摘要或结果。
 * 摘要复用与预览接口相同的结构与确认标识，提交仍走 `/api/exchange/confirm`。
 */
const exchangeFlowBase = { status: z.literal('exchange_flow') } as const;

const exchangeFlowStepSchema = z.object({
  ...exchangeFlowBase,
  outcome: z.literal('step'),
  step: z.enum(['reason', 'declaration']),
  orderId: z.string(),
  message: z.string(),
  reason: exchangeReasonSchema.optional(),
  options: z.array(z.string())
});

const exchangeFlowSummarySchema = z.object({
  ...exchangeFlowBase,
  outcome: z.literal('summary'),
  confirmationId: z.string(),
  expiresAt: z.number().int(),
  summary: exchangeSummarySchema
});

const exchangeFlowIneligibleSchema = z.object({
  ...exchangeFlowBase,
  outcome: z.literal('ineligible'),
  reason: exchangeIneligibleReasonSchema,
  message: z.string(),
  sources: z.array(faqSourceSchema)
});

const exchangeFlowAlreadySubmittedSchema = z.object({
  ...exchangeFlowBase,
  outcome: z.literal('already_submitted'),
  application: exchangeApplicationSchema,
  message: z.string()
});

const exchangeFlowCancelledSchema = z.object({
  ...exchangeFlowBase,
  outcome: z.literal('cancelled'),
  message: z.string()
});

const exchangeFlowNoticeSchema = z.object({
  ...exchangeFlowBase,
  outcome: z.literal('notice'),
  message: z.string()
});

const exchangeFlowSessionRequiredSchema = z.object({
  ...exchangeFlowBase,
  outcome: z.literal('session_required'),
  message: z.string()
});

export const exchangeFlowResponseSchema = z.discriminatedUnion('outcome', [
  exchangeFlowStepSchema,
  exchangeFlowSummarySchema,
  exchangeFlowIneligibleSchema,
  exchangeFlowAlreadySubmittedSchema,
  exchangeFlowCancelledSchema,
  exchangeFlowNoticeSchema,
  exchangeFlowSessionRequiredSchema
]);

export type ExchangeFlowResponse = z.infer<typeof exchangeFlowResponseSchema>;

/**
 * 问答接口的响应契约，页面也用它在渲染前校验外部输入。
 * 只有结构完整时才进入对应渲染分支，避免异常响应在渲染出处或订单时崩溃。
 * 查单结果本身按 `outcome` 判别，这里用普通联合承载它与政策回答。
 */
export const chatResponseSchema = z.union([
  answeredChatResponseSchema,
  insufficientEvidenceResponseSchema,
  orderQueryResponseSchema,
  exchangeFlowResponseSchema
]);

export type ChatResponse = z.infer<typeof chatResponseSchema>;
