import { FAQ_CORPUS, type FaqEntry } from './corpus.js';

export type RetrievalResult =
  | { status: 'matched'; entry: FaqEntry; matchedKeywords: string[]; score: number }
  | { status: 'none' }
  | { status: 'ambiguous' };

/** 去掉大小写、空白和标点差异，让"换货期限是多久？"和"换货期限是多久"等价。 */
export function normalizeQuestion(input: string): string {
  return input.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 按中文/英文标点切分分句，避免把不同分句的主题词和关键词拼成一次命中。 */
const CLAUSE_SEPARATOR = /[，,。.；;！!？?、\r\n]+/u;

/**
 * 把问题切成规范化后的分句。语义候选的主题判断也复用它，
 * 保证"主题词与关键词必须在同一分句命中"和"不得跨分句拼接主题"使用同一口径。
 */
export function splitQuestionClauses(question: string): string[] {
  return question
    .split(CLAUSE_SEPARATOR)
    .map(normalizeQuestion)
    .filter((clause) => clause.length > 0);
}

/**
 * 在单个分句内匹配主题词和具体关键词，只有整体能唯一对应一个条目时才回答。
 *
 * 主题词（换货/退货）只决定条目的适用方向，单独命中不足以支持政策结论；
 * 还必须和至少一个具体关键词出现在同一分句，避免"条件""邮费"这类泛词、
 * 以及"我不想换货，……条件"这种跨分句拼接造成误匹配。问题涉及多个条目时
 * 视为无法用单条政策回答，返回 `ambiguous`；没有任何候选时返回 `none`。
 * 检索结果只依赖输入与固定语料，便于重复验收。
 */
export function retrieveFaq(
  question: string,
  corpus: readonly FaqEntry[] = FAQ_CORPUS
): RetrievalResult {
  const clauses = splitQuestionClauses(question);

  if (clauses.length === 0) {
    return { status: 'none' };
  }

  const candidates = new Map<string, { entry: FaqEntry; matchedKeywords: Set<string>; score: number }>();

  for (const clause of clauses) {
    for (const entry of corpus) {
      if (!clause.includes(normalizeQuestion(entry.topic))) {
        continue;
      }

      const matchedKeywords = entry.keywords.filter((keyword) =>
        clause.includes(normalizeQuestion(keyword))
      );
      if (matchedKeywords.length === 0) {
        continue;
      }

      const score = matchedKeywords.reduce((total, keyword) => total + keyword.length, 0);
      const existing = candidates.get(entry.id);
      if (!existing || score > existing.score) {
        candidates.set(entry.id, {
          entry,
          matchedKeywords: new Set(matchedKeywords),
          score
        });
      } else {
        for (const keyword of matchedKeywords) {
          existing.matchedKeywords.add(keyword);
        }
      }
    }
  }

  if (candidates.size === 0) {
    return { status: 'none' };
  }

  // 同一问题命中多个政策条目时，任一单条都不足以完整回答。
  if (candidates.size > 1) {
    return { status: 'ambiguous' };
  }

  const only = [...candidates.values()][0];
  if (!only) {
    return { status: 'none' };
  }

  return {
    status: 'matched',
    entry: only.entry,
    matchedKeywords: [...only.matchedKeywords],
    score: only.score
  };
}
