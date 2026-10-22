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

export function readingMarkdownTokens(text, depth = 0) {
  const lines = String(text ?? "").match(/[^\n]*\n|[^\n]+$/g) || [];
  const tokens = [];
  let paragraph = [];
  const flush = () => { if (paragraph.length) { tokens.push({ type: "paragraph", text: paragraph.join("") }); paragraph = []; } };
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

function appendInline(parent, text, context, doc) {
  // Consume any HTML-like span as literal text before looking for URLs inside it.
  // Unsupported Markdown links are also consumed whole, including unsafe schemes.
  const pattern = /<[^>\n]*>|\[\^([^\]\s]+)\]|\[([^\]\n]+)\]\(([^)\n]*)\)|https:\/\/[^\s<>"'`]+/gi;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(doc.createTextNode(text.slice(end, match.index)));
    let node = doc.createTextNode(match[0]);
    if (match[1]) {
      const target = context.definitions.get(match[1]);
      if (target) {
        node = doc.createElement("sup");
        const link = doc.createElement("a");
        const path = target.chapterId !== context.chapterId ? context.footnotePath(target.chapterId, match[1]) : null;
        link.setAttribute("href", path ? `#${path}` : `#${target.id}`);
        // Footnote navigation must not replace the application's hash route.
        link.addEventListener("click", event => {
          event.preventDefault();
          if (path) context.navigate(path);
          else focusReadingFootnote(context, match[1], doc);
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
      let url = match[3] ?? match[0];
      let tail = "";
      if (!match[3]) {
        const trimmed = url.replace(/[.,;!?，。；！？、）】]+$/u, "");
        tail = url.slice(trimmed.length); url = trimmed;
      }
      if (httpsUrl(url)) {
        node = doc.createElement("a");
        node.setAttribute("href", url);
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
        node.textContent = match[2] ?? url;
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
      const tag = { paragraph: "p", code: "pre", details: "details", footnote: "p" }[token.type] || `h${token.level}`;
      const node = doc.createElement(tag);
      if (token.type === "code") {
        node.setAttribute("tabindex", "0");
        node.setAttribute("aria-label", "原样文字，可横向滚动");
        const code = doc.createElement("code"); code.textContent = token.text; node.append(code);
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
