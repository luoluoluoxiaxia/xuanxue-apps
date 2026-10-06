#!/usr/bin/env node
// Exhaustive reader checks against the public Books API. No editorial files are read.
// Playwright and Chromium are supplied by the caller, outside the client package.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const defaults = {
  'base-url': process.env.BOOKS_AUDIT_BASE_URL || 'http://127.0.0.1:8911',
  playwright: process.env.PLAYWRIGHT_MODULE || '/tmp/xuanxue-reading-qa/node_modules/playwright/index.mjs',
  chromium: process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium',
  output: 'tmp/full-browser-audit', widths: '1360,390', workers: '4', timeout: '30000',
  book: '', limit: '',
};
const options = { ...defaults };
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--help') {
    console.log('Usage: node scripts/audit-web-books-browser.mjs [--base-url URL] [--playwright MODULE] [--chromium EXECUTABLE] [--output DIR] [--widths 1360,390] [--workers 4] [--timeout 30000] [--book ID] [--limit N]\nThe default run checks every readable page at both widths, then every chapter with parallel and modern modes. --book and --limit make a partial diagnostic run, recorded as non-exhaustive.');
    process.exit(0);
  }
  const key = argument.slice(2);
  if (!argument.startsWith('--') || !Object.hasOwn(options, key) || !process.argv[index + 1]) {
    throw new Error(`Unknown or missing option: ${argument}`);
  }
  options[key] = process.argv[++index];
}
const widths = options.widths.split(',').map(Number);
const workers = Number(options.workers);
const timeout = Number(options.timeout);
const limit = options.limit ? Number(options.limit) : Infinity;
if (!widths.length || widths.some(value => !Number.isSafeInteger(value) || value < 320) ||
    !Number.isSafeInteger(workers) || workers < 1 || workers > 8 ||
    !Number.isSafeInteger(timeout) || timeout < 1000 ||
    (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1))) {
  throw new Error('Invalid width, worker count, timeout, or diagnostic limit.');
}
const base = options['base-url'].replace(/\/$/, '');
const output = path.resolve(options.output);
await fs.mkdir(output, { recursive: true });
const report = {
  started_at: new Date().toISOString(), base_url: base, widths, workers,
  exhaustive: !options.book && !options.limit && widths.includes(1360) && widths.includes(390),
  books: [], coverage: [], failures: [], screenshots: [], directories: [], libraries: [],
  cases: { expected: 0, attempted: 0, passed: 0, failed: 0 },
};
let screenshotCount = 0;
let lastProgress = 0;
let stopRequested = false;
const stop = signal => { stopRequested = true; report.interrupted = signal; console.log(JSON.stringify({ interrupted: signal, attempted: report.cases.attempted })); };
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
const coverage = new Map();
const directoryClaims = new Set();
const caseFailures = new Map();
const caseKey = task => `${task.width}:${task.book.id}:${task.number}:${task.mode}`;
const writeReport = async () => {
  report.coverage = [...coverage.values()];
  await fs.writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
};
function problem(task, check, detail, extra = {}) {
  report.failures.push({ book_id: task?.book?.id || null, width: task?.width || null,
    number: task?.number || null, mode: task?.mode || null, check, detail, ...extra });
  if (task?.number && task?.width) {
    const key = caseKey(task);
    caseFailures.set(key, (caseFailures.get(key) || 0) + 1);
  }
}
async function publicJson(route) {
  const response = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return response.json();
}
const catalog = await publicJson('/api/books');
if (!Array.isArray(catalog.books)) throw new Error('Books catalog is missing its books list.');
const details = new Map();
for (const book of catalog.books) {
  if (options.book && book.id !== options.book) continue;
  report.books.push({ id: book.id, title: book.title, status: book.status,
    section_count: book.section_count, has_modern: book.has_modern });
  try {
    const detail = await publicJson(`/api/books/${encodeURIComponent(book.id)}`);
    details.set(book.id, detail);
    if (JSON.stringify(detail.book) !== JSON.stringify(book)) problem({ book }, 'catalog-detail', 'Book metadata differs between catalog and detail.');
    if (detail.contents.length !== book.section_count || detail.contents.some((item, index) => item.number !== index + 1)) {
      problem({ book }, 'contents-numbering', 'Contents do not cover the declared consecutive page numbers.');
    }
  } catch (error) { problem({ book }, 'book-detail-request', error.message); }
}
if (options.book && !report.books.length) throw new Error(`Book not found in public catalog: ${options.book}`);
const selectedBooks = catalog.books.filter(book => !options.book || book.id === options.book);
const readable = selectedBooks.filter(book => book.section_count > 0);
const originalTasks = readable.flatMap(book => Array.from({ length: book.section_count }, (_, index) => ({ book, number: index + 1, mode: 'original' }))).slice(0, limit);
const modernTasks = ['parallel', 'modern'].flatMap(mode => readable.filter(book => book.has_modern).flatMap(book =>
  Array.from({ length: book.section_count }, (_, index) => ({ book, number: index + 1, mode }))).slice(0, limit));
report.cases.expected = (originalTasks.length + modernTasks.length) * widths.length;
const { chromium } = await import(options.playwright.startsWith('/') ? pathToFileURL(options.playwright).href : options.playwright);
const browser = await chromium.launch({ executablePath: options.chromium, headless: true,
  handleSIGINT: false, handleSIGTERM: false, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function captureFailure(page, task) {
  if (screenshotCount >= 20) return;
  const filename = `${task.width}-${task.book.id}-${task.number || 'library'}-${task.mode || 'original'}.png`;
  try {
    await page.screenshot({ path: path.join(output, filename), fullPage: false, timeout });
    screenshotCount++; report.screenshots.push(filename);
  } catch (_) { /* Preserve failures even when the page cannot take a screenshot. */ }
}

async function waitForSurface(page, selector) {
  await page.evaluate(async selector => {
    const animations = new Set();
    for (let element = document.querySelector(selector); element; element = element.parentElement) {
      element.getAnimations().forEach(animation => animations.add(animation));
    }
    await Promise.allSettled([...animations].map(animation => animation.finished));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, selector);
  await page.waitForFunction(selector => {
    const target = document.querySelector(selector);
    if (!target?.getClientRects().length) return false;
    for (let element = target; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  }, selector, { timeout });
}

async function auditDirectory(page, task) {
  const claim = `${task.width}:${task.book.id}`;
  if (directoryClaims.has(claim)) return;
  directoryClaims.add(claim);
  const expected = details.get(task.book.id)?.contents;
  if (!expected) { problem(task, 'directory-source', 'No public book detail was available for comparison.'); return; }
  const wide = task.width >= 1100;
  const selector = wide ? '.book-sidebar' : '.sheet-book-contents';
  if (!wide || !await page.locator(selector).isVisible()) await page.locator('.book-directory').click();
  await page.locator(selector).waitFor({ state: 'visible', timeout });
  await waitForSurface(page, selector);
  await page.locator(selector).getByLabel('搜索目录', { exact: true }).fill('');
  const actual = await page.locator(selector).locator('.book-contents-item').evaluateAll(elements => elements.map(element => ({
    number: Number(element.querySelector('.book-contents-number')?.textContent),
    title: element.querySelector('b')?.textContent,
    location: element.querySelector('span:nth-child(2) > small')?.textContent || element.querySelector('b')?.textContent,
    partial: Boolean(element.querySelector(':scope > small')), current: element.getAttribute('aria-current') === 'page',
    visible: (() => {
      if (!element.getClientRects().length) return false;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      }
      return true;
    })(),
  })));
  if (actual.length !== expected.length) problem(task, 'directory-count', `Expected ${expected.length} entries; rendered ${actual.length}.`);
  expected.forEach((item, index) => {
    const row = actual[index];
    if (!row || row.number !== item.number || row.title !== item.title || row.location !== item.location || row.partial !== item.partial || row.current !== (item.number === task.number) || !row.visible) {
      problem(task, 'directory-entry', 'Directory entry or current-page position differs from the public API.', { index, expected: item, actual: row });
    }
  });
  report.directories.push({ width: task.width, book_id: task.book.id, entries: actual.length, surface: wide ? 'sidebar' : 'sheet' });
  if (!wide) {
    await page.locator('.sheet-book-contents .sheet-head button').click();
    await page.locator('.sheet-book-contents').waitFor({ state: 'detached', timeout });
  }
}

// This runs in the real reader DOM after the current public response is ready.
function inspectReader({ book, section, mode }) {
  const failures = [];
  const fail = (check, detail, extra = {}) => failures.push({ check, detail, ...extra });
  const text = (element, selector) => element.querySelector(selector)?.textContent ?? null;
  let hiddenReason = null;
  const visible = element => {
    hiddenReason = null;
    if (!element?.getClientRects().length) { hiddenReason = 'No rendered client rectangles.'; return false; }
    const rect = element.getBoundingClientRect();
    let scrollX = false, scrollY = false;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none' || Number(style.opacity) === 0) {
        hiddenReason = { ancestor: ancestor.className, visibility: style.visibility, display: style.display, opacity: style.opacity }; return false;
      }
      if (ancestor === document.body || ancestor === document.documentElement) continue;
      const box = ancestor.getBoundingClientRect();
      if (['hidden', 'clip'].includes(style.overflowX) && !scrollX &&
          (ancestor === element ? ancestor.scrollWidth > ancestor.clientWidth + 2 : rect.left < box.left - 2 || rect.right > box.right + 2)) {
        hiddenReason = { ancestor: ancestor.className, overflow_x: style.overflowX, element: { left: rect.left, right: rect.right }, ancestor_box: { left: box.left, right: box.right } }; return false;
      }
      if (['hidden', 'clip'].includes(style.overflowY) && !scrollY &&
          (ancestor === element ? ancestor.scrollHeight > ancestor.clientHeight + 2 : rect.top < box.top - 2 || rect.bottom > box.bottom + 2)) {
        hiddenReason = { ancestor: ancestor.className, overflow_y: style.overflowY, element: { top: rect.top, bottom: rect.bottom }, ancestor_box: { top: box.top, bottom: box.bottom } }; return false;
      }
      scrollX ||= ['auto', 'scroll'].includes(style.overflowX);
      scrollY ||= ['auto', 'scroll'].includes(style.overflowY);
    }
    return true;
  };
  const root = document.querySelector('.book-reading-content');
  if (root.dataset.mode !== (book.has_modern ? mode : 'original')) fail('reader-mode', 'Reader does not display the requested mode.');
  const modeButtons = [...document.querySelectorAll('[data-book-mode]')];
  if (modeButtons.length !== (book.has_modern ? 3 : 0)) fail('mode-controls', 'Reading modes are missing from the toolbar or shown for a book without translation.');
  modeButtons.forEach(button => {
    if (!visible(button) || button.getAttribute('aria-pressed') !== String(button.dataset.bookMode === mode)) fail('mode-control-state', 'A direct reading-mode button is hidden or its active state differs.', { button_mode: button.dataset.bookMode });
  });
  const blocks = [...root.querySelectorAll(':scope > .book-block')];
  if (blocks.length !== section.blocks.length) fail('block-count', `Expected ${section.blocks.length}, rendered ${blocks.length}.`);
  const header = root.querySelector('.book-section-header');
  if (text(header, '.books-source') !== section.location) fail('section-location', 'Displayed source location differs.');
  const title = text(header, 'h2') || text(header, '.books-source');
  if (title !== section.title) fail('section-title', 'Displayed section title differs.');
  const notice = root.querySelector('.book-page-notice');
  if ((text(notice || document.createElement('div'), 'p') || '') !== section.notice) fail('section-notice', 'Page notice differs from the API.');
  if (Boolean(notice?.querySelector('strong')) !== section.partial) fail('partial-notice', 'Partial-page warning is missing or unexpected.');
  if (notice && !visible(notice)) fail('section-notice-hidden', 'Page notice is not visible.');
  const pageNotes = [...root.querySelectorAll(':scope > .book-page-notes > p')];
  if (JSON.stringify(pageNotes.map(note => note.textContent)) !== JSON.stringify(section.page_notes || [])) fail('page-note-text', 'Page-level editorial notes differ from the API.');
  if (!section.blocks.length) {
    const marker = section.figures.length ? '书影' : '来源位置';
    const empty = [...root.querySelectorAll(':scope > p')].find(element => element.textContent.includes(marker));
    if (!visible(empty)) fail('empty-page-explanation', 'An empty source page has no visible explanation.');
    if (!section.notice && !(section.page_notes || []).length && !section.figures.length) fail('empty-source-context', 'An empty source page has no source-specific explanation or image.');
  }
  // Expand source transcriptions and editorial notes before checking their visibility.
  root.querySelectorAll('details').forEach((element, index) => {
    const summary = element.querySelector(':scope > summary');
    if (!visible(summary) || !summary.textContent.trim() || getComputedStyle(summary).pointerEvents === 'none') fail('details-summary', 'A source transcription or note cannot be expanded using its visible summary.', { details_index: index, visibility_reason: hiddenReason });
    if (!element.open) summary?.click();
    if (!element.open) fail('details-expansion', 'Clicking a transcription or note summary does not expand it.', { details_index: index });
  });
  pageNotes.forEach((note, index) => {
    if (!visible(note)) fail('page-note-visibility', 'An expanded page-level note is hidden.', { page_note_index: index });
    if (getComputedStyle(note).whiteSpace !== 'pre-wrap') fail('page-note-whitespace', 'Page-level notes do not preserve their line breaks.', { page_note_index: index });
  });
  section.blocks.forEach((expected, index) => {
    const element = blocks[index];
    if (!element) return;
    const original = element.querySelector('.book-original > p, .book-original > pre, .book-original > h3');
    const modern = element.querySelector('.book-modern > p');
    const notes = [...element.querySelectorAll('.book-notes > p')];
    if (original?.textContent !== expected.text) fail('original-text', 'Original text differs byte for byte.', { index });
    if ((modern?.textContent || '') !== expected.modern) fail('modern-text', 'Modern text differs byte for byte.', { index });
    if (JSON.stringify(notes.map(note => note.textContent)) !== JSON.stringify(expected.notes)) fail('note-text', 'Editorial notes differ.', { index });
    const originalExpected = mode !== 'modern' || !expected.modern;
    if (visible(original) !== originalExpected) fail('original-visibility', `Original visibility differs in ${mode} mode.`, { index, visibility_reason: hiddenReason });
    if (Boolean(modern && visible(modern)) !== Boolean(expected.modern && mode !== 'original')) fail('modern-visibility', `Modern visibility differs in ${mode} mode.`, { index });
    if (mode === 'parallel' && book.has_modern && innerWidth >= 900) {
      const left = element.firstElementChild?.getBoundingClientRect();
      const right = element.querySelector('.book-modern, .book-modern-empty')?.getBoundingClientRect();
      if (getComputedStyle(element).display !== 'grid' || !left || !right || right.left <= left.right || Math.abs(right.top - left.top) > 2 || Math.abs(right.width - left.width) > 2) fail('parallel-columns', 'Original and translation do not occupy matching adjacent columns.', { index });
    }
    notes.forEach((note, noteIndex) => {
      if (!visible(note)) fail('note-visibility', 'An expanded note is hidden.', { index, note_index: noteIndex });
      if (getComputedStyle(note).whiteSpace !== 'pre-wrap') fail('note-whitespace', 'Editorial notes do not preserve their line breaks.', { index, note_index: noteIndex });
    });
    const diagram = expected.presentation === 'diagram' || expected.role === 'diagram_caption' || expected.source_text === false;
    const table = expected.presentation === 'table' || expected.role === 'table';
    if (diagram || table) {
      if (original?.tagName !== 'PRE' || getComputedStyle(original).whiteSpace !== 'pre') fail('transcription-format', 'A table or diagram does not preserve its preformatted whitespace.', { index });
      if (original && original.tabIndex < 0 && original.scrollWidth > original.clientWidth + 1) fail('transcription-keyboard', 'A wide transcription cannot receive keyboard focus.', { index });
    } else if (original) {
      const continuous = root.dataset.layout === 'continuous' && original.tagName === 'P'
        && ['prose', 'text', 'note', 'commentary'].includes(expected.role);
      const whitespace = continuous ? 'normal' : 'pre-wrap';
      if (getComputedStyle(original).whiteSpace !== whitespace) fail('prose-whitespace', 'Text does not follow the selected reading layout.', { index, layout: root.dataset.layout, expected: whitespace });
      original.querySelectorAll('.book-source-break').forEach((lineBreak, breakIndex) => {
        const display = getComputedStyle(lineBreak).display;
        const kind = lineBreak.dataset.kind;
        const wanted = continuous && kind === 'soft' ? 'none' : continuous && kind === 'paragraph' ? 'block' : 'inline';
        if (display !== wanted) fail('source-break-layout', 'A source line break is displayed incorrectly for the selected layout.', { index, break_index: breakIndex, kind, expected: wanted, actual: display });
      });
    }
    if (expected.text.includes('\t') && original?.tagName !== 'PRE') fail('tab-columns', 'A source block containing column tabs is rendered as prose.', { index });
    if (!element.classList.contains(`book-role-${expected.role}`)) fail('block-role', 'Original block role differs.', { index });
    if (['note', 'commentary'].includes(expected.role) && text(element, '.book-original > .book-layer') !== (expected.role === 'note' ? '原注' : '评注')) fail('original-note-label', 'Original note or commentary is labelled incorrectly.', { index });
  });
  if (document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1) fail('viewport-overflow', 'The page has horizontal overflow.', { viewport: innerWidth, document_width: document.documentElement.scrollWidth });
  const prev = document.querySelector('.book-page-prev');
  const next = document.querySelector('.book-page-next');
  if (prev?.disabled !== (section.number <= 1)) fail('previous-state', 'Previous-page control has the wrong boundary state.');
  if (next?.disabled !== (section.number >= book.section_count)) fail('next-state', 'Next-page control has the wrong boundary state.');
  const counter = `${section.number} / ${book.section_count}`;
  if (text(document, '.book-directory small') !== counter || document.querySelector('.book-reading-pagination')?.children[1]?.textContent !== counter) fail('page-counter', 'Reader page counter differs.');
  for (const [relation, expectedNumber, exists] of [['prev', section.number - 1, section.number > 1], ['next', section.number + 1, section.number < book.section_count]]) {
    const link = document.querySelector(`.book-reading-pagination [rel=${relation}]`);
    const expectedHref = `#/books/${encodeURIComponent(book.id)}?page=${expectedNumber}`;
    if (Boolean(link) !== exists || (link && link.getAttribute('href') !== expectedHref)) fail('pagination-link', `The ${relation} link points to the wrong page.`);
  }
  const figures = [...root.querySelectorAll(':scope > .book-figure')];
  if (figures.length !== section.figures.length) fail('figure-count', 'Rendered figure count differs from the API.');
  section.figures.forEach((expected, index) => {
    const element = figures[index];
    if (!element) return;
    const image = element.querySelector('img');
    if (text(element, 'figcaption') !== expected.caption || image?.getAttribute('src') !== expected.url ||
        Number(image?.getAttribute('width')) !== expected.width || Number(image?.getAttribute('height')) !== expected.height) fail('figure-metadata', 'Figure caption, URL, or declared dimensions differ.', { figure_index: index });
    if (!element.querySelector('button.book-figure-open') || element.querySelector('a[target="_blank"]')) fail('figure-interaction', 'Figure cannot open in the reader image viewer.', { figure_index: index });
  });
  return failures;
}

async function auditCase(page, task) {
  const before = caseFailures.get(caseKey(task)) || 0;
  const key = `${task.width}:${task.book.id}:${task.mode}`;
  if (!coverage.has(key)) coverage.set(key, { width: task.width, book_id: task.book.id, mode: task.mode,
    attempted_pages: 0, passed_pages: 0, failed_pages: 0, blocks: 0, notes: 0, page_notes: 0, modern_blocks: 0, figures: 0, figures_opened: 0, empty_pages: 0, pure_figure_pages: 0 });
  const row = coverage.get(key);
  row.attempted_pages++; report.cases.attempted++;
  try {
    const route = `/api/books/${encodeURIComponent(task.book.id)}/sections/${task.number}`;
    const target = `${base}/#/books/${encodeURIComponent(task.book.id)}?page=${task.number}`;
    if (!page.url().startsWith(base)) {
      await page.goto(`${base}/#/books`, { waitUntil: 'domcontentloaded', timeout });
      await page.locator('.books-card').first().waitFor({ timeout });
    }
    await page.evaluate(mode => localStorage.setItem('xz-book-mode', mode), task.mode);
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === route && response.request().method() === 'GET', { timeout }),
      page.url() === target ? page.reload({ waitUntil: 'domcontentloaded', timeout }) : page.goto(target, { waitUntil: 'domcontentloaded', timeout }),
    ]);
    if (!response.ok()) throw new Error(`Section API returned HTTP ${response.status()}.`);
    const section = await response.json();
    if (section.book_id !== task.book.id || section.number !== task.number) throw new Error('Section response has the wrong book or page identity.');
    await page.waitForFunction(({ title, counter, location }) => {
      const content = document.querySelector('.book-reading-content');
      return content?.getAttribute('aria-busy') === 'false' &&
        document.querySelector('.book-reading-header h1')?.textContent === title &&
        document.querySelector('.book-directory small')?.textContent === counter &&
        content.querySelector('.book-section-header .books-source')?.textContent === location;
    }, { title: task.book.title, counter: `${task.number} / ${task.book.section_count}`, location: section.location }, { timeout });
    await waitForSurface(page, '.book-reading');
    if (task.book.has_modern) {
      await page.locator(`[data-book-mode="${task.mode}"]`).click();
      await page.waitForFunction(mode => document.querySelector('.book-reading-content')?.dataset.mode === mode, task.mode, { timeout });
    }
    row.blocks += section.blocks.length;
    row.notes += section.blocks.reduce((sum, block) => sum + block.notes.length, 0);
    row.page_notes += (section.page_notes || []).length;
    row.modern_blocks += section.blocks.filter(block => block.modern).length;
    row.figures += section.figures.length;
    if (!section.blocks.length) { row.empty_pages++; if (section.figures.length) row.pure_figure_pages++; }
    const publicEntry = details.get(task.book.id)?.contents[task.number - 1];
    if (!publicEntry || ['number', 'title', 'location', 'partial'].some(field => publicEntry[field] !== section[field])) problem(task, 'contents-section', 'The public directory entry differs from the section response.');
    const failures = await page.evaluate(inspectReader, { book: task.book, section, mode: task.mode });
    failures.forEach(failure => problem(task, failure.check, failure.detail, failure));
    const imageFailures = await page.locator('.book-figure img').evaluateAll(async (images, figures) => {
      const failures = [];
      await Promise.all(images.map(async (image, index) => {
        image.loading = 'eager';
        let timer;
        try {
          await Promise.race([image.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Image decode timed out.')), 10000); })]);
          if (!image.getClientRects().length || image.naturalWidth !== figures[index].width || image.naturalHeight !== figures[index].height) failures.push({ index, detail: 'Decoded image is hidden or its actual dimensions differ.', natural_width: image.naturalWidth, natural_height: image.naturalHeight });
        } catch (error) { failures.push({ index, detail: error.message }); }
        finally { clearTimeout(timer); }
      }));
      return failures;
    }, section.figures);
    imageFailures.forEach(failure => problem(task, 'figure-decode', failure.detail, failure));
    for (let index = 0; index < section.figures.length; index++) {
      const figure = section.figures[index];
      await page.locator('.book-figure-link').nth(index).click();
      await page.locator('.book-image-stage img:not([hidden])').waitFor({ state: 'visible', timeout });
      await waitForSurface(page, '.book-image-stage');
      await page.waitForFunction(() => {
        const panel = document.querySelector('.sheet-book-image');
        const image = panel?.querySelector('.book-image-stage img');
        return image?.style.width && image.style.height && Number(getComputedStyle(panel).opacity) > 0 && Number(getComputedStyle(panel.parentElement).opacity) > 0;
      }, null, { timeout });
      const viewer = await page.locator('.book-image-stage img').evaluate(async image => {
        await image.decode();
        const box = image.getBoundingClientRect(), stage = image.parentElement.getBoundingClientRect();
        return { natural_width: image.naturalWidth, natural_height: image.naturalHeight,
          width: box.width, height: box.height, stage_width: stage.width, stage_height: stage.height,
          caption: document.querySelector('.book-image-caption')?.textContent };
      });
      if (viewer.natural_width !== figure.width || viewer.natural_height !== figure.height || viewer.width <= 0 || viewer.height <= 0 ||
          viewer.width > viewer.stage_width + 1 || viewer.height > viewer.stage_height + 1 || viewer.caption !== figure.caption) {
        problem(task, 'figure-viewer', 'The in-page viewer hides, clips, or changes the figure.', { figure_index: index, viewer });
      } else row.figures_opened++;
      await page.locator('.sheet-book-image .sheet-head button').click();
      await page.locator('.sheet-book-image').waitFor({ state: 'detached', timeout });
    }
    if (task.mode === 'original') await auditDirectory(page, task);
  } catch (error) {
    const closed = page.isClosed() || !browser.isConnected();
    problem(task, closed ? 'runner-browser-closed' : 'reader-exception', error.message);
    if (closed) { stopRequested = true; report.interrupted ||= 'browser-closed'; }
  }
  const failed = (caseFailures.get(caseKey(task)) || 0) > before;
  if (failed) { row.failed_pages++; report.cases.failed++; await captureFailure(page, task); }
  else { row.passed_pages++; report.cases.passed++; }
  if (report.cases.attempted - lastProgress >= 250) {
    lastProgress = report.cases.attempted;
    console.log(JSON.stringify({ progress: report.cases.attempted, expected: report.cases.expected, failures: report.failures.length, latest: { width: task.width, book: task.book.id, number: task.number, mode: task.mode } }));
    await writeReport();
  }
}

async function auditLibrary(page, width) {
  const task = { width, book: { id: 'catalog' } };
  const before = report.failures.length;
  try {
    await page.goto(`${base}/#/books`, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForFunction(count => document.querySelectorAll('.books-card').length === count, catalog.books.length, { timeout });
    const cards = await page.locator('.books-card').evaluateAll(elements => elements.map(element => ({ title: element.querySelector('h2')?.textContent,
      source_label: element.querySelector('.books-source')?.textContent, notice: element.querySelector('.books-notice')?.textContent,
      readable: Boolean(element.querySelector('a')), href: element.querySelector('a')?.getAttribute('href') })));
    for (const book of catalog.books) {
      const card = cards.find(card => card.title === book.title);
      if (!card || card.source_label !== book.source_label || card.notice !== book.notice || card.readable !== (book.section_count > 0)) problem(task, 'library-card', 'Book card differs from its public metadata.', { book_id: book.id });
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) problem(task, 'library-overflow', 'Library has horizontal overflow.');
    report.libraries.push({ width, books: cards.length });
    for (const book of selectedBooks.filter(book => !book.section_count)) {
      await page.goto(`${base}/#/books/${encodeURIComponent(book.id)}?page=1`, { waitUntil: 'domcontentloaded', timeout });
      await page.waitForFunction(title => document.querySelector('.book-reading-header h1')?.textContent === title && document.querySelector('.book-reading-content')?.getAttribute('aria-busy') === 'false', book.title, { timeout });
      if (!(await page.locator('.book-reading-content').innerText()).includes('电子成品待恢复')) problem({ width, book }, 'unavailable-explanation', 'Unavailable book has no visible explanation.');
    }
  } catch (error) { problem(task, 'library-exception', error.message); }
  if (report.failures.length > before) await captureFailure(page, task);
}

try {
  for (const width of widths) {
    if (stopRequested) break;
    const pool = [];
    for (let index = 0; index < workers; index++) {
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        if (localStorage.getItem('xz-book-mode') === null) localStorage.setItem('xz-book-mode', 'original');
        localStorage.setItem('xz-book-filters', '{}');
      });
      const page = await context.newPage(); page.setDefaultTimeout(timeout);
      const worker = { context, page, current: null };
      page.on('pageerror', error => problem(worker.current || { width }, 'javascript-error', error.message));
      pool.push(worker);
    }
    await auditLibrary(pool[0].page, width);
    for (const phase of [originalTasks, modernTasks]) {
      if (stopRequested) break;
      let cursor = 0;
      await Promise.all(pool.map(async worker => {
        while (cursor < phase.length && !stopRequested) {
          const task = { ...phase[cursor++], width };
          worker.current = task;
          await auditCase(worker.page, task);
        }
        worker.current = null;
      }));
    }
    await Promise.all(pool.map(worker => worker.context.close()));
    console.log(JSON.stringify({ width_complete: width, attempted: report.cases.attempted, failures: report.failures.length }));
    await writeReport();
  }
} catch (error) { problem(null, 'audit-runner', error.stack || error.message); }
finally { await browser.close(); }
report.finished_at = new Date().toISOString();
report.passed = !report.interrupted && report.failures.length === 0 && report.cases.attempted === report.cases.expected;
await writeReport();
console.log(JSON.stringify({ passed: report.passed, exhaustive: report.exhaustive, cases: report.cases,
  failure_count: report.failures.length, report: path.join(output, 'report.json') }));
process.exitCode = report.passed ? 0 : 1;
