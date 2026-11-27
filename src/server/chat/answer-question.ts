import type { ChatResponse } from '../../shared/chat.js';
import type { DeploymentMode } from '../config.js';
import {
  DeepSeekError,
  type DeepSeekFailureReason,
  type DeepSeekGenerator,
  type EvidenceCandidate
} from '../deepseek/client.js';
import { answerQuestion as answerFromFaq } from '../faq/answer.js';
import { findEvidenceCandidates } from '../faq/candidates.js';
import { FAQ_CORPUS, type FaqEntry } from '../faq/corpus.js';
import { retrieveFaq } from '../faq/retrieve.js';
import { validateGeneration } from './validate-generation.js';

/** 上游不可用且无法降级时，由路由转换为受控的错误响应。 */
export class ChatUpstreamError extends Error {
  constructor(readonly reason: DeepSeekFailureReason) {
    super('生成服务暂时不可用。');
    this.name = 'ChatUpstreamError';
  }
}

export interface AnswerChatDeps {
  mode: DeploymentMode;
  generate?: DeepSeekGenerator;
  corpus?: readonly FaqEntry[];
}

function toEvidenceCandidate(entry: FaqEntry): EvidenceCandidate {
  return {
    faqId: entry.id,
    title: entry.title,
    questionExamples: entry.questions,
    excerpt: entry.excerpt
  };
}

/** 只有唯一命中时才用同一政策做确定性降级；否则保持原有澄清文案。 */
function fallbackOrClarify(
  question: string,
  matched: boolean,
  corpus: readonly FaqEntry[]
): ChatResponse {
  const preset = answerFromFaq(question, corpus);
  if (matched && preset.status === 'answered') {
    return { ...preset, mode: 'fallback' };
  }
  return preset;
}

/**
 * 编排一轮同源问答。
 *
 * 预置模式只走确定性检索。真实模式先用检索圈定有限证据：
 * 唯一命中时允许模型改写该条目的结论，主题明确的未命中问法才交给模型在主题候选内选择；
 * 歧义或主题不明直接澄清，不发起模型请求。生成结果必须通过引用和政策事实校验，
 * 上游失败或校验不通过时，能独立确认政策就降级，否则澄清或交给路由返回可重试错误。
 */
export async function answerChatQuestion(
  question: string,
  deps: AnswerChatDeps
): Promise<ChatResponse> {
  const corpus = deps.corpus ?? FAQ_CORPUS;

  if (deps.mode === 'preset') {
    return { ...answerFromFaq(question, corpus), mode: 'preset' };
  }

  if (!deps.generate) {
    throw new Error('真实模式缺少模型调用实现。');
  }

  const retrieval = retrieveFaq(question, corpus);
  if (retrieval.status === 'ambiguous') {
    return answerFromFaq(question, corpus);
  }

  const evidence =
    retrieval.status === 'matched'
      ? [retrieval.entry]
      : findEvidenceCandidates(question, corpus);

  if (evidence.length === 0) {
    return answerFromFaq(question, corpus);
  }

  try {
    const generation = await deps.generate.generate({
      question,
      candidates: evidence.map(toEvidenceCandidate)
    });

    if (generation.status === 'insufficient_evidence') {
      return fallbackOrClarify(question, retrieval.status === 'matched', corpus);
    }

    const validation = validateGeneration(generation, evidence);
    if (!validation.ok) {
      return fallbackOrClarify(question, retrieval.status === 'matched', corpus);
    }

    return {
      status: 'answered',
      answer: validation.answer,
      source: validation.source,
      mode: 'generated'
    };
  } catch (error) {
    if (error instanceof DeepSeekError) {
      if (retrieval.status === 'matched') {
        return fallbackOrClarify(question, true, corpus);
      }
      throw new ChatUpstreamError(error.reason);
    }
    throw error;
  }
}
