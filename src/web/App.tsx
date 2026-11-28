import { useEffect, type FormEvent } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Empty,
  Flex,
  Input,
  Space,
  Spin,
  Tag,
  Typography
} from 'antd';
import type { ChatMode, ChatResponse, ExchangeFlowAction } from '../shared/chat';
import { useChat } from './chat/use-chat';
import { useDemoSession } from './demo-session/use-demo-session';
import {
  ApplicationReceipt,
  ExchangeSummaryCard,
  SourceList
} from './exchange/exchange-message';

const EXAMPLE_QUESTIONS = ['换货期限是多久？', '我收到货以后几天内还能申请换货？'];

/** 服务端把本次 CSP nonce 写入页面；antd 注入的运行时样式需要携带同一值。 */
function readCspNonce(): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  return document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content || undefined;
}

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
  onAction,
  onClaim,
  claimPending
}: {
  response: ExchangeFlow;
  onSend: (question: string) => void;
  onAction: (action: ExchangeFlowAction, label: string) => void;
  onClaim: () => void;
  claimPending: boolean;
}) {
  switch (response.outcome) {
    case 'step': {
      const step = response;
      // 按钮提交绑定本轮步骤的交互标识；标识缺失时才退回文本，兼容旧响应。
      function selectOption(option: string) {
        if (!step.interactionId) {
          onSend(option);
          return;
        }
        if (step.step === 'reason') {
          onAction(
            {
              type: 'exchange_reason',
              interactionId: step.interactionId,
              value: option === '质量问题' ? 'quality' : 'other'
            },
            option
          );
          return;
        }
        onAction(
          {
            type: 'exchange_declaration',
            interactionId: step.interactionId,
            value: option === '齐全' ? 'complete' : 'incomplete'
          },
          option
        );
      }

      return (
        <Card size="small" data-testid="exchange-step">
          <Typography.Text type="secondary">换货办理 · 本地引导</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ margin: '4px 0 8px' }}>
            示例订单 · {step.orderId}
          </Typography.Paragraph>
          <Typography.Paragraph strong data-testid="exchange-step-message" style={{ marginBottom: 8 }}>
            {step.message}
          </Typography.Paragraph>
          <Space wrap>
            {step.options.map((option) => (
              <Button key={option} size="small" onClick={() => selectOption(option)}>
                {option}
              </Button>
            ))}
          </Space>
          <Typography.Paragraph type="secondary" style={{ margin: '10px 0 0', fontSize: 12 }}>
            回复「继续换货」恢复当前步骤，回复「取消换货」结束办理。
          </Typography.Paragraph>
        </Card>
      );
    }
    case 'summary':
      return (
        <ExchangeSummaryCard
          confirmationId={response.confirmationId}
          summary={response.summary}
        />
      );
    case 'ineligible':
      return (
        <Flex vertical gap={8} data-testid="exchange-ineligible">
          <Alert
            type="warning"
            showIcon
            title="暂不能申请换货"
            description={<span data-testid="exchange-flow-message">{response.message}</span>}
          />
          <SourceList sources={response.sources} />
        </Flex>
      );
    case 'already_submitted':
      return (
        <Flex vertical gap={8} data-testid="exchange-flow-message">
          <Typography.Text>{response.message}</Typography.Text>
          <ApplicationReceipt application={response.application} />
        </Flex>
      );
    case 'cancelled':
    case 'notice':
      return (
        <Alert
          type="warning"
          showIcon
          data-testid="exchange-notice"
          title={<span data-testid="exchange-flow-message">{response.message}</span>}
        />
      );
    case 'session_required':
      return (
        <Alert
          type="warning"
          showIcon
          data-testid="exchange-notice"
          title={response.message}
          action={
            <Button size="small" onClick={onClaim} loading={claimPending}>
              去领取示例订单
            </Button>
          }
        />
      );
  }
}

function AssistantMessage({
  question,
  response,
  onSend,
  onAction,
  onClaim,
  claimPending
}: {
  question: string;
  response: ChatResponse;
  onSend: (question: string) => void;
  onAction: (action: ExchangeFlowAction, label: string) => void;
  onClaim: () => void;
  claimPending: boolean;
}) {
  if (response.status === 'answered') {
    return (
      <Card size="small" data-testid="assistant-answer">
        <Space size={6} wrap style={{ marginBottom: 8 }}>
          <Tag color="green" data-testid="answer-mode">
            {modeLabel(response.mode)}
          </Tag>
          <Typography.Text type="secondary" data-testid="answer-question">
            你问：{question}
          </Typography.Text>
        </Space>
        <Typography.Paragraph strong data-testid="answer-text" style={{ fontSize: 16 }}>
          {response.answer}
        </Typography.Paragraph>
        <div data-testid="answer-source">
          <Typography.Text strong>政策依据</Typography.Text>
          <div style={{ marginTop: 8 }}>
            <SourceList sources={[response.source]} />
          </div>
        </div>
      </Card>
    );
  }

  if (response.status === 'insufficient_evidence') {
    return (
      <Alert
        type="warning"
        showIcon
        data-testid="insufficient"
        title={
          <Space size={6} wrap>
            {response.mode && (
              <Tag data-testid="answer-mode">{modeLabel(response.mode)}</Tag>
            )}
            <span>需要补充信息</span>
          </Space>
        }
        description={<span data-testid="insufficient-message">{response.message}</span>}
      />
    );
  }

  if (response.status === 'blocked') {
    return (
      <Alert
        type="warning"
        showIcon
        data-testid="guardrail-blocked"
        title={
          <span data-testid="guardrail-message">{response.message}</span>
        }
      />
    );
  }

  if (response.status === 'order_query') {
    if (response.outcome === 'found') {
      return (
        <Card size="small" data-testid="order-card">
          <Space size={8} wrap style={{ marginBottom: 12 }}>
            <Typography.Text strong style={{ fontSize: 18 }} data-testid="order-id">
              {response.order.orderId}
            </Typography.Text>
            <Tag color="green" data-testid="order-status">
              {response.order.status}
            </Tag>
          </Space>
          <Descriptions
            size="small"
            column={1}
            items={[
              {
                key: 'product',
                label: '商品',
                children: <span data-testid="order-product">{response.order.productName}</span>
              }
            ]}
          />
          <div style={{ marginTop: 12 }}>
            {response.exchange ? (
              <ApplicationReceipt application={response.exchange} />
            ) : (
              <Typography.Text type="secondary">
                回复「我想换货」可在对话里继续办理换货。
              </Typography.Text>
            )}
          </div>
        </Card>
      );
    }

    return (
      <Alert
        type="warning"
        showIcon
        data-testid="order-guidance"
        title="订单查询"
        description={<span data-testid="order-message">{response.message}</span>}
        action={
          response.outcome === 'session_required' ? (
            <Button size="small" onClick={onClaim} loading={claimPending}>
              去领取示例订单
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <ExchangeFlowMessage
      response={response}
      onSend={onSend}
      onAction={onAction}
      onClaim={onClaim}
      claimPending={claimPending}
    />
  );
}

function FailureMessage({
  message,
  onRetry
}: {
  message: { question: string; message: string };
  onRetry: () => void;
}) {
  return (
    <Alert
      type="error"
      showIcon
      data-testid="request-failed"
      title="未完成的问题"
      description={
        <Flex vertical gap={6}>
          <Typography.Text strong data-testid="failed-question">
            {message.question}
          </Typography.Text>
          <span data-testid="failure-message">{message.message}</span>
          <div>
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          </div>
        </Flex>
      }
    />
  );
}

export function App() {
  const { draft, setDraft, status, messages, submit, retry, send, sendAction } = useChat();
  const demoSession = useDemoSession();
  const cspNonce = readCspNonce();
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

  const claimLabel = claimPending
    ? '领取中…'
    : demoSession.state.kind === 'failed'
      ? '重试领取'
      : demoSession.state.kind === 'claimed'
        ? '再次领取'
        : '领取示例订单';

  return (
    <ConfigProvider
      button={{ autoInsertSpace: false }}
      csp={cspNonce ? { nonce: cspNonce } : undefined}
      theme={{ token: { colorPrimary: '#0f6f5c', borderRadius: 10 } }}
    >
      <div className="chat-page" data-testid="chat-page">
        <header className="chat-header">
          <Flex align="center" justify="space-between" gap={12} wrap>
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                ShopCare 售后助手
              </Typography.Title>
              <Typography.Text type="secondary">
                输入售后问题，查看结论和它依据的政策原文。演示使用合成示例数据。
              </Typography.Text>
            </div>
            <Space wrap>
              {claimedOrder && (
                <Button onClick={() => setDraft(`查订单 ${claimedOrder.orderId}`)}>
                  查询示例订单
                </Button>
              )}
              <Button type="primary" onClick={demoSession.claim} loading={claimPending}>
                {claimLabel}
              </Button>
            </Space>
          </Flex>
          {demoSession.state.kind === 'claimed' && (
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              已领取 {demoSession.state.order.orderId} · {demoSession.state.order.productName}
            </Typography.Text>
          )}
          {demoSession.state.kind === 'failed' && (
            <Alert type="error" showIcon title={demoSession.state.message} style={{ marginTop: 8 }} />
          )}
        </header>

        <div className="chat-body">
          <div
            className="chat-messages"
            data-testid="conversation"
            role="log"
            aria-live="polite"
          >
            {messages.length === 0 && status === 'idle' && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="提交问题后，这里会显示回答与对应出处。"
              />
            )}
            {messages.map((message) => (
              <div
                className={`msg-row${message.role === 'user' ? ' msg-row--user' : ''}`}
                key={message.id}
              >
                {message.role !== 'user' && (
                  <Avatar className="msg-avatar" size={32}>
                    AI
                  </Avatar>
                )}
                <div className="msg-content">
                  {message.role === 'user' && (
                    <div className="msg-bubble" data-testid="user-message">
                      {message.text}
                    </div>
                  )}
                  {message.role === 'assistant' && (
                    <AssistantMessage
                      question={message.question}
                      response={message.response}
                      onSend={send}
                      onAction={sendAction}
                      onClaim={demoSession.claim}
                      claimPending={claimPending}
                    />
                  )}
                  {message.role === 'failure' && (
                    <FailureMessage
                      message={message}
                      onRetry={retry}
                    />
                  )}
                </div>
              </div>
            ))}
            {status === 'pending' && (
              <Flex align="center" gap={8}>
                <Spin size="small" />
                <Typography.Text type="secondary">
                  正在查找可支持回答的政策依据…
                </Typography.Text>
              </Flex>
            )}
          </div>

          <div className="chat-composer" data-testid="composer">
            <form onSubmit={handleSubmit} aria-label="售后问题表单">
              <Flex gap={8}>
                <Input
                  id="question"
                  name="question"
                  aria-label="你的问题"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="例如：换货期限是多久？"
                  autoComplete="off"
                  status={status === 'invalid' ? 'error' : undefined}
                  aria-describedby={status === 'invalid' ? 'question-error' : undefined}
                />
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={status === 'pending'}
                  disabled={status === 'pending'}
                >
                  查询
                </Button>
              </Flex>
              {status === 'invalid' && (
                <Alert
                  type="error"
                  showIcon
                  id="question-error"
                  title="请输入售后问题。"
                  style={{ marginTop: 8 }}
                />
              )}
              <Space wrap size={4} style={{ marginTop: 8 }}>
                <Typography.Text type="secondary">试试：</Typography.Text>
                {EXAMPLE_QUESTIONS.map((example) => (
                  <Button
                    key={example}
                    size="small"
                    onClick={() => setDraft(example)}
                  >
                    {example}
                  </Button>
                ))}
              </Space>
            </form>
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}
