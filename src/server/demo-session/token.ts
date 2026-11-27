import { createHash, randomBytes } from 'node:crypto';

/** 会话令牌只在浏览器 Cookie 中出现；服务端只保存摘要，泄露数据库也不能还原令牌。 */
export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
