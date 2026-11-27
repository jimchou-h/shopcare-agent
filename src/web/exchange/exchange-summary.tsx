import { useState } from 'react';
import {
  exchangeConfirmResponseSchema,
  exchangeErrorResponseSchema,
  type ExchangeApplication,
  type ExchangeSummary
} from '../../shared/exchange';
import type { FaqSource } from '../../shared/faq';
import { ApplicationReceipt, SourceList } from './exchange-panel';

const DEFAULT_FAILURE_MESSAGE = '换货服务暂时不可用，请稍后重试。';

type SummaryState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'submitted'; application: ExchangeApplication }
  | { kind: 'ineligible'; message: string; sources: FaqSource[] }
  | { kind: 'notice'; message: string }
  | { kind: 'failed'; message: string };

/** 只携带服务端应用文案，避免把网络异常等技术细节直接展示给顾客。 */
class SummaryRequestError extends Error {}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const parsed = exchangeErrorResponseSchema.safeParse(await response.json());
    if (parsed.success) {
      return parsed.data.message;
    }
  } catch {
    // 响应体不是约定的错误结构时保留通用文案。
  }
  return DEFAULT_FAILURE_MESSAGE;
}

/**
 * 对话消息中的待确认摘要。
 *
 * 确认只发送不带业务含义的摘要标识，订单、原因与申报由服务端摘要还原；
 * 失败时保留原确认标识供重试，重复提交由服务端幂等保证。
 */
export function ExchangeSummaryCard({
  confirmationId,
  summary
}: {
  confirmationId: string;
  summary: ExchangeSummary;
}) {
  const [state, setState] = useState<SummaryState>({ kind: 'idle' });

  async function requestConfirm() {
    setState({ kind: 'pending' });
    try {
      const response = await fetch('/api/exchange/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmationId })
      });
      if (!response.ok) {
        throw new SummaryRequestError(await readErrorMessage(response));
      }

      const parsed = exchangeConfirmResponseSchema.parse(await response.json());
      if (parsed.outcome === 'submitted') {
        setState({ kind: 'submitted', application: parsed.application });
        return;
      }
      if (parsed.outcome === 'ineligible') {
        setState({ kind: 'ineligible', message: parsed.message, sources: parsed.sources });
        return;
      }
      setState({ kind: 'notice', message: parsed.message });
    } catch (error) {
      setState({
        kind: 'failed',
        message: error instanceof SummaryRequestError ? error.message : DEFAULT_FAILURE_MESSAGE
      });
    }
  }

  if (state.kind === 'submitted') {
    return <ApplicationReceipt application={state.application} />;
  }

  if (state.kind === 'ineligible') {
    return (
      <div className="answer answer--guide" data-testid="exchange-ineligible">
        <p className="answer__eyebrow">暂不能申请换货</p>
        <p className="answer__text">{state.message}</p>
        <SourceList sources={state.sources} />
      </div>
    );
  }

  if (state.kind === 'notice' || state.kind === 'failed') {
    return (
      <div className="answer answer--muted" data-testid="exchange-notice">
        <p className="answer__text">{state.message}</p>
        {state.kind === 'failed' && (
          <button className="retry" type="button" onClick={() => void requestConfirm()}>
            重试
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="exchange__summary" data-testid="exchange-summary">
      <p className="exchange__title">待确认的换货申请</p>
      <dl className="order__meta">
        <div>
          <dt>订单号</dt>
          <dd>{summary.orderId}</dd>
        </div>
        <div>
          <dt>商品</dt>
          <dd>{summary.productName}</dd>
        </div>
        <div>
          <dt>换货原因</dt>
          <dd data-testid="exchange-reason-label">{summary.reasonLabel}</dd>
        </div>
      </dl>
      <p className="exchange__shipping" data-testid="exchange-shipping">
        {summary.shipping.note}
      </p>
      <SourceList sources={summary.sources} />
      <div className="exchange__actions">
        <button
          className="ask__submit"
          type="button"
          disabled={state.kind === 'pending'}
          onClick={() => void requestConfirm()}
        >
          {state.kind === 'pending' ? '提交中…' : '确认提交'}
        </button>
      </div>
    </div>
  );
}
