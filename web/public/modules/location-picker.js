(function (global) {
  "use strict";

  const REGION_TREE = Array.isArray(window.XUANXUE_REGION_TREE) ? window.XUANXUE_REGION_TREE : [];
  const OVERSEAS_REGION_TREE = [
    { code: "JP", name: "日本", children: [
      { code: "JP-TYO", name: "东京", children: [] },
      { code: "JP-OSA", name: "大阪", children: [] },
      { code: "JP-KYO", name: "京都", children: [] },
      { code: "JP-YOK", name: "横滨", children: [] },
      { code: "JP-NGO", name: "名古屋", children: [] },
      { code: "JP-FUK", name: "福冈", children: [] },
      { code: "JP-SPK", name: "札幌", children: [] },
      { code: "JP-UKB", name: "神户", children: [] },
      { code: "JP-HIJ", name: "广岛", children: [] },
      { code: "JP-OKA", name: "那霸", children: [] },
    ] },
    { code: "SG", name: "新加坡", children: [
      { code: "SG-SIN", name: "新加坡", children: [] },
    ] },
    { code: "MY", name: "马来西亚", children: [
      { code: "MY-KUL", name: "吉隆坡", children: [] },
      { code: "MY-PEN", name: "槟城", children: [] },
      { code: "MY-MLK", name: "马六甲", children: [] },
      { code: "MY-JHB", name: "新山", children: [] },
      { code: "MY-BKI", name: "亚庇", children: [] },
      { code: "MY-KCH", name: "古晋", children: [] },
      { code: "MY-IPH", name: "怡保", children: [] },
      { code: "MY-KUA", name: "关丹", children: [] },
      { code: "MY-LGK", name: "兰卡威", children: [] },
    ] },
  ];
  const LOCATION_TREE = REGION_TREE.concat(OVERSEAS_REGION_TREE);
  const DIRECT_REGION_NAMES = new Set(["北京市", "天津市", "上海市", "重庆市"]);

  function create({ select, escapeHtml }) {
    const $ = select;
    const esc = escapeHtml;

    function regionByCode(nodes, code) {
      return (nodes || []).find(n => n.code === code) || null;
    }
    function isDirectRegion(province) {
      return !!province && DIRECT_REGION_NAMES.has(province.name);
    }
    function directCountyNodes(province) {
      return (province?.children || []).flatMap(city => city.children || []);
    }
    function setRegionOptions(select, nodes, placeholder) {
      select.innerHTML = `<option value="">${placeholder}</option>` + (nodes || [])
        .map(n => `<option value="${esc(n.code)}">${esc(n.name)}</option>`)
        .join("");
      select.disabled = !nodes || nodes.length === 0;
    }
    function currentRegionPath() {
      const province = regionByCode(LOCATION_TREE, $("#f-province").value);
      if (isDirectRegion(province)) {
        const county = regionByCode(directCountyNodes(province), $("#f-county").value);
        return { province, city: null, county };
      }
      const city = province ? regionByCode(province.children, $("#f-city").value) : null;
      const county = city ? regionByCode(city.children, $("#f-county").value) : null;
      return { province, city, county };
    }
    let locationPreviewSeq = 0;
    async function loadLocationPreview(location) {
      /* 真太阳时预览：经度 + 相对标准时的经度修正，来自 /api/location/preview */
      const seq = ++locationPreviewSeq;
      const preview = $("#f-location-preview");
      if (!preview) return;
      try {
        const r = await fetch(`/api/location/preview?location=${encodeURIComponent(location)}`);
        if (!r.ok) return;
        const data = await r.json();
        if (seq !== locationPreviewSeq) return;
        if (data.found) {
          const sign = data.offset_minutes > 0 ? "+" : data.offset_minutes < 0 ? "−" : "±";
          preview.textContent = `已选：${location} · 东经 ${data.longitude}° · 真太阳时约 ${sign}${Math.abs(data.offset_minutes)} 分`;
        } else {
          preview.textContent = `已选：${location} · 未识别经度，将不做经度修正`;
        }
      } catch (_) {}
    }
    function syncLocationValue() {
      const { province, city, county } = currentRegionPath();
      const parts = [];
      const pushPart = value => {
        if (value && parts[parts.length - 1] !== value) parts.push(value);
      };
      if (province) pushPart(province.name);
      if (city && city.name !== "市辖区" && city.name !== "县") pushPart(city.name);
      if (county) pushPart(county.name);
      const location = parts.join(" ");
      $("#f-location").value = location;
      const preview = $("#f-location-preview");
      preview.textContent = location ? `已选：${location}` : "未选择出生地";
      preview.classList.toggle("is-empty", !location);
      locationPreviewSeq += 1;
      if (location) loadLocationPreview(location);
    }
    function syncCityOptions() {
      const province = regionByCode(LOCATION_TREE, $("#f-province").value);
      $(".bm-location-grid").classList.toggle("is-direct", isDirectRegion(province));
      if (isDirectRegion(province)) {
        setRegionOptions($("#f-city"), [], "无需选择城市");
        setRegionOptions($("#f-county"), directCountyNodes(province), "请选择区县");
        syncLocationValue();
        return;
      }
      setRegionOptions($("#f-city"), province?.children || [], "请选择城市");
      setRegionOptions($("#f-county"), [], "请选择区县");
      syncLocationValue();
    }
    function syncCountyOptions() {
      const { city } = currentRegionPath();
      setRegionOptions($("#f-county"), city?.children || [], "请选择区县");
      syncLocationValue();
    }
    function initLocationPicker() {
      setRegionOptions($("#f-province"), LOCATION_TREE, "请选择地区");
      setRegionOptions($("#f-city"), [], "请选择城市");
      setRegionOptions($("#f-county"), [], "请选择区县");
      $("#f-province").addEventListener("change", syncCityOptions);
      $("#f-city").addEventListener("change", syncCountyOptions);
      $("#f-county").addEventListener("change", syncLocationValue);
      syncLocationValue();
    }
    function normalizedLocationName(value) {
      return String(value || "")
        .replace(/\s+/g, "")
        .replace(/特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|自治州|省|市|地区|盟|区|县/g, "");
    }
    function locationNodeMatches(location, node) {
      const rawLocation = String(location || "").replace(/\s+/g, "");
      const rawName = String(node?.name || "").replace(/\s+/g, "");
      const locationKey = normalizedLocationName(location);
      const nameKey = normalizedLocationName(node?.name);
      if (!rawName || !nameKey) return false;
      return rawLocation.includes(rawName) || locationKey.includes(nameKey);
    }
    function findLocationSelection(location) {
      if (!location) return null;
      let best = null;
      const remember = (score, province, city = null, county = null) => {
        if (!best || score > best.score) best = { score, province, city, county };
      };
      LOCATION_TREE.forEach(province => {
        const provinceMatch = locationNodeMatches(location, province);
        if (provinceMatch) remember(100, province);
        if (isDirectRegion(province)) {
          directCountyNodes(province).forEach(county => {
            if (locationNodeMatches(location, county)) remember((provinceMatch ? 100 : 0) + 30, province, null, county);
          });
          return;
        }
        (province.children || []).forEach(city => {
          const cityMatch = locationNodeMatches(location, city);
          if (cityMatch) remember((provinceMatch ? 100 : 0) + 20, province, city);
          (city.children || []).forEach(county => {
            if (!locationNodeMatches(location, county)) return;
            remember((provinceMatch ? 100 : 0) + (cityMatch ? 20 : 0) + 5, province, city, county);
          });
        });
      });
      return best;
    }
    function resetLocationPicker() {
      setRegionOptions($("#f-province"), LOCATION_TREE, "请选择地区");
      $("#f-province").value = "";
      syncCityOptions();
    }
    function restoreLocationPicker(location) {
      resetLocationPicker();
      const saved = String(location || "").trim();
      if (!saved) return;
      const selected = findLocationSelection(saved);
      if (!selected) {
        $("#f-location").value = saved;
        const preview = $("#f-location-preview");
        preview.textContent = `已保存：${saved}`;
        preview.classList.remove("is-empty");
        locationPreviewSeq += 1;
        loadLocationPreview(saved);
        return;
      }
      $("#f-province").value = selected.province.code;
      syncCityOptions();
      if (selected.city) {
        $("#f-city").value = selected.city.code;
        syncCountyOptions();
      }
      if (selected.county) {
        $("#f-county").value = selected.county.code;
        syncLocationValue();
      }
    }

    return Object.freeze({
      initLocationPicker,
      normalizedLocationName,
      resetLocationPicker,
      restoreLocationPicker,
    });
  }

  global.XuanxueLocationPicker = Object.freeze({ create });
})(window);
