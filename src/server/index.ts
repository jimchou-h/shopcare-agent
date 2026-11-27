import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildApp } from './app.js';
import { ConfigError, loadConfig, loadLocalEnv, type ServerConfig } from './config.js';
import { injectCspNonce } from './http/csp.js';

// 本地启动优先读取仓库根目录的 .env；容器或显式环境变量仍然优先。
loadLocalEnv(fileURLToPath(new URL('../../.env', import.meta.url)));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
// 构建产物由 Vite 输出到 dist/web，生产环境由 Fastify 同源提供，
// 避免前后端跨域并确保页面和 API 使用同一个访问地址。
const webRoot = fileURLToPath(new URL('../web', import.meta.url));
const indexHtmlPath = join(webRoot, 'index.html');

let config: ServerConfig;
try {
  config = loadConfig();
} catch (error) {
  // 启动期只报告缺失的变量名，不打印 Key 或完整环境变量。
  console.error(error instanceof ConfigError ? error.message : '服务配置错误。');
  process.exit(1);
}

const app = buildApp({ config });

await app.register(fastifyStatic, {
  root: webRoot,
  // 页面由下面的路由按请求注入 CSP nonce，静态插件只负责其余资源。
  index: false
});

// 直接访问 /index.html 时也注入 nonce，避免绕过页面路由导致样式被 CSP 拦截。
async function sendIndexHtml(request: FastifyRequest, reply: FastifyReply) {
  const html = await readFile(indexHtmlPath, 'utf8');
  return reply.type('text/html; charset=utf-8').send(injectCspNonce(html, request.cspNonce));
}

app.get('/', sendIndexHtml);
app.get('/index.html', sendIndexHtml);

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
