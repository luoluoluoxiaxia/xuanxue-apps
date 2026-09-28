// 出生地选择（省 / 市 / 区县），用于真太阳时校正。行政区划数据按需加载。
// 修改已有命盘时，把保存的地点文字匹配回三级选择并显示真太阳时预览；匹配不上就原样沿用保存的文字。
import { h } from "../lib/dom.js?v=n4";
import { get, query } from "../lib/api.js?v=n4";

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

// 地名比较时去掉空白和行政区划后缀（省、市、区、县、自治区……），已保存的简称也能匹配上。
const bareName = value => String(value || "")
  .replace(/\s+/g, "")
  .replace(/特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|自治州|省|市|地区|盟|区|县/g, "");

function nameMatches(location, node) {
  const raw = String(location || "").replace(/\s+/g, "");
  const rawName = String(node?.name || "").replace(/\s+/g, "");
  const key = bareName(node?.name);
  if (!rawName || !key) return false;
  return raw.includes(rawName) || bareName(location).includes(key);
}

// 在区划树里找与保存文字最吻合的一条路径：省 100 分，市 +20，区县 +5（直辖市区县 +30）。
function bestMatch(tree, location) {
  let best = null;
  const remember = (score, path) => { if (!best || score > best.score) best = { score, ...path }; };
  tree.forEach((province, p) => {
    const provinceHit = nameMatches(location, province);
    if (provinceHit) remember(100, { p });
    if (MUNICIPALITIES.has(province.name)) {
      (province.children || []).flatMap(city => city.children || []).forEach((county, d) => {
        if (nameMatches(location, county)) remember((provinceHit ? 100 : 0) + 30, { p, d });
      });
      return;
    }
    (province.children || []).forEach((city, c) => {
      const cityHit = nameMatches(location, city);
      if (cityHit) remember((provinceHit ? 100 : 0) + 20, { p, c });
      (city.children || []).forEach((county, d) => {
        if (nameMatches(location, county)) remember((provinceHit ? 100 : 0) + (cityHit ? 20 : 0) + 5, { p, c, d });
      });
    });
  });
  return best;
}

// onChange(text)：选择变化时回传当前地点文字，方便折叠标题里显示已选的出生地。
export function locationPicker({ initial = "", onChange } = {}) {
  const province = h("select", { class: "select", "aria-label": "省 / 国家 / 地区" }, h("option", { value: "" }, "正在加载…"));
  const city = h("select", { class: "select", "aria-label": "市 / 地区", disabled: true }, h("option", { value: "" }, "请选择城市"));
  const county = h("select", { class: "select", "aria-label": "区 / 县 / 城市", disabled: true }, h("option", { value: "" }, "请选择区县"));
  const preview = h("p", { class: "loc-preview", role: "status" });
  const node = h("div", { class: "loc" }, h("div", { class: "loc-selects" }, province, city, county), preview);
  let tree = [];
  let seq = 0;
  let saved = String(initial || "").trim();

  const option = (value, label) => h("option", { value }, label);
  const fill = (select, items, placeholder) => {
    select.replaceChildren(option("", placeholder), ...items.map((item, index) => option(String(index), item.name)));
  };
  // 占位项的值是空字符串：不能直接 Number("")（得 0，会被当成列表第一项「北京市 东城区」）。
  const picked = select => (select.value === "" ? -1 : Number(select.value));
  const provinceNode = () => tree[picked(province)];
  const cityNode = () => provinceNode()?.children?.[picked(city)];

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
      const c = direct[picked(county)];
      if (c) parts.push(c.name);
    } else {
      const c = cityNode();
      if (c && !SKIP_CITY.has(c.name)) parts.push(c.name);
      const d = c?.children?.[picked(county)];
      if (d) parts.push(d.name);
    }
    return parts.filter((name, index) => name && name !== parts[index - 1]).join(" ");
  }

  // 真太阳时预览：经度与相对标准时的修正分钟数都来自服务端；失败时只显示地点文字。
  async function showPreview(text, prefix) {
    const mine = ++seq;
    if (!text) { preview.textContent = "未选择出生地"; return; }
    preview.textContent = `${prefix}：${text}`;
    try {
      const data = await get(`/api/location/preview${query({ location: text })}`);
      if (mine !== seq) return;
      if (data && data.found && typeof data.longitude === "number") {
        const offset = Number(data.offset_minutes) || 0;
        const sign = offset > 0 ? "+" : offset < 0 ? "−" : "±";
        preview.textContent = `${prefix}：${text} · 东经 ${data.longitude}° · 真太阳时约 ${sign}${Math.abs(offset)} 分`;
      } else {
        preview.textContent = `${prefix}：${text} · 未识别经度，将不做经度修正`;
      }
    } catch (_) {}
  }

  function refreshPreview() {
    const text = value();
    onChange?.(text);
    showPreview(text, saved && !provinceNode() ? "已保存" : "已选");
  }

  function applyProvince() {
    const p = provinceNode();
    county.disabled = true;
    fill(county, [], "请选择区县");
    if (!p) { city.disabled = true; fill(city, [], "请选择城市"); return; }
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
  }

  function applyCity() {
    const children = cityNode()?.children || [];
    fill(county, children, children.length ? "请选择区县" : "无需选择");
    county.disabled = !children.length;
  }

  province.addEventListener("change", () => { saved = ""; applyProvince(); refreshPreview(); });
  city.addEventListener("change", () => { applyCity(); refreshPreview(); });
  county.addEventListener("change", refreshPreview);

  // 保存的地点能完整对上某一条省 / 市 / 区县时回填三级选择；只对上一部分（例如省对上、市县不在列表里）
  // 就不回填，免得提交时丢掉原来更具体的地点。
  function restoreSaved() {
    const match = saved ? bestMatch(tree, saved) : null;
    if (!match) return false;
    province.value = String(match.p);
    applyProvince();
    if (match.c !== undefined) {
      city.value = String(match.c);
      applyCity();
    }
    if (match.d !== undefined) county.value = String(match.d);
    if (bareName(value()) !== bareName(saved)) {
      province.value = "";
      applyProvince();
      return false;
    }
    saved = "";
    return true;
  }

  function load() {
    province.replaceChildren(option("", "正在加载…"));
    loadTree().then(data => {
      tree = [...(Array.isArray(data) ? data : []), ...OVERSEAS];
      fill(province, tree, "请选择地区");
      if (restoreSaved()) refreshPreview();
      else if (!provinceNode()) showPreview(saved, "已保存");
    }).catch(() => {
      province.replaceChildren(option("", "地区数据加载失败"));
      preview.replaceChildren(saved ? `已保存：${saved}（仍按此地点提交）。地区数据没能加载，` : "地区数据没能加载。", h("button", { type: "button", class: "link-btn", onClick: load }, "重试"));
    });
  }
  preview.textContent = saved ? `已保存：${saved}` : "未选择出生地";
  load();
  if (saved) onChange?.(saved);

  return { node, value, reset() { saved = ""; province.value = ""; province.dispatchEvent(new Event("change")); } };
}
