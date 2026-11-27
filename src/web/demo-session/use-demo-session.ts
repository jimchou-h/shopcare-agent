import { useEffect, useRef, useState } from 'react';
import {
  demoSessionErrorSchema,
  demoSessionResponseSchema,
  type DemoOrder
} from '../../shared/orders';

export type DemoSessionState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'claimed'; order: DemoOrder }
  | { kind: 'failed'; message: string };

const DEFAULT_FAILURE_MESSAGE = '领取示例订单失败，请稍后重试。';

class DemoSessionRequestError extends Error {}

/**
 * 领取或复用当前浏览器的演示会话。
 *
 * Cookie 由服务端通过响应头下发，页面不读取令牌；重复领取同一有效会话会得到
 * 同一笔订单。请求进行中禁止再次触发，失败时保留可重试的提示。
 */
export function useDemoSession() {
  const [state, setState] = useState<DemoSessionState>({ kind: 'idle' });
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  async function claimOrder() {
    if (state.kind === 'pending') {
      return;
    }

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setState({ kind: 'pending' });

    try {
      const response = await fetch('/api/demo/session', {
        method: 'POST',
        // 显式发送 JSON，避免代理或客户端附加其他 Content-Type 时被服务端拒绝。
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: controller.signal
      });

      if (!response.ok) {
        let message = DEFAULT_FAILURE_MESSAGE;
        try {
          const error = demoSessionErrorSchema.safeParse(await response.json());
          if (error.success) {
            message = error.data.message;
          }
        } catch {
          // 响应体不是约定的错误结构时保留通用文案。
        }
        throw new DemoSessionRequestError(message);
      }

      const parsed = demoSessionResponseSchema.parse(await response.json());
      if (!controller.signal.aborted) {
        setState({ kind: 'claimed', order: parsed.order });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          kind: 'failed',
          message:
            error instanceof DemoSessionRequestError ? error.message : DEFAULT_FAILURE_MESSAGE
        });
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  }

  return {
    state,
    claim() {
      void claimOrder();
    }
  };
}
