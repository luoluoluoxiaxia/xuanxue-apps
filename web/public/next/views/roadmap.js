import { h } from "../lib/dom.js?v=n20";
import { icon } from "../lib/icons.js?v=n20";
import { openFeedback } from "./feedback.js?v=n20";
import { openSheet } from "../ui/overlay.js?v=n20";

// 公开交付清单：状态与数量从 milestones 计算，不代表整个方向的完成比例。
const DIRECTIONS = [
  {
    number: "01", title: "八字", area: "tools", glyph: "pillars",
    purpose: "从排出命盘，到知道怎样读盘。",
    current: "免费排盘、私人档案和连续追问已经可用。",
    acceptance: "能从命盘找到术语解释，并沿着阅读路径逐步理解判断依据。",
    link: "#/ask/bazi", linkLabel: "打开八字排盘",
    milestones: [
      { title: "出生信息与手动四柱排盘", status: "done", detail: "已有按出生信息排盘和手动输入四柱的入口。" },
      { title: "四柱、五行与十神展示", status: "done", detail: "已有盘面、五行分布与十神展示。" },
      { title: "大运、流年与流月查看", status: "done", detail: "可查看大运、流年和流月。" },
      { title: "私人档案与命盘释义", status: "done", detail: "已有个人档案和静态命盘释读。" },
      { title: "释义直达典籍原文", status: "planned", detail: "将释义连接到可核对的典籍原文。" },
      { title: "初学者命盘阅读指引", status: "planned", detail: "在已有基础与进阶切换之上，整理初学者的阅读顺序。" },
    ],
  },
  {
    number: "02", title: "六爻", area: "tools", glyph: "gua",
    purpose: "从起卦问事，到回看判断与结果。",
    current: "三钱六掷、手动录卦、社区求助与 AI 解读已经可用。",
    acceptance: "能看懂判断的来由，并在事情有结果后回看与补充反馈。",
    link: "#/ask/liuyao", linkLabel: "打开六爻问事",
    milestones: [
      { title: "摇钱与手动录卦", status: "done", detail: "已有三钱六掷和手动录卦。" },
      { title: "本卦、变卦与完整卦盘", status: "done", detail: "已有本卦、变卦和完整卦盘展示。" },
      { title: "单爻释读与名词解释", status: "done", detail: "已有单爻释读与术语表。" },
      { title: "社区求助与 AI 解读", status: "done", detail: "可发起公开求助或使用 AI 解读。" },
      { title: "卦主补充现实进展", status: "planned", detail: "补充现实进展的网站填写入口尚未建设；需能保存、回看并在失败时保留文字。" },
      { title: "爻位释义直达原文", status: "planned", detail: "将爻位释义连接到所依据的原文。" },
    ],
  },
  {
    number: "03", title: "论坛", area: "tools", glyph: "users",
    purpose: "让问题有人讨论，让经验留下来。",
    current: "广场已有话题筛选、评论回复和采纳反馈。",
    acceptance: "能按专题找到讨论，并保留问题、回复与后续反馈的完整上下文。",
    link: "#/square", linkLabel: "去广场交流",
    milestones: [
      { title: "广场话题与体系筛选", status: "done", detail: "已有广场话题和八字、六爻体系筛选。" },
      { title: "两体系公开求助", status: "done", detail: "八字与六爻都可公开求助。" },
      { title: "评论、回复与回答采纳", status: "done", detail: "已有评论、回复和回答采纳。" },
      { title: "关注进展与互动提醒", status: "done", detail: "可关注求助进展并接收互动提醒。" },
      { title: "读书与术数专题版块", status: "planned", detail: "整理读书与术数讨论的专题版块。" },
      { title: "独立讨论帖", status: "planned", detail: "不绑定命盘，也可发起读书或方法讨论。" },
    ],
  },
  {
    number: "04", title: "AI 化", area: "tools", glyph: "sparkle",
    purpose: "帮助理解、追问与查证。",
    current: "AI 解读、多轮追问和回答反馈已经可用。",
    acceptance: "能继续追问、核对引用出处，并看清回答中仍待确认的内容。",
    link: "#/ask/bazi", linkLabel: "试试 AI 追问",
    milestones: [
      { title: "八字、六爻 AI 解读", status: "done", detail: "两体系已有 AI 解读入口。" },
      { title: "多轮追问与历史续问", status: "done", detail: "可连续追问，并回到历史解读继续提问。" },
      { title: "流式回答、停止与恢复", status: "done", detail: "已有流式回答、停止和恢复。" },
      { title: "回答反馈与社区 AI 解读", status: "done", detail: "已有回答反馈和社区中的 AI 解读。" },
      { title: "回答引用关联原文", status: "planned", detail: "将回答引用关联到典籍原文；现有静态释读不等于这项能力已经完成。" },
      { title: "针对书中选段提问", status: "planned", detail: "支持从书中选段发起带有阅读上下文的提问。" },
    ],
  },
  {
    number: "05", title: "整理古书", area: "knowledge", glyph: "book",
    purpose: "让原文可读，来源可查，疑缺可补。",
    current: "书库已登记 17 本，16 本可阅读；原文初录稿仍待逐书校勘。",
    acceptance: "能按目录阅读、回查来源，并识别尚未解决的疑字与缺文。",
    link: "#/books", linkLabel: "打开典籍书库",
    milestones: [
      { title: "17 本版本与来源登记", status: "done", detail: "已登记 17 本书的版本和来源。" },
      { title: "16 / 17 本开放阅读", status: "done", detail: "当前开放 5,691 个阅读节、299 张书影：14 本原文初录稿、1 本子平整理本、1 本有疑缺的断易工作稿；尚不能称为全文校勘完成。" },
      { title: "原文、原注、校记与书影分层", status: "done", detail: "原文、原注、校记、疑缺与书影分层保留。" },
      { title: "恢复滴天髓辑要成品", status: "planned", detail: "这本书已登记，电子成品尚未恢复，当前不能阅读。" },
      { title: "补齐断易天机疑缺", status: "planned", detail: "继续补齐断易天机工作稿中的疑缺内容。" },
      { title: "逐书校勘 14 本初录稿", status: "planned", detail: "逐书核对初录稿，保留修订依据与未决疑字。" },
    ],
  },
  {
    number: "06", title: "白话古书", area: "knowledge", glyph: "feather",
    purpose: "读得顺，也能对照原文。",
    current: "《子平真诠》45 篇正文与 4 篇序跋已有 193 段白话，对应 49 / 54 个阅读节。另 5 节为封面、原书目录、尾题、广告与版权页。其他书尚待补齐或恢复。",
    acceptance: "能连续读白话、随时对照原文，并分清原注、校记与现代解释。",
    link: "#/books/ziping-zhenquan?page=1", linkLabel: "读子平真诠",
    milestones: [
      { title: "子平真诠 49 / 54 节白话", status: "done", detail: "45 篇正文、4 篇序跋共有 193 段白话；另 5 节为封面、原书目录、尾题、广告与版权页，并非 5 章正文漏译。当前 1 / 17 本开放白话阅读。" },
      { title: "原文 / 白话 / 对照阅读", status: "done", detail: "可切换阅读方式并连续读文。" },
      { title: "恢复滴天髓辑要历史白话", status: "planned", detail: "恢复历史 43 篇、271 段白话成品；目前尚未开放阅读。" },
      { title: "其余 15 本逐本白话", status: "planned", detail: "在子平真诠和待恢复的滴天髓辑要之外，逐本整理其余 15 本白话。" },
      { title: "随原文修订逐段复核", status: "planned", detail: "原文变动后，逐段重新核对对应白话。" },
    ],
  },
  {
    number: "07", title: "收集网上流传案例", area: "knowledge", glyph: "globe",
    purpose: "把分散案例留下来，也把出处留下来。",
    current: "来源可追溯的网上案例库尚在规划。",
    acceptance: "每则案例能回查来源，并看清已有结果、缺失信息与核验状态。",
    milestones: [
      { title: "来源与时间记录", status: "planned", detail: "保留原始链接、作者与发布或记录时间。" },
      { title: "问题、判断与结果分别记录", status: "planned", detail: "保留问题、当时的判断与后续结果，区分事实与推断。" },
      { title: "核验与去重", status: "planned", detail: "核对重复转载与内容出处。" },
      { title: "缺失信息标注", status: "planned", detail: "标明缺少来源、结果或上下文的内容。" },
      { title: "公开可回查入口", status: "planned", detail: "建设公开入口，让材料可阅读并回查来源；当前没有可公布的可信收集总数。" },
    ],
  },
  {
    number: "08", title: "整理归纳总结案例", area: "knowledge", glyph: "layers",
    purpose: "从看一个故事，到比较一类问题。",
    current: "已有 18 条古籍案例研究底稿（16 条有核心来源复核、2 条仍为草稿），公开案例库尚未建设。研究底稿不计入已交付项。",
    note: "18 条古籍案例研究底稿，案例库尚未公开。",
    acceptance: "能比较同类案例，回看原始材料，并区分已有事实与归纳判断。",
    milestones: [
      { title: "来源、问题、判断与结果分层", status: "planned", detail: "把来源、问题、判断与结果分层保留。" },
      { title: "按问题与方法分类检索", status: "planned", detail: "建设按问题和方法查找案例的公开入口。" },
      { title: "同类对照、反例与适用条件", status: "planned", detail: "比较异同，保留反例并说明适用条件。" },
      { title: "案例与原始材料双向回查", status: "planned", detail: "从案例回到原始材料，从原始材料找到相应归纳。" },
    ],
  },
  {
    number: "09", title: "串成线，方便使用", area: "journey", glyph: "compass",
    purpose: "从一个问题出发，走完理解与实践的路径。",
    current: "书库、问事与广场已有统一导航；原文、白话、校记和来源可对照，阅读标记可随账号保存并定位正文。案例、典籍、工具与讨论的互链尚待建设；阅读位置仍只保存在当前浏览器。",
    acceptance: "能从知识找到案例与工具，接着交流反馈，并随时返回原始出处。",
    milestones: [
      { title: "书库、问事与广场统一导航", status: "done", detail: "已有统一导航入口。" },
      { title: "原文、白话、校记与来源对照", status: "done", detail: "可在阅读中对照原文、白话、校记与来源。" },
      { title: "划线、书签与笔记随账号保存", status: "done", detail: "标记随账号保存并可定位正文；阅读位置仅保存在当前浏览器。" },
      { title: "原文选段带出处进入问事与讨论", status: "planned", detail: "从原文选段进入问事或讨论时携带出处与上下文。" },
      { title: "案例、典籍、工具与讨论互链", status: "planned", detail: "建立案例、典籍、工具和讨论的双向连接。" },
      { title: "结果反馈回流原案例", status: "planned", detail: "把后续结果与讨论反馈带回原案例。" },
    ],
  },
];

const STAGES = [
  { number: "01", title: "夯实基础", directions: ["01", "02", "03", "05", "06"] },
  { number: "02", title: "沉淀案例", directions: ["07", "08"] },
  { number: "03", title: "串联使用", directions: ["04", "09"] },
];
const BOOK_PROGRESS = { registered: 17, readable: 16, modern: 1 };
const MILESTONE_STATUS = { done: "已交付", planned: "规划中", blocked: "待补齐" };
const directionByNumber = number => DIRECTIONS.find(direction => direction.number === number);
const countMilestones = directions => {
  const milestones = directions.flatMap(direction => direction.milestones);
  return { done: milestones.filter(milestone => milestone.status === "done").length, total: milestones.length };
};

export function render() {
  let activeDetail = null;
  function showDirection(direction, trigger) {
    if (activeDetail) return;
    const progress = countMilestones([direction]);
    const next = direction.milestones.find(milestone => milestone.status !== "done");
    const body = h("div", { class: "roadmap-detail" },
      h("span", { class: `roadmap-detail-status${progress.done ? " is-established" : ""}` }, progress.done ? "已有交付" : "待建设"),
      h("p", { class: "roadmap-detail-purpose", tabindex: "-1", autofocus: true }, direction.purpose),
      h("section", null, h("h3", null, "当前状态"), h("p", null, direction.current)),
      next ? h("section", { class: "roadmap-detail-next" }, h("h3", null, "下一项"), h("p", null, h("b", null, next.title)), h("p", null, next.detail)) : null,
      h("section", null, h("h3", null, "交付项与状态"), h("ul", { class: "roadmap-detail-milestones" }, direction.milestones.map(milestone => h("li", null,
        h("div", null, h("b", null, milestone.title), h("span", null, MILESTONE_STATUS[milestone.status])), h("p", null, milestone.detail))))),
      h("section", null, h("h3", null, "怎样算做好"), h("p", null, direction.acceptance)));
    const footer = direction.link
      ? h("a", { class: "btn btn-primary", href: direction.link }, direction.linkLabel, icon("arrowRight", "icon-sm"))
      : h("button", { type: "button", class: "btn btn-primary", onClick: () => openFeedback() }, "对此提个建议");
    trigger.setAttribute("aria-expanded", "true");
    activeDetail = openSheet({ title: direction.title, body, footer, className: "sheet-roadmap-detail", returnFocus: trigger,
      onClose: () => { trigger.setAttribute("aria-expanded", "false"); activeDetail = null; } });
  }
  function directionRow(number) {
    const direction = directionByNumber(number);
    const progress = countMilestones([direction]);
    const delivered = direction.milestones.filter(milestone => milestone.status === "done");
    const remaining = direction.milestones.filter(milestone => milestone.status !== "done");
    const milestoneNode = (milestone, next = false) => h("li", { class: "roadmap-milestone", dataset: { milestoneStatus: milestone.status } },
      icon(milestone.status === "done" ? "check" : "clock", "icon-sm"),
      h("span", null, next ? h("small", { class: "roadmap-next-label" }, "下一项") : null, milestone.title));
    const title = h("button", { type: "button", class: "roadmap-direction", "aria-haspopup": "dialog", "aria-expanded": "false",
      "aria-label": `${direction.title}，查看路线图详情`, dataset: { roadmapNumber: direction.number },
      onClick: event => showDirection(direction, event.currentTarget) },
      h("span", { class: "roadmap-direction-icon" }, icon(direction.glyph)),
      h("span", { class: "roadmap-direction-title" }, direction.title), icon("arrowRight", "roadmap-direction-arrow"));
    return h("li", { class: "roadmap-project", dataset: { roadmapProject: direction.number } },
      h("div", { class: "roadmap-project-heading" }, h("h3", null, title),
        h("div", { class: "roadmap-project-progress" }, h("span", { class: "roadmap-project-count tnum" }, `${progress.done} / ${progress.total} 交付项`),
          h("span", { class: "roadmap-project-state" }, progress.done ? "已有交付" : "待建设")),
        h("div", { class: "roadmap-checklist-meter", role: "img", "aria-label": `本清单 ${progress.total} 个交付项，${progress.done} 个已交付` },
          direction.milestones.map(milestone => h("span", { class: milestone.status === "done" ? "is-done" : "", "aria-hidden": "true" }))),
        direction.note ? h("p", { class: "roadmap-project-note" }, direction.note) : null),
      h("div", { class: "roadmap-project-delivered" }, h("h4", { class: "roadmap-row-label" }, "已交付"),
        delivered.length ? h("ul", { class: "roadmap-milestone-list is-delivered" }, delivered.map(milestone => milestoneNode(milestone)))
          : h("p", { class: "roadmap-no-deliveries" }, "尚无公开交付项")),
      h("div", { class: "roadmap-project-remaining" }, h("h4", { class: "roadmap-row-label" }, "待做 · 规划中"),
        h("ul", { class: "roadmap-milestone-list" }, remaining.map((milestone, index) => milestoneNode(milestone, index === 0)))));
  }
  const allProgress = countMilestones(DIRECTIONS);
  const startedDirections = DIRECTIONS.filter(direction => direction.milestones.some(milestone => milestone.status === "done")).length;
  const summary = h("dl", { class: "roadmap-summary", "aria-label": "建设进度概览" },
    h("div", null, h("dt", null, "开放阅读"), h("dd", null, h("b", { class: "tnum" }, BOOK_PROGRESS.readable), h("span", null, ` / ${BOOK_PROGRESS.registered} 本`)), h("small", null, "已登记书籍 · 初录稿仍待校勘")),
    h("div", null, h("dt", null, "已有白话"), h("dd", null, h("b", { class: "tnum" }, BOOK_PROGRESS.modern), h("span", null, ` / ${BOOK_PROGRESS.registered} 本`)), h("small", null, "子平真诠 49 / 54 个阅读节")),
    h("div", null, h("dt", null, "已有交付的方向"), h("dd", null, h("b", { class: "tnum" }, startedDirections), h("span", null, ` / ${DIRECTIONS.length} 个`)), h("small", null, "按下方公开交付项清单计算")));
  const node = h("div", { class: "roadmap-page" },
    h("header", { class: "roadmap-header" },
      h("img", { class: "roadmap-landscape", src: new URL("../assets/roadmap-landscape.webp?v=n20", import.meta.url).href, alt: "", "aria-hidden": "true", decoding: "async" }),
      h("div", { class: "roadmap-hero-copy" }, h("h1", null, "路线图"),
        h("p", { class: "roadmap-vision" }, "把经典、案例与实践，连成一条路。"),
        h("p", { class: "roadmap-updated" }, h("span", { class: "roadmap-update-dot", "aria-hidden": "true" }), "进度核对 · ", h("time", { datetime: "2026-10-07" }, "2026.10.07")))),
    summary,
    h("p", { class: "roadmap-counting-note" }, `本清单 ${allProgress.total} 个交付项，${allProgress.done} 个已交付。计数仅对应下方清单，不代表工时或整个方向的完成比例；待做项均为规划。`),
    h("ol", { class: "roadmap-timeline", "aria-label": "按依赖逐步推进的三个阶段" }, STAGES.map(stage => {
      const directions = stage.directions.map(directionByNumber);
      const progress = countMilestones(directions);
      return h("li", { class: `roadmap-stage${progress.done ? " is-established" : ""}`, dataset: { roadmapStage: stage.number } },
        h("header", { class: "roadmap-stage-intro" }, h("span", { class: "roadmap-stage-number tnum", "aria-hidden": "true" }, stage.number),
          h("h2", null, stage.title), h("span", { class: "roadmap-stage-status" }, `${progress.done} / ${progress.total} 交付项`)),
        h("div", { class: "roadmap-stage-directions" },
          h("div", { class: "roadmap-project-columns", "aria-hidden": "true" }, h("span", null, "项目 · 本清单进度"), h("span", null, "已交付"), h("span", null, "待做 · 规划中")),
          h("ul", { class: "roadmap-direction-list" }, stage.directions.map(directionRow))));
    })),
    h("footer", { class: "roadmap-footer" },
      h("div", null, h("h2", null, "这也是一条需要你参与的路。"), h("p", null, "读书哪里卡住、工具哪里不顺、希望先补什么，都可以告诉我们。")),
      h("button", { type: "button", class: "btn btn-primary", onClick: () => openFeedback() }, icon("message", "icon-sm"), "提个建议")),
    h("nav", { class: "roadmap-start-links", "aria-label": "使用已有功能" },
      h("a", { href: "#/ask/bazi" }, "八字排盘"), h("a", { href: "#/ask/liuyao" }, "六爻问事"),
      h("a", { href: "#/books" }, "典籍书库"), h("a", { href: "#/square" }, "广场交流")));
  return { node, title: "路线图" };
}
