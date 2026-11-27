import { useEffect, useRef, useState } from 'react';
import {
  chatErrorResponseSchema,
  chatResponseSchema,
  type ChatResponse
} from '../../shared/chat';

type ChatState =
  | { kind: 'idle' }
  | { kind: 'invalid' }
  | { kind: 'pending' }
  | { kind: 'result'; question: string; response: ChatResponse }
  | { kind: 'failed'; question: string; message: string };

const DEFAULT_FAILURE_MESSAGE = '问答服务暂时不可用，请稍后重试。';

/** 只携带服务端应用文案，避免把网络异常等技术细节直接展示给顾客。 */
class ChatRequestError extends Error {}

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
        let message = DEFAULT_FAILURE_MESSAGE;
        try {
          const error = chatErrorResponseSchema.safeParse(await response.json());
          if (error.success) {
            message = error.data.message;
          }
        } catch {
          // 响应体不是约定的错误结构时保留通用文案。
        }
        throw new ChatRequestError(message);
      }

      const parsed = chatResponseSchema.parse(await response.json());
      // 即使旧请求忽略了中止信号，也不能覆盖后一次提交的结果。
      if (!controller.signal.aborted) {
        setState({ kind: 'result', question: submittedQuestion, response: parsed });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          kind: 'failed',
          question: submittedQuestion,
          message: error instanceof ChatRequestError ? error.message : DEFAULT_FAILURE_MESSAGE
        });
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
