import type { FastifyInstance } from 'fastify';
import { chatRequestSchema, type ChatErrorResponse } from '../../shared/chat.js';
import { answerQuestion } from '../faq/answer.js';

export function registerChatRoute(app: FastifyInstance): void {
  app.post('/api/chat', async (request, reply) => {
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const error: ChatErrorResponse = {
        status: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? '请求格式不正确，请提供 question 字段。'
      };
      return reply.code(400).send(error);
    }

    // 响应标记由服务端确定，浏览器提交的字段无法开启新的调用路径。
    return { ...answerQuestion(parsed.data.question), mode: 'preset' };
  });
}
