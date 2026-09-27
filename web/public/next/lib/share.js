// 分享：登录后换取带归因的分享链接；优先系统分享，其次复制标题与链接。
import { post } from "./api.js?v=n1";
import { session } from "./store.js?v=n1";

export function canonicalPostUrl(slug, ref = "post_share") {
  const origin = location.origin && location.origin !== "null" ? location.origin : "";
  return `${origin}/?post=${encodeURIComponent(slug)}&ref=${encodeURIComponent(ref)}#gua-square`;
}

export async function shareTarget(slug) {
  const fallback = { url: canonicalPostUrl(slug), attributed: false };
  if (!session.get().authenticated) return fallback;
  try {
    const data = await post("/api/referrals/share-link", { slug });
    return { url: data?.share_url || fallback.url, attributed: !!data?.attributed };
  } catch (_) {
    return fallback;
  }
}

export function trackShare(slug, channel, ref = "") {
  const pageRef = new URLSearchParams(location.search).get("ref") || "";
  post("/api/community/share-events", { slug, channel, ref: ref || pageRef }, { keepalive: true }).catch(() => {});
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
  area.remove();
  return ok;
}

// 返回给用户看的提示文案。
export async function sharePost({ slug, title }) {
  const target = await shareTarget(slug);
  const heading = title || "玄枢卦帖";
  const text = `${heading}\n${target.url}`;
  const canNative = typeof navigator.share === "function" && window.matchMedia?.("(pointer: coarse)").matches;
  if (canNative) {
    try {
      await navigator.share({ title: heading, text, url: target.url });
      trackShare(slug, "native");
      return { ok: true, message: "分享已完成" };
    } catch (error) {
      if (error && error.name === "AbortError") return { ok: false, silent: true };
    }
  }
  const copied = await copyText(text);
  if (!copied) return { ok: false, message: "复制失败，请手动复制标题和链接" };
  trackShare(slug, "copy");
  return {
    ok: true,
    message: target.attributed ? "邀请链接已复制，新用户激活后每日额度永久 +1" : "标题和链接已复制",
  };
}
