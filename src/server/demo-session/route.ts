import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DEMO_SESSION_COOKIE, readCookie, serializeSessionCookie } from '../http/cookies.js';
import { isTrustedSameOrigin } from '../http/same-origin.js';
import {
  DEFAULT_SESSION_TTL_MS,
  type DemoRepository
} from './repository.js';
import { createSessionToken, hashSessionToken } from './token.js';

export interface DemoSessionRouteDeps {
  repository: DemoRepository;
  ttlMs?: number;
  now?: () => number;
}

function isSecureRequest(request: FastifyRequest): boolean {
  return (
    request.protocol === 'https' ||
    request.headers['x-forwarded-proto'] === 'https'
  );
}

/**
 * 领取示例订单：创建或复用当前浏览器的演示会话，并把会话绑定到一笔合成订单。
 * 同源校验在读取或写入任何 Cookie 之前完成，外部页面不能借已有 Cookie 建立新会话。
 */
export function registerDemoSessionRoute(
  app: FastifyInstance,
  deps: DemoSessionRouteDeps
): void {
  const ttlMs = deps.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const now = deps.now ?? Date.now;

  app.post('/api/demo/session', async (request, reply) => {
    if (!isTrustedSameOrigin(request)) {
      return reply.code(403).send({
        status: 'forbidden',
        message: '请求来源不受信任。'
      });
    }

    const existingToken = readCookie(request.headers.cookie, DEMO_SESSION_COOKIE);
    const token = existingToken ?? createSessionToken();
    const claimed = deps.repository.claimSession(hashSessionToken(token), now());

    // 首次领取或旧令牌已过期时重新下发 Cookie；有效会话重复领取不延长固定有效期。
    if (!existingToken || claimed.created) {
      reply.header(
        'set-cookie',
        serializeSessionCookie(DEMO_SESSION_COOKIE, token, {
          maxAgeSeconds: Math.floor(ttlMs / 1000),
          secure: isSecureRequest(request)
        })
      );
    }

    return {
      status: 'claimed',
      order: {
        orderId: claimed.order.orderId,
        productName: claimed.order.productName,
        status: claimed.order.status
      }
    };
  });
}
