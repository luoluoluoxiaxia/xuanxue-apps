// 文本与时间格式化（北京时间展示）。
function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const beijing = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

function parts(date) {
  const map = {};
  beijing.formatToParts(date).forEach(part => { map[part.type] = part.value; });
  return map;
}

export function fullTime(value) {
  const date = toDate(value);
  if (!date) return "";
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function shortDate(value) {
  const date = toDate(value);
  if (!date) return "";
  const p = parts(date);
  const now = parts(new Date());
  return p.year === now.year ? `${Number(p.month)}月${Number(p.day)}日` : `${p.year}年${Number(p.month)}月${Number(p.day)}日`;
}

export function relativeTime(value) {
  const date = toDate(value);
  if (!date) return "";
  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  const days = Math.floor(diff / (24 * 60 * minute));
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return shortDate(date);
}

export function count(value) {
  const n = Number(value) || 0;
  if (n >= 100000) return `${Math.round(n / 10000)}万`;
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}万`;
  return String(n);
}

export function money(amount, currency) {
  const value = (Number(amount) || 0) / 100;
  const code = String(currency || "").toUpperCase();
  const symbol = { USD: "$", CNY: "¥", EUR: "€", HKD: "HK$" }[code];
  const text = value.toFixed(value % 1 ? 2 : 0);
  return symbol ? `${symbol}${text}` : `${text} ${code}`;
}

export function greeting(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "numeric", hour12: false }).format(date));
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function plainExcerpt(markdown, length = 120) {
  const text = String(markdown || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
