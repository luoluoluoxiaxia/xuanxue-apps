(() => {
  const root = document.querySelector("[data-admin-ip-map]");
  if (!root) return;

  const chartNode = root.querySelector("[data-admin-ip-map-chart]");
  const stateNode = root.querySelector("[data-admin-ip-map-state]");
  const dataNode = document.getElementById(root.dataset.dataId || "");
  if (!chartNode || !dataNode) return;

  const setState = (message, isError = false) => {
    if (!stateNode) return;
    stateNode.textContent = message;
    stateNode.classList.toggle("text-danger", isError);
    stateNode.classList.toggle("text-muted", !isError);
  };

  let rows = [];
  try {
    rows = JSON.parse(dataNode.textContent || "[]");
  } catch (_) {
    setState("省份数据解析失败", true);
    return;
  }

  if (!window.echarts) {
    setState("地图组件加载失败", true);
    return;
  }

  const maxCount = Math.max(
    Number(root.dataset.maxCount || "0") || 0,
    ...rows.map((item) => Number(item.value || 0)),
    1,
  );

  fetch(root.dataset.mapUrl, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error("map json failed");
      return response.json();
    })
    .then((geoJson) => {
      window.echarts.registerMap("xuanxue-china", geoJson);
      const chart = window.echarts.init(chartNode, null, { renderer: "canvas" });
      chart.setOption({
        animationDuration: 450,
        tooltip: {
          trigger: "item",
          formatter(params) {
            const value = Number(params.value || 0);
            return `${params.name}<br/>近 7 日 IP UV：${value}`;
          },
        },
        visualMap: {
          min: 0,
          max: maxCount,
          left: 12,
          bottom: 8,
          itemWidth: 12,
          itemHeight: 92,
          text: ["高", "低"],
          calculable: false,
          inRange: {
            color: ["#eff6ff", "#93c5fd", "#2563eb", "#1e3a8a"],
          },
          textStyle: {
            color: "#667085",
            fontSize: 12,
          },
        },
        series: [{
          type: "map",
          map: "xuanxue-china",
          data: rows,
          roam: true,
          zoom: 1.12,
          top: 22,
          bottom: 16,
          scaleLimit: { min: 0.85, max: 5 },
          selectedMode: false,
          itemStyle: {
            areaColor: "#f8fafc",
            borderColor: "#cbd5e1",
            borderWidth: 0.8,
          },
          emphasis: {
            label: {
              color: "#111827",
              fontWeight: 700,
            },
            itemStyle: {
              areaColor: "#f59e0b",
              borderColor: "#1f2937",
              borderWidth: 1,
            },
          },
          label: {
            show: true,
            color: "#475569",
            fontSize: 10,
          },
        }],
      });
      root.dataset.ready = "1";
      setState("");

      if (window.ResizeObserver) {
        const observer = new ResizeObserver(() => chart.resize());
        observer.observe(root);
      }
      window.addEventListener("resize", () => chart.resize());
    })
    .catch(() => {
      setState("中国地图数据加载失败", true);
    });
})();
