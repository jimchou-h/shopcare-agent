import Fastify, { type FastifyInstance } from 'fastify';
import { registerChatRoute } from './chat/route.js';
import { DEFAULT_DATABASE_PATH, ConfigError, type ServerConfig } from './config.js';
import {
  createSqliteDemoRepository,
  type DemoRepository
} from './demo-session/repository.js';
import { registerDemoSessionRoute } from './demo-session/route.js';
import { createDeepSeekClient, type DeepSeekGenerator } from './deepseek/client.js';
import { registerExchangeRoute } from './exchange/route.js';
import { FAQ_CORPUS, FAQ_CORPUS_VERSION } from './faq/corpus.js';
import { findCorpusProblems } from './faq/validate.js';
import { buildContentSecurityPolicy, createCspNonce } from './http/csp.js';
import { DEFAULT_RATE_LIMIT, createRateLimiter } from './http/rate-limit.js';

export interface BuildAppOptions {
  /** 部署模式；测试可直接注入，生产由 index.ts 从环境变量解析。 */
  config?: ServerConfig;
  /** 受控替身；未提供且处于真实模式时使用官方客户端。 */
  generate?: DeepSeekGenerator;
  /** 测试可注入持久化替身；未提供时按配置打开 SQLite。 */
  repository?: DemoRepository;
  /** 可控时钟，用于验证会话过期和容器重建后的恢复。 */
  now?: () => number;
  /** 公开接口限流参数；测试可调小窗口和额度，生产使用默认值。 */
  rateLimit?: { limit?: number; windowMs?: number };
}

/**
 * 创建 Fastify 应用。测试直接调用 `inject` 验证 HTTP 行为，
 * 生产入口只在返回的实例上补充静态资源注册。
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? { chatMode: 'preset' };
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });

  let generate = options.generate;
  if (config.chatMode === 'deepseek' && !generate) {
    if (!config.deepseekApiKey) {
      throw new ConfigError('真实模式缺少必填环境变量 DEEPSEEK_API_KEY。');
    }
    generate = createDeepSeekClient({ apiKey: config.deepseekApiKey });
  }

  // 测试可注入替身；生产默认打开配置指向的 SQLite 文件（容器内为持久卷）。
  const databasePath =
    config.databasePath ?? process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
  const repository =
    options.repository ??
    createSqliteDemoRepository({ databasePath });
  if (!options.repository) {
    app.addHook('onClose', async () => {
      repository.close();
    });
  }

  // 每个响应使用独立 nonce；页面 HTML 会写入同一值供 antd 注入运行时样式。
  app.decorateRequest('cspNonce', '');
  app.addHook('onRequest', async (request, reply) => {
    const nonce = createCspNonce();
    request.cspNonce = nonce;
    reply.header('content-security-policy', buildContentSecurityPolicy(nonce));
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

  // 领取和问答各自使用独立窗口，避免一个入口的高频请求挤占另一个入口。
  const rateLimitOptions = {
    limit: options.rateLimit?.limit ?? DEFAULT_RATE_LIMIT.limit,
    windowMs: options.rateLimit?.windowMs ?? DEFAULT_RATE_LIMIT.windowMs,
    now: options.now
  };
  const sessionRateLimiter = createRateLimiter(rateLimitOptions);
  const chatRateLimiter = createRateLimiter(rateLimitOptions);
  const exchangeRateLimiter = createRateLimiter(rateLimitOptions);

  registerDemoSessionRoute(app, {
    repository,
    rateLimiter: sessionRateLimiter,
    now: options.now
  });
  registerChatRoute(app, {
    mode: config.chatMode,
    generate,
    repository,
    rateLimiter: chatRateLimiter,
    now: options.now
  });
  registerExchangeRoute(app, {
    repository,
    rateLimiter: exchangeRateLimiter,
    now: options.now
  });
  return app;
}
