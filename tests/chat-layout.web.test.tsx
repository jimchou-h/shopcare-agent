// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function answered(answer: string): ChatResponse {
  return {
    status: 'answered',
    answer,
    source: {
      id: 'faq-exchange-window',
      title: '换货申请期限',
      excerpt: '顾客自签收商品之日起 7 天内（含第 7 天）可提交换货申请，逾期不再受理。',
      version: '2026-11-26.1'
    },
    mode: 'preset'
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('聊天式页面布局', () => {
  it('消息按对话顺序追加，输入区固定在消息列表之后并继续可用', async () => {
    const responses = [answered('第一次回答。'), answered('第二次回答。')];
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
    const input = screen.getByLabelText('你的问题');

    expect(screen.getByTestId('chat-page')).toBeInTheDocument();
    expect(screen.getByTestId('conversation')).toHaveAttribute('role', 'log');

    await user.type(input, '换货期限是多久？');
    await user.click(screen.getByRole('button', { name: '查询' }));
    expect(await screen.findByText('第一次回答。')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, '退货期限是多久？');
    await user.click(screen.getByRole('button', { name: '查询' }));
    expect(await screen.findByText('第二次回答。')).toBeInTheDocument();

    // 历史消息保留并按提交顺序排列。
    const userMessages = screen.getAllByTestId('user-message');
    expect(userMessages.map((node) => node.textContent)).toEqual([
      '换货期限是多久？',
      '退货期限是多久？'
    ]);
    expect(
      userMessages[0]!.compareDocumentPosition(userMessages[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getAllByTestId('answer-text')).toHaveLength(2);

    // 输入区位于消息列表之后，发送后仍可继续输入。
    const conversation = screen.getByTestId('conversation');
    const composer = screen.getByTestId('composer');
    expect(conversation.parentElement).toBe(composer.parentElement);
    expect(composer.parentElement?.lastElementChild).toBe(composer);
    expect(within(composer).getByLabelText('你的问题')).toBe(input);
    expect(within(composer).getByRole('button', { name: '查询' })).toBeInTheDocument();
    expect(input).toHaveValue('退货期限是多久？');
  });

  it('输入、发送和消息卡片由 antd 组件渲染', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/demo/session') {
          return { ok: true, json: async () => claimed };
        }
        return { ok: true, json: async () => answered('由组件库渲染的回答。') };
      })
    );

    render(<App />);
    const user = userEvent.setup();
    const composer = screen.getByTestId('composer');

    const input = within(composer).getByLabelText('你的问题');
    const submit = within(composer).getByRole('button', { name: '查询' });
    expect(input).toHaveClass('ant-input');
    expect(submit).toHaveClass('ant-btn');

    await user.type(input, '换货期限是多久？');
    await user.click(submit);

    const answer = await screen.findByTestId('assistant-answer');
    expect(answer).toHaveClass('ant-card');
    expect(within(composer).getByRole('button', { name: '换货期限是多久？' })).toHaveClass(
      'ant-btn'
    );
  });

  it('发送请求期间按钮具有可访问的禁用语义', async () => {
    let resolveChat: (value: unknown) => void = () => undefined;
    const pendingChat = new Promise((resolve) => {
      resolveChat = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/demo/session') {
          return { ok: true, json: async () => claimed };
        }
        return pendingChat;
      })
    );

    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('你的问题');
    await user.type(input, '换货期限是多久？');

    const submit = screen.getByRole('button', { name: '查询' });
    await user.click(submit);

    // 请求未完成时按钮必须带原生 disabled，键盘和读屏都能识别为不可操作。
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('disabled');

    resolveChat({ ok: true, json: async () => answered('请求完成。') });
    expect(await screen.findByText('请求完成。')).toBeInTheDocument();
    await waitFor(() => expect(submit).toBeEnabled());
  });
});
