// 页面之间的一次性交接：刚排好的盘直接带进解读页，不必再请求一次。
const slots = new Map();

export function handoff(key, value) {
  slots.set(String(key), { ...value, at: Date.now() });
}

export function takeHandoff(key) {
  const value = slots.get(String(key));
  slots.delete(String(key));
  if (!value || Date.now() - value.at > 5 * 60 * 1000) return null;
  return value;
}
