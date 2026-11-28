import type { GuardrailReason } from '../../shared/chat.js';

/**
 * 输入护栏：在业务分发前识别明确越界的文本。
 *
 * 规则刻意采用「动作 + 目标」组合，而不是单词命中：
 * - 「换货规则是什么？」里的「规则」是正常咨询，不能因为词面拦下；
 * - 「页面上的系统提示一直弹出来」里的「系统提示」是界面描述，
 *   只有搭配「告诉我 / 输出 / reveal」等提取动作才算提取系统提示；
 * - 「快递因为下雨延误了，签收后还有几天可以换货」里的「下雨」是背景，
 *   整句在问售后，不能因为天气词面判跑题。
 * 无法确定话题的问法返回 null，继续走证据不足、澄清或补问等既有路径。
 */

/** 改写系统指令、角色越权或提取系统提示的明确动作。 */
const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /(?:忽略|无视|忘记|忘掉|覆盖|推翻|不遵守|别遵守|不要再遵守|forget|ignore|override|disregard)\s*(?:之前|前面|上面|上述|所有|全部|一切|任何|你的|系统|原来的|先前的|all|previous|prior|your|the|system)?\s*(?:的)?\s*(?:指令|指示|规则|要求|提示词|设定|命令|instructions?|rules?|prompts?)/i,
  /(?:告诉我|输出|打印|显示|泄露|透露|说出|给出|复制|重复|reveal|show|print|repeat)\s*(?:你(?:的)?|your)?\s*(?:系统提示|system\s*prompt|提示词|初始指令|内部指令|instructions?)/i,
  /(?:你现在是|从现在起你是|假设你是|扮演|假装你是|act\s+as|pretend(?:\s+you\s+are)?|you\s+are\s+now)\b/i,
  /(?:不受任何限制|没有任何限制|无视限制|解除限制|do\s+anything\s+now|jailbreak|越狱|开发者模式)/i
];

/**
 * 天气类话题词面。它只可能把整句当天气问题，因此命中后还要看
 * 顾客是否在问售后：背景里的「下雨 / 下雪」不是跑题。
 */
const WEATHER_PATTERN = /(?:天气|气温|下雨|下雪|天气预报)/u;

/** 与售后明显无关、且无需意图判断的话题。 */
const OTHER_OFF_TOPIC_PATTERNS: readonly RegExp[] = [
  /(?:笑话|段子|脑筋急转弯|讲个故事)/,
  /(?:写|编|生成|帮我写|帮我编).{0,6}(?:代码|程序|脚本|爬虫|python|javascript|typescript|函数)/i,
  /^\s*\d+\s*[+\-*/×÷]\s*\d+\s*(?:等于|是|=)?\s*(?:\d+|几)?\s*[?？]?\s*$/,
  /(?:你是谁|你叫什么名字|你的名字是什么|谁开发的你|谁创造的你)/
];

/**
 * 售后意图信号：出现任一即说明顾客在问售后，天气/物流词只是背景描述。
 * 例如「快递因为下雨延误了，签收后还有几天可以换货」问的是换货期限，不是天气。
 */
const SUPPORT_INTENT_PATTERN =
  /(?:换货|退货|退款|退换|签收|订单|快递|物流|配送|到货|收货|商品|货|保修|维修|质量|损坏|淋湿|湿了|破损|少件|缺件|配件|包装|发票|运费|邮费|费用|几天|多久|期限|政策|规则|申请|办理|客服|人工|换|退)/u;

function hasSupportIntent(text: string): boolean {
  return SUPPORT_INTENT_PATTERN.test(text);
}

/** 返回拦截原因；返回 null 表示放行，交由现有业务路径处理。 */
export function classifyInputGuardrail(question: string): GuardrailReason | null {
  const text = question.trim();
  if (!text) {
    return null;
  }

  if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'prompt_injection';
  }

  const supportIntent = hasSupportIntent(text);
  if (WEATHER_PATTERN.test(text) && !supportIntent) {
    return 'off_topic';
  }
  if (OTHER_OFF_TOPIC_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'off_topic';
  }
  return null;
}
