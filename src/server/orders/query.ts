import type { ChatResponse } from '../../shared/chat.js';
import type { DemoRepository, DemoSessionRecord } from '../demo-session/repository.js';

/** 只接受 SC- 加 12 位英文字母或数字；查询前统一转大写。 */
const VALID_ORDER_ID = /^SC-[A-Z0-9]{12}$/i;
/** 宽松提取单号形态，便于区分「格式错误」和与订单无关的新话题。 */
const ORDER_TOKEN = /\bSC-[A-Za-z0-9]*/gi;
/** 明确查单问法；单独的合法单号只有在等待补单号时才消费。 */
const QUERY_PHRASES = [
  '帮我查一下订单',
  '查询我的订单',
  '我的订单状态',
  '查询订单',
  '查一下订单',
  '查下订单',
  '订单查询',
  '订单状态',
  '查订单'
];
const ORDER_NOTICE_MESSAGES = {
  not_found: '未找到可查询的订单。',
  number_required: '请提供要查询的订单号，例如「查订单 SC-XXXXXXXXXXXX」。',
  invalid_number: '订单号格式不正确，请使用 SC- 加 12 位英文字母或数字。',
  session_required: '请先领取示例订单，再查询订单状态。',
  ask_separately: '请把订单查询和售后政策问题分开提交。',
  query_hint: '请使用明确的查单问法，例如「查订单 SC-XXXXXXXXXXXX」。'
} as const;

type NoticeOutcome = keyof typeof ORDER_NOTICE_MESSAGES;

export interface OrderQuestionDeps {
  repository: DemoRepository;
  /** 浏览器 Cookie 令牌的摘要；缺失表示没有演示会话。 */
  tokenHash?: string;
  now: number;
}

function notice(outcome: NoticeOutcome): ChatResponse {
  return { status: 'order_query', outcome, message: ORDER_NOTICE_MESSAGES[outcome] };
}

/** 去掉查单用语、单号本身和标点后，判断是否还混有其他内容。 */
function residualText(question: string, orderToken: string): string {
  let rest = question;
  for (const phrase of QUERY_PHRASES) {
    rest = rest.replaceAll(phrase, '');
  }
  rest = rest.replace(orderToken, '');
  return rest.replace(/[\s，。,.!?！？:：、；;－—-]/g, '');
}

function findSession(deps: OrderQuestionDeps): DemoSessionRecord | null {
  return deps.tokenHash ? deps.repository.findSession(deps.tokenHash, deps.now) : null;
}

/**
 * 识别并处理一轮查单意图。
 *
 * 返回 `null` 表示本轮与查单无关，交由 FAQ 或模型路径处理。单号、订单详情和
 * 会话状态完全在本地处理，即使部署启用模型也不会进入模型请求。
 */
export function handleOrderQuestion(
  question: string,
  deps: OrderQuestionDeps
): ChatResponse | null {
  const tokens = Array.from(question.matchAll(ORDER_TOKEN), (match) => match[0]);
  if (tokens.length > 1) {
    return notice('ask_separately');
  }

  if (tokens.length === 1) {
    const token = tokens[0]!;

    if (!VALID_ORDER_ID.test(token)) {
      // 待补时保留状态，让顾客可以直接改正；其他情况同样给出格式提示。
      return notice('invalid_number');
    }

    if (residualText(question, token).length > 0) {
      return notice('ask_separately');
    }

    const session = findSession(deps);
    if (!session) {
      return notice('session_required');
    }

    const explicitQuery = QUERY_PHRASES.some((phrase) => question.includes(phrase));
    if (!explicitQuery && !session.pendingOrderQuery) {
      // 没有待补流程时，单独的合法单号不直接被视为查单提交。
      return notice('query_hint');
    }

    const order = deps.repository.findOrder(session.visitorId, token.toUpperCase());
    if (!order) {
      // 查无结果时保留待补状态，顾客可以继续修正单号。
      return notice('not_found');
    }

    deps.repository.setPending(deps.tokenHash!, false, deps.now);
    return {
      status: 'order_query',
      outcome: 'found',
      order: {
        orderId: order.orderId,
        productName: order.productName,
        status: order.status
      }
    };
  }

  if (!QUERY_PHRASES.some((phrase) => question.includes(phrase))) {
    return null;
  }

  const session = findSession(deps);
  if (!session) {
    return notice('session_required');
  }

  // 缺单号的明确查单进入待补状态，下一轮单独的单号会被消费。
  deps.repository.setPending(deps.tokenHash!, true, deps.now);
  return notice('number_required');
}
