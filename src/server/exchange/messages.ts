/** 换货接口对外的稳定文案；页面直接展示，测试据此核对用户看到的结果。 */
export const EXCHANGE_MESSAGES = {
  sessionRequired: '请先领取示例订单，再申请换货。',
  notFound: '未找到可办理换货的订单。',
  notSigned: '订单尚未签收，暂不能申请换货。',
  overdue: '该订单已超过签收后 7 天的换货申请期限。',
  conditionNotMet:
    '商品需保持完好，配件、赠品及原包装齐全且不影响二次销售才能申请换货。',
  invalidConfirmation: '确认信息已失效，请重新核对换货信息。',
  expired: '确认已超过有效期，请重新核对换货信息。',
  superseded: '换货信息已重新生成，请使用最新的确认提交。',
  unavailable: '换货服务暂时不可用，请稍后重试。',
  rateLimited: '请求过于频繁，请稍后重试。',
  forbidden: '请求来源不受信任。',
  invalidRequest: '请求格式不正确。'
} as const;
