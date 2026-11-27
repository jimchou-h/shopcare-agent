import type { FastifyInstance } from 'fastify';
import {
  exchangeConfirmRequestSchema,
  exchangePreviewRequestSchema,
  type ExchangeConfirmResponse,
  type ExchangePreviewResponse
} from '../../shared/exchange.js';
import type { DemoRepository } from '../demo-session/repository.js';
import { hashSessionToken } from '../demo-session/token.js';
import { DEMO_SESSION_COOKIE, readCookie } from '../http/cookies.js';
import type { RateLimiter } from '../http/rate-limit.js';
import { isTrustedSameOrigin } from '../http/same-origin.js';
import { evaluateExchangeEligibility, type ExchangeIneligibleReason } from './eligibility.js';
import { EXCHANGE_MESSAGES } from './messages.js';
import {
  exchangeEligibilitySources,
  exchangeReasonLabel,
  exchangeShippingNotice,
  exchangeSummarySources
} from './policies.js';

export interface ExchangeRouteDeps {
  repository: DemoRepository;
  rateLimiter: RateLimiter;
  now?: () => number;
}

const INELIGIBLE_MESSAGES: Record<ExchangeIneligibleReason, string> = {
  not_signed: EXCHANGE_MESSAGES.notSigned,
  overdue: EXCHANGE_MESSAGES.overdue,
  condition_not_met: EXCHANGE_MESSAGES.conditionNotMet
};

const CONFIRM_MESSAGES = {
  expired: EXCHANGE_MESSAGES.expired,
  superseded: EXCHANGE_MESSAGES.superseded,
  invalid_confirmation: EXCHANGE_MESSAGES.invalidConfirmation,
  not_found: EXCHANGE_MESSAGES.notFound
} as const;

/**
 * 换货预览：核对当前访客的订单资格，并生成待确认摘要。
 *
 * 归属、签收与期限全部由服务端判断，页面提交的原因和申报只作为业务输入；
 * 请求通过同源与限流检查后才读取 Cookie。
 */
export function registerExchangeRoute(
  app: FastifyInstance,
  deps: ExchangeRouteDeps
): void {
  const now = deps.now ?? Date.now;

  app.post('/api/exchange/preview', async (request, reply) => {
    if (!deps.rateLimiter.consume(request.ip)) {
      return reply.code(429).send({
        status: 'rate_limited',
        message: EXCHANGE_MESSAGES.rateLimited
      });
    }

    if (!isTrustedSameOrigin(request)) {
      return reply.code(403).send({
        status: 'forbidden',
        message: EXCHANGE_MESSAGES.forbidden
      });
    }

    const parsed = exchangePreviewRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        status: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? EXCHANGE_MESSAGES.invalidRequest
      });
    }

    try {
      const currentTime = now();
      const token = readCookie(request.headers.cookie, DEMO_SESSION_COOKIE);
      const tokenHash = token ? hashSessionToken(token) : undefined;
      const session = tokenHash ? deps.repository.findSession(tokenHash, currentTime) : null;
      if (!session || !tokenHash) {
        const body: ExchangePreviewResponse = {
          status: 'exchange_preview',
          outcome: 'session_required',
          message: EXCHANGE_MESSAGES.sessionRequired
        };
        return body;
      }

      // 越界订单与不存在订单返回同一结果，避免泄露其他访客的单号。
      const order = deps.repository.findOrder(session.visitorId, parsed.data.orderId);
      if (!order) {
        const body: ExchangePreviewResponse = {
          status: 'exchange_preview',
          outcome: 'not_found',
          message: EXCHANGE_MESSAGES.notFound
        };
        return body;
      }

      // 同一订单只保留一笔申请，已受理时直接返回原回执。
      const existingApplication = deps.repository.findExchangeApplication(
        session.visitorId,
        order.orderId
      );
      if (existingApplication) {
        const body: ExchangePreviewResponse = {
          status: 'exchange_preview',
          outcome: 'already_submitted',
          application: existingApplication
        };
        return body;
      }

      const eligibility = evaluateExchangeEligibility({
        signedAt: order.signedAt,
        now: currentTime,
        declaration: parsed.data.declaration
      });
      if (!eligibility.eligible) {
        const body: ExchangePreviewResponse = {
          status: 'exchange_preview',
          outcome: 'ineligible',
          reason: eligibility.reason,
          message: INELIGIBLE_MESSAGES[eligibility.reason],
          sources: exchangeEligibilitySources(eligibility.reason)
        };
        return body;
      }

      const preview = deps.repository.replacePreview({
        tokenHash,
        visitorId: session.visitorId,
        orderId: order.orderId,
        reason: parsed.data.reason,
        declaration: parsed.data.declaration,
        now: currentTime
      });

      const body: ExchangePreviewResponse = {
        status: 'exchange_preview',
        outcome: 'eligible',
        confirmationId: preview.confirmationId,
        expiresAt: preview.expiresAt,
        summary: {
          orderId: order.orderId,
          productName: order.productName,
          reason: parsed.data.reason,
          reasonLabel: exchangeReasonLabel(parsed.data.reason),
          shipping: exchangeShippingNotice(parsed.data.reason),
          sources: exchangeSummarySources()
        }
      };
      return body;
    } catch (error) {
      // 存储不可用等内部错误返回稳定结构，页面可以展示可重试文案。
      request.log.error({ err: error }, '换货预览失败');
      return reply.code(503).send({
        status: 'unavailable',
        message: EXCHANGE_MESSAGES.unavailable
      });
    }
  });

  /**
   * 换货确认：请求只携带确认标识，服务端在同一事务中复核摘要与资格后写入申请。
   *
   * 同一确认重复或并发提交返回原申请；跨来源请求在读取 Cookie 前就被拒绝，
   * 不会消耗顾客的待确认摘要。
   */
  app.post('/api/exchange/confirm', async (request, reply) => {
    if (!deps.rateLimiter.consume(request.ip)) {
      return reply.code(429).send({
        status: 'rate_limited',
        message: EXCHANGE_MESSAGES.rateLimited
      });
    }

    if (!isTrustedSameOrigin(request)) {
      return reply.code(403).send({
        status: 'forbidden',
        message: EXCHANGE_MESSAGES.forbidden
      });
    }

    const parsed = exchangeConfirmRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        status: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? EXCHANGE_MESSAGES.invalidRequest
      });
    }

    try {
      const currentTime = now();
      const token = readCookie(request.headers.cookie, DEMO_SESSION_COOKIE);
      const tokenHash = token ? hashSessionToken(token) : undefined;
      const session = tokenHash ? deps.repository.findSession(tokenHash, currentTime) : null;
      if (!session || !tokenHash) {
        const body: ExchangeConfirmResponse = {
          status: 'exchange_application',
          outcome: 'session_required',
          message: EXCHANGE_MESSAGES.sessionRequired
        };
        return body;
      }

      const result = deps.repository.confirmExchange({
        tokenHash,
        visitorId: session.visitorId,
        confirmationId: parsed.data.confirmationId,
        now: currentTime
      });

      if (result.outcome === 'submitted') {
        const body: ExchangeConfirmResponse = {
          status: 'exchange_application',
          outcome: 'submitted',
          application: result.application
        };
        return body;
      }

      if (result.outcome === 'ineligible') {
        const body: ExchangeConfirmResponse = {
          status: 'exchange_application',
          outcome: 'ineligible',
          reason: result.reason,
          message: INELIGIBLE_MESSAGES[result.reason],
          sources: exchangeEligibilitySources(result.reason)
        };
        return body;
      }

      const body: ExchangeConfirmResponse = {
        status: 'exchange_application',
        outcome: result.outcome,
        message: CONFIRM_MESSAGES[result.outcome]
      };
      return body;
    } catch (error) {
      request.log.error({ err: error }, '换货确认失败');
      return reply.code(503).send({
        status: 'unavailable',
        message: EXCHANGE_MESSAGES.unavailable
      });
    }
  });
}
