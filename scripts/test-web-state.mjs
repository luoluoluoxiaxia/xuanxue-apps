import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const source = file => readFileSync(fileURLToPath(new URL(`../web/public/${file}`, import.meta.url)), 'utf8');
// Run the shipped zero-build functions against deterministic UI/network boundaries.
function section(file, start, end) {
  const text = source(file);
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source section: ${start}`);
  return text.slice(from, to);
}

const readySource = section('account.js', '  async function ready()', '  function csrfHeaders');
test('ready observes login and logout after the initial anonymous request', async () => {
  let account = { authenticated: false };
  let reads = 0;
  const ctx = { snapshot: () => ({ ...account }), refresh: async () => { reads++; return { ...account }; } };
  runInNewContext(`let initialLoad; ${readySource}; this.ready = ready`, ctx);
  assert.equal((await ctx.ready()).authenticated, false);
  account = { authenticated: true, user: { id: 'account-a' } };
  assert.equal((await ctx.ready()).user.id, 'account-a');
  account = { authenticated: false };
  assert.equal((await ctx.ready()).authenticated, false);
  assert.equal(reads, 1);
});

function commentHarness() {
  const host = { dataset: {}, querySelector() { return this.form || null; } };
  const calls = [];
  const displayed = [];
  const account = { authenticated: true };
  const ctx = {
    field: () => host, activePreview: null, previewCommentDrafts: new Map(),
    window: { XuanxueAccount: { ready: async () => account, csrfHeaders: h => h } },
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ item: { id: calls.length, body: JSON.parse(init.body).body } }) }; },
    syncCommentAuthState() {}, clearCommentReply() {}, showToast() {},
    renderComments: post => displayed.push(post.slug),
    renderCommentComposer(_host, slug, published, expired) {
      const input = { value: '', reportValidity: () => true, addEventListener() {} };
      const parts = { '[data-comment-length]': {}, '[data-comment-state]': { dataset: {} }, 'button[type=submit]': { disabled: false, isConnected: true } };
      host.form = {
        dataset: {}, elements: { body: input, reading_reply: { checked: false } },
        querySelector: s => parts[s], addEventListener: (name, handler) => { if (name === 'submit') host.form.submit = handler; },
        reset() { this.elements.body.value = ''; this.elements.reading_reply.checked = false; },
      };
      ctx.bindCommentForm(host, slug, published, expired);
    },
  };
  runInNewContext(section('community.js', '  function bindCommentForm(', '  function syncCommentAuthState(') +
    section('community.js', '  function appendPreviewComment(', '  const previewCommentDrafts') +
    section('community.js', '  function renderPreviewCommentComposer(', '  document.addEventListener("xuanshu:authchange", event => {'), ctx);
  const open = slug => {
    const post = { slug, system: 'liuyao', comments_enabled: true, comments_write_ready: true, comments: [] };
    ctx.activePreview = post;
    ctx.renderPreviewCommentEntry(post);
    return post;
  };
  return { ctx, host, calls, displayed, open };
}

test('A → B replies use B, and each post retains only its own draft', async () => {
  const h = commentHarness();
  h.open('post-a');
  h.host.form.elements.body.value = 'draft for A';
  h.host.form.dataset.replyParentId = '99';
  h.open('post-b');
  assert.equal(h.host.form.elements.body.value, '');
  h.host.form.elements.body.value = 'reply for B';
  await h.host.form.submit({ preventDefault() {} });
  assert.equal(h.calls[0].url, '/api/community/posts/post-b/comments');
  assert.equal(h.calls[0].body.parent_id, null);
  assert.deepEqual(h.displayed, ['post-b']);
  h.open('post-a');
  assert.equal(h.host.form.elements.body.value, 'draft for A');
  await h.host.form.submit({ preventDefault() {} });
  assert.equal(h.calls[1].url, '/api/community/posts/post-a/comments');
});

test('a delayed A response does not replace the comments currently visible in B', () => {
  const h = commentHarness();
  const a = h.open('post-a');
  h.open('post-b');
  h.ctx.appendPreviewComment(a, { id: 1, body: 'delayed result' });
  assert.equal(a.comments.length, 1);
  assert.deepEqual(h.displayed, []);
});

const profileSource = section('modules/profile-workspace.js', 'async function profileResumeSessionId(', 'async function openSavedProfile(');
function resumeHarness(task) {
  const calls = [];
  const ctx = {
    validSessionId: value => /^s_[a-z0-9]{16}$/.test(value || ''),
    restoredTaskTime: (value, fallback) => Date.parse(value) || fallback,
    fetch: async url => { calls.push(url); return { ok: true, json: async () => task }; },
  };
  runInNewContext(profileSource, ctx);
  return { resolve: ctx.profileResumeSessionId, calls };
}
test('a completed Liuyao history resolves its existing session instead of opening an empty one', async () => {
  const h = resumeHarness({ session_id: 's_1234567890abcdef' });
  const sid = await h.resolve({ system: 'liuyao', history: [{ task_id: 'completed-task', created_at: '2026-09-09T12:00:00' }], active_tasks: [] });
  assert.equal(sid, 's_1234567890abcdef');
  assert.deepEqual(h.calls, ['/api/interpret/tasks/completed-task']);
});
test('newer running/failed/cancelled tasks retain their own session; fresh/empty archives do not resume', async () => {
  for (const status of ['running', 'failed', 'cancelled']) {
    const h = resumeHarness();
    const data = { system: 'liuyao', history: [{ task_id: 'old', created_at: '2026-09-08' }], active_tasks: [{ status, session_id: 's_1234567890abcdef', created_at: '2026-09-09' }] };
    assert.equal(await h.resolve(data), 's_1234567890abcdef');
    assert.equal(await h.resolve(data, { freshConversation: true }), '');
    assert.equal(await h.resolve({ system: 'liuyao', history: [] }), '');
    assert.deepEqual(h.calls, []);
  }
});
test('unrecoverable history reports failure instead of silently starting a new paid interpretation', async () => {
  const h = resumeHarness({ session_id: '' });
  await assert.rejects(h.resolve({ system: 'liuyao', history: [{ task_id: 'broken' }] }), /会话标识/);
});

test('composer drafts are isolated by chart and session, restored on return, and removed on logout', () => {
  const input = { value: '' };
  const ctx = { $: () => input, activeChartId: 1, state: { activeTab: '解读' }, workspace: 'bazi', sid: 'session-1' };
  ctx.currentWorkspaceKey = () => ctx.workspace;
  ctx.sessionIdForTab = () => ctx.sid;
  runInNewContext(section('modules/chat-workspace.js', 'const composerDrafts', 'function switchTab('), ctx);
  ctx.syncComposerDraft(); input.value = 'bazi draft';
  ctx.activeChartId = 2; ctx.workspace = 'liuyao'; ctx.sid = 'session-2'; ctx.syncComposerDraft();
  assert.equal(input.value, ''); input.value = 'liuyao draft';
  ctx.activeChartId = 1; ctx.workspace = 'bazi'; ctx.sid = 'session-1'; ctx.syncComposerDraft();
  assert.equal(input.value, 'bazi draft');
  ctx.sid = 'new-session'; ctx.syncComposerDraft(); assert.equal(input.value, '');
  ctx.clearComposerDrafts(); ctx.sid = 'session-1'; ctx.syncComposerDraft(); assert.equal(input.value, '');
});

test('opening a completed archive loads messages with the original session and starts no new interpretation', async () => {
  const requests = [];
  const profile = { id: 7, chart_id: 70, system: 'liuyao', name: 'saved oracle', input: {}, payload: {}, history: [{ task_id: 'done-task', created_at: '2026-09-09' }], active_tasks: [] };
  const ctx = {
    state: { screen: 'archives', sessionIds: {}, threads: {} }, lastPayload: null, sessionStore: {},
    currentWorkspaceKey: () => 'bazi', clearPersonalCaseContext() {},
    validSessionId: value => value === 's_1234567890abcdef', restoredTaskTime: value => Date.parse(value),
    fetch: async (url, init) => {
      requests.push({ url, init });
      const data = url === '/api/profiles/7' ? profile : url.startsWith('/api/interpret/tasks/') ? { session_id: 's_1234567890abcdef' } : { items: [{ ok: true, chart_id: 70, input: {}, payload: {}, messages: [{ role: 'user', content: 'original question' }, { role: 'assistant', id: 8, content: 'original answer', task_id: 'done-task' }] }] };
      return { ok: true, json: async () => data };
    },
    calendarFromInput: () => '六爻', resetThreads() { ctx.state.threads = {}; ctx.state.sessionIds = {}; },
    closeProfileModal: async () => {}, enterDashboard() {}, saveResumeCookie() {},
    refreshAccountProfileIndex: async () => {}, toast() {}, humanError: x => x,
    scenarioLabel: () => '断卦', suggestedFollowups: () => [],
  };
  runInNewContext(profileSource + section('modules/profile-workspace.js', 'async function openSavedProfile(', 'async function openHistoryModal(') + section('app.js', 'function chatRowsToThread(', 'function restoredTaskTime('), ctx);
  assert.equal(await ctx.openSavedProfile(7), true);
  assert.equal(ctx.state.sessionIds['断卦'], 's_1234567890abcdef');
  assert.equal(ctx.state.threads['断卦'][1].body, 'original answer');
  assert.equal(JSON.parse(requests.find(r => r.url === '/api/resume').init.body).items[0].session_id, 's_1234567890abcdef');
  assert.equal(requests.some(r => r.url === '/api/interpret'), false);
});
