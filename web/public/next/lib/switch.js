// 新版与经典版之间的地址映射：切换时尽量停留在同一内容上。
// 经典版地址形如 /?post=slug#gua-square、/?start=liuyao、/?view=credits；新版使用哈希路由。

export function classicBase() {
  return typeof window.XZ_CLASSIC_URL === "string" && window.XZ_CLASSIC_URL ? window.XZ_CLASSIC_URL : "./";
}

export function classicUrl(match) {
  const base = classicBase();
  const path = match?.path || "/";
  const params = new URLSearchParams();
  let hash = "";
  const post = /^\/post\/([^/]+)/.exec(path);
  if (post) {
    params.set("post", decodeURIComponent(post[1]));
    hash = "#gua-square";
  } else if (path.startsWith("/ask/liuyao")) {
    params.set("start", "liuyao");
    if (match?.query?.get("help") === "1") params.set("community", "help");
  } else if (path.startsWith("/ask/bazi")) {
    params.set("start", "bazi");
  } else if (path.startsWith("/me/credits")) {
    params.set("view", "credits");
  } else if (path.startsWith("/me/archives") || path.startsWith("/reading")) {
    params.set("view", "archives");
  }
  params.set("ui", "classic");
  const search = params.toString();
  return `${base}${search ? `?${search}` : ""}${hash}`;
}

// 从经典版查询参数得到新版路由；没有可识别的参数时返回空字符串。
export function routeFromLegacy(search) {
  if (location.hash && location.hash !== "#" && location.hash !== "#gua-square") return "";
  const params = new URLSearchParams(search || "");
  let route = "";
  const extra = new URLSearchParams();
  if (params.get("post")) {
    // 通知与旧链接里的 target=comment-<id> 一并带进帖子路由，打开后定位到那条评论。
    const target = params.get("target") || "";
    if (/^comment-\d+$/.test(target)) extra.set("target", target);
    route = `#/post/${encodeURIComponent(params.get("post"))}${extra.toString() ? `?${extra}` : ""}`;
    params.delete("post");
    params.delete("target");
  } else if (params.get("start") === "liuyao" || params.get("start") === "bazi") {
    const system = params.get("start");
    if (params.get("community") === "help") extra.set("help", "1");
    if (system === "bazi" && params.get("set_default") === "1") extra.set("set_default", "1");
    route = `#/ask/${system}${extra.toString() ? `?${extra}` : ""}`;
    ["start", "community", "set_default", "from"].forEach(key => params.delete(key));
  } else if (params.get("view") === "credits" || ["success", "cancelled"].includes(params.get("checkout"))) {
    // 支付返回地址可能只带 checkout / session_id / order_id，同样落到积分页；month 定位到对应月份的明细。
    ["checkout", "session_id", "checkout_session_id", "order_id"].forEach(key => {
      if (params.get(key)) extra.set(key, params.get(key));
      params.delete(key);
    });
    if (/^\d{4}-\d{2}$/.test(params.get("month") || "")) extra.set("month", params.get("month"));
    params.delete("month");
    route = `#/me/credits${extra.toString() ? `?${extra}` : ""}`;
    params.delete("view");
  } else if (params.get("view") === "archives") {
    route = "#/me/archives";
    params.delete("view");
  } else if (location.hash === "#gua-square") {
    route = "#/";
  }
  if (!route) return "";
  params.delete("ui");
  const rest = params.toString();
  return `${rest ? `?${rest}` : ""}${route}`;
}
