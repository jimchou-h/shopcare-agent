import { randomBytes, randomInt } from 'node:crypto';
import { openDatabase } from '../db/database.js';
import { createExchangeStore, type ExchangeStore } from '../exchange/store.js';

/** 公开演示的会话有效期；固定 24 小时，避免公开实例长期积累身份。 */
export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const PRODUCT_NAME = '轻量通勤双肩包';
const ORDER_STATUS = '已签收';
const ORDER_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ORDER_ID_RANDOM_LENGTH = 12;

export interface DemoOrderRecord {
  orderId: string;
  visitorId: string;
  productName: string;
  status: string;
  /** 签收时刻；未签收为 null。演示订单领取时即视为已签收。 */
  signedAt: number | null;
}

export interface DemoSessionRecord {
  visitorId: string;
  orderId: string;
  pendingOrderQuery: boolean;
}

export interface ClaimedSession {
  order: DemoOrderRecord;
  /** 新建会话或旧令牌已失效时为 true，调用方需要重新下发 Cookie。 */
  created: boolean;
}

/**
 * 查单所需的持久化操作。HTTP 层只依赖该接口，测试可用同一实现配合可控时钟，
 * 生产实现落在 SQLite，归属判断始终由 `visitorId` 与单号共同完成。
 */
export interface DemoRepository extends ExchangeStore {
  /** 创建或复用当前令牌的会话，并返回绑定的合成订单。 */
  claimSession(tokenHash: string, now: number): ClaimedSession;
  /** 只返回未过期会话；过期或未知令牌视为没有会话。 */
  findSession(tokenHash: string, now: number): DemoSessionRecord | null;
  /** 更新待补单号状态；会话不存在或已过期时静默忽略。 */
  setPending(tokenHash: string, pending: boolean, now: number): void;
  /** 按访客与单号共同定位订单，越界访问与不存在返回相同结果。 */
  findOrder(visitorId: string, orderId: string): DemoOrderRecord | null;
  close(): void;
}

function createOrderId(): string {
  let suffix = '';
  for (let index = 0; index < ORDER_ID_RANDOM_LENGTH; index += 1) {
    suffix += ORDER_ID_ALPHABET[randomInt(ORDER_ID_ALPHABET.length)];
  }
  return `SC-${suffix}`;
}

function createVisitorId(): string {
  return `visitor_${randomBytes(12).toString('hex')}`;
}

function toOrder(row: Record<string, unknown>): DemoOrderRecord {
  return {
    orderId: String(row.order_id),
    visitorId: String(row.visitor_id),
    productName: String(row.product_name),
    status: String(row.status),
    signedAt: row.signed_at === null || row.signed_at === undefined ? null : Number(row.signed_at)
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export function createSqliteDemoRepository(options: {
  databasePath: string;
  ttlMs?: number;
}): DemoRepository {
  const db = openDatabase(options.databasePath);
  const ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;

  const findValidOrder = db.prepare(`
    SELECT o.order_id, o.visitor_id, o.product_name, o.status, o.signed_at
    FROM demo_sessions s
    JOIN demo_orders o ON o.order_id = s.order_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `);
  const findSession = db.prepare(`
    SELECT visitor_id, order_id, pending_order_query
    FROM demo_sessions
    WHERE token_hash = ? AND expires_at > ?
  `);
  const findOrder = db.prepare(`
    SELECT order_id, visitor_id, product_name, status, signed_at
    FROM demo_orders
    WHERE order_id = ? AND visitor_id = ?
  `);

  return {
    ...createExchangeStore(db),

    claimSession(tokenHash, now) {
      db.exec('BEGIN IMMEDIATE');
      try {
        // 领取时清理过期会话及其订单，避免公开演示的数据无限增长。
        db.prepare(
          'DELETE FROM demo_orders WHERE order_id IN (SELECT order_id FROM demo_sessions WHERE expires_at <= ?)'
        ).run(now);

        const existing = findValidOrder.get(tokenHash, now);
        if (existing) {
          db.exec('COMMIT');
          return { order: toOrder(existing), created: false };
        }

        for (let attempt = 0; attempt < 5; attempt += 1) {
          const orderId = createOrderId();
          const visitorId = createVisitorId();
          try {
            db.prepare(
              'INSERT INTO demo_orders (order_id, visitor_id, product_name, status, created_at, signed_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(orderId, visitorId, PRODUCT_NAME, ORDER_STATUS, now, now);
            db.prepare(
              `INSERT INTO demo_sessions
                 (token_hash, visitor_id, order_id, pending_order_query, expires_at, created_at)
               VALUES (?, ?, ?, 0, ?, ?)`
            ).run(tokenHash, visitorId, orderId, now + ttlMs, now);
            db.exec('COMMIT');
            return {
              order: {
                orderId,
                visitorId,
                productName: PRODUCT_NAME,
                status: ORDER_STATUS,
                signedAt: now
              },
              created: true
            };
          } catch (error) {
            if (!isUniqueConstraintError(error) || attempt === 4) {
              throw error;
            }
            // 极端碰撞时只重试订单生成，外层事务保持打开。
          }
        }

        throw new Error('无法生成唯一的演示订单号。');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    findSession(tokenHash, now) {
      const row = findSession.get(tokenHash, now);
      if (!row) {
        return null;
      }
      return {
        visitorId: String(row.visitor_id),
        orderId: String(row.order_id),
        pendingOrderQuery: Number(row.pending_order_query) === 1
      };
    },

    setPending(tokenHash, pending, now) {
      db.prepare(
        'UPDATE demo_sessions SET pending_order_query = ? WHERE token_hash = ? AND expires_at > ?'
      ).run(pending ? 1 : 0, tokenHash, now);
    },

    findOrder(visitorId, orderId) {
      const row = findOrder.get(orderId, visitorId);
      return row ? toOrder(row) : null;
    },

    close() {
      db.close();
    }
  };
}
