import Fastify, { type FastifyInstance } from 'fastify';
import { chatRequestSchema, type ChatErrorResponse } from '../shared/chat.js';
import { answerQuestion } from './faq/answer.js';
import { FAQ_CORPUS, FAQ_CORPUS_VERSION } from './faq/corpus.js';
import { findCorpusProblems } from './faq/validate.js';

/**
 * 创建 Fastify 应用。测试直接调用 `inject` 验证 HTTP 行为，
 * 生产入口只在返回的实例上补充静态资源注册。
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

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

  app.post('/api/chat', async (request, reply) => {
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error: ChatErrorResponse = {
        status: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? '请求格式不正确，请提供 question 字段。'
      };
      return reply.code(400).send(error);
    }

    return answerQuestion(parsed.data.question);
  });

  return app;
}
