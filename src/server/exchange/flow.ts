import type {
  ChatResponse,
  ExchangeFlowAction,
  ExchangeFlowResponse
} from '../../shared/chat.js';
import type {
  ExchangeDeclaration,
  ExchangeReason,
  ExchangeSummary
} from '../../shared/exchange.js';
import type { DemoOrderRecord, DemoRepository } from '../demo-session/repository.js';
import { containsOrderToken, hasOrderQueryPhrase } from '../orders/query.js';
import {
  evaluateExchangeEligibility,
  type ExchangeIneligibleReason
} from './eligibility.js';
import { EXCHANGE_FLOW_MESSAGES, EXCHANGE_MESSAGES } from './messages.js';
import {
  exchangeEligibilitySources,
  exchangeReasonLabel,
  exchangeShippingNotice,
  exchangeSummarySources
} from './policies.js';

export interface ExchangeFlowDeps {
  repository: DemoRepository;
  /** 浏览器 Cookie 令牌的摘要；缺失表示没有演示会话。 */
  tokenHash?: string;
  now: number;
}

const REASON_OPTIONS = ['质量问题', '其他原因'];
const DECLARATION_OPTIONS = ['齐全', '不齐全'];
const START_PHRASES = ['我想换货', '我要换货', '申请换货', '办理换货', '开始换货', '换货申请'];
const CONFIRM_TEXTS = new Set(['确认', '确定', '确认提交', '提交']);

/**
 * 否定指令：否定词紧邻取消、继续、开始等动作时不执行，按当前步骤处理。
 *
 * 保留短距离匹配，避免「不要担心，继续换货」这类句子被整体当作否定。
 */
const NEGATED_INSTRUCTION =
  /(?:不要|不想|不用|不必|不需要|别|勿|无需)[^，。！？,.!?]{0,3}(?:取消|继续|恢复|开始|办理|换货)/;

function isNegatedInstruction(text: string): boolean {
  return NEGATED_INSTRUCTION.test(text);
}

const INELIGIBLE_MESSAGES: Record<ExchangeIneligibleReason, string> = {
  not_signed: EXCHANGE_MESSAGES.notSigned,
  overdue: EXCHANGE_MESSAGES.overdue,
  condition_not_met: EXCHANGE_MESSAGES.conditionNotMet
};

type Intent = 'start' | 'resume' | 'cancel' | 'confirm' | null;

/** 疑问说法优先按政策问答处理，包括省略问号的口语提问。 */
const QUESTION_PATTERN =
  /怎么|如何|怎样|咋|为什么|为何|是否|能否|可否|能不能|可不可以|可以.*吗|吗\s*$|呢\s*$|多久|多少|几天|方法|办法|步骤|流程|什么(时候|意思|区别|政策|条件|规定|情况)/;

function isQuestionLike(question: string): boolean {
  return question.includes('？') || question.includes('?') || QUESTION_PATTERN.test(question);
}

function detectIntent(question: string): Intent {
  const text = question.trim();

  // 疑问说法是政策咨询，否定指令不执行动作；两者都按当前步骤或 FAQ 处理。
  if (isQuestionLike(text) || isNegatedInstruction(text)) {
    return null;
  }

  if (/取消(本次)?换货/.test(text) || text === '取消' || text === '不换了') {
    return 'cancel';
  }
  if (/继续(办理)?换货/.test(text) || text === '继续') {
    return 'resume';
  }
  if (CONFIRM_TEXTS.has(text)) {
    return 'confirm';
  }
  if (START_PHRASES.some((phrase) => text.includes(phrase))) {
    return 'start';
  }
  return null;
}

/** 只把顾客明确表达的选项映射为结构化原因，其余内容留给 FAQ 或重问。 */
function parseReason(question: string): ExchangeReason | null {
  if (/质量|损坏|破损|故障|坏了/.test(question)) {
    return 'quality';
  }
  if (/其他|不想要|不喜欢|拍错|买错/.test(question)) {
    return 'other';
  }
  return null;
}

/**
 * 商品状态是明确的二选一，不从不完整描述里推断「是否齐全」。
 *
 * 只接受「齐全 / 不齐全」及「完整 / 不完整 / 缺件」这些明确值；
 * 其余自由文本返回 null，由页面继续询问选择。
 */
const DECLARATION_ANSWERS = new Map<string, boolean>([
  ['齐全', true],
  ['完整', true],
  ['不齐全', false],
  ['不完整', false],
  ['缺件', false]
]);

/**
 * 申报步骤里只有明确询问政策主题的内容才转给 FAQ。
 *
 * 其余内容（包括「齐全？」「这个算齐全吗」「齐全了吗」等疑问变体）默认继续
 * 展示二选一，避免用逐句枚举猜测顾客是不是在问政策。
 */
const POLICY_TOPIC =
  /期限|运费|几天|多少天|多久|什么时候|何时|政策|规则|规定|条件|要求|流程|步骤|取消|资格|可以换|能换|能否|换货吗/;

/** 可以与选项分处不同标点段的明确确认词。 */
const CONFIRMATION_SEGMENTS = new Set(['好的', '好吧', '嗯', '确定', '确认', '是', '对', '行', '可以', '好']);
/** 固定的礼貌结束语，只忽略这些白名单词，不忽略任意未知文本。 */
const POLITE_SEGMENTS = new Set(['谢谢', '多谢', '麻烦了', '辛苦了']);
/** 单个分段允许剥离一次前置确认词，例如「是齐全」「对齐全」。 */
const CONFIRMATION_PREFIX = /^(好的|好吧|嗯|确定|确认|是|对|行|可以|好)/;

function matchOption(segment: string): boolean | undefined {
  const direct = DECLARATION_ANSWERS.get(segment);
  if (direct !== undefined) {
    return direct;
  }
  // 只剥离一次；「不是齐全」「不齐全」不以确认词开头，不会被剥成相反选项。
  const stripped = segment.replace(CONFIRMATION_PREFIX, '');
  return stripped === segment ? undefined : DECLARATION_ANSWERS.get(stripped);
}

function parseDeclaration(question: string): ExchangeDeclaration | null {
  // 问号表示疑问，保留下来交给二选一提示，而不是当作已选择。
  if (/[？?]/.test(question)) {
    return null;
  }

  // 只允许确认词 / 礼貌结束语 / 明确选项；其它无法识别的分段一律回到选择提示。
  const segments = question.split(/[\s，。、,!！：:；;]+/).filter(Boolean);
  let answer: boolean | undefined;
  for (const segment of segments) {
    if (CONFIRMATION_SEGMENTS.has(segment) || POLITE_SEGMENTS.has(segment)) {
      continue;
    }
    const value = matchOption(segment);
    if (value === undefined) {
      return null;
    }
    // 允许多个相同含义的选项（齐全 齐全 / 齐全 完整），但拒绝冲突（齐全 不齐全）。
    if (answer !== undefined && answer !== value) {
      return null;
    }
    answer = value;
  }

  if (answer === undefined) {
    return null;
  }
  return {
    itemIntact: answer,
    accessoriesComplete: answer,
    originalPackaging: answer,
    giftComplete: answer
  };
}

function reasonStep(orderId: string, interactionId: string): ExchangeFlowResponse {
  return {
    status: 'exchange_flow',
    outcome: 'step',
    step: 'reason',
    orderId,
    interactionId,
    message: EXCHANGE_FLOW_MESSAGES.reasonStep,
    options: REASON_OPTIONS
  };
}

function declarationStep(
  orderId: string,
  reason: ExchangeReason,
  interactionId: string
): ExchangeFlowResponse {
  return {
    status: 'exchange_flow',
    outcome: 'step',
    step: 'declaration',
    orderId,
    interactionId,
    reason,
    message: `已记录换货原因：${exchangeReasonLabel(reason)}。${EXCHANGE_FLOW_MESSAGES.declarationStep}`,
    options: DECLARATION_OPTIONS
  };
}

function declarationUnknownStep(
  orderId: string,
  reason: ExchangeReason,
  interactionId: string
): ExchangeFlowResponse {
  return {
    status: 'exchange_flow',
    outcome: 'step',
    step: 'declaration',
    orderId,
    interactionId,
    reason,
    message: EXCHANGE_FLOW_MESSAGES.declarationUnknown,
    options: DECLARATION_OPTIONS
  };
}

function stepResponse(
  flow: {
    visitorId: string;
    orderId: string;
    step: string;
    reason: ExchangeReason | null;
    interactionId: string | null;
  },
  deps: ExchangeFlowDeps,
  interactionId?: string
): ExchangeFlowResponse {
  // 旧进度没有交互标识时补发一个，页面按钮随后可携带它提交。
  const currentInteractionId =
    interactionId ?? flow.interactionId ?? deps.repository.rotateFlowInteraction(flow.visitorId, deps.now) ?? '';
  if (flow.step === 'reason' || !flow.reason) {
    return reasonStep(flow.orderId, currentInteractionId);
  }
  return declarationStep(flow.orderId, flow.reason, currentInteractionId);
}

function summaryResponse(input: {
  order: Pick<DemoOrderRecord, 'orderId' | 'productName'>;
  reason: ExchangeReason;
  confirmationId: string;
  expiresAt: number;
}): ExchangeFlowResponse {
  const summary: ExchangeSummary = {
    orderId: input.order.orderId,
    productName: input.order.productName,
    reason: input.reason,
    reasonLabel: exchangeReasonLabel(input.reason),
    shipping: exchangeShippingNotice(input.reason),
    sources: exchangeSummarySources()
  };
  return {
    status: 'exchange_flow',
    outcome: 'summary',
    confirmationId: input.confirmationId,
    expiresAt: input.expiresAt,
    summary
  };
}

function notice(message: string): ExchangeFlowResponse {
  return { status: 'exchange_flow', outcome: 'notice', message };
}

function cancelled(): ExchangeFlowResponse {
  return { status: 'exchange_flow', outcome: 'cancelled', message: EXCHANGE_FLOW_MESSAGES.cancelled };
}

function sessionRequired(): ExchangeFlowResponse {
  return {
    status: 'exchange_flow',
    outcome: 'session_required',
    message: EXCHANGE_FLOW_MESSAGES.sessionRequired
  };
}

function alreadySubmitted(application: {
  applicationId: string;
  status: 'submitted';
}): ExchangeFlowResponse {
  return {
    status: 'exchange_flow',
    outcome: 'already_submitted',
    application,
    message: EXCHANGE_FLOW_MESSAGES.alreadySubmitted
  };
}

function ineligible(reason: ExchangeIneligibleReason): ExchangeFlowResponse {
  return {
    status: 'exchange_flow',
    outcome: 'ineligible',
    reason,
    message: INELIGIBLE_MESSAGES[reason],
    sources: exchangeEligibilitySources(reason)
  };
}

export interface ExchangeFlowRequest {
  question?: string;
  action?: ExchangeFlowAction;
}

interface ExchangeSession {
  visitorId: string;
  orderId: string;
}

type FlowRecord = NonNullable<ReturnType<DemoRepository['findFlow']>>;

function ensureInteraction(flow: FlowRecord, deps: ExchangeFlowDeps): string {
  return (
    flow.interactionId ??
    deps.repository.rotateFlowInteraction(flow.visitorId, deps.now) ??
    ''
  );
}

function summaryFromFlow(
  flow: FlowRecord,
  visitorId: string,
  deps: ExchangeFlowDeps
): ExchangeFlowResponse | null {
  if (
    flow.step !== 'confirmation' ||
    !flow.reason ||
    !flow.confirmationId ||
    flow.expiresAt === null
  ) {
    return null;
  }
  const order = deps.repository.findOrder(visitorId, flow.orderId);
  if (!order) {
    return null;
  }
  return summaryResponse({
    order,
    reason: flow.reason,
    confirmationId: flow.confirmationId,
    expiresAt: flow.expiresAt
  });
}

function declarationFromValue(value: 'complete' | 'incomplete'): ExchangeDeclaration {
  const flag = value === 'complete';
  return {
    itemIntact: flag,
    accessoriesComplete: flag,
    originalPackaging: flag,
    giftComplete: flag
  };
}

/** 申报通过后生成摘要；文本与按钮两条入口共用同一资格与写入逻辑。 */
function completeDeclaration(
  flow: FlowRecord,
  declaration: ExchangeDeclaration,
  session: ExchangeSession,
  deps: ExchangeFlowDeps
): ChatResponse {
  if (!flow.reason || !deps.tokenHash) {
    return stepResponse(flow, deps);
  }

  const order = deps.repository.findOrder(session.visitorId, flow.orderId);
  if (!order) {
    deps.repository.cancelFlow(session.visitorId, deps.now);
    return notice(EXCHANGE_MESSAGES.notFound);
  }

  const eligibility = evaluateExchangeEligibility({
    signedAt: order.signedAt,
    now: deps.now,
    declaration
  });
  if (!eligibility.eligible) {
    // 不满足条件时结束本次办理，顾客可重新发起并核对新的申报。
    deps.repository.cancelFlow(session.visitorId, deps.now);
    return ineligible(eligibility.reason);
  }

  deps.repository.setFlowDeclaration(session.visitorId, declaration, deps.now);
  const preview = deps.repository.replacePreview({
    tokenHash: deps.tokenHash,
    visitorId: session.visitorId,
    orderId: flow.orderId,
    reason: flow.reason,
    declaration,
    now: deps.now
  });
  deps.repository.setFlowConfirmation(
    session.visitorId,
    preview.confirmationId,
    preview.expiresAt,
    deps.now
  );

  return summaryResponse({
    order,
    reason: flow.reason,
    confirmationId: preview.confirmationId,
    expiresAt: preview.expiresAt
  });
}

/** 交互标识不匹配时只重新提示当前步骤，绝不推进；同时更换标识使旧按钮继续失效。 */
function repromptCurrent(flow: FlowRecord, deps: ExchangeFlowDeps): ChatResponse {
  if (flow.step === 'confirmation') {
    return summaryFromFlow(flow, flow.visitorId, deps) ?? notice(EXCHANGE_FLOW_MESSAGES.confirmHint);
  }
  if (flow.step === 'reason' || !flow.reason) {
    const interactionId = deps.repository.rotateFlowInteraction(flow.visitorId, deps.now) ?? '';
    return reasonStep(flow.orderId, interactionId);
  }
  const interactionId = deps.repository.rotateFlowInteraction(flow.visitorId, deps.now) ?? '';
  return declarationUnknownStep(flow.orderId, flow.reason, interactionId);
}

/**
 * 处理按钮提交的结构化动作。
 *
 * 动作必须与当前步骤及交互标识同时匹配才推进；过期、跨轮、跨订单或乱序的
 * 动作只返回当前步骤提示，不读取文本、不写摘要。
 */
function handleAction(
  action: ExchangeFlowAction,
  session: ExchangeSession | null,
  deps: ExchangeFlowDeps
): ChatResponse {
  if (!session) {
    return sessionRequired();
  }

  const application = deps.repository.findExchangeApplication(
    session.visitorId,
    session.orderId
  );
  if (application) {
    deps.repository.clearFlow(session.visitorId);
    return alreadySubmitted(application);
  }

  const flow = deps.repository.findFlow(session.visitorId);
  if (!flow) {
    return notice(EXCHANGE_FLOW_MESSAGES.noActiveFlow);
  }

  // 摘要已生成时重复点击同一按钮直接返回原摘要，不重复写入。
  if (flow.step === 'confirmation') {
    return summaryFromFlow(flow, session.visitorId, deps) ?? notice(EXCHANGE_FLOW_MESSAGES.confirmHint);
  }

  const tokenMatches =
    flow.interactionId !== null && flow.interactionId === action.interactionId;

  if (action.type === 'exchange_reason') {
    if (flow.step !== 'reason' || !tokenMatches) {
      return repromptCurrent(flow, deps);
    }
    const interactionId = deps.repository.setFlowReason(flow.visitorId, action.value, deps.now);
    return declarationStep(flow.orderId, action.value, interactionId);
  }

  if (flow.step !== 'declaration' || !flow.reason || !tokenMatches) {
    return repromptCurrent(flow, deps);
  }
  return completeDeclaration(flow, declarationFromValue(action.value), session, deps);
}

/**
 * 识别并推进一轮对话内的换货办理。
 *
 * 返回 `null` 表示本轮与换货办理无关，交由查单或政策问答处理；只有明确办理、
 * 恢复、取消或补充当前步骤时才返回 `exchange_flow` 结果。换货全程不调用模型。
 *
 * 办理进度按访客持久化，办理期间政策提问不会改变当前步骤；缺单号的查单请求
 * 需要先完成或取消换货，避免两个补问流程同时推进。
 */
export function handleExchangeFlow(
  input: ExchangeFlowRequest,
  deps: ExchangeFlowDeps
): ChatResponse | null {
  const question = input.question ?? '';
  const session = deps.tokenHash
    ? deps.repository.findSession(deps.tokenHash, deps.now)
    : null;

  // 结构化动作不看文本，完全由当前步骤与交互标识决定是否推进。
  if (input.action) {
    return handleAction(input.action, session, deps);
  }

  if (!question) {
    return null;
  }

  const negated = isNegatedInstruction(question);
  const intent = detectIntent(question);

  if (intent === 'start') {
    if (!session || !deps.tokenHash) {
      return sessionRequired();
    }

    // 发起换货结束待补单号状态，保证下一轮只推进一项补问流程。
    deps.repository.setPending(deps.tokenHash, false, deps.now);

    const application = deps.repository.findExchangeApplication(
      session.visitorId,
      session.orderId
    );
    if (application) {
      deps.repository.clearFlow(session.visitorId);
      return alreadySubmitted(application);
    }

    const interactionId = deps.repository.startFlow({
      visitorId: session.visitorId,
      orderId: session.orderId,
      now: deps.now
    });
    return reasonStep(session.orderId, interactionId);
  }

  if (intent === 'resume' || intent === 'cancel') {
    if (!session) {
      return sessionRequired();
    }

    const application = deps.repository.findExchangeApplication(
      session.visitorId,
      session.orderId
    );
    if (application) {
      deps.repository.clearFlow(session.visitorId);
      return alreadySubmitted(application);
    }

    const flow = deps.repository.findFlow(session.visitorId);
    if (!flow) {
      return notice(EXCHANGE_FLOW_MESSAGES.noActiveFlow);
    }

    if (intent === 'cancel') {
      deps.repository.cancelFlow(session.visitorId, deps.now);
      return cancelled();
    }

    const summary = summaryFromFlow(flow, session.visitorId, deps);
    if (summary) {
      return summary;
    }

    // 恢复步骤时更换交互标识，刷新前留在页面上的旧按钮因此无法继续推进。
    const interactionId = deps.repository.rotateFlowInteraction(
      session.visitorId,
      deps.now
    );
    return stepResponse(flow, deps, interactionId ?? undefined);
  }

  if (!session) {
    return intent === 'confirm' ? sessionRequired() : null;
  }

  const flow = deps.repository.findFlow(session.visitorId);
  if (!flow) {
    return null;
  }

  // 否定指令不执行取消、恢复或开始，按当前步骤重新提示。
  if (negated) {
    if (flow.step === 'confirmation') {
      const summary = summaryFromFlow(flow, session.visitorId, deps);
      if (summary) {
        return summary;
      }
    }
    return stepResponse(flow, deps);
  }

  // 办理期间缺单号的查单会与商品申报争抢下一轮输入，要求先完成或取消换货。
  if (hasOrderQueryPhrase(question) && !containsOrderToken(question)) {
    return notice(EXCHANGE_FLOW_MESSAGES.orderQueryConflict);
  }

  // 带单号的查单交给后续路径；申报步骤默认继续补问，只有明确政策主题才转给 FAQ。
  if (containsOrderToken(question) || POLICY_TOPIC.test(question)) {
    return null;
  }

  if (intent === 'confirm') {
    if (flow.step === 'confirmation') {
      return notice(EXCHANGE_FLOW_MESSAGES.confirmHint);
    }
    return stepResponse(flow, deps);
  }

  if (flow.step === 'reason') {
    const reason = parseReason(question);
    if (!reason) {
      return {
        status: 'exchange_flow',
        outcome: 'step',
        step: 'reason',
        orderId: flow.orderId,
        interactionId: ensureInteraction(flow, deps),
        message: EXCHANGE_FLOW_MESSAGES.reasonUnknown,
        options: REASON_OPTIONS
      };
    }
    const interactionId = deps.repository.setFlowReason(flow.visitorId, reason, deps.now);
    return declarationStep(flow.orderId, reason, interactionId);
  }

  if (flow.step === 'declaration') {
    const declaration = parseDeclaration(question);
    if (!declaration) {
      if (!flow.reason) {
        return stepResponse(flow, deps);
      }
      return declarationUnknownStep(
        flow.orderId,
        flow.reason,
        ensureInteraction(flow, deps)
      );
    }
    return completeDeclaration(flow, declaration, session, deps);
  }

  return notice(EXCHANGE_FLOW_MESSAGES.confirmHint);
}
