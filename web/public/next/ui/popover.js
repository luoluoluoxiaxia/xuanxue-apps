// 古典解读浮层：点命盘的一柱、大运、流年、流月，或卦盘的一爻，查看这一格的排盘事实与静态古籍释义。
// 桌面为居中对话框，手机为底部面板（均由 openSheet 提供）。干支颜色、十神、藏干等全部取接口字段；
// 释义是 lib/copy.js 里的静态模板，不调用解读接口，也不在客户端推算旺衰喜忌。
import { h, reducedMotion } from "../lib/dom.js?v=n8";
import { GODPHRASE, PILLAR_ROLE, POP_NOTE, LY_POS } from "../lib/copy.js?v=n8";
import { openSheet, closeAllSheets } from "./overlay.js?v=n8";
import { openGlossary } from "./glossary.js?v=n8";
import { elementClass } from "./gua.js?v=n8";

const str = value => (value === null || value === undefined ? "" : String(value)).trim();
const orDash = value => str(value) || "—";
const list = value => (Array.isArray(value) ? value : []);
// 十神对应的古籍短语；接口给了不认识的十神时只省略这一句，不猜。
const phrase = god => (Object.prototype.hasOwnProperty.call(GODPHRASE, god) ? `——${GODPHRASE[god]}` : "");

function hiddenTags(stems) {
  return list(stems).filter(item => item && item.stem).map(item => h("span", { class: "pop-tag" },
    h("b", { class: elementClass(item.element) }, item.stem),
    item.ten_god ? ` ${item.ten_god}` : ""));
}

function textTags(items) {
  return [...new Set(list(items).map(str).filter(Boolean))].map(item => h("span", { class: "pop-tag" }, item));
}

function openChartPop(model, { liuyao = false, returnFocus = null } = {}) {
  const trigger = returnFocus || document.activeElement;
  const chars = Array.from(str(model.ganzhi));
  const hero = h("div", { class: "pop-hero" },
    h("span", { class: "pop-gz" },
      h("b", { class: elementClass(model.stemElement) }, chars[0] || "—"),
      h("b", { class: elementClass(model.branchElement) }, chars[1] || "")),
    h("span", { class: "pop-hero-meta" },
      model.god ? h("span", { class: "chip pop-god" }, model.god) : null,
      model.elements ? h("span", { class: "pop-el" }, model.elements) : null));
  const tags = model.tags?.length
    ? h("section", { class: "pop-tags" }, h("h3", { class: "pop-sub" }, model.tagsLabel), h("div", { class: "pop-tag-list" }, model.tags))
    : null;
  const facts = h("dl", { class: "pop-facts" }, model.facts.filter(Boolean).map(([label, value]) => h("div", null, h("dt", null, label), h("dd", null, orDash(value)))));
  const classic = h("section", { class: "pop-classic" }, h("h3", { class: "pop-sub" }, "古典解读"), h("p", null, model.classic));
  const note = h("p", { class: "pop-note" }, liuyao ? POP_NOTE.liuyao : POP_NOTE.bazi);
  let sheet = null;
  // 六爻：回到断卦＝收起浮层（手机上连同看盘面板一起收起），回到对话。
  // 八字：名词解释在浮层收起、焦点回到原处之后再打开，免得焦点落到背后的页面上。
  const secondary = liuyao
    ? h("button", { type: "button", class: "btn btn-ghost", onClick: () => closeAllSheets() }, "回到断卦")
    : h("button", { type: "button", class: "btn btn-ghost", onClick: () => {
      sheet.close("glossary");
      setTimeout(() => openGlossary("bazi", { returnFocus: trigger }), reducedMotion() ? 0 : 220);
    } }, "名词解释");
  const ok = h("button", { type: "button", class: "btn btn-primary", onClick: () => sheet.close("ok") }, "知道了");
  sheet = openSheet({
    title: model.label,
    body: h("div", { class: "pop" }, hero, tags, facts, classic, note),
    footer: [secondary, ok],
    className: "sheet-pop",
    returnFocus: trigger,
  });
  return sheet;
}

/* ---------- 八字 ---------- */
export function pillarPop(key, pillar, detail = {}, options = {}) {
  const role = PILLAR_ROLE[key] || { name: "", gloss: "" };
  const chars = Array.from(str(pillar || detail.pillar));
  const gan = chars[0] || "";
  const zhi = chars[1] || "";
  const isDay = key === "day";
  const god = isDay ? "日元" : str(detail.stem_ten_god);
  const classic = isDay
    ? `日柱${role.gloss}。${gan}为日元，坐${zhi}（地势${orDash(detail.di_shi)}），纳音${orDash(detail.na_yin)}。命主元神所系，全盘以此为中心，论与它干支之生克旺衰。`
    : `${role.name}${role.gloss}。天干${gan}（${orDash(god)}）${phrase(god)}；坐${zhi}，地势${orDash(detail.di_shi)}，纳音${orDash(detail.na_yin)}。`;
  return openChartPop({
    ganzhi: gan + zhi,
    stemElement: detail.stem_element,
    branchElement: detail.branch_element,
    label: isDay ? "日柱 · 命主元神" : role.name,
    god,
    elements: [detail.stem_element, detail.branch_element].filter(Boolean).join(" · "),
    tagsLabel: "地支藏干",
    tags: hiddenTags(detail.hidden),
    facts: [["天干十神", god], ["地势", detail.di_shi], ["纳音", detail.na_yin]],
    classic,
  }, options);
}

export function dayunPop(step = {}, { current = false, ...options } = {}) {
  const gz = str(step.ganzhi);
  const god = str(step.stem_ten_god);
  const ages = str(step.age_range) || [step.start_age, step.end_age].filter(value => value !== null && value !== undefined).join("–");
  const years = str(step.year_range) || (step.start_year ? `${step.start_year}起` : "");
  const classic = current
    ? `大运乃十年气运之纲。「${gz}」${god}临身${phrase(god)}。当下正行此运，外境与心志皆受其牵动；宜顺其气、借其势，最忌与之硬抗。`
    : `「${gz}」大运，${god}主事${phrase(god)}。十年之内，以此为气运底色。`;
  const start = step.start_age !== null && step.start_age !== undefined ? `${step.start_age}岁起` : "";
  return openChartPop({
    ganzhi: gz,
    stemElement: step.stem_element,
    branchElement: step.branch_element,
    label: ["大运", start].filter(Boolean).join(" · "),
    god,
    elements: [step.stem_element, step.branch_element].filter(Boolean).join(" · "),
    tagsLabel: "地支藏干",
    tags: hiddenTags(step.branch_hidden_stems),
    facts: [["十神", god], ["起止", [ages ? `${ages}岁` : "", years].filter(Boolean).join(" · ")], ["纳音", step.na_yin]],
    classic,
  }, options);
}

export function liunianPop(ln = {}, options = {}) {
  const pillar = str(ln.pillar);
  const god = str(ln.stem_ten_god);
  return openChartPop({
    ganzhi: pillar,
    stemElement: ln.stem_element,
    branchElement: ln.branch_element,
    label: `流年 · ${[str(ln.year), pillar].filter(Boolean).join(" ")}`,
    god,
    elements: [ln.stem_element, ln.branch_element].filter(Boolean).join(" · "),
    tagsLabel: "流年地支藏干",
    tags: hiddenTags(ln.branch_hidden_stems),
    facts: [["十神", god], ["流年", ln.year]],
    classic: `流年为一岁之主。「${pillar}」${god}当值${phrase(god)}。与本命、大运相互引动，主一岁之内吉凶起伏。`,
  }, options);
}

export function liuyuePop(month = {}, { year = "", ...options } = {}) {
  const pillar = str(month.pillar);
  const god = str(month.stem_ten_god);
  const relations = month.relations || {};
  return openChartPop({
    ganzhi: pillar,
    stemElement: month.stem_element,
    branchElement: month.branch_element,
    label: `流月 · ${[str(year), str(month.month_name), pillar].filter(Boolean).join(" ")}`,
    god,
    elements: [month.stem_element, month.branch_element].filter(Boolean).join(" · "),
    tagsLabel: "引动关系",
    tags: textTags([...list(relations.to_natal), ...list(relations.to_da_yun), ...list(relations.to_liu_nian)]),
    facts: [["十神", god], ["节气", str(month.solar_term_range) || "按节气分月"]],
    classic: `「${pillar}」之月，${god}当令${phrase(god)}。流月之气，须合流年同参。`,
  }, options);
}

/* ---------- 六爻 ---------- */
export function yaoPop(yao = {}, options = {}) {
  const pos = `${LY_POS[(Number(yao.pos) || 1) - 1] || str(yao.pos)}爻`;
  const najia = str(yao.najia);
  const chars = Array.from(najia);
  const wuxing = str(yao.wuxing);
  const fu = yao.fu_shen || null;
  const bian = yao.bian || null;
  const withElement = line => `${str(line.liu_qin)}${str(line.najia)}${line.wuxing ? `（${line.wuxing}）` : ""}`;
  const classic = `${pos} ${najia}${wuxing ? `（${wuxing}）` : ""}，六亲为${orDash(yao.liu_qin)}，临${orDash(yao.liu_shen)}。`
    + (yao.moving ? `此爻发动${yao.old_young ? `（${yao.old_young}）` : ""}，动则有变。` : "此爻安静。")
    + (fu ? `本爻之下伏${str(fu.liu_qin)}${str(fu.najia)}。` : "");
  return openChartPop({
    ganzhi: (str(yao.gan) || chars[0] || "") + (str(yao.zhi) || chars[1] || ""),
    stemElement: wuxing,
    branchElement: wuxing,
    label: [pos, str(yao.liu_qin)].filter(Boolean).join(" · "),
    god: str(yao.liu_shen),
    elements: wuxing,
    tagsLabel: "与月建日辰",
    tags: textTags([...list(yao.to_month).map(item => `月建${item}`), ...list(yao.to_day).map(item => `日辰${item}`)]),
    facts: [
      ["纳甲", `${najia}${wuxing ? `（${wuxing}）` : ""}`],
      ["六亲", yao.liu_qin],
      ["六神", yao.liu_shen],
      ["动静", yao.moving ? ["动", str(yao.old_young)].filter(Boolean).join(" · ") : "静"],
      yao.shi ? ["世应", "世爻"] : null,
      yao.ying ? ["世应", "应爻"] : null,
      yao.kong ? ["旬空", "空亡"] : null,
      fu ? ["伏神", withElement(fu)] : null,
      bian ? ["变爻", withElement(bian)] : null,
    ],
    classic,
  }, { ...options, liuyao: true });
}
