"use strict";
(function (global) {
  const escapeHtml = value => String(value ?? "").replace(
    /[&<>"']/g,
    char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]),
  );

  function renderInlineMarkdown(text) {
    return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  const canonicalReasoningHeading = /^#{2,4}\s+为什么这么判断[：:]?\s*$/;
  const alternateReasoningHeading = /^(?:#{2,4}\s+|\*\*)为什么[^*]{0,32}(?:\*\*)?\s*$/;
  const horizontalRule = /^([-*_])(?:\s*\1){2,}$/;

  function trimmedSection(lines) {
    const kept = lines.slice();
    while (kept.length && (!kept[0].trim() || horizontalRule.test(kept[0].trim()))) kept.shift();
    while (kept.length && (
      !kept[kept.length - 1].trim() || horizontalRule.test(kept[kept.length - 1].trim())
    )) kept.pop();
    return kept.join("\n").trim();
  }

  function splitReasoningSection(text) {
    const lines = String(text || "").split(/\r?\n/);
    const index = lines.findIndex(raw => (
      canonicalReasoningHeading.test(raw.trim()) || alternateReasoningHeading.test(raw.trim())
    ));
    if (index <= 0) return null;
    const answer = trimmedSection(lines.slice(0, index));
    const reasoning = trimmedSection(
      lines.slice(index + 1).filter(raw => !canonicalReasoningHeading.test(raw.trim())),
    );
    if (!answer || !reasoning) return null;
    return { answer, reasoning };
  }

  function renderMarkdownBody(text) {
    const lines = String(text || "").split(/\r?\n/);
    const html = [];
    let list = "";
    const closeList = () => {
      if (!list) return;
      html.push(`</${list}>`);
      list = "";
    };
    lines.forEach(raw => {
      const line = raw.trim();
      if (!line) { closeList(); return; }
      const heading = /^(#{2,4})\s+(.+)$/.exec(line);
      if (heading) {
        closeList();
        const level = Math.min(4, heading[1].length);
        html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        return;
      }
      const bullet = /^[-*]\s+(.+)$/.exec(line);
      if (bullet) {
        if (list !== "ul") { closeList(); html.push("<ul>"); list = "ul"; }
        html.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
        return;
      }
      const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
      if (ordered) {
        if (list !== "ol") { closeList(); html.push("<ol>"); list = "ol"; }
        html.push(`<li>${renderInlineMarkdown(ordered[1])}</li>`);
        return;
      }
      closeList();
      html.push(`<p>${renderInlineMarkdown(line)}</p>`);
    });
    closeList();
    return html.join("");
  }

  function renderBody(text) {
    const section = splitReasoningSection(text);
    if (!section) return renderMarkdownBody(text);
    return `${renderMarkdownBody(section.answer)}<details class="ai-reasoning"><summary>为什么这么判断</summary><div class="ai-reasoning-body">${renderMarkdownBody(section.reasoning)}</div></details>`;
  }

  function renderMarkdownElements(root) {
    (root || document).querySelectorAll("[data-chat-markdown]").forEach(el => {
      el.innerHTML = renderBody(el.textContent || "");
      el.removeAttribute("data-chat-markdown");
      el.setAttribute("data-chat-rendered", "markdown");
    });
  }

  global.XuanxueChatRenderer = {
    escapeHtml,
    renderInlineMarkdown,
    splitReasoningSection,
    renderBody,
    renderMarkdownElements,
  };
})(window);
