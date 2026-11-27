import { existsSync } from 'node:fs';

/** 部署配置错误只暴露变量名，绝不拼接 Key 值。 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * 加载本地 .env 文件。
 *
 * 文件不存在时静默跳过，方便容器和纯环境变量部署；已存在的环境变量优先，
 * 便于显式覆盖文件内容。解析失败只报告文件格式问题，不回显文件内容。
 */
export function loadLocalEnv(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    process.loadEnvFile(path);
    return true;
  } catch {
    throw new ConfigError('本地 .env 文件格式不正确，请检查 CHAT_MODE 和 DEEPSEEK_API_KEY。');
  }
}

/** 服务端部署模式。浏览器提交的字段不能改变这里的取值。 */
export type DeploymentMode = 'preset' | 'deepseek';

export interface ServerConfig {
  chatMode: DeploymentMode;
  /** 只在真实模式下存在，仅用于服务端直达 DeepSeek 官方端点。 */
  deepseekApiKey?: string;
  /** SQLite 文件路径；容器通过环境变量指向持久化数据卷。 */
  databasePath?: string;
}

/** 本地默认把演示状态写到工作目录下的 data，容器部署会覆盖为数据卷路径。 */
export const DEFAULT_DATABASE_PATH = 'data/shopcare.sqlite';

/**
 * 解析部署者提供的运行时配置。
 *
 * 默认使用预置模式，公开演示无需任何外部凭证；真实模式必须显式提供 Key。
 * 错误信息只包含变量名和允许的取值，方便部署者排查且不会把 Key 写进日志。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawMode = (env.CHAT_MODE ?? 'preset').trim().toLowerCase();
  if (rawMode !== 'preset' && rawMode !== 'deepseek') {
    throw new ConfigError('CHAT_MODE 只支持 preset 或 deepseek。');
  }

  if (rawMode === 'preset') {
    return { chatMode: 'preset' };
  }

  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError('真实模式缺少必填环境变量 DEEPSEEK_API_KEY。');
  }

  return { chatMode: 'deepseek', deepseekApiKey: apiKey };
}
