// 六爻卦盘面板。起卦接口的 yaos 自下而上（yaos[0] 为初爻），展示时自上而下。
// 点一行（或行里的「几爻」按钮）看这一爻的排盘事实与古典释读（ui/popover.js）。
import { h } from "../lib/dom.js?v=n1";
import { icon } from "../lib/icons.js?v=n1";
import { guaGlyph, elementClass } from "./gua.js?v=n1";
import { LY_POS, CN_NUM } from "../lib/copy.js?v=n1";
import { openGlossary } from "./glossary.js?v=n1";
import { yaoPop } from "./popover.js?v=n1";

// 转成社区卦象同样的「上爻在前」线条结构，复用卦形绘制。
export function linesFromYaos(yaos) {
  return (Array.isArray(yaos) ? yaos : []).slice().reverse().map(yao => {
    const yin = yao.yin_yang === "阴";
    return { yin, moving: !!yao.moving, changed_yin: yao.moving ? !yin : yin };
  });
}

function posLabel(pos) {
  return `${LY_POS[(Number(pos) || 1) - 1] || ""}爻`;
}

export function liuyaoTitle(payload) {
  const ben = payload?.ben_gua?.name || "六爻";
  const moving = Array.isArray(payload?.dong_yao) && payload.dong_yao.length;
  const bian = moving ? payload?.bian_gua?.name : "";
  return bian ? `${ben} 之 ${bian}` : ben;
}

// 表格行保留表格语义；键盘与读屏用「位」一栏里的按钮，鼠标和触屏点整行任意处都可打开。
function yaoRow(yao) {
  const pos = posLabel(yao.pos);
  const trigger = h("button", {
    type: "button",
    class: "ly-pos-btn",
    "aria-label": `${pos} ${yao.liu_qin || ""}${yao.najia || ""}${yao.wuxing || ""}，查看释读`,
  }, pos, icon("info", "icon-sm"));
  return h("tr", {
    class: [yao.moving && "is-moving", "is-clickable"],
    onClick: event => {
      // 在行里拖选文字时不弹出。
      const selecting = !(event.target instanceof Element && event.target.closest("button")) && String(window.getSelection?.() || "").trim();
      if (!selecting) yaoPop(yao, { returnFocus: trigger });
    },
  },
  h("td", null, yao.liu_shen || ""),
  h("td", null, h("span", null, yao.liu_qin || ""), " ", h("b", { class: elementClass(yao.wuxing) }, `${yao.najia || ""}${yao.wuxing || ""}`)),
  h("td", null, h("span", { class: "ly-glyph" },
    h("span", { class: ["ly-bar", yao.yin_yang === "阴" ? "is-yin" : "is-yang"], "aria-label": yao.yin_yang === "阴" ? "阴爻" : "阳爻" }, h("i"), h("i")),
    yao.moving ? h("em", null, yao.old_young === "老阳" ? "○" : "×") : null)),
  h("td", null, h("span", { class: "ly-tags" },
    trigger,
    yao.shi ? h("span", { class: "ly-tag is-shi" }, "世") : null,
    yao.ying ? h("span", { class: "ly-tag is-ying" }, "应") : null,
    yao.kong ? h("span", { class: "ly-tag is-kong" }, "空") : null)),
  h("td", { class: "ly-extra" },
    yao.fu_shen ? h("span", null, `伏 ${yao.fu_shen.liu_qin || ""}${yao.fu_shen.najia || ""}`) : null,
    yao.bian ? h("span", null, `→ ${yao.bian.liu_qin || ""}${yao.bian.najia || ""}${yao.bian.wuxing || ""}`) : null));
}

export function liuyaoPanel(payload) {
  const yaos = Array.isArray(payload?.yaos) ? payload.yaos : [];
  const lines = linesFromYaos(yaos);
  const moving = Array.isArray(payload?.dong_yao) ? payload.dong_yao : [];
  const changed = moving.length > 0;
  const ben = payload?.ben_gua || {};
  const bian = payload?.bian_gua || {};
  const rows = yaos.slice().reverse();
  return h("section", { class: "chart-panel is-liuyao", "aria-label": "六爻卦盘" },
    h("header", { class: "cp-head" },
      h("div", { class: "cp-title" },
        h("p", { class: "kicker" }, changed ? "本卦 → 变卦" : "本卦"),
        h("h2", { class: "serif" }, liuyaoTitle(payload)),
        h("p", { class: "cp-meta" }, `${ben.palace ? `${ben.palace}宫${ben.palace_label || ""}` : ""}${ben.palace ? " · " : ""}动爻 ${moving.length ? moving.map(posLabel).join("、") : "无"}`))),
    payload?.question ? h("blockquote", { class: "cp-question" }, h("span", null, "所问"), payload.question) : null,
    h("div", { class: "cp-gua" },
      h("figure", null, h("figcaption", null, "本卦"), guaGlyph(lines, { size: "md", label: `本卦 ${ben.name || ""}` }), h("b", null, ben.name || "本卦")),
      changed ? h("span", { class: "cp-gua-arrow", "aria-hidden": "true" }, "→") : null,
      changed
        ? h("figure", null, h("figcaption", null, "变卦"), guaGlyph(lines, { changed: true, size: "md", label: `变卦 ${bian.name || ""}` }), h("b", null, bian.name || "变卦"))
        : h("figure", { class: "is-quiet" }, h("figcaption", null, "变卦"), h("span", { class: "cp-quiet" }, "静"), h("b", null, "六爻安静"))),
    h("dl", { class: "cp-facts" },
      [["月建", payload?.month_jian], ["日辰", payload?.day_chen], ["旬空", payload?.xun_kong]]
        .map(([label, value]) => h("div", null, h("dt", null, label), h("dd", null, value || "—"))),
      h("div", { class: "is-wide" }, h("dt", null, "世应"), h("dd", null, payload?.shi_yao ? `世在${posLabel(payload.shi_yao)} · 应在${posLabel(payload.ying_yao)}` : "—")),
      h("div", null, h("dt", null, "动爻"), h("dd", null, `${CN_NUM[moving.length] || moving.length}处`))),
    h("div", { class: "ly-scroll" },
      h("table", { class: "ly-table" },
        h("caption", { class: "sr-only" }, "六爻排布（自上而下，每行可看这一爻的释读）"),
        h("thead", null, h("tr", null, ["六神", "六亲 纳甲", "爻", "位", "伏 · 变"].map(label => h("th", { scope: "col" }, label)))),
        h("tbody", null, rows.map(yaoRow)))),
    h("p", { class: "cp-note" }, "纳甲六亲依京房八宫 · 六神依日干起法 · 点一爻看释读"),
    h("button", { type: "button", class: "btn btn-sm btn-ghost cp-gloss", onClick: () => openGlossary("liuyao") }, icon("book"), "名词解释"));
}

export function liuyaoStrip(payload) {
  const lines = linesFromYaos(payload?.yaos);
  return h("div", { class: "chart-strip" },
    guaGlyph(lines, { label: `本卦 ${payload?.ben_gua?.name || ""}` }),
    h("span", { class: "strip-names serif" }, liuyaoTitle(payload)),
    h("span", { class: "strip-dm" }, `月建 ${payload?.month_jian || "—"} · 日辰 ${payload?.day_chen || "—"}`));
}
