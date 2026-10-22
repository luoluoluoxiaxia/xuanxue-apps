// 讲解页 #/learn/:system：一页讲清这张盘（或随机练习盘）怎么看。
// 讲解正文、盘面、小结和自查题都由后端 /api/chart/guide 给出，这里只负责排版和答题。
// 宽屏左盘右文、盘面跟着滚动固定在左边；窄屏顶部固定一条看盘条，点开看完整盘面。
import { h, fill } from "../lib/dom.js?v=n32";
import { icon } from "../lib/icons.js?v=n32";
import { post } from "../lib/api.js?v=n32";
import { local } from "../lib/store.js?v=n32";
import { readingPath } from "../lib/books.js?v=n32";
import { loadLearnInput, sampleLearnInput } from "../lib/learn.js?v=n32";
import { humanizeError } from "../lib/interpret.js?v=n32";
import { stateView, spinnerLine } from "../ui/bits.js?v=n32";
import { openSheet } from "../ui/overlay.js?v=n32";
import { baziPanel, baziStrip } from "../ui/chart-bazi.js?v=n32";
import { liuyaoPanel, liuyaoStrip } from "../ui/chart-liuyao.js?v=n32";

const sampleKey = system => `xz-learn-sample:${system}`;
const guideCache = new Map();

export function render(ctx) {
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

  const cacheKey = JSON.stringify(input);
  node.append(spinnerLine("正在读这张盘…"));
  const cached = guideCache.get(cacheKey);
  (cached ? Promise.resolve(cached) : post("/api/chart/guide", input)).then(guide => {
    guideCache.set(cacheKey, guide);
    if (!ctx.isCurrent()) return;
    fill(node, ...guideView(guide));
  }).catch(failure => {
    if (!ctx.isCurrent()) return;
    fill(node, stateView({
      tone: "error",
      title: "没能读出这张盘",
      text: humanizeError(failure.message, "请稍后再试"),
      actions: [
        h("button", { type: "button", class: "btn btn-soft", onClick: () => ctx.navigate(href(practice ? "sample" : ""), { replace: true }) }, icon("refresh"), "重试"),
        practice ? null : h("a", { class: "btn btn-ghost", href: `#/ask/${system}` }, "重新排盘"),
      ].filter(Boolean),
    }));
  });

  function guideView(guide) {
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
    const side = h("aside", { class: "learn-side", "aria-label": gua ? "卦盘" : "命盘" }, panel(true));
    const strip = h("button", {
      type: "button", class: "learn-strip", "aria-label": "查看完整盘面",
      onClick: event => openSheet({ title: gua ? "卦盘" : "命盘", body: panel(false), wide: true, className: "sheet-chart", returnFocus: event.currentTarget }),
    }, gua ? liuyaoStrip(guide.chart) : baziStrip(guide.chart), h("span", { class: "learn-strip-go" }, "看盘", icon("chevronDown", "icon-sm")));
    const body = h("article", { class: "learn-article" }, guide.sections.map((section, index) =>
      h("section", { class: "learn-step" },
        h("h2", null, h("span", { class: "learn-step-num tnum", "aria-hidden": "true" }, String(index + 1)), section.title),
        section.paragraphs.map(text => h("p", null, text)),
        section.takeaway ? h("p", { class: "learn-takeaway" }, section.takeaway) : null)));
    const recap = h("section", { class: "learn-recap" },
      h("h2", null, "读完，你可以这样说出这张盘"),
      h("ul", null, guide.recap.map(line => h("li", null, line))));
    const tail = [];
    if (guide.quiz.length) tail.push(h("section", { class: "learn-section" }, h("h3", null, "自己检查一下"), quizView(guide.quiz)));
    if (guide.reading.length) {
      tail.push(h("section", { class: "learn-section" }, h("h3", null, "想再深入，可以读这几篇"),
        h("ul", { class: "learn-reading" }, guide.reading.map(ref =>
          h("li", null, h("a", { href: `#${readingPath(ref.book_id, ref.section)}` }, icon("book", "icon-sm"),
            h("span", null, `${ref.book_title} · ${ref.section_title}`)))))));
    }
    const next = h("nav", { class: "learn-pager", "aria-label": "下一步" },
      h("span"),
      h("a", { class: "btn btn-primary", href: `#/ask/${system}` }, "带着问题去问", icon("arrowRight", "icon-sm")));
    return [head, h("div", { class: "learn-layout" }, side, h("div", { class: "learn-main" }, strip, body, recap, ...tail, next))];
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
