// 只根据日期与服务端节气边界决定何时重取内容，流年流月仍由服务端计算。
const DAY = 24 * 60 * 60 * 1000;

export function baziChartRefreshAt(payload, now = Date.now()) {
  const midnight = Date.parse(`${payload?.analysis_date || ""}T00:00:00+08:00`) + DAY;
  const end = payload?.current_liu_yue?.solar_term_end?.datetime;
  // 公开时间截到秒；等完整一秒过去，避免早于服务端保留微秒的实际节气边界。
  const termEnd = typeof end === "string" ? Date.parse(`${end.replace(" ", "T")}+08:00`) + 1000 : NaN;
  const boundaries = [midnight, termEnd].filter(Number.isFinite);
  return boundaries.length ? Math.min(...boundaries) : now + 60 * 60 * 1000;
}

export function personalHomeRefreshAt(payload, now = Date.now()) {
  const today = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dayKeys = [payload?.today, payload?.daily?.day_key];
  const month = payload?.month?.month_key;
  if (dayKeys.some(key => /^\d{4}-\d{2}-\d{2}$/.test(key || "") && key !== today)
    || (/^\d{4}-\d{2}$/.test(month || "") && month !== today.slice(0, 7))) return now;
  const terms = payload?.month?.display?.solar_terms;
  const termTimes = (Array.isArray(terms) ? terms : [])
    .map(term => Date.parse(`${String(term?.datetime || "").replace(" ", "T")}+08:00`) + 1000)
    .filter(time => Number.isFinite(time) && time > now);
  return Math.min(Date.parse(`${today}T00:00:00+08:00`) + DAY, ...termTimes);
}
