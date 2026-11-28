// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/web/App';
import type { ChatResponse } from '../src/shared/chat';
import type { FaqSource } from '../src/shared/faq';
import type { DemoSessionResponse } from '../src/shared/orders';

const demoOrder = {
  orderId: 'SC-AB12CD34EF56',
  productName: '轻量通勤双肩包',
  status: '已签收'
};

const claimed: DemoSessionResponse = { status: 'claimed', order: demoOrder };

const VERSION = '2026-11-26.1';

const sources: FaqSource[] = [
  {
    id: 'faq-exchange-window',
    title: '换货申请期限',
    excerpt: '顾客自签收商品之日起 7 天内（含第 7 天）可提交换货申请，逾期不再受理。',
    version: VERSION
  },
  {
    id: 'faq-exchange-condition',
    title: '换货需要满足的条件',
    excerpt: '申请换货的商品应保持完好，配件、赠品及原包装齐全；已影响二次销售的商品不支持换货。',
    version: VERSION
  },
  {
    id: 'faq-exchange-shipping',
    title: '换货的运费由谁承担',
    excerpt: '因商品质量问题发起的换货，往返运费由商家承担；非质量原因发起的换货，寄回运费由顾客承担。',
    version: VERSION
  }
];

const reasonStep: ChatResponse = {
  status: 'exchange_flow',
  outcome: 'step',
  step: 'reason',
  orderId: demoOrder.orderId,
  interactionId: 'interaction-reason-1',
  message: '请选择换货原因：回复「质量问题」或「其他原因」。',
  options: ['质量问题', '其他原因']
};

const declarationStep: ChatResponse = {
  status: 'exchange_flow',
  outcome: 'step',
  step: 'declaration',
  orderId: demoOrder.orderId,
  interactionId: 'interaction-declaration-1',
  reason: 'quality',
  message: '已记录换货原因：质量问题。请选择商品现状：齐全或不齐全。',
  options: ['齐全', '不齐全']
};

const summaryResponse: ChatResponse = {
  status: 'exchange_flow',
  outcome: 'summary',
  confirmationId: 'confirm-abcdefghijklmnop',
  expiresAt: 1_700_000_000_000,
  summary: {
    orderId: demoOrder.orderId,
    productName: demoOrder.productName,
    reason: 'quality',
    reasonLabel: '质量问题',
    shipping: {
      borneBy: 'merchant',
      note: '因商品质量问题换货，往返运费由商家承担。'
    },
    sources
  }
};

const submittedResponse = {
  status: 'exchange_application',
  outcome: 'submitted',
  application: { applicationId: 'EX-AB12CD34EF56', status: 'submitted' }
} as const;

const confirmNotice: ChatResponse = {
  status: 'exchange_flow',
  outcome: 'notice',
  message: '请点击摘要中的「确认提交」按钮完成申请。若需结束本次办理，请回复「取消换货」。'
};

const answered: ChatResponse = {
  status: 'answered',
  answer: '顾客自签收商品之日起 7 天内可以申请换货。',
  source: sources[0]!,
  mode: 'preset'
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function mockConversation(chatResponses: ChatResponse[]) {
  const queue = [...chatResponses];
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/demo/session') {
      return jsonResponse(claimed);
    }
    if (url === '/api/chat') {
      const next = queue.shift();
      if (!next) {
        throw new Error('测试没有为这次问答准备响应');
      }
      return jsonResponse(next);
    }
    if (url === '/api/exchange/confirm') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      expect(body.confirmationId).toBe('confirm-abcdefghijklmnop');
      return jsonResponse(submittedResponse);
    }
    throw new Error(`未预期的请求：${url}`);
  });
}

function userMessageTexts(): string[] {
  return screen.getAllByTestId('user-message').map((node) => node.textContent ?? '');
}

describe('顾客在对话里办理换货', () => {
  it('逐轮补充原因和申报，摘要展示订单、运费、出处并可确认提交', async () => {
    const fetchMock = mockConversation([reasonStep, declarationStep, summaryResponse]);
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '领取示例订单' }));
    await user.type(screen.getByLabelText('你的问题'), '我想换货');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('exchange-step-message')).toHaveTextContent('请选择换货原因');
    expect(screen.getByRole('button', { name: '质量问题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '其他原因' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '质量问题' }));

    await waitFor(() => {
      const steps = screen.getAllByTestId('exchange-step-message');
      expect(steps.at(-1)).toHaveTextContent('已记录换货原因：质量问题');
    });
    await user.click(screen.getByRole('button', { name: '齐全' }));

    expect(await screen.findByTestId('exchange-summary')).toBeInTheDocument();
    expect(screen.getByTestId('exchange-reason-label')).toHaveTextContent('质量问题');
    expect(screen.getByTestId('exchange-shipping')).toHaveTextContent('往返运费由商家承担');
    expect(screen.getByText('换货申请期限')).toBeInTheDocument();
    expect(screen.getByText('换货需要满足的条件')).toBeInTheDocument();
    expect(screen.getByText('换货的运费由谁承担')).toBeInTheDocument();

    expect(userMessageTexts()).toEqual(
      expect.arrayContaining(['我想换货', '质量问题', '齐全'])
    );

    await user.click(screen.getByRole('button', { name: '确认提交' }));

    expect(await screen.findByTestId('exchange-receipt')).toHaveTextContent('已提交');
    expect(screen.getByTestId('exchange-application-id')).toHaveTextContent('EX-AB12CD34EF56');
  });

  it('步骤按钮提交结构化动作并携带当前交互标识', async () => {
    const fetchMock = mockConversation([reasonStep, declarationStep, summaryResponse]);
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '领取示例订单' }));
    await user.type(screen.getByLabelText('你的问题'), '我想换货');
    await user.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByRole('button', { name: '质量问题' });
    await user.click(screen.getByRole('button', { name: '质量问题' }));
    await screen.findByRole('button', { name: '齐全' });
    await user.click(screen.getByRole('button', { name: '齐全' }));
    await screen.findByTestId('exchange-summary');

    const bodies = fetchMock.mock.calls
      .filter(([url]) => url === '/api/chat')
      .map(([, init]) => JSON.parse(String(init?.body)));

    // 文本输入仍走 question；步骤按钮只提交绑定标识的动作，不再发送选项文本。
    expect(bodies[0]).toEqual({ question: '我想换货' });
    expect(bodies[1]).toEqual({
      action: {
        type: 'exchange_reason',
        interactionId: 'interaction-reason-1',
        value: 'quality'
      }
    });
    expect(bodies[2]).toEqual({
      action: {
        type: 'exchange_declaration',
        interactionId: 'interaction-declaration-1',
        value: 'complete'
      }
    });
    expect(userMessageTexts()).toEqual(expect.arrayContaining(['质量问题', '齐全']));
  });

  it('等待确认时输入「确认」只显示按钮提示，不调用确认接口', async () => {
    const fetchMock = mockConversation([
      reasonStep,
      declarationStep,
      summaryResponse,
      confirmNotice
    ]);
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('你的问题');

    await user.type(input, '我想换货');
    await user.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByRole('button', { name: '质量问题' });
    await user.click(screen.getByRole('button', { name: '质量问题' }));
    await screen.findByRole('button', { name: '齐全' });
    await user.click(screen.getByRole('button', { name: '齐全' }));
    await screen.findByTestId('exchange-summary');

    await user.clear(input);
    await user.type(input, '确认');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('exchange-notice')).toHaveTextContent('确认提交');
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/exchange/confirm')
    ).toHaveLength(0);
  });

  it('办理途中插问 FAQ 后保留当前步骤，下一轮继续办理', async () => {
    vi.stubGlobal(
      'fetch',
      mockConversation([reasonStep, declarationStep, answered, summaryResponse])
    );

    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('你的问题');

    await user.type(input, '我想换货');
    await user.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByRole('button', { name: '质量问题' });
    await user.click(screen.getByRole('button', { name: '质量问题' }));
    await screen.findByRole('button', { name: '齐全' });

    await user.clear(input);
    await user.type(input, '换货期限是多久？');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByTestId('answer-text')).toHaveTextContent(answered.answer);
    expect(screen.getByTestId('source-title')).toHaveTextContent('换货申请期限');
    // 步骤消息仍在，下一轮选项继续可点。
    expect(screen.getByText(/已记录换货原因：质量问题/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '齐全' }));

    expect(await screen.findByTestId('exchange-summary')).toBeInTheDocument();
    expect(screen.getByTestId('exchange-reason-label')).toHaveTextContent('质量问题');
  });

  it('确认提交期间按钮具有可访问的禁用语义', async () => {
    let resolveConfirm: (value: unknown) => void = () => undefined;
    const pendingConfirm = new Promise((resolve) => {
      resolveConfirm = resolve;
    });
    const queue = [reasonStep, declarationStep, summaryResponse];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/demo/session') {
          return jsonResponse(claimed);
        }
        if (url === '/api/chat') {
          return jsonResponse(queue.shift());
        }
        if (url === '/api/exchange/confirm') {
          return pendingConfirm;
        }
        throw new Error(`未预期的请求：${url}`);
      })
    );

    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('你的问题');

    await user.type(input, '我想换货');
    await user.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByRole('button', { name: '质量问题' });
    await user.click(screen.getByRole('button', { name: '质量问题' }));
    await screen.findByRole('button', { name: '齐全' });
    await user.click(screen.getByRole('button', { name: '齐全' }));
    await screen.findByTestId('exchange-summary');

    const confirm = screen.getByRole('button', { name: '确认提交' });
    await user.click(confirm);

    // 确认请求未完成时按钮必须带原生 disabled，避免重复提交。
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('disabled');

    resolveConfirm(jsonResponse(submittedResponse));
    expect(await screen.findByTestId('exchange-receipt')).toHaveTextContent('已提交');
    expect(screen.getByTestId('exchange-application-id')).toHaveTextContent(
      'EX-AB12CD34EF56'
    );
  });

  it('自由文本无法判断商品现状时继续询问明确选择', async () => {
    const ineligible: ChatResponse = {
      status: 'exchange_flow',
      outcome: 'ineligible',
      reason: 'condition_not_met',
      message: '商品需保持完好，配件、赠品及原包装齐全且不影响二次销售才能申请换货。',
      sources: [sources[1]!]
    };
    const queue = [reasonStep, declarationStep, declarationStep, ineligible];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/demo/session') {
          return jsonResponse(claimed);
        }
        if (url === '/api/chat') {
          return jsonResponse(queue.shift());
        }
        throw new Error(`未预期的请求：${url}`);
      })
    );

    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText('你的问题');

    await user.type(input, '我想换货');
    await user.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByRole('button', { name: '质量问题' });
    await user.click(screen.getByRole('button', { name: '质量问题' }));
    await screen.findByRole('button', { name: '齐全' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '查询' })).toBeEnabled()
    );

    // 模糊自由文本不会生成摘要，助手继续展示二选一。
    const inputAfterStep = screen.getByLabelText('你的问题');
    await user.clear(inputAfterStep);
    await user.type(inputAfterStep, '商品不完好');
    expect(inputAfterStep).toHaveValue('商品不完好');
    await user.click(screen.getByRole('button', { name: '查询' }));
    expect(await screen.findByText('商品不完好')).toBeInTheDocument();
    // 模糊自由文本不会生成摘要，助手继续展示二选一。
    expect(screen.getAllByTestId('exchange-step-message').at(-1)).toHaveTextContent(
      '齐全或不齐全'
    );
    expect(screen.getAllByRole('button', { name: '齐全' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '不齐全' }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('exchange-summary')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: '不齐全' }).at(-1)!);
    expect(await screen.findByTestId('exchange-ineligible')).toHaveTextContent(
      '暂不能申请换货'
    );
    expect(screen.queryByTestId('exchange-summary')).not.toBeInTheDocument();
  });
});
