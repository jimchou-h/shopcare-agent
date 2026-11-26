import { describe, expect, it } from 'vitest';
import { FAQ_CORPUS } from '../src/server/faq/corpus';
import { normalizeQuestion, retrieveFaq } from '../src/server/faq/retrieve';

describe('retrieveFaq', () => {
  it('忽略标点与大小写差异，覆盖两种换货期限问法', () => {
    const entry = FAQ_CORPUS.find((candidate) => candidate.id === 'faq-exchange-window');
    if (!entry) {
      throw new Error('测试语料缺少换货期限条目');
    }

    for (const question of entry.questions) {
      const result = retrieveFaq(question);
      expect(result.status).toBe('matched');
      if (result.status !== 'matched') {
        return;
      }
      expect(result.entry.id).toBe(entry.id);
    }
  });

  it('把空白输入视为没有证据', () => {
    expect(retrieveFaq('   ')).toEqual({ status: 'none' });
  });

  it('语料未覆盖的问法返回 none', () => {
    expect(retrieveFaq('会员积分怎么兑换？')).toEqual({ status: 'none' });
  });

  it('只有泛词命中但没有主题词时返回 none', () => {
    expect(retrieveFaq('会员积分兑换需要什么条件？')).toEqual({ status: 'none' });
  });

  it('主题词和不属于该主题的泛词组合时返回 none', () => {
    expect(retrieveFaq('退货邮费谁承担？')).toEqual({ status: 'none' });
  });

  it('只命中主题词不足以支持结论，返回 none', () => {
    expect(retrieveFaq('我想咨询换货')).toEqual({ status: 'none' });
  });

  it('两个主题条目各命中一个具体关键词时返回 ambiguous', () => {
    expect(retrieveFaq('换货的期限和条件是什么？')).toEqual({ status: 'ambiguous' });
  });

  it('不同分句分别命中不同政策时返回 ambiguous', () => {
    expect(retrieveFaq('换货期限是多久，换货需要什么条件？')).toEqual({ status: 'ambiguous' });
  });

  it('不跨分句拼接主题词与关键词', () => {
    expect(retrieveFaq('我不想换货，会员积分兑换需要什么条件？')).toEqual({ status: 'none' });
  });

  it('规范化时去掉空白与标点', () => {
    expect(normalizeQuestion(' 换货期限，是多久？ ')).toBe('换货期限是多久');
  });
});
