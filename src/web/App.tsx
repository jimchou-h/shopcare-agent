import { useState, type FormEvent } from 'react';
import { chatResponseSchema, type ChatResponse } from '../shared/chat';

type ViewState =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | { kind: 'pending' }
  | { kind: 'answered'; question: string; response: Extract<ChatResponse, { status: 'answered' }> }
  | {
      kind: 'insufficient';
      question: string;
      response: Extract<ChatResponse, { status: 'insufficient_evidence' }>;
    }
  | { kind: 'failed'; question: string };

const EXAMPLE_QUESTIONS = ['换货期限是多久？', '我收到货以后几天内还能申请换货？'];

export function App() {
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<ViewState>({ kind: 'idle' });

  async function askQuestion(value: string) {
    const trimmed = value.trim();
    // 页面先拦住空白输入，避免把必然失败的请求发到服务端。
    if (trimmed.length === 0) {
      setState({ kind: 'invalid', message: '请输入售后问题。' });
      return;
    }

    setState({ kind: 'pending' });

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed })
      });

      if (!response.ok) {
        setState({ kind: 'failed', question: trimmed });
        return;
      }

      // 把响应当外部输入校验：HTTP 200 但结构不符时按失败处理，避免渲染缺少出处的回答。
      const parsed = chatResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setState({ kind: 'failed', question: trimmed });
        return;
      }

      const data = parsed.data;
      if (data.status === 'answered') {
        setState({ kind: 'answered', question: trimmed, response: data });
      } else {
        setState({ kind: 'insufficient', question: trimmed, response: data });
      }
    } catch {
      // 记录本次实际提交的问题，重试时不受输入框后续编辑影响。
      setState({ kind: 'failed', question: trimmed });
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void askQuestion(question);
  }

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">ShopCare</p>
        <h1>售后政策助手</h1>
        <p className="lede">
          输入售后问题，查看结论和它依据的政策原文。演示使用合成示例数据，不涉及真实订单。
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
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
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
            {state.message}
          </p>
        )}
        <div className="examples">
          <span>试试：</span>
          {EXAMPLE_QUESTIONS.map((example) => (
            <button
              className="examples__item"
              type="button"
              key={example}
              onClick={() => setQuestion(example)}
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

        {state.kind === 'answered' && (
          <article className="answer">
            <p className="answer__question" data-testid="answer-question">
              {state.question}
            </p>
            <p className="answer__text" data-testid="answer-text">
              {state.response.answer}
            </p>
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

        {state.kind === 'insufficient' && (
          <article className="answer answer--guide" data-testid="insufficient">
            <p className="answer__eyebrow">需要补充信息</p>
            <p className="answer__text" data-testid="insufficient-message">
              {state.response.message}
            </p>
          </article>
        )}

        {state.kind === 'failed' && (
          <article className="answer answer--muted" data-testid="request-failed">
            <p className="answer__text">问答服务暂时不可用，请稍后重试。</p>
            <button
              className="retry"
              type="button"
              onClick={() => void askQuestion(state.question)}
            >
              重试
            </button>
          </article>
        )}
      </section>
    </main>
  );
}
