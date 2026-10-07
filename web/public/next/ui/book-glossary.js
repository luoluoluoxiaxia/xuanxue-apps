import { h, fill } from "../lib/dom.js?v=n20";
import { indexBookGlossary, bookTermRanges, bookTextRuns } from "../lib/book-glossary.js?v=n20";

let glossarySequence = 0;

export function renderBookText(parts, terms, layer, senses) {
  const text = parts.map(part => part.text).join("");
  const ranges = bookTermRanges(text, terms, layer, senses);
  const source = part => part.kind
    ? h("span", { class: "book-source-break", dataset: { kind: part.kind } }, part.text) : part.text;
  return bookTextRuns(parts, ranges).map(run => run.sense_id
    ? h("span", { class: "book-term", role: "button", tabindex: "0", "aria-haspopup": "dialog",
      "aria-expanded": "false", "aria-label": `${run.parts.map(part => part.text).join("")}，查看释义`,
      dataset: { senseId: run.sense_id } }, run.parts.map(source))
    : run.parts.map(source));
}

export function setupBookGlossary({ content, ctx }) {
  const id = `book-glossary-${++glossarySequence}`;
  const title = h("h3", { id: `${id}-title` });
  const definition = h("p", { id: `${id}-definition`, class: "book-glossary-definition" });
  const details = h("div", { class: "book-glossary-details" });
  const closeButton = h("button", { type: "button", class: "book-glossary-close", "aria-label": "关闭术语释义",
    onClick: () => close(true) }, "×");
  // This lives outside the canonical paragraph so copy, selection and personal
  // annotation offsets can only see the exact published reading text.
  const popup = h("aside", { id, class: "book-glossary-popover", role: "dialog", "aria-modal": "false",
    "aria-labelledby": `${id}-title`, hidden: true },
    h("div", { class: "book-glossary-heading" }, title, closeButton), definition, details);
  document.body.append(popup);
  let senses = new Map(), active = null, pinned = false, disposed = false;
  let closeTimer = null, pointer = null, popupHovered = false, suppressFocus = false;
  const removers = [];
  function listen(node, type, listener, options) {
    node.addEventListener(type, listener, options);
    removers.push(() => node.removeEventListener(type, listener, options));
  }
  function termFrom(target) {
    const term = target?.closest?.(".book-term[data-sense-id]");
    return term && content.contains(term) ? term : null;
  }
  function selectionActive() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount < 1 || selection.isCollapsed) return false;
    // Readers may select and copy a definition too. Only source/outside
    // selections take priority over term activation and dismiss this popover.
    return !(popup.contains(selection.anchorNode) && popup.contains(selection.focusNode));
  }
  function cancelClose() { clearTimeout(closeTimer); closeTimer = null; }
  function restorePointerFocus() {
    if (pointer?.term && pointer.tabindex !== null) pointer.term.setAttribute("tabindex", pointer.tabindex);
  }
  function clearPointer() { restorePointerFocus(); pointer = null; }
  function close(returnFocus = false) {
    cancelClose();
    const previous = active;
    active?.setAttribute("aria-expanded", "false");
    active?.removeAttribute("aria-controls"); active?.removeAttribute("aria-describedby");
    active = null; pinned = false; popupHovered = false; popup.hidden = true;
    fill(title); fill(definition); fill(details);
    if (returnFocus && previous?.isConnected) {
      suppressFocus = true; previous.focus({ preventScroll: true }); suppressFocus = false;
    }
  }
  function position() {
    if (!active || popup.hidden || !active.isConnected) return;
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft || 0, topEdge = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
    popup.style.maxWidth = `${Math.max(0, width - 24)}px`;
    popup.style.maxHeight = `${Math.max(0, height - 24)}px`;
    const rect = active.getBoundingClientRect(), box = popup.getBoundingClientRect();
    const left = Math.max(leftEdge + 12, Math.min(rect.left, leftEdge + width - box.width - 12));
    let top = rect.bottom + 8;
    if (top + box.height > topEdge + height - 12) top = rect.top - box.height - 8;
    top = Math.max(topEdge + 12, Math.min(top, topEdge + height - box.height - 12));
    popup.style.left = `${left}px`; popup.style.top = `${top}px`;
  }
  function open(term, pin = false) {
    if (disposed || !ctx.isCurrent() || selectionActive()) return;
    const sense = senses.get(term.dataset.senseId);
    if (!sense) return;
    cancelClose();
    if (active !== term) {
      close(); active = term;
      title.textContent = sense.term; definition.textContent = sense.definition;
      const explanation = typeof sense.explanation === "string" ? sense.explanation : "";
      const usage = typeof sense.usage_note === "string" ? sense.usage_note : "";
      fill(details, explanation && explanation !== sense.definition || usage
        ? h("details", { onToggle: position }, h("summary", null, "详细说明"),
          explanation && explanation !== sense.definition ? h("p", null, explanation) : null,
          usage ? h("p", null, h("b", null, "本书用法："), usage) : null) : null);
      popup.hidden = false;
      term.setAttribute("aria-expanded", "true"); term.setAttribute("aria-controls", id);
      term.setAttribute("aria-describedby", `${id}-definition`);
    }
    pinned = pinned || pin;
    position();
  }
  function scheduleClose() {
    cancelClose();
    if (pinned) return;
    // The short delay lets a pointer cross the gap into the readable popover.
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (!pinned && !popupHovered && document.activeElement !== active && !popup.contains(document.activeElement)) close();
    }, 220);
  }
  listen(content, "pointerover", event => {
    if (event.pointerType === "touch" || event.buttons || pointer && !pointer.released ||
        !window.matchMedia("(hover: hover)").matches) return;
    const term = termFrom(event.target);
    if (term && (!pinned || active === term) && !term.contains(event.relatedTarget)) open(term);
  });
  listen(content, "pointerout", event => {
    const term = termFrom(event.target);
    if (term === active && !term.contains(event.relatedTarget) && !popup.contains(event.relatedTarget)) scheduleClose();
  });
  listen(popup, "pointerenter", () => { popupHovered = true; cancelClose(); });
  listen(popup, "pointerleave", () => { popupHovered = false; scheduleClose(); });
  listen(content, "focusin", event => {
    const term = termFrom(event.target);
    // Touch compatibility focus can arrive after pointerup but before click.
    // Let click decide whether the completed gesture was a tap or a long press.
    if (term && !pointer && !suppressFocus) open(term);
  });
  listen(content, "focusout", event => {
    if (termFrom(event.target) === active && !popup.contains(event.relatedTarget)) scheduleClose();
  });
  listen(content, "pointerdown", event => {
    clearPointer();
    if (event.button > 0 || event.isPrimary === false) return;
    const term = termFrom(event.target);
    pointer = { term, x: event.clientX, y: event.clientY, time: Date.now(),
      selected: selectionActive(), moved: false, released: false,
      wasPinned: active === term && pinned, tabindex: term?.getAttribute("tabindex") ?? null };
    // Chrome's default pointer focus on an inline tabindex element can swallow
    // selection when the drag begins on its text. Keep native pointer selection
    // by leaving it unfocusable for this gesture; restore keyboard access on up.
    // Never preventDefault here: that would also cancel native text selection.
    term?.removeAttribute("tabindex");
    close();
  });
  listen(content, "pointermove", event => {
    if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6) pointer.moved = true;
  });
  listen(content, "pointercancel", () => { clearPointer(); close(); });
  listen(content, "contextmenu", () => { clearPointer(); close(); });
  listen(content, "click", event => {
    const term = termFrom(event.target), press = pointer;
    clearPointer();
    if (!term || selectionActive() || press && (press.selected || press.moved || Date.now() - press.time > 450)) return;
    if (press?.wasPinned || active === term && pinned) close(); else open(term, true);
  });
  listen(document, "pointerdown", event => {
    if (!content.contains(event.target)) clearPointer();
    if (active && !popup.contains(event.target) && !termFrom(event.target)) close();
  });
  listen(document, "pointerup", event => {
    if (!pointer) return;
    restorePointerFocus(); pointer.released = true;
  });
  listen(window, "blur", () => { clearPointer(); close(); });
  listen(document, "focusin", event => {
    if (active && !popup.contains(event.target) && termFrom(event.target) !== active) close();
  });
  listen(document, "keydown", event => {
    if (pointer?.released || event.key === "Tab") clearPointer();
    const term = termFrom(event.target);
    if (term && ["Enter", " "].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); open(term, true);
    } else if (active && event.key === "Escape") {
      event.preventDefault(); close(true);
    }
  });
  listen(document, "selectionchange", () => { if (selectionActive()) close(); });
  listen(window, "resize", position);
  listen(window, "scroll", position, { passive: true, capture: true });
  if (window.visualViewport) {
    listen(window.visualViewport, "resize", position);
    listen(window.visualViewport, "scroll", position);
  }
  ctx.cleanup(() => {
    disposed = true; close(); senses.clear(); clearPointer();
    removers.forEach(remove => remove()); popup.remove();
  });
  return {
    close,
    onLayout: position,
    onSection(section) { close(); clearPointer(); senses = indexBookGlossary(section?.glossary); },
    renderText(parts, terms, layer) { return renderBookText(parts, terms, layer, senses); },
  };
}
