// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/web/App';
import type { ChatResponse } from '../src/shared/chat';
import type { ExchangePreviewResponse } from '../src/shared/exchange';
import type { FaqSource } from '../src/shared/faq';
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

const VERSION = '2026-11-26.1';

const windowSource: FaqSource = {
  id: 'faq-exchange-window',
  title: '换货申请期限',
  excerpt: '顾客自签收商品之日起 7 天内（含第 7 天）可提交换货申请，逾期不再受理。',
  version: VERSION
};

const conditionSource: FaqSource = {
  id: 'faq-exchange-condition',
  title: '换货需要满足的条件',
  excerpt: '申请换货的商品应保持完好，配件、赠品及原包装齐全；已影响二次销售的商品不支持换货。',
  version: VERSION
};

const shippingSource: FaqSource = {
  id: 'faq-exchange-shipping',
  title: '换货的运费由谁承担',
  excerpt: '因商品质量问题发起的换货，往返运费由商家承担；非质量原因发起的换货，寄回运费由顾客承担。',
  version: VERSION
};

const eligiblePreview: ExchangePreviewResponse = {
  status: 'exchange_preview',
  outcome: 'eligible',
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
    sources: [windowSource, conditionSource, shippingSource]
  }
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

interface FetchRoutes {
  preview: (body: Record<string, unknown>) => unknown | Promise<unknown>;
}

function mockFetch(routes: FetchRoutes) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/demo/session') {
      return jsonResponse(claimed);
    }
    if (url === '/api/chat') {
      return jsonResponse(orderFound);
    }
    if (url === '/api/exchange/preview') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse(await routes.preview(body));
    }
    throw new Error(`未预期的请求：${url}`);
  });
}

/** 领取示例订单、查询并停在订单卡片上。 */
async function openOrderCard(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: '领取示例订单' }));
  await user.click(await screen.findByRole('button', { name: '查询示例订单' }));
  await user.click(screen.getByRole('button', { name: '查询' }));
  await screen.findByTestId('order-card');

  return user;
}

function fillDeclaration(user: ReturnType<typeof userEvent.setup>) {
  return Promise.all([
    user.click(screen.getByLabelText('商品完好')),
    user.click(screen.getByLabelText('配件齐全')),
    user.click(screen.getByLabelText('原包装齐全且不影响二次销售'))
  ]);
}

describe('顾客在订单卡片申请换货', () => {
  it('填写原因与申报后展示待确认摘要、运费说明和三类政策出处', async () => {
    const fetchMock = mockFetch({ preview: () => eligiblePreview });
    const user = await openOrderCard(fetchMock);

    await user.click(screen.getByRole('button', { name: '申请换货' }));
    await fillDeclaration(user);
    await user.click(screen.getByRole('button', { name: '预览换货' }));

    expect(await screen.findByTestId('exchange-summary')).toBeInTheDocument();
    expect(screen.getByTestId('exchange-reason-label')).toHaveTextContent('质量问题');
    expect(screen.getByTestId('exchange-shipping')).toHaveTextContent('往返运费由商家承担');
    expect(screen.getByText('换货申请期限')).toBeInTheDocument();
    expect(screen.getByText('换货需要满足的条件')).toBeInTheDocument();
    expect(screen.getByText('换货的运费由谁承担')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/exchange/preview',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          orderId: demoOrder.orderId,
          reason: 'quality',
          declaration: {
            itemIntact: true,
            accessoriesComplete: true,
            originalPackaging: true,
            giftComplete: false
          }
        })
      })
    );
  });

  it('选择其他原因时携带 other 并展示顾客承担运费', async () => {
    const otherPreview: ExchangePreviewResponse = {
      ...eligiblePreview,
      summary: {
        ...eligiblePreview.summary,
        reason: 'other',
        reasonLabel: '其他原因',
        shipping: {
          borneBy: 'customer',
          note: '非质量原因的换货，寄回运费由顾客承担。'
        }
      }
    } as ExchangePreviewResponse;
    const fetchMock = mockFetch({ preview: () => otherPreview });
    const user = await openOrderCard(fetchMock);

    await user.click(screen.getByRole('button', { name: '申请换货' }));
    await user.click(screen.getByLabelText('其他原因'));
    await fillDeclaration(user);
    await user.click(screen.getByRole('button', { name: '预览换货' }));

    expect(await screen.findByTestId('exchange-reason-label')).toHaveTextContent('其他原因');
    expect(screen.getByTestId('exchange-shipping')).toHaveTextContent('寄回运费由顾客承担');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/exchange/preview',
      expect.objectContaining({
        body: expect.stringContaining('"reason":"other"')
      })
    );
  });

  it('不符合条件时展示原因与对应政策，且不出现待确认摘要', async () => {
    const ineligible: ExchangePreviewResponse = {
      status: 'exchange_preview',
      outcome: 'ineligible',
      reason: 'condition_not_met',
      message: '商品需保持完好，配件、赠品及原包装齐全且不影响二次销售才能申请换货。',
      sources: [conditionSource]
    };
    const fetchMock = mockFetch({ preview: () => ineligible });
    const user = await openOrderCard(fetchMock);

    await user.click(screen.getByRole('button', { name: '申请换货' }));
    await user.click(screen.getByRole('button', { name: '预览换货' }));

    expect(await screen.findByTestId('exchange-ineligible')).toHaveTextContent(
      '商品需保持完好'
    );
    expect(screen.getByText('换货需要满足的条件')).toBeInTheDocument();
    expect(screen.queryByTestId('exchange-summary')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新核对' })).toBeInTheDocument();
  });

  it('预览失败后重试发送同一份申报', async () => {
    let attempts = 0;
    const fetchMock = mockFetch({
      preview: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError('network down');
        }
        return eligiblePreview;
      }
    });
    const user = await openOrderCard(fetchMock);

    await user.click(screen.getByRole('button', { name: '申请换货' }));
    await fillDeclaration(user);
    await user.click(screen.getByRole('button', { name: '预览换货' }));

    expect(await screen.findByTestId('exchange-failed')).toHaveTextContent('请稍后重试');

    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByTestId('exchange-summary')).toBeInTheDocument();

    const previewCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/exchange/preview');
    expect(previewCalls).toHaveLength(2);
    expect(previewCalls[0]?.[1]?.body).toBe(previewCalls[1]?.[1]?.body);
  });
});
