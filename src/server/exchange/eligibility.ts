import type { ExchangeDeclaration } from '../../shared/exchange.js';

/** 演示统一按东八区自然日计算，签收日与当前时刻都不使用服务器本地时区。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 签收日算第 1 天，第 7 天全天可提交。 */
const EXCHANGE_WINDOW_DAYS = 7;

export type ExchangeIneligibleReason = 'not_signed' | 'overdue' | 'condition_not_met';

export type ExchangeEligibility =
  | { eligible: true }
  | { eligible: false; reason: ExchangeIneligibleReason };

/** 把时间戳换算成东八区的自然日序号，便于按日期而非 24 小时窗口比较。 */
export function shanghaiDay(timestamp: number): number {
  return Math.floor((timestamp + SHANGHAI_OFFSET_MS) / DAY_MS);
}

/** 仍在签收后的申请期限内（含第 7 天）返回 true；第 8 天零时起返回 false。 */
export function isWithinExchangeWindow(signedAt: number, now: number): boolean {
  return shanghaiDay(now) - shanghaiDay(signedAt) <= EXCHANGE_WINDOW_DAYS - 1;
}

/**
 * 按服务端数据与顾客申报判断换货资格。
 *
 * 顺序固定为签收、期限、申报条件，页面因此总能先看到最基础的阻塞原因。
 * 赠品是否齐全不参与判断：演示订单没有赠品数据，无法得知适用性。
 */
export function evaluateExchangeEligibility(input: {
  signedAt: number | null;
  now: number;
  declaration: ExchangeDeclaration;
}): ExchangeEligibility {
  if (input.signedAt === null) {
    return { eligible: false, reason: 'not_signed' };
  }

  if (!isWithinExchangeWindow(input.signedAt, input.now)) {
    return { eligible: false, reason: 'overdue' };
  }

  const { itemIntact, accessoriesComplete, originalPackaging } = input.declaration;
  if (!itemIntact || !accessoriesComplete || !originalPackaging) {
    return { eligible: false, reason: 'condition_not_met' };
  }

  return { eligible: true };
}
