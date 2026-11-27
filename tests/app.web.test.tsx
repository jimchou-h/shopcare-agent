// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/web/App';
import type { ChatResponse } from '../src/shared/chat';
import type { DemoSessionResponse } from '../src/shared/orders';

const answered: ChatResponse = {
  status: 'answered',
  answer: '顾客自签收商品之日起 7 天内可以申请换货。',
  source: {
    id: 'faq-exchange-window',
    title: '换货申请期限',
    excerpt: '顾客自签收商品之日起 7 天内（含第 7 天）可提交换货申请，逾期不再受理。',
    version: '2026-11-26.1'
  }
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('顾客问答页面', () => {
  it('升级后清理旧 Key，访客直接用同源预置问答', async () => {
    const legacyKey = 'shopcare:deepseek-key';
    const otherKey = 'shopcare:unrelated-preference';
    localStorage.setItem(legacyKey, 'legacy-test-key');
    localStorage.setItem(otherKey, 'keep');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...answered, mode: 'preset' })
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<App />);
      expect(localStorage.getItem(legacyKey)).toBeNull();
      expect(localStorage.getItem(otherKey)).toBe('keep');
      expect(screen.queryByLabelText('DeepSeek API Key')).not.toBeInTheDocument();

      const user = userEvent.setup();
      await user.type(screen.getByLabelText('你的问题'), '换货期限是多久？');
      await user.click(screen.getByRole('button', { name: '查询' }));

      expect(await screen.findByTestId('answer-mode')).toHaveTextContent('预置演示');
      expect(screen.getByTestId('source-title')).toHaveTextContent('换货申请期限');
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        '/api/chat',
        expect.objectContaining({ method: 'POST', body: '{"question":"换货期限是多久？"}' })
      );
    } finally {
      localStorage.removeItem(legacyKey);
      localStorage.removeItem(otherKey);
    }
  });

  it.each(['换货期限是多久？', '我收到货以后几天内还能申请换货？'])(
    '展示「%s」的结论与出处',
    async (question) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => answered
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<App />);
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('你的问题'), question);
      await user.click(screen.getByRole('button', { name: '查询' }));

      expect(await screen.findByTestId('answer-text')).toHaveTextContent(answered.answer);
      expect(screen.getByTestId('source-title')).toHaveTextContent(answered.source.title);
      expect(screen.getByTestId('source-excerpt')).toHaveTextContent(answered.source.excerpt);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/chat',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ question })
        })
      );
    }
  );

  it('证据不足时显示补充引导且不显示出处', async () => {
    const insufficient: ChatResponse = {
      status: 'insufficient_evidence',
      message: '没有找到与这个问题对应的政策说明。请补充涉及的商品、时间或具体诉求。'
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => insufficient
      })
    );

    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('你的问题'), '会员积分怎么兑换？');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('insufficient-message')).toHaveTextContent(
      insufficient.message
    );
    expect(screen.getByText('需要补充信息')).toBeInTheDocument();
    expect(screen.queryByTestId('answer-source')).not.toBeInTheDocument();
    expect(screen.queryByText(/政策依据/)).not.toBeInTheDocument();
  });

  it('空白输入被页面拒绝，修正后可提交', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => answered
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('你的问题');

    await user.type(input, '   ');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('请输入售后问题。');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '换货期限是多久？');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('answer-text')).toHaveTextContent(answered.answer);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('服务异常时保留原问题并支持重试成功', async () => {
    const question = '换货期限是多久？';
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => answered
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('你的问题');

    await user.type(input, question);
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('request-failed')).toHaveTextContent('请稍后重试');
    expect(input).toHaveValue(question);

    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByTestId('answer-text')).toHaveTextContent(answered.answer);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('服务返回错误状态时提示重试', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({})
      })
    );

    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('你的问题'), '换货期限是多久？');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('request-failed')).toHaveTextContent('请稍后重试');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('展示服务端返回的可重试错误文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({
          status: 'upstream_error',
          message: '生成服务暂时不可用，请稍后重试。'
        })
      })
    );

    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('你的问题'), '换货期限是多久？');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('failure-message')).toHaveTextContent(
      '生成服务暂时不可用，请稍后重试。'
    );
    expect(screen.queryByTestId('answer-source')).not.toBeInTheDocument();
  });

  it.each([
    { mode: 'generated', label: 'DeepSeek 生成', answer: '模型生成的换货期限正文。' },
    { mode: 'fallback', label: '降级为预置答复', answer: answered.answer }
  ])('回答来源标记为「$label」', async ({ mode, label, answer }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...answered, answer, mode })
      })
    );

    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('你的问题'), '换货期限是多久？');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('answer-mode')).toHaveTextContent(label);
    expect(screen.getByTestId('answer-text')).toHaveTextContent(answer);
    expect(screen.getByTestId('source-title')).toHaveTextContent(answered.source.title);
  });

  it('编辑草稿不会改变旧回答对应的问题', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => answered
      })
    );

    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('你的问题');

    await user.type(input, '换货期限是多久？');
    await user.click(screen.getByRole('button', { name: '查询' }));
    expect(await screen.findByTestId('answer-question')).toHaveTextContent('换货期限是多久？');

    await user.clear(input);
    await user.type(input, '退货期限是多久？');

    expect(screen.getByTestId('answer-question')).toHaveTextContent('换货期限是多久？');
    expect(screen.getByTestId('answer-question')).not.toHaveTextContent('退货期限是多久？');
  });

  it('结构不完整的回答显示重试提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'answered', answer: '缺少出处' })
      })
    );

    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('你的问题'), '换货期限是多久？');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('request-failed')).toHaveTextContent('请稍后重试');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.queryByTestId('answer-text')).not.toBeInTheDocument();
  });

  it('重试发送失败请求的原问题，而不是等待期间编辑的草稿', async () => {
    const originalQuestion = '换货期限是多久？';
    let rejectFirst!: (reason?: unknown) => void;
    const firstAttempt = new Promise<never>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => answered
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('你的问题');

    await user.type(input, originalQuestion);
    await user.click(screen.getByRole('button', { name: '查询' }));

    await user.clear(input);
    await user.type(input, '退货期限是多久？');

    rejectFirst(new TypeError('network down'));

    expect(await screen.findByTestId('request-failed')).toHaveTextContent('未完成的问题');
    // 失败卡片展示实际提交的问题，输入框保留顾客后来编辑的草稿。
    expect(screen.getByTestId('failed-question')).toHaveTextContent(originalQuestion);
    expect(input).toHaveValue('退货期限是多久？');

    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByTestId('answer-text')).toHaveTextContent(answered.answer);
    expect(input).toHaveValue('退货期限是多久？');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/chat',
      expect.objectContaining({ body: JSON.stringify({ question: originalQuestion }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/chat',
      expect.objectContaining({ body: JSON.stringify({ question: originalQuestion }) })
    );
  });
});

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

function mockOrderFetch(chatResponse: ChatResponse) {
  return vi.fn(async (url: string) => {
    if (url === '/api/demo/session') {
      return { ok: true, json: async () => claimed };
    }
    return { ok: true, json: async () => chatResponse };
  });
}

describe('顾客在问答页查单', () => {
  it('领取示例订单后用快捷操作查询，页面展示单号、商品和状态', async () => {
    const fetchMock = mockOrderFetch(orderFound);
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '领取示例订单' }));

    expect(await screen.findByText(`已领取 ${demoOrder.orderId} · ${demoOrder.productName}`)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查询示例订单' }));
    expect(screen.getByLabelText('你的问题')).toHaveValue(`查订单 ${demoOrder.orderId}`);

    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('order-id')).toHaveTextContent(demoOrder.orderId);
    expect(screen.getByTestId('order-product')).toHaveTextContent(demoOrder.productName);
    expect(screen.getByTestId('order-status')).toHaveTextContent('已签收');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ question: `查订单 ${demoOrder.orderId}` })
      })
    );
  });

  it('没有会话时展示领取引导并可直接领取', async () => {
    const fetchMock = mockOrderFetch({
      status: 'order_query',
      outcome: 'session_required',
      message: '请先领取示例订单，再查询订单状态。'
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('你的问题'), '查订单 SC-AB12CD34EF56');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('order-message')).toHaveTextContent(
      '请先领取示例订单，再查询订单状态。'
    );

    await user.click(screen.getByRole('button', { name: '去领取示例订单' }));
    expect(await screen.findByText(`已领取 ${demoOrder.orderId} · ${demoOrder.productName}`)).toBeInTheDocument();
  });

  it('查无结果时展示提示且不出现订单卡片', async () => {
    vi.stubGlobal(
      'fetch',
      mockOrderFetch({
        status: 'order_query',
        outcome: 'not_found',
        message: '未找到可查询的订单。'
      })
    );

    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('你的问题'), '查订单 SC-ZZZZZZZZZZZZ');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('order-message')).toHaveTextContent('未找到可查询的订单。');
    expect(screen.queryByTestId('order-card')).not.toBeInTheDocument();
  });

  it('领取失败时展示可重试的提示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ status: 'unavailable', message: '领取服务暂时不可用，请稍后重试。' })
      })
    );

    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '领取示例订单' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('领取服务暂时不可用，请稍后重试。');
    expect(screen.getByRole('button', { name: '领取示例订单' })).toBeEnabled();
  });
});
