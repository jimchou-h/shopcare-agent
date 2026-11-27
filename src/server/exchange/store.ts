import { randomBytes, randomInt } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ExchangeDeclaration, ExchangeReason } from '../../shared/exchange.js';
import { evaluateExchangeEligibility, type ExchangeIneligibleReason } from './eligibility.js';

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

export interface ExchangeApplicationRecord {
  applicationId: string;
  status: 'submitted';
}

export interface ConfirmExchangeInput {
  tokenHash: string;
  visitorId: string;
  confirmationId: string;
  now: number;
}

/** 对话内办理进度；每位访客同时只有一段，`confirmation` 阶段持有待确认摘要。 */
export type ExchangeFlowStep = 'reason' | 'declaration' | 'confirmation';

export interface ExchangeFlowRecord {
  visitorId: string;
  orderId: string;
  step: ExchangeFlowStep;
  reason: ExchangeReason | null;
  declaration: ExchangeDeclaration;
  confirmationId: string | null;
  expiresAt: number | null;
}

export interface StartExchangeFlowInput {
  visitorId: string;
  orderId: string;
  now: number;
}

/** 确认结果；只有 `submitted` 产生了或复用了已写入的申请。 */
export type ConfirmExchangeResult =
  | { outcome: 'submitted'; application: ExchangeApplicationRecord }
  | { outcome: 'ineligible'; reason: ExchangeIneligibleReason }
  | { outcome: 'expired' }
  | { outcome: 'superseded' }
  | { outcome: 'invalid_confirmation' }
  | { outcome: 'not_found' };

/** 换货持久化操作；HTTP 层只依赖该接口，事务边界留在实现内。 */
export interface ExchangeStore {
  /**
   * 替换该订单当前唯一的待确认摘要并返回新的确认标识。
   *
   * 旧摘要会被标记为已替换，即使顾客拿到过旧标识也无法继续提交。
   */
  replacePreview(input: ExchangePreviewInput): ExchangePreviewRecord;
  /** 按访客与订单共同定位已受理的申请，越界访问与不存在返回相同结果。 */
  findExchangeApplication(visitorId: string, orderId: string): ExchangeApplicationRecord | null;
  /**
   * 在同一事务中复核摘要、订单归属与当前资格，再写入申请。
   *
   * 确认标识是幂等键：同一确认重复或并发提交返回原申请；同一订单只保留一笔申请。
   * 提交成功后清除该访客的办理进度。
   */
  confirmExchange(input: ConfirmExchangeInput): ConfirmExchangeResult;
  /** 从原因步骤重新开始一段办理；已有进度会被重置，仍绑定当前访客的订单。 */
  startFlow(input: StartExchangeFlowInput): void;
  /** 读取当前访客的办理进度；不存在时返回 null。 */
  findFlow(visitorId: string): ExchangeFlowRecord | null;
  /** 记录换货原因并进入商品申报步骤。 */
  setFlowReason(visitorId: string, reason: ExchangeReason, now: number): void;
  /** 保存商品申报；步骤保持为申报，直到生成摘要。 */
  setFlowDeclaration(
    visitorId: string,
    declaration: ExchangeDeclaration,
    now: number
  ): void;
  /** 摘要生成后进入确认步骤，并记录摘要有效期供恢复时展示。 */
  setFlowConfirmation(
    visitorId: string,
    confirmationId: string,
    expiresAt: number,
    now: number
  ): void;
  /** 只删除办理进度，不影响任何摘要；用于已提交后清理遗留状态。 */
  clearFlow(visitorId: string): void;
  /**
   * 取消办理：撤销该访客尚未使用的摘要并删除进度。
   *
   * 返回是否存在可取消的进度，便于接口区分「已取消」与「本就未办理」。
   */
  cancelFlow(visitorId: string, now: number): boolean;
}

/** 申请编号的字符集，去掉易混淆的 I、O、0、1。 */
const APPLICATION_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const APPLICATION_ID_LENGTH = 12;

function createApplicationId(): string {
  let suffix = '';
  for (let index = 0; index < APPLICATION_ID_LENGTH; index += 1) {
    suffix += APPLICATION_ID_ALPHABET[randomInt(APPLICATION_ID_ALPHABET.length)];
  }
  return `EX-${suffix}`;
}

function toApplication(row: Record<string, unknown>): ExchangeApplicationRecord {
  return {
    applicationId: String(row.application_id),
    status: 'submitted'
  };
}

function toFlow(row: Record<string, unknown>): ExchangeFlowRecord {
  return {
    visitorId: String(row.visitor_id),
    orderId: String(row.order_id),
    step: String(row.step) as ExchangeFlowStep,
    reason: row.reason === null || row.reason === undefined ? null : (String(row.reason) as ExchangeReason),
    declaration: {
      itemIntact: Number(row.item_intact) === 1,
      accessoriesComplete: Number(row.accessories_complete) === 1,
      originalPackaging: Number(row.original_packaging) === 1,
      giftComplete: Number(row.gift_complete) === 1
    },
    confirmationId:
      row.confirmation_id === null || row.confirmation_id === undefined
        ? null
        : String(row.confirmation_id),
    expiresAt: row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at)
  };
}

function toSqliteBoolean(value: boolean): number {
  return value ? 1 : 0;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export function createExchangeStore(db: DatabaseSync): ExchangeStore {
  const findSummary = db.prepare(`
    SELECT token_hash, visitor_id, order_id, reason,
           item_intact, accessories_complete, original_packaging, gift_complete,
           expires_at, superseded_at, consumed_at
    FROM exchange_summaries
    WHERE confirmation_id = ?
  `);
  const findApplicationByConfirmation = db.prepare(`
    SELECT application_id, status FROM exchange_applications WHERE confirmation_id = ?
  `);
  const findApplicationByOrder = db.prepare(`
    SELECT application_id, status FROM exchange_applications WHERE order_id = ?
  `);
  const findOwnedApplication = db.prepare(`
    SELECT application_id, status FROM exchange_applications WHERE order_id = ? AND visitor_id = ?
  `);
  const findOrderState = db.prepare(`
    SELECT visitor_id, signed_at FROM demo_orders WHERE order_id = ?
  `);
  const findFlowRow = db.prepare(`
    SELECT visitor_id, order_id, step, reason,
           item_intact, accessories_complete, original_packaging, gift_complete,
           confirmation_id, expires_at
    FROM exchange_flows
    WHERE visitor_id = ?
  `);

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
    },

    findExchangeApplication(visitorId, orderId) {
      const row = findOwnedApplication.get(orderId, visitorId);
      return row ? toApplication(row) : null;
    },

    confirmExchange(input) {
      db.exec('BEGIN IMMEDIATE');
      try {
        // 已完成的确认直接返回原申请，响应丢失后的重试因此安全。
        const existing = findApplicationByConfirmation.get(input.confirmationId);
        if (existing) {
          db.exec('COMMIT');
          return { outcome: 'submitted', application: toApplication(existing) };
        }

        const summary = findSummary.get(input.confirmationId);
        if (
          !summary ||
          String(summary.token_hash) !== input.tokenHash ||
          String(summary.visitor_id) !== input.visitorId
        ) {
          // 未知摘要与其他访客的摘要返回同一结果，不泄露摘要是否存在。
          db.exec('COMMIT');
          return { outcome: 'invalid_confirmation' };
        }

        const orderId = String(summary.order_id);

        // 同一订单已有申请时复用原结果，保持「一单一申请」。
        const applicationForOrder = findApplicationByOrder.get(orderId);
        if (applicationForOrder) {
          db.exec('COMMIT');
          return { outcome: 'submitted', application: toApplication(applicationForOrder) };
        }

        if (summary.consumed_at !== null) {
          db.exec('COMMIT');
          return { outcome: 'invalid_confirmation' };
        }
        if (summary.superseded_at !== null) {
          db.exec('COMMIT');
          return { outcome: 'superseded' };
        }
        if (Number(summary.expires_at) <= input.now) {
          db.exec('COMMIT');
          return { outcome: 'expired' };
        }

        const order = findOrderState.get(orderId);
        if (!order || String(order.visitor_id) !== input.visitorId) {
          db.exec('COMMIT');
          return { outcome: 'not_found' };
        }

        // 预览与确认之间可能跨过期限或订单状态变化，以写入时刻重新判断。
        const eligibility = evaluateExchangeEligibility({
          signedAt: order.signed_at === null ? null : Number(order.signed_at),
          now: input.now,
          declaration: {
            itemIntact: Number(summary.item_intact) === 1,
            accessoriesComplete: Number(summary.accessories_complete) === 1,
            originalPackaging: Number(summary.original_packaging) === 1,
            giftComplete: Number(summary.gift_complete) === 1
          }
        });
        if (!eligibility.eligible) {
          db.exec('COMMIT');
          return { outcome: 'ineligible', reason: eligibility.reason };
        }

        const applicationId = createApplicationId();
        db.prepare(
          `INSERT INTO exchange_applications
             (application_id, confirmation_id, visitor_id, order_id, reason, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'submitted', ?)`
        ).run(
          applicationId,
          input.confirmationId,
          input.visitorId,
          orderId,
          String(summary.reason),
          input.now
        );
        db.prepare(
          'UPDATE exchange_summaries SET consumed_at = ? WHERE confirmation_id = ?'
        ).run(input.now, input.confirmationId);

        // 已提交后不再保留对话办理进度；恢复时直接返回已受理的申请。
        db.prepare('DELETE FROM exchange_flows WHERE visitor_id = ?').run(input.visitorId);

        db.exec('COMMIT');
        return { outcome: 'submitted', application: { applicationId, status: 'submitted' } };
      } catch (error) {
        db.exec('ROLLBACK');

        // 唯一约束兜底：并发写入方已提交同一确认或同一订单时，返回已存在的结果。
        if (isUniqueConstraintError(error)) {
          const existing = findApplicationByConfirmation.get(input.confirmationId);
          if (existing) {
            return { outcome: 'submitted', application: toApplication(existing) };
          }
          const summary = findSummary.get(input.confirmationId);
          if (summary) {
            const applicationForOrder = findApplicationByOrder.get(String(summary.order_id));
            if (applicationForOrder) {
              return { outcome: 'submitted', application: toApplication(applicationForOrder) };
            }
          }
        }

        throw error;
      }
    },

    startFlow(input) {
      // 同一访客重新发起时重置已有进度，但始终绑定当前会话的订单。
      db.prepare(
        `INSERT INTO exchange_flows (visitor_id, order_id, step, updated_at)
         VALUES (?, ?, 'reason', ?)
         ON CONFLICT(visitor_id) DO UPDATE SET
           order_id = excluded.order_id,
           step = 'reason',
           reason = NULL,
           item_intact = 0,
           accessories_complete = 0,
           original_packaging = 0,
           gift_complete = 0,
           confirmation_id = NULL,
           expires_at = NULL,
           updated_at = excluded.updated_at`
      ).run(input.visitorId, input.orderId, input.now);
    },

    findFlow(visitorId) {
      const row = findFlowRow.get(visitorId);
      return row ? toFlow(row) : null;
    },

    setFlowReason(visitorId, reason, now) {
      db.prepare(
        `UPDATE exchange_flows
            SET step = 'declaration', reason = ?, confirmation_id = NULL,
                expires_at = NULL, updated_at = ?
          WHERE visitor_id = ?`
      ).run(reason, now, visitorId);
    },

    setFlowDeclaration(visitorId, declaration, now) {
      db.prepare(
        `UPDATE exchange_flows
            SET item_intact = ?, accessories_complete = ?, original_packaging = ?,
                gift_complete = ?, updated_at = ?
          WHERE visitor_id = ?`
      ).run(
        toSqliteBoolean(declaration.itemIntact),
        toSqliteBoolean(declaration.accessoriesComplete),
        toSqliteBoolean(declaration.originalPackaging),
        toSqliteBoolean(declaration.giftComplete),
        now,
        visitorId
      );
    },

    setFlowConfirmation(visitorId, confirmationId, expiresAt, now) {
      db.prepare(
        `UPDATE exchange_flows
            SET step = 'confirmation', confirmation_id = ?, expires_at = ?, updated_at = ?
          WHERE visitor_id = ?`
      ).run(confirmationId, expiresAt, now, visitorId);
    },

    clearFlow(visitorId) {
      db.prepare('DELETE FROM exchange_flows WHERE visitor_id = ?').run(visitorId);
    },

    cancelFlow(visitorId, now) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = findFlowRow.get(visitorId);
        // 撤销该访客所有尚未使用或替换的摘要，旧确认按钮因此无法再提交。
        db.prepare(
          `UPDATE exchange_summaries
              SET superseded_at = ?
            WHERE visitor_id = ? AND superseded_at IS NULL AND consumed_at IS NULL`
        ).run(now, visitorId);
        db.prepare('DELETE FROM exchange_flows WHERE visitor_id = ?').run(visitorId);
        db.exec('COMMIT');
        return Boolean(existing);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}
