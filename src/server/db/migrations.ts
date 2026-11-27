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
  },
  {
    version: 2,
    sql: `
      ALTER TABLE demo_orders ADD COLUMN signed_at INTEGER;

      -- 旧种子在领取时即创建「已签收」订单，以创建时间补齐模拟签收时刻，
      -- 保留原单号与有效会话，使升级前的演示订单仍能进入换货流程。
      UPDATE demo_orders SET signed_at = created_at WHERE signed_at IS NULL;

      CREATE TABLE exchange_summaries (
        confirmation_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        order_id TEXT NOT NULL REFERENCES demo_orders(order_id) ON DELETE CASCADE,
        reason TEXT NOT NULL CHECK (reason IN ('quality', 'other')),
        item_intact INTEGER NOT NULL CHECK (item_intact IN (0, 1)),
        accessories_complete INTEGER NOT NULL CHECK (accessories_complete IN (0, 1)),
        original_packaging INTEGER NOT NULL CHECK (original_packaging IN (0, 1)),
        gift_complete INTEGER NOT NULL CHECK (gift_complete IN (0, 1)),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        superseded_at INTEGER,
        consumed_at INTEGER
      ) STRICT;

      CREATE INDEX idx_exchange_summaries_order_id ON exchange_summaries(order_id);

      CREATE TABLE exchange_applications (
        application_id TEXT PRIMARY KEY,
        confirmation_id TEXT NOT NULL UNIQUE,
        visitor_id TEXT NOT NULL,
        order_id TEXT NOT NULL UNIQUE REFERENCES demo_orders(order_id) ON DELETE CASCADE,
        reason TEXT NOT NULL CHECK (reason IN ('quality', 'other')),
        status TEXT NOT NULL CHECK (status IN ('submitted')),
        created_at INTEGER NOT NULL
      ) STRICT;
    `
  },
  {
    version: 3,
    sql: `
      -- 对话内换货按访客保存当前步骤；订单被清理时同步删除进度。
      -- 每位访客同时只有一段办理，主键即 visitor_id。
      CREATE TABLE exchange_flows (
        visitor_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES demo_orders(order_id) ON DELETE CASCADE,
        step TEXT NOT NULL CHECK (step IN ('reason', 'declaration', 'confirmation')),
        reason TEXT CHECK (reason IN ('quality', 'other')),
        item_intact INTEGER NOT NULL DEFAULT 0 CHECK (item_intact IN (0, 1)),
        accessories_complete INTEGER NOT NULL DEFAULT 0 CHECK (accessories_complete IN (0, 1)),
        original_packaging INTEGER NOT NULL DEFAULT 0 CHECK (original_packaging IN (0, 1)),
        gift_complete INTEGER NOT NULL DEFAULT 0 CHECK (gift_complete IN (0, 1)),
        confirmation_id TEXT,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL
      ) STRICT;
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
