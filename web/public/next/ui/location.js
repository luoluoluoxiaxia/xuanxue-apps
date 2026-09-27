// 出生地选择（省 / 市 / 区县），用于真太阳时校正。行政区划数据按需加载。
import { h } from "../lib/dom.js?v=n1";
import { get, query } from "../lib/api.js?v=n1";

const MUNICIPALITIES = new Set(["北京市", "天津市", "上海市", "重庆市"]);
const SKIP_CITY = new Set(["市辖区", "县"]);
const OVERSEAS = [
  { name: "日本", children: ["东京", "大阪", "京都", "横滨", "名古屋", "福冈", "札幌", "神户", "广岛", "那霸"].map(name => ({ name })) },
  { name: "新加坡", children: [{ name: "新加坡" }] },
  { name: "马来西亚", children: ["吉隆坡", "槟城", "马六甲", "新山", "亚庇", "古晋", "怡保", "关丹", "兰卡威"].map(name => ({ name })) },
];

let loading = null;
function loadTree() {
  if (window.XUANXUE_REGION_TREE) return Promise.resolve(window.XUANXUE_REGION_TREE);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "regions.js?v=20260629";
      script.onload = () => resolve(window.XUANXUE_REGION_TREE || []);
      script.onerror = () => { loading = null; reject(new Error("地区数据加载失败")); };
      document.head.append(script);
    });
  }
  return loading;
}

export function locationPicker({ initial = "" } = {}) {
  const province = h("select", { class: "select", "aria-label": "省 / 国家 / 地区" }, h("option", { value: "" }, "正在加载…"));
  const city = h("select", { class: "select", "aria-label": "市 / 地区", disabled: true }, h("option", { value: "" }, "请选择城市"));
  const county = h("select", { class: "select", "aria-label": "区 / 县 / 城市", disabled: true }, h("option", { value: "" }, "请选择区县"));
  const preview = h("p", { class: "loc-preview", role: "status" }, initial ? `已保存：${initial}` : "未选择出生地");
  const node = h("div", { class: "loc" }, h("div", { class: "loc-selects" }, province, city, county), preview);
  let tree = [];
  let seq = 0;
  let saved = initial;

  const option = (value, label) => h("option", { value }, label);
  const fill = (select, items, placeholder) => {
    select.replaceChildren(option("", placeholder), ...items.map((item, index) => option(String(index), item.name)));
  };
  const provinceNode = () => tree[Number(province.value)];
  const cityNode = () => provinceNode()?.children?.[Number(city.value)];

  function countiesFor(p) {
    if (!p) return [];
    if (MUNICIPALITIES.has(p.name)) return (p.children || []).flatMap(c => c.children || []);
    return null;
  }

  function value() {
    const p = provinceNode();
    if (!p) return saved || "";
    const parts = [p.name];
    const direct = countiesFor(p);
    if (direct) {
      const c = direct[Number(county.value)];
      if (c) parts.push(c.name);
    } else {
      const c = cityNode();
      if (c && !SKIP_CITY.has(c.name)) parts.push(c.name);
      const d = c?.children?.[Number(county.value)];
      if (d) parts.push(d.name);
    }
    return parts.filter((name, index) => name && name !== parts[index - 1]).join(" ");
  }

  async function refreshPreview() {
    const text = value();
    const mine = ++seq;
    if (!text) { preview.textContent = "未选择出生地"; return; }
    preview.textContent = `已选：${text}`;
    try {
      const data = await get(`/api/location/preview${query({ location: text })}`);
      if (mine !== seq) return;
      if (data && data.found && typeof data.longitude === "number") {
        const offset = Number(data.offset_minutes) || 0;
        const sign = offset > 0 ? "+" : offset < 0 ? "−" : "±";
        preview.textContent = `已选：${text} · 东经 ${data.longitude}° · 真太阳时约 ${sign}${Math.abs(offset)} 分`;
      } else {
        preview.textContent = `已选：${text} · 未识别经度，将不做经度修正`;
      }
    } catch (_) {}
  }

  province.addEventListener("change", () => {
    saved = "";
    const p = provinceNode();
    county.disabled = true;
    fill(county, [], "请选择区县");
    if (!p) { city.disabled = true; fill(city, [], "请选择城市"); refreshPreview(); return; }
    const direct = countiesFor(p);
    if (direct) {
      city.disabled = true;
      city.replaceChildren(option("", "无需选择城市"));
      fill(county, direct, "请选择区县");
      county.disabled = false;
    } else {
      fill(city, p.children || [], "请选择城市");
      city.disabled = false;
    }
    refreshPreview();
  });
  city.addEventListener("change", () => {
    const c = cityNode();
    const children = c?.children || [];
    fill(county, children, children.length ? "请选择区县" : "无需选择");
    county.disabled = !children.length;
    refreshPreview();
  });
  county.addEventListener("change", refreshPreview);

  loadTree().then(data => {
    tree = [...(Array.isArray(data) ? data : []), ...OVERSEAS];
    fill(province, tree, "请选择地区");
  }).catch(() => {
    province.replaceChildren(option("", "地区数据加载失败"));
  });

  return { node, value, reset() { saved = ""; province.value = ""; province.dispatchEvent(new Event("change")); } };
}
