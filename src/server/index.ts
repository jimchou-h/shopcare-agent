import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
// 构建产物由 Vite 输出到 dist/web，生产环境由 Fastify 同源提供，
// 避免前后端跨域并确保页面和 API 使用同一个访问地址。
const webRoot = fileURLToPath(new URL('../web', import.meta.url));

const app = buildApp();

await app.register(fastifyStatic, {
  root: webRoot,
  index: ['index.html']
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
