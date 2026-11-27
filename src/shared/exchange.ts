import { z } from 'zod';
import { faqSourceSchema } from './faq.js';
import { DEMO_ORDER_ID_PATTERN } from './orders.js';

/** 换货原因只允许两种结构化取值，运费说明由服务端按原因给出。 */
export const exchangeReasonSchema = z.enum(['quality', 'other']);

export type ExchangeReason = z.infer<typeof exchangeReasonSchema>;

/**
 * 顾客对商品现状的申报。服务端只按申报判断，无法核实实物；
 * 赠品是否齐全仅在订单含赠品时才有意义，演示订单没有赠品数据，因此不阻塞资格。
 */
export const exchangeDeclarationSchema = z.object({
  itemIntact: z.boolean(),
  accessoriesComplete: z.boolean(),
  originalPackaging: z.boolean(),
  giftComplete: z.boolean()
});

export type ExchangeDeclaration = z.infer<typeof exchangeDeclarationSchema>;

/** 演示换货申请编号：`EX-` 加 12 位英文字母或数字。 */
export const EXCHANGE_APPLICATION_ID_PATTERN = /^EX-[A-Z0-9]{12}$/;

/** 已受理的换货申请回执；当前业务终态只有「已提交」。 */
export const exchangeApplicationSchema = z.object({
  applicationId: z.string().regex(EXCHANGE_APPLICATION_ID_PATTERN),
  status: z.literal('submitted')
});

export type ExchangeApplication = z.infer<typeof exchangeApplicationSchema>;

/** 预览请求：订单归属、原因与商品申报共同决定资格。 */
export const exchangePreviewRequestSchema = z.object({
  orderId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(DEMO_ORDER_ID_PATTERN, { message: '订单号格式不正确。' }),
  reason: exchangeReasonSchema,
  declaration: exchangeDeclarationSchema
});

export type ExchangePreviewRequest = z.infer<typeof exchangePreviewRequestSchema>;

/** 确认请求只携带不透明的确认标识，订单、原因与申报由服务端摘要还原。 */
export const exchangeConfirmRequestSchema = z.object({
  confirmationId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{16,64}$/, { message: '确认标识格式不正确。' })
});

export const exchangeIneligibleReasonSchema = z.enum([
  'not_signed',
  'overdue',
  'condition_not_met'
]);

export type ExchangeIneligibleReason = z.infer<typeof exchangeIneligibleReasonSchema>;

const exchangePreviewBase = { status: z.literal('exchange_preview') } as const;

/** 预览成功时的待确认摘要；`confirmationId` 是提交时的幂等标识。 */
const eligiblePreviewSchema = z.object({
  ...exchangePreviewBase,
  outcome: z.literal('eligible'),
  confirmationId: z.string(),
  expiresAt: z.number().int(),
  summary: z.object({
    orderId: z.string(),
    productName: z.string(),
    reason: exchangeReasonSchema,
    reasonLabel: z.string(),
    shipping: z.object({
      borneBy: z.enum(['merchant', 'customer']),
      note: z.string()
    }),
    sources: z.array(faqSourceSchema)
  })
});

const ineligiblePreviewSchema = z.object({
  ...exchangePreviewBase,
  outcome: z.literal('ineligible'),
  reason: exchangeIneligibleReasonSchema,
  message: z.string(),
  sources: z.array(faqSourceSchema)
});

/** 同一订单已有申请时，预览直接返回原回执。 */
const alreadySubmittedPreviewSchema = z.object({
  ...exchangePreviewBase,
  outcome: z.literal('already_submitted'),
  application: exchangeApplicationSchema
});

const sessionRequiredPreviewSchema = z.object({
  ...exchangePreviewBase,
  outcome: z.literal('session_required'),
  message: z.string()
});

const notFoundPreviewSchema = z.object({
  ...exchangePreviewBase,
  outcome: z.literal('not_found'),
  message: z.string()
});

export const exchangePreviewResponseSchema = z.discriminatedUnion('outcome', [
  eligiblePreviewSchema,
  ineligiblePreviewSchema,
  alreadySubmittedPreviewSchema,
  sessionRequiredPreviewSchema,
  notFoundPreviewSchema
]);

export type ExchangePreviewResponse = z.infer<typeof exchangePreviewResponseSchema>;

const exchangeConfirmBase = { status: z.literal('exchange_application') } as const;

/** 确认成功；同一确认重试也返回同一申请编号。 */
const submittedApplicationSchema = z.object({
  ...exchangeConfirmBase,
  outcome: z.literal('submitted'),
  application: exchangeApplicationSchema
});

const ineligibleConfirmSchema = z.object({
  ...exchangeConfirmBase,
  outcome: z.literal('ineligible'),
  reason: exchangeIneligibleReasonSchema,
  message: z.string(),
  sources: z.array(faqSourceSchema)
});

const expiredConfirmSchema = z.object({
  ...exchangeConfirmBase,
  outcome: z.literal('expired'),
  message: z.string()
});

const supersededConfirmSchema = z.object({
  ...exchangeConfirmBase,
  outcome: z.literal('superseded'),
  message: z.string()
});

const invalidConfirmationSchema = z.object({
  ...exchangeConfirmBase,
  outcome: z.literal('invalid_confirmation'),
  message: z.string()
});

const sessionRequiredConfirmSchema = z.object({
  ...exchangeConfirmBase,
  outcome: z.literal('session_required'),
  message: z.string()
});

const notFoundConfirmSchema = z.object({
  ...exchangeConfirmBase,
  outcome: z.literal('not_found'),
  message: z.string()
});

export const exchangeConfirmResponseSchema = z.discriminatedUnion('outcome', [
  submittedApplicationSchema,
  ineligibleConfirmSchema,
  expiredConfirmSchema,
  supersededConfirmSchema,
  invalidConfirmationSchema,
  sessionRequiredConfirmSchema,
  notFoundConfirmSchema
]);

export type ExchangeConfirmResponse = z.infer<typeof exchangeConfirmResponseSchema>;

/** 换货接口的稳定错误码，与业务结果分开表示。 */
export const exchangeErrorResponseSchema = z.object({
  status: z.enum(['invalid_request', 'forbidden', 'rate_limited', 'unavailable']),
  message: z.string()
});

export type ExchangeErrorResponse = z.infer<typeof exchangeErrorResponseSchema>;
