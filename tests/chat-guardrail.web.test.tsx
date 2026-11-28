// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/web/App';
import type { ChatResponse } from '../src/shared/chat';
import type { DemoSessionResponse } from '../src/shared/orders';

const BLOCKED_MESSAGE = '我可以帮你查询订单、办理换货或解答售后政策。';

const claimed: DemoSessionResponse = {
  status: 'claimed',
  order: {
    orderId: 'SC-AB12CD34EF56',
    productName: '轻量通勤双肩包',
    status: '已签收'
  }
};

function blocked(reason: 'prompt_injection' | 'off_topic'): ChatResponse {
  return { status: 'blocked', reason, message: BLOCKED_MESSAGE };
}

function answered(): ChatResponse {
  return {
    status: 'answered',
    answer: '换货期限是 7 天。',
    source: {
      id: 'faq-exchange-window',
      title: '换货申请期限',
      excerpt: '顾客自签收商品之日起 7 天内可提交换货申请。',
      version: '2026-11-26.1'
    },
    mode: 'preset'
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('输入护栏的前端展示', () => {
  it.each(['prompt_injection', 'off_topic'] as const)(
    'blocked/%s 作为助手消息展示固定提示，用户可继续咨询',
    async (reason) => {
      const responses: ChatResponse[] = [blocked(reason), answered()];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === '/api/demo/session') {
            return { ok: true, json: async () => claimed };
          }
          return { ok: true, json: async () => responses.shift() };
        })
      );

      render(<App />);
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('你的问题'), '讲个笑话');
      await user.click(screen.getByRole('button', { name: '查询' }));

      expect(await screen.findByTestId('guardrail-message')).toHaveTextContent(BLOCKED_MESSAGE);
      const composer = screen.getByTestId('composer');
      expect(within(composer).getByRole('button', { name: '查询' })).toBeEnabled();

      // 被拦截后仍可继续正常咨询。
      await user.clear(screen.getByLabelText('你的问题'));
      await user.type(screen.getByLabelText('你的问题'), '换货期限是多久？');
      await user.click(screen.getByRole('button', { name: '查询' }));
      expect(await screen.findByTestId('answer-text')).toHaveTextContent('换货期限是 7 天。');
    }
  );
});
