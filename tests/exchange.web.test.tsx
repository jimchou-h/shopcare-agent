// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/web/App';
import type { ChatResponse } from '../src/shared/chat';
import type { DemoSessionResponse } from '../src/shared/orders';

const demoOrder = {
  orderId: 'SC-AB12CD34EF56',
  productName: '轻量通勤双肩包',
  status: '已签收'
};

const claimed: DemoSessionResponse = { status: 'claimed', order: demoOrder };

const orderFound: ChatResponse = {
  status: 'order_query',
  outcome: 'found',
  order: demoOrder
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockFetch(chatResponse: ChatResponse) {
  return vi.fn(async (url: string) => {
    if (url === '/api/demo/session') {
      return { ok: true, json: async () => claimed };
    }
    return { ok: true, json: async () => chatResponse };
  });
}

async function sendOrderQuery() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '领取示例订单' }));
  await user.type(screen.getByLabelText('你的问题'), `查订单 ${demoOrder.orderId}`);
  await user.click(screen.getByRole('button', { name: '查询' }));
  return user;
}

describe('订单消息不再承载换货表单', () => {
  it('查单结果展示订单信息与对话办理提示，不出现申请换货表单', async () => {
    vi.stubGlobal('fetch', mockFetch(orderFound));
    render(<App />);
    await sendOrderQuery();

    expect(await screen.findByTestId('order-card')).toBeInTheDocument();
    expect(screen.getByTestId('order-id')).toHaveTextContent(demoOrder.orderId);
    expect(screen.getByTestId('order-product')).toHaveTextContent(demoOrder.productName);
    expect(screen.getByTestId('order-status')).toHaveTextContent('已签收');
    expect(
      screen.getByText('回复「我想换货」可在对话里继续办理换货。')
    ).toBeInTheDocument();

    // 换货统一走对话状态机，订单消息中不再出现原因、申报或预览表单。
    expect(screen.queryByRole('button', { name: '申请换货' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('exchange-open')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('商品完好')).not.toBeInTheDocument();
    expect(screen.queryByText('换货原因')).not.toBeInTheDocument();
  });

  it('已提交申请的订单消息直接展示回执编号与状态', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        ...orderFound,
        exchange: { applicationId: 'EX-AB12CD34EF56', status: 'submitted' }
      })
    );
    render(<App />);
    await sendOrderQuery();

    expect(await screen.findByTestId('exchange-receipt')).toHaveTextContent('已提交');
    expect(screen.getByTestId('exchange-application-id')).toHaveTextContent(
      'EX-AB12CD34EF56'
    );
    expect(screen.queryByRole('button', { name: '申请换货' })).not.toBeInTheDocument();
  });
});
