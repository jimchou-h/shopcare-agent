import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app';
import {
  buildContentSecurityPolicy,
  injectCspNonce
} from '../src/server/http/csp';

function readNonce(csp: string): string | undefined {
  return /style-src-elem 'self' 'nonce-([^']+)'/.exec(csp)?.[1];
}

describe('CSP 与 antd 运行时样式', () => {
  it('每个响应使用独立 nonce，脚本仍只允许同源', async () => {
    const app = buildApp();
    try {
      const first = await app.inject({ method: 'GET', url: '/healthz' });
      const second = await app.inject({ method: 'GET', url: '/healthz' });

      const firstCsp = String(first.headers['content-security-policy']);
      const secondCsp = String(second.headers['content-security-policy']);
      const firstNonce = readNonce(firstCsp);
      const secondNonce = readNonce(secondCsp);

      expect(firstNonce).toBeTruthy();
      expect(secondNonce).toBeTruthy();
      expect(firstNonce).not.toBe(secondNonce);

      expect(firstCsp).toContain("default-src 'self'");
      expect(firstCsp).toContain("script-src 'self'");
      expect(firstCsp).not.toContain("script-src 'self' 'unsafe-inline'");
      expect(firstCsp).not.toContain('unsafe-eval');
      expect(firstCsp).not.toContain('*');
      expect(firstCsp).toContain("style-src-elem 'self' 'nonce-");
      expect(firstCsp).toContain("style-src-attr 'unsafe-inline'");
      expect(firstCsp).not.toContain('api.deepseek.com');
    } finally {
      await app.close();
    }
  });

  it('把同一 nonce 写入页面 head，供 antd 注入样式', () => {
    const html = '<!doctype html><html><head><title>ShopCare</title></head><body></body></html>';
    const withNonce = injectCspNonce(html, 'nonce-value');

    expect(withNonce).toContain('<meta name="csp-nonce" content="nonce-value" />');
    expect(withNonce.indexOf('csp-nonce')).toBeLessThan(withNonce.indexOf('<title>'));
  });

  it('策略文本中的 nonce 与页面注入值一致', () => {
    expect(buildContentSecurityPolicy('abc123')).toContain(
      "style-src-elem 'self' 'nonce-abc123'"
    );
  });
});
