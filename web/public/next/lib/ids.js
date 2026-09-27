// 会话与请求标识：格式与经典版一致（s_ / r_ + 16 位小写十六进制）。
function hex(bytes) {
  const buffer = new Uint8Array(bytes);
  if (window.crypto && typeof window.crypto.getRandomValues === "function") window.crypto.getRandomValues(buffer);
  else for (let i = 0; i < buffer.length; i += 1) buffer[i] = Math.floor(Math.random() * 256);
  return Array.from(buffer, byte => byte.toString(16).padStart(2, "0")).join("");
}

export const newSessionId = () => `s_${hex(8)}`;
export const newRequestId = () => `r_${hex(8)}`;
export const isSessionId = value => /^s_[0-9a-f]{16}$/.test(String(value || ""));

export function uuid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
  const h = hex(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// 本地时间（不带时区偏移），与经典版六爻 as_of 一致。
export function localDateTimeISO(date = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
