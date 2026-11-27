import { z } from 'zod';

/**
 * 合成演示单号：`SC-` 加 12 位英文字母或数字。
 * 服务端在校验前统一转成大写，浏览器只消费该格式的单号。
 */
export const DEMO_ORDER_ID_PATTERN = /^SC-[A-Z0-9]{12}$/;

/** 当前访客可查询的合成订单。字段只来自服务端种子数据，不含真实顾客信息。 */
export const demoOrderSchema = z.object({
  orderId: z.string().regex(DEMO_ORDER_ID_PATTERN),
  productName: z.string(),
  status: z.string()
});

export type DemoOrder = z.infer<typeof demoOrderSchema>;

/** 领取示例订单的成功响应。重复领取同一有效会话返回同一笔订单。 */
export const demoSessionResponseSchema = z.object({
  status: z.literal('claimed'),
  order: demoOrderSchema
});

export type DemoSessionResponse = z.infer<typeof demoSessionResponseSchema>;

export const demoSessionErrorSchema = z.object({
  status: z.enum(['forbidden', 'unavailable', 'rate_limited']),
  message: z.string()
});
