import { useEffect, useRef, useState } from 'react';
import { chatResponseSchema, type ChatResponse } from '../../shared/chat';

type ChatState =
  | { kind: 'idle' }
  | { kind: 'invalid' }
  | { kind: 'pending' }
  | { kind: 'result'; question: string; response: ChatResponse }
  | { kind: 'failed'; question: string };

/** 提交、编辑草稿和重试是独立操作，结果始终与实际提交的问题对应。 */
export function useChat() {
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<ChatState>({ kind: 'idle' });
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  async function ask(question: string) {
    const submittedQuestion = question.trim();
    if (!submittedQuestion) {
      setState({ kind: 'invalid' });
      return;
    }

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ kind: 'pending' });

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: submittedQuestion }),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error('问答接口暂时不可用');
      }

      const parsed = chatResponseSchema.parse(await response.json());
      // 即使旧请求忽略了中止信号，也不能覆盖后一次提交的结果。
      if (!controller.signal.aborted) {
        setState({ kind: 'result', question: submittedQuestion, response: parsed });
      }
    } catch {
      if (!controller.signal.aborted) {
        setState({ kind: 'failed', question: submittedQuestion });
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  }

  return {
    draft,
    setDraft,
    state,
    submit() {
      void ask(draft);
    },
    retry() {
      if (state.kind === 'failed') {
        void ask(state.question);
      }
    }
  };
}
