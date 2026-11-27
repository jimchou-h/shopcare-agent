import { FAQ_CORPUS, type FaqEntry } from './corpus.js';
import { normalizeQuestion, splitQuestionClauses } from './retrieve.js';

/**
 * 明确否定某个主题的说法，例如「我不想换货」。
 * 只检查主题词前面的短后缀，避免把「能不能换货」这类疑问误判为否定。
 */
const NEGATED_TOPIC = /(?:不想|不打算|不要|不用|不需要|不支持|不能|无法|没打算|并非|不是)(?:再|继续)?$/u;

/** 「不是不能换货」这类双重否定实际是肯定，不应被当成否定分句跳过。 */
const DOUBLE_NEGATION = /(?:不是|并非)(?:不想|不打算|不要|不用|不需要|不支持|不能|无法|没打算)$/u;

/** 询问资格或可能性的否定句，例如「我不能换货吗？」，主题和咨询意图仍然明确。 */
const INQUIRY_NEGATION = /(?:不能|无法|不支持|不可以)(?:再|继续)?$/u;
const INQUIRY_MARKER = /(?:是否|能否|可否|能不能|可不可以|会不会|是不是)/u;
const INQUIRY_ENDING = /(?:吗|呢|吧|么)$/u;

function isInquiryClause(clause: string): boolean {
  return INQUIRY_ENDING.test(clause) || INQUIRY_MARKER.test(clause);
}

/**
 * 找出问题中未被明确否定的售后主题。
 *
 * 只有主题和咨询意图都清楚时才值得把有限候选交给模型：
 * 「我不想换货」这类陈述不参与判断；「我不能换货吗？」这类否定疑问句
 * 和「不是不能换货」这类双重否定仍表示明确的主题与咨询意图。
 */
export function findQuestionTopics(
  question: string,
  corpus: readonly FaqEntry[] = FAQ_CORPUS
): string[] {
  const topics = new Map<string, string>();
  for (const entry of corpus) {
    topics.set(normalizeQuestion(entry.topic), entry.topic);
  }

  const found = new Set<string>();
  for (const clause of splitQuestionClauses(question)) {
    for (const [normalizedTopic, topic] of topics) {
      const index = clause.indexOf(normalizedTopic);
      if (index === -1) {
        continue;
      }

      const beforeTopic = clause.slice(0, index).replace(DOUBLE_NEGATION, '');
      const negated = NEGATED_TOPIC.test(beforeTopic);
      const asksAboutEligibility = isInquiryClause(clause) && INQUIRY_NEGATION.test(beforeTopic);
      if (negated && !asksAboutEligibility) {
        continue;
      }
      found.add(topic);
    }
  }

  return [...found];
}

/**
 * 关键词未命中但主题唯一时，返回该主题下的全部政策条目。
 *
 * 多个主题、零主题或主题下有歧义时返回空数组，由调用方直接引导澄清，
 * 不把过宽的问题交给模型猜答案。
 */
export function findEvidenceCandidates(
  question: string,
  corpus: readonly FaqEntry[] = FAQ_CORPUS
): FaqEntry[] {
  const topics = findQuestionTopics(question, corpus);
  const onlyTopic = topics.length === 1 ? topics[0] : undefined;
  if (!onlyTopic) {
    return [];
  }

  return corpus.filter((entry) => entry.topic === onlyTopic);
}
