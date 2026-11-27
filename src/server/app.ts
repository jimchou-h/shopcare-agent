import Fastify, { type FastifyInstance } from 'fastify';
import { registerChatRoute } from './chat/route.js';
import { ConfigError, type ServerConfig } from './config.js';
import { createDeepSeekClient, type DeepSeekGenerator } from './deepseek/client.js';
import { FAQ_CORPUS, FAQ_CORPUS_VERSION } from './faq/corpus.js';
import { findCorpusProblems } from './faq/validate.js';

/** 生产页面与问答接口同源，浏览器无需连接模型服务。 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

export interface BuildAppOptions {
  /** 部署模式；测试可直接注入，生产由 index.ts 从环境变量解析。 */
  config?: ServerConfig;
  /** 受控替身；未提供且处于真实模式时使用官方客户端。 */
  generate?: DeepSeekGenerator;
}

/**
 * 创建 Fastify 应用。测试直接调用 `inject` 验证 HTTP 行为，
 * 生产入口只在返回的实例上补充静态资源注册。
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? { chatMode: 'preset' };
  const app = Fastify({ logger: false });

  let generate = options.generate;
  if (config.chatMode === 'deepseek' && !generate) {
    if (!config.deepseekApiKey) {
      throw new ConfigError('真实模式缺少必填环境变量 DEEPSEEK_API_KEY。');
    }
    generate = createDeepSeekClient({ apiKey: config.deepseekApiKey });
  }

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
    return payload;
  });

  // 就绪意味着服务能读取到可支撑带出处回答的语料；这里不暴露具体缺项。
  app.get('/healthz', async (_request, reply) => {
    if (findCorpusProblems(FAQ_CORPUS).length > 0) {
      return reply.code(503).send({ status: 'unavailable' });
    }

    return {
      status: 'ok',
      faq: {
        version: FAQ_CORPUS_VERSION,
        entries: FAQ_CORPUS.length
      }
    };
  });

  registerChatRoute(app, { mode: config.chatMode, generate });
  return app;
}
