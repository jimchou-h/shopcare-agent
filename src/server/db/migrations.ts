import type { DatabaseSync } from 'node:sqlite';

interface Migration {
  version: number;
  sql: string;
}

/**
 * 迁移按版本顺序执行，且已记录的版本不会重复执行。
 * 演示库只需要增量结构，回滚应用镜像时保留数据卷即可继续使用。
 */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE demo_orders (
        order_id TEXT PRIMARY KEY,
        visitor_id TEXT NOT NULL UNIQUE,
        product_name TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE demo_sessions (
        token_hash TEXT PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES demo_orders(order_id) ON DELETE CASCADE,
        pending_order_query INTEGER NOT NULL DEFAULT 0 CHECK (pending_order_query IN (0, 1)),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX idx_demo_sessions_expires_at ON demo_sessions(expires_at);
    `
  }
];

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => Number(row.version))
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString()
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
