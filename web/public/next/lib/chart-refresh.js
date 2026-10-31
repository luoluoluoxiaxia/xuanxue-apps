// 只根据服务端日期与节气边界决定何时重取盘面，流年流月仍由服务端计算。
const DAY = 24 * 60 * 60 * 1000;

export function baziChartRefreshAt(payload, now = Date.now()) {
  const midnight = Date.parse(`${payload?.analysis_date || ""}T00:00:00+08:00`) + DAY;
  const end = payload?.current_liu_yue?.solar_term_end?.datetime;
  const termEnd = typeof end === "string" ? Date.parse(`${end.replace(" ", "T")}+08:00`) : NaN;
  const boundaries = [midnight, termEnd].filter(Number.isFinite);
  return boundaries.length ? Math.min(...boundaries) : now + 60 * 60 * 1000;
}
