import type { FastifyInstance } from 'fastify';
import {
  chatRequestSchema,
  type ChatErrorResponse
} from '../../shared/chat.js';
import type { DeploymentMode } from '../config.js';
import type { DeepSeekGenerator } from '../deepseek/client.js';
import type { DemoRepository } from '../demo-session/repository.js';
import { hashSessionToken } from '../demo-session/token.js';
import { DEMO_SESSION_COOKIE, readCookie } from '../http/cookies.js';
import type { RateLimiter } from '../http/rate-limit.js';
import { isTrustedSameOrigin } from '../http/same-origin.js';
import { handleOrderQuestion } from '../orders/query.js';
import { ChatUpstreamError, answerChatQuestion } from './answer-question.js';

export interface ChatRouteDeps {
  mode: DeploymentMode;
  generate?: DeepSeekGenerator;
  repository: DemoRepository;
  rateLimiter: RateLimiter;
  now?: () => number;
}

export function registerChatRoute(app: FastifyInstance, deps: ChatRouteDeps): void {
  const now = deps.now ?? Date.now;

  app.post('/api/chat', async (request, reply) => {
    if (!deps.rateLimiter.consume(request.ip)) {
      const limited: ChatErrorResponse = {
        status: 'rate_limited',
        message: '请求过于频繁，请稍后重试。'
      };
      return reply.code(429).send(limited);
    }

    if (!isTrustedSameOrigin(request)) {
      const forbidden: ChatErrorResponse = {
        status: 'forbidden',
        message: '请求来源不受信任。'
      };
      return reply.code(403).send(forbidden);
    }

    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error: ChatErrorResponse = {
        status: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? '请求格式不正确，请提供 question 字段。'
      };
      return reply.code(400).send(error);
    }

    // 响应来源由服务端确定，浏览器提交的字段无法改变部署模式或开启新的调用路径。
    const token = readCookie(request.headers.cookie, DEMO_SESSION_COOKIE);
    const tokenHash = token ? hashSessionToken(token) : undefined;
    const currentTime = now();

    // 查单先于 FAQ 和模型分发；命中后不再发起任何外部生成请求。
    const orderResult = handleOrderQuestion(parsed.data.question, {
      repository: deps.repository,
      tokenHash,
      now: currentTime
    });
    if (orderResult) {
      return orderResult;
    }

    // 明确的新话题结束待补状态，避免下一轮单独的单号被误消费。
    if (tokenHash) {
      deps.repository.setPending(tokenHash, false, currentTime);
    }

    try {
      return await answerChatQuestion(parsed.data.question, deps);
    } catch (error) {
      if (error instanceof ChatUpstreamError) {
        const body: ChatErrorResponse = {
          status: 'upstream_error',
          message: '生成服务暂时不可用，请稍后重试。'
        };
        return reply.code(502).send(body);
      }
      throw error;
    }
  });
}
