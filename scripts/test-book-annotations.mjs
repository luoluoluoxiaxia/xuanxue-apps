import { test } from "node:test";
import assert from "node:assert/strict";
import { codePointOffset, utf16Offset, annotationMatches } from "../web/public/next/lib/book-annotations.js";

test("annotation offsets round-trip astral Han characters and retained source line breaks", () => {
  const text = "甲𠮷\n乙😀\n\n丙";
  for (let offset = 0; offset <= [...text].length; offset += 1) {
    const units = utf16Offset(text, offset);
    assert.equal(codePointOffset(text, units), offset);
    assert.equal([...text.slice(0, units)].length, offset);
  }
  assert.equal(codePointOffset(text, 2), null); // Inside 𠮷's surrogate pair.
  assert.equal(codePointOffset(text, 6), null); // Inside 😀's surrogate pair.
  assert.equal(utf16Offset(text, 2), 3);
  assert.equal(utf16Offset(text, 3), 4); // Source LF is still an anchor character.
});

test("invalid or past-end annotation offsets are rejected rather than clamped", () => {
  for (const offset of [-1, 0.5, "1", NaN, Infinity, null, 4]) {
    assert.equal(codePointOffset("甲乙丙", offset), null);
    assert.equal(utf16Offset("甲乙丙", offset), null);
  }
  assert.equal(codePointOffset("", 0), 0);
  assert.equal(utf16Offset("", 0), 0);
  assert.equal(codePointOffset(null, 0), null);
  assert.equal(utf16Offset(null, 0), null);
});

test("only server-matched anchors with the current edition, block, layer, and exact quote can paint", () => {
  const section = { number: 3, edition_sha256: "a".repeat(64) };
  const block = { id: "stable-block", text: "甲𠮷\n乙", modern: "白话😀译文" };
  const annotation = { kind: "highlight", anchor_status: "matched", section_number: 3,
    edition_sha256: section.edition_sha256, block_id: block.id, layer: "original", start: 1, end: 4, quote: "𠮷\n乙" };
  assert.equal(annotationMatches(annotation, section, block), true);
  for (const changed of [
    { kind: "bookmark" }, { section_number: 4 }, { edition_sha256: "b".repeat(64) },
    { block_id: "different-block" }, { layer: "unknown" }, { quote: "𠮷乙" },
    { start: 2 }, { end: 5 }, { end: 1 }, { start: -1 },
    ...["edition_changed", "section_missing", "block_missing", "quote_mismatch"].map(anchor_status => ({ anchor_status })),
  ]) assert.equal(annotationMatches({ ...annotation, ...changed }, section, block), false);
  assert.equal(annotationMatches(annotation, section, null), false);
  assert.equal(annotationMatches({ ...annotation, layer: "modern", start: 2, end: 3, quote: "😀" }, section, block), true);
});
