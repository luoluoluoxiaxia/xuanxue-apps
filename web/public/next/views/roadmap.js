import { h } from "../lib/dom.js?v=n18";
import { icon } from "../lib/icons.js?v=n18";
import { openFeedback } from "./feedback.js?v=n18";
import { openSheet } from "../ui/overlay.js?v=n18";

// 这是公开产品方向；“已有基础”只描述当前入口，不代表该方向已经完成。
const DIRECTIONS = [
  {
    number: "01", title: "八字", area: "tools", glyph: "pillars", status: "已有基础",
    purpose: "从排出命盘，到知道怎样读盘。",
    current: "免费排盘、私人档案和连续追问已经可用。",
    next: ["把术语、盘面与解释对应起来。", "整理从基础到进阶的命盘阅读路径。"],
    acceptance: "能从命盘找到术语解释，并沿着阅读路径逐步理解判断依据。",
    link: "#/ask/bazi", linkLabel: "打开八字排盘",
  },
  {
    number: "02", title: "六爻", area: "tools", glyph: "gua", status: "已有基础",
    purpose: "从起卦问事，到回看判断与结果。",
    current: "三钱六掷、手动录卦、社区求助与 AI 解读已经可用。",
    next: ["把卦象与判断过程讲清楚。", "方便记录结果，再回来对照原来的判断。"],
    acceptance: "能看懂判断的来由，并在事情有结果后回看与补充反馈。",
    link: "#/ask/liuyao", linkLabel: "打开六爻问事",
  },
  {
    number: "03", title: "论坛", area: "tools", glyph: "users", status: "已有基础",
    purpose: "让问题有人讨论，让经验留下来。",
    current: "广场已有话题筛选、评论回复和采纳反馈。",
    next: ["逐步整理八字、六爻与读书专题版块。", "增加独立讨论帖，沉淀有来有回的交流。"],
    acceptance: "能按专题找到讨论，并保留问题、回复与后续反馈的完整上下文。",
    link: "#/square", linkLabel: "去广场交流",
  },
  {
    number: "04", title: "AI 化", area: "tools", glyph: "sparkle", status: "已有基础",
    purpose: "帮助理解、追问与查证。",
    current: "AI 解读、多轮追问和回答反馈已经可用。",
    next: ["让解释能回到典籍出处，方便核对。", "辅助读书与比较案例，说明依据和疑点。"],
    acceptance: "能继续追问、核对引用出处，并看清回答中仍待确认的内容。",
    link: "#/ask/bazi", linkLabel: "试试 AI 追问",
  },
  {
    number: "05", title: "整理古书", area: "knowledge", glyph: "book", status: "已有基础",
    purpose: "让原文可读，来源可查，疑缺可补。",
    current: "书库已登记 17 本，16 本可阅读；原文初录稿仍待逐书校勘。",
    next: ["逐书校对原文，保留疑字与修订依据。", "补齐缺页与目录，改善图文阅读。"],
    acceptance: "能按目录阅读、回查来源，并识别尚未解决的疑字与缺文。",
    link: "#/books", linkLabel: "打开典籍书库",
  },
  {
    number: "06", title: "白话古书", area: "knowledge", glyph: "feather", status: "已有基础",
    purpose: "读得顺，也能对照原文。",
    current: "《子平真诠》已有 54 篇原文与白话对照，其他书尚待补齐。",
    next: ["逐本整理连贯白话，保留原文对应关系。", "补充术语与校记，区分原注和现代解释。"],
    acceptance: "能连续读白话、随时对照原文，并分清原注、校记与现代解释。",
    link: "#/books/ziping-zhenquan?page=1", linkLabel: "读子平真诠",
  },
  {
    number: "07", title: "收集网上流传案例", area: "knowledge", glyph: "globe", status: "规划中",
    purpose: "把分散案例留下来，也把出处留下来。",
    current: "来源可追溯的网上案例库尚在规划。",
    next: ["记录原始来源、时间与已知结果反馈。", "核验、去重，标明缺失信息与待证内容。"],
    acceptance: "每则案例能回查来源，并看清已有结果、缺失信息与核验状态。",
  },
  {
    number: "08", title: "整理归纳总结案例", area: "knowledge", glyph: "layers", status: "规划中",
    purpose: "从看一个故事，到比较一类问题。",
    current: "可分类、可对照的案例库尚在规划。",
    next: ["按来源、问题、判断与结果整理案例。", "对照异同，保留反例与方法的适用条件。"],
    acceptance: "能比较同类案例，回看原始材料，并区分已有事实与归纳判断。",
  },
  {
    number: "09", title: "串成线，方便使用", area: "journey", glyph: "compass", status: "规划中",
    purpose: "从一个问题出发，走完理解与实践的路径。",
    current: "书库、问事与广场分别可用；贯通它们的完整路径尚在规划。",
    next: ["把知识、案例、工具与讨论连接起来。", "让每次跳转保留上下文，并能回到出处。"],
    acceptance: "能从知识找到案例与工具，接着交流反馈，并随时返回原始出处。",
  },
];

const STAGES = [
  { number: "01", title: "夯实基础", description: "把工具做顺手，把经典整理清楚。", status: "已有基础 · 继续完善", established: true, columns: [["01", "02", "03"], ["05", "06"]] },
  { number: "02", title: "沉淀案例", description: "先留下出处与结果，再做分类对照。", status: "规划中", columns: [["07", "08"]] },
  { number: "03", title: "串联使用", description: "把知识、案例与工具连接成一条路。", status: "知识关联规划中", columns: [["04", "09"]], note: "AI 解读已有基础，知识关联待建设。" },
];

export function render() {
  let activeDetail = null;
  function showDirection(direction, trigger) {
    if (activeDetail) return;
    const body = h("div", { class: "roadmap-detail" },
      h("span", { class: `roadmap-detail-status${direction.status === "已有基础" ? " is-established" : ""}` }, direction.status),
      h("p", { class: "roadmap-detail-purpose", tabindex: "-1", autofocus: true }, direction.purpose),
      h("section", null, h("h3", null, "当前状态"), h("p", null, direction.current)),
      h("section", null, h("h3", null, "下一步"), h("ul", null, direction.next.map(text => h("li", null, text)))),
      h("section", null, h("h3", null, "怎样算做好"), h("p", null, direction.acceptance)));
    const footer = direction.link
      ? h("a", { class: "btn btn-primary", href: direction.link }, direction.linkLabel, icon("arrowRight", "icon-sm"))
      : h("button", { type: "button", class: "btn btn-primary", onClick: () => openFeedback() }, "对此提个建议");
    trigger.setAttribute("aria-expanded", "true");
    activeDetail = openSheet({ title: direction.title, body, footer, className: "sheet-roadmap-detail", returnFocus: trigger,
      onClose: () => { trigger.setAttribute("aria-expanded", "false"); activeDetail = null; } });
  }
  function directionRow(number) {
    const direction = DIRECTIONS.find(item => item.number === number);
    return h("li", null, h("button", { type: "button", class: "roadmap-direction", "aria-haspopup": "dialog", "aria-expanded": "false",
      "aria-label": `${direction.title}，查看路线图详情`, dataset: { roadmapNumber: direction.number },
      onClick: event => showDirection(direction, event.currentTarget) },
      h("span", { class: "roadmap-direction-icon" }, icon(direction.glyph)),
      h("span", { class: "roadmap-direction-title" }, direction.title), icon("arrowRight", "roadmap-direction-arrow")));
  }
  const node = h("div", { class: "roadmap-page" },
    h("header", { class: "roadmap-header" },
      h("img", { class: "roadmap-landscape", src: new URL("../assets/roadmap-landscape.webp?v=n18", import.meta.url).href, alt: "", "aria-hidden": "true", decoding: "async" }),
      h("div", { class: "roadmap-hero-copy" }, h("h1", null, "路线图"),
        h("p", { class: "roadmap-vision" }, "把经典、案例与实践，连成一条路。"),
        h("p", { class: "roadmap-updated" }, h("span", { class: "roadmap-update-dot", "aria-hidden": "true" }), "方向更新 · ", h("time", { datetime: "2026-10-07" }, "2026.10.07")))),
    h("ol", { class: "roadmap-timeline", "aria-label": "按依赖逐步推进的三个阶段" }, STAGES.map(stage => h("li", {
      class: `roadmap-stage${stage.established ? " is-established" : ""}`, dataset: { roadmapStage: stage.number } },
      h("span", { class: "roadmap-stage-number tnum", "aria-hidden": "true" }, stage.number),
      h("div", { class: "roadmap-stage-intro" }, h("h2", null, stage.title), h("p", null, stage.description),
        h("span", { class: "roadmap-stage-status" }, h("span", { "aria-hidden": "true" }), stage.status)),
      h("div", { class: "roadmap-stage-directions" }, stage.columns.map(column => h("ul", { class: "roadmap-direction-list" }, column.map(directionRow))),
        stage.note ? h("p", { class: "roadmap-stage-note" }, stage.note) : null)))),
    h("footer", { class: "roadmap-footer" },
      h("div", null, h("h2", null, "这也是一条需要你参与的路。"), h("p", null, "读书哪里卡住、工具哪里不顺、希望先补什么，都可以告诉我们。")),
      h("button", { type: "button", class: "btn btn-primary", onClick: () => openFeedback() }, icon("message", "icon-sm"), "提个建议")),
    h("nav", { class: "roadmap-start-links", "aria-label": "使用已有功能" },
      h("a", { href: "#/ask/bazi" }, "八字排盘"), h("a", { href: "#/ask/liuyao" }, "六爻问事"),
      h("a", { href: "#/books" }, "典籍书库"), h("a", { href: "#/square" }, "广场交流")));
  return { node, title: "路线图" };
}
