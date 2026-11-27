import type { ExchangeReason } from '../../shared/exchange.js';
import type { FaqSource } from '../../shared/faq.js';
import { FAQ_CORPUS, FAQ_CORPUS_VERSION } from '../faq/corpus.js';
import type { ExchangeIneligibleReason } from './eligibility.js';

/** 换货摘要只引用这三条原始政策，回答与摘要共享同一语料版本。 */
const WINDOW_POLICY_ID = 'faq-exchange-window';
const CONDITION_POLICY_ID = 'faq-exchange-condition';
const SHIPPING_POLICY_ID = 'faq-exchange-shipping';

const REASON_LABELS: Record<ExchangeReason, string> = {
  quality: '质量问题',
  other: '其他原因'
};

/** 运费说明直接对应语料中的承担方，页面同时展示运费政策原文。 */
const SHIPPING_NOTICES: Record<
  ExchangeReason,
  { borneBy: 'merchant' | 'customer'; note: string }
> = {
  quality: { borneBy: 'merchant', note: '因商品质量问题换货，往返运费由商家承担。' },
  other: { borneBy: 'customer', note: '非质量原因的换货，寄回运费由顾客承担。' }
};

function findPolicy(id: string): FaqSource {
  const entry = FAQ_CORPUS.find((item) => item.id === id);
  if (!entry) {
    throw new Error(`缺少换货政策语料：${id}`);
  }
  return {
    id: entry.id,
    title: entry.title,
    excerpt: entry.excerpt,
    version: FAQ_CORPUS_VERSION
  };
}

export function exchangeReasonLabel(reason: ExchangeReason): string {
  return REASON_LABELS[reason];
}

export function exchangeShippingNotice(reason: ExchangeReason): {
  borneBy: 'merchant' | 'customer';
  note: string;
} {
  return SHIPPING_NOTICES[reason];
}

/** 符合条件时同时引用期限、商品条件与运费条款。 */
export function exchangeSummarySources(): FaqSource[] {
  return [findPolicy(WINDOW_POLICY_ID), findPolicy(CONDITION_POLICY_ID), findPolicy(SHIPPING_POLICY_ID)];
}

/** 不符合条件时只引用解释该原因的条目，避免无关政策混淆判断。 */
export function exchangeEligibilitySources(reason: ExchangeIneligibleReason): FaqSource[] {
  if (reason === 'condition_not_met') {
    return [findPolicy(CONDITION_POLICY_ID)];
  }
  return [findPolicy(WINDOW_POLICY_ID)];
}
