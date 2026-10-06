// Annotation offsets follow the public API: Unicode code points, never UTF-16
// code units. The canonical DOM retains source line breaks even when CSS folds
// them; do not use innerText or the browser's visible selection string here.
export const ANNOTATION_COLORS = Object.freeze({ yellow: "黄色", green: "绿色", blue: "蓝色", pink: "粉色" });
export const ANCHOR_STATUS_LABELS = Object.freeze({
  edition_changed: "底本已更新，原标记保留，位置待核对",
  section_missing: "来源页暂不可用，原标记保留",
  block_missing: "来源段落已调整，原标记保留",
  quote_mismatch: "原文已调整，标记位置待核对",
});

export function codePointOffset(text, offset) {
  if (typeof text !== "string" || !Number.isInteger(offset) || offset < 0 || offset > text.length) return null;
  if (offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])) return null;
  return [...text.slice(0, offset)].length;
}

export function utf16Offset(text, offset) {
  if (typeof text !== "string" || !Number.isInteger(offset) || offset < 0) return null;
  let count = 0, units = 0;
  for (const character of text) {
    if (count === offset) return units;
    count += 1; units += character.length;
  }
  return count === offset ? units : null;
}

export function annotationMatches(annotation, section, block) {
  if (!annotation || annotation.anchor_status !== "matched" || annotation.kind !== "highlight" ||
      annotation.section_number !== section?.number || annotation.edition_sha256 !== section?.edition_sha256 ||
      annotation.block_id !== block?.id || !["original", "modern"].includes(annotation.layer)) return false;
  const text = annotation.layer === "modern" ? block.modern : block.text;
  const start = utf16Offset(text, annotation.start), end = utf16Offset(text, annotation.end);
  return start !== null && end !== null && end > start && text.slice(start, end) === annotation.quote;
}

function canonicalText(node, content) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  const layer = element?.closest?.(".book-original, .book-modern");
  if (!layer || !content.contains(layer)) return null;
  const canonical = layer.querySelector("p, h3, pre");
  return canonical && (node === canonical || canonical.contains(node)) ? canonical : null;
}

export function selectionAnchor(content, section, selection) {
  if (!section || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return { anchor: null, reason: "empty" };
  const range = selection.getRangeAt(0);
  const first = canonicalText(range.startContainer, content), last = canonicalText(range.endContainer, content);
  if (!first || !last) return { anchor: null, reason: "outside" };
  if (first !== last) return { anchor: null, reason: "cross_block" };
  const blockNode = first.closest(".book-block[data-block-id]");
  const block = section.blocks?.find(item => item.id === blockNode?.dataset.blockId);
  const layer = first.closest(".book-modern") ? "modern" : "original";
  const text = layer === "modern" ? block?.modern : block?.text;
  if (typeof text !== "string" || first.textContent !== text || !section.edition_sha256) return { anchor: null, reason: "unavailable" };
  const before = range.cloneRange(); before.selectNodeContents(first); before.setEnd(range.startContainer, range.startOffset);
  const through = range.cloneRange(); through.selectNodeContents(first); through.setEnd(range.endContainer, range.endOffset);
  const start = codePointOffset(text, before.toString().length), end = codePointOffset(text, through.toString().length);
  if (start === null || end === null || end <= start) return { anchor: null, reason: "empty" };
  if (end - start > 2000) return { anchor: null, reason: "too_long" };
  return { reason: "", range: range.cloneRange(), anchor: { kind: "highlight", section_number: section.number,
    block_id: block.id, layer, start, end, quote: [...text].slice(start, end).join(""), edition_sha256: section.edition_sha256 } };
}

export function annotationRange(element, annotation) {
  const text = element?.textContent;
  const start = utf16Offset(text, annotation?.start), end = utf16Offset(text, annotation?.end);
  if (start === null || end === null || end <= start || text.slice(start, end) !== annotation.quote) return null;
  const walker = element.ownerDocument.createTreeWalker(element, 4); // NodeFilter.SHOW_TEXT
  const range = element.ownerDocument.createRange();
  let node, seen = 0, foundStart = false;
  while ((node = walker.nextNode())) {
    const next = seen + node.data.length;
    if (!foundStart && start <= next) { range.setStart(node, start - seen); foundStart = true; }
    if (foundStart && end <= next) { range.setEnd(node, end - seen); return range; }
    seen = next;
  }
  return null;
}
