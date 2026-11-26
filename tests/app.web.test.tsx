// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/web/App';
import type { ChatResponse } from '../src/shared/chat';

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

    expect(await screen.findByTestId('request-failed')).toHaveTextContent('请稍后重试');
    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByTestId('answer-text')).toHaveTextContent(answered.answer);
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
