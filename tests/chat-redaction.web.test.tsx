// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/web/App';
import type { ChatResponse } from '../src/shared/chat';
import type { DemoSessionResponse } from '../src/shared/orders';

const claimed: DemoSessionResponse = {
  status: 'claimed',
  order: {
    orderId: 'SC-AB12CD34EF56',
    productName: '轻量通勤双肩包',
    status: '已签收'
  }
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('模型答复按服务端脱敏结果展示正文并保留政策出处', async () => {
  const response: ChatResponse = {
    status: 'answered',
    answer: '签收后 7 天内可换货，客服电话 138****5678。',
    source: {
      id: 'faq-exchange-window',
      title: '换货申请期限',
      excerpt: '顾客自签收商品之日起 7 天内可提交换货申请。',
      version: '2026-11-26.1'
    },
    mode: 'generated'
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/demo/session') {
        return { ok: true, json: async () => claimed };
      }
      return { ok: true, json: async () => response };
    })
  );

  render(<App />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('你的问题'), '换货期限是多久？');
  await user.click(screen.getByRole('button', { name: '查询' }));

  expect(await screen.findByTestId('answer-text')).toHaveTextContent('138****5678');
  expect(screen.getByTestId('answer-text')).not.toHaveTextContent('13812345678');
  expect(screen.getByTestId('answer-source')).toHaveTextContent('换货申请期限');
});
