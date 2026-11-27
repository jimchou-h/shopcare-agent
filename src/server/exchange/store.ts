import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ExchangeDeclaration, ExchangeReason } from '../../shared/exchange.js';

/** 待确认摘要的有效期；过期或被替换后必须重新预览。 */
export const PREVIEW_TTL_MS = 10 * 60 * 1000;

export interface ExchangePreviewInput {
  /** 浏览器 Cookie 令牌的摘要，用于确认摘要与当前会话绑定。 */
  tokenHash: string;
  visitorId: string;
  orderId: string;
  reason: ExchangeReason;
  declaration: ExchangeDeclaration;
  now: number;
}

export interface ExchangePreviewRecord {
  confirmationId: string;
  expiresAt: number;
}

/** 换货持久化操作；HTTP 层只依赖该接口，事务边界留在实现内。 */
export interface ExchangeStore {
  /**
   * 替换该订单当前唯一的待确认摘要并返回新的确认标识。
   *
   * 旧摘要会被标记为已替换，即使顾客拿到过旧标识也无法继续提交。
   */
  replacePreview(input: ExchangePreviewInput): ExchangePreviewRecord;
}

function toSqliteBoolean(value: boolean): number {
  return value ? 1 : 0;
}

export function createExchangeStore(db: DatabaseSync): ExchangeStore {
  return {
    replacePreview(input) {
      // 24 位 base64url 随机串，不含业务含义，只作为摘要与幂等键。
      const confirmationId = randomBytes(18).toString('base64url');
      const expiresAt = input.now + PREVIEW_TTL_MS;

      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(
          `UPDATE exchange_summaries
             SET superseded_at = ?
           WHERE order_id = ? AND superseded_at IS NULL AND consumed_at IS NULL`
        ).run(input.now, input.orderId);

        db.prepare(
          `INSERT INTO exchange_summaries
             (confirmation_id, token_hash, visitor_id, order_id, reason,
              item_intact, accessories_complete, original_packaging, gift_complete,
              created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          confirmationId,
          input.tokenHash,
          input.visitorId,
          input.orderId,
          input.reason,
          toSqliteBoolean(input.declaration.itemIntact),
          toSqliteBoolean(input.declaration.accessoriesComplete),
          toSqliteBoolean(input.declaration.originalPackaging),
          toSqliteBoolean(input.declaration.giftComplete),
          input.now,
          expiresAt
        );

        db.exec('COMMIT');
        return { confirmationId, expiresAt };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}
