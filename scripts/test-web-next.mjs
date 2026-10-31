import { test } from 'node:test';
import assert from 'node:assert/strict';

// 新版前端的纯逻辑：在 Node 中直接加载原生 ES 模块（浏览器全局只做最小替身）。
globalThis.window = globalThis.window || { crypto: globalThis.crypto };
globalThis.location = globalThis.location || { hash: '', search: '', origin: 'https://example.test' };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = globalThis.document || { dispatchEvent() {} };

const base = new URL('../web/public/next/', import.meta.url);
const load = path => import(new URL(`${path}?v=n44`, base).href);

test('an open BaZi chart refreshes at Beijing midnight or the supplied solar-term instant, whichever comes first', async () => {
  const { baziChartRefreshAt } = await load('lib/chart-refresh.js');
  const now = Date.parse('2026-10-31T23:30:00+08:00');
  const payload = { analysis_date: '2026-10-31', current_liu_yue: { solar_term_end: { datetime: '2026-11-07 17:51:46' } } };
  assert.equal(baziChartRefreshAt(payload, now), Date.parse('2026-11-01T00:00:00+08:00'));
  assert.equal(baziChartRefreshAt({ ...payload, analysis_date: '2026-11-07' }, now), Date.parse('2026-11-07T17:51:47+08:00'));
  assert.ok(baziChartRefreshAt({ ...payload, analysis_date: '2026-08-06' }, now) < now, 'an old archive is immediately stale');
  assert.equal(baziChartRefreshAt({ analysis_date: '2026-12-31' }, now), Date.parse('2027-01-01T00:00:00+08:00'));
  assert.equal(baziChartRefreshAt({ analysis_date: '2026-10-31', current_liu_yue: null }, now), Date.parse('2026-11-01T00:00:00+08:00'));
  assert.equal(baziChartRefreshAt({}, now), now + 60 * 60 * 1000, 'incomplete records use a bounded retry rather than a hot loop');
});

test('personal-home freshness follows Beijing day and calendar month even when a previous response was complete', async () => {
  const { personalHomeRefreshAt } = await load('lib/chart-refresh.js');
  const ready = { today: '2026-10-31', daily: { status: 'done', day_key: '2026-10-31' }, month: { status: 'done', month_key: '2026-10' } };
  const before = Date.parse('2026-10-31T15:59:59Z');
  const midnight = Date.parse('2026-10-31T16:00:00Z');
  assert.equal(personalHomeRefreshAt(ready, before), midnight);
  assert.equal(personalHomeRefreshAt(ready, midnight), midnight, 'completed cards expire at Beijing midnight, before the UTC date changes');
  const current = { ...ready, today: '2026-11-01', daily: { status: 'done', day_key: '2026-11-01' } };
  assert.equal(personalHomeRefreshAt(current, midnight), midnight, 'an old calendar-month card remains stale even with a new day label');
  assert.equal(personalHomeRefreshAt({ ...current, month: { status: 'done', month_key: '2026-11' } }, midnight), Date.parse('2026-11-02T00:00:00+08:00'));
  assert.equal(personalHomeRefreshAt({ ...current, daily: ready.daily, month: { month_key: '2026-11' } }, midnight), midnight);
  assert.equal(personalHomeRefreshAt({}, Date.parse('2026-12-31T12:00:00+08:00')), Date.parse('2027-01-01T00:00:00+08:00'));
  const termDay = { today: '2026-11-07', daily: { day_key: '2026-11-07' }, month: { month_key: '2026-11', display: { solar_terms: [
    { datetime: '2026-10-23 17:00:00' }, { datetime: '2026-11-07 17:51:46' }, { datetime: '2026-11-22 15:23:00' },
  ] } } };
  assert.equal(personalHomeRefreshAt(termDay, Date.parse('2026-11-07T12:00:00+08:00')), Date.parse('2026-11-07T17:51:47+08:00'));
  assert.equal(personalHomeRefreshAt(termDay, Date.parse('2026-11-07T18:00:00+08:00')), Date.parse('2026-11-08T00:00:00+08:00'));
});

test('new BaZi questions use current time while Liuyao keeps the original cast time and neither mutates archived input', async () => {
  const { Conversation } = await load('lib/interpret.js');
  const input = { year: 1990, month: 1, day: 1, hour: 12, minute: 0, as_of: '2026-08-06', manual_birth_year: 1990 };
  const before = structuredClone(input);
  const options = { input, sessionId: 's_0123456789abcdef', chartId: 7, profileId: 9 };
  const bazi = new Conversation({ ...options, system: 'bazi' }).buildBody('本月情况如何？', { clientRequestId: 'r_0123456789abcdef' });
  assert.ok(!('as_of' in bazi));
  assert.equal(bazi.year, 1990);
  assert.equal(bazi.manual_birth_year, 1990);
  assert.equal(bazi.chart_id, 7);
  assert.equal(bazi.profile_id, 9);
  const liuyao = new Conversation({ ...options, system: 'liuyao' }).buildBody('继续看原卦', { clientRequestId: 'r_0123456789abcdef' });
  assert.equal(liuyao.as_of, input.as_of);
  assert.deepEqual(input, before);
});

test('manual-pillar learning keeps the server birth anchor and explicit birth-year choice without pinning analysis time', async () => {
  const { baziLearnInput } = await load('lib/learn.js');
  const input = { input_mode: 'manual_pillars', year_pillar: '丙午', month_pillar: '庚寅', day_pillar: '甲子', hour_pillar: '甲子',
    pillars: { year: '丙午', month: '庚寅', day: '甲子', hour: '甲子' }, as_of: '2025-10-31', name: '不复制称呼' };
  const before = structuredClone(input);
  const payload = { profile: { input_mode: 'manual_pillars', solar: '1966-02-04 12:00:00' } };
  const anchored = baziLearnInput(input, payload);
  assert.equal(anchored.manual_birth_year, 1966);
  assert.deepEqual(anchored.pillars, input.pillars);
  assert.ok(!('as_of' in anchored));
  assert.ok(!('name' in anchored));
  assert.equal(baziLearnInput({ ...input, manual_birth_year: 2026 }, payload).manual_birth_year, 2026);
  assert.ok(!('manual_birth_year' in baziLearnInput(input)), 'an old draft without returned facts must not guess an original birth year');
  assert.ok(!('manual_birth_year' in baziLearnInput({ year: 1990, month: 1, day: 1 }, { profile: { solar: payload.profile.solar } })));
  assert.equal(JSON.stringify(baziLearnInput(anchored)), JSON.stringify(anchored), 'the anchored cache key remains stable');
  assert.deepEqual(input, before);
});

test('fresh white-language books open their exact default and older books keep the electronic entry', async () => {
  const { bookReadingEntry, bookDefaultSectionNumber } = await load('lib/books.js');
  const book = { id: 'sample-book', has_modern: true, section_count: 85, default_section_number: 3 };
  assert.deepEqual(bookReadingEntry(book), { path: '/books/sample-book?page=3', title: '', updatedAt: 0, continuing: false, kind: 'modern' });
  assert.equal(bookReadingEntry({ ...book, has_modern: false }).path, '/books/sample-book?text-version=current');
  assert.equal(bookDefaultSectionNumber({ ...book, default_section_number: undefined }), 1);
  assert.equal(bookDefaultSectionNumber({ ...book, default_section_number: 86 }), 1);
});

test('library entries resume the newer white or immutable MD position without switching versions', async () => {
  const { bookReadingEntry } = await load('lib/books.js');
  const book = { id: 'sample-book', has_modern: true, section_count: 85, default_section_number: 3 };
  const reading = { number: 82, anchor: 2, offset: .5, updatedAt: 200 };
  const text = { versionId: 'frozen-md-one', sectionId: 'body-12', title: '原版篇十二', updatedAt: 100 };
  const before = structuredClone({ book, reading, text });
  assert.deepEqual(bookReadingEntry(book, { reading, text }), { path: '/books/sample-book?page=82', title: '第 82 篇',
    updatedAt: 200, continuing: true, kind: 'modern' });
  for (const updatedAt of [200, 300]) {
    assert.deepEqual(bookReadingEntry(book, { reading, text: { ...text, updatedAt } }), {
      path: '/books/sample-book?text-version=frozen-md-one&chapter=body-12&resume=1', title: '原版篇十二',
      updatedAt, continuing: true, kind: 'electronic' });
  }
  assert.equal(bookReadingEntry(book, { reading: { ...reading, number: 86 }, text }).kind, 'electronic');
  assert.equal(bookReadingEntry(book, { reading, text: { ...text, versionId: '../invalid' } }).kind, 'modern');
  assert.equal(bookReadingEntry({ ...book, has_modern: false }, { reading }).kind, 'original');
  assert.deepEqual({ book, reading, text }, before);
});

test('new chapter layouts ignore old numeric progress, resume their own position and preserve immutable MD history', async () => {
  const { bookReadingKeys, bookReadingEntry, bookDefaultSectionNumber, readingNumber } = await load('lib/books.js');
  const book = { id: 'huozhulin', has_modern: true, section_count: 85, default_section_number: 4, reading_layout_id: 'db1d3509b7ead1e8' };
  const legacyBook = { id: book.id, has_modern: false, section_count: 33 };
  const legacyKeys = bookReadingKeys(legacyBook);
  assert.deepEqual(legacyKeys, { progress: 'xz-book-progress:huozhulin', position: 'xz-book-position:huozhulin' });
  for (const reading_layout_id of ['', null, undefined]) assert.deepEqual(bookReadingKeys({ ...legacyBook, reading_layout_id }), legacyKeys);
  const keys = bookReadingKeys(book);
  assert.deepEqual(keys, { progress: 'xz-book-progress:huozhulin:db1d3509b7ead1e8', position: 'xz-book-position:huozhulin:db1d3509b7ead1e8' });
  const oldPosition = { number: 29, anchor: 4, offset: .3, updatedAt: 500 };
  const storage = new Map([[legacyKeys.progress, '29'], [legacyKeys.position, oldPosition]]);
  const entry = target => bookReadingEntry(target, { reading: storage.get(bookReadingKeys(target).position), text: storage.get('xz-book-text-recent:huozhulin') });
  const start = (target, page = '') => readingNumber(page || storage.get(bookReadingKeys(target).progress) || bookDefaultSectionNumber(target), target.section_count);
  assert.equal(entry(book).path, '/books/huozhulin?page=4');
  assert.equal(entry(book).continuing, false);
  assert.equal(start(book), 4, 'old raw page 29 must not become the new chapter 29');
  assert.equal(start(book, '29'), 29, 'an explicit case or contents page remains a destination');
  assert.equal(entry(legacyBook).path, '/books/huozhulin?page=29');
  assert.equal(start(legacyBook), 29);
  const newPosition = { number: 82, anchor: 2, offset: .4, updatedAt: 600 };
  storage.set(keys.progress, '82'); storage.set(keys.position, newPosition);
  assert.equal(entry(book).path, '/books/huozhulin?page=82');
  assert.equal(entry(book).continuing, true);
  assert.equal(start(book), 82);
  assert.equal(start(book, '4'), 4);
  const revisedDefinitions = { ...book, glossary_revision: 'changed', modern_revision: 'changed' };
  assert.deepEqual(bookReadingKeys(revisedDefinitions), keys);
  assert.equal(entry(revisedDefinitions).path, '/books/huozhulin?page=82');
  const text = { versionId: 'reading-20261022-026bfdd7', sectionId: 'huozhulin-body', title: '冻结MD原文', updatedAt: 700 };
  storage.set('xz-book-text-recent:huozhulin', text);
  assert.equal(entry(book).kind, 'electronic');
  assert.equal(entry(book).path, '/books/huozhulin?text-version=reading-20261022-026bfdd7&chapter=huozhulin-body&resume=1');
  storage.set(keys.position, { ...newPosition, updatedAt: 800 });
  assert.equal(entry(book).kind, 'modern');
  assert.deepEqual(storage.get(legacyKeys.position), oldPosition);
  assert.equal(storage.get(legacyKeys.progress), '29');
});

test('an identical opening heading replaces only the visible outer heading and keeps every block identity', async () => {
  const { hasOpeningSectionTitle } = await load('lib/books.js');
  const section = { title: '占法卦數', blocks: [{ id: 'heading-1', role: 'heading', text: '占法卦數', notes: ['题名存疑'] },
    { id: 'text-2', role: 'text', text: '原文仍在。' }] };
  const before = structuredClone(section);
  assert.equal(hasOpeningSectionTitle(section), true);
  assert.equal(hasOpeningSectionTitle({ ...section, title: '占法卦数' }), false);
  assert.equal(hasOpeningSectionTitle({ ...section, blocks: [{ ...section.blocks[0], text: '占法卦數\n' }] }), false);
  assert.equal(hasOpeningSectionTitle({ ...section, blocks: [{ ...section.blocks[0], role: 'text' }] }), false);
  assert.equal(hasOpeningSectionTitle({ ...section, blocks: [] }), false);
  assert.deepEqual(section, before);
});

test('only a repeated whole-book title followed by an explicit short author credit can be folded', async () => {
  const { hasOpeningSourceCredits } = await load('lib/books.js');
  const book = { title: '玄机要义' };
  const section = { title: '开篇', blocks: [{ role: 'heading', text: '《玄機　要義》' },
    { role: 'heading', text: '南城王氏輯' }, { role: 'verse', text: '正文保留。' }] };
  const before = structuredClone({ book, section });
  assert.equal(hasOpeningSourceCredits(book, section), true);
  assert.equal(hasOpeningSourceCredits({ title: '〈玄机要义〉' }, section), true);
  assert.equal(hasOpeningSourceCredits(book, { ...section, blocks: [section.blocks[0], { role: 'heading', text: '撰者：王甲著' }] }), true);
  for (const text of ['古籍整理与校', '另一书名', '王甲著', '某氏辑', '南城王氏辑。', '南城王氏\n辑', '王'.repeat(40) + '氏辑',
    '作者王甲著', '··氏辑', '氏氏氏辑', '作者：··著', '·王氏辑', '王·氏辑']) {
    assert.equal(hasOpeningSourceCredits(book, { ...section, blocks: [section.blocks[0], { role: 'heading', text }] }), false, text);
  }
  assert.equal(hasOpeningSourceCredits({ title: '其他书' }, section), false);
  assert.equal(hasOpeningSourceCredits({ title: '' }, section), false);
  assert.equal(hasOpeningSourceCredits(book, { ...section, blocks: [{ ...section.blocks[0], text: '《玄《机》要义》' }, section.blocks[1]] }), false);
  assert.equal(hasOpeningSourceCredits(book, { ...section, blocks: [{ ...section.blocks[0], role: 'text' }, section.blocks[1]] }), false);
  assert.equal(hasOpeningSourceCredits(book, { ...section, blocks: [section.blocks[0], { ...section.blocks[1], role: 'text' }] }), false);
  assert.equal(hasOpeningSourceCredits(book, { ...section, blocks: [section.blocks[0]] }), false);
  for (const separator of ['\r', '\n', '\v', '\f', '\u0085', '\u2028', '\u2029']) {
    assert.equal(hasOpeningSourceCredits(book, { ...section, blocks: [section.blocks[0], { role: 'heading', text: `南城王${separator}氏輯` }] }), false);
  }
  for (const blockIndex of [0, 1]) {
    for (const metadata of [{ source_text: false }, { presentation: 'table' }, { presentation: 'diagram' }, { presentation: null }]) {
      const blocks = section.blocks.map((block, index) => index === blockIndex ? { ...block, ...metadata } : block);
      assert.equal(hasOpeningSourceCredits(book, { ...section, blocks }), false);
    }
    assert.equal(hasOpeningSourceCredits(book, { ...section, figures: [{ block_indices: [blockIndex] }] }), false);
  }
  assert.equal(hasOpeningSourceCredits(book, { ...section, figures: [{ block_indices: [2] }] }), true);
  assert.equal(hasOpeningSourceCredits(book, { ...section, blocks: [section.blocks[0], { role: 'heading', text: '作者：王·甲著' }] }), true);
  assert.deepEqual({ book, section }, before);
});

test('only an appendix with no actual modern paragraph uses an original-only view', async () => {
  const { isOriginalOnlyAppendix } = await load('lib/books.js');
  const appendix = { location: '附录', blocks: [{ role: 'text', text: '目录甲\n目录乙', modern: '' }, { modern: '  ' }] };
  const before = structuredClone(appendix);
  assert.equal(isOriginalOnlyAppendix(appendix), true);
  assert.equal(isOriginalOnlyAppendix({ ...appendix, location: '版本资料' }), true);
  assert.equal(isOriginalOnlyAppendix({ ...appendix, location: '原书章节' }), false);
  assert.equal(isOriginalOnlyAppendix({ ...appendix, blocks: [...appendix.blocks, { modern: '已有白话。' }] }), false);
  assert.equal(isOriginalOnlyAppendix({ ...appendix, location: '版本资料', blocks: [{ modern: '已提供白话。' }] }), false);
  assert.equal(isOriginalOnlyAppendix(null), false);
  assert.deepEqual(appendix, before);
});

test('figure layout uses only exact covered blocks, places each image once and keeps same-block figure order', async () => {
  const { bookFigureLayout } = await load('lib/books.js');
  const section = { blocks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], figures: [
    { id: 'first', block_indices: [2, 3] }, { id: 'second', block_indices: [2] }, { id: 'third', block_indices: [1, 3] },
  ] };
  const before = structuredClone(section);
  const layout = bookFigureLayout(section);
  assert.deepEqual(layout.leadingFigureIndices, []);
  assert.deepEqual(layout.figuresBeforeBlocks, [[], [2], [0, 1], []]);
  assert.deepEqual([...layout.coveredBlockIndices].sort(), [1, 2, 3]);
  assert.equal(layout.hasLegacyFigures, false);
  assert.equal(layout.hasExplicitMappings, true);
  assert.deepEqual(section, before);
});

test('legacy figures stay at the start and malformed explicit mappings never hide partially valid blocks', async () => {
  const { bookFigureLayout } = await load('lib/books.js');
  const legacy = bookFigureLayout({ blocks: [{}, {}], figures: [{ id: 'omitted' }, { id: 'null', block_indices: null }] });
  assert.deepEqual(legacy.leadingFigureIndices, [0, 1]);
  assert.deepEqual(legacy.figuresBeforeBlocks, [[], []]);
  assert.equal(legacy.hasLegacyFigures, true);
  assert.equal(legacy.hasExplicitMappings, false);
  assert.equal(legacy.coveredBlockIndices.size, 0);
  for (const block_indices of [[], [-1], [2], [0, 2], [0, 0], [1, 0], ['1'], [1.5], false, {}, 0]) {
    const layout = bookFigureLayout({ blocks: [{}, {}], figures: [{ id: 'invalid', block_indices }, { id: 'valid', block_indices: [1] }] });
    assert.deepEqual(layout.leadingFigureIndices, [0]);
    assert.deepEqual(layout.figuresBeforeBlocks, [[], [1]]);
    assert.deepEqual([...layout.coveredBlockIndices], [1]);
    assert.equal(layout.hasLegacyFigures, false);
    assert.equal(layout.hasExplicitMappings, true);
  }
  const empty = bookFigureLayout({ figures: [{ block_indices: [0] }], blocks: [] });
  assert.deepEqual(empty.leadingFigureIndices, [0]);
  assert.equal(empty.coveredBlockIndices.size, 0);
});

test('electronic text routes preserve edition and chapter identities in reading and downloads', async () => {
  const { textVersionPath, textExportPath, TEXT_ROLES } = await load('lib/books.js');
  const route = new URL(textVersionPath('book/one', 'siku-v1', 'juan-11'), 'https://example.test');
  assert.equal(route.pathname, '/books/book%2Fone');
  assert.equal(route.searchParams.get('text-version'), 'siku-v1');
  assert.equal(route.searchParams.get('chapter'), 'juan-11');
  assert.equal(route.searchParams.has('resume'), false);
  const resume = new URL(textVersionPath('book/one', 'siku-v1', 'juan-11', { resume: true }), 'https://example.test');
  assert.equal(resume.searchParams.get('chapter'), 'juan-11');
  assert.equal(resume.searchParams.get('resume'), '1');
  const download = new URL(textExportPath('book', 'edition/one', 'md', 'chapter&two'), 'https://example.test');
  assert.equal(download.pathname, '/api/books/book/text-versions/edition%2Fone/export');
  assert.equal(download.searchParams.get('chapter_id'), 'chapter&two');
  assert.equal(download.searchParams.get('format'), 'md');
  assert.equal(TEXT_ROLES.unclassified, '未分类');
  assert.equal(TEXT_ROLES.modern_editorial, '现代整理说明');
});

test('reading opens the supplied body default and resolves old chapter links by exact source identity', async () => {
  const { selectReadingSection, groupReadingSections, textReadingPosition } = await load('lib/books.js');
  const reading = { default_section_id: 'chapter-r-002', sections: [
    { id: 'edition-notes', kind: 'notes', title: '整理说明', source_location: '' },
    { id: 'chapter-r-001', kind: 'preface', title: '原序', source_location: '第1页' },
    { id: 'chapter-r-002', kind: 'body', title: '易中明義', source_location: '第2页' },
    { id: 'appendix', kind: 'appendix', title: '附录', source_location: '第3页' },
  ], source_sections: [{ chapter_id: 'source-chapter', section_id: 'chapter-r-001' }] };
  assert.equal(selectReadingSection(reading, null), 2);
  assert.equal(selectReadingSection(reading, 'chapter-r-002'), 2);
  assert.equal(selectReadingSection(reading, 'source-chapter'), 1);
  assert.equal(selectReadingSection(reading, 'unknown'), -1);
  assert.deepEqual(groupReadingSections(reading.sections).map(group => group.title), ['正文', '序跋', '附录', '整理校记']);
  assert.deepEqual(groupReadingSections(reading.sections, '明义').map(group => group.sections.map(section => section.id)), [['chapter-r-002']]);
  assert.equal(groupReadingSections(reading.sections, '不存在').length, 0);
  const saved = { versionId: 'reading-20261022-abc', sectionId: 'chapter-r-002', title: '易中明義', updatedAt: 100 };
  assert.deepEqual(textReadingPosition(saved), saved);
  const anchored = { ...saved, anchor: 12, offset: .375 };
  assert.deepEqual(textReadingPosition(anchored), anchored);
  assert.deepEqual(textReadingPosition({ ...anchored, punctuation: 'source' }), { ...anchored, punctuation: 'source' });
  assert.deepEqual(textReadingPosition({ ...anchored, punctuation: 'punctuated' }), { ...anchored, punctuation: 'punctuated' });
  assert.deepEqual(textReadingPosition({ ...anchored, punctuation: 'unknown' }), anchored);
  for (const fields of [{ anchor: -1, offset: .1 }, { anchor: 1.5, offset: .1 }, { anchor: 2, offset: NaN },
    { anchor: 2, offset: 1.1 }, { anchor: 2 }, { offset: .1 }]) assert.deepEqual(textReadingPosition({ ...saved, ...fields }), saved);
  for (const invalid of [null, 'broken', { ...saved, versionId: '../source' }, { ...saved, sectionId: 'chapter?other=1' },
    { ...saved, updatedAt: NaN }, { ...saved, updatedAt: 0 }, { ...saved, title: '' }]) assert.equal(textReadingPosition(invalid), null);
});

test('electronic resume preserves a saved paragraph while contents, paging and footnotes remain explicit destinations', async () => {
  const { textReadingTarget } = await load('lib/books.js');
  const reading = { default_section_id: 'body-first', sections: [
    { id: 'preface', kind: 'preface' }, { id: 'body-first', kind: 'body' }, { id: 'body-next', kind: 'body' },
  ], source_sections: [{ chapter_id: 'old-source', section_id: 'preface' }] };
  const saved = { versionId: 'reading-20261022-abc', sectionId: 'body-next', title: '下一节', updatedAt: 100, anchor: 7, offset: .4 };
  assert.deepEqual(textReadingTarget(reading), { index: 1, position: null });
  assert.deepEqual(textReadingTarget(reading, { saved }), { index: 2, position: saved });
  assert.deepEqual(textReadingTarget(reading, { requested: 'body-next', saved, resume: true }), { index: 2, position: saved });
  assert.deepEqual(textReadingTarget(reading, { requested: 'body-next', saved }), { index: 2, position: null });
  assert.deepEqual(textReadingTarget(reading, { requested: 'body-first', saved, resume: true }), { index: 1, position: null });
  assert.deepEqual(textReadingTarget(reading, { requested: 'body-next', saved, resume: true, footnote: '注一' }), { index: 2, position: null });
  assert.deepEqual(textReadingTarget(reading, { requested: 'old-source', saved }), { index: 0, position: null });
  assert.deepEqual(textReadingTarget(reading, { requested: 'missing', saved, resume: true }), { index: -1, position: null });
  assert.deepEqual(textReadingTarget(reading, { saved: { ...saved, sectionId: 'removed' } }), { index: 1, position: null });
  const legacy = { versionId: saved.versionId, sectionId: saved.sectionId, title: saved.title, updatedAt: saved.updatedAt };
  assert.deepEqual(textReadingTarget(reading, { saved: legacy }), { index: 2, position: legacy });
});

test('reading uses only supplied editorial punctuation and always offers the exact source text', async () => {
  const { readingBlockText, readingPreferences } = await load('lib/books.js');
  const block = { id: 'first', text: '動究是交重之爻靜就是單拆之爻', punctuated_text: '動究是交重之爻，靜就是單拆之爻。' };
  const source = structuredClone(block);
  assert.equal(readingBlockText(block), block.punctuated_text);
  assert.equal(readingBlockText(block, readingPreferences().punctuation), block.punctuated_text);
  assert.equal(readingBlockText(block, 'source'), block.text);
  assert.equal(readingBlockText({ text: '未整理原稿' }), '未整理原稿');
  assert.equal(readingBlockText({ text: '未整理原稿', punctuated_text: null }), '未整理原稿');
  assert.equal(readingBlockText({ text: '原稿', punctuated_text: '' }), '');
  assert.equal(readingPreferences({ punctuation: 'source' }).punctuation, 'source');
  for (const invalid of [null, 1, [], 'SOURCE', 'guess']) assert.equal(readingPreferences({ punctuation: invalid }).punctuation, 'punctuated');
  assert.deepEqual(block, source);
});

test('punctuation switches locate the same original words when one paragraph becomes several', async () => {
  const { readingCharacterLength, readingCharacterAnchor } = await load('lib/books.js');
  const original = '動究是交重之爻靜就是單拆之爻交拆之爻屬陰重單之爻屬陽';
  const paragraphs = ['動究是交重之爻，靜就是單拆之爻。', '交拆之爻屬陰，重單之爻屬陽。'];
  const start = readingCharacterLength(paragraphs[0]);
  const targetCharacter = start + 5;
  const target = readingCharacterAnchor([
    { anchor: 7, start: 0, length: start },
    { anchor: 8, start, length: readingCharacterLength(paragraphs[1]) },
  ], targetCharacter);
  assert.deepEqual(target, { anchor: 8, offset: 5 / readingCharacterLength(paragraphs[1]) });
  assert.deepEqual(readingCharacterAnchor([{ anchor: 3, start: 0, length: readingCharacterLength(original) }], targetCharacter),
    { anchor: 3, offset: targetCharacter / readingCharacterLength(original) });
  assert.equal(readingCharacterLength(original), readingCharacterLength(paragraphs.join('\n\n')));
  assert.equal(readingCharacterLength('甲，𠀀。\n\n乙□⚊⚋'), 6);
  assert.deepEqual(readingCharacterAnchor([{ anchor: 1, start: 0, length: 0 }], 1), null);
  assert.deepEqual(readingCharacterAnchor([{ anchor: 2, start: 0, length: 10 }], 50), { anchor: 2, offset: 1 });
});

test('cancelled response bodies remain cancellation instead of stale authentication errors', async () => {
  const { get } = await load('lib/api.js');
  const previous = globalThis.fetch;
  const aborted = new DOMException('Response body aborted', 'AbortError');
  try {
    globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => { throw aborted; } });
    await assert.rejects(get('/api/books/test/annotations'), error => error === aborted);
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => { throw new TypeError('Disconnected while reading'); } });
    await assert.rejects(get('/api/books/test/annotations'), error => error.status === 0 && error.isNetwork);
  } finally { globalThis.fetch = previous; }
});

test('book navigation rejects invalid saved pages and encodes book identities', async () => {
  const { readingPath, readingNumber } = await load('lib/books.js');
  assert.equal(readingNumber('156', 397), 156);
  for (const invalid of ['0', '-1', '398', '1.5', 'garbage', 'Infinity']) assert.equal(readingNumber(invalid, 397), 1);
  assert.equal(readingPath('book/one', 3), '/books/book%2Fone?page=3');
});

test('optional version material has its own paging while raw book destinations and source order stay intact', async () => {
  const { bookSectionNavigation } = await load('lib/books.js');
  const contents = [
    { number: 1, title: '序', location: '原书章节' },
    { number: 2, title: '版本题署', location: '版本资料' },
    { number: 3, title: '古文附篇', location: '卷六' },
    { number: 4, title: '版本刊记', location: '版本资料' },
    { number: 5, title: '正文末篇', location: '卷六' },
  ];
  const before = structuredClone(contents);
  assert.deepEqual(bookSectionNavigation(contents, 1, 5), { kind: 'body', separated: true, position: 1, total: 3, previous: null, next: 3 });
  assert.deepEqual(bookSectionNavigation(contents, 3, 5), { kind: 'body', separated: true, position: 2, total: 3, previous: 1, next: 5 });
  assert.deepEqual(bookSectionNavigation(contents, 5, 5), { kind: 'body', separated: true, position: 3, total: 3, previous: 3, next: null });
  assert.deepEqual(bookSectionNavigation(contents, 2, 5), { kind: 'appendix', separated: true, position: 1, total: 2, previous: null, next: 4 });
  assert.deepEqual(bookSectionNavigation(contents, 4, 5), { kind: 'appendix', separated: true, position: 2, total: 2, previous: 2, next: null });
  assert.deepEqual(contents, before);
  const reordered = [contents[2], contents[4], contents[1], contents[0], contents[3]];
  assert.deepEqual(bookSectionNavigation(reordered, 5, 5), { kind: 'body', separated: true, position: 2, total: 3, previous: 3, next: 1 },
    'paging follows the supplied contents order rather than sorting or renumbering');
});

test('73 chapters stop before 84 optional source entries without changing the raw 157-item range', async () => {
  const { bookSectionNavigation, readingNumber, readingPath } = await load('lib/books.js');
  const contents = Array.from({ length: 157 }, (_, index) => ({ number: index + 1,
    title: `项目${index + 1}`, location: index < 73 ? '卷六' : '版本资料' }));
  assert.deepEqual(bookSectionNavigation(contents, 73, 157), { kind: 'body', separated: true, position: 73, total: 73, previous: 72, next: null });
  assert.deepEqual(bookSectionNavigation(contents, 74, 157), { kind: 'appendix', separated: true, position: 1, total: 84, previous: null, next: 75 });
  assert.deepEqual(bookSectionNavigation(contents, 157, 157), { kind: 'appendix', separated: true, position: 84, total: 84, previous: 156, next: null });
  assert.equal(readingNumber('157', 157), 157);
  assert.equal(readingPath('source-test', 157), '/books/source-test?page=157');
});

test('legacy appendix locations with translated prefaces, afterwords and source material retain raw paging and progress', async () => {
  const { bookSectionNavigation } = await load('lib/books.js');
  const contents = [{ number: 1, title: '前序', location: '附录' },
    { number: 2, title: '末篇', location: '卷六' }, { number: 3, title: '后跋', location: '附录' },
    { number: 4, title: '版本来源', location: '附录' }];
  const before = structuredClone(contents);
  for (let number = 1; number <= 4; number++) assert.deepEqual(bookSectionNavigation(contents, number, 4), {
    kind: 'body', separated: false, position: number, total: 4, previous: number > 1 ? number - 1 : null, next: number < 4 ? number + 1 : null,
  });
  assert.deepEqual(contents, before);
  const nearMatches = [' 版本资料', '版本资料 ', '版本资料 附注', '版本資料'];
  for (const location of nearMatches) assert.equal(bookSectionNavigation([{ number: 1, location }], 1, 1).separated, false);
});

test('book filters keep working drafts and unavailable records visible with their own states', async () => {
  const { filterBooks, BOOK_STATUS } = await load('lib/books.js');
  const books = [
    { title: '断易天机', source_label: '上海古本', system: 'liuyao', status: 'working_draft' },
    { title: '滴天髓辑要', source_label: '文明本', system: 'bazi', status: 'unavailable' },
  ];
  assert.deepEqual(filterBooks(books, ' 上海 ', 'liuyao'), [books[0]]);
  assert.deepEqual(filterBooks(books, '', ''), books);
  assert.equal(BOOK_STATUS.working_draft, '有疑缺的工作稿');
  assert.equal(BOOK_STATUS.unavailable, '成品待恢复');
});

test('reading settings and bookmarks recover safely from corrupt or stale local storage', async () => {
  const { readingPreferences, readingPosition } = await load('lib/books.js');
  const defaults = { size: 20, line: 2, font: 'serif', paper: 'white', layout: 'continuous', punctuation: 'punctuated' };
  for (const value of [null, 'broken', [], { size: 900, line: -1, font: 'injected', paper: 'other', layout: 'other' }]) {
    assert.deepEqual(readingPreferences(value), defaults);
  }
  const prefs = { size: 24, line: 2.2, font: 'sans', paper: 'warm', layout: 'source', punctuation: 'punctuated' };
  assert.deepEqual(readingPreferences(prefs), prefs);
  assert.deepEqual(readingPreferences({ size: 24, line: 2.2, font: 'sans', paper: 'warm' }), { ...prefs, layout: 'continuous' });
  for (const layout of [null, 1, [], 'SOURCE', 'normal']) assert.equal(readingPreferences({ layout }).layout, 'continuous');
  const bookmark = { number: 7, anchor: 3, offset: .35, updatedAt: 1000 };
  assert.deepEqual(readingPosition(bookmark, 20), bookmark);
  const layered = { ...bookmark, layer: 'modern', layerOffset: .62 };
  assert.deepEqual(readingPosition(layered, 20), layered);
  assert.deepEqual(readingPosition({ ...layered, layer: 'original', layerOffset: 0 }, 20), { ...layered, layer: 'original', layerOffset: 0 });
  for (const extra of [{ layer: 'other', layerOffset: .5 }, { layer: 'modern', layerOffset: '0.5' }, { layer: 'modern', layerOffset: NaN },
    { layer: 'modern', layerOffset: -1 }, { layer: 'original', layerOffset: 1.01 }, { layer: 'modern' }, { layerOffset: .2 }]) {
    assert.deepEqual(readingPosition({ ...bookmark, ...extra }, 20), bookmark, 'invalid optional layer data cannot replace a valid legacy position');
  }
  for (const value of [null, '7', { ...bookmark, number: 21 }, { ...bookmark, number: '7' },
    { ...bookmark, anchor: -1 }, { ...bookmark, anchor: 1.5 }, { ...bookmark, offset: Infinity },
    { ...bookmark, offset: 1.1 }, { ...bookmark, updatedAt: 0 }]) assert.equal(readingPosition(value, 20), null);
});

test('continuous prose marks CJK, word and paragraph breaks without changing any source character', async () => {
  const { sourceBreaks } = await load('lib/books.js');
  const text = '天干\n地支\n\n甲乙\n\n\nabc\n123\n漢字\nabc \nword\n';
  const block = { text, role: 'text', presentation: 'prose', source_text: true };
  const before = structuredClone(block);
  const parts = sourceBreaks(block);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.filter(part => part.kind).map(part => [part.text, part.kind]), [
    ['\n', 'soft'], ['\n\n', 'paragraph'], ['\n\n\n', 'paragraph'],
    ['\n', 'space'], ['\n', 'soft'], ['\n', 'soft'], ['\n', 'soft'], ['\n', 'soft'],
  ]);
  assert.deepEqual(block, before);
  for (const role of ['prose', 'note', 'commentary']) {
    assert.equal(sourceBreaks({ ...block, role }).map(part => part.text).join(''), text);
    assert.equal(sourceBreaks({ ...block, role }).find(part => part.kind)?.kind, 'soft');
  }
  assert.deepEqual(sourceBreaks({ text: '', role: 'text' }), [{ text: '', kind: null }]);
});

test('continuous prose never marks verse, heading, diagram or table structure for folding', async () => {
  const { sourceBreaks } = await load('lib/books.js');
  const text = '甲\t乙\n丙\t丁\n\n戊';
  const block = { text, role: 'text', presentation: 'prose', source_text: true };
  for (const fields of [{ role: 'verse' }, { role: 'heading' }, { role: 'table' },
    { role: 'diagram_caption' }, { presentation: 'table' }, { presentation: 'diagram' }, { source_text: false }]) {
    assert.deepEqual(sourceBreaks({ ...block, ...fields }), [{ text, kind: null }]);
  }
});

test('optional block parts use complete Unicode code-point coverage without changing source data', async () => {
  const { bookBlockParts } = await load('lib/books.js');
  const texts = [' \r\n標題𠮷\n', '甲乙。\n', '短評。\n', '詩甲\n詩乙\n', '小注。  '];
  let cursor = 0;
  const parts = texts.map((text, index) => {
    const start = cursor; cursor += Array.from(text).length;
    return { role: ['heading', 'text', 'text', 'verse', 'note'][index], start, end: cursor,
      ...(index === 0 ? { heading_level: 2 } : {}) };
  });
  const block = { role: 'text', text: texts.join(''), modern: '完整白话。', parts };
  const before = structuredClone(block);
  const result = bookBlockParts(block);
  assert.deepEqual(result.map(part => part.text), texts);
  assert.equal(result.map(part => part.text).join(''), block.text);
  assert.equal(result[0].heading_level, 2);
  assert.equal(bookBlockParts({ ...block, role: 'prose', presentation: 'prose' }).length, parts.length);
  assert.equal(bookBlockParts({ ...block, parts: [{ role: 'heading', start: 0, end: cursor }] })[0].heading_level, 3);
  assert.deepEqual(block, before);
  for (const fields of [{ parts: undefined }, { parts: [] }, { parts: {} }, { parts: [null] },
    { role: 'verse' }, { role: 'heading' }, { presentation: 'table' }, { presentation: 'diagram' }, { source_text: false },
    { parts: [{ role: 'text', start: 1, end: cursor }] },
    { parts: [{ role: 'text', start: 0, end: cursor - 1 }] },
    { parts: [{ role: 'text', start: 0, end: cursor + 1 }] },
    { parts: [{ role: 'text', start: 0, end: block.text.length }] },
    { parts: [{ role: 'text', start: 0, end: 0 }] },
    { parts: [{ role: 'text', start: 0, end: 1.5 }] },
    { parts: [{ role: 'text', start: 0, end: '2' }] },
    { parts: [{ role: 'text', start: 0, end: cursor, heading_level: 2 }] },
    { parts: [{ role: 'heading', start: 0, end: cursor, heading_level: 4 }] },
    { parts: [{ role: 'heading', start: 0, end: cursor, heading_level: null }] },
    { parts: [{ role: 'body', start: 0, end: cursor }] },
    { parts: [{ role: 'text', start: 0, end: cursor, text: block.text }] },
    { parts: [{ role: 'text', start: 0, end: 2 }, { role: 'note', start: 1, end: cursor }] },
    { parts: [{ role: 'text', start: 0, end: 2 }, { role: 'note', start: 3, end: cursor }] }]) {
    assert.equal(bookBlockParts({ ...block, ...fields }), null, JSON.stringify(fields));
  }
});

test('contents search matches the supplied title, provenance and exact reading page', async () => {
  const { filterContents } = await load('lib/books.js');
  const contents = [{ number: 7, title: '河图', location: '影像文件 1 · 来源页 9' },
    { number: 70, title: '论用神', location: '卷三 · 来源页 72', partial: true }];
  assert.deepEqual(filterContents(contents, ' 7 '), [contents[0]]);
  assert.deepEqual(filterContents(contents, '河图'), [contents[0]]);
  assert.deepEqual(filterContents(contents, '来源页 9'), [contents[0]]);
  assert.deepEqual(filterContents(contents, 'not-found'), []);
  assert.deepEqual(filterContents(contents, ''), contents);
  assert.equal(filterContents([{ number: 11, title: '論用神', location: '來源頁 23' }], '论用神').length, 1);
  assert.equal(filterContents([{ number: 11, title: '论用神', location: '来源页 23' }], '論用神').length, 1);
  const { filterBooks } = await load('lib/books.js');
  assert.equal(filterBooks([{ title: '子平真诠', source_label: '文明本', system: 'bazi' }], '子平真詮', '').length, 1);
});

test('image zoom preserves the pointed location and clamps scale and pan to the visible image', async () => {
  const { imageTransform } = await load('lib/books.js');
  const size = { width: 800, height: 600, stageWidth: 1000, stageHeight: 700 };
  const fit = { scale: 1, x: 0, y: 0 };
  const zoomed = imageTransform(fit, 3, { x: 200, y: 100 }, size);
  assert.deepEqual(zoomed, { scale: 3, x: -400, y: -200 });
  assert.equal((200 - fit.x) / fit.scale, (200 - zoomed.x) / zoomed.scale);
  assert.equal((100 - fit.y) / fit.scale, (100 - zoomed.y) / zoomed.scale);
  assert.deepEqual(imageTransform(zoomed, .1, { x: 0, y: 0 }, size), fit);
  const clamped = imageTransform({ scale: 3, x: 10000, y: -10000 }, 100, { x: 0, y: 0 }, size);
  assert.deepEqual(clamped, { scale: 8, x: 2700, y: -2050 });
});

test('knowledge search keeps URL filters through pagination and resets the page when a category changes', async () => {
  const { readKnowledgeQuery, knowledgeListPath, knowledgeApiPath } = await load('lib/knowledge.js');
  const filter = readKnowledgeQuery(new URLSearchParams('kind=term&system=bazi&q=%20月令%20&book_id=book-ziping&offset=24'));
  assert.deepEqual(filter, { kind: 'term', system: 'bazi', q: '月令', book_id: 'book-ziping', offset: 24 });
  const next = new URL(knowledgeListPath(filter, { offset: 48 }), 'https://example.test');
  assert.equal(next.searchParams.get('q'), '月令');
  assert.equal(next.searchParams.get('book_id'), 'book-ziping');
  assert.equal(next.searchParams.get('offset'), '48');
  const category = new URL(knowledgeListPath(filter, { kind: 'case', offset: 0 }), 'https://example.test');
  assert.equal(category.searchParams.get('kind'), 'case');
  assert.equal(category.searchParams.has('offset'), false);
  assert.equal(category.searchParams.get('system'), 'bazi');
  const api = new URL(knowledgeApiPath({ ...filter, unrelated: 'ignored' }), 'https://example.test');
  assert.equal(api.pathname, '/api/knowledge');
  assert.equal(api.searchParams.get('limit'), '24');
  assert.equal(api.searchParams.has('unrelated'), false);
  const invalid = readKnowledgeQuery(new URLSearchParams(`kind=unknown&system=unknown&offset=-3&q=${'字'.repeat(170)}`));
  assert.equal(invalid.kind, '');
  assert.equal(invalid.system, '');
  assert.equal(invalid.offset, 0);
  assert.equal(invalid.q.length, 160);
});

test('knowledge provenance renders only supplied pages and preserves the editorial location note', async () => {
  const { sourceLocation } = await load('lib/knowledge.js');
  assert.equal(sourceLocation({ chapter: '论用神', page_start: null, page_end: null, location_note: '据章节定位' }), '论用神 · 据章节定位');
  assert.equal(sourceLocation({ chapter: '论用神', page_start: 12, page_end: 14, location_note: '底本页码' }), '论用神 · 来源页码 12–14 · 底本页码');
  assert.equal(sourceLocation({ page_start: 12, page_end: 12 }), '来源页码 12');
  assert.equal(sourceLocation({ page_start: null, page_end: 18 }), '');
});

test('knowledge requests abort superseded loads and never publish late responses after a route change', async () => {
  const { createKnowledgeLoader } = await load('lib/knowledge.js');
  const states = [];
  const requests = [];
  const loader = createKnowledgeLoader(state => states.push(state), (path, { signal }) => new Promise((resolve, reject) => requests.push({ path, signal, resolve, reject })));
  const first = loader.load('/api/knowledge?kind=book');
  const second = loader.load('/api/knowledge?kind=term');
  assert.equal(requests[0].signal.aborted, true);
  requests[1].resolve({ items: [{ id: 'new-term' }] });
  await second;
  // 模拟底层忽略 abort、旧请求晚到的情况。
  requests[0].resolve({ items: [{ id: 'old-book' }] });
  await first;
  assert.deepEqual(states.filter(state => state.phase === 'ready').map(state => state.data.items[0].id), ['new-term']);
  const third = loader.load('/api/knowledge/term-example');
  loader.destroy();
  assert.equal(requests[2].signal.aborted, true);
  requests[2].resolve({ entry: { id: 'closed-page' } });
  await third;
  assert.equal(states.filter(state => state.phase === 'ready').length, 1);
  await loader.load('/api/knowledge');
  assert.equal(requests.length, 3);
});

test('knowledge requests preserve a 404 for the missing-entry view and can recover after failure', async () => {
  const { createKnowledgeLoader } = await load('lib/knowledge.js');
  const realFetch = globalThis.fetch;
  const states = [];
  let failure = true;
  globalThis.fetch = async (path, init) => {
    assert.equal(path, '/api/knowledge/term-example');
    assert.equal(init.credentials, 'same-origin');
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(JSON.stringify(failure ? { detail: '条目不存在' } : { entry: { id: 'term-example' }, related: [] }), { status: failure ? 404 : 200 });
  };
  const loader = createKnowledgeLoader(state => states.push(state));
  try {
    await loader.load('/api/knowledge/term-example');
    assert.equal(states.at(-1).phase, 'error');
    assert.equal(states.at(-1).error.status, 404);
    failure = false;
    await loader.load('/api/knowledge/term-example');
    assert.equal(states.at(-1).phase, 'ready');
    assert.equal(states.at(-1).data.entry.id, 'term-example');
  } finally {
    loader.destroy();
    globalThis.fetch = realFetch;
  }
});

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
