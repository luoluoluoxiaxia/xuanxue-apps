package tech.zsien.xuanshu.core.network.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 发起解读。scenario 决定问的是哪一类：natal 本命、da_yun 大运、
 * liu_nian 流年、topic 专题等。
 */
@Serializable
data class InterpretRequest(
    val system: String = "bazi",
    val scenario: String = "natal",
    val question: String = "",
    val topic: String = "",
    @SerialName("chart_id") val chartId: Int? = null,
    /** 已保存档案与连续会话的公开标识。 */
    @SerialName("profile_id") val profileId: Int? = null,
    @SerialName("session_id") val sessionId: String = "",
    @SerialName("client_request_id") val clientRequestId: String = "",
    // 解读接口的公开输入包含出生信息，由服务端统一完成命盘计算。
    val calendar: String = "solar",
    val year: Int = 0,
    val month: Int = 0,
    val day: Int = 0,
    val hour: Int = 0,
    val minute: Int = 0,
    val gender: String = "male",
    val location: String = "",
)

/**
 * 解读任务快照。
 *
 * 流式接口返回任务快照，客户端可以在网络恢复后继续刷新公开状态。
 */
@Serializable
data class InterpretTask(
    @SerialName("task_id") val taskId: String = "",
    val status: String = "",
    val stage: String = "",
    val question: String = "",
    val answer: String = "",
    val error: String = "",
    val partial: Boolean = false,
    val streamable: Boolean = false,
    @SerialName("chart_id") val chartId: Int? = null,
    @SerialName("session_id") val sessionId: String = "",
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
) {
    val isTerminal: Boolean get() = status in TERMINAL
    val isFailed: Boolean get() = status == "failed"
    val isDone: Boolean get() = status == "done"

    companion object {
        private val TERMINAL = setOf("done", "failed", "cancelled")
    }
}
