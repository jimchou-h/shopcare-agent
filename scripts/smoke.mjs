import assert from 'node:assert/strict';

const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const questions = ['换货期限是多久？', '我收到货以后几天内还能申请换货？'];

const failures = [];

async function check(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function postQuestion(question, cookie) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify({ question })
  });
  assert.equal(response.status, 200, `问答接口返回 ${response.status}`);
  return response.json();
}

await check('就绪端点', async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200, `就绪端点返回 ${response.status}`);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.ok(body.faq?.entries > 0, '就绪响应缺少 FAQ 条目数');
});

await check('问答页面同源可访问', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200, `页面返回 ${response.status}`);
  const html = await response.text();
  assert.ok(html.includes('ShopCare 售后助手'), '页面缺少标题');
  assert.ok(!html.includes('DEEPSEEK_API_KEY'), '页面不应暴露服务端配置变量');
});

let demoCookie;
let demoOrderId;

await check('领取示例订单', async () => {
  const response = await fetch(`${baseUrl}/api/demo/session`, { method: 'POST' });
  assert.equal(response.status, 200, `领取接口返回 ${response.status}`);

  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
  assert.ok(setCookie, '领取响应缺少演示会话 Cookie');
  demoCookie = setCookie.split(';')[0];

  const body = await response.json();
  assert.equal(body.status, 'claimed', `期望 claimed，实际 ${body.status}`);
  assert.match(body.order.orderId, /^SC-[A-Z0-9]{12}$/, '示例单号格式不正确');
  assert.equal(body.order.status, '已签收', '示例订单应为已签收');
  assert.ok(body.order.productName, '缺少商品名');
  demoOrderId = body.order.orderId;
});

await check('对话内发起并取消换货', async () => {
  assert.ok(demoCookie && demoOrderId, '领取示例订单未完成');

  const start = await postQuestion('我想换货', demoCookie);
  assert.equal(start.status, 'exchange_flow', `期望 exchange_flow，实际 ${start.status}`);
  assert.equal(start.outcome, 'step', `期望 step，实际 ${start.outcome}`);
  assert.equal(start.step, 'reason', `期望 reason 步骤，实际 ${start.step}`);
  assert.equal(start.orderId, demoOrderId, '换货办理绑定了其他订单');

  const reason = await postQuestion('质量问题', demoCookie);
  assert.equal(reason.step, 'declaration', `期望 declaration，实际 ${reason.step}`);
  assert.equal(reason.reason, 'quality', `期望 quality，实际 ${reason.reason}`);

  const cancel = await postQuestion('取消换货', demoCookie);
  assert.equal(cancel.outcome, 'cancelled', `期望 cancelled，实际 ${cancel.outcome}`);
});

await check('查单与下一轮补单号', async () => {
  assert.ok(demoCookie && demoOrderId, '领取示例订单未完成');

  const direct = await postQuestion(`查订单 ${demoOrderId}`, demoCookie);
  assert.equal(direct.status, 'order_query', `期望 order_query，实际 ${direct.status}`);
  assert.equal(direct.outcome, 'found', `期望 found，实际 ${direct.outcome}`);
  assert.equal(direct.order.orderId, demoOrderId, '查单返回了其他订单');

  const prompt = await postQuestion('查订单', demoCookie);
  assert.equal(prompt.outcome, 'number_required', `期望 number_required，实际 ${prompt.outcome}`);

  const followUp = await postQuestion(demoOrderId, demoCookie);
  assert.equal(followUp.outcome, 'found', `补单号后期望 found，实际 ${followUp.outcome}`);
  assert.equal(followUp.order.orderId, demoOrderId, '补单号返回了其他订单');
});

let reference;
for (const question of questions) {  await check(`带出处回答「${question}」`, async () => {
    const body = await postQuestion(question);
    assert.equal(body.status, 'answered', `期望 answered，实际 ${body.status}`);
    assert.equal(body.mode, 'preset', `期望预置来源，实际 ${body.mode}`);
    assert.ok(body.answer, '缺少结论');
    assert.ok(body.source?.title, '缺少来源标题');
    assert.ok(body.source?.excerpt, '缺少政策摘录');

    if (!reference) {
      reference = body;
      return;
    }
    assert.equal(body.answer, reference.answer, '等价问法结论不一致');
    assert.equal(body.source.id, reference.source.id, '等价问法出处不一致');
    assert.equal(body.source.title, reference.source.title, '等价问法标题不一致');
    assert.equal(body.source.excerpt, reference.source.excerpt, '等价问法摘录不一致');
  });
}

async function postExchange(pathname, payload, cookie) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 200, `${pathname} 返回 ${response.status}`);
  return response.json();
}

const declaration = {
  itemIntact: true,
  accessoriesComplete: true,
  originalPackaging: true,
  giftComplete: false
};
let confirmationId;
let exchangeApplicationId;

await check('预览换货资格', async () => {
  assert.ok(demoCookie && demoOrderId, '领取示例订单未完成');

  const body = await postExchange(
    '/api/exchange/preview',
    { orderId: demoOrderId, reason: 'quality', declaration },
    demoCookie
  );
  assert.equal(body.outcome, 'eligible', `期望 eligible，实际 ${body.outcome}`);
  assert.equal(body.summary?.orderId, demoOrderId, '预览返回了其他订单');
  assert.ok(body.summary?.shipping?.note, '缺少运费说明');
  assert.ok((body.summary?.sources?.length ?? 0) >= 3, '缺少政策出处');
  confirmationId = body.confirmationId;
});

await check('确认提交换货申请并幂等重试', async () => {
  assert.ok(confirmationId, '换货预览未完成');

  const first = await postExchange(
    '/api/exchange/confirm',
    { confirmationId },
    demoCookie
  );
  assert.equal(first.outcome, 'submitted', `期望 submitted，实际 ${first.outcome}`);
  assert.match(first.application.applicationId, /^EX-[A-Z0-9]{12}$/, '申请编号格式不正确');

  const retried = await postExchange(
    '/api/exchange/confirm',
    { confirmationId },
    demoCookie
  );
  assert.equal(
    retried.application.applicationId,
    first.application.applicationId,
    '重复确认返回了新的申请编号'
  );
  exchangeApplicationId = first.application.applicationId;
});

await check('查单恢复换货回执', async () => {
  assert.ok(exchangeApplicationId, '换货申请未提交');

  const body = await postQuestion(`查订单 ${demoOrderId}`, demoCookie);
  assert.equal(body.outcome, 'found', `期望 found，实际 ${body.outcome}`);
  assert.equal(body.exchange?.applicationId, exchangeApplicationId, '查单未返回原申请');
  assert.equal(body.exchange?.status, 'submitted', '查单申请状态不正确');
});

await check('已提交后继续换货直接返回回执', async () => {
  assert.ok(exchangeApplicationId, '换货申请未提交');

  const body = await postQuestion('继续换货', demoCookie);
  assert.equal(body.status, 'exchange_flow', `期望 exchange_flow，实际 ${body.status}`);
  assert.equal(body.outcome, 'already_submitted', `期望 already_submitted，实际 ${body.outcome}`);
  assert.equal(body.application.applicationId, exchangeApplicationId, '继续换货返回了其他申请');
});

if (failures.length > 0) {
  console.error(`冒烟验证失败：${failures.join('、')}`);
  process.exit(1);
}

console.log(`冒烟验证通过：${baseUrl}`);
