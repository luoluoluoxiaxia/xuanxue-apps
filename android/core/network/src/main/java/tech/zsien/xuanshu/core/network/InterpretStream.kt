package tech.zsien.xuanshu.core.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import okhttp3.OkHttpClient
import okhttp3.Request
import tech.zsien.xuanshu.core.network.model.InterpretTask
import java.io.IOException

/**
 * 解读任务的流式订阅。
 *
 * 服务端推的是**全量快照**（`event: task` + 整个任务 JSON），不是增量片段，
 * 所以断线重连只需重新发起请求即可续上，不需要 Last-Event-ID 重放——
 * 这也是这里不引入 SSE 客户端库、直接按协议解析的原因：需要处理的只有
 * `event:` / `data:` / 注释帧三种行。
 *
 * 注释帧（`: ping`）是服务端每 15 秒发的心跳，用来穿透移动网络 NAT 与反代的
 * 空闲超时，收到后什么都不做。
 */
class InterpretStream(
    private val client: OkHttpClient,
    private val baseUrl: String,
) {

    fun observe(taskId: String): Flow<InterpretTask> = flow {
        var attempt = 0
        while (currentCoroutineContext().isActive) {
            val request = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/interpret/tasks/$taskId/events")
                .header("Accept", "text/event-stream")
                .build()

            val reachedTerminal = try {
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IOException("SSE 建立失败：HTTP ${response.code}")
                    }
                    val source = response.body?.source() ?: throw IOException("SSE 响应为空")
                    var eventName = ""
                    val data = StringBuilder()
                    var terminal = false

                    while (currentCoroutineContext().isActive) {
                        val line = source.readUtf8Line() ?: break
                        when {
                            // 空行 = 一个事件结束
                            line.isEmpty() -> {
                                if (eventName == EVENT_TASK && data.isNotEmpty()) {
                                    val task = XuanshuNetwork.json
                                        .decodeFromString<InterpretTask>(data.toString())
                                    emit(task)
                                    if (task.isTerminal) {
                                        terminal = true
                                        break
                                    }
                                }
                                eventName = ""
                                data.clear()
                            }
                            line.startsWith(":") -> Unit               // 心跳，忽略
                            line.startsWith("event:") -> eventName = line.substringAfter("event:").trim()
                            line.startsWith("data:") -> data.append(line.substringAfter("data:").trim())
                            else -> Unit                               // retry: 等字段交给重连逻辑处理
                        }
                    }
                    terminal
                }
            } catch (e: IOException) {
                false
            }

            if (reachedTerminal) return@flow

            attempt++
            if (attempt > MAX_RECONNECT_ATTEMPTS) {
                throw IOException("解读连接中断，重连 $MAX_RECONNECT_ATTEMPTS 次仍未恢复")
            }
            delay(RECONNECT_DELAY_MS * attempt)
        }
    }.flowOn(Dispatchers.IO)

    private companion object {
        const val EVENT_TASK = "task"
        const val MAX_RECONNECT_ATTEMPTS = 5
        const val RECONNECT_DELAY_MS = 1_000L
    }
}
