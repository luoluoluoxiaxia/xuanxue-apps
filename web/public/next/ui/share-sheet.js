// 分享面板：先给出复制链接，同时生成一张带二维码的分享长图（帖子页、解读页共用）。
import { h } from "../lib/dom.js?v=n14";
import { icon } from "../lib/icons.js?v=n14";
import { sharePost, renderShareImage, trackShare } from "../lib/share.js?v=n14";
import { openSheet } from "./overlay.js?v=n14";
import { toast } from "./toast.js?v=n14";

const inWeChat = () => typeof navigator !== "undefined" && /MicroMessenger/i.test(navigator.userAgent || "");

// ref：分享来源，默认沿用页面地址里的 ref，没有时记为社区分享。
export function openShareSheet(post, { ref = "" } = {}) {
  const source = ref || new URLSearchParams(location.search).get("ref") || "community_share";
  const title = post.question || post.title || "玄枢卦帖";
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const wechat = inWeChat();
  const preview = h("div", { class: "share-preview", "aria-busy": "true" }, h("div", { class: "spinner-line" }, h("span", { class: "spinner", "aria-hidden": "true" }), "正在生成分享长图…"));
  const actions = h("div", { class: "share-actions" });
  const copyBtn = h("button", { type: "button", class: "btn" }, icon("copy"), "复制标题和链接");
  let copying = false;
  copyBtn.addEventListener("click", async () => {
    if (copying) return;
    copying = true;
    try {
      const result = await sharePost({ slug: post.slug, title, ref: source });
      if (!result.silent && result.message) toast(result.message, { type: result.ok ? "ok" : "error" });
    } finally {
      copying = false;
    }
  });
  actions.append(copyBtn);
  const sheet = openSheet({ title: "分享这条卦帖", body: h("div", { class: "share-sheet" }, preview, actions), wide: false, className: "sheet-share" });
  let objectUrl = "";
  const cleanup = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  renderShareImage(post).then(image => {
    if (!document.contains(sheet.panel)) return;
    objectUrl = URL.createObjectURL(image.blob);
    trackShare(post.slug, "image_preview", source);
    preview.removeAttribute("aria-busy");
    const img = h("img", { src: objectUrl, alt: `分享长图：${title}`, class: "share-image" });
    // 长按（右键）保存也记一次分享。
    let pressed = false;
    img.addEventListener("contextmenu", () => {
      if (pressed) return;
      pressed = true;
      trackShare(post.slug, "image_longpress", source);
    });
    const hint = wechat
      ? "微信内请长按图片保存；也可以点右上角「…」，用默认浏览器打开后分享"
      : coarse ? "长按图片保存或发给朋友" : "图片里的二维码可以直接扫码查看全文";
    preview.replaceChildren(img, h("p", { class: "share-hint" }, hint, image.attributed ? " · 已记录你的邀请归因" : ""));
    // 微信内置浏览器不支持下载和系统分享，只保留长按保存与复制链接。
    if (wechat) return;
    const file = typeof File === "function" ? new File([image.blob], image.filename || "玄枢卦帖.png", { type: "image/png" }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      actions.prepend(h("button", { type: "button", class: "btn btn-primary", onClick: async () => {
        try {
          await navigator.share({ files: [file], title });
          trackShare(post.slug, "image_native", source);
        } catch (error) {
          if (error?.name !== "AbortError") toast("分享没有成功，可以先保存图片", { type: "error" });
        }
      } }, icon("share"), "分享图片"));
    }
    if (!coarse) {
      const save = h("a", { class: "btn btn-primary", href: objectUrl, download: image.filename || "玄枢卦帖.png", onClick: () => trackShare(post.slug, "image_save", source) }, icon("arrowUp"), "保存图片");
      save.querySelector(".icon")?.setAttribute("style", "transform: rotate(180deg)");
      actions.prepend(save);
    }
  }).catch(error => {
    preview.removeAttribute("aria-busy");
    preview.replaceChildren(h("p", { class: "share-hint" }, error?.message || "长图生成失败，可以先复制链接分享"));
  });
  const observer = new MutationObserver(() => { if (!document.contains(sheet.panel)) { cleanup(); observer.disconnect(); } });
  observer.observe(document.body, { childList: true });
  return sheet;
}
