// The server supplies reviewed senses and exact code-point positions. This
// module only validates display ranges; it never matches words or picks senses.
export function indexBookGlossary(entries) {
  const senses = new Map(), seen = new Set(), repeated = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.id !== "string" || !entry.id) continue;
    if (seen.has(entry.id)) { senses.delete(entry.id); repeated.add(entry.id); }
    seen.add(entry.id);
    if (repeated.has(entry.id) || typeof entry.term !== "string" || !entry.term ||
        typeof entry.definition !== "string" || !entry.definition.trim()) continue;
    senses.set(entry.id, entry);
  }
  return senses;
}

export function bookTermRanges(text, terms, layer, senses) {
  if (typeof text !== "string" || !["original", "modern"].includes(layer) || !(senses instanceof Map)) return [];
  const offsets = [0];
  for (const char of text) offsets.push(offsets.at(-1) + char.length);
  const ranges = (Array.isArray(terms) ? terms : []).filter(term => term && term.layer === layer &&
    Number.isSafeInteger(term.start) && Number.isSafeInteger(term.end) &&
    term.start >= 0 && term.end > term.start && term.end < offsets.length && senses.has(term.sense_id))
    .map(term => ({ start: term.start, end: term.end, sense_id: term.sense_id,
      unitStart: offsets[term.start], unitEnd: offsets[term.end] }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  // An overlap is ambiguous display data. Keep both competing ranges plain,
  // including a chain of overlaps; do not invent client-side precedence.
  const ambiguous = new Set();
  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length && ranges[j].start < ranges[i].end; j += 1) {
      ambiguous.add(i); ambiguous.add(j);
    }
  }
  return ranges.filter((_, index) => !ambiguous.has(index));
}

// Split ranges around the existing source-break parts while retaining every
// source character. A term may wrap several parts, including preserved LFs.
export function bookTextRuns(parts, ranges) {
  const text = parts.map(part => part.text).join("");
  const runs = [];
  let cursor = 0;
  function add(start, end, sense_id = null) {
    if (end <= start) return;
    const fragments = [];
    let offset = 0;
    for (const part of parts) {
      const next = offset + part.text.length;
      if (next > start && offset < end) fragments.push({
        text: part.text.slice(Math.max(0, start - offset), Math.min(part.text.length, end - offset)),
        kind: part.kind || null,
      });
      offset = next;
      if (offset >= end) break;
    }
    runs.push({ sense_id, parts: fragments });
  }
  for (const range of ranges) {
    add(cursor, range.unitStart);
    add(range.unitStart, range.unitEnd, range.sense_id);
    cursor = range.unitEnd;
  }
  add(cursor, text.length);
  return runs;
}
