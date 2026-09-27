(function (global) {
  "use strict";

  // 社区里的「人」：头像取昵称首字、颜色由昵称稳定映射，时间显示为相对时间。
  // 只做展示，昵称与时间都来自服务端；节点带 nx-only，经典版界面中不显示。
  const AVATAR_TONES = ["#B4412B", "#2F6B5C", "#34506A", "#A27631", "#7A4E6E", "#4E7C5B", "#8A5A3C", "#3F6E8C"];

  function initial(name) {
    const text = String(name || "").trim().replace(/^[#＃@·\s]+/, "");
    const first = Array.from(text)[0] || "友";
    return /[a-z]/i.test(first) ? first.toUpperCase() : first;
  }

  function tone(name) {
    let hash = 0;
    for (const char of String(name || "")) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return AVATAR_TONES[hash % AVATAR_TONES.length];
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function avatarHtml(name, extraClass = "") {
    const className = `nx-avatar nx-only${extraClass ? ` ${extraClass}` : ""}`;
    return `<span class="${className}" style="--nx-avatar:${tone(name)}" aria-hidden="true">${escapeHtml(initial(name))}</span>`;
  }

  function avatarNode(name, extraClass = "") {
    const node = document.createElement("span");
    node.className = `nx-avatar nx-only${extraClass ? ` ${extraClass}` : ""}`;
    node.style.setProperty("--nx-avatar", tone(name));
    node.setAttribute("aria-hidden", "true");
    node.textContent = initial(name);
    return node;
  }

  function paintAvatar(node, name) {
    if (!node) return;
    node.style.setProperty("--nx-avatar", tone(name));
    node.textContent = initial(name);
  }

  function relativeTime(value, now = Date.now()) {
    const raw = String(value || "");
    const stamp = new Date(raw);
    if (!raw || Number.isNaN(stamp.getTime())) return raw.slice(0, 10);
    const minutes = Math.floor(Math.max(0, now - stamp.getTime()) / 60000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 2) return "昨天";
    if (days < 7) return `${days} 天前`;
    return raw.slice(0, 10);
  }

  global.XuanxueSocial = Object.freeze({ avatarHtml, avatarNode, initial, paintAvatar, relativeTime, tone });
})(window);
