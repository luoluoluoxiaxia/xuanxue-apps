import { h, fill } from "../lib/dom.js?v=n16";
import { get, post, patch, del, query } from "../lib/api.js?v=n16";
import { session } from "../lib/store.js?v=n16";
import { ANNOTATION_COLORS, ANCHOR_STATUS_LABELS, annotationMatches, annotationRange, selectionAnchor } from "../lib/book-annotations.js?v=n16";
import { createBookDecorator } from "../lib/book-decoration.js?v=n16";
import { openSheet, confirmDialog } from "./overlay.js?v=n16";
import { errorView, spinnerLine } from "./bits.js?v=n16";
import { toast, toastError } from "./toast.js?v=n16";

const SELECTION_MESSAGES = {
  cross_block: "请一次选取同一段、同一栏的文字，再保存划线。跨段内容可分次标记。",
  too_long: "一次最多标记 2,000 个字，请缩短所选内容。",
  unavailable: "这一段暂不支持精确标记，请先收藏本页。",
};
const accountKey = state => state.authenticated && state.user?.id ? String(state.user.id) : "";
const readBook = value => typeof value === "function" ? value() : value;
const readableLayer = layer => layer === "modern" ? "白话" : "原文";

// Personal data lives only in account APIs and this reader's short-lived memory.
// Every page/account transition aborts requests and invalidates response guards.
export function setupBookAnnotations({ content, book, getSection, getMode, onNavigate, ctx }) {
  let disposed = false, generation = 0, owner = accountKey(session.get());
  let currentSection = null, annotations = [], pageController = null, activeSheet = null;
  let pendingSelection = null, selectionFrame = null, focusTimer = null;
  let lastRefreshAttempt = 0;
  const requests = new Set();
  const decorator = createBookDecorator(content, { onActivate: item => {
    const current = annotations.find(annotation => annotation.id === item.id);
    const block = currentSection?.blocks?.find(value => value.id === current?.block_id);
    if (!disposed && owner === accountKey(session.get()) && current && annotationMatches(current, currentSection, block)) editAnnotation({ item: current });
  } });
  const supportsHighlights = () => decorator.available;
  const statusNode = h("p", { class: "book-annotation-status", role: "status", "aria-live": "polite", hidden: true });
  const floating = h("div", { class: "book-selection-actions", role: "toolbar", "aria-label": "所选文字操作", hidden: true });
  const selectionStatus = h("span", { class: "book-selection-status", role: "status" });
  const saveHighlight = h("button", { type: "button", class: "btn btn-soft", onClick: () => saveSelection(false) }, "划线");
  const writeNote = h("button", { type: "button", class: "btn btn-primary", onClick: () => saveSelection(true) }, "写笔记");
  fill(floating, selectionStatus, saveHighlight, writeNote);
  document.body.append(floating);
  // Do not let a pointer press collapse the selection before we capture it.
  floating.addEventListener("pointerdown", event => { if (event.target.closest("button")) event.preventDefault(); });

  function path() { return `/api/books/${encodeURIComponent(readBook(book)?.id || "")}/annotations`; }
  function live(token, account = owner) { return !disposed && ctx.isCurrent() && token === generation && account && account === owner && account === accountKey(session.get()); }
  function newRequest() {
    const controller = new AbortController(); requests.add(controller);
    return { controller, options: { signal: controller.signal, cache: "no-store" }, done: () => requests.delete(controller) };
  }
  function report(message) { statusNode.textContent = message; statusNode.hidden = !message; }
  function closeSheet(reason = "change") { const sheet = activeSheet; activeSheet = null; sheet?.close(reason); }
  function clearHighlights() {
    decorator.clear();
  }
  function invalidate({ close = true } = {}) {
    generation += 1;
    for (const controller of requests) controller.abort();
    requests.clear(); pageController = null;
    annotations = []; pendingSelection = null; floating.hidden = true;
    clearHighlights(); report("");
    for (const target of content.querySelectorAll(".book-annotation-target")) target.classList.remove("book-annotation-target");
    clearTimeout(focusTimer);
    // Overlay close animations last briefly. Remove private text immediately,
    // before an account/page change can expose an old account's closing sheet.
    if (close) { if (activeSheet?.body) fill(activeSheet.body); closeSheet(); }
  }
  function textElement(annotation) {
    const block = [...content.querySelectorAll(".book-block[data-block-id]")].find(node => node.dataset.blockId === annotation.block_id);
    return block?.querySelector(annotation.layer === "modern" ? ".book-modern p, .book-modern h3, .book-modern pre" : ".book-original p, .book-original h3, .book-original pre");
  }
  function paintHighlights() {
    clearHighlights();
    if (!supportsHighlights() || !owner || !currentSection) return;
    const decorations = [];
    for (const annotation of annotations) {
      const block = currentSection.blocks?.find(item => item.id === annotation.block_id);
      if (!annotationMatches(annotation, currentSection, block)) continue;
      const range = annotationRange(textElement(annotation), annotation);
      if (range && ANNOTATION_COLORS[annotation.color]) decorations.push({ item: annotation, range });
    }
    if (!decorator.paint(decorations)) report("此浏览器暂不能在正文显示划线；标记仍可在“笔记”中查看和定位。");
  }
  async function loadSectionAnnotations() {
    if (!currentSection || !owner || disposed) return;
    lastRefreshAttempt = Date.now();
    pageController?.abort();
    const request = newRequest(); pageController = request.controller;
    const token = generation, account = owner, number = currentSection.number;
    const collected = [];
    try {
      let offset = 0, total = 0;
      do {
        const response = await get(path() + query({ section_number: number, limit: 200, offset }), request.options);
        if (!live(token, account) || pageController !== request.controller) return;
        collected.push(...response.items); total = response.total; offset += response.items.length;
        if (!response.items.length) break;
      } while (offset < total);
      annotations = collected; paintHighlights();
      report(!supportsHighlights() && annotations.some(item => item.kind === "highlight") ? "此浏览器暂不能在正文显示划线；已同步的标记可在“笔记”中查看和定位。" : "");
    } catch (error) {
      if (!live(token, account) || pageController !== request.controller || error?.name === "AbortError") return;
      if (error.isAuth) { invalidate(); report("登录已失效，打开笔记重新登录后查看标记。"); }
      else report("标记暂未载入，打开笔记重试。阅读正文不受影响。");
    } finally { request.done(); if (pageController === request.controller) pageController = null; }
  }
  function captureSelection() {
    const result = selectionAnchor(content, currentSection, window.getSelection());
    if (result.anchor) return result;
    return { ...result, message: SELECTION_MESSAGES[result.reason] || "" };
  }
  function scheduleSelection() {
    cancelAnimationFrame(selectionFrame);
    selectionFrame = requestAnimationFrame(() => {
      if (disposed || document.body.classList.contains("is-locked")) { floating.hidden = true; return; }
      const selected = captureSelection();
      pendingSelection = selected.anchor ? selected : null;
      if (!selected.anchor && !selected.message) { floating.hidden = true; return; }
      selectionStatus.textContent = selected.message || "";
      saveHighlight.disabled = writeNote.disabled = !selected.anchor;
      floating.hidden = false;
      // A fixed action strip stays reachable after native mobile selection tools
      // appear; it does not replace, collapse, or mutate the source selection.
    });
  }
  async function authenticated() {
    if (disposed || !ctx.isCurrent()) return false;
    const ok = await ctx.requireAuth("登录后保存划线、书签和笔记，并在各设备间同步。");
    return !!ok && !disposed && ctx.isCurrent() && !!accountKey(session.get());
  }
  function stillSameAnchor(anchor) {
    const section = getSection();
    return section && section.number === anchor.section_number && section.edition_sha256 === anchor.edition_sha256;
  }
  async function recoverAuth(error) {
    if (!error?.isAuth) return;
    invalidate();
    await ctx.requireAuth("登录已失效，请重新登录后再保存；这次操作尚未确认成功。", { force: true });
  }
  async function createAnnotation(anchor, { note = "", color = "yellow" } = {}) {
    const request = newRequest(), token = generation, account = owner;
    try {
      const item = await post(path(), { ...anchor, note, color }, request.options);
      if (!live(token, account) || !stillSameAnchor(anchor)) return null;
      annotations = [...annotations.filter(existing => existing.id !== item.id), item]; paintHighlights();
      loadSectionAnnotations(); return item;
    } finally { request.done(); }
  }
  async function saveSelection(withNote) {
    const selected = pendingSelection || captureSelection();
    floating.hidden = true;
    if (!selected.anchor) { if (selected.message) toast(selected.message); return; }
    const anchor = { ...selected.anchor };
    if (!await authenticated() || !stillSameAnchor(anchor)) return;
    if (withNote) { editAnnotation({ anchor }); return; }
    const token = generation, account = owner;
    saveHighlight.disabled = true;
    try {
      const item = await createAnnotation(anchor);
      if (item) { window.getSelection()?.removeAllRanges(); pendingSelection = null; toast("划线已保存到账号", { type: "ok" }); }
    } catch (error) {
      if (error?.name !== "AbortError" && live(token, account)) { toastError(error); await recoverAuth(error); }
    } finally { saveHighlight.disabled = false; }
  }
  function bookmarkAnchor() {
    const section = currentSection;
    if (!section?.edition_sha256) return null;
    return { kind: "bookmark", section_number: section.number, edition_sha256: section.edition_sha256,
      block_id: "", layer: "original", start: 0, end: 0, quote: "" };
  }
  async function openSaveBookmark(returnFocus) {
    const anchor = bookmarkAnchor();
    if (!anchor) { toast("请等正文打开后再收藏本页。"); return; }
    if (!await authenticated() || !stillSameAnchor(anchor)) return;
    editAnnotation({ anchor, returnFocus });
  }
  function editAnnotation({ item = null, anchor = null, returnFocus = null, draft = null }) {
    closeSheet();
    // The note-list row is removed when its editor opens. Return keyboard
    // focus to the reader's persistent notes control when the editor closes.
    returnFocus = content.closest(".book-reading")?.querySelector(".book-notes-open") || returnFocus;
    const token = generation, account = owner;
    const target = item || anchor;
    const note = h("textarea", { class: "book-annotation-note-input", rows: 5, maxLength: 8000,
      placeholder: "写下理解、疑问或待查出处（最多 4,000 字）", "aria-label": "私人笔记", value: draft?.note ?? item?.note ?? "" });
    const color = h("select", { "aria-label": "划线颜色" }, Object.entries(ANNOTATION_COLORS).map(([value, name]) =>
      h("option", { value, selected: value === (draft?.color || item?.color || "yellow") }, name)));
    const state = h("p", { class: "book-annotation-form-status", role: "status", "aria-live": "polite" });
    const save = h("button", { type: "submit", class: "btn btn-primary" }, "保存到账号");
    let closed = false, saving = false, mutation = null;
    const form = h("form", { class: "book-annotation-form", onSubmit: async event => {
      event.preventDefault();
      if (saving || closed || !live(token, account)) return;
      if ([...note.value].length > 4000) { state.textContent = "笔记最多 4,000 字，请精简后再保存。"; return; }
      saving = true; save.disabled = true; state.textContent = "正在保存到账号…";
      mutation = newRequest();
      try {
        const saved = item
          ? await patch(`${path()}/${encodeURIComponent(item.id)}`, { note: note.value, color: color.value, revision: item.revision }, mutation.options)
          : await post(path(), { ...anchor, note: note.value, color: color.value }, mutation.options);
        if (!live(token, account) || closed) return;
        annotations = [...annotations.filter(existing => existing.id !== saved.id), saved]; paintHighlights(); loadSectionAnnotations();
        sheet.close("saved"); window.getSelection()?.removeAllRanges(); pendingSelection = null;
        toast(target.kind === "bookmark" ? "书签已保存到账号" : "笔记与划线已保存到账号", { type: "ok" });
      } catch (error) {
        if (!live(token, account) || closed || error?.name === "AbortError") return;
        state.textContent = item && error.status === 409 ? "这条笔记已在其他设备更新。请重新打开笔记查看最新内容，再修改；本次输入尚未保存。" : (error.message || "保存没有成功，请重试。");
        state.setAttribute("role", "alert");
        if (error.isAuth) {
          const unsaved = { note: note.value, color: color.value };
          await recoverAuth(error);
          // A same-account login may recover the unsaved form from memory.
          // Another account, page, or unmounted reader must never receive it.
          if (!disposed && ctx.isCurrent() && owner === account && stillSameAnchor(target)) editAnnotation({ item, anchor, returnFocus, draft: unsaved });
        }
      } finally { mutation?.done(); mutation = null; saving = false; if (!closed) save.disabled = false; }
    } }, target.quote ? h("blockquote", { class: "book-annotation-quote" }, target.quote) : h("p", null, `收藏第 ${target.section_number} 页`),
      item && item.anchor_status !== "matched" ? h("p", { class: "books-notice" }, ANCHOR_STATUS_LABELS[item.anchor_status] || "来源位置待核对") : null,
      target.kind === "highlight" ? h("label", null, "颜色", color) : null,
      h("label", null, "私人笔记", note), h("p", { class: "books-notice" }, "登录账号私有保存，重新登录同一账号后可在其他设备查看。"), state, save);
    const sheet = openSheet({ title: item ? "编辑笔记" : target.kind === "bookmark" ? "收藏本页" : "添加划线与笔记",
      className: "sheet-book-annotations", body: form, returnFocus,
      onClose: () => { closed = true; mutation?.controller.abort(); if (activeSheet === sheet) activeSheet = null; } });
    activeSheet = sheet;
  }
  function annotationRow(item, sheet, refresh) {
    const kind = item.kind === "bookmark" ? "书签" : `${readableLayer(item.layer)}划线`;
    const position = h("button", { type: "button", class: "book-annotation-location", onClick: () => {
      sheet.close("locate"); onNavigate?.(item);
    } }, `第 ${item.section_number} 页 · ${kind} · 回到正文 ↗`);
    const edit = h("button", { type: "button", class: "btn btn-ghost", onClick: () => editAnnotation({ item, returnFocus: edit }) }, "编辑");
    const remove = h("button", { type: "button", class: "btn btn-ghost", onClick: async () => {
      const token = generation, account = owner;
      const confirmed = await confirmDialog({ title: "删除这条标记？", message: "删除后，各设备上的这条划线、书签和笔记也会同步移除。", confirmText: "删除", danger: true, returnFocus: remove });
      if (!confirmed || !live(token, account)) return;
      const request = newRequest(); remove.disabled = true;
      try {
        await del(`${path()}/${encodeURIComponent(item.id)}`, request.options);
        if (!live(token, account)) return;
        annotations = annotations.filter(existing => existing.id !== item.id); paintHighlights();
        toast("标记已删除", { type: "ok" }); refresh();
      } catch (error) {
        if (live(token, account) && error?.name !== "AbortError") { toastError(error); await recoverAuth(error); }
      } finally { request.done(); remove.disabled = false; }
    } }, "删除");
    return h("article", { class: "book-annotation-item", dataset: { color: item.color, annotationId: item.id } },
      position, item.anchor_status !== "matched" ? h("p", { class: "book-annotation-anchor-warning" }, ANCHOR_STATUS_LABELS[item.anchor_status] || "来源位置待核对") : null,
      item.quote ? h("blockquote", { class: "book-annotation-quote" }, item.quote) : null,
      item.note ? h("p", { class: "book-annotation-note" }, item.note) : null,
      h("div", { class: "book-annotation-item-actions" }, edit, remove));
  }
  async function openNotes(returnFocus) {
    const selected = pendingSelection || captureSelection();
    floating.hidden = true;
    if (!await authenticated()) return;
    closeSheet(); loadSectionAnnotations();
    const token = generation, account = owner;
    let closed = false, items = [], total = 0, loading = false, listRequest = null;
    const rows = h("div", { class: "book-annotation-list" });
    const count = h("p", { class: "books-count", role: "status" });
    const more = h("button", { type: "button", class: "btn btn-soft", hidden: true, onClick: () => load(false) }, "加载更多");
    const bookmark = h("button", { type: "button", class: "btn btn-soft", onClick: () => {
      sheet.close("bookmark"); openSaveBookmark(returnFocus);
    } }, "收藏本页");
    const selectedAction = selected.anchor && stillSameAnchor(selected.anchor)
      ? h("button", { type: "button", class: "btn btn-primary", onClick: () => editAnnotation({ anchor: selected.anchor, returnFocus }) }, "为所选文字写笔记") : null;
    const sheet = openSheet({ title: `${readBook(book)?.title || "本书"} · 我的笔记`, className: "sheet-book-annotations", returnFocus,
      body: [h("div", { class: "book-annotation-actions" }, bookmark, selectedAction),
        selected.message ? h("p", { class: "books-notice", role: "status" }, selected.message) : null,
        h("p", { class: "books-notice" }, "划线、书签与笔记保存在当前账号，仅自己可见，可在其他设备继续查看。"),
        !supportsHighlights() ? h("p", { class: "books-notice" }, "此浏览器暂不支持正文划线显示，仍可保存、查看和定位标记。") : null,
        count, rows, more],
      onClose: () => { closed = true; listRequest?.controller.abort(); if (activeSheet === sheet) activeSheet = null; } });
    activeSheet = sheet;
    function paintRows() {
      count.textContent = `本书共 ${total} 条标记 · 已显示 ${items.length} 条`;
      fill(rows, items.length ? items.map(item => annotationRow(item, sheet, () => load(true)))
        : h("p", { class: "books-notice" }, "还没有标记。选取正文文字即可划线或写笔记，也可以收藏整页。"));
      more.hidden = items.length >= total;
    }
    async function load(reset) {
      if (closed || !live(token, account)) return;
      if (loading && !reset) return;
      listRequest?.controller.abort();
      const request = newRequest(); listRequest = request; loading = true; more.disabled = true;
      if (reset) { items = []; fill(rows, spinnerLine("正在载入账号中的笔记…")); more.hidden = true; }
      try {
        const response = await get(path() + query({ limit: 200, offset: items.length }), request.options);
        if (!live(token, account) || closed || listRequest !== request) return;
        items = [...items, ...response.items]; total = response.total; paintRows();
      } catch (error) {
        if (!live(token, account) || closed || listRequest !== request || error?.name === "AbortError") return;
        // Already loaded rows survive a failed next page and the retry remains
        // explicit; a failed first page is never presented as an empty account.
        const failure = errorView(error, () => load(reset), { title: "笔记暂未载入" });
        if (items.length) { paintRows(); rows.append(failure); } else fill(rows, failure);
        if (error.isAuth) await recoverAuth(error);
      } finally { request.done(); if (listRequest === request) { loading = false; more.disabled = false; } }
    }
    load(true);
  }
  function locate(annotation) {
    if (!owner || owner !== accountKey(session.get()) || !currentSection || annotation.anchor_status !== "matched" ||
        annotation.edition_sha256 !== currentSection.edition_sha256 || annotation.section_number !== currentSection.number) return false;
    if (annotation.kind === "bookmark") { content.scrollIntoView({ block: "start", behavior: "instant" }); return true; }
    const element = textElement(annotation);
    if (!element) return false;
    const block = currentSection.blocks?.find(item => item.id === annotation.block_id);
    if (!annotationMatches(annotation, currentSection, block)) return false;
    for (const details of [...content.querySelectorAll("details")]) if (details.contains(element)) details.open = true;
    let rect = null;
    if (supportsHighlights()) {
      const range = annotationRange(element, annotation);
      if (range) rect = decorator.focus({ item: annotation, range });
    }
    const target = element.closest(".book-block") || element;
    if (rect && Number.isFinite(rect.top) && rect.height > 0) {
      const controls = content.closest(".book-reading")?.querySelector(".book-reading-controls");
      const top = controls?.getBoundingClientRect().bottom || 0;
      window.scrollTo(0, window.scrollY + rect.top - Math.max(80, top + 20));
    } else target.scrollIntoView({ block: "center", behavior: "instant" });
    target.classList.add("book-annotation-target"); clearTimeout(focusTimer);
    focusTimer = setTimeout(() => { target.classList.remove("book-annotation-target"); decorator.clearFocus(); }, 2400);
    return true;
  }
  function onSection(section = getSection()) {
    invalidate(); currentSection = section || null;
    if (currentSection && owner) loadSectionAnnotations();
  }
  const stopSession = session.subscribe(state => {
    const nextOwner = accountKey(state);
    if (nextOwner === owner) return;
    invalidate(); owner = nextOwner;
    if (owner && currentSection) loadSectionAnnotations();
  });
  function refreshOnReturn() {
    // A device returning to its reader catches up with another device's changes.
    // Do not poll hidden tabs, interrupt a draft sheet, or race an active read.
    if (disposed || !ctx.isCurrent() || !owner || !currentSection || pageController || activeSheet ||
        document.visibilityState !== "visible" || document.body.classList.contains("is-locked") ||
        Date.now() - lastRefreshAttempt < 2000) return;
    loadSectionAnnotations();
  }
  document.addEventListener("selectionchange", scheduleSelection);
  document.addEventListener("visibilitychange", refreshOnReturn);
  window.addEventListener("focus", refreshOnReturn);
  window.addEventListener("scroll", scheduleSelection, { passive: true });
  function cleanup() {
    if (disposed) return;
    disposed = true; invalidate(); currentSection = null; stopSession();
    cancelAnimationFrame(selectionFrame); clearTimeout(focusTimer); decorator.destroy();
    document.removeEventListener("selectionchange", scheduleSelection);
    document.removeEventListener("visibilitychange", refreshOnReturn);
    window.removeEventListener("focus", refreshOnReturn);
    window.removeEventListener("scroll", scheduleSelection); floating.remove();
  }
  ctx.cleanup(cleanup);
  return { openNotes, openSaveBookmark, onSection, onLayout: () => decorator.refresh(), locate, statusNode, cleanup };
}
