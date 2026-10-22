// A deliberately small reading format. Never parse source text as HTML.
const readingVersion = version => typeof version === "string" && version.startsWith("reading-20261022-");
const lineText = line => line.replace(/\r?\n$/, "");
const fenceStart = line => /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(lineText(line));
const heading = line => /^(#{1,6})[ \t]+(.+)$/.exec(lineText(line));
const definition = line => /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/.exec(lineText(line));
const summary = line => /^<summary>(.*)<\/summary>$/.exec(lineText(line));
const closesFence = (line, open) => {
  const value = lineText(line).trim();
  return value.length >= open[2].length && [...value].every(char => char === open[2][0]);
};

// Source locators in the manuscript are HTML comments, not reading text. Skip
// only balanced comments; fenced and inline literal examples remain verbatim.
function withoutReadingComments(value) {
  const text = String(value ?? "");
  if (!text.includes("<!--")) return text;
  let output = "", i = 0, fence = null;
  while (i < text.length) {
    if (i === 0 || text[i - 1] === "\n") {
      let end = text.indexOf("\n", i);
      end = end < 0 ? text.length : end + 1;
      const line = text.slice(i, end);
      if (fence) {
        output += line; i = end;
        if (closesFence(line, fence)) fence = null;
        continue;
      }
      const open = fenceStart(line);
      if (open) { fence = open; output += line; i = end; continue; }
    }
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end >= 0) {
        output += text.slice(i, end + 3).replace(/[^\r\n]/g, "");
        i = end + 3; continue;
      }
    }
    if (text[i] === "`") {
      const run = /^`+/.exec(text.slice(i))[0];
      const end = text.indexOf(run, i + run.length);
      const newline = text.indexOf("\n", i);
      if (end >= 0 && (newline < 0 || end < newline)) {
        output += text.slice(i, end + run.length); i = end + run.length; continue;
      }
    }
    output += text[i++];
  }
  return output;
}

const listItem = line => /^ {0,3}([-+*]|\d+[.)])[ \t]+(.+)$/.exec(lineText(line));
function tableCells(line) {
  let value = lineText(line).trim();
  if (!value.includes("|")) return null;
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
  const cells = []; let cell = "", code = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && value[i + 1] === "|") { cell += "|"; i++; continue; }
    if (value[i] === "`") {
      const run = /^`+/.exec(value.slice(i))[0];
      if (!code) code = run; else if (code === run) code = "";
      cell += run; i += run.length - 1; continue;
    }
    if (value[i] === "|" && !code) { cells.push(cell.trim()); cell = ""; }
    else cell += value[i];
  }
  cells.push(cell.trim());
  return cells;
}

export function readingMarkdownTokens(text, depth = 0) {
  const lines = withoutReadingComments(text).match(/[^\n]*\n|[^\n]+$/g) || [];
  const tokens = [];
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    // Some transcriptions use aligned plain text instead of Markdown fences for
    // hexagram rows. Keep those columns intact when prose uses flowing layout.
    const diagramRows = paragraph.filter(line => /[▅▆▇▉█▁─━′″○●×]/.test(line) && /\S[ \t]+\S/.test(line));
    const tabRows = paragraph.filter(line => /\S\t+\S/.test(line));
    const columnRows = paragraph.filter(line => (line.match(/\S {2,}(?=\S)/g) || []).length >= 2);
    const aligned = diagramRows.length >= 2 || tabRows.length >= 2 || columnRows.length >= 2;
    tokens.push({ type: aligned ? "code" : "paragraph", text: paragraph.join("") });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = fenceStart(line);
    if (fence) {
      flush();
      const content = [];
      while (++i < lines.length && !closesFence(lines[i], fence)) content.push(lines[i]);
      tokens.push({ type: "code", text: content.join("") });
      continue;
    }
    // Only this exact, balanced, attribute-free details/summary shape is supported.
    if (depth < 16 && lineText(line) === "<details>" && summary(lines[i + 1] || "")) {
      let nesting = 1, end = i + 2, inFence = null;
      for (; end < lines.length; end++) {
        if (inFence) { if (closesFence(lines[end], inFence)) inFence = null; continue; }
        inFence = fenceStart(lines[end]);
        if (inFence) continue;
        if (lineText(lines[end]) === "<details>") nesting++;
        if (lineText(lines[end]) === "</details>" && --nesting === 0) break;
      }
      if (end < lines.length) {
        flush();
        tokens.push({ type: "details", summary: summary(lines[i + 1])[1],
          children: readingMarkdownTokens(lines.slice(i + 2, end).join(""), depth + 1) });
        i = end;
        continue;
      }
    }
    const columns = tableCells(line);
    const separators = tableCells(lines[i + 1] || "");
    if (columns?.length > 1 && separators?.length === columns.length && separators.every(cell => /^:?-{3,}:?$/.test(cell))) {
      flush();
      const rows = [];
      i++;
      while (i + 1 < lines.length) {
        const row = tableCells(lines[i + 1]);
        if (!row || row.length !== columns.length || !lineText(lines[i + 1]).trim()) break;
        rows.push(row); i++;
      }
      tokens.push({ type: "table", columns, rows, align: separators.map(cell => cell.startsWith(":") ? cell.endsWith(":") ? "center" : "left" : cell.endsWith(":") ? "right" : "left") });
      continue;
    }
    const item = listItem(line);
    if (item) {
      flush();
      const ordered = /^\d/.test(item[1]);
      const items = [item[2]];
      while (i + 1 < lines.length) {
        const next = listItem(lines[i + 1]);
        if (next && /^\d/.test(next[1]) === ordered) { items.push(next[2]); i++; }
        else if (/^(?: {4}|\t)\S/.test(lines[i + 1])) items[items.length - 1] += `\n${lineText(lines[++i]).replace(/^(?: {4}|\t)/, "")}`;
        else break;
      }
      tokens.push({ type: "list", ordered, start: ordered ? parseInt(item[1], 10) : 1, items });
      continue;
    }
    const title = heading(line);
    const note = definition(line);
    if (title) { flush(); tokens.push({ type: "heading", level: title[1].length, text: title[2] }); }
    else if (note) {
      flush();
      let text = note[2];
      while (i + 1 < lines.length && /^(?: {4}|\t)\S?/.test(lines[i + 1])) text += `\n${lineText(lines[++i]).replace(/^(?: {4}|\t)/, "")}`;
      tokens.push({ type: "footnote", label: note[1], text });
    } else if (!lineText(line).trim()) flush();
    else paragraph.push(line);
  }
  flush();
  return tokens;
}

// Prefer definitions in this chapter, then index supplied chapters of this edition.
export function createReadingMarkdownContext(texts, options = {}) {
  const definitions = new Map();
  const collect = (tokens, chapterId) => {
    for (const token of tokens) {
      if (token.type === "footnote" && !definitions.has(token.label)) definitions.set(token.label, { ...token, chapterId });
      if (token.children) collect(token.children, chapterId);
    }
  };
  for (const text of texts) collect(readingMarkdownTokens(text), options.chapterId);
  for (const chapter of options.chapters || []) {
    if (chapter.id === options.chapterId) continue;
    for (const block of chapter.blocks) collect(readingMarkdownTokens(block.text), chapter.id);
  }
  let index = 0;
  for (const token of definitions.values()) token.id = `reading-footnote-${++index}`;
  return { definitions, renderedDefinitions: new Set(), ...options };
}

export function focusReadingFootnote(context, label, doc = document) {
  const target = context.definitions.get(label);
  if (!target || target.chapterId !== context.chapterId) return false;
  const footnote = doc.getElementById(target.id);
  if (!footnote) return false;
  for (let ancestor = footnote.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.tagName === "DETAILS") ancestor.open = true;
  }
  footnote.scrollIntoView({ block: "center" });
  footnote.focus({ preventScroll: true });
  return true;
}

function httpsUrl(value) {
  if (!/^https:\/\//i.test(value) || /[\s<>"'\u0000-\u001f\u007f]/u.test(value)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !!url.hostname; }
  catch { return false; }
}

function appendInline(parent, text, context, doc, depth = 0) {
  // Consume any HTML-like span as literal text before looking for URLs inside it.
  // Unsupported Markdown links are also consumed whole, including unsafe schemes.
  const pattern = /<[^>\n]*>|\[\^(?<footnote>[^\]\s]+)\]|\[(?<label>[^\]\n]+)\]\((?<url>[^)\n]*)\)|https:\/\/[^\s<>"'`]+|(?<code>`+)(?<literal>[^\n]*?)\k<code>(?!`)|\*\*(?<strong>\S(?:[^\n]*?\S)?)\*\*|(?<!\*)\*(?<em>\S(?:[^*\n]*?\S)?)\*(?!\*)|(?<![\p{L}\p{N}_])__(?<strongUnder>\S(?:[^\n]*?\S)?)__(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])_(?<emUnder>\S(?:[^_\n]*?\S)?)_(?![\p{L}\p{N}_])/giu;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(doc.createTextNode(text.slice(end, match.index)));
    let node = doc.createTextNode(match[0]);
    const { footnote, label, url: suppliedUrl, code, literal, strong, em, strongUnder, emUnder } = match.groups;
    if (code || strong || em || strongUnder || emUnder) {
      node = doc.createElement(code ? "code" : strong || strongUnder ? "strong" : "em");
      const content = literal ?? strong ?? em ?? strongUnder ?? emUnder;
      if (code || depth >= 16) node.textContent = content;
      else appendInline(node, content, context, doc, depth + 1);
    } else if (footnote) {
      const target = context.definitions.get(footnote);
      if (target) {
        node = doc.createElement("sup");
        const link = doc.createElement("a");
        const path = target.chapterId !== context.chapterId ? context.footnotePath(target.chapterId, footnote) : null;
        link.setAttribute("href", path ? `#${path}` : `#${target.id}`);
        // Footnote navigation must not replace the application's hash route.
        link.addEventListener("click", event => {
          event.preventDefault();
          if (path) context.navigate(path);
          else focusReadingFootnote(context, footnote, doc);
        });
        link.textContent = match[0];
        node.append(link);
      } else {
        node = doc.createElement("span");
        node.className = "book-footnote-unresolved";
        node.setAttribute("title", "此版本未提供此脚注定义；保留原标记。");
        node.textContent = match[0];
      }
    } else if (!match[0].startsWith("<")) {
      let url = suppliedUrl ?? match[0];
      let tail = "";
      if (!suppliedUrl) {
        const trimmed = url.replace(/[.,;!?，。；！？、）】]+$/u, "");
        tail = url.slice(trimmed.length); url = trimmed;
      }
      if (httpsUrl(url)) {
        node = doc.createElement("a");
        node.setAttribute("href", url);
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
        node.textContent = label ?? url;
      }
      parent.append(node);
      if (tail && httpsUrl(url)) parent.append(doc.createTextNode(tail));
      end = match.index + match[0].length;
      continue;
    }
    parent.append(node);
    end = match.index + match[0].length;
  }
  parent.append(doc.createTextNode(text.slice(end)));
}

export function renderEditionText(versionId, text, context, doc = document) {
  if (!readingVersion(versionId)) {
    const paragraph = doc.createElement("p"); paragraph.textContent = text; return paragraph;
  }
  context ||= createReadingMarkdownContext([text]);
  const container = doc.createElement("div"); container.className = "book-reading-markdown";
  const render = (parent, tokens) => {
    for (const token of tokens) {
      const tag = { paragraph: "p", code: "pre", details: "details", footnote: "p", list: "div", table: "div" }[token.type] || `h${token.level}`;
      const node = doc.createElement(tag);
      if (token.type === "code") {
        node.setAttribute("tabindex", "0");
        node.setAttribute("aria-label", "原样文字，可横向滚动");
        const code = doc.createElement("code"); code.textContent = token.text; node.append(code);
      } else if (token.type === "list") {
        const list = doc.createElement(token.ordered ? "ol" : "ul");
        if (token.ordered && token.start !== 1) list.setAttribute("start", token.start);
        for (const value of token.items) { const item = doc.createElement("li"); appendInline(item, value, context, doc); list.append(item); }
        parent.append(list); continue;
      } else if (token.type === "table") {
        const wrapper = doc.createElement("div"); wrapper.className = "book-reading-table";
        wrapper.setAttribute("tabindex", "0"); wrapper.setAttribute("aria-label", "表格，可横向滚动");
        const table = doc.createElement("table");
        const head = doc.createElement("thead"), body = doc.createElement("tbody");
        for (const [isHead, values] of [[true, token.columns], ...token.rows.map(row => [false, row])]) {
          const row = doc.createElement("tr");
          values.forEach((value, index) => {
            const cell = doc.createElement(isHead ? "th" : "td");
            if (isHead) cell.setAttribute("scope", "col");
            cell.setAttribute("data-align", token.align[index]); appendInline(cell, value, context, doc); row.append(cell);
          });
          (isHead ? head : body).append(row);
        }
        table.append(head, body); wrapper.append(table); parent.append(wrapper); continue;
      } else if (token.type === "details") {
        const label = doc.createElement("summary"); appendInline(label, token.summary, context, doc);
        node.append(label); render(node, token.children);
      } else {
        if (token.type === "footnote") {
          node.className = "book-reading-footnote";
          if (!context.renderedDefinitions.has(token.label)) {
            node.setAttribute("id", context.definitions.get(token.label).id);
            node.setAttribute("tabindex", "-1");
            context.renderedDefinitions.add(token.label);
          }
          node.append(doc.createTextNode(`[^${token.label}]: `));
        }
        appendInline(node, token.text, context, doc);
      }
      parent.append(node);
    }
  };
  render(container, readingMarkdownTokens(text));
  return container;
}
