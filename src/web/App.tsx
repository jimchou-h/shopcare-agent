import { useEffect, type FormEvent } from 'react';
import type { ChatMode } from '../shared/chat';
import { useChat } from './chat/use-chat';

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

export function App() {
  const { draft, setDraft, state, submit, retry } = useChat();

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
            aria-invalid={state.kind === 'invalid'}
            aria-describedby={state.kind === 'invalid' ? 'question-error' : undefined}
          />
          <button className="ask__submit" type="submit" disabled={state.kind === 'pending'}>
            {state.kind === 'pending' ? '查询中…' : '查询'}
          </button>
        </div>
        {state.kind === 'invalid' && (
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
        {state.kind === 'idle' && (
          <p className="hint">提交问题后，这里会显示回答与对应出处。</p>
        )}
        {state.kind === 'pending' && <p className="hint">正在查找可支持回答的政策依据…</p>}
        {state.kind === 'result' && state.response.status === 'answered' && (
          <article className="answer">
            <p className="answer__mode" data-testid="answer-mode">
              {modeLabel(state.response.mode)}
            </p>
            <p className="answer__question" data-testid="answer-question">{state.question}</p>
            <p className="answer__text" data-testid="answer-text">{state.response.answer}</p>
            <div className="source" data-testid="answer-source">
              <p className="source__heading">
                政策依据 · <span data-testid="source-title">{state.response.source.title}</span>
              </p>
              <blockquote data-testid="source-excerpt">{state.response.source.excerpt}</blockquote>
              <p className="source__meta">
                FAQ {state.response.source.id} · 语料版本 {state.response.source.version}
              </p>
            </div>
          </article>
        )}
        {state.kind === 'result' && state.response.status === 'insufficient_evidence' && (
          <article className="answer answer--guide" data-testid="insufficient">
            {state.response.mode && (
              <p className="answer__mode" data-testid="answer-mode">
                {modeLabel(state.response.mode)}
              </p>
            )}
            <p className="answer__eyebrow">需要补充信息</p>
            <p className="answer__text" data-testid="insufficient-message">
              {state.response.message}
            </p>
          </article>
        )}
        {state.kind === 'failed' && (
          <article className="answer answer--muted" data-testid="request-failed">
            <p className="answer__eyebrow">未完成的问题</p>
            <p className="answer__failed-question" data-testid="failed-question">{state.question}</p>
            <p className="answer__text" data-testid="failure-message">{state.message}</p>
            <button className="retry" type="button" onClick={retry}>重试</button>
          </article>
        )}
      </section>
    </main>
  );
}
