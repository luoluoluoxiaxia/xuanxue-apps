import { test } from 'node:test';
import assert from 'node:assert/strict';

// 新版前端的纯逻辑：在 Node 中直接加载原生 ES 模块（浏览器全局只做最小替身）。
globalThis.window = globalThis.window || { crypto: globalThis.crypto };
globalThis.location = globalThis.location || { hash: '', search: '', origin: 'https://example.test' };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = globalThis.document || { dispatchEvent() {} };

const base = new URL('../web/public/next/', import.meta.url);
const load = path => import(new URL(`${path}?v=n5`, base).href);

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

test('old home-page links map onto the new routes', async () => {
  const { routeFromLegacy } = await load('lib/legacy.js');
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
  assert.equal(routeFromLegacy('?ref=invite'), '');
  // 旧的广场锚点落到新的广场地址（首页已改为提问页）。
  const hash = location.hash;
  try {
    location.hash = '#gua-square';
    assert.equal(routeFromLegacy(''), '#/square');
    assert.equal(routeFromLegacy('?ref=post_card'), '?ref=post_card#/square');
  } finally {
    location.hash = hash;
  }
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

test('a second 401 after re-login does not loop: one re-auth, one re-send of the same body, then it stops', async () => {
  const { Conversation } = await load('lib/interpret.js');
  const realFetch = globalThis.fetch;
  const posts = [];
  let reauths = 0;
  globalThis.fetch = async (path, init = {}) => {
    if (String(path) === '/api/interpret') {
      posts.push(init.body);
      // 保险：万一回归成循环重发，第 6 次起放行，让测试以断言失败结束而不是一直挂着。
      if (posts.length > 5) return new Response(JSON.stringify({ task_id: 'd'.repeat(32), status: 'done', stage: 'done', answer: '好' }), { status: 200 });
      return new Response(JSON.stringify({ detail: '请先登录后再继续' }), { status: 401 });
    }
    return new Response('{}', { status: 200 });
  };
  const convo = new Conversation({
    system: 'bazi',
    sessionId: 's_0123456789abcdef',
    // 模拟「强制向服务端确认后仍显示已登录」：每次都立即返回 true，旧实现会无限重发。
    requireReauth: async () => { reauths += 1; return true; },
  });
  try {
    const message = await convo.ask('今年适合换工作吗？');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(reauths, 1);
    assert.equal(posts.length, 2);
    assert.equal(posts[0], posts[1]);
    assert.equal(JSON.parse(posts[1]).client_request_id, message.clientRequestId);
    assert.equal(message.status, 'failed');
    assert.equal(message.streaming, false);
    assert.equal(message.authLost, false);
    assert.equal(convo.busy, false);

    // 关掉登录面板：不重发，问题标记为保留，由视图放回输入框。
    posts.length = 0;
    reauths = 0;
    convo.requireReauth = async () => { reauths += 1; return false; };
    const dismissed = await convo.ask('那明年呢？');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(reauths, 1);
    assert.equal(posts.length, 1);
    assert.equal(dismissed.status, 'failed');
    assert.equal(dismissed.error, '登录已失效，问题已保留。');
    assert.equal(dismissed.authLost, true);
  } finally {
    convo.destroy();
    globalThis.fetch = realFetch;
  }
});

test('a 401 while following a running answer re-authenticates at most once and never polls in a loop', async () => {
  const { Conversation } = await load('lib/interpret.js');
  const realFetch = globalThis.fetch;
  const taskId = 'c'.repeat(32);
  let polls = 0;
  let reauths = 0;
  globalThis.fetch = async path => {
    if (String(path).startsWith('/api/interpret/tasks/')) {
      polls += 1;
      if (polls > 5) return new Response(JSON.stringify({ task_id: taskId, status: 'done', stage: 'done', answer: '好' }), { status: 200 });
      return new Response(JSON.stringify({ detail: '请先登录后再继续' }), { status: 401 });
    }
    return new Response('{}', { status: 200 });
  };
  const convo = new Conversation({ system: 'liuyao', sessionId: 's_0123456789abcdef', requireReauth: async () => { reauths += 1; return true; } });
  try {
    const message = convo.newAi({ question: '本月能签下合同吗？', taskId });
    convo.messages.push({ kind: 'user', text: '本月能签下合同吗？' }, message);
    convo.poll(message, 0);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(reauths, 1);
    assert.equal(polls, 2);
    assert.equal(message.status, 'failed');
    assert.equal(message.streaming, false);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(polls, 2);
  } finally {
    convo.destroy();
    globalThis.fetch = realFetch;
  }
});

// 以下几条迁移自旧版首页的档案恢复与草稿测试，规则不变。
test('a completed Liuyao history resolves its existing session instead of opening an empty one', async () => {
  const { resolveLiuyaoSession } = await load('lib/sessions.js');
  const calls = [];
  const sid = await resolveLiuyaoSession(
    { system: 'liuyao', history: [{ task_id: 'completed-task', created_at: '2026-09-09T12:00:00' }], active_tasks: [] },
    { fetchTask: async id => { calls.push(id); return { session_id: 's_1234567890abcdef' }; } },
  );
  assert.equal(sid, 's_1234567890abcdef');
  assert.deepEqual(calls, ['completed-task']);
});

test('newer running/failed/cancelled tasks keep their own session; fresh or empty archives do not resume', async () => {
  const { resolveLiuyaoSession } = await load('lib/sessions.js');
  for (const status of ['running', 'failed', 'cancelled']) {
    const calls = [];
    const fetchTask = async id => { calls.push(id); return {}; };
    const data = { system: 'liuyao', history: [{ task_id: 'old', created_at: '2026-09-08' }], active_tasks: [{ status, session_id: 's_1234567890abcdef', created_at: '2026-09-09' }] };
    assert.equal(await resolveLiuyaoSession(data, { fetchTask }), 's_1234567890abcdef');
    assert.equal(await resolveLiuyaoSession(data, { fetchTask, fresh: true }), '');
    assert.equal(await resolveLiuyaoSession({ system: 'liuyao', history: [] }, { fetchTask }), '');
    assert.deepEqual(calls, []);
  }
});

test('unrecoverable history reports failure instead of silently starting a new paid interpretation', async () => {
  const { resolveLiuyaoSession } = await load('lib/sessions.js');
  const history = { system: 'liuyao', history: [{ task_id: 'expired', created_at: '2026-09-09' }] };
  await assert.rejects(resolveLiuyaoSession(history, { fetchTask: async () => { throw new Error('404'); } }), /无法恢复/);
  await assert.rejects(resolveLiuyaoSession(history, { fetchTask: async () => ({}), fetchConversations: async () => [] }), /无法恢复/);
  // 任务记录已过期时，从这张盘的对话列表里取最近一段。
  const sid = await resolveLiuyaoSession(history, {
    fetchTask: async () => { throw new Error('404'); },
    fetchConversations: async () => [
      { session_id: 's_aaaaaaaaaaaaaaaa', updated_at: '2026-09-01T10:00:00+08:00' },
      { session_id: 's_bbbbbbbbbbbbbbbb', updated_at: '2026-09-09T10:00:00+08:00' },
      { session_id: 'not-a-session', updated_at: '2026-09-10T10:00:00+08:00' },
    ],
  });
  assert.equal(sid, 's_bbbbbbbbbbbbbbbb');
});

test('composer drafts are isolated by chart and session, and removed on logout', async () => {
  const { readingDraftKey } = await load('lib/sessions.js');
  const a = readingDraftKey(1, 's_1111111111111111', { started: true });
  const b = readingDraftKey(2, 's_2222222222222222', { started: true });
  const aOther = readingDraftKey(1, 's_3333333333333333', { started: true });
  const aNew = readingDraftKey(1, 's_1111111111111111', { started: false });
  assert.equal(new Set([a, b, aOther, aNew]).size, 4);
  assert.equal(readingDraftKey(1, 'bogus', { started: true }), aNew);
  const store = new Map([[a, 'bazi draft'], [b, 'liuyao draft'], ['xz-next-theme', 'dark']]);
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  };
  Object.defineProperty(globalThis.localStorage, 'keys', { value: () => [...store.keys()] });
  try {
    const { clearPrivateDrafts } = await load('lib/store.js');
    const keys = Object.keys;
    // clearPrivateDrafts 遍历 Object.keys(localStorage)：用 Map 的键模拟。
    Object.keys = target => (target === globalThis.localStorage ? [...store.keys()] : keys(target));
    try { clearPrivateDrafts(); } finally { Object.keys = keys; }
    assert.equal(store.has(a), false);
    assert.equal(store.has(b), false);
    assert.equal(store.get('xz-next-theme'), 'dark');
  } finally {
    globalThis.localStorage = previous;
  }
});
