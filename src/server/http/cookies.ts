/** 演示会话 Cookie 名称；浏览器只持有随机令牌，归属判断全部在服务端。 */
export const DEMO_SESSION_COOKIE = 'shopcare_demo_session';

/** 从 Cookie 头中读取单个值；缺失、格式异常或同名多值时不猜测。 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || undefined;
    }
  }

  return undefined;
}

/**
 * 生成 `HttpOnly`、`SameSite=Lax` 的同源 Cookie；HTTPS 部署额外加 `Secure`。
 * 令牌只用于服务端定位会话，脚本无法读取。
 */
export function serializeSessionCookie(
  name: string,
  token: string,
  options: { maxAgeSeconds: number; secure: boolean }
): string {
  const parts = [
    `${name}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAgeSeconds}`
  ];
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}
