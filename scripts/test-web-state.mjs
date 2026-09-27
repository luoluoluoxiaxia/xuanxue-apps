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
