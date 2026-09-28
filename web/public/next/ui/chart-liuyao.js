// 六爻卦盘面板。起卦接口的 yaos 自下而上（yaos[0] 为初爻），展示时自上而下。
// 点一行（或行里的「几爻」按钮）看这一爻的排盘事实与古典释读（ui/popover.js）。
import { h } from "../lib/dom.js?v=n4";
import { icon } from "../lib/icons.js?v=n4";
import { guaGlyph, elementClass } from "./gua.js?v=n4";
import { LY_POS } from "../lib/copy.js?v=n4";
import { openGlossary } from "./glossary.js?v=n4";
import { yaoPop } from "./popover.js?v=n4";

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

/* ---------- 六爻排盘：帖子页与解读页共用 ----------
   卦名与起卦信息在上；下面每行一爻、自上而下，本卦爻画、世应空、变卦爻画和变出的六亲纳甲都在同一行，
   不再把卦画、要点卡片和排布表拆成三块。帖子的 oracle 与解读页的排盘 payload 字段不同，先各自转成同一个模型。 */

const METHOD_LABEL = { client_coins: "本机摇钱", manual: "手动录入" };
const str = value => (value === null || value === undefined ? "" : String(value));

function palaceText(ben) {
  if (!ben?.palace) return "";
  return [`${ben.palace}宫`, ben.palace_label, ben.palace_wuxing].map(str).filter(Boolean).join(" · ");
}

// 解读页：起卦接口的排盘 payload（yaos 自下而上）。
export function paipanFromPayload(payload, { method = "" } = {}) {
  const yaos = Array.isArray(payload?.yaos) ? payload.yaos : [];
  const moving = Array.isArray(payload?.dong_yao) ? payload.dong_yao : [];
  const changed = moving.length > 0;
  return {
    benName: str(payload?.ben_gua?.name) || "本卦",
    bianName: changed ? str(payload?.bian_gua?.name) : "",
    changed,
    meta: [palaceText(payload?.ben_gua), changed ? `${moving.map(posLabel).join("、")}动` : "", METHOD_LABEL[payload?.method || method] || ""].filter(Boolean),
    facts: [["月建", payload?.month_jian], ["日辰", payload?.day_chen], ["旬空", payload?.xun_kong]],
    lines: yaos.slice().reverse().map(yao => {
      const yin = yao.yin_yang === "阴";
      const bian = yao.moving && yao.bian ? yao.bian : null;
      const bianYin = bian?.yin_yang === "阴" || bian?.yin_yang === "阳" ? bian.yin_yang === "阴" : null;
      return {
        pos: posLabel(yao.pos),
        god: str(yao.liu_shen),
        qin: str(yao.liu_qin),
        ganzhi: `${str(yao.najia)}${str(yao.wuxing)}`,
        element: str(yao.wuxing),
        yin,
        moving: !!yao.moving,
        mark: yao.moving ? (yao.old_young === "老阳" ? "○" : "×") : "",
        // 变爻阴阳以排盘结果为准；老数据没有这个字段时才按「动则阴阳互变」补上。
        changedYin: bianYin ?? (yao.moving ? !yin : yin),
        changedText: bian ? `${str(bian.liu_qin)} ${str(bian.najia)}${str(bian.wuxing)}`.trim() : "",
        changedElement: bian ? str(bian.wuxing) : "",
        shi: !!yao.shi,
        ying: !!yao.ying,
        kong: !!yao.kong,
        fu: yao.fu_shen ? `${str(yao.fu_shen.liu_qin)}${str(yao.fu_shen.najia)}${str(yao.fu_shen.wuxing)}` : "",
        raw: yao,
      };
    }),
  };
}

// 帖子页：社区接口的 oracle（lines 以上爻在前）。
export function paipanFromOracle(oracle) {
  const lines = Array.isArray(oracle?.lines) ? oracle.lines : [];
  const changed = !!oracle?.has_changed;
  return {
    benName: str(oracle?.ben_name) || "本卦",
    bianName: changed ? str(oracle?.bian_name) : "",
    changed,
    meta: [str(oracle?.palace_label), changed ? str(oracle?.moving_label) : "", str(oracle?.method_label)].filter(Boolean),
    facts: [["月建", oracle?.month_jian], ["日辰", oracle?.day_chen], ["旬空", oracle?.xun_kong]],
    lines: lines.map(line => {
      const changedText = changed && line.moving ? str(line.changed_label) : "";
      const roles = str(line.roles);
      return {
        pos: `${str(line.position_label)}爻`,
        god: str(line.liu_shen),
        qin: str(line.liu_qin),
        ganzhi: `${str(line.najia)}${str(line.wuxing)}`,
        element: str(line.wuxing),
        yin: !!line.yin,
        moving: !!line.moving,
        mark: line.moving ? str(line.moving_mark) || "动" : "",
        changedYin: typeof line.changed_yin === "boolean" ? line.changed_yin : (line.moving ? !line.yin : !!line.yin),
        changedText,
        // changed_label 形如「父母 戊午火」，最后一个字是五行。
        changedElement: changedText ? changedText.slice(-1) : "",
        shi: roles.includes("世"),
        ying: roles.includes("应"),
        kong: !!line.kong,
        fu: "",
        raw: null,
      };
    }),
  };
}

function bar(yin, { moving = false, faded = false } = {}) {
  return h("span", { class: ["pp-bar", yin ? "is-yin" : "is-yang", moving && "is-moving", faded && "is-faded"], "aria-hidden": "true" }, h("i"), h("i"));
}

function paipanRow(line, { changed, onOpen }) {
  const lineName = `${line.yin ? "阴爻" : "阳爻"}${line.moving ? "，发动" : ""}`;
  // 卦盘很窄时只留「上」「五」……，「爻」字交给样式隐藏。
  const posText = [line.pos.replace(/爻$/, ""), h("span", { class: "pp-pos-suffix" }, "爻")];
  const pos = onOpen
    ? h("button", { type: "button", class: "pp-pos-btn", "aria-label": `${line.pos} ${line.qin}${line.ganzhi}，查看释读` }, h("span", null, posText), icon("info", "icon-sm"))
    : posText;
  const cells = [
    h("th", { scope: "row", class: "pp-pos" }, pos),
    h("td", { class: "pp-god" }, line.god || "—"),
    h("td", { class: "pp-qin" },
      h("span", { class: "pp-qin-main" }, line.qin, " ", h("b", { class: elementClass(line.element) }, line.ganzhi)),
      line.fu ? h("span", { class: "pp-fu" }, `伏 ${line.fu}`) : null,
      // 卦盘窄时变出的六亲纳甲写在这一爻下面（「化」），变卦一栏只画爻；宽时两处只显示变卦一栏里的那一份。
      line.changedText ? h("span", { class: "pp-to-inline" }, "化 ", h("b", { class: elementClass(line.changedElement) }, line.changedText)) : null),
    h("td", { class: "pp-ben" },
      h("span", { class: "pp-line" },
        bar(line.yin, { moving: line.moving }),
        h("em", { class: "pp-mark", "aria-hidden": "true" }, line.mark),
        h("span", { class: "sr-only" }, lineName),
        h("span", { class: "pp-tags" },
          line.shi ? h("span", { class: "pp-tag is-shi" }, "世") : null,
          line.ying ? h("span", { class: "pp-tag is-ying" }, "应") : null,
          line.kong ? h("span", { class: "pp-tag is-kong" }, "空") : null))),
    changed
      ? h("td", { class: "pp-bian" },
        h("span", { class: "pp-line" },
          bar(line.changedYin, { faded: !line.moving }),
          line.changedText
            ? h("span", { class: ["pp-to", elementClass(line.changedElement)] }, h("span", { class: "sr-only" }, "变为"), line.changedText)
            : h("span", { class: "sr-only" }, "不变")))
      : null,
  ];
  return h("tr", {
    class: [line.moving && "is-moving", onOpen && "is-clickable"],
    onClick: onOpen
      ? event => {
        // 在行里拖选文字时不弹出。
        const selecting = !(event.target instanceof Element && event.target.closest("button")) && String(window.getSelection?.() || "").trim();
        if (!selecting) onOpen(line, event.currentTarget.querySelector(".pp-pos-btn"));
      }
      : null,
  }, cells);
}

// heading 传 null：外面已经写着卦名（如解读页标题），盘里只留宫位与动爻那一行。
export function liuyaoPaipan(model, { heading = "h3", question = "", onOpen = null, footer = null, className = "" } = {}) {
  // 有没有动爻只看服务端给的 dong_yao / has_changed；变卦名缺失时只在显示上写「变卦」。
  const changed = !!model.changed;
  const facts = model.facts.filter(([, value]) => str(value));
  return h("div", { class: ["pp", className] },
    heading || model.meta.length ? h("div", { class: "pp-head" },
      heading ? h(heading, { class: "pp-title serif" },
        h("span", null, model.benName),
        changed ? h("span", { class: "pp-zhi" }, "之") : null,
        changed ? h("span", null, model.bianName || "变卦") : h("span", { class: "pp-quiet" }, "六爻安静")) : null,
      model.meta.length ? h("p", { class: "pp-meta" }, model.meta.join(" · ")) : null) : null,
    question ? h("blockquote", { class: "cp-question" }, h("span", null, "所问"), question) : null,
    facts.length ? h("dl", { class: "pp-facts" }, facts.map(([label, value]) => h("div", null, h("dt", null, label), h("dd", null, str(value))))) : null,
    h("div", { class: "pp-scroll" },
      h("table", { class: ["pp-table", changed && "has-bian"] },
        h("caption", { class: "sr-only" }, `六爻排盘，自上爻至初爻${onOpen ? "；每行可看这一爻的释读" : ""}`),
        h("thead", null, h("tr", null,
          ["爻位", "六神", "六亲纳甲", "本卦", changed ? "变卦" : null].filter(Boolean).map(label => h("th", { scope: "col" }, label)))),
        h("tbody", null, model.lines.map(line => paipanRow(line, { changed, onOpen }))))),
    footer);
}

// beside：摆在解读页标题旁边（桌面右栏），卦名和所问页面上已经有了，盘里不再重复。
export function liuyaoPanel(payload, { method = "", beside = false } = {}) {
  const model = paipanFromPayload(payload, { method });
  return h("section", { class: "chart-panel is-liuyao", "aria-label": "六爻卦盘" },
    liuyaoPaipan(model, {
      heading: beside ? null : "h2",
      question: beside ? "" : payload?.question || "",
      onOpen: (line, trigger) => yaoPop(line.raw || {}, { returnFocus: trigger }),
      footer: [
        h("p", { class: "cp-note" }, "纳甲六亲依京房八宫 · 六神依日干起法 · 点一爻看释读"),
        h("button", { type: "button", class: "btn btn-sm btn-ghost cp-gloss", onClick: () => openGlossary("liuyao") }, icon("book"), "名词解释"),
      ],
    }));
}

// 解读页顶部的看盘条：卦名已经是页面标题，这里只放卦象与月建日辰。
export function liuyaoStrip(payload) {
  const lines = linesFromYaos(payload?.yaos);
  return h("div", { class: "chart-strip" },
    guaGlyph(lines, { label: `本卦 ${payload?.ben_gua?.name || ""}` }),
    h("span", { class: "strip-dm is-liuyao" }, `月建 ${payload?.month_jian || "—"} · 日辰 ${payload?.day_chen || "—"}`));
}
