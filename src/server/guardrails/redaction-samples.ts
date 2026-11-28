/**
 * 个人信息脱敏标注样本。
 *
 * 逐类标明类型、出现位置、原文和期望遮盖结果，覆盖模型请求与模型回复、
 * 一段多项、普通订单号与政策时限。数据全部为合成内容。
 */

export type PiiType = 'phone' | 'id_card' | 'email';

export interface RedactionSample {
  id: string;
  boundary: 'model_request' | 'model_response';
  piiType: PiiType | 'mixed';
  original: string;
  expected: string;
}

/** 遮盖约定：手机号保留前 3 后 4，身份证保留前 6 后 4，邮箱保留首字符。 */
export const REDACTION_SAMPLES: readonly RedactionSample[] = [
  {
    id: 'phone-request',
    boundary: 'model_request',
    piiType: 'phone',
    original: '换货期限是多久？联系 13812345678',
    expected: '换货期限是多久？联系 138****5678'
  },
  {
    id: 'phone-response',
    boundary: 'model_response',
    piiType: 'phone',
    original: '签收后 7 天内可换货，客服电话 13812345678。',
    expected: '签收后 7 天内可换货，客服电话 138****5678。'
  },
  {
    id: 'id-request',
    boundary: 'model_request',
    piiType: 'id_card',
    original: '证件号 110101199001011234 需要登记吗？',
    expected: '证件号 110101********1234 需要登记吗？'
  },
  {
    id: 'id-response',
    boundary: 'model_response',
    piiType: 'id_card',
    original: '政策要求登记 110101199001011234 的信息。',
    expected: '政策要求登记 110101********1234 的信息。'
  },
  {
    id: 'email-request',
    boundary: 'model_request',
    piiType: 'email',
    original: '发票发到 alice@example.com 可以吗？',
    expected: '发票发到 a***@example.com 可以吗？'
  },
  {
    id: 'email-response',
    boundary: 'model_response',
    piiType: 'email',
    original: '请联系 alice@example.com 处理。',
    expected: '请联系 a***@example.com 处理。'
  },
  {
    id: 'mixed-request',
    boundary: 'model_request',
    piiType: 'mixed',
    original: '订单 SC-AB12CD34EF56，联系 13812345678 或 alice@example.com',
    expected: '订单 SC-AB12CD34EF56，联系 138****5678 或 a***@example.com'
  },
  {
    id: 'mixed-response',
    boundary: 'model_response',
    piiType: 'mixed',
    original: '7 天内联系 13812345678、110101199001011234 或 alice@example.com',
    expected: '7 天内联系 138****5678、110101********1234 或 a***@example.com'
  },
  {
    id: 'business-numbers-kept',
    boundary: 'model_request',
    piiType: 'mixed',
    original: '订单 SC-AB12CD34EF56，7 天内换货，电话 13812345678',
    expected: '订单 SC-AB12CD34EF56，7 天内换货，电话 138****5678'
  }
];
