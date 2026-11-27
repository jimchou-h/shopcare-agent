import { randomBytes } from 'node:crypto';

declare module 'fastify' {
  interface FastifyRequest {
    /** 本次响应的 CSP nonce，与页面 meta 和 antd 注入的 <style> 保持一致。 */
    cspNonce: string;
  }
}

/** 每次响应生成独立 nonce，避免固定值被注入内容复用。 */
export function createCspNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * 构建页面与接口共用的 CSP。
 *
 * - `script-src` 只允许同源脚本，不放宽内联或 eval。
 * - 支持 CSP3 的浏览器只允许携带 nonce 的 `<style>`，antd 运行时样式通过
 *   ConfigProvider 的 csp.nonce 注入同一 nonce。
 * - antd 与 React 使用行内 style 属性控制尺寸和间距，因此只对样式属性放开
 *   `'unsafe-inline'`；`style-src` 中的 `'unsafe-inline'` 仅作为旧浏览器回退。
 */
export function buildContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
}

/** 把 nonce 写入页面 head，前端读取后交给 antd 的样式注入器。 */
export function injectCspNonce(html: string, nonce: string): string {
  const meta = `<meta name="csp-nonce" content="${nonce}" />`;
  return html.includes('<head>')
    ? html.replace('<head>', `<head>\n    ${meta}`)
    : `${meta}\n${html}`;
}
