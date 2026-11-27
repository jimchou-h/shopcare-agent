import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations.js';

/**
 * 打开 SQLite 并执行幂等迁移。`:memory:` 供测试使用，不创建目录。
 * 文件库启用 WAL，容器重建后仍可从数据卷读取未过期会话和订单。
 */
export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = new DatabaseSync(databasePath);
  if (databasePath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  runMigrations(db);
  return db;
}
