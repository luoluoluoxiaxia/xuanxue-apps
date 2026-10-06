// 解读会话的恢复规则（纯函数，便于单元测试）。
import { isSessionId } from "./ids.js?v=n15";

// 六爻一卦一段对话：沿用最近一条记录（进行中 / 失败 / 已停止的任务，或已完成的历史）的会话；
// 已完成的历史只带 task_id 时，向任务接口查它的会话编号；任务记录已过期查不到时，
// 再从这张盘的对话列表里取最近一段。
// 都找不到会话编号时报错——不能悄悄开一段新对话，否则会重复发起付费解读。
// 新对话（fresh）或没有任何记录时返回空字符串，由调用方开新会话。
export async function resolveLiuyaoSession(detail, { fresh = false, fetchTask = null, fetchConversations = null } = {}) {
  if (fresh) return "";
  const candidates = [...(detail?.active_tasks || []), ...(detail?.history || [])]
    .sort((a, b) => String(b?.created_at || "").localeCompare(String(a?.created_at || "")));
  const latest = candidates[0];
  if (!latest) return "";
  if (isSessionId(latest.session_id)) return latest.session_id;
  if (latest.task_id && typeof fetchTask === "function") {
    const task = await Promise.resolve(fetchTask(latest.task_id)).catch(() => null);
    if (isSessionId(task?.session_id)) return task.session_id;
  }
  if (typeof fetchConversations === "function") {
    const data = await Promise.resolve(fetchConversations()).catch(() => null);
    const rows = (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [])
      .filter(row => isSessionId(row?.session_id))
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
    if (rows.length) return rows[0].session_id;
  }
  throw new Error("这卦的对话记录暂时无法恢复，请稍后重试。");
}

// 输入框草稿按「档案 + 会话」隔离：换一段对话就是空白输入框；还没发出第一问的新对话共用一份。
// 退出登录时 clearPrivateDrafts() 会清掉所有 xz-next-draft: 开头的键。
export function readingDraftKey(profileId, sessionId, { started = false } = {}) {
  const session = started && isSessionId(sessionId) ? sessionId : "new";
  return `xz-next-draft:reading:${profileId}:${session}`;
}
