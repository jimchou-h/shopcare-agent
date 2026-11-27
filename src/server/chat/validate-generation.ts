import type { DeepSeekGeneration } from '../deepseek/client.js';
import { FAQ_CORPUS_VERSION, type FaqEntry } from '../faq/corpus.js';
import { normalizeQuestion } from '../faq/retrieve.js';

export type GenerationProblem =
  | 'unknown_candidate'
  | 'quote_mismatch'
  | 'answer_invalid'
  | 'fact_mismatch';

export type GenerationValidation =
  | {
      ok: true;
      entry: FaqEntry;
      answer: string;
      source: {
        id: string;
        title: string;
        excerpt: string;
        version: string;
      };
    }
  | { ok: false; problem: GenerationProblem };

const NUMBER_PATTERN = /\d+(?:\.\d+)?\s*(?:天|日|个工作日|小时|元|%|折)/gu;
const DAY_PATTERN = /\d+(?:天|日|个工作日)/u;
const CONDITION_TERMS = ['完好', '配件', '包装', '赠品', '二次销售'];

function stripSpaces(text: string): string {
  return text.replace(/\s+/gu, '').toLowerCase();
}

function extractNumbers(text: string): string[] {
  return (text.match(NUMBER_PATTERN) ?? []).map(stripSpaces);
}

interface FeeAssignment {
  condition: '质量' | '非质量' | '';
  actor: '商家' | '顾客' | '';
}

/** 抽取「条件 → 承担方」的对应关系，防止把非质量问题写成商家承担。 */
function extractFeeAssignments(text: string): FeeAssignment[] {
  return text
    // 只在句号/分号处切分，避免把「非质量原因」和「由商家承担」拆到两个分句。
    .split(/[。；;\n]/u)
    .filter((clause) => clause.includes('承担'))
    .map((clause) => ({
      condition: clause.includes('非质量')
        ? '非质量'
        : clause.includes('质量')
          ? '质量'
          : '',
      actor: clause.includes('商家') ? '商家' : clause.includes('顾客') ? '顾客' : ''
    }));
}

/** 复验模型正文中的数字、起算点和费用归属是否与同一政策摘录一致。 */
function factsAreSupported(entry: FaqEntry, answer: string): boolean {
  const excerpt = stripSpaces(entry.excerpt);
  const text = stripSpaces(answer);

  const excerptNumbers = new Set(extractNumbers(entry.excerpt));
  for (const number of extractNumbers(answer)) {
    if (!excerptNumbers.has(number)) {
      return false;
    }
  }

  if (DAY_PATTERN.test(excerpt)) {
    if (!DAY_PATTERN.test(text)) {
      return false;
    }
    // 有时限的政策必须交代起算点，不能只写天数。
    if (excerpt.includes('签收') && !text.includes('签收')) {
      return false;
    }
  }

  if (excerpt.includes('承担')) {
    if (!text.includes('承担')) {
      return false;
    }
    const allowed = extractFeeAssignments(entry.excerpt);
    const claimed = extractFeeAssignments(answer);
    if (claimed.length === 0) {
      return false;
    }
    for (const assignment of claimed) {
      if (
        !allowed.some(
          (candidate) =>
            candidate.condition === assignment.condition && candidate.actor === assignment.actor
        )
      ) {
        return false;
      }
    }
  }

  // 条件类政策必须落到具体商品状态，不能只给一句泛泛的「可以换货」。
  if (entry.id === 'faq-exchange-condition') {
    if (!CONDITION_TERMS.some((term) => text.includes(term))) {
      return false;
    }
  }

  return true;
}

/**
 * 校验模型生成结果是否可以展示。
 *
 * 依次核对候选身份、引文是否来自该条目的原文、正文长度和可复查的政策事实。
 * 任何一步失败都只返回原因，由问答用例决定降级还是澄清，绝不把未校验正文透传。
 */
export function validateGeneration(
  generation: DeepSeekGeneration,
  candidates: readonly FaqEntry[]
): GenerationValidation {
  if (generation.status !== 'answered') {
    return { ok: false, problem: 'answer_invalid' };
  }

  const entry = candidates.find((candidate) => candidate.id === generation.faqId);
  if (!entry) {
    return { ok: false, problem: 'unknown_candidate' };
  }

  const quote = generation.evidenceQuote.trim();
  if (!quote || !normalizeQuestion(entry.excerpt).includes(normalizeQuestion(quote))) {
    return { ok: false, problem: 'quote_mismatch' };
  }

  const answer = generation.answer.trim();
  if (!answer || answer.length > 300) {
    return { ok: false, problem: 'answer_invalid' };
  }

  if (!factsAreSupported(entry, answer)) {
    return { ok: false, problem: 'fact_mismatch' };
  }

  return {
    ok: true,
    entry,
    answer,
    source: {
      id: entry.id,
      title: entry.title,
      excerpt: entry.excerpt,
      version: FAQ_CORPUS_VERSION
    }
  };
}
