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

async function postQuestion(question) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
});

let reference;
for (const question of questions) {
  await check(`带出处回答「${question}」`, async () => {
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

if (failures.length > 0) {
  console.error(`冒烟验证失败：${failures.join('、')}`);
  process.exit(1);
}

console.log(`冒烟验证通过：${baseUrl}`);
