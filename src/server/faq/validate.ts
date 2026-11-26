import type { FaqEntry } from './corpus.js';

/**
 * 检查 FAQ 语料是否足以提供带出处的回答。
 *
 * 健康检查用它判断服务能否就绪：ID 重复会让出处无法区分，缺少正文或关键词
 * 则意味着对应条目无法产生可核对结论。返回空数组表示语料有效。
 */
export function findCorpusProblems(corpus: readonly FaqEntry[]): string[] {
  const problems: string[] = [];
  if (corpus.length === 0) {
    problems.push('语料为空');
  }

  const seenIds = new Set<string>();
  for (const entry of corpus) {
    const label = entry.id || '(缺少 id)';
    if (!entry.id.trim()) {
      problems.push(`${label}: 缺少 id`);
    } else if (seenIds.has(entry.id)) {
      problems.push(`${label}: id 重复`);
    }
    seenIds.add(entry.id);

    if (!entry.title.trim()) {
      problems.push(`${label}: 缺少标题`);
    }
    if (!entry.topic.trim()) {
      problems.push(`${label}: 缺少主题词`);
    }
    if (!entry.answer.trim()) {
      problems.push(`${label}: 缺少结论`);
    }
    if (!entry.excerpt.trim()) {
      problems.push(`${label}: 缺少政策摘录`);
    }
    if (entry.keywords.length === 0) {
      problems.push(`${label}: 缺少检索关键词`);
    }
    if (entry.questions.length === 0) {
      problems.push(`${label}: 缺少已覆盖问法`);
    }
  }

  return problems;
}
