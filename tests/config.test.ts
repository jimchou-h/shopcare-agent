import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir } from './support/temp';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, loadLocalEnv } from '../src/server/config';

describe('loadConfig', () => {
  it('默认使用无 Key 的预置模式', () => {
    expect(loadConfig({})).toEqual({ chatMode: 'preset' });
  });

  it('真实模式读取并修剪部署 Key', () => {
    expect(loadConfig({ CHAT_MODE: ' deepseek ', DEEPSEEK_API_KEY: '  sk-server-test  ' })).toEqual({
      chatMode: 'deepseek',
      deepseekApiKey: 'sk-server-test'
    });
  });

  it.each([
    { label: '缺少变量', env: { CHAT_MODE: 'deepseek' } },
    { label: '只有空白', env: { CHAT_MODE: 'deepseek', DEEPSEEK_API_KEY: '   ' } }
  ])('$label 时报告缺少 DEEPSEEK_API_KEY', ({ env }) => {
    expect(() => loadConfig(env)).toThrowError(ConfigError);
    expect(() => loadConfig(env)).toThrowError(/DEEPSEEK_API_KEY/);
  });

  it('错误信息不包含任何 Key 值', () => {
    const secret = 'sk-should-not-leak';
    let message = '';
    try {
      loadConfig({ CHAT_MODE: 'deepseek', DEEPSEEK_API_KEY: secret, EXTRA: secret });
      // 真实模式有 Key 时不应报错；这里改用非法模式触发错误。
      loadConfig({ CHAT_MODE: 'unknown', DEEPSEEK_API_KEY: secret });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('CHAT_MODE');
    expect(message).not.toContain(secret);
  });

  it('拒绝无法识别的模式', () => {
    expect(() => loadConfig({ CHAT_MODE: 'generated' })).toThrowError(/CHAT_MODE/);
  });
});

describe('loadLocalEnv', () => {
  it('文件不存在时静默跳过', () => {
    const missing = join(tmpdir(), `shopcare-missing-${Date.now()}.env`);
    expect(loadLocalEnv(missing)).toBe(false);
  });

  it('从 .env 读取配置，且已有环境变量优先', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shopcare-env-'));
    const file = join(dir, '.env');
    writeFileSync(
      file,
      [
        'CHAT_MODE=deepseek',
        'DEEPSEEK_API_KEY=sk-file-placeholder',
        'SHOPCARE_ENV_PRECEDENCE=from-file'
      ].join('\n')
    );

    const previous = {
      CHAT_MODE: process.env.CHAT_MODE,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      SHOPCARE_ENV_PRECEDENCE: process.env.SHOPCARE_ENV_PRECEDENCE
    };

    try {
      process.env.SHOPCARE_ENV_PRECEDENCE = 'from-shell';
      expect(loadLocalEnv(file)).toBe(true);
      expect(process.env.CHAT_MODE).toBe('deepseek');
      expect(process.env.DEEPSEEK_API_KEY).toBe('sk-file-placeholder');
      expect(process.env.SHOPCARE_ENV_PRECEDENCE).toBe('from-shell');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      removeTempDir(dir);
    }
  });
});
