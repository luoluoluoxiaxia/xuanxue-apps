// 讲解页 #/learn/:system：一页讲清这张盘（或随机练习盘）怎么看。
// 讲解正文、盘面、小结和自查题都由后端 /api/chart/guide 给出，这里只负责排版和答题。
// 宽屏左盘右文、盘面跟着滚动固定在左边；窄屏顶部固定一条看盘条，点开看完整盘面。
import { h, fill } from "../lib/dom.js?v=n44";
import { icon } from "../lib/icons.js?v=n44";
import { post } from "../lib/api.js?v=n44";
import { local } from "../lib/store.js?v=n44";
import { readingPath } from "../lib/books.js?v=n44";
import { loadLearnInput, sampleLearnInput, baziLearnInput } from "../lib/learn.js?v=n44";
import { baziChartRefreshAt } from "../lib/chart-refresh.js?v=n44";
import { humanizeError } from "../lib/interpret.js?v=n44";
import { stateView, spinnerLine } from "../ui/bits.js?v=n44";
import { openSheet } from "../ui/overlay.js?v=n44";
import { baziPanel, baziStrip } from "../ui/chart-bazi.js?v=n44";
import { liuyaoPanel, liuyaoStrip } from "../ui/chart-liuyao.js?v=n44";

const sampleKey = system => `xz-learn-sample:${system}`;
const guideCache = new Map();

export function render(ctx, request = input => post("/api/chart/guide", input)) {
  const system = ctx.params.system === "liuyao" ? "liuyao" : "bazi";
  const gua = system === "liuyao";
  const practice = ctx.query.get("src") === "sample";
  const own = loadLearnInput(system);
  let input = practice ? local.json(sampleKey(system)) : own;
  if (practice && !input) {
    input = sampleLearnInput(system);
    local.setJson(sampleKey(system), input);
  }
  const node = h("div", { class: "learn-page" });
  const title = gua ? "这一卦怎么看" : "这张盘怎么看";
  const href = src => `#/learn/${system}${src ? `?src=${src}` : ""}`;

  function newSample() {
    local.setJson(sampleKey(system), sampleLearnInput(system));
    // 同一地址时 navigate 会原地重渲染，正好换成新盘。
    ctx.navigate(href("sample"), { replace: practice });
  }

  if (!input) {
    node.append(
      h("header", { class: "learn-head" }, h("h1", null, `看懂你的${gua ? "卦" : "命盘"}`)),
      stateView({
        glyph: gua ? "gua" : "pillars",
        title: gua ? "先起一卦" : "先排一张命盘",
        text: gua
          ? "起完卦后点「这一卦怎么看」，就能一页读懂你自己的卦。也可以先拿一个随机卦看看。"
          : "排完盘后点「这张盘怎么看」，就能一页读懂你自己的命盘。也可以先拿一张随机盘看看。",
        actions: [
          h("a", { class: "btn btn-primary", href: `#/ask/${system}` }, icon(gua ? "gua" : "pillars"), gua ? "去起卦" : "去排盘"),
          h("button", { type: "button", class: "btn btn-soft", onClick: newSample }, icon("dice"), `用随机${gua ? "卦" : "盘"}看看`),
        ],
      }));
    return { node, title };
  }

  if (!gua) input = baziLearnInput(input);
  let cacheKey = JSON.stringify(input);
  let guide = null;
  let sidePanel = null;
  let chartStrip = null;
  let sheetPanel = null;
  let guideBody = null;
  let recapNode = null;
  let timer = 0;
  let retryAt = 0;
  let loading = false;
  node.append(spinnerLine("正在读这张盘…"));
  const cached = guideCache.get(cacheKey);
  load(cached && (gua || baziChartRefreshAt(cached.chart) > Date.now()) ? cached : null);

  function schedule() {
    clearTimeout(timer);
    if (gua || !guide || !ctx.isCurrent()) return;
    timer = setTimeout(checkTime, Math.max(1000, Math.max(retryAt, baziChartRefreshAt(guide.chart)) - Date.now()));
  }

  function checkTime() {
    if (!ctx.isCurrent() || gua || !guide || loading || document.hidden || navigator.onLine === false) return;
    if (Date.now() >= Math.max(retryAt, baziChartRefreshAt(guide.chart))) load();
  }

  async function load(saved = null) {
    if (loading) return;
    loading = true;
    clearTimeout(timer);
    try {
      const next = saved || await request(input);
      if (!ctx.isCurrent()) return;
      if (!gua) {
        input = baziLearnInput(input, next.chart);
        cacheKey = JSON.stringify(input);
      }
      guideCache.set(cacheKey, next);
      if (!guide) {
        guide = next;
        fill(node, ...guideView());
      } else {
        // 更新行运事实及讲解正文；已经答过的自查题保持原节点。
        const y = window.scrollY;
        guide = { ...guide, chart: next.chart, sections: next.sections, recap: next.recap };
        sidePanel.updatePayload(guide.chart);
        if (sheetPanel?.isConnected) sheetPanel.updatePayload(guide.chart);
        chartStrip.querySelector(".chart-strip")?.replaceWith(baziStrip(guide.chart));
        fill(guideBody, ...guideSections());
        fill(recapNode, ...recapContent());
        if (Number.isFinite(y)) window.scrollTo({ top: y, behavior: "auto" });
      }
      retryAt = !gua && baziChartRefreshAt(guide.chart) <= Date.now() ? Date.now() + 60 * 1000 : 0;
    } catch (failure) {
      if (!ctx.isCurrent()) return;
      retryAt = Date.now() + 60 * 1000;
      if (!guide) fill(node, stateView({
        tone: "error",
        title: "没能读出这张盘",
        text: humanizeError(failure.message, "请稍后再试"),
        actions: [
          h("button", { type: "button", class: "btn btn-soft", onClick: () => ctx.navigate(href(practice ? "sample" : ""), { replace: true }) }, icon("refresh"), "重试"),
          practice ? null : h("a", { class: "btn btn-ghost", href: `#/ask/${system}` }, "重新排盘"),
        ].filter(Boolean),
      }));
    } finally {
      loading = false;
      schedule();
    }
  }
  document.addEventListener("visibilitychange", checkTime);
  window.addEventListener("online", checkTime);
  ctx.cleanup(() => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", checkTime);
    window.removeEventListener("online", checkTime);
  });

  function guideView() {
    const head = h("header", { class: "learn-head" },
      h("p", { class: "learn-kicker" }, practice ? `随机${gua ? "卦" : "盘"} · 练习用` : `你的${gua ? "卦" : "命盘"}`),
      h("h1", null, guide.title),
      h("p", { class: "learn-subtitle tnum" }, guide.subtitle),
      h("div", { class: "learn-switch" },
        h("button", { type: "button", class: "btn btn-ghost btn-sm", onClick: newSample }, icon("dice", "icon-sm"), practice ? "再换一张" : "换一张随机盘看看"),
        practice && own ? h("a", { class: "btn btn-ghost btn-sm", href: href("") }, icon("back", "icon-sm"), "回到我的盘") : null));
    const panel = beside => (gua
      ? liuyaoPanel(guide.chart, { method: input.method, beside })
      : baziPanel(guide.chart, { input, beside }));
    sidePanel = panel(true);
    const side = h("aside", { class: "learn-side", "aria-label": gua ? "卦盘" : "命盘" }, sidePanel);
    chartStrip = h("button", {
      type: "button", class: "learn-strip", "aria-label": "查看完整盘面",
      onClick: event => {
        const opened = panel(false);
        if (!gua) sheetPanel = opened;
        openSheet({ title: gua ? "卦盘" : "命盘", body: opened, wide: true, className: "sheet-chart", returnFocus: event.currentTarget,
          onClose: () => { if (sheetPanel === opened) sheetPanel = null; } });
      },
    }, gua ? liuyaoStrip(guide.chart) : baziStrip(guide.chart), h("span", { class: "learn-strip-go" }, "看盘", icon("chevronDown", "icon-sm")));
    guideBody = h("article", { class: "learn-article" }, guideSections());
    recapNode = h("section", { class: "learn-recap" }, recapContent());
    const tail = [];
    if (guide.quiz.length) tail.push(h("section", { class: "learn-section" }, h("h3", null, "自己检查一下"), quizView(guide.quiz)));
    if (guide.reading.length) {
      tail.push(h("section", { class: "learn-section" }, h("h3", null, "想再深入，可以读这几篇"),
        h("ul", { class: "learn-reading" }, guide.reading.map(ref =>
          h("li", null, h("a", { href: `#${readingPath(ref.book_id, ref.section)}` }, icon("book", "icon-sm"),
            h("span", null, `${ref.book_title} · ${ref.section_title}`)))))));
    }
    const next = h("nav", { class: "learn-pager", "aria-label": "下一步" },
      h("a", { class: "btn btn-ghost", href: `#/book-cases?system=${system}` }, gua ? "看看古书里的卦例" : "看看古书里的命例"),
      h("a", { class: "btn btn-primary", href: `#/ask/${system}` }, "带着问题去问", icon("arrowRight", "icon-sm")));
    return [head, h("div", { class: "learn-layout" }, side, h("div", { class: "learn-main" }, chartStrip, guideBody, recapNode, ...tail, next))];
  }

  function guideSections() {
    return guide.sections.map((section, index) => h("section", { class: "learn-step" },
      h("h2", null, h("span", { class: "learn-step-num tnum", "aria-hidden": "true" }, String(index + 1)), section.title),
      section.paragraphs.map(text => h("p", null, text)),
      section.takeaway ? h("p", { class: "learn-takeaway" }, section.takeaway) : null));
  }

  function recapContent() {
    return [h("h2", null, "读完，你可以这样说出这张盘"), h("ul", null, guide.recap.map(line => h("li", null, line)))];
  }

  function quizView(quiz) {
    return h("ol", { class: "learn-quiz" }, quiz.map(item => {
      const feedback = h("p", { class: "learn-feedback", hidden: true });
      const options = item.options.map((option, oi) => h("button", { type: "button", class: "learn-option", onClick: () => choose(oi) }, option));
      function choose(oi) {
        options.forEach((button, bi) => {
          button.disabled = true;
          if (bi === item.answer) button.classList.add("is-right");
          else if (bi === oi) button.classList.add("is-wrong");
        });
        feedback.hidden = false;
        fill(feedback, h("b", null, oi === item.answer ? "对。" : `是「${item.options[item.answer]}」。`), item.explain);
      }
      return h("li", { class: "learn-question" }, h("p", { class: "learn-prompt" }, item.prompt),
        h("div", { class: "learn-options" }, options), feedback);
    }));
  }

  return { node, title };
}
