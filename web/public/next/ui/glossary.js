// 名词解释面板：只展示当前盘面相关的静态术语。
import { h } from "../lib/dom.js?v=n46";
import { GLOSSARY, GLOSSARY_BU } from "../lib/copy.js?v=n46";
import { openSheet } from "./overlay.js?v=n46";

// returnFocus：从古典解读浮层跳过来时，关闭后把焦点还给最初点开浮层的那一格。
export function openGlossary(system = "bazi", { returnFocus = null } = {}) {
  const group = (title, items) => h("section", { class: "gloss-group" },
    h("h3", null, title),
    h("dl", { class: "gloss-list" }, items.map(([term, tag, text]) => h("div", { class: "gloss-item" },
      h("dt", null, h("b", null, term), h("span", { class: "chip" }, tag)),
      h("dd", null, text)))));
  const liuyao = system === "liuyao";
  return openSheet({
    title: "名词解释",
    body: h("div", { class: "gloss" },
      h("p", { class: "gloss-source" }, liuyao ? "典出《增删卜易》" : "典出《子平真诠》《渊海子平》"),
      group(liuyao ? "卜筮" : "命理", liuyao ? GLOSSARY_BU : GLOSSARY)),
    wide: true,
    returnFocus,
  });
}
