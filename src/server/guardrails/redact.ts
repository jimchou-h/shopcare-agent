/**
 * 个人信息脱敏：手机号、身份证号、邮箱。
 *
 * 顺序刻意固定为先身份证、再手机号、最后邮箱：
 * - 身份证 18 位中可能含有 11 位数字段，先遮盖可避免手机号规则切入；
 * - 手机号要求 11 位且以 1 开头，订单号（SC-…）与政策时限（7 天）不会命中；
 * - 邮箱用原子匹配整体替换，保留首字符便于顾客核对。
 *
 * 遮盖约定：手机号 138****5678，身份证 110101********1234，邮箱 a***@example.com。
 */

/** 身份证：18 位，前 6 + 中间 8 + 后 4；末位允许 X/x。 */
const ID_CARD_PATTERN = /(?<![0-9])([0-9]{6})[0-9]{8}([0-9]{3}[0-9Xx])(?![0-9Xx])/gu;
/** 手机号：11 位，1 开头且第二位 3-9，保留前 3 后 4。 */
const PHONE_PATTERN = /(?<![0-9])(1[3-9][0-9])[0-9]{4}([0-9]{4})(?![0-9])/gu;
/** 邮箱：本地部分 + @ + 域名，保留首字符与完整域名。 */
const EMAIL_PATTERN = /([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/gu;

/** 遮盖一段文本中识别到的个人信息，未识别的业务数字原样保留。 */
export function redactPii(text: string): string {
  return text
    .replace(ID_CARD_PATTERN, (_match, first6: string, last4: string) => `${first6}********${last4}`)
    .replace(PHONE_PATTERN, (_match, first3: string, last4: string) => `${first3}****${last4}`)
    .replace(EMAIL_PATTERN, (_match, first: string, _rest: string, domain: string) => `${first}***@${domain}`);
}
