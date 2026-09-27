// 旧版首页的地址（/?post=slug#gua-square、/?start=liuyao、/?view=credits 等）映射到哈希路由，
// 通知、分享和收藏里的旧链接仍能打开对应内容。

// 从旧版查询参数得到新版路由；没有需要改写的参数时返回空字符串。
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
  const rest = params.toString();
  return `${rest ? `?${rest}` : ""}${route}`;
}
