// 学习页 #/learn/:system：用自己的盘（或随机练习盘）学八字、六爻入门。
// 课程、盘面事实与题目答案都由后端 /api/chart/learn 给出，这里只负责展示、答题与本机进度。
import { h, fill } from "../lib/dom.js?v=n23";
import { icon } from "../lib/icons.js?v=n23";
import { post } from "../lib/api.js?v=n23";
import { local } from "../lib/store.js?v=n23";
import { readingPath } from "../lib/books.js?v=n23";
import { learnProgress, loadLearnInput, markLessonDone, sampleLearnInput } from "../lib/learn.js?v=n23";
import { humanizeError } from "../lib/interpret.js?v=n23";
import { stateView, spinnerLine } from "../ui/bits.js?v=n23";

const SYSTEM_LABEL = { bazi: "八字", liuyao: "六爻" };
const sampleKey = system => `xz-learn-sample:${system}`;
// 换课只改 ?n=，不必重新请求同一张盘的课程。
const courseCache = new Map();

export function render(ctx) {
  const system = ctx.params.system === "liuyao" ? "liuyao" : "bazi";
  const label = SYSTEM_LABEL[system];
  const practice = ctx.query.get("src") === "sample";
  const own = loadLearnInput(system);
  let input = practice ? local.json(sampleKey(system)) : own;
  if (practice && !input) {
    input = sampleLearnInput(system);
    local.setJson(sampleKey(system), input);
  }
  const node = h("div", { class: "learn-page page-narrow" });
  const title = `学${label}`;

  const hrefFor = (n, src = practice ? "sample" : "") => {
    const params = new URLSearchParams();
    if (src) params.set("src", src);
    if (n > 1) params.set("n", String(n));
    const search = params.toString();
    return `#/learn/${system}${search ? `?${search}` : ""}`;
  };

  function newSample() {
    local.setJson(sampleKey(system), sampleLearnInput(system));
    const n = Number(ctx.query.get("n")) || 1;
    // 同一地址时 navigate 会原地重渲染，正好换成新盘。
    ctx.navigate(hrefFor(n, "sample"), { replace: practice });
  }

  if (!input) {
    node.append(
      h("header", { class: "learn-head" }, h("h1", null, `用你的盘学${label}`)),
      stateView({
        glyph: system === "liuyao" ? "gua" : "pillars",
        title: system === "liuyao" ? "先起一卦" : "先排一张命盘",
        text: system === "liuyao"
          ? "起完卦后点「学一学这一卦」，就能拿你自己的卦一步步学六爻。也可以先用随机卦试试。"
          : "排完盘后点「学一学这张盘」，就能拿你自己的命盘一步步学八字。也可以先用随机盘试试。",
        actions: [
          h("a", { class: "btn btn-primary", href: `#/ask/${system}` }, icon(system === "liuyao" ? "gua" : "pillars"), system === "liuyao" ? "去起卦" : "去排盘"),
          h("button", { type: "button", class: "btn btn-soft", onClick: newSample }, icon("dice"), "用随机盘试试"),
        ],
      }));
    return { node, title };
  }

  const cacheKey = JSON.stringify(input);
  node.append(spinnerLine("正在生成课程…"));
  const load = () => {
    const cached = courseCache.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    return post("/api/chart/learn", input).then(course => {
      courseCache.set(cacheKey, course);
      return course;
    });
  };
  load().then(course => {
    if (!ctx.isCurrent()) return;
    fill(node, ...courseView(course));
  }).catch(failure => {
    if (!ctx.isCurrent()) return;
    courseCache.delete(cacheKey);
    node.replaceChildren(stateView({
      tone: "error",
      title: "课程没能生成",
      text: humanizeError(failure.message, "请稍后再试"),
      actions: [
        h("button", { type: "button", class: "btn btn-soft", onClick: () => ctx.navigate(hrefFor(Number(ctx.query.get("n")) || 1), { replace: true }) }, icon("refresh"), "重试"),
        practice ? null : h("a", { class: "btn btn-ghost", href: `#/ask/${system}` }, "重新排盘"),
      ].filter(Boolean),
    }));
  });

  function courseView(course) {
    const lessons = course.lessons || [];
    const index = Math.min(Math.max((Number(ctx.query.get("n")) || 1) - 1, 0), Math.max(lessons.length - 1, 0));
    const lesson = lessons[index];
    const done = learnProgress(system);
    const head = h("header", { class: "learn-head" },
      h("p", { class: "learn-kicker" }, practice ? "练习盘 · 随机生成" : (system === "liuyao" ? "你的卦" : "你的命盘")),
      h("h1", null, practice ? `用随机${system === "liuyao" ? "卦" : "盘"}学${label}` : course.title),
      h("p", { class: "learn-subtitle tnum" }, course.subtitle),
      h("div", { class: "learn-switch" },
        h("button", { type: "button", class: "btn btn-ghost btn-sm", onClick: newSample }, icon("dice", "icon-sm"), practice ? "再换一张" : "换一张随机盘练"),
        practice && own ? h("a", { class: "btn btn-ghost btn-sm", href: hrefFor(index + 1, "") }, icon("back", "icon-sm"), "回到我的盘") : null));
    const toc = h("ol", { class: "learn-toc", "aria-label": "课程目录" }, lessons.map((item, i) =>
      h("li", { class: [i === index && "is-current", done.has(item.id) && "is-done"] },
        h("a", { href: hrefFor(i + 1), "aria-current": i === index ? "page" : null },
          h("span", { class: "learn-toc-num tnum" }, String(i + 1)),
          h("span", null, item.title),
          done.has(item.id) ? icon("check", "icon-sm learn-toc-check") : null))));
    return [head, toc, lesson ? lessonView(lesson, index, lessons.length) : null];
  }

  function lessonView(lesson, index, total) {
    const parts = [
      h("p", { class: "learn-kicker tnum" }, `第 ${index + 1} 课 · 共 ${total} 课`),
      h("h2", { class: "learn-title", id: "learn-lesson-title" }, lesson.title),
      h("p", { class: "learn-summary" }, lesson.summary),
      section("是什么", lesson.concept.map(text => h("p", null, text))),
      section(practice ? "这张盘里" : (system === "liuyao" ? "你的卦里" : "你的盘里"),
        [h("dl", { class: "learn-rows" }, lesson.mine.map(item => h("div", { class: "learn-row" },
          h("dt", null, item.label),
          h("dd", null, h("b", null, item.value || "—"), item.detail ? h("small", null, item.detail) : null))))]),
    ];
    if (lesson.steps.length) parts.push(section("怎么推出来的", [h("ol", { class: "learn-steps" }, lesson.steps.map(step => h("li", null, step)))]));
    if (lesson.note) parts.push(h("p", { class: "learn-note" }, icon("info", "icon-sm"), lesson.note));
    if (lesson.quiz.length) parts.push(section("练一练", [quizView(lesson)]));
    if (lesson.reading.length) {
      parts.push(section("古书里怎么讲", [h("ul", { class: "learn-reading" }, lesson.reading.map(ref =>
        h("li", null, h("a", { href: `#${readingPath(ref.book_id, ref.section)}` }, icon("book", "icon-sm"),
          h("span", null, `${ref.book_title} · ${ref.section_title}`)))))]));
    }
    parts.push(h("nav", { class: "learn-pager", "aria-label": "翻课" },
      index > 0 ? h("a", { class: "btn btn-ghost", href: hrefFor(index) }, icon("back", "icon-sm"), "上一课") : h("span"),
      index + 1 < total ? h("a", { class: "btn btn-primary", href: hrefFor(index + 2) }, "下一课", icon("arrowRight", "icon-sm"))
        : h("a", { class: "btn btn-primary", href: `#/ask/${system}` }, system === "liuyao" ? "去问一件事" : "去问命盘", icon("arrowRight", "icon-sm"))));
    return h("article", { class: "learn-lesson", "aria-labelledby": "learn-lesson-title" }, parts);
  }

  function section(heading, children) {
    return h("section", { class: "learn-section" }, h("h3", null, heading), ...children);
  }

  function quizView(lesson) {
    const answered = new Map();
    const score = h("p", { class: "learn-score", role: "status" });
    const items = lesson.quiz.map((item, qi) => {
      const feedback = h("p", { class: "learn-feedback", hidden: true });
      const options = item.options.map((option, oi) => h("button", {
        type: "button", class: "learn-option",
        onClick: () => choose(oi),
      }, option));
      function choose(oi) {
        if (answered.has(qi)) return;
        const right = oi === item.answer;
        answered.set(qi, right);
        options.forEach((button, bi) => {
          button.disabled = true;
          if (bi === item.answer) button.classList.add("is-right");
          else if (bi === oi) button.classList.add("is-wrong");
        });
        feedback.hidden = false;
        feedback.replaceChildren(h("b", null, right ? "答对了。" : `正确答案是「${item.options[item.answer]}」。`), item.explain);
        if (answered.size === lesson.quiz.length) {
          const correct = [...answered.values()].filter(Boolean).length;
          score.textContent = `这一课 ${lesson.quiz.length} 题，答对 ${correct} 题。${correct === lesson.quiz.length ? "可以进下一课了。" : "可以回看上面的推导再想想，或换一张随机盘再练。"}`;
          markLessonDone(system, lesson.id);
          node.querySelector(`.learn-toc li.is-current`)?.classList.add("is-done");
        }
      }
      return h("li", { class: "learn-question" }, h("p", { class: "learn-prompt" }, item.prompt),
        h("div", { class: "learn-options" }, options), feedback);
    });
    return h("div", null, h("ol", { class: "learn-quiz" }, items), score);
  }

  return { node, title };
}
