import type { FastifyRequest } from 'fastify';

/**
 * 判定请求是否来自页面自身同源。
 *
 * 浏览器发起的写操作会带 `Origin` 或 `Sec-Fetch-Site`；两者存在时必须是严格同源，
 * 防止其他站点借默认携带的演示 Cookie 改变会话状态。没有这些头的服务端调用
 * （例如健康检查或命令行冒烟）保持兼容。
 */
export function isTrustedSameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (typeof origin === 'string') {
    try {
      return new URL(origin).host === request.headers.host;
    } catch {
      return false;
    }
  }

  const site = request.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    return false;
  }

  return true;
}
