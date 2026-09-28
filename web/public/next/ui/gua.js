// 卦象与四柱的展示组件。接口里的 lines 以上爻在前（lines[0] 为上爻），自上而下绘制。
import { h, svg, esc } from "../lib/dom.js?v=n3";

function lineRects(line, index, { changed, width, height, gap, barH, highlightMoving }) {
  const y = index * (barH + gap);
  const yin = changed ? !!line.changed_yin : !!line.yin;
  const moving = !changed && highlightMoving && !!line.moving;
  const fill = moving ? "var(--accent)" : "currentColor";
  if (!yin) return `<rect x="0" y="${y}" width="${width}" height="${barH}" rx="${barH / 2}" fill="${fill}"/>`;
  const half = (width - gap * 1.6) / 2;
  return `<rect x="0" y="${y}" width="${half}" height="${barH}" rx="${barH / 2}" fill="${fill}"/>`
    + `<rect x="${width - half}" y="${y}" width="${half}" height="${barH}" rx="${barH / 2}" fill="${fill}"/>`;
}

export function guaGlyph(lines, { changed = false, size = "sm", highlightMoving = true, label = "" } = {}) {
  const list = Array.isArray(lines) ? lines.slice(0, 6) : [];
  const dims = size === "lg"
    ? { width: 96, barH: 9, gap: 8 }
    : size === "md" ? { width: 52, barH: 5.5, gap: 4.5 } : { width: 26, barH: 3, gap: 2.4 };
  const height = list.length * dims.barH + (list.length - 1) * dims.gap;
  const rects = list.map((line, index) => lineRects(line, index, { ...dims, changed, highlightMoving, height })).join("");
  return svg(`<svg class="gua-glyph gua-${size}" viewBox="0 0 ${dims.width} ${Math.max(1, height)}" width="${dims.width}" height="${Math.max(1, height)}" role="img" aria-label="${esc(label || "卦象")}">${rects}</svg>`);
}

// 帖子卡片与列表里的卦象标记：本卦 → 变卦
export function guaToken(summary) {
  if (!summary || !Array.isArray(summary.lines) || !summary.lines.length) return null;
  const changed = !!(summary.has_changed && summary.bian_name);
  return h("div", { class: "gua-token" },
    guaGlyph(summary.lines, { label: `本卦 ${summary.ben_name || ""}` }),
    h("span", { class: "gua-token-names" },
      h("b", null, summary.ben_name || "本卦"),
      changed ? h("span", { class: "gua-token-arrow", "aria-hidden": "true" }, "→") : null,
      changed ? h("b", null, summary.bian_name) : h("span", { class: "gua-token-quiet" }, "六爻安静")));
}

// 四柱标记：只展示接口给出的干支文本，不在客户端推算五行。
export function pillarsToken(summary) {
  const pillars = summary && summary.pillars;
  if (!pillars) return null;
  const order = [["year", "年"], ["month", "月"], ["day", "日"], ["hour", "时"]];
  return h("div", { class: "pillars-token" },
    h("span", { class: "pillars-token-cols" },
      order.map(([key, label]) => pillars[key]
        ? h("span", { class: "pillar-mini", title: `${label}柱` }, h("i", null, label), h("b", null, pillars[key]))
        : null)),
    summary.day_master ? h("span", { class: "pillars-token-dm" }, "日主 ", h("b", null, summary.day_master)) : null);
}

const ELEMENT_CLASS = { 木: "el-wood", 火: "el-fire", 土: "el-earth", 金: "el-metal", 水: "el-water" };

export function elementClass(element) {
  const key = String(element || "").trim().slice(0, 1);
  return ELEMENT_CLASS[key] || "";
}
