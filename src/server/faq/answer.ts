import type { ChatResponse } from '../../shared/chat.js';
import { FAQ_CORPUS, FAQ_CORPUS_VERSION, type FaqEntry } from './corpus.js';
import { retrieveFaq } from './retrieve.js';

/** FAQ 只产生政策回答或补充引导，不涉及本地查单结果。 */
export type FaqAnswer = Extract<
  ChatResponse,
  { status: 'answered' | 'insufficient_evidence' }
>;

/**
 * 把一轮顾客问题转换为带出处的回答。
 *
 * 只有检索结果唯一命中时才返回政策结论；结论、标题和摘录都取自同一 FAQ 条目，
 * 保证页面上看到的引用能直接核对。无匹配或最高分并列时不下政策结论、不附引用，
 * 只返回引导顾客补充信息的文案。
 */
export function answerQuestion(
  question: string,
  corpus: readonly FaqEntry[] = FAQ_CORPUS
): FaqAnswer {
  const result = retrieveFaq(question, corpus);

  if (result.status === 'none') {
    return {
      status: 'insufficient_evidence',
      message:
        '没有找到与这个问题对应的政策说明。请补充涉及的商品、时间或具体诉求，例如「换货期限是多久？」。'
    };
  }

  if (result.status === 'ambiguous') {
    return {
      status: 'insufficient_evidence',
      message:
        '现有资料对应了多条可能的政策，无法确定哪一条适用。请补充涉及的商品、时间或具体诉求，以便缩小范围。'
    };
  }

  return {
    status: 'answered',
    answer: result.entry.answer,
    source: {
      id: result.entry.id,
      title: result.entry.title,
      excerpt: result.entry.excerpt,
      version: FAQ_CORPUS_VERSION
    }
  };
}
