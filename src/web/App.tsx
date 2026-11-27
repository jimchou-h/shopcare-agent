import { useEffect, type FormEvent } from 'react';
import type { ChatMode, ChatResponse } from '../shared/chat';
import { useChat } from './chat/use-chat';
import { useDemoSession } from './demo-session/use-demo-session';
import { ExchangePanel, ApplicationReceipt, SourceList } from './exchange/exchange-panel';
import { ExchangeSummaryCard } from './exchange/exchange-summary';

const EXAMPLE_QUESTIONS = ['换货期限是多久？', '我收到货以后几天内还能申请换货？'];

/** 页面必须让顾客看出本轮是预置、模型生成还是降级答复。 */
function modeLabel(mode?: ChatMode): string {
  if (mode === 'generated') {
    return 'DeepSeek 生成';
  }
  if (mode === 'fallback') {
    return '降级为预置答复';
  }
  return '预置演示';
}

type ExchangeFlow = Extract<ChatResponse, { status: 'exchange_flow' }>;

function ExchangeFlowMessage({
  response,
  onSend,
  onClaim,
  claimPending
}: {
  response: ExchangeFlow;
  onSend: (question: string) => void;
  onClaim: () => void;
  claimPending: boolean;
}) {
  switch (response.outcome) {
    case 'step':
      return (
        <article className="answer" data-testid="exchange-step">
          <p className="answer__mode">换货办理 · 本地引导</p>
          <p className="chat__meta">示例订单 · {response.orderId}</p>
          <p className="answer__text" data-testid="exchange-step-message">
            {response.message}
          </p>
          <div className="chat__options">
            {response.options.map((option) => (
              <button
                className="examples__item"
                type="button"
                key={option}
                onClick={() => onSend(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <p className="chat__hint">回复「继续换货」恢复当前步骤，回复「取消换货」结束办理。</p>
        </article>
      );
    case 'summary':
      return (
        <ExchangeSummaryCard
          confirmationId={response.confirmationId}
          summary={response.summary}
        />
      );
    case 'ineligible':
      return (
        <article className="answer answer--guide" data-testid="exchange-ineligible">
          <p className="answer__eyebrow">暂不能申请换货</p>
          <p className="answer__text" data-testid="exchange-flow-message">
            {response.message}
          </p>
          <SourceList sources={response.sources} />
        </article>
      );
    case 'already_submitted':
      return (
        <article className="answer" data-testid="exchange-flow-message">
          <p className="answer__text">{response.message}</p>
          <ApplicationReceipt application={response.application} />
        </article>
      );
    case 'cancelled':
    case 'notice':
      return (
        <article className="answer answer--guide" data-testid="exchange-notice">
          <p className="answer__text" data-testid="exchange-flow-message">
            {response.message}
          </p>
        </article>
      );
    case 'session_required':
      return (
        <article className="answer answer--guide" data-testid="exchange-notice">
          <p className="answer__text">{response.message}</p>
          <button className="retry" type="button" onClick={onClaim} disabled={claimPending}>
            去领取示例订单
          </button>
        </article>
      );
  }
}

function AssistantMessage({
  question,
  response,
  onSend,
  onClaim,
  claimPending
}: {
  question: string;
  response: ChatResponse;
  onSend: (question: string) => void;
  onClaim: () => void;
  claimPending: boolean;
}) {
  if (response.status === 'answered') {
    return (
      <article className="answer">
        <p className="answer__mode" data-testid="answer-mode">
          {modeLabel(response.mode)}
        </p>
        <p className="answer__question" data-testid="answer-question">{question}</p>
        <p className="answer__text" data-testid="answer-text">{response.answer}</p>
        <div className="source" data-testid="answer-source">
          <p className="source__heading">
            政策依据 · <span data-testid="source-title">{response.source.title}</span>
          </p>
          <blockquote data-testid="source-excerpt">{response.source.excerpt}</blockquote>
          <p className="source__meta">
            FAQ {response.source.id} · 语料版本 {response.source.version}
          </p>
        </div>
      </article>
    );
  }

  if (response.status === 'insufficient_evidence') {
    return (
      <article className="answer answer--guide" data-testid="insufficient">
        {response.mode && (
          <p className="answer__mode" data-testid="answer-mode">
            {modeLabel(response.mode)}
          </p>
        )}
        <p className="answer__eyebrow">需要补充信息</p>
        <p className="answer__text" data-testid="insufficient-message">
          {response.message}
        </p>
      </article>
    );
  }

  if (response.status === 'order_query') {
    if (response.outcome === 'found') {
      return (
        <article className="order" data-testid="order-card">
          <p className="answer__mode">示例订单 · 本地查询</p>
          <p className="order__id" data-testid="order-id">{response.order.orderId}</p>
          <dl className="order__meta">
            <div>
              <dt>商品</dt>
              <dd data-testid="order-product">{response.order.productName}</dd>
            </div>
            <div>
              <dt>订单状态</dt>
              <dd data-testid="order-status">{response.order.status}</dd>
            </div>
          </dl>
          <ExchangePanel
            key={response.order.orderId}
            order={response.order}
            application={response.exchange}
          />
        </article>
      );
    }

    return (
      <article className="answer answer--guide" data-testid="order-guidance">
        <p className="answer__eyebrow">订单查询</p>
        <p className="answer__text" data-testid="order-message">
          {response.message}
        </p>
        {response.outcome === 'session_required' && (
          <button className="retry" type="button" onClick={onClaim} disabled={claimPending}>
            去领取示例订单
          </button>
        )}
      </article>
    );
  }

  return (
    <ExchangeFlowMessage
      response={response}
      onSend={onSend}
      onClaim={onClaim}
      claimPending={claimPending}
    />
  );
}

export function App() {
  const { draft, setDraft, status, messages, submit, retry, send } = useChat();
  const demoSession = useDemoSession();
  const claimedOrder = demoSession.state.kind === 'claimed' ? demoSession.state.order : null;
  const claimPending = demoSession.state.kind === 'pending';

  useEffect(() => {
    try {
      // 旧版凭证只按名称移除，迁移过程无需读取它的值。
      window.localStorage.removeItem('shopcare:deepseek-key');
    } catch {
      // 禁用浏览器存储的环境也能正常使用预置问答。
    }
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">ShopCare</p>
        <h1>售后政策助手</h1>
        <p className="lede">
          输入售后问题，查看结论和它依据的政策原文。演示使用合成示例数据。
        </p>
      </header>

      <section className="demo" aria-label="示例订单">
        <div>
          <p className="demo__title">示例订单</p>
          <p className="demo__hint">
            {demoSession.state.kind === 'claimed'
              ? `已领取 ${demoSession.state.order.orderId} · ${demoSession.state.order.productName}`
              : '领取一笔合成示例订单后，可以直接查询它的状态。'}
          </p>
          {demoSession.state.kind === 'failed' && (
            <p className="ask__error" role="alert">
              {demoSession.state.message}
            </p>
          )}
        </div>
        <div className="demo__actions">
          {claimedOrder && (
            <button
              className="retry"
              type="button"
              onClick={() => setDraft(`查订单 ${claimedOrder.orderId}`)}
            >
              查询示例订单
            </button>
          )}
          <button
            className="claim"
            type="button"
            onClick={demoSession.claim}
            disabled={claimPending}
          >
            {claimPending
              ? '领取中…'
              : demoSession.state.kind === 'failed'
                ? '重试领取'
                : demoSession.state.kind === 'claimed'
                  ? '再次领取'
                  : '领取示例订单'}
          </button>
        </div>
      </section>

      <form className="ask" onSubmit={handleSubmit} aria-label="售后问题表单">
        <label className="ask__label" htmlFor="question">
          你的问题
        </label>
        <div className="ask__row">
          <input
            id="question"
            name="question"
            className="ask__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="例如：换货期限是多久？"
            autoComplete="off"
            aria-invalid={status === 'invalid'}
            aria-describedby={status === 'invalid' ? 'question-error' : undefined}
          />
          <button className="ask__submit" type="submit" disabled={status === 'pending'}>
            {status === 'pending' ? '查询中…' : '查询'}
          </button>
        </div>
        {status === 'invalid' && (
          <p className="ask__error" id="question-error" role="alert">
            请输入售后问题。
          </p>
        )}
        <div className="examples">
          <span>试试：</span>
          {EXAMPLE_QUESTIONS.map((example) => (
            <button
              className="examples__item"
              type="button"
              key={example}
              onClick={() => setDraft(example)}
            >
              {example}
            </button>
          ))}
        </div>
      </form>

      <section className="conversation" aria-live="polite">
        {messages.length === 0 && status === 'idle' && (
          <p className="hint">提交问题后，这里会显示回答与对应出处。</p>
        )}
        {messages.map((message) => (
          <div className="chat__turn" key={message.id}>
            {message.role === 'user' && (
              <p className="chat__user" data-testid="user-message">{message.text}</p>
            )}
            {message.role === 'failure' && (
              <article className="answer answer--muted" data-testid="request-failed">
                <p className="answer__eyebrow">未完成的问题</p>
                <p className="answer__failed-question" data-testid="failed-question">
                  {message.question}
                </p>
                <p className="answer__text" data-testid="failure-message">{message.message}</p>
                <button className="retry" type="button" onClick={retry}>重试</button>
              </article>
            )}
            {message.role === 'assistant' && (
              <AssistantMessage
                question={message.question}
                response={message.response}
                onSend={send}
                onClaim={demoSession.claim}
                claimPending={claimPending}
              />
            )}
          </div>
        ))}
        {status === 'pending' && <p className="hint">正在查找可支持回答的政策依据…</p>}
      </section>
    </main>
  );
}
