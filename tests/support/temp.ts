import { rmSync } from 'node:fs';

/**
 * 删除测试临时目录。
 *
 * Windows 上 SQLite 文件句柄释放可能滞后于应用关闭，删除会偶发 EPERM；
 * 重试后仍失败时留给系统清理，避免清理失败掩盖真正的断言结果。
 */
export function removeTempDir(directory: string): void {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // 临时目录由系统回收即可。
  }
}
