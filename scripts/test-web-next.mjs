import { test } from 'node:test';
import assert from 'node:assert/strict';

// 新版前端的纯逻辑：在 Node 中直接加载原生 ES 模块（浏览器全局只做最小替身）。
globalThis.window = globalThis.window || { crypto: globalThis.crypto };
globalThis.location = globalThis.location || { hash: '', search: '', origin: 'https://example.test' };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = globalThis.document || { dispatchEvent() {} };

const base = new URL('../web/public/next/', import.meta.url);
const load = path => import(new URL(`${path}?v=n1`, base).href);

test('waiting copy maps free-form stages to fixed banks and never echoes the raw stage', async () => {
  const { waitingBankKey, waitingLine } = await load('lib/copy.js');
  assert.equal(waitingBankKey('analysis'), 'analysis');
  assert.equal(waitingBankKey('正在合参命盘与卦象'), 'combining');
  assert.equal(waitingBankKey('逻辑校验中'), 'logic');
  assert.equal(waitingBankKey('some-internal-stage-name'), 'default');
  assert.notEqual(waitingLine('some-internal-stage-name'), 'some-internal-stage-name');
});

test('follow-up suggestions skip questions that were already asked', async () => {
  const { followupsFor } = await load('lib/copy.js');
  const asked = ['我更适合哪类岗位？'];
  const picks = followupsFor({ question: '我适合换工作吗', asked, turn: 1 });
  assert.equal(picks.length, 2);
  assert.ok(!picks.includes('我更适合哪类岗位？'));
  const liuyao = followupsFor({ liuyao: true, asked: [], turn: 1 });
  assert.deepEqual(liuyao, ['这一卦先看应期还是行动？', '我现在该主动还是该等？']);
});

test('streamed snapshots rewind the visible text when the server rewrites earlier text', async () => {
  const { Conversation } = await load('lib/interpret.js');
  const events = [];
  const convo = new Conversation({ system: 'bazi', sessionId: 's_0123456789abcdef', onChange: (_, change) => events.push(change) });
  const message = convo.newAi({ question: '今年适合换工作吗？' });
  convo.messages.push(message);
  convo.setAnswer(message, '先稳住手上的项目，再看机会。');
  message.body = '先稳住手上的项目';
  convo.setAnswer(message, '先稳住手头的工作，再看机会。');
  assert.equal(message.body, '先稳住手');
  assert.equal(message.fullBody, '先稳住手头的工作，再看机会。');
  convo.setAnswer(message, '');
  assert.equal(message.body, '');
  assert.equal(message.status, 'waiting');
  assert.ok(events.every(change => change === 'text'));
});

test('terminal task snapshots settle the message exactly once', async () => {
  const { Conversation } = await load('lib/interpret.js');
  const convo = new Conversation({ system: 'liuyao', sessionId: 's_0123456789abcdef' });
  const done = convo.newAi({ question: '本月能签下合同吗？' });
  convo.messages.push({ kind: 'user', text: '本月能签下合同吗？' }, done);
  convo.applyTask(done, { task_id: 'a'.repeat(32), status: 'done', stage: 'done', answer: '可以推进。', credits: { required_credits: 2 } });
  assert.equal(done.status, 'done');
  assert.equal(done.streaming, false);
  assert.equal(done.body, '可以推进。');
  assert.equal(done.followups.length, 2);
  convo.applyTask(done, { status: 'running', answer: '不应覆盖' });
  assert.equal(done.body, '可以推进。');

  const failed = convo.newAi({ question: 'x' });
  convo.messages.push(failed);
  convo.applyTask(failed, { task_id: 'b'.repeat(32), status: 'failed', stage: 'failed', answer: '部分内容', error: '服务繁忙' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, '服务繁忙');
  assert.equal(failed.body, '部分内容');

  const cancelled = convo.newAi({ question: 'y' });
  convo.messages.push(cancelled);
  convo.applyTask(cancelled, { task_id: 'c'.repeat(32), status: 'cancelled', stage: 'cancelled', answer: '' });
  assert.equal(cancelled.status, 'stopped');
  assert.equal(cancelled.stopped, true);
});

test('interpretation requests copy the saved chart input but never the cast question or line values', async () => {
  const { Conversation } = await load('lib/interpret.js');
  const convo = new Conversation({
    system: 'liuyao', sessionId: 's_0123456789abcdef', chartId: 7, profileId: 9,
    input: { system: 'liuyao', visibility: 'public', public_consent: true, public_consent_version: 'liuyao-public-v2', question: '原问题', yaos: [7, 8, 9, 7, 6, 8], method: 'client_coins' },
  });
  const body = convo.buildBody('应期在什么时候？', { clientRequestId: 'r_0123456789abcdef' });
  assert.equal(body.scenario, 'divination');
  assert.equal(body.question, '应期在什么时候？');
  assert.equal(body.chart_id, 7);
  assert.equal(body.profile_id, 9);
  assert.equal(body.visibility, 'public');
  assert.equal(body.public_consent_version, 'liuyao-public-v2');
  assert.ok(!('yaos' in body));
  assert.ok(!('method' in body));
});

test('API errors turn validation arrays into readable text instead of "[object Object]"', async () => {
  const { api } = await load('lib/api.js');
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ detail: [{ loc: ['body', 'question'], msg: 'Field required' }] }) });
  try {
    await assert.rejects(api('/api/x', { method: 'POST', body: {} }), error => {
      assert.equal(error.status, 422);
      assert.ok(!String(error.message).includes('[object Object]'));
      return true;
    });
    globalThis.fetch = async () => ({ ok: false, status: 409, text: async () => JSON.stringify({ detail: '该邮箱已注册，请直接登录。' }) });
    await assert.rejects(api('/api/x', { method: 'POST', body: {} }), error => error.message === '该邮箱已注册，请直接登录。');
  } finally {
    globalThis.fetch = original;
  }
});

test('classic links map onto the new routes and back', async () => {
  const { routeFromLegacy, classicUrl } = await load('lib/switch.js');
  assert.equal(routeFromLegacy('?post=ly-abc&ref=post_share'), '?ref=post_share#/post/ly-abc');
  assert.equal(routeFromLegacy('?start=liuyao&community=help'), '#/ask/liuyao?help=1');
  assert.equal(routeFromLegacy('?view=credits&checkout=success&session_id=cs_1&order_id=o1'), '#/me/credits?checkout=success&session_id=cs_1&order_id=o1');
  assert.equal(routeFromLegacy('?checkout=cancelled&order_id=o2'), '#/me/credits?checkout=cancelled&order_id=o2');
  assert.equal(routeFromLegacy('?checkout=bogus'), '');
  assert.equal(routeFromLegacy('?post=ly-abc&target=comment-94505'), '#/post/ly-abc?target=comment-94505');
  assert.equal(routeFromLegacy('?post=ly-abc&target=javascript:alert(1)'), '#/post/ly-abc');
  assert.equal(routeFromLegacy('?start=bazi&community=help'), '#/ask/bazi?help=1');
  assert.equal(routeFromLegacy('?start=bazi&set_default=1&from=personal_home'), '#/ask/bazi?set_default=1');
  assert.equal(routeFromLegacy('?view=credits&month=2026-08'), '#/me/credits?month=2026-08');
  assert.equal(routeFromLegacy('?post=ly-abc&ref=invite&inviter=u1'), '?ref=invite&inviter=u1#/post/ly-abc');
  assert.equal(routeFromLegacy(''), '');
  assert.equal(classicUrl({ path: '/post/ly-abc', query: new URLSearchParams() }), './?post=ly-abc&ui=classic#gua-square');
  assert.equal(classicUrl({ path: '/ask/liuyao', query: new URLSearchParams('help=1') }), './?start=liuyao&community=help&ui=classic');
});

test('coming back online re-polls a live answer at once instead of waiting out the retry backoff', async () => {
  const { Conversation } = await load('lib/interpret.js');
  const realFetch = globalThis.fetch;
  const taskId = 'b'.repeat(32);
  let offline = true;
  let taskCalls = 0;
  globalThis.fetch = async path => {
    if (!String(path).startsWith('/api/interpret/tasks/')) return new Response('{}', { status: 200 });
    taskCalls += 1;
    if (offline) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ task_id: taskId, status: 'done', stage: 'done', answer: '可以推进。' }), { status: 200 });
  };
  const convo = new Conversation({ system: 'liuyao', sessionId: 's_0123456789abcdef' });
  try {
    const message = convo.newAi({ question: '本月能签下合同吗？', taskId });
    convo.messages.push({ kind: 'user', text: '本月能签下合同吗？' }, message);
    convo.poll(message, 0);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(taskCalls, 1);
    assert.equal(message.streaming, true);
    assert.match(message.waitNote, /网络中断/);
    offline = false;
    convo.reconnect();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(taskCalls, 2);
    assert.equal(message.status, 'done');
    assert.equal(message.waitNote, '');
  } finally {
    convo.destroy();
    globalThis.fetch = realFetch;
  }
});
