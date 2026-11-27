import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Flex, Typography } from 'antd';
import {
  exchangeConfirmResponseSchema,
  exchangeErrorResponseSchema,
  type ExchangeApplication,
  type ExchangeSummary
} from '../../shared/exchange';
import type { FaqSource } from '../../shared/faq';

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

/** 政策出处统一用 antd 卡片呈现，便于问答与换货消息复用。 */
export function SourceList({ sources }: { sources: FaqSource[] }) {
  return (
    <Flex vertical gap={8} data-testid="exchange-sources">
      {sources.map((source) => (
        <Card
          key={source.id}
          size="small"
          type="inner"
          title={<span data-testid="source-title">{source.title}</span>}
        >
          <Typography.Paragraph data-testid="source-excerpt" style={{ marginBottom: 8 }}>
            {source.excerpt}
          </Typography.Paragraph>
          <Typography.Text type="secondary">
            FAQ {source.id} · 语料版本 {source.version}
          </Typography.Text>
        </Card>
      ))}
    </Flex>
  );
}

/** 已受理的换货申请回执；消息与订单查询共用。 */
export function ApplicationReceipt({ application }: { application: ExchangeApplication }) {
  return (
    <Alert
      type="success"
      showIcon
      data-testid="exchange-receipt"
      title={
        <span>
          换货申请已提交 ·{' '}
          <span data-testid="exchange-application-id">{application.applicationId}</span>
        </span>
      }
    />
  );
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
      <Flex vertical gap={8} data-testid="exchange-ineligible">
        <Alert type="warning" showIcon title="暂不能申请换货" description={state.message} />
        <SourceList sources={state.sources} />
      </Flex>
    );
  }

  if (state.kind === 'notice' || state.kind === 'failed') {
    return (
      <Alert
        type="warning"
        showIcon
        data-testid="exchange-notice"
        title={state.message}
        action={
          state.kind === 'failed' ? (
            <Button size="small" onClick={() => void requestConfirm()}>
              重试
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <Card size="small" title="待确认的换货申请" data-testid="exchange-summary">
      <Descriptions
        size="small"
        column={1}
        items={[
          { key: 'order', label: '订单号', children: summary.orderId },
          { key: 'product', label: '商品', children: summary.productName },
          {
            key: 'reason',
            label: '换货原因',
            children: (
              <span data-testid="exchange-reason-label">{summary.reasonLabel}</span>
            )
          }
        ]}
      />
      <Alert
        type="info"
        data-testid="exchange-shipping"
        title={summary.shipping.note}
        style={{ margin: '12px 0' }}
      />
      <SourceList sources={summary.sources} />
      <Button
        type="primary"
        block
        loading={state.kind === 'pending'}
        onClick={() => void requestConfirm()}
        style={{ marginTop: 12 }}
      >
        确认提交
      </Button>
    </Card>
  );
}
