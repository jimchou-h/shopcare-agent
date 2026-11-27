import type { FastifyRequest } from 'fastify';

/** 预览代理或开发工具可能在本机回环地址之间转发，三者视为同一台机器。 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function parseHost(host: string): { hostname: string; port: string } | null {
  try {
    const url = new URL(`http://${host}`);
    return { hostname: url.hostname.toLowerCase(), port: url.port };
  } catch {
    return null;
  }
}

/**
 * 同端口下的 localhost / 127.0.0.1 / ::1 可能因代理改写 Host 而不同名，
 * 但仍在同一台机器上；其他主机名必须完全一致。
 */
function isEquivalentHost(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }

  const a = parseHost(left);
  const b = parseHost(right);
  if (!a || !b || a.port !== b.port) {
    return false;
  }

  return LOOPBACK_HOSTS.has(a.hostname) && LOOPBACK_HOSTS.has(b.hostname);
}

/**
 * 判定请求是否来自页面自身同源。
 *
 * 浏览器发起的写操作会带 `Origin` 或 `Sec-Fetch-Site`；两者存在时必须是同源，
 * 防止其他站点借默认携带的演示 Cookie 改变会话状态。没有这些头的服务端调用
 * （例如健康检查或命令行冒烟）保持兼容。
 */
export function isTrustedSameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (typeof origin === 'string') {
    const host = request.headers.host;
    if (typeof host !== 'string') {
      return false;
    }
    try {
      return isEquivalentHost(new URL(origin).host, host);
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
