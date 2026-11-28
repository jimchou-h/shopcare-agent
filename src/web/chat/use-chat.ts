import { useEffect, useRef, useState } from 'react';
import {
  chatErrorResponseSchema,
  chatResponseSchema,
  type ChatResponse,
  type ExchangeFlowAction
} from '../../shared/chat';

/** 一次请求要么是文本问题，要么是绑定当前步骤的结构化动作。 */
export type ChatRequestPayload =
  | { question: string }
  | { action: ExchangeFlowAction };

/** 会话区按消息顺序展示；失败消息保留原请求，便于只重试这一轮。 */
export type ChatMessage =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; question: string; response: ChatResponse }
  | {
      id: number;
      role: 'failure';
      question: string;
      payload: ChatRequestPayload;
      message: string;
    };

export type ChatStatus = 'idle' | 'invalid' | 'pending';

const DEFAULT_FAILURE_MESSAGE = '问答服务暂时不可用，请稍后重试。';

/** 只携带服务端应用文案，避免把网络异常等技术细节直接展示给顾客。 */
class ChatRequestError extends Error {}

/** 提交、编辑草稿、发送快捷回复和重试是独立操作，结果始终与实际提交的问题对应。 */
export function useChat() {
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const activeRequest = useRef<AbortController | null>(null);
  const nextId = useRef(0);

  useEffect(() => () => activeRequest.current?.abort(), []);

  async function ask(
    payload: ChatRequestPayload,
    display: string,
    options: { appendUser: boolean }
  ) {
    const submittedQuestion = display.trim();
    if (!submittedQuestion) {
      setStatus('invalid');
      return;
    }

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;

    if (options.appendUser) {
      nextId.current += 1;
      const id = nextId.current;
      setMessages((current) => [...current, { id, role: 'user', text: submittedQuestion }]);
    }
    setStatus('pending');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
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
      // 即使旧请求忽略了中止信号，也不能追加到后一次提交之后。
      if (!controller.signal.aborted) {
        nextId.current += 1;
        const id = nextId.current;
        setMessages((current) => [
          ...current,
          { id, role: 'assistant', question: submittedQuestion, response: parsed }
        ]);
        setStatus('idle');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        nextId.current += 1;
        const id = nextId.current;
        setMessages((current) => [
          ...current,
          {
            id,
            role: 'failure',
            question: submittedQuestion,
            payload,
            message: error instanceof ChatRequestError ? error.message : DEFAULT_FAILURE_MESSAGE
          }
        ]);
        setStatus('idle');
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
    status,
    messages,
    submit() {
      const question = draft.trim();
      if (!question) {
        setStatus('invalid');
        return;
      }
      void ask({ question }, question, { appendUser: true });
    },
    /** 文本快捷回复直接作为下一轮问题提交，不覆盖输入框中的草稿。 */
    send(question: string) {
      void ask({ question }, question, { appendUser: true });
    },
    /** 步骤按钮提交结构化动作；显示文本只用于会话记录。 */
    sendAction(action: ExchangeFlowAction, label: string) {
      void ask({ action }, label, { appendUser: true });
    },
    retry() {
      const failure = [...messages]
        .reverse()
        .find((message): message is Extract<ChatMessage, { role: 'failure' }> =>
          message.role === 'failure'
        );
      if (!failure) {
        return;
      }
      setMessages((current) => current.filter((message) => message.id !== failure.id));
      void ask(failure.payload, failure.question, { appendUser: false });
    }
  };
}
