/**
 * 公开演示用的合成售后 FAQ 语料。
 *
 * 这些条目不是任何真实商家的政策，只用于演示"回答必须能指回同一段依据"。
 * 修改条目正文时同步提升 `FAQ_CORPUS_VERSION`，让验收记录能对应到具体语料版本。
 */
export const FAQ_CORPUS_VERSION = '2026-11-26.1';

export interface FaqEntry {
  /** 稳定 ID，回答出处、测试和后续 Flow 都以它为准。 */
  id: string;
  title: string;
  /** 主题词。只有问题提到该主题时才考虑此条目，避免"条件""邮费"等泛词串到无关政策。 */
  topic: string;
  /** 已覆盖的问法，检索测试直接复用这些句子，避免测试和语料脱节。 */
  questions: string[];
  /** 给顾客看的结论，内容必须能由 excerpt 直接支持。 */
  answer: string;
  /** 政策原文摘录，是回答的唯一依据。 */
  excerpt: string;
  /**
   * 可解释的检索关键词。命中越长、越具体的词权重越高，
   * 让"换货期限"这类完整问法优先于只命中"换货"的宽泛条目。
   */
  keywords: string[];
}

export const FAQ_CORPUS: readonly FaqEntry[] = [
  {
    id: 'faq-exchange-window',
    title: '换货申请期限',
    topic: '换货',
    questions: ['换货期限是多久？', '我收到货以后几天内还能申请换货？'],
    answer: '顾客自签收商品之日起 7 天内可以申请换货。',
    excerpt:
      '顾客自签收商品之日起 7 天内（含第 7 天）可提交换货申请，逾期不再受理。',
    keywords: ['换货期限', '期限', '多久', '几天', '多少天', '天内']
  },
  {
    id: 'faq-exchange-condition',
    title: '换货需要满足的条件',
    topic: '换货',
    questions: ['换货需要什么条件？', '商品拆封以后还能换货吗？'],
    answer: '申请换货的商品需要保持完好，配件、赠品和原包装齐全。',
    excerpt:
      '申请换货的商品应保持完好，配件、赠品及原包装齐全；已影响二次销售的商品不支持换货。',
    keywords: ['换货条件', '条件', '拆封', '完好', '配件', '包装', '二次销售']
  },
  {
    id: 'faq-exchange-shipping',
    title: '换货的运费由谁承担',
    topic: '换货',
    questions: ['换货的运费谁出？', '换货要自己付邮费吗？'],
    answer:
      '因商品质量问题换货，往返运费由商家承担；非质量原因的换货由顾客承担寄回运费。',
    excerpt:
      '因商品质量问题发起的换货，往返运费由商家承担；非质量原因发起的换货，寄回运费由顾客承担。',
    keywords: ['换货运费', '运费', '邮费', '谁出', '谁承担', '质量问题']
  },
  {
    id: 'faq-return-window',
    title: '退货申请期限',
    topic: '退货',
    questions: ['退货期限是多久？', '签收后几天内可以申请退货？'],
    answer: '顾客自签收商品之日起 7 天内可以申请无理由退货。',
    excerpt:
      '顾客自签收商品之日起 7 天内（含第 7 天）可提交无理由退货申请，逾期不再受理。',
    keywords: ['退货期限', '期限', '无理由', '多久', '几天', '多少天', '天内']
  }
] as const;
