import type { FastifyInstance } from 'fastify';
import {
  chatRequestSchema,
  type ChatErrorResponse
} from '../../shared/chat.js';
import type { DeploymentMode } from '../config.js';
import type { DeepSeekGenerator } from '../deepseek/client.js';
import { ChatUpstreamError, answerChatQuestion } from './answer-question.js';

export interface ChatRouteDeps {
  mode: DeploymentMode;
  generate?: DeepSeekGenerator;
}

export function registerChatRoute(app: FastifyInstance, deps: ChatRouteDeps): void {
  app.post('/api/chat', async (request, reply) => {
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error: ChatErrorResponse = {
        status: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? '请求格式不正确，请提供 question 字段。'
      };
      return reply.code(400).send(error);
    }

    // 响应来源由服务端确定，浏览器提交的字段无法改变部署模式或开启新的调用路径。
    try {
      return await answerChatQuestion(parsed.data.question, deps);
    } catch (error) {
      if (error instanceof ChatUpstreamError) {
        const body: ChatErrorResponse = {
          status: 'upstream_error',
          message: '生成服务暂时不可用，请稍后重试。'
        };
        return reply.code(502).send(body);
      }
      throw error;
    }
  });
}
