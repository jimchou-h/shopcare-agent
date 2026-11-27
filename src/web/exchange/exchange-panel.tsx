import { useState, type FormEvent } from 'react';
import {
  exchangeConfirmResponseSchema,
  exchangeErrorResponseSchema,
  exchangePreviewResponseSchema,
  type ExchangeApplication,
  type ExchangeDeclaration,
  type ExchangePreviewRequest,
  type ExchangePreviewResponse,
  type ExchangeReason
} from '../../shared/exchange';
import type { FaqSource } from '../../shared/faq';
import type { DemoOrder } from '../../shared/orders';

const DEFAULT_FAILURE_MESSAGE = '换货服务暂时不可用，请稍后重试。';

const EMPTY_DECLARATION: ExchangeDeclaration = {
  itemIntact: false,
  accessoriesComplete: false,
  originalPackaging: false,
  giftComplete: false
};

type EligiblePreview = Extract<ExchangePreviewResponse, { outcome: 'eligible' }>;

type PanelState =
  | { kind: 'closed' }
  | { kind: 'form' }
  | { kind: 'pending'; action: 'preview' | 'confirm' }
  | { kind: 'preview'; confirmationId: string; summary: EligiblePreview['summary'] }
  | { kind: 'ineligible'; message: string; sources: FaqSource[] }
  | { kind: 'notice'; message: string }
  | { kind: 'submitted'; application: ExchangeApplication }
  | { kind: 'failed'; action: 'preview' | 'confirm'; message: string };

/** 只携带服务端应用文案，避免把网络异常等技术细节直接展示给顾客。 */
class ExchangeRequestError extends Error {}

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

const DECLARATION_FIELDS: Array<{ field: keyof ExchangeDeclaration; label: string }> = [
  { field: 'itemIntact', label: '商品完好' },
  { field: 'accessoriesComplete', label: '配件齐全' },
  { field: 'originalPackaging', label: '原包装齐全且不影响二次销售' },
  { field: 'giftComplete', label: '赠品齐全（如订单含赠品）' }
];

function SourceList({ sources }: { sources: FaqSource[] }) {
  return (
    <div className="exchange__sources" data-testid="exchange-sources">
      <p className="source__heading">政策依据</p>
      {sources.map((source) => (
        <div className="source" key={source.id}>
          <p className="source__heading">{source.title}</p>
          <blockquote>{source.excerpt}</blockquote>
          <p className="source__meta">
            FAQ {source.id} · 语料版本 {source.version}
          </p>
        </div>
      ))}
    </div>
  );
}

function ApplicationReceipt({ application }: { application: ExchangeApplication }) {
  return (
    <p className="exchange__receipt" data-testid="exchange-receipt">
      换货申请已提交 · <span data-testid="exchange-application-id">{application.applicationId}</span>
    </p>
  );
}

/**
 * 订单卡片内的换货入口。
 *
 * 页面只收集换货原因和商品申报，资格、期限和运费说明全部以服务端预览结果为准；
 * 输入改动后必须重新预览，确认标识只对当前摘要有效。
 */
export function ExchangePanel({
  order,
  application
}: {
  order: DemoOrder;
  application?: ExchangeApplication;
}) {
  const [state, setState] = useState<PanelState>(
    application ? { kind: 'submitted', application } : { kind: 'closed' }
  );
  const [reason, setReason] = useState<ExchangeReason>('quality');
  const [declaration, setDeclaration] = useState<ExchangeDeclaration>(EMPTY_DECLARATION);
  const [lastPreview, setLastPreview] = useState<ExchangePreviewRequest | null>(null);
  const [lastConfirmationId, setLastConfirmationId] = useState<string | null>(null);

  async function requestPreview(payload: ExchangePreviewRequest) {
    setState({ kind: 'pending', action: 'preview' });
    try {
      const response = await fetch('/api/exchange/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new ExchangeRequestError(await readErrorMessage(response));
      }

      const parsed = exchangePreviewResponseSchema.parse(await response.json());
      switch (parsed.outcome) {
        case 'eligible':
          setState({
            kind: 'preview',
            confirmationId: parsed.confirmationId,
            summary: parsed.summary
          });
          return;
        case 'ineligible':
          setState({ kind: 'ineligible', message: parsed.message, sources: parsed.sources });
          return;
        case 'already_submitted':
          setState({ kind: 'submitted', application: parsed.application });
          return;
        default:
          setState({ kind: 'notice', message: parsed.message });
      }
    } catch (error) {
      setState({
        kind: 'failed',
        action: 'preview',
        message: error instanceof ExchangeRequestError ? error.message : DEFAULT_FAILURE_MESSAGE
      });
    }
  }

  function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: ExchangePreviewRequest = {
      orderId: order.orderId,
      reason,
      declaration
    };
    setLastPreview(payload);
    void requestPreview(payload);
  }

  /** 确认只发送摘要标识；原因与申报已由服务端摘要保存。 */
  async function requestConfirm(confirmationId: string) {
    setLastConfirmationId(confirmationId);
    setState({ kind: 'pending', action: 'confirm' });
    try {
      const response = await fetch('/api/exchange/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmationId })
      });
      if (!response.ok) {
        throw new ExchangeRequestError(await readErrorMessage(response));
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
        action: 'confirm',
        message: error instanceof ExchangeRequestError ? error.message : DEFAULT_FAILURE_MESSAGE
      });
    }
  }

  function toggleDeclaration(field: keyof ExchangeDeclaration) {
    setDeclaration((current) => ({ ...current, [field]: !current[field] }));
  }

  return (
    <section className="exchange" aria-label="换货申请">
      {state.kind === 'closed' && (
        <button
          className="claim"
          type="button"
          onClick={() => setState({ kind: 'form' })}
          data-testid="exchange-open"
        >
          申请换货
        </button>
      )}

      {state.kind === 'form' && (
        <form className="exchange__form" onSubmit={handlePreview} aria-label="换货申请表单">
          <fieldset className="exchange__fieldset">
            <legend className="exchange__legend">换货原因</legend>
            <label className="exchange__option">
              <input
                type="radio"
                name="exchange-reason"
                value="quality"
                checked={reason === 'quality'}
                onChange={() => setReason('quality')}
              />
              质量问题
            </label>
            <label className="exchange__option">
              <input
                type="radio"
                name="exchange-reason"
                value="other"
                checked={reason === 'other'}
                onChange={() => setReason('other')}
              />
              其他原因
            </label>
          </fieldset>

          <fieldset className="exchange__fieldset">
            <legend className="exchange__legend">商品现状（由顾客申报）</legend>
            {DECLARATION_FIELDS.map(({ field, label }) => (
              <label className="exchange__option" key={field}>
                <input
                  type="checkbox"
                  checked={declaration[field]}
                  onChange={() => toggleDeclaration(field)}
                />
                {label}
              </label>
            ))}
          </fieldset>

          <div className="exchange__actions">
            <button className="ask__submit" type="submit">
              预览换货
            </button>
            <button className="retry" type="button" onClick={() => setState({ kind: 'closed' })}>
              取消
            </button>
          </div>
        </form>
      )}

      {state.kind === 'pending' && (
        <p className="hint" role="status">
          {state.action === 'preview' ? '正在核对换货资格…' : '正在提交换货申请…'}
        </p>
      )}

      {state.kind === 'preview' && (
        <div className="exchange__summary" data-testid="exchange-summary">
          <p className="exchange__title">待确认的换货申请</p>
          <dl className="order__meta">
            <div>
              <dt>订单号</dt>
              <dd>{state.summary.orderId}</dd>
            </div>
            <div>
              <dt>商品</dt>
              <dd>{state.summary.productName}</dd>
            </div>
            <div>
              <dt>换货原因</dt>
              <dd data-testid="exchange-reason-label">{state.summary.reasonLabel}</dd>
            </div>
          </dl>
          <p className="exchange__shipping" data-testid="exchange-shipping">
            {state.summary.shipping.note}
          </p>
          <SourceList sources={state.summary.sources} />
          <div className="exchange__actions">
            <button
              className="ask__submit"
              type="button"
              onClick={() => void requestConfirm(state.confirmationId)}
            >
              确认提交
            </button>
            <button
              className="retry"
              type="button"
              onClick={() => setState({ kind: 'form' })}
            >
              修改信息
            </button>
          </div>
        </div>
      )}

      {state.kind === 'ineligible' && (
        <div className="answer answer--guide" data-testid="exchange-ineligible">
          <p className="answer__eyebrow">暂不能申请换货</p>
          <p className="answer__text">{state.message}</p>
          <SourceList sources={state.sources} />
          <button className="retry" type="button" onClick={() => setState({ kind: 'form' })}>
            重新核对
          </button>
        </div>
      )}

      {state.kind === 'notice' && (
        <div className="answer answer--guide" data-testid="exchange-notice">
          <p className="answer__text">{state.message}</p>
          <button className="retry" type="button" onClick={() => setState({ kind: 'form' })}>
            重新核对
          </button>
        </div>
      )}

      {state.kind === 'failed' && (
        <div className="answer answer--muted" data-testid="exchange-failed">
          <p className="answer__text">{state.message}</p>
          <button
            className="retry"
            type="button"
            onClick={() => {
              if (state.action === 'preview' && lastPreview) {
                void requestPreview(lastPreview);
              } else if (state.action === 'confirm' && lastConfirmationId) {
                void requestConfirm(lastConfirmationId);
              } else {
                setState({ kind: 'form' });
              }
            }}
          >
            重试
          </button>
        </div>
      )}

      {state.kind === 'submitted' && <ApplicationReceipt application={state.application} />}
    </section>
  );
}
