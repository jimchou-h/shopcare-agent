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

/** 对话内办理换货的步骤与提示文案；与接口结果一起返回给页面。 */
export const EXCHANGE_FLOW_MESSAGES = {
  reasonStep: '请选择换货原因：回复「质量问题」或「其他原因」。',
  reasonUnknown: '未识别到换货原因，请回复「质量问题」或「其他原因」。',
  declarationStep: '请确认商品现状：回复「都齐全」，或说明商品、配件或包装的缺失情况。',
  declarationUnknown: '请回复「都齐全」，或说明商品、配件或包装的缺失情况。',
  confirmHint: '请点击摘要中的「确认提交」按钮完成申请。若需结束本次办理，请回复「取消换货」。',
  cancelled: '已取消本次换货办理，未提交的确认摘要已作废。',
  noActiveFlow: '当前没有待继续或可取消的换货办理。',
  orderQueryConflict: '正在办理换货，请先完成换货或回复「取消换货」，再查询订单。',
  sessionRequired: '请先领取示例订单，再办理换货。',
  alreadySubmitted: '该订单已有换货申请，无需重复办理。'
} as const;
