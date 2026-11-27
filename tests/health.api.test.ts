import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app';
import { FAQ_CORPUS, FAQ_CORPUS_VERSION } from '../src/server/faq/corpus';
import { findCorpusProblems } from '../src/server/faq/validate';

describe('GET /healthz', () => {
  it('语料有效时报告就绪', async () => {
    const response = await buildApp().inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      faq: {
        version: FAQ_CORPUS_VERSION,
        entries: FAQ_CORPUS.length
      }
    });
  });

  it('限制页面网络连接为同源', async () => {
    const response = await buildApp().inject({ method: 'GET', url: '/healthz' });
    const csp = response.headers['content-security-policy'];

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp?.split('; ')).toContain("connect-src 'self'");
    expect(csp).not.toContain('*');
    // 模型调用只在服务端发生，浏览器不应获得 DeepSeek 直连权限。
    expect(csp).not.toContain('api.deepseek.com');
  });
});

describe('findCorpusProblems', () => {
  it('当前语料没有结构问题', () => {
    expect(findCorpusProblems(FAQ_CORPUS)).toEqual([]);
  });

  it('空语料被判定为无效', () => {
    expect(findCorpusProblems([])).toEqual(['语料为空']);
  });

  it('缺少出处字段或 ID 重复时报告问题', () => {
    const broken = [
      {
        id: 'faq-a',
        title: '',
        topic: '',
        questions: [],
        answer: '',
        excerpt: '',
        keywords: []
      },
      {
        id: 'faq-a',
        title: '重复条目',
        topic: '换货',
        questions: ['问题'],
        answer: '结论',
        excerpt: '摘录',
        keywords: ['关键词']
      }
    ];

    const problems = findCorpusProblems(broken);
    expect(problems).toEqual(
      expect.arrayContaining([
        'faq-a: 缺少标题',
        'faq-a: 缺少主题词',
        'faq-a: 缺少结论',
        'faq-a: 缺少政策摘录',
        'faq-a: 缺少检索关键词',
        'faq-a: 缺少已覆盖问法',
        'faq-a: id 重复'
      ])
    );
  });
});
